const ONE_TIME_OFFERS = {
  25: {
    credits: 25,
    amount: 19900,
    kind: 'rescue',
    name: '25 Listing Cleanup Pack',
    description: 'Instant access to clean up 25 eBay listings inside MyCommercePartner'
  },
  100: {
    credits: 100,
    amount: 5900,
    kind: 'topup',
    name: '100 Credit Top-Up',
    description: 'Extra listing optimization credits for MyCommercePartner'
  },
  250: {
    credits: 250,
    amount: 12900,
    kind: 'topup',
    name: '250 Credit Top-Up',
    description: 'Extra listing optimization credits for MyCommercePartner'
  },
  500: {
    credits: 500,
    amount: 22900,
    kind: 'topup',
    name: '500 Credit Top-Up',
    description: 'Extra listing optimization credits for MyCommercePartner'
  }
};

function resolveOneTimeOffer(credits) {
  const normalized = Number(credits || 0);
  return ONE_TIME_OFFERS[normalized] || null;
}

module.exports = {
  ONE_TIME_OFFERS,
  resolveOneTimeOffer
};
