// Shared CORS helper for every Worker route the dashboard's browser
// frontend talks to. Access-Control-Allow-Origin must be an origin only
// (scheme+host+port) — never a path — or browsers reject the response.
// FRONTEND_URL itself keeps its /aotearoa-dashboard path (handleAuthCallback's
// redirect needs the full path), so every caller strips it down through this
// one helper instead of repeating `new URL(env.FRONTEND_URL).origin`
// independently — that repeated logic already shipped the same bug twice
// (see commit 0e92109) before this file existed.
export function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': new URL(env.FRONTEND_URL).origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Cache-Control': 'no-store'
  };
}
