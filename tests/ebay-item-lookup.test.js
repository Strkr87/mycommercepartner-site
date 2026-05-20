const test = require('node:test');
const assert = require('node:assert/strict');

const { extractEbayItemId, parseEbayItemHtml, lookupEbayBrowseApi } = require('../api/_lib/ebay-item-lookup');

test('extractEbayItemId finds numeric item ID from eBay item URL without title slug', () => {
  assert.equal(extractEbayItemId('https://www.ebay.com/itm/336568091037'), '336568091037');
});

test('extractEbayItemId finds numeric item ID when title slug is present', () => {
  assert.equal(extractEbayItemId('https://www.ebay.com/itm/sample-product-title/336568091037?hash=itemabc'), '336568091037');
});

test('extractEbayItemId rejects non-eBay URLs', () => {
  assert.equal(extractEbayItemId('https://example.com/itm/336568091037'), '');
});

test('parseEbayItemHtml reads OpenGraph and JSON-LD product fields', () => {
  const html = `<!doctype html><html><head>
    <title>Sample Product | eBay</title>
    <meta property="og:title" content="Premium Garden Shade Cloth 10 x 12 ft | eBay">
    <meta property="og:description" content="UV resistant mesh shade for patio and garden use.">
    <meta property="og:image" content="https://i.ebayimg.com/images/sample.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Premium Garden Shade Cloth 10 x 12 ft","category":"Garden Shade","image":"https://i.ebayimg.com/images/json.jpg","description":"Breathable mesh helps block sun for patios.","offers":{"@type":"Offer","price":"24.99"},"itemCondition":"https://schema.org/NewCondition"}</script>
  </head><body></body></html>`;
  const parsed = parseEbayItemHtml(html, '336568091037');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.itemId, '336568091037');
  assert.equal(parsed.title, 'Premium Garden Shade Cloth 10 x 12 ft');
  assert.equal(parsed.price, '24.99');
  assert.equal(parsed.condition, 'New');
  assert.equal(parsed.category, 'Garden Shade');
  assert.equal(parsed.image, 'https://i.ebayimg.com/images/json.jpg');
});

test('lookupEbayBrowseApi fetches token then legacy item details', async () => {
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/identity/v1/oauth2/token')) {
      assert.equal(options.method, 'POST');
      assert.match(options.headers.Authorization, /^Basic\s+/);
      assert.match(String(options.body), /grant_type=client_credentials/);
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'test-token' })
      };
    }
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        legacyItemId: '336568091037',
        title: 'Premium Garden Shade Cloth 10 x 12 ft Heavy Duty Mesh',
        categoryPath: 'Home & Garden|Yard, Garden & Outdoor Living|Shade Sails',
        condition: 'New',
        price: { value: '24.99', currency: 'USD' },
        buyingOptions: ['FIXED_PRICE'],
        estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', estimatedAvailableQuantity: 4 }],
        seller: { username: 'shade-shop', feedbackPercentage: '99.8', feedbackScore: 1234 },
        itemLocation: { city: 'Rowland Heights', stateOrProvince: 'CA', country: 'US' },
        shippingOptions: [{ shippingServiceCode: 'USPS Ground Advantage', shippingCost: { value: '0.00', currency: 'USD' } }],
        returnTerms: { returnsAccepted: true, returnPeriod: { value: 30, unit: 'DAY' } },
        shortDescription: 'Breathable mesh blocks harsh sun for patios and gardens.',
        image: { imageUrl: 'https://i.ebayimg.com/images/sample.jpg' },
        localizedAspects: [
          { name: 'Brand', value: ['ShadePro'] },
          { name: 'Size', value: ['10 x 12 ft'] }
        ]
      })
    };
  };

  const result = await lookupEbayBrowseApi('336568091037', {
    fetch: mockFetch,
    env: { EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret', EBAY_MARKETPLACE_ID: 'EBAY_US' }
  });

  assert.equal(calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ebay-api');
  assert.equal(result.itemId, '336568091037');
  assert.equal(result.title, 'Premium Garden Shade Cloth 10 x 12 ft Heavy Duty Mesh');
  assert.ok(result.detailCount > 0);
  assert.match(result.description, /Shade Sails/);
});

test('lookupEbayBrowseApi skips official lookup when credentials are missing', async () => {
  let called = false;
  const result = await lookupEbayBrowseApi('336568091037', {
    fetch: async () => { called = true; },
    env: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-credentials');
  assert.equal(called, false);
});

test('lookupEbayBrowseApi returns safe failure when item API fails', async () => {
  const mockFetch = async url => {
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    }
    return { ok: false, status: 404, json: async () => ({ errors: [{ message: 'The item cannot be accessed.' }] }) };
  };
  const result = await lookupEbayBrowseApi('336568091037', {
    fetch: mockFetch,
    env: { EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }
  });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'ebay-api');
  assert.equal(result.reason, 'item-failed');
  assert.equal(result.status, 404);
});
