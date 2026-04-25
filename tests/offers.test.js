const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOneTimeOffer } = require('../lib/offers');

test('resolveOneTimeOffer returns the new $59 rescue pack for 20 credits', () => {
  assert.deepEqual(resolveOneTimeOffer(20), {
    credits: 20,
    amount: 5900,
    kind: 'rescue',
    name: '20 Listing Rescue Pack',
    description: 'Instant access to rescue 20 eBay listings inside MyCommercePartner'
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
