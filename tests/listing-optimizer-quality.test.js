const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const optimizeHandler = require('../api/optimize');

async function runOptimize(body) {
  let statusCode = 0;
  const headers = {};
  let payload;
  const req = {
    method: 'POST',
    headers: { 'x-user-plan': 'Starter' },
    body
  };
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { statusCode = code; return this; },
    json(data) { payload = data; return this; }
  };
  await optimizeHandler(req, res);
  return { statusCode, headers, payload };
}

const dysonInput = {
  marketplace: 'eBay',
  title: 'Home Appliances|Vacuum Cleaners|Dyson 360 Vis Nav Robot Vacuum Cleaner Open Box Condition: Open Box Price: USD 999.99',
  brand: 'Dyson',
  category: 'Home Appliances|Vacuum Cleaners',
  condition: 'Open Box',
  sku: '336568091037',
  specifics: 'Brand: Dyson\nModel: 360 Vis Nav\nAvailability: OUT_OF_STOCK\nAvailable Quantity: 0\nIncluded: Dock and charger',
  shipping: 'Free shipping',
  description: 'Robot vacuum with 360 vision navigation, edge cleaning, HEPA filtration, and app control.'
};

test('optimizer creates shopper-facing marketplace copy from product facts instead of category paths and junk tokens', async () => {
  const { statusCode, payload } = await runOptimize(dysonInput);

  assert.equal(statusCode, 200);
  assert.equal(payload.title, 'Dyson 360 Vis Nav Robot Vacuum - Open Box - 336568091037');
  assert.doesNotMatch(payload.title, /Home Appliances|Vacuum Cleaners|Condition:|Price:|USD/i);
  assert.match(payload.title, / - 336568091037$/);
  assert.doesNotMatch(payload.description, /Why this listing converts|This listing is structured/i);

  const bulletLines = payload.bullets.split('\n').filter(Boolean);
  assert.equal(bulletLines.length, 5);
  for (const line of bulletLines) {
    assert.match(line, /^- /);
    assert.doesNotMatch(line, /lead with|state condition|reinforce shipping|clarify included|mobile-friendly structure|listing structure|buyer-friendly listing|buyers confirm|product wording|before ordering|why this listing converts/i);
    assert.match(line, /help|helps|keep|keeps|give|gives|ready|included|clean|navigation|control|confidence|shipping|arrive|arrives|filtration|edge|app|package|checkout/i);
  }
});

test('optimizer flags out-of-stock listings with a clear warning and lower score', async () => {
  const out = await runOptimize(dysonInput);
  const inStock = await runOptimize({
    ...dysonInput,
    specifics: dysonInput.specifics.replace('OUT_OF_STOCK', 'IN_STOCK').replace('Available Quantity: 0', 'Available Quantity: 3')
  });

  assert.match(out.payload.warnings, /out of stock|0 available/i);
  assert.ok(out.payload.scores.all < inStock.payload.scores.all, `${out.payload.scores.all} should be lower than ${inStock.payload.scores.all}`);
});

test('Amazon optimizer keeps readable titles longer than 80 characters when product facts support it', async () => {
  const { statusCode, payload } = await runOptimize({
    marketplace: 'Amazon',
    title: 'AquaPro 40 oz Stainless Steel Insulated Water Bottle with Straw Lid Leakproof Travel Mug for Gym Office Hiking',
    brand: 'AquaPro',
    category: 'Sports & Outdoors|Sports Water Bottles',
    condition: 'New',
    sku: 'B0TEST1234',
    specifics: 'Brand: AquaPro\nMaterial: Stainless Steel\nCapacity: 40 oz\nColor: Blue\nIncluded: Straw lid and carry handle',
    shipping: 'Prime eligible shipping',
    description: 'Double-wall insulation keeps drinks cold through long workdays, gym sessions, hikes, and commutes.'
  });

  assert.equal(statusCode, 200);
  assert.ok(payload.title.length > 80, `title was unexpectedly capped: ${payload.title}`);
  assert.match(payload.title, /^AquaPro 40 oz Stainless Steel Insulated Water Bottle/i);
  assert.match(payload.title, / - B0TEST1234$/);
});

test('homepage presents the free listing optimizer as the front door and frames paid help as implementation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<title>Free Amazon &amp; eBay Listing Optimizer|<title>Free Amazon & eBay Listing Optimizer/);
  assert.match(html, /Use the Free Optimizer|Get My Optimized Result/);
  assert.match(html, /Free diagnosis first/i);
  assert.match(html, /implementation|done-for-you/i);
  assert.doesNotMatch(html, /outsourced|offshore|AI-powered|AI tool/i);
});
