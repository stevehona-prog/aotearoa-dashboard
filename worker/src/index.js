// Cloudflare Worker: silent Google token renewal for the Aotearoa Dashboard.
//
// Holds a real OAuth refresh token server-side (something the dashboard's
// browser-only implicit flow can never get) so the frontend can renew its
// access token without a popup, up to Google's Testing-mode 7-day ceiling.
//
// Routes:
//   GET /auth/start     — redirect to Google's consent screen (PKCE)
//   GET /auth/callback  — exchange code for tokens, hand off to the frontend
//   GET /token          — mint a fresh access token from the stored refresh token
//
// Must match the scope string the frontend requests in index.html's
// GOOGLE_SCOPE constant — keep these in sync if that ever changes.
const SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest('SHA-256', data);
}

async function sha256Base64Url(input) {
  return base64UrlEncode(new Uint8Array(await sha256(input)));
}

async function sha256Hex(input) {
  const bytes = new Uint8Array(await sha256(input));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Each device gets its own dashboard_token, stored as a distinct KV key
// (dashboard_token:<hash-of-the-token>) rather than a single shared slot —
// otherwise connecting on a second device silently invalidates the first's
// cached credential. All devices still share the one Google refresh token
// below, since they're all acting as the same Google account.
const DASHBOARD_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function redirectUriFor(requestUrl) {
  return new URL('/auth/callback', requestUrl).toString();
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_URL,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Cache-Control': 'no-store'
  };
}

async function handleAuthStart(request, env) {
  const state = randomToken(16);
  const codeVerifier = randomToken(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  await env.AUTH_KV.put(`pkce:${state}`, codeVerifier, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(request.url),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return Response.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return new Response(`Google sign-in was cancelled or failed: ${errorParam}`, { status: 400 });
  }
  if (!code || !state) {
    return new Response('Missing code or state.', { status: 400 });
  }

  const pkceKey = `pkce:${state}`;
  const codeVerifier = await env.AUTH_KV.get(pkceKey);
  if (!codeVerifier) {
    return new Response('This sign-in link expired or was already used — go back and click Connect again.', { status: 400 });
  }
  await env.AUTH_KV.delete(pkceKey);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUriFor(request.url),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error('Google token exchange failed:', tokenData);
    return new Response('Google sign-in failed during token exchange — see Worker logs.', { status: 502 });
  }

  if (tokenData.refresh_token) {
    await env.AUTH_KV.put('google_refresh_token', tokenData.refresh_token);
  }

  const dashboardToken = randomToken(32);
  const dashboardTokenHash = await sha256Hex(dashboardToken);
  await env.AUTH_KV.put(`dashboard_token:${dashboardTokenHash}`, '1', { expirationTtl: DASHBOARD_TOKEN_TTL_SECONDS });

  const fragment = new URLSearchParams({
    dtoken: dashboardToken,
    access_token: tokenData.access_token,
    expires_in: String(tokenData.expires_in || 3600),
    scope: tokenData.scope || SCOPE,
    linked: '1'
  });

  return Response.redirect(`${env.FRONTEND_URL}#${fragment.toString()}`, 302);
}

async function handleToken(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  const headers = corsHeaders(env);
  const authHeader = request.headers.get('Authorization') || '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!presented) {
    return new Response(JSON.stringify({ error: 'missing_token' }), { status: 401, headers });
  }

  const presentedHash = await sha256Hex(presented);
  const known = await env.AUTH_KV.get(`dashboard_token:${presentedHash}`);
  if (!known) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers });
  }
  // Sliding expiry: touching a device's token on every successful use keeps
  // it alive past the 30-day TTL as long as it's actually being used.
  await env.AUTH_KV.put(`dashboard_token:${presentedHash}`, '1', { expirationTtl: DASHBOARD_TOKEN_TTL_SECONDS });

  const refreshToken = await env.AUTH_KV.get('google_refresh_token');
  if (!refreshToken) {
    return new Response(JSON.stringify({ error: 'not_linked' }), { status: 409, headers });
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    // Refresh token itself expired/revoked (Testing-mode 7-day ceiling) —
    // clear it so future calls fail fast with not_linked instead of
    // repeatedly retrying a dead refresh token against Google.
    console.error('Google refresh failed:', tokenData);
    await env.AUTH_KV.delete('google_refresh_token');
    return new Response(JSON.stringify({ error: 'refresh_expired' }), { status: 401, headers });
  }

  return new Response(JSON.stringify({
    access_token: tokenData.access_token,
    expires_in: tokenData.expires_in,
    scope: tokenData.scope || SCOPE,
    token_type: tokenData.token_type || 'Bearer'
  }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/auth/start') return handleAuthStart(request, env);
    if (pathname === '/auth/callback') return handleAuthCallback(request, env);
    if (pathname === '/token') return handleToken(request, env);

    return new Response('Not found', { status: 404 });
  }
};
