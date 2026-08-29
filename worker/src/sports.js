// Sports digest: a Cron Trigger (see wrangler.toml's [triggers]) periodically
// calls Claude — with the web_search tool — to research a fixed roster of NZ
// teams/athletes, and writes ONE SLOT PER ENTITY into KV (never an
// accumulating list of "items"). Each run reads the current digest first and
// asks Claude to diff against it, so a "Fixture" becomes a "Result" by being
// overwritten in place, and lastChecked only moves when something actually
// changed — not every time the cron happens to fire.

const KV_KEY = 'sports_digest';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Verify this model id and the web_search tool type against
// platform.claude.com/docs before relying on this long-term — both can
// change. Confirmed current as of this feature's implementation.
const MODEL = 'claude-sonnet-5';
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 20 };

const TAG_VALUES = ['Result', 'Fixture', 'News', 'Team News', 'Pre-season'];

const ENTITIES = [
  { id: 'all_blacks',         section: 'rugby',   label: 'All Blacks' },
  { id: 'crusaders',          section: 'rugby',   label: 'Crusaders' },
  { id: 'canterbury',         section: 'rugby',   label: 'Canterbury', context: 'NZ NPC' },
  { id: 'reds',                section: 'rugby',   label: 'Queensland Reds', context: 'Super Rugby' },
  { id: 'black_ferns',        section: 'rugby',   label: 'Black Ferns' },
  { id: 'black_ferns_sevens', section: 'rugby',   label: 'Black Ferns Sevens' },
  { id: 'black_caps',         section: 'cricket', label: 'Black Caps' },
  { id: 'golf',                section: 'abroad',  label: 'Golf', context: 'Lydia Ko' },
  { id: 'athletics',          section: 'abroad',  label: 'Athletics', context: 'NZ athletes competing internationally' },
  { id: 'basketball',         section: 'abroad',  label: 'Basketball', context: 'NZ players/Tall Blacks abroad' },
  { id: 'motor_racing',       section: 'abroad',  label: 'Motor Racing', context: 'Liam Lawson' },
  { id: 'sailing',             section: 'abroad',  label: 'Sailing', context: "America's Cup / Emirates Team NZ" }
];

function entitySchema() {
  return {
    type: 'object',
    properties: {
      changed: {
        type: 'boolean',
        description: 'true only if you found materially new information beyond what the current digest below already shows for this entity; false if nothing has changed since it was last checked.'
      },
      tag: { type: 'string', enum: TAG_VALUES },
      line: {
        type: 'string',
        description: 'One sentence, present tense, matching the existing dashboard style (e.g. "Opened NPC campaign, beat Tasman 28-17 at home"). If changed is false, repeat the current line unchanged.'
      },
      eventDate: {
        type: 'string',
        description: 'ISO date (YYYY-MM-DD) of the real-world event this line describes. If changed is false, repeat the current eventDate unchanged.'
      }
    },
    required: ['changed', 'tag', 'line', 'eventDate'],
    additionalProperties: false
  };
}

function buildToolSchema() {
  var properties = {};
  ENTITIES.forEach(function (e) { properties[e.id] = entitySchema(); });
  return {
    name: 'update_sports_digest',
    description: 'Report the current status of all 12 tracked NZ sports entities, diffed against the current digest supplied in the prompt.',
    input_schema: {
      type: 'object',
      properties: properties,
      required: ENTITIES.map(function (e) { return e.id; }),
      additionalProperties: false
    }
  };
}

function describeCurrent(current) {
  if (!current || !current.entities) {
    return 'No digest exists yet — treat every entity as new; research each one fresh.';
  }
  var lines = ENTITIES.map(function (e) {
    var slot = current.entities[e.id];
    if (!slot) return '- ' + e.label + ': (no prior data)';
    return '- ' + e.label + ' [' + e.id + ']: "' + slot.line + '" (tag: ' + slot.tag + ', eventDate: ' + slot.eventDate + ', last confirmed: ' + slot.lastChecked + ')';
  });
  return 'Current digest (what the dashboard shows right now):\n' + lines.join('\n');
}

function buildResearchPrompt(current) {
  var roster = ENTITIES.map(function (e) {
    return '- ' + e.label + ' [' + e.id + ']' + (e.context ? ' — ' + e.context : '') + ' (section: ' + e.section + ')';
  }).join('\n');

  return (
    'You are researching the latest status of a fixed list of New Zealand sports ' +
    'teams and athletes for a personal dashboard. For each entity below, use web ' +
    'search to find its single most newsworthy current item — a result, an ' +
    'upcoming fixture, a squad/team news item, or a pre-season note — one sentence ' +
    'each, matching the tag vocabulary Result / Fixture / News / Team News / ' +
    'Pre-season.\n\n' +
    'Entities to research:\n' + roster + '\n\n' +
    describeCurrent(current) + '\n\n' +
    'For each entity, decide whether what you found is materially newer than what ' +
    'is currently shown (e.g. a Fixture that has since been played becomes a ' +
    'Result; a Team News item is superseded by a newer one). If you find nothing ' +
    'materially different from the current digest, say so explicitly rather than ' +
    'restating the same fact as if it were new. Summarize your findings in prose ' +
    'for each entity before you finish — you will be asked to submit a structured ' +
    'result afterward.'
  );
}

