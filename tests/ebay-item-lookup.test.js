const test = require('node:test');
const assert = require('node:assert/strict');

const { extractEbayItemId, extractEbayTitleFromUrlSlug, parseEbayItemHtml, lookupEbayBrowseApi, buildFindingDetailBundle } = require('../api/_lib/ebay-item-lookup');

test('extractEbayItemId finds numeric item ID from eBay item URL without title slug', () => {
  assert.equal(extractEbayItemId('https://www.ebay.com/itm/336568091037'), '336568091037');
});

test('extractEbayItemId finds numeric item ID when title slug is present', () => {
  assert.equal(extractEbayItemId('https://www.ebay.com/itm/sample-product-title/336568091037?hash=itemabc'), '336568091037');
});

test('extractEbayItemId rejects non-eBay URLs', () => {
  assert.equal(extractEbayItemId('https://example.com/itm/336568091037'), '');
});

test('extractEbayTitleFromUrlSlug gets starter title when eBay API and page fetch fail', () => {
  assert.equal(
    extractEbayTitleFromUrlSlug('https://www.ebay.com/itm/DYSON-Genuine-Motor-Main-Body-Housing-V8-Animal-Absolute-Total-Clean-Vacuum-/192793908150?_ul=RU'),
    'DYSON Genuine Motor Main Body Housing V8 Animal Absolute Total Clean Vacuum'
  );
});

test('extractEbayTitleFromUrlSlug stays empty for item-number-only URLs', () => {
  assert.equal(extractEbayTitleFromUrlSlug('https://www.ebay.com/itm/336568091037'), '');
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

test('lookupEbayBrowseApi tries fallback marketplaces and search before safe failure', async () => {
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url: String(url), marketplace: options.headers?.['X-EBAY-C-MARKETPLACE-ID'] });
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    }
    return { ok: false, status: 404, json: async () => ({ errors: [{ message: 'The item cannot be accessed.' }] }) };
  };
  const result = await lookupEbayBrowseApi('336568091037', {
    fetch: mockFetch,
    env: { EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret', EBAY_FALLBACK_MARKETPLACE_IDS: 'EBAY_US,EBAY_GB' }
  });
  assert.equal(result.ok, false);
  assert.equal(result.source, 'ebay-api');
  assert.equal(result.reason, 'item-failed');
  assert.equal(result.status, 404);
  assert.deepEqual(calls.filter(call => call.url.includes('get_item_by_legacy_id')).map(call => call.marketplace), ['EBAY_US', 'EBAY_GB']);
  assert.deepEqual(calls.filter(call => call.url.includes('item_summary/search')).map(call => call.marketplace), ['EBAY_US', 'EBAY_GB']);
});

test('lookupEbayBrowseApi can recover failed legacy lookup from item summary search', async () => {
  const mockFetch = async (url, options = {}) => {
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    }
    if (String(url).includes('get_item_by_legacy_id')) {
      return { ok: false, status: 404, json: async () => ({ errors: [{ message: 'The item cannot be accessed.' }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        itemSummaries: [{
          itemId: 'v1|336568091037|0',
          legacyItemId: '336568091037',
          title: 'Dyson V7 Motorhead Cordless Vacuum Cleaner',
          categoryPath: 'Home & Garden|Household Supplies & Cleaning|Vacuum Cleaners',
          condition: 'Used',
          price: { value: '89.99', currency: 'USD' },
          buyingOptions: ['FIXED_PRICE'],
          estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', estimatedAvailableQuantity: 1 }],
          image: { imageUrl: 'https://i.ebayimg.com/images/dyson.jpg' }
        }]
      })
    };
  };
  const result = await lookupEbayBrowseApi('336568091037', {
    fetch: mockFetch,
    env: { EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ebay-api-search');
  assert.equal(result.title, 'Dyson V7 Motorhead Cordless Vacuum Cleaner');
  assert.match(result.description, /Vacuum Cleaners/);
});

test('lookupEbayBrowseApi returns item details for Ken reported item when eBay search has the legacy ID', async () => {
  const requestedUrls = [];
  const mockFetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    }
    if (String(url).includes('get_item_by_legacy_id')) {
      return { ok: false, status: 404, json: async () => ({ errors: [{ message: 'The item cannot be accessed.' }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        itemSummaries: [{
          itemId: 'v1|336568843381|0',
          legacyItemId: '336568843381',
          title: 'Verified eBay Item Title From Search',
          categoryPath: 'Business & Industrial|Retail & Services|Packing & Shipping',
          condition: 'New',
          price: { value: '19.95', currency: 'USD' },
          buyingOptions: ['FIXED_PRICE'],
          image: { imageUrl: 'https://i.ebayimg.com/images/reported-item.jpg' }
        }]
      })
    };
  };

  const result = await lookupEbayBrowseApi('336568843381', {
    fetch: mockFetch,
    env: { EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }
  });

  assert.ok(requestedUrls.some(url => url.includes('item_summary/search?q=336568843381')));
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ebay-api-search');
  assert.equal(result.itemId, '336568843381');
  assert.equal(result.title, 'Verified eBay Item Title From Search');
  assert.match(result.description, /Packing & Shipping/);
});

test('buildFindingDetailBundle converts eBay Finding API item data into optimizer details', () => {
  const result = buildFindingDetailBundle({
    itemId: ['267202156923'],
    title: ['Dyson V7 Motorhead Vacuum'],
    primaryCategory: [{ categoryName: ['Vacuum Cleaners'] }],
    condition: [{ conditionDisplayName: ['Used'] }],
    sellingStatus: [{ currentPrice: [{ _: '69.99', '@currencyId': 'USD' }] }],
    galleryURL: ['https://i.ebayimg.com/images/sample.jpg'],
    location: ['Rowland Heights, CA'],
    country: ['US'],
    listingInfo: [{ listingType: ['FixedPrice'], endTime: ['2026-06-01T00:00:00.000Z'] }]
  }, '267202156923');
  assert.equal(result.ok, true);
  assert.equal(result.source, 'ebay-finding-api');
  assert.equal(result.title, 'Dyson V7 Motorhead Vacuum');
  assert.equal(result.price, 'USD 69.99');
  assert.match(result.description, /Vacuum Cleaners/);
});
