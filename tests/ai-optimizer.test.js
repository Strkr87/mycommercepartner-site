const test = require('node:test');
const assert = require('node:assert/strict');

const { generateAiListing, normalizeAiListing, buildMessages } = require('../api/_lib/ai-optimizer');

const listing = {
  marketplace: 'eBay',
  title: 'apple iphone 13 128gb unlocked',
  brand: 'Apple',
  category: 'Cell Phones & Smartphones',
  condition: 'Used - Good',
  specifics: 'Model: iPhone 13\nStorage Capacity: 128 GB\nNetwork: Unlocked\nColor: Midnight',
  shipping: 'Free 3-day shipping, 30-day returns'
};

const aiPayload = {
  title: 'Apple iPhone 13 128GB Unlocked Midnight Smartphone - Good Condition',
  bullets: ['- Unlocked for use on any carrier', '2. 128GB storage for apps and photos', 'Midnight color'],
  description: 'Apple iPhone 13 with 128GB of storage, unlocked.\n\nUsed in good condition.\n\nShips free in 3 days with 30-day returns.',
  actions: ['Add battery health percentage to item specifics.', 'Photograph the screen powered on.']
};

function mockFetch(content, { ok = true, capture } = {}) {
  return async (url, init) => {
    if (capture) capture.push({ url, init });
    return {
      ok,
      json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] })
    };
  };
}

test('generateAiListing returns null without an API key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await generateAiListing(listing, {}), null);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test('generateAiListing sends a strict JSON schema request and normalizes output', async () => {
  const calls = [];
  const result = await generateAiListing(listing, { title: 'draft' }, {
    apiKey: 'sk-test',
    model: 'test-model',
    fetchImpl: mockFetch(aiPayload, { capture: calls })
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);

  assert.equal(result.title, aiPayload.title);
  assert.deepEqual(result.bullets, ['Unlocked for use on any carrier', '128GB storage for apps and photos', 'Midnight color']);
  assert.equal(result.actions.length, 2);
});

test('generateAiListing falls back to null on HTTP errors or bad JSON', async () => {
  assert.equal(await generateAiListing(listing, {}, { apiKey: 'k', fetchImpl: mockFetch(aiPayload, { ok: false }) }), null);
  assert.equal(await generateAiListing(listing, {}, { apiKey: 'k', fetchImpl: mockFetch('not json') }), null);
  assert.equal(await generateAiListing(listing, {}, { apiKey: 'k', fetchImpl: async () => { throw new Error('network'); } }), null);
});

test('normalizeAiListing enforces the eBay 80 character title limit', () => {
  const long = { ...aiPayload, title: 'Apple iPhone 13 128GB Unlocked Midnight Smartphone Good Condition Tested Fully Working With Box' };
  const result = normalizeAiListing(long, listing);
  assert.ok(result.title.length <= 80, result.title);
  assert.ok(!/\s$/.test(result.title));
  const amazon = normalizeAiListing(long, { ...listing, marketplace: 'Amazon' });
  assert.equal(amazon.title, long.title);
});

test('normalizeAiListing rejects thin output', () => {
  assert.equal(normalizeAiListing({ ...aiPayload, bullets: ['one'] }, listing), null);
  assert.equal(normalizeAiListing({ ...aiPayload, title: '' }, listing), null);
});

test('prompt tells the model not to invent facts and includes listing input', () => {
  const [system, user] = buildMessages(listing, { title: 'draft title', bullets: '- a' });
  assert.match(system.content, /Never invent/);
  assert.match(system.content, /at most 80 characters/);
  assert.match(user.content, /Storage Capacity: 128 GB/);
  assert.match(user.content, /draft title/);
});

test('optimize handler uses AI output when OPENAI_API_KEY is set', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'sk-test';
  global.fetch = async (url, init) => {
    if (String(url).includes('api.openai.com')) return mockFetch(aiPayload)(url, init);
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  try {
    delete require.cache[require.resolve('../api/optimize')];
    const handler = require('../api/optimize');
    let payload;
    let statusCode;
    await handler(
      { method: 'POST', headers: { 'x-user-plan': 'Starter' }, body: { ...listing, marketplace: 'Other' } },
      { setHeader() {}, status(code) { statusCode = code; return this; }, json(data) { payload = data; return this; } }
    );
    assert.equal(statusCode, 200);
    assert.equal(payload.engine, 'ai');
    assert.equal(payload.title, aiPayload.title);
    assert.match(payload.bullets, /^- Unlocked for use on any carrier/);
    assert.match(payload.actions, /^1\. Add battery health/);
    assert.match(payload.descriptionHtml, /Apple iPhone 13 with 128GB of storage, unlocked\./);
    assert.ok(payload.scores.seo > 0);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  }
});
