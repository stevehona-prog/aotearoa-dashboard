// Shared Anthropic API plumbing for every Worker module that runs a
// two-call "research, then extract" flow against KV-backed digest data
// (Sports, News, ...). One copy of the model id, web_search tool
// definition, and fetch wrapper, so a fix or a model-id bump only has to
// happen once.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Verify this model id and the web_search tool type against
// platform.claude.com/docs before relying on this long-term — both can
// change. Confirmed current as of the Sports feature's implementation.
export const MODEL = 'claude-sonnet-5';
export const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 20 };

export async function callAnthropic(env, body) {
  var res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error('Anthropic API ' + res.status + ': ' + JSON.stringify(data));
  }
  return data;
}
