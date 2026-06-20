// ── SYNC ────────────────────────────────────────────────────────────────────
// Frontend sync: fetch/push/merge remote state with last-write-wins.
// Imports from auth.js (getToken, isAuthenticated, signOut, WORKER_URL) and
// state.js (S, saveS).  No side effects on import — all exports are functions
// except isOnline and lastSyncError which are live module-level variables.
import { getToken, isAuthenticated, signOut, WORKER_URL } from './auth.js';
import { S, saveS } from './state.js';

// ── Module state (no side effects) ───────────────────────────────────────────
export let lastSyncError = null;

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
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Push local state to the cloud (PUT /state).
// Excludes S.hist from the request body (conversation history is never synced).
// Returns true on successful PUT, false otherwise.
// On 401 the auth token is cleared via signOut().
// Network errors are caught silently — lastSyncError is set, no user-visible error.
export async function pushState() {
  if (!(await isAuthenticated())) return false;
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
    if (res.status === 401) { signOut(); return false; }
    if (!res.ok) {
      lastSyncError = 'PUT /state returned ' + res.status;
      return false;
    }
    lastSyncError = null;
    return true;
  } catch (e) {
    lastSyncError = e.message || 'Network error';
    return false;
  }
}

// Merge local and remote state using last-write-wins (document-level _updatedAt).
//
// Rules:
//  - Remote newer  → overwrite local S fields (keep hist), save, set conflict.
//  - Local newer   → push local to remote.
//  - No remote     → push local to seed the cloud (first-time setup).
//  - Offline/error → fetchRemoteState returns null, we attempt push (may fail silently).
export async function mergeAndSync() {
  // Capture local timestamp BEFORE the async fetch — saveS() can fire during
  // the await and bump S._updatedAt, making local falsely appear "newer".
  const localTs = S._updatedAt || 0;
  const remote = await fetchRemoteState();

  if (!remote) {
    await pushState();
    return;
  }

  const remoteTs = (remote && remote._updatedAt) ? remote._updatedAt : 0;

  if (remoteTs > localTs) {
    _conflictFlag = true;
    const localHist = S.hist;
    for (const key of Object.keys(remote)) {
      if (key === 'hist') continue;
      S[key] = remote[key];
    }
    S.hist = localHist;
    await saveS();
  } else {
    await pushState();
  }
}
