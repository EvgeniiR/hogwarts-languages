// ── AUTH ────────────────────────────────────────────────────────────────────
// Google OAuth sign-in, session token persistence, sign-out.
// Token stored in localStorage key `hp_auth` via kvGet/kvSet from storage.js.
//
// Parallel architecture:
// 1. initOneTap(onSuccess) — fires One Tap passively on page load (zero-friction
//    for Chrome users with a Google session). Silently fails otherwise.
// 2. signInWithGoogle() — the button onclick handler. Opens an OAuth2 popup
//    (initCodeClient) that works everywhere: Chrome, Incognito, mobile,
//    Firefox, Safari. No browser-level Google session required.
import { kvGet, kvSet } from './storage.js';
import lang from './lang.js';

export const WORKER_URL = 'https://hogwarts-espanol-sync.evgromr1.workers.dev';
export const GOOGLE_CLIENT_ID = '736271097412-5c63gsnmk9uf75gjar6061qkvd1t1lja.apps.googleusercontent.com';

let _token = null;

// Decode JWT payload (base64 middle part). Returns parsed object or null.
function _decodePayload(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch (e) {
    return null;
  }
}

// Shared POST helper
function _post(path, body) { return fetch(WORKER_URL + path, {
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
});}

// ── Public API ──────────────────────────────────────────────────────────────

// Passive One Tap — fires on page load, detached from any button click.
// On success: exchanges credential for app JWT and calls onSuccess().
// On failure: silent (no error, no user feedback — the button is visible).
export function initOneTap(onSuccess) {
  if (!window.google?.accounts?.id) return;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    use_fedcm: false,
    callback: async (response) => {
      if (!response?.credential) return;
      const result = await _exchangeCredential(response.credential);
      if (result.ok && onSuccess) onSuccess();
    },
  });

  // Fire-and-forget — no notification callback. FedCM/dismissals are handled
  // by the browser natively. If it works, great. If not, the button is there.
  google.accounts.id.prompt();
}

// Button onclick handler — opens OAuth2 popup (initCodeClient).
// Works everywhere: Chrome, Incognito, mobile, Firefox, Safari.
// Returns {ok:true, token} on success or {ok:false, error:'...'} on failure.
export async function signInWithGoogle() {
  try {
    const code = await _signInOAuth2Code();
    return await _exchangeCode(code);
  } catch (e) {
    const msg = e && e.message ? e.message : '';
    if (msg === 'USER_CANCELLED') return { ok: false, error: lang.ui.signInCancelled };
    if (msg === 'POPUP_BLOCKED') return { ok: false, error: lang.ui.popupBlocked };
    return { ok: false, error: lang.ui.offline };
  }
}

// Returns stored JWT string or null. Caches in _token.
export async function getToken() {
  if (_token) return _token;
  try {
    const stored = await kvGet('hp_auth');
    if (!stored || typeof stored !== 'string') return null;
    const parts = stored.split('.');
    if (parts.length !== 3) {
      await kvSet('hp_auth', null);
      return null;
    }
    _token = stored;
    return _token;
  } catch (e) {
    return null;
  }
}

// True if a valid non-expired token exists. Client-side check only.
export async function isAuthenticated() {
  const token = await getToken();
  if (!token) return false;
  const payload = _decodePayload(token);
  if (!payload || !payload.exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp > now;
}

// Removes the stored token. Does NOT clear hp_v1 or hp_creds.
export function signOut() {
  _token = null;
  try { localStorage.removeItem('hp_auth'); } catch (e) {}
}

// Returns the email from the JWT `sub` claim, or null if not authenticated.
export async function getUserEmail() {
  const token = await getToken();
  if (!token) return null;
  const payload = _decodePayload(token);
  if (!payload) return null;
  return payload.sub || null;
}

// ── Private helpers ────────────────────────────────────────────────────────

// Exchange a Google ID token (credential) for an app JWT via the worker.
async function _exchangeCredential(credential) {
  const res = await _post('/auth/google', { credential });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || lang.ui.serverError };
  }
  const data = await res.json();
  if (!data.token) return { ok: false, error: lang.ui.tokenNotReceived };
  await kvSet('hp_auth', data.token);
  _token = data.token;
  return { ok: true, token: data.token };
}

// Exchange an OAuth2 authorization code for an app JWT via the worker.
async function _exchangeCode(code) {
  const res = await _post('/auth/google/code', { code });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || lang.ui.serverError };
  }
  const data = await res.json();
  if (!data.token) return { ok: false, error: lang.ui.tokenNotReceived };
  await kvSet('hp_auth', data.token);
  _token = data.token;
  return { ok: true, token: data.token };
}

// Open the OAuth2 authorization code popup (initCodeClient).
// Returns the authorization code on success. Rejects on cancel/error.
function _signInOAuth2Code() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('SERVICE_UNAVAILABLE'));
      return;
    }
    const client = google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      ux_mode: 'popup',
      callback: (response) => {
        if (response.code) {
          resolve(response.code);
        } else {
          // access_denied or popup closed
          reject(new Error('USER_CANCELLED'));
        }
      },
      error_callback: (error) => {
        if (error && error.type === 'popup_blocked') {
          reject(new Error('POPUP_BLOCKED'));
        } else {
          reject(new Error('USER_CANCELLED'));
        }
      },
    });
    client.requestCode();
  });
}
