const test = require('node:test');
const assert = require('node:assert/strict');

const contactHandler = require('../api/contact');

async function runContact(body, fetchImpl) {
  const originalFetch = global.fetch;
  let statusCode = 0;
  const headers = {};
  let payload;
  const req = {
    method: 'POST',
    body
  };
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { statusCode = code; return this; },
    json(data) { payload = data; return this; }
  };

  global.fetch = fetchImpl;
  try {
    await contactHandler(req, res);
  } finally {
    global.fetch = originalFetch;
  }
  return { statusCode, headers, payload };
}

test('contact ebay-item-lookup resolves mobile share URLs and returns listing data', async () => {
  const html = `<!doctype html><html><head>
    <title>Premium Garden Shade Cloth 10 x 12 ft | eBay</title>
    <meta property="og:title" content="Premium Garden Shade Cloth 10 x 12 ft | eBay">
    <meta property="og:description" content="UV resistant mesh shade for patio and garden use.">
    <meta property="og:image" content="https://i.ebayimg.com/images/sample.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Premium Garden Shade Cloth 10 x 12 ft","category":"Garden Shade","image":"https://i.ebayimg.com/images/json.jpg","description":"Breathable mesh helps block sun for patios.","offers":{"@type":"Offer","price":"24.99"},"itemCondition":"https://schema.org/NewCondition"}</script>
  </head><body>
    <section aria-label="Item specifics">
      <dl class="ux-labels-values"><dt class="ux-labels-values__labels">Brand</dt><dd class="ux-labels-values__values">ShadeCo</dd></dl>
      <dl class="ux-labels-values"><dt class="ux-labels-values__labels">Material</dt><dd class="ux-labels-values__values">Mesh</dd></dl>
    </section>
  </body></html>`;
  const calls = [];
  const { statusCode, payload } = await runContact({ action: 'ebay-item-lookup', url: 'https://ebay.us/m/BmvHq2' }, async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      url: 'https://www.ebay.com/itm/sample-product-title/336568091037?mkcid=16&mkevt=1',
      text: async () => html
    };
  });

  assert.equal(statusCode, 200);
  assert.deepEqual(calls, ['https://ebay.us/m/BmvHq2']);
  assert.equal(payload.ok, true);
  assert.equal(payload.itemId, '336568091037');
  assert.equal(payload.source, 'ebay-item-page');
  assert.equal(payload.title, 'Premium Garden Shade Cloth 10 x 12 ft');
  assert.equal(payload.price, '24.99');
  assert.equal(payload.category, 'Garden Shade');
  assert.deepEqual(payload.itemSpecifics, ['Brand: ShadeCo', 'Material: Mesh']);
});
