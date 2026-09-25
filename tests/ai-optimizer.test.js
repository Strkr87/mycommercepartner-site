const test = require('node:test');
const assert = require('node:assert/strict');

const { generateAiListing, normalizeAiListing, buildPrompt } = require('../api/_lib/ai-optimizer');
const { TEST_TOKEN, loadOptimizeWithFakeAuth } = require('./helpers/fake-auth');

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

function mockClient(payload, { stopReason = 'end_turn', capture, fail } = {}) {
  return {
    beta: {
      messages: {
        async create(params) {
          if (capture) capture.push(params);
          if (fail) throw fail;
          const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          return { stop_reason: stopReason, content: [{ type: 'text', text }] };
        }
      }
    }
  };
}

test('generateAiListing returns null without an API key or client', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(await generateAiListing(listing, {}), null);
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

test('generateAiListing requests JSON schema output and normalizes the result', async () => {
  const calls = [];
  const result = await generateAiListing(listing, { title: 'draft' }, {
    model: 'test-model',
    client: mockClient(aiPayload, { capture: calls })
  });

  assert.equal(calls.length, 1);
  const params = calls[0];
  assert.equal(params.model, 'test-model');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.deepEqual(params.output_config.format.schema.required, ['title', 'bullets', 'description', 'actions']);
  assert.match(params.system, /Never invent/);
  assert.equal(params.messages[0].role, 'user');

  assert.equal(result.title, aiPayload.title);
  assert.deepEqual(result.bullets, ['Unlocked for use on any carrier', '128GB storage for apps and photos', 'Midnight color']);
  assert.equal(result.actions.length, 2);
});

test('generateAiListing falls back to null on errors, refusals, or bad JSON', async () => {
  assert.equal(await generateAiListing(listing, {}, { client: mockClient(aiPayload, { fail: new Error('network') }) }), null);
  assert.equal(await generateAiListing(listing, {}, { client: mockClient(aiPayload, { stopReason: 'refusal' }) }), null);
  assert.equal(await generateAiListing(listing, {}, { client: mockClient(aiPayload, { stopReason: 'max_tokens' }) }), null);
  assert.equal(await generateAiListing(listing, {}, { client: mockClient('not json') }), null);
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
  const { system, user } = buildPrompt(listing, { title: 'draft title', bullets: '- a' });
  assert.match(system, /Never invent/);
  assert.match(system, /at most 80 characters/);
  assert.match(user, /Storage Capacity: 128 GB/);
  assert.match(user, /draft title/);
});

function fakeRes() {
  const res = { statusCode: 0, payload: null };
  res.setHeader = () => {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.payload = data; return res; };
  return res;
}

test('optimize handler rejects a spoofed x-user-plan header without a login', async () => {
  const handler = loadOptimizeWithFakeAuth();
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'x-user-plan': 'Enterprise' }, body: listing }, res);
  assert.equal(res.statusCode, 401);
});

test('optimize handler uses AI output when ANTHROPIC_API_KEY is set', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const aiModule = require('../api/_lib/ai-optimizer');
  const originalGenerate = aiModule.generateAiListing;
  aiModule.generateAiListing = (data, draft) => originalGenerate(data, draft, { client: mockClient(aiPayload) });
  try {
    const handler = loadOptimizeWithFakeAuth();
    const res = fakeRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TEST_TOKEN}` }, body: { ...listing, marketplace: 'Other' } }, res);
    const payload = res.payload;
    assert.equal(res.statusCode, 200);
    assert.equal(payload.engine, 'ai');
    assert.equal(payload.title, aiPayload.title);
    assert.match(payload.bullets, /^- Unlocked for use on any carrier/);
    assert.match(payload.actions, /^1\. Add battery health/);
    assert.match(payload.descriptionHtml, /Apple iPhone 13 with 128GB of storage, unlocked\./);
    assert.ok(payload.scores.seo > 0);
  } finally {
    aiModule.generateAiListing = originalGenerate;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