async function callAnthropic(env, body) {
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

function validateDigest(digest) {
  if (!digest || typeof digest !== 'object' || !digest.entities) {
    throw new Error('digest missing entities object');
  }
  var ids = ENTITIES.map(function (e) { return e.id; });
  var keys = Object.keys(digest.entities);
  if (keys.length !== ids.length || ids.some(function (id) { return !digest.entities[id]; })) {
    throw new Error('digest entities do not match the expected 12 slots');
  }
  for (var i = 0; i < ids.length; i++) {
    var slot = digest.entities[ids[i]];
    if (
      typeof slot.label !== 'string' || !slot.label ||
      typeof slot.section !== 'string' ||
      TAG_VALUES.indexOf(slot.tag) === -1 ||
      typeof slot.line !== 'string' || !slot.line ||
      typeof slot.eventDate !== 'string' ||
      typeof slot.lastChecked !== 'string'
    ) {
      throw new Error('digest slot "' + ids[i] + '" has an invalid shape');
    }
  }
}

function applyDiff(current, modelOutput, nowIso) {
  var entities = {};
  ENTITIES.forEach(function (e) {
    var proposed = modelOutput[e.id];
    var priorSlot = current && current.entities && current.entities[e.id];
    if (!proposed && !priorSlot) {
      throw new Error('model output missing entity "' + e.id + '" and no prior data to fall back on');
    }
    if (proposed && proposed.changed) {
      entities[e.id] = {
        section: e.section,
        label: e.label,
        tag: proposed.tag,
        line: proposed.line,
        eventDate: proposed.eventDate,
        lastChecked: nowIso
      };
    } else if (priorSlot) {
      entities[e.id] = priorSlot; // untouched — lastChecked does NOT move
    } else {
      // First run: nothing to carry forward even though the model marked
      // it unchanged (unlikely with no prior context, but handle it).
      entities[e.id] = {
        section: e.section,
        label: e.label,
        tag: proposed.tag,
        line: proposed.line,
        eventDate: proposed.eventDate,
        lastChecked: nowIso
      };
    }
  });
  return { updatedAt: nowIso, entities: entities };
}

async function runSportsDigest(env) {
  var raw = await env.AUTH_KV.get(KV_KEY);
  var current = null;
  if (raw) {
    try { current = JSON.parse(raw); } catch (e) { current = null; }
  }

  var researchMessages = [{ role: 'user', content: buildResearchPrompt(current) }];
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
      content: 'Now call update_sports_digest with the final result for all 12 entities, based on your research above.'
    }
  ]);
  var extractRes = await callAnthropic(env, {
    model: MODEL,
    max_tokens: 4096,
    tools: [buildToolSchema()],
    tool_choice: { type: 'tool', name: 'update_sports_digest' },
    messages: extractMessages
  });

  var toolUse = (extractRes.content || []).filter(function (b) {
    return b.type === 'tool_use' && b.name === 'update_sports_digest';
  })[0];
  if (!toolUse) throw new Error('extraction response had no update_sports_digest tool_use block');

  var nowIso = new Date().toISOString();
  var next = applyDiff(current, toolUse.input, nowIso);
  validateDigest(next);

  // Only reachable once validation passed — a failed/malformed run never
  // reaches this line, so KV is never overwritten with broken data.
  await env.AUTH_KV.put(KV_KEY, JSON.stringify(next));
  return next;
}

function corsHeadersFor(env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_URL,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Cache-Control': 'no-store'
  };
}

async function handleSportsData(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeadersFor(env) });
  }
  var raw = await env.AUTH_KV.get(KV_KEY);
  var headers = Object.assign({}, corsHeadersFor(env), { 'Content-Type': 'application/json' });
  if (!raw) {
    return new Response(JSON.stringify({ error: 'not_generated_yet' }), { status: 404, headers: headers });
  }
  return new Response(raw, { status: 200, headers: headers });
}

async function handleSportsRun(request, env) {
  var headers = corsHeadersFor(env);
  var authHeader = request.headers.get('Authorization') || '';
  var presented = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  if (!env.SPORTS_RUN_SECRET || presented !== env.SPORTS_RUN_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: headers });
  }
  try {
    var digest = await runSportsDigest(env);
    return new Response(JSON.stringify({ ok: true, digest: digest }), {
      status: 200,
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' })
    });
  } catch (err) {
    console.error('Manual sports digest run failed:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: headers });
  }
}

export { runSportsDigest, handleSportsData, handleSportsRun };
