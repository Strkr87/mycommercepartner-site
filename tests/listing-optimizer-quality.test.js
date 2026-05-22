const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function loadHomepageOptimizer() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const element = {
    textContent: '',
    innerHTML: '',
    hidden: false,
    querySelector() { return null; },
    addEventListener() {}
  };
  const context = {
    URL,
    Date,
    FormData,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    document: { getElementById() { return element; } }
  };
  vm.createContext(context);
  vm.runInContext(`${script}\nglobalThis.__buildHomeOptimizer = buildHomeOptimizer;\nglobalThis.__homeNeedsEbayItemLookup = homeNeedsEbayItemLookup;`, context);
  return context;
}

function makeFormData(entries) {
  return { get(name) { return entries[name] || ''; } };
}

function repeatedWords(title) {
  const counts = new Map();
  for (const word of title.toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (/^(and|or|for|with|of|to|in|the|a|an)$/i.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([word]) => word);
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

test('optimizer adds item specifications immediately after the 5 shopper bullets', async () => {
  const { statusCode, payload } = await runOptimize({
    ...dysonInput,
    specifics: 'Brand: Dyson\nModel: 360 Vis Nav\nSize: 12.6 x 12.6 x 3.8 in\nWeight: 10 lb\nAvailable Quantity: 3\nIncluded: Dock and charger'
  });

  assert.equal(statusCode, 200);
  assert.match(payload.description, /Highlights:\n(?:- .+\n){5}\nItem specifications:\n- Brand: Dyson\n- Model: 360 Vis Nav\n- Size: 12\.6 x 12\.6 x 3\.8 in\n- Weight: 10 lb\n- Available Quantity: 3\n- Included: Dock and charger/);
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

test('Amazon optimizer builds policy-safe titles from product facts instead of copying messy source titles', async () => {
  const { statusCode, payload } = await runOptimize({
    marketplace: 'Amazon',
    title: 'Kitchen|Drinkware|AquaPro AquaPro Water Bottle Water Bottle!!! Free Shipping 100% Quality Guaranteed Price: USD 29.99',
    brand: 'AquaPro',
    category: 'Kitchen|Drinkware|Sports Water Bottles',
    condition: 'New',
    sku: 'B0TEST1234',
    specifics: 'Brand: AquaPro\nMaterial: Stainless Steel\nCapacity: 40 oz\nColor: Blue\nIncluded: Straw lid and carry handle',
    shipping: 'Prime eligible shipping',
    description: 'Double-wall insulated water bottle with leak-resistant straw lid for gym, office, hiking, and travel.'
  });

  assert.equal(statusCode, 200);
  assert.ok(payload.title.length > 80, `title should use Amazon room for verified facts: ${payload.title}`);
  assert.ok(payload.title.length <= 200, `title exceeds Amazon limit: ${payload.title}`);
  assert.match(payload.title, /^AquaPro 40 oz Stainless Steel Water Bottle/i);
  assert.match(payload.title, /Straw Lid/i);
  assert.match(payload.title, /Gym|Office|Hiking|Travel/i);
  assert.match(payload.title, / - B0TEST1234$/);
  assert.doesNotMatch(payload.title, /Kitchen|Drinkware|Free Shipping|100%|Guaranteed|Price|USD|!!!/i);
  const repeated = payload.title.toLowerCase().match(/\bwater\b/g) || [];
  assert.ok(repeated.length <= 2, `Amazon title repeats a word too often: ${payload.title}`);
});


test('eBay optimizer creates an 80-character keyword title with brand, model, specs, condition, and item id', async () => {
  const { statusCode, payload } = await runOptimize({
    marketplace: 'eBay',
    title: 'Electronics|Cell Phones & Smartphones|Apple iPhone 13 Pro Max Smartphone Condition: Used - Very Good Price: USD 699.99',
    brand: 'Apple',
    category: 'Electronics|Cell Phones & Smartphones',
    condition: 'Used - Very Good',
    sku: '123456789012',
    specifics: 'Brand: Apple\nModel: iPhone 13 Pro Max\nStorage Capacity: 256GB\nNetwork: Unlocked\nColor: Sierra Blue\nBattery Health: 91%',
    shipping: 'Free shipping',
    description: 'Tested fully working smartphone with clean IMEI and charging cable included.'
  });

  assert.equal(statusCode, 200);
  assert.ok(payload.title.length <= 80, `eBay title exceeds 80 chars: ${payload.title}`);
  assert.ok(payload.title.length >= 72, `eBay title wastes search space: ${payload.title}`);
  assert.match(payload.title, /^Apple iPhone 13 Pro Max 256GB Unlocked Sierra Blue/i);
  assert.match(payload.title, /Very Good/i);
  assert.match(payload.title, / - 123456789012$/);
  assert.doesNotMatch(payload.title, /Electronics|Cell Phones|Condition:|Price:|USD/i);
});

test('homepage optimizer does not repeat brand or product words in eBay titles', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/395248277355',
    currentTitle: 'HiPer 9” Black Carbon Composite',
    productType: 'eBay Motors|Parts & Accessories',
    currentCopy: 'Beadlock Ring (P5K-U9-MUD-BK). Proudly made in USA - HiPer leads the industry with advanced composite technology. Why Choose HiPer Technology. Industry pioneer in carbon composite beadlock wheels and ATV wheel accessories.',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  assert.ok(result.optimizedTitle.length <= 80, result.optimizedTitle);
  assert.deepEqual(repeatedWords(result.optimizedTitle), [], result.optimizedTitle);
  assert.match(result.optimizedTitle, /^HiPer 9/i);
  assert.doesNotMatch(result.optimizedTitle, /HiPer, HiPer/i);
  assert.doesNotMatch(result.optimizedTitle, /,\s*for Home/i);
});

test('homepage optimizer looks up eBay mobile share URLs without item IDs', () => {
  const { __homeNeedsEbayItemLookup: homeNeedsEbayItemLookup } = loadHomepageOptimizer();
  assert.equal(homeNeedsEbayItemLookup('https://ebay.us/m/BmvHq2'), true);
  assert.equal(homeNeedsEbayItemLookup('https://www.ebay.com/itm/395248277355'), true);
  assert.equal(homeNeedsEbayItemLookup('https://www.amazon.com/AquaPro-Insulated-Bottle/dp/B0TEST1234'), false);
});

test('homepage optimizer returns product details for the visible results panel', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.amazon.com/AquaPro-Insulated-Bottle/dp/B0TEST1234',
    currentTitle: 'AquaPro 40 oz Stainless Steel Insulated Water Bottle with Straw Lid',
    productType: 'Sports Water Bottles',
    currentCopy: 'Material: stainless steel\nCapacity: 40 oz\nColor: blue\nIncluded: straw lid and carry handle\nBest for gym, office, hiking, and travel.',
    targetKeyword: 'insulated water bottle',
    goal: '',
    revenue: ''
  }));

  assert.deepEqual(Array.from(result.productDetails), [
    'Brand: AquaPro',
    'Product ID: B0TEST1234',
    'Material: Stainless Steel',
    'Capacity: 40 oz',
    'Color: Blue',
    'Included: Straw Lid and Carry Handle'
  ]);
});

