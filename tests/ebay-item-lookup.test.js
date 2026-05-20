const test = require('node:test');
const assert = require('node:assert/strict');

const { extractEbayItemId, parseEbayItemHtml } = require('../api/_lib/ebay-item-lookup');

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
