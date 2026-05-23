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
    document: { getElementById() { return element; }, querySelector() { return element; } }
  };
  vm.createContext(context);
  vm.runInContext(`${script}\nglobalThis.__buildHomeOptimizer = buildHomeOptimizer;\nglobalThis.__homeNeedsEbayItemLookup = homeNeedsEbayItemLookup;`, context);
  return context;
}

function makeFormData(entries) {
  return { get(name) { return entries[name] || ''; } };
}

function loadHomepageOptimizerSubmitHarness(fetchImpl) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const inputs = {
    siteUrl: { value: '' },
    currentTitle: { value: '' },
    currentCopy: { value: '' },
    productType: { value: '' },
    targetKeyword: { value: '' }
  };
  let submitHandler;
  const defaultElement = {
    textContent: '',
    innerHTML: '',
    value: '',
    hidden: false,
    srcdoc: '',
    classList: { add() {} },
    querySelector() { return null; },
    addEventListener() {}
  };
  const form = {
    ...defaultElement,
    querySelector(selector) {
      const match = selector.match(/\[name="([^"]+)"\]/);
      return match ? inputs[match[1]] : null;
    },
    addEventListener(type, handler) {
      if (type === 'submit') submitHandler = handler;
    }
  };
  const elements = new Map([
    ['homeOptimizerForm', form],
    ['homeOptimizerResult', { ...defaultElement }],
    ['homeOptimizerStatus', { ...defaultElement }],
    ['homeScoreValue', { ...defaultElement }],
    ['homeScoreLabel', { ...defaultElement }],
    ['homeScoreSummary', { ...defaultElement }],
    ['homeEbayHtmlCard', { ...defaultElement }],
    ['homeEbayHtmlOutput', { ...defaultElement }],
    ['homeEbayPreviewCard', { ...defaultElement }],
    ['homeEbayHtmlPreview', { ...defaultElement }],
    ['homeKeywordChips', { ...defaultElement }],
    ['homeFirstFixes', { ...defaultElement }],
    ['year', { ...defaultElement }],
    ['contactForm', { ...defaultElement }],
    ['formStatus', { ...defaultElement }]
  ]);
  class TestFormData {
    constructor() {}
    get(name) { return inputs[name]?.value || ''; }
  }
  const context = {
    URL,
    Date,
    FormData: TestFormData,
    fetch: fetchImpl,
    document: {
      getElementById(id) { return elements.get(id) || { ...defaultElement }; },
      querySelector() { return { ...defaultElement }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return {
    inputs,
    async submit() {
      assert.equal(typeof submitHandler, 'function');
      await submitHandler({ preventDefault() {} });
    }
  };
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

test('homepage repeated eBay URL submits refresh lookup-filled fields for the new listing', async () => {
  const lookupByUrl = new Map([
    ['https://www.ebay.com/itm/111111111111', {
      itemId: '111111111111',
      title: 'Dyson V7 Motorhead Cordless Vacuum Cleaner',
      category: 'Vacuum Cleaners',
      condition: 'Used',
      description: 'Cordless vacuum with charger and motorhead for home cleaning.'
    }],
    ['https://www.ebay.com/itm/222222222222', {
      itemId: '222222222222',
      title: 'Premium Garden Shade Cloth 10 x 12 ft',
      category: 'Garden Shade',
      condition: 'New',
      description: 'UV resistant mesh shade for patio and garden use.'
    }]
  ]);
  const calls = [];
  const harness = loadHomepageOptimizerSubmitHarness(async (url, options = {}) => {
    assert.equal(String(url), '/api/contact');
    const body = JSON.parse(options.body);
    calls.push(body.url);
    return { ok: true, json: async () => ({ ok: true, ...lookupByUrl.get(body.url) }) };
  });

  harness.inputs.siteUrl.value = 'https://www.ebay.com/itm/111111111111';
  await harness.submit();
  assert.equal(harness.inputs.currentTitle.value, 'Dyson V7 Motorhead Cordless Vacuum Cleaner');
  assert.match(harness.inputs.currentCopy.value, /Product ID: 111111111111/);
  assert.equal(harness.inputs.productType.value, 'Vacuum Cleaners');

  harness.inputs.siteUrl.value = 'https://www.ebay.com/itm/222222222222';
  await harness.submit();
  assert.deepEqual(calls, [
    'https://www.ebay.com/itm/111111111111',
    'https://www.ebay.com/itm/222222222222'
  ]);
  assert.equal(harness.inputs.currentTitle.value, 'Premium Garden Shade Cloth 10 x 12 ft');
  assert.match(harness.inputs.currentCopy.value, /Product ID: 222222222222/);
  assert.doesNotMatch(harness.inputs.currentCopy.value, /111111111111|Cordless vacuum/);
  assert.equal(harness.inputs.productType.value, 'Garden Shade');
});

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

test('eBay optimizer enriches sparse model-number listings before writing 5 description bullets', async () => {
  const oldFetch = global.fetch;
  const oldEnv = {
    EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
    EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
    EBAY_MARKETPLACE_ID: process.env.EBAY_MARKETPLACE_ID
  };
  process.env.EBAY_CLIENT_ID = 'client-id';
  process.env.EBAY_CLIENT_SECRET = 'client-secret';
  process.env.EBAY_MARKETPLACE_ID = 'EBAY_US';
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
    }
    assert.match(String(url), /item_summary\/search/);
    assert.match(String(url), /Dyson\+V7\+Motorhead/);
    assert.equal(options.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        itemSummaries: [{
          itemId: 'v1|267202156923|0',
          legacyItemId: '267202156923',
          title: 'Dyson V7 Motorhead Cordless Vacuum Cleaner',
          categoryPath: 'Home & Garden|Vacuum Cleaners',
          condition: 'Used',
          localizedAspects: [
            { name: 'Brand', value: ['Dyson'] },
            { name: 'Model', value: ['V7 Motorhead'] },
            { name: 'Included Accessories', value: ['Charger and motorhead'] },
            { name: 'Features', value: ['Cordless, lightweight'] }
          ],
          shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
          returnTerms: { returnsAccepted: true, returnPeriod: { value: 30, unit: 'DAY' } }
        }]
      })
    };
  };

  try {
    const { statusCode, payload } = await runOptimize({
      marketplace: 'eBay',
      title: 'Dyson V7 Motorhead',
      brand: 'Dyson',
      category: 'Vacuum Cleaners',
      condition: 'Used',
      specifics: 'Model: V7 Motorhead',
      description: ''
    });

    assert.equal(statusCode, 200);
    const htmlBullets = [...payload.descriptionHtml.matchAll(/<li>(.*?)<\/li>/g)]
      .map((match) => match[1])
      .slice(0, 5);
    assert.equal(htmlBullets.length, 5);
    assert.match(payload.specifics, /Included Accessories: Charger and motorhead/);
    assert.doesNotMatch(htmlBullets.join(' '), /Product ID|eBay Item ID|Condition:|SKU|MPN|Seller|Price/i);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

test('homepage optimizer carries eBay item specifics into product details', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/336568091037',
    currentTitle: 'White Acoustic Wall Panels 12 x 12 Sound Absorbing Tiles',
    productType: 'Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments',
    currentCopy: 'Product ID: 336568091037\nBrand: SoundPro\nType: Acoustic Panel\nItem Thickness: 0.4 in\nFeatures: Sound Absorbing\nShape: Square',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  assert.deepEqual(Array.from(result.productDetails), [
    'Brand: SoundPro',
    'Product ID: 336568091037',
    'Type: Acoustic Panel',
    'Item Thickness: 0.4 in',
    'Features: Sound Absorbing',
    'Shape: Square'
  ]);
  assert.match(result.ebayHtml, /<li>Type: Acoustic Panel<\/li>/);
  assert.match(result.ebayHtml, /<li>Item Thickness: 0\.4 in<\/li>/);
});

test('homepage optimizer prioritizes eBay item specifics over marketplace metadata', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/395645632216',
    currentTitle: 'HiPer ATV TECH 3 Single Beadlock Front Wheel 10x5, 4+1, 4x156 - 1050-YPFF-SBL-BK',
    productType: 'eBay Motors|Parts & Accessories|Wheels, Tires & Parts|Wheels',
    currentCopy: [
      'Product ID: 395645632216',
      'Machine Type: ATV',
      'Placement on Vehicle: Front Wheel',
      'Manufacturer Part Number: 1050-YPFF-SBL-BK',
      'OE/OEM Part Number: 1050-YPFF-SBL-BK',
      'Bolt Pattern: 4x156',
      'Offset: 4+1',
      'Type: Wheel',
      'Wheel Diameter: 10',
      'Wheel Width: 5',
      'Model: Tech 3',
      'Wheel Construction: Single Beadlock',
      'Category: eBay Motors|Parts & Accessories|Wheels',
      'Condition: New',
      'Price: USD 275.00',
      'Shipping: Free shipping'
    ].join('\n'),
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const details = Array.from(result.productDetails).join('\n');
  assert.match(details, /Machine Type: ATV/);
  assert.match(details, /Manufacturer Part Number: 1050-YPFF-SBL-BK/);
  assert.match(details, /Bolt Pattern: 4x156/);
  assert.match(details, /Wheel Diameter: 10/);
  assert.doesNotMatch(details, /Price: USD 275\.00|Category: eBay Motors/i);
  assert.match(result.ebayHtml, /<li>Machine Type: ATV<\/li>/);
  assert.match(result.ebayHtml, /<li>Bolt Pattern: 4x156<\/li>/);
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

test('homepage eBay product description title keeps product ID at the end', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/395248277355',
    currentTitle: 'WindscreenSupplyCo Heavy Duty Mesh Tarp Sun Shade Cover 60-70% Blockage Black',
    productType: 'Garden & Patio|Shade Sails & Tarps',
    currentCopy: 'Material: Heavy Duty Mesh\nColor: Black\nCoverage: 60-70% Blockage',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  assert.ok(result.optimizedTitle.length <= 80, result.optimizedTitle);
  assert.match(result.optimizedTitle, / - 395248277355$/);
  assert.match(result.ebayHtml, /<h2[^>]*>[^<]+ - 395248277355<\/h2>/);
});

test('homepage eBay product description always renders five highlight bullets', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/395248277355',
    currentTitle: 'WindscreenSupplyCo Heavy Duty Mesh Tarp Sun Shade Cover 60-70% Blockage Black',
    productType: 'Garden & Patio|Shade Sails & Tarps',
    currentCopy: 'Brand: WindscreenSupplyCo\nCondition: New\nMaterial: Heavy Duty Mesh\nColor: Black\nCoverage: 60-70% Blockage',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const highlights = result.ebayHtml.match(/<h3[^>]*>Highlights<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const bulletLines = [...highlights.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(bulletLines.length, 5);
  assert.doesNotMatch(bulletLines.join(' '), /Product ID|Condition:|SKU|MPN|Seller|Price|Notes:/i);
});

test('homepage eBay product description does not repeat equivalent dimension bullets', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/336568091037',
    currentTitle: 'Acoustic Wall Panel 12 X 12 12 Pack Sound Absorbing Foam Panels',
    productType: 'Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments',
    currentCopy: 'Product ID: 336568091037 Category: Musical Instruments & Gear > Pro Audio Equipment > Acoustical Treatments Condition: New Refund: money_back Item specifics: Size: 12 x 12; Pack Count: 12 Pack; Color: White',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const highlights = result.ebayHtml.match(/<h3[^>]*>Highlights<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const bulletLines = [...highlights.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(bulletLines.length, 5);
  const dimensionBullets = bulletLines.filter(line => /12\s*x\s*12|12x12/i.test(line));
  assert.equal(dimensionBullets.length, 1, bulletLines.join('\n'));
  const materialBullets = bulletLines.filter(line => /white|material|construction|foam/i.test(line));
  assert.equal(materialBullets.length, 1, bulletLines.join('\n'));
});

test('homepage eBay product description builds five bullets from sparse URL-only acoustic listings', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/336568091037',
    currentTitle: '12 Pack White Acoustic Wall Panels 12 x 12 x .4 Sound Absorbing Tiles Non-Toxic',
    productType: 'Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments',
    currentCopy: 'Product ID: 336568091037\nCategory: Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments\nCondition: New\nPrice: USD 43.65\nShipping: Overnight shipping - One-day Shipping - USD 0.00\nReturns: Returns accepted',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const highlights = result.ebayHtml.match(/<h3[^>]*>Highlights<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const bulletLines = [...highlights.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(bulletLines.length, 5);
  assert.doesNotMatch(bulletLines.join(' '), /wheel dimension|Product ID|Condition:|SKU|MPN|Seller|Price|Notes:/i);
  assert.match(bulletLines.join(' '), /12x12|White|Sound absorbing|12 Pack|Panel format|Tile format|Non-toxic/i);
});

test('homepage eBay product description backfills a fifth non-duplicate bullet after strict dedupe', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/336568091037',
    currentTitle: 'White Acoustic Wall Panels 12 x 12 Sound Absorbing Tiles',
    productType: 'Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments',
    currentCopy: 'Product ID: 336568091037\nCondition: New\nColor: White\nSetup details support easier placement, hanging, or installation.',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const highlights = result.ebayHtml.match(/<h3[^>]*>Highlights<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const bulletLines = [...highlights.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(bulletLines.length, 5);
  assert.match(bulletLines.join(' '), /Tile format|Panel format|Visible product details/i);
  assert.doesNotMatch(bulletLines.join(' '), /Product ID|Condition:|SKU|MPN|Seller|Price|Notes:/i);
});

test('homepage eBay product description shows five direct customer-facing bullets from visible title facts', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/397348619110',
    currentTitle: 'HiPer ATV TECH 3 Single Beadlock Front Wheel 10x5, 4+1, 4x156 - 1050-YPFF-SBL-BK',
    productType: 'eBay Motors|Parts & Accessories|ATV Wheels',
    currentCopy: 'Brand: HiPer\nCondition: New\nColor: Black',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const highlights = result.ebayHtml.match(/<h3[^>]*>Highlights<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const bulletLines = [...highlights.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(bulletLines.length, 5);
  assert.match(bulletLines.join(' '), /10x5|beadlock|front wheel|4\+1|4x156/i);
  assert.doesNotMatch(bulletLines.join(' '), /Product ID|Condition:|SKU|MPN|Seller|Price|Notes:/i);
  assert.doesNotMatch(bulletLines.join(' '), /helps shoppers|helps confirm|before purchase|before checkout|before ordering|verify compatibility|clear wheel-construction detail|match the wheel to the intended position|compare fitment/i);
  assert.match(bulletLines[0], /10x5 sizing provides a defined wheel dimension for compatible setups\./i);
  assert.match(bulletLines[1], /Single beadlock design supports secure tire seating for off-road use\./i);
});

test('homepage keywords and recommended fixes are product-specific instead of marketplace metadata', () => {
  const { __buildHomeOptimizer: buildHomeOptimizer } = loadHomepageOptimizer();
  const result = buildHomeOptimizer(makeFormData({
    siteUrl: 'https://www.ebay.com/itm/336568091037',
    currentTitle: 'Acoustic Wall Panel 12 x 12 12 Pack Sound Absorbing Foam Panels',
    productType: 'Musical Instruments & Gear|Pro Audio Equipment|Acoustical Treatments',
    currentCopy: 'Product ID: 336568091037 Category: Musical Instruments & Gear > Pro Audio Equipment > Acoustical Treatments Condition: New Refund: money_back Item specifics: Size: 12 x 12; Pack Count: 12 Pack; Color: Black',
    targetKeyword: '',
    goal: '',
    revenue: ''
  }));

  const keywords = result.keywordIdeas.join(' | ');
  assert.match(keywords, /acoustic wall panel/i);
  assert.match(keywords, /12 x 12|12x12/i);
  assert.match(keywords, /12 pack/i);
  assert.doesNotMatch(keywords, /product id|336568091037|category|musical|pro audio|condition|refund|money_back/i);
  assert.ok(result.keywordIdeas.length <= 8, result.keywordIdeas.join(', '));

  const fixes = result.fixes.join(' ');
  assert.match(fixes, /12 x 12|12x12/i);
  assert.match(fixes, /12 Pack/i);
  assert.match(fixes, /Acoustic Wall Panel/i);
  assert.match(fixes, /photos|condition|shipping|returns/i);
  assert.doesNotMatch(fixes, /product type, main keyword|verified specs|short buyer-facing bullets|readiness estimate/i);
});

test('homepage presents the free listing optimizer as the front door and frames paid help as implementation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<title>Free Amazon &amp; eBay Listing Optimizer|<title>Free Amazon & eBay Listing Optimizer/);
  assert.match(html, /Use the Free Optimizer|Get My Optimized Result/);
  assert.match(html, /Free diagnosis first/i);
  assert.match(html, /implementation|done-for-you/i);
  assert.doesNotMatch(html, /outsourced|offshore|AI-powered|AI tool/i);
});