test('homepage product details remove marketplace noise from eBay lookup text', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/395248277355',
    currentTitle: 'WindscreenSupplyCo Heavy Duty Mesh Tarp Sun Shade Cover 60-70% Blockage Black',
    productType: 'Garden & Patio|Shade Sails & Tarps',
    currentCopy: 'Condition: New Price: USD 149.95 Title: WindscreenSupplyCo Heavy Duty Mesh Tarp Sun Shade Cover 60-70% Blockage Black | Buying Options: FIXED_PRICE | Seller: Ncsnainc, 100.0% Positive, 170 Feedback | Item Location: 917**, US | Shipping: USD 0.00 - 2026-05-26T07:00:00.000Z to 2026-05-29T07:00:00.000Z | Item specifics: Brand: WindscreenSupplyCo; Material: Heavy Duty Mesh; Color: Black; Coverage: 60-70% Blockage',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  assert.deepEqual(Array.from(result.productDetails), [
    'Brand: WindscreenSupplyCo',
    'Product ID: 395248277355',
    'Condition: New',
    'Material: Heavy Duty Mesh',
    'Color: Black',
    'Coverage: 60-70% Blockage'
  ]);
  assert.doesNotMatch(result.productDetails.join(' '), /Price|Seller|Buying Options|Item Location|Shipping|Feedback|Title:/i);
});

test('homepage presents the free listing optimizer as the front door and frames paid help as implementation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<title>Free Amazon &amp; eBay Listing Optimizer|<title>Free Amazon & eBay Listing Optimizer/);
  assert.match(html, /Use the Free Optimizer|Get My Optimized Result/);
  assert.match(html, /Free diagnosis first/i);
  assert.match(html, /implementation|done-for-you/i);
  assert.doesNotMatch(html, /outsourced|offshore|AI-powered|AI tool/i);
});
