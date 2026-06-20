// ─── Hogwarts Español — Cloudflare Worker Backend ──────────────────────────────
// Handles: Google OAuth (POST /auth/google) + state sync (GET/PUT /state via KV).
// Zero external dependencies — pure JS with Web Crypto + Cloudflare Workers APIs.
//
// Endpoints:
//   OPTIONS *              → CORS preflight
//   POST   /auth/google    → verify Google ID token (JWKS), issue app JWT
//   GET    /state          → fetch user state
//   PUT    /state          → store user state (max 500 KB)

// ── Constants ──────────────────────────────────────────────────────────────────
const JWT_EXPIRY = 30 * 24 * 3600; // 30 days (seconds)
const MAX_STATE_SIZE = 500000;     // 500 KB
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

// ── JWKS cache (module-level — persists across requests within the isolate) ────
const jwksCache = { jwks: null };

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Base64url encode (no padding, URL-safe characters). */
function base64url(buf) {
  const str = typeof buf === 'string' ? buf : String.fromCharCode(...new Uint8Array(buf));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Base64url decode (adds padding back, replaces URL-safe chars). */
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

/** Create a JWT signed with HMAC-SHA256. */
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = headerB64 + '.' + payloadB64;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + base64url(sig);
}

/** Verify a JWT; returns the decoded payload or null. */
async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const data = headerB64 + '.' + payloadB64;

    // Decode signature bytes
    const sigStr = base64urlDecode(sigB64);
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) sigBytes[i] = sigStr.charCodeAt(i);

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
    if (!valid) return null;

    const payload = JSON.parse(base64urlDecode(payloadB64));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch (_) {
    return null;
  }
}

/** Extract Bearer token from Authorization header. */
function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Build a JSON response with CORS headers. */
function jsonResponse(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/** Build an empty response (for OPTIONS, 204, etc.) with CORS headers. */
function emptyResponse(status, origin) {
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  return new Response(null, { status, headers });
}

// ── Google Token Verification ──────────────────────────────────────────────────

/** Fetch Google's public JWKS (cached module-level). */
async function fetchGoogleJWKS() {
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error('Failed to fetch Google JWKS: ' + res.status);
  return await res.json();
}

/**
 * Verify a Google ID token (RS256-signed JWT) against Google's JWKS.
 * Returns the decoded payload on success, null on any failure.
 */
async function verifyGoogleToken(token, clientId) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode header to get algorithm and key ID
    const header = JSON.parse(base64urlDecode(parts[0]));
    if (!header.kid || header.alg !== 'RS256') return null;

    // Fetch JWKS if not cached
    if (!jwksCache.jwks) {
      jwksCache.jwks = await fetchGoogleJWKS();
    }

    // Find matching key
    let key = jwksCache.jwks.keys.find(k => k.kid === header.kid);
    if (!key) {
      // Key rotation: re-fetch and try again
      jwksCache.jwks = await fetchGoogleJWKS();
      key = jwksCache.jwks.keys.find(k => k.kid === header.kid);
      if (!key) return null;
    }

    // Import the RSA public key
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: key.kty,
        n: key.n,
        e: key.e,
        alg: key.alg || 'RS256',
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Verify the signature
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const sigStr = base64urlDecode(parts[2]);
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) sigBytes[i] = sigStr.charCodeAt(i);

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, data);
    if (!valid) return null;

    // Verify claims
    const payload = JSON.parse(base64urlDecode(parts[1]));

    // Issuer must be Google
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return null;

    // Audience must match our client ID (aud can be a string or array)
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(clientId)) return null;

    // Must not be expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch (_) {
    return null;
  }
}

// ── Route Handlers ─────────────────────────────────────────────────────────────

/** POST /auth/google — verify Google ID token and issue an app JWT. */
async function handleAuthGoogle(request, env) {
  const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Cuerpo JSON inválido' }, 400, origin);
  }

  const credential = (body.credential || '').trim();
  if (!credential) {
    return jsonResponse({ error: 'Token de Google requerido' }, 400, origin);
  }

  // Verify Google token
  const payload = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
  if (!payload) {
    return jsonResponse({ error: 'Token de Google inválido o expirado' }, 401, origin);
  }

  // Extract email
  const email = payload.email;
  if (!email) {
    return jsonResponse({ error: 'Token de Google no contiene email' }, 401, origin);
  }

  // Issue app JWT
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    sub: email,
    iat: now,
    exp: now + JWT_EXPIRY,
  };
  const token = await createJWT(jwtPayload, env.JWT_SECRET);

  return jsonResponse({ token }, 200, origin);
}

