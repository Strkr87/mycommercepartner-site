const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOneTimeOffer } = require('../lib/offers');

test('resolveOneTimeOffer returns the new $199 cleanup pack for 25 credits', () => {
  assert.deepEqual(resolveOneTimeOffer(25), {
    credits: 25,
    amount: 19900,
    kind: 'rescue',
    name: '25 Listing Cleanup Pack',
    description: 'Instant access to clean up 25 eBay listings inside MyCommercePartner'
  });
});

test('resolveOneTimeOffer keeps legacy top-up packs available', () => {
  assert.deepEqual(resolveOneTimeOffer(100), {
    credits: 100,
    amount: 5900,
    kind: 'topup',
    name: '100 Credit Top-Up',
    description: 'Extra listing optimization credits for MyCommercePartner'
  });
});

test('resolveOneTimeOffer returns null for an unknown pack size', () => {
  assert.equal(resolveOneTimeOffer(999), null);
});
