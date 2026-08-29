// News digest: a Cron Trigger (see wrangler.toml's [triggers], shared with
// Sports) periodically calls Claude — with the web_search tool — to find
// NZ's current top 3-5 news stories aggregated across multiple outlets,
// and writes ONE LIST into KV (overwritten wholesale every run, never
// merged with the prior run).
//
// Unlike Sports, there's no fixed roster to diff against — "today's top
// NZ stories" has no stable per-story identity from one cron firing to
// the next, so there's nothing to carry forward or protect from a false
// "changed" reset. Each run is a fresh, self-contained snapshot;
// staleness is controlled by a hard 48-hour publishedAt filter applied
// here in the worker (never just prompted into the model), matching the
// "no older than 2 days" requirement.

import { MODEL, WEB_SEARCH_TOOL, callAnthropic } from './anthropic.js';
import { corsHeaders } from './cors.js';

const KV_KEY = 'news_digest';
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // spec: nothing older than 2 days
const MAX_ARTICLES = 5;

function articleSchema() {
  return {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'The story headline, as reported — not a summary or rewrite.' },
      source: { type: 'string', description: 'The outlet name, e.g. "NZ Herald", "RNZ", "Stuff".' },
      url: { type: 'string', description: 'A direct URL to the article, from your web search results.' },
      publishedAt: {
        type: 'string',
        description: "ISO 8601 date or datetime the story was actually published or last updated, per its source — not today's date unless that is genuinely when it published."
      }
    },
    required: ['headline', 'source', 'url', 'publishedAt'],
    additionalProperties: false
  };
}

function buildToolSchema() {
  return {
    name: 'update_news_digest',
    description: 'Report the current top NZ news stories found by the research above, one entry per story.',
    input_schema: {
      type: 'object',
      properties: {
        // minItems/maxItems are hints to the model, not a hard guarantee —
        // the worker's own filter+slice below is the real enforcement.
        articles: { type: 'array', items: articleSchema(), minItems: 1, maxItems: MAX_ARTICLES }
      },
      required: ['articles'],
      additionalProperties: false
    }
  };
}

function buildResearchPrompt(nowIso) {
  return (
    "You are researching today's top New Zealand news stories for a personal " +
    'dashboard. Find 3 to 5 of the most significant current NZ stories, drawn ' +
    'from multiple different reputable NZ outlets — aggregate into one ' +
    "consistent feed rather than reporting a single outlet's front page.\n\n" +
    'The current date/time is ' + nowIso + '. Only include stories genuinely ' +
    'published or updated within the last 48 hours — check each story\'s real ' +
    'publish date/time before including it, and discard anything older even if ' +
    'it still looks prominent on a homepage.\n\n' +
    'For each story, note: the exact headline, the outlet name, a direct source ' +
    'URL, and the real publish date/time (ISO 8601). Summarize your findings in ' +
    'prose for each story before you finish — you will be asked to submit a ' +
    'structured result afterward.'
  );
}

function withinLast48h(publishedAt, nowMs) {
  var t = Date.parse(publishedAt);
  if (isNaN(t)) return false;
  var age = nowMs - t;
  return age >= 0 && age <= MAX_AGE_MS; // also rejects future-dated stories
}

function validateDigest(digest) {
  if (!digest || typeof digest !== 'object' || !Array.isArray(digest.articles)) {
    throw new Error('digest missing articles array');
  }
  if (digest.articles.length === 0) {
    throw new Error('digest has zero articles');
  }
  digest.articles.forEach(function (a, i) {
    if (
      typeof a.headline !== 'string' || !a.headline ||
      typeof a.source !== 'string' || !a.source ||
      typeof a.publishedAt !== 'string' || !a.publishedAt ||
      typeof a.url !== 'string'
    ) {
      throw new Error('digest article at index ' + i + ' has an invalid shape');
    }
  });
}

async function runNewsDigest(env) {
  var nowIso = new Date().toISOString();
  var nowMs = Date.now();

  var researchMessages = [{ role: 'user', content: buildResearchPrompt(nowIso) }];
  var researchRes = await callAnthropic(env, {
    model: MODEL,
    max_tokens: 8000,
    tools: [WEB_SEARCH_TOOL],
    messages: researchMessages
  });
  if (researchRes.stop_reason === 'refusal') {
    throw new Error('research call was refused');
  }

  var extractMessages = researchMessages.concat([
    { role: 'assistant', content: researchRes.content },
    {
      role: 'user',
      content: 'Now call update_news_digest with the final list of 3-5 qualifying stories from your research above.'
    }
  ]);
  var extractRes = await callAnthropic(env, {
    model: MODEL,
    max_tokens: 4096,
    tools: [buildToolSchema()],
    tool_choice: { type: 'tool', name: 'update_news_digest' },
    messages: extractMessages
  });

  var toolUse = (extractRes.content || []).filter(function (b) {
    return b.type === 'tool_use' && b.name === 'update_news_digest';
  })[0];
  if (!toolUse) throw new Error('extraction response had no update_news_digest tool_use block');

  var survivors = (toolUse.input.articles || [])
    .filter(function (a) { return withinLast48h(a.publishedAt, nowMs); })
    .sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); })
    .slice(0, MAX_ARTICLES);

  // Fewer than 3 surviving the 48h filter is an accepted edge case — write
  // whatever's real rather than fail the whole run. Zero is not: that means
  // the model returned nothing genuinely fresh, so leave KV untouched.
  if (survivors.length === 0) {
    throw new Error('no articles survived the 48-hour freshness filter');
  }

  var next = { updatedAt: nowIso, articles: survivors };
  validateDigest(next);

  await env.AUTH_KV.put(KV_KEY, JSON.stringify(next));
  return next;
}

async function handleNewsData(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }
  var raw = await env.AUTH_KV.get(KV_KEY);
  var headers = Object.assign({}, corsHeaders(env), { 'Content-Type': 'application/json' });
  if (!raw) {
    return new Response(JSON.stringify({ error: 'not_generated_yet' }), { status: 404, headers: headers });
  }
  return new Response(raw, { status: 200, headers: headers });
}

async function handleNewsRun(request, env) {
  var headers = corsHeaders(env);
  var authHeader = request.headers.get('Authorization') || '';
  var presented = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  if (!env.NEWS_RUN_SECRET || presented !== env.NEWS_RUN_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: headers });
  }
  try {
    var digest = await runNewsDigest(env);
    return new Response(JSON.stringify({ ok: true, digest: digest }), {
      status: 200,
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' })
    });
  } catch (err) {
    console.error('Manual news digest run failed:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: headers });
  }
}

export { runNewsDigest, handleNewsData, handleNewsRun };