/** POST /auth/google/code — exchange OAuth2 authorization code for ID token, then issue app JWT. */
async function handleAuthGoogleCode(request, env) {
  const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Cuerpo JSON inválido' }, 400, origin);
  }

  const code = (body.code || '').trim();
  if (!code) {
    return jsonResponse({ error: 'Código de autorización requerido' }, 400, origin);
  }

  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('GOOGLE_CLIENT_SECRET not configured');
    return jsonResponse({ error: 'Error de configuración del servidor' }, 500, origin);
  }

  // Exchange authorization code for tokens via Google's token endpoint.
  let idToken;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: clientSecret,
        redirect_uri: 'postmessage',
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      console.error('Google token exchange failed:', tokenRes.status, errText);
      return jsonResponse({ error: 'Código de autorización inválido o expirado' }, 401, origin);
    }

    const tokenData = await tokenRes.json();
    idToken = tokenData.id_token;
    if (!idToken) {
      console.error('Google token exchange: no id_token in response');
      return jsonResponse({ error: 'No se pudo verificar la identidad con Google' }, 401, origin);
    }
  } catch (e) {
    console.error('Google token exchange error:', e.message);
    return jsonResponse({ error: 'Error al conectar con Google' }, 502, origin);
  }

  // Verify the ID token (reuse existing verification).
  const payload = await verifyGoogleToken(idToken, env.GOOGLE_CLIENT_ID);
  if (!payload) {
    return jsonResponse({ error: 'Token de Google inválido o expirado' }, 401, origin);
  }

  const email = payload.email;
  if (!email) {
    return jsonResponse({ error: 'Token de Google no contiene email' }, 401, origin);
  }

  // Issue app JWT
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    sub: email,
    iat: now,
    exp: now + JWT_EXPIRY,
  };
  const token = await createJWT(jwtPayload, env.JWT_SECRET);

  return jsonResponse({ token }, 200, origin);
}

/** GET /state — fetch user state from KV. */
async function handleGetState(request, env) {
  const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

  // Verify JWT
  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'Token requerido' }, 401, origin);
  }

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: 'Token inválido o expirado' }, 401, origin);
  }

  // Read state from KV
  const email = payload.sub;
  const stateJson = await env.HOGWARTS_KV.get('state:' + email);

  if (stateJson === null || stateJson === undefined) {
    return emptyResponse(204, origin);
  }

  return new Response(stateJson, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}

/** PUT /state — store user state in KV. */
async function handlePutState(request, env) {
  const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

  // Verify JWT
  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'Token requerido' }, 401, origin);
  }

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: 'Token inválido o expirado' }, 401, origin);
  }

  // Check content-length before reading body
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_STATE_SIZE) {
    return jsonResponse({ error: 'Estado demasiado grande (máx. 500 KB)' }, 413, origin);
  }

  // Read body as text (limit to MAX_STATE_SIZE + buffer)
  let bodyText;
  try {
    bodyText = await request.text();
  } catch (_) {
    return jsonResponse({ error: 'Error al leer el cuerpo de la solicitud' }, 400, origin);
  }

  // Size check on actual body
  if (bodyText.length > MAX_STATE_SIZE) {
    return jsonResponse({ error: 'Estado demasiado grande (máx. 500 KB)' }, 413, origin);
  }

  // Validate JSON
  try {
    JSON.parse(bodyText);
  } catch (_) {
    return jsonResponse({ error: 'Cuerpo JSON inválido' }, 400, origin);
  }

  // Store in KV
  const email = payload.sub;
  await env.HOGWARTS_KV.put('state:' + email, bodyText);

  return jsonResponse({ ok: true }, 200, origin);
}

// ── Entry Point ────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const origin = request.headers.get('Origin') || '';

    // ── CORS preflight (OPTIONS) ────────────────────────────────────────────
    if (method === 'OPTIONS') {
      // Allow requests from the configured origin only
      if (origin && origin !== env.ALLOWED_ORIGIN) {
        // In dev, also allow localhost origins
        const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
        if (!isLocal) {
          return jsonResponse({ error: 'Origen no permitido' }, 403, env.ALLOWED_ORIGIN);
        }
      }
      return emptyResponse(204, origin || env.ALLOWED_ORIGIN);
    }

    // ── Route matching ──────────────────────────────────────────────────────
    try {
      if (method === 'POST' && path === '/auth/google') {
        return await handleAuthGoogle(request, env);
      }

      if (method === 'POST' && path === '/auth/google/code') {
        return await handleAuthGoogleCode(request, env);
      }

      if (method === 'GET' && path === '/state') {
        return await handleGetState(request, env);
      }

      if (method === 'PUT' && path === '/state') {
        return await handlePutState(request, env);
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Ruta no encontrada' }, 404, origin || env.ALLOWED_ORIGIN);
    } catch (e) {
      console.error('Unhandled error:', e.message);
      return jsonResponse({ error: 'Error interno del servidor' }, 500, origin || env.ALLOWED_ORIGIN);
    }
  },
};
