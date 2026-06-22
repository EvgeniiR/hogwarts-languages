// ── SYNC ────────────────────────────────────────────────────────────────────
// Frontend sync: fetch/push/merge remote state with last-write-wins.
// Imports from auth.js (getToken, isAuthenticated, signOut, WORKER_URL) and
// state.js (S, saveS).  No side effects on import — all exports are functions
// except isOnline and lastSyncError which are live module-level variables.
import { getToken, isAuthenticated, signOut, WORKER_URL } from './auth.js';
import { S, saveS } from './state.js';
import lang from './lang.js';

// ── Sentinel for "no cloud state exists" (HTTP 204) ──────────────────────────
// Must be truthy so `if (!remote)` still catches null (error/offline).
// Must be distinguishable from a real state object via `_noState` key.
export const REMOTE_EMPTY = Object.freeze({ _noState: true });

// ── Module state (no side effects) ───────────────────────────────────────────
export let lastSyncError = null;

// Throttle tracking for pushState() — prevents excessive KV writes during rapid gameplay.
let _lastPushTs = 0;              // Date.now() of last successful push
let _lastPushedUpdatedAt = 0;     // S._updatedAt value of last pushed state

// Consecutive push failure counter — exposed for UI badge.
// Incremented on each non-ok, non-throttled pushState() call; reset on success.
export let consecutivePushFailures = 0;

// Online status — initialized from navigator if available (browser), else true.
export let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

// Track online/offline transitions in the browser (guarded for Node.js import).
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { isOnline = true; });
  window.addEventListener('offline', () => { isOnline = false; });
}

// Internal flag raised by mergeAndSync when remote overwrites local state.
// Read once by syncConflict() and then reset.
let _conflictFlag = false;

// ── Public API ───────────────────────────────────────────────────────────────

// True if the last mergeAndSync overwrote local state with remote.
// Resets the flag after reading (idempotent-once).
export function syncConflict() {
  const v = _conflictFlag;
  _conflictFlag = false;
  return v;
}

// Check if a state object is near-empty — all six tracked fields at zero/default.
// Treats null/undefined fields as zero (graceful handling for partial or malformed state).
// Returns true only if ALL fields are empty.
export function isStateNearEmpty(state) {
  if (!state) return true;
  return (
    (Array.isArray(state.vocab) ? state.vocab.length : 0) === 0 &&
    (Array.isArray(state.mistakes) ? state.mistakes.length : 0) === 0 &&
    (typeof state.totalMsgs === 'number' ? state.totalMsgs : 0) === 0 &&
    (typeof state.lifetimePts === 'number' ? state.lifetimePts : 0) === 0 &&
    (Array.isArray(state.readingArticles) ? state.readingArticles.length : 0) === 0 &&
    (typeof state.challengesCompleted === 'number' ? state.challengesCompleted : 0) === 0
  );
}

