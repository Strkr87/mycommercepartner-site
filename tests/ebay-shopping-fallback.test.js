const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupEbayShoppingApi } = require('../api/_lib/ebay-item-lookup');

test('eBay Shopping API fallback returns usable listing data by item id', async () => {
  const calls = [];
  const result = await lookupEbayShoppingApi('336568843381', { clientId: 'test-app-id' }, {
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          Ack: 'Success',
          Item: {
            ItemID: '336568843381',
            Title: 'Outdoor Sun Shade Mesh Tarp 10 x 12 ft',
            PrimaryCategoryName: 'Garden & Patio Shade',
            ConditionDisplayName: 'New',
            ConvertedCurrentPrice: { Value: '39.99', CurrencyID: 'USD' },
            Seller: { UserID: 'shade-store', PositiveFeedbackPercent: '99.8', FeedbackScore: '1240' },
            Location: 'Rowland Heights',
            Country: 'US',
            GalleryURL: 'https://i.ebayimg.com/images/sample.jpg',
            ListingType: 'FixedPriceItem',
            ItemSpecifics: {
              NameValueList: [
                { Name: 'Brand', Value: ['ShadeCo'] },
                { Name: 'Material', Value: ['Mesh'] }
              ]
            }
          }
        })
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'ebay-shopping-api');
  assert.equal(result.itemId, '336568843381');
  assert.equal(result.title, 'Outdoor Sun Shade Mesh Tarp 10 x 12 ft');
  assert.equal(result.price, 'USD 39.99');
  assert.equal(result.category, 'Garden & Patio Shade');
  assert.deepEqual(result.itemSpecifics, ['Brand: ShadeCo', 'Material: Mesh']);
  assert.match(calls[0], /open\.api\.ebay\.com\/shopping/);
  assert.match(calls[0], /ItemID=336568843381/);
});