// Fetch remote state from the cloud (GET /state).
// Returns parsed JSON state object when authenticated and state exists;
// returns null when not authenticated, offline, or on any error.
export async function fetchRemoteState() {
  if (!(await isAuthenticated())) return null;
  try {
    const token = await getToken();
    const res = await fetch(WORKER_URL + '/state', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    if (res.status === 401) { signOut(); return null; }
    if (res.status === 204) return REMOTE_EMPTY;
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Push local state to the cloud (PUT /state).
// Excludes S.hist from the request body (conversation history is never synced).
//
// Returns a discriminated result object:
//   {ok: true}                     — successful push
//   {ok: false, throttled: true}   — skipped: same _updatedAt within 15s of last push
//   {ok: false, conflict: true, serverUpdatedAt: N} — Worker returned 409 (stale timestamp)
//   {ok: false, status: 401}       — auth token expired, signOut() called
//   {ok: false, status: 0}         — network error, lastSyncError set
//   {ok: false, status: -1}        — not authenticated
//   {ok: false, status: N}         — other HTTP error, lastSyncError set
//
// Throttle: if called within 15 seconds of the last successful push AND S._updatedAt
// hasn't changed, the call returns immediately without making an HTTP request.
export async function pushState() {
  if (!(await isAuthenticated())) { signOut(); consecutivePushFailures++; return { ok: false, status: -1 }; }

  // ── Throttle: skip duplicate pushes within 15s for the same state snapshot ──
  const now = Date.now();
  const updatedAt = S._updatedAt || 0;
  if (_lastPushTs > 0 && (now - _lastPushTs) < 15000 && updatedAt === _lastPushedUpdatedAt) {
    return { ok: false, throttled: true };
  }

  try {
    const token = await getToken();
    const { hist, ...payload } = S;
    const res = await fetch(WORKER_URL + '/state', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // 401 — token expired/invalid
    if (res.status === 401) { signOut(); consecutivePushFailures++; return { ok: false, status: 401 }; }

    // 409 — conflict: local _updatedAt is older than server's
    if (res.status === 409) {
      let serverUpdatedAt = 0;
      try {
        const body = await res.json();
        serverUpdatedAt = body.serverUpdatedAt || 0;
      } catch (_) { /* ignore parse failure, default to 0 */ }
      consecutivePushFailures++;
      return { ok: false, conflict: true, serverUpdatedAt };
    }

    // Other non-ok statuses
    if (!res.ok) {
      lastSyncError = 'PUT /state returned ' + res.status;
      consecutivePushFailures++;
      return { ok: false, status: res.status };
    }

    // ── Success ──
    _lastPushTs = now;
    _lastPushedUpdatedAt = updatedAt;
    lastSyncError = null;
    consecutivePushFailures = 0;
    return { ok: true };
  } catch (e) {
    lastSyncError = e.message || 'Network error';
    consecutivePushFailures++;
    return { ok: false, status: 0 };
  }
}

// Merge local and remote state with auto-resolution + choice window flow.
//
// Decision tree:
//  - Not authenticated → return {resolved: false, reason: 'not_authenticated'}
//  - REMOTE_EMPTY + local near-empty → no push, both_empty
//  - REMOTE_EMPTY + local has content → pushState(), seeded
//  - null (offline) + local near-empty → no push, offline_empty
//  - null (offline) + local has content → best-effort push
//  - Remote state object:
//    • local near-empty, remote has content → auto-download remote (keep hist)
//    • remote near-empty, local has content → pushState()
//    • both near-empty → no push
//    • same timestamp → pushState(), in_sync
//    • different timestamps → showChoiceWindow()
//      - 'remote': overwrite local, saveS(), pushState()
//      - 'local':  pushState(); 409→re-fetch & re-show; other error→retry/proceed
//
// Returns {resolved: boolean, action?: string, reason?: string}
export async function mergeAndSync() {
  // 1. Check authentication first — no HTTP calls if not signed in.
  if (!(await isAuthenticated())) {
    return { resolved: false, reason: 'not_authenticated' };
  }

  // 2. Capture localTs BEFORE any await — prevents saveS() race.
  const localTs = S._updatedAt || 0;
  const localNearEmpty = isStateNearEmpty(S);

  // 3. Fetch remote state.
  const remote = await fetchRemoteState();

  // ── Helpers (defined inline so they close over current scope) ──────────────

  // Build a stats object for the choice window comparison.
  const buildStats = (st) => ({
    _updatedAt: st._updatedAt || 0,
    vocab: (st.vocab || []).length,
    mistakes: (st.mistakes || []).length,
    totalMsgs: st.totalMsgs || 0,
    streak: (st.streak && st.streak.count) || 0,
    lifetimePts: st.lifetimePts || 0,
    readingCompleted: st.readingCompleted || 0,
    challengesCompleted: st.challengesCompleted || 0,
    level: st.level || 0
  });

  // Overwrite S fields from a source object, preserving local hist.
  // Iterates Object.keys(S) — not Object.keys(src) — so keys present in the
  // current S schema but missing from the remote (e.g. remote from an older
  // code version) are reset to undefined rather than silently preserving
  // stale local values.  undefined keys are dropped by JSON.stringify in
  // saveS(), and loadS() re-initialises them from defaults on the next load.
  const overwriteFromRemote = (src) => {
    const localHist = S.hist;
    for (const key of Object.keys(S)) {
      if (key === 'hist' || key === '_noState') continue;
      S[key] = (key in src) ? src[key] : undefined;
    }
    S.hist = localHist;
  };

  // ── 4. REMOTE_EMPTY (204 — no cloud state exists) ──────────────────────────
  if (remote === REMOTE_EMPTY) {
    if (localNearEmpty) {
      return { resolved: false, reason: 'both_empty' };
    }
    // Local has content — seed the cloud.
    await pushState();
    return { resolved: true, action: 'seeded' };
  }

  // ── 5. null (error / offline / 401) ───────────────────────────────────────
  if (remote === null) {
    if (localNearEmpty) {
      return { resolved: false, reason: 'offline_empty' };
    }
    // Local has content — best-effort push.
    const pr = await pushState();
    if (pr.ok) return { resolved: true, action: 'pushed' };
    return { resolved: false, reason: 'offline' };
  }

  // ── 6. Remote is a state object — compare with local ──────────────────────
  const remoteNearEmpty = isStateNearEmpty(remote);
  const remoteTs = remote._updatedAt || 0;

  // 6a. Local near-empty, remote has content → auto-download.
  if (localNearEmpty && !remoteNearEmpty) {
    overwriteFromRemote(remote);
    await saveS();
    await pushState();
    return { resolved: true, action: 'downloaded' };
  }

  // 6b. Remote near-empty, local has content → push to cloud.
  if (remoteNearEmpty && !localNearEmpty) {
    const pr = await pushState();
    if (pr.ok) return { resolved: true, action: 'pushed' };
    return { resolved: false, reason: 'offline' };
  }

  // 6c. Both near-empty → nothing to sync.
  if (localNearEmpty && remoteNearEmpty) {
    return { resolved: false, reason: 'both_empty' };
  }

  // 6d. Both have content, timestamps equal → in sync (push anyway to bump cloud ts).
  if (remoteTs === localTs) {
    await pushState();
    return { resolved: true, action: 'in_sync' };
  }

  // ── 6e. Both have content, timestamps differ → CHOICE WINDOW ───────────────
  // Mutable references updated on 409 retries so the next choice sees fresh data.
  let currentRemote = remote;
  let currentRemoteStats = buildStats(remote);

  // Dynamic import — sync-resolve.js only loaded when a conflict actually occurs.
  const { showChoiceWindow } = await import('./sync-resolve.js');

  // Outer loop: re-shown on 409 (Worker accepted another device's push).
  while (true) {
    const localStats = buildStats(S);
    const choice = await showChoiceWindow(localStats, currentRemoteStats);

    if (choice === 'remote') {
      overwriteFromRemote(currentRemote);
      await saveS();
      await pushState();
      return { resolved: true, action: 'user_chose_remote' };
    }

    // choice === 'local' — push local; inner loop handles retries on push failure.
    while (true) {
      const pr = await pushState();

      if (pr.ok) {
        return { resolved: true, action: 'user_chose_local' };
      }

      // 409 conflict — another device pushed while we were deciding.
      // Re-fetch remote, update stats, and break to outer loop to re-show.
      if (pr.conflict) {
        const newRemote = await fetchRemoteState();
        if (newRemote && newRemote !== REMOTE_EMPTY) {
          currentRemote = newRemote;
          currentRemoteStats = buildStats(newRemote);
        }
        break; // exit inner loop → outer loop re-shows choice window
      }

      // ── Non-409 push failure — show error + retry/proceed UI ────────────
      const wrap = document.getElementById('syncChoiceWrap');
      const splash = document.getElementById('splash');

      if (!wrap || !splash) {
        return { resolved: false, reason: 'offline' };
      }

      // Hide splash children so only the error message is visible.
      const hidden = [];
      for (const child of splash.children) {
        if (child !== wrap) {
          hidden.push({ el: child, prev: child.style.display });
          child.style.display = 'none';
        }
      }

      wrap.innerHTML = `
        <div class="sync-choice-wrap">
          <div class="sync-choice-title">${lang.ui.syncErrTitle}</div>
          <div class="sync-choice-subtitle">${lang.ui.syncErrSubtitle}</div>
          <div class="sync-choice-actions">
            <button class="sync-choice-btn sync-choice-btn--local" id="syncChoiceRetry">${lang.ui.syncErrRetry}</button>
            <button class="sync-choice-btn sync-choice-btn--remote" id="syncChoiceProceed">${lang.ui.syncErrProceed}</button>
          </div>
        </div>
      `;
      wrap.style.display = '';

      const retryBtn = document.getElementById('syncChoiceRetry');
      const proceedBtn = document.getElementById('syncChoiceProceed');
      const btns = [retryBtn, proceedBtn];
      retryBtn.focus();

      function onRetryKeydown(e) {
        if (e.key === 'Tab') {
          const idx = btns.indexOf(document.activeElement);
          if (e.shiftKey) {
            if (idx <= 0) { e.preventDefault(); btns[btns.length - 1].focus(); }
          } else {
            if (idx >= btns.length - 1 || idx === -1) { e.preventDefault(); btns[0].focus(); }
          }
        }
      }
      wrap.addEventListener('keydown', onRetryKeydown);

      const userAction = await new Promise((resolve) => {
        retryBtn.addEventListener('click', () => resolve('retry'));
        proceedBtn.addEventListener('click', () => resolve('proceed'));
      });

      // Clean up.
      wrap.removeEventListener('keydown', onRetryKeydown);
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      for (const { el, prev } of hidden) {
        el.style.display = prev;
      }

      if (userAction === 'retry') {
        continue; // retry pushState in inner loop
      }

      // userAction === 'proceed'
      return { resolved: false, reason: 'push_failed_proceed_anyway' };
    }
    // If we broke out of the inner loop via `break` (409), we loop back
    // to the outer while — re-fetched remote, re-show choice window.
  }
}
