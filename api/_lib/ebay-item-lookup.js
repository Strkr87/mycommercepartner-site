const EBAY_ITEM_ID_RE = /(?:^|\D)(\d{9,15})(?:\D|$)/;

function isEbayHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  return host === 'ebay.us' || host.endsWith('.ebay.us') || /(^|\.)ebay\./i.test(host);
}

function extractEbayItemId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!isEbayHost(parsed.hostname)) return '';
    const segments = parsed.pathname.split('/').map(segment => {
      try { return decodeURIComponent(segment); } catch (_) { return segment; }
    }).filter(Boolean);
    const itmIndex = segments.findIndex(segment => /^itm$/i.test(segment));
    const candidates = itmIndex >= 0 ? segments.slice(itmIndex + 1) : segments;
    const idSegment = candidates.find(segment => /^\d{9,15}$/.test(segment));
    if (idSegment) return idSegment;
    const joined = `${parsed.pathname} ${parsed.search}`;
    const match = joined.match(EBAY_ITEM_ID_RE);
    return match ? match[1] : '';
  } catch (_) {
    if (/^\d{9,15}$/.test(raw)) return raw;
    const match = raw.match(EBAY_ITEM_ID_RE);
    return match ? match[1] : '';
  }
}

function extractEbayTitleFromUrlSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!isEbayHost(parsed.hostname)) return '';
    const segments = parsed.pathname.split('/').map(segment => {
      try { return decodeURIComponent(segment); } catch (_) { return segment; }
    }).filter(Boolean);
    const itmIndex = segments.findIndex(segment => /^itm$/i.test(segment));
    const candidates = itmIndex >= 0 ? segments.slice(itmIndex + 1) : segments;
    const slug = candidates.find(segment => segment && !/^\d{9,15}$/.test(segment) && /[a-z]/i.test(segment));
    if (!slug) return '';
    return cleanField(slug
      .replace(/[-_]+/g, ' ')
      .replace(/(?:new|used)$/i, '')
      .replace(/\s+/g, ' '), 180);
  } catch (_) {
    return '';
  }
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanField(value, max = 240) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propertyFirst = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, 'i');
    const contentFirst = new RegExp(`<meta\\b(?=[^>]*content=["']([^"']+)["'])(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`, 'i');
    const match = html.match(propertyFirst) || html.match(contentFirst);
    if (match && match[1]) return cleanField(match[1]);
  }
  return '';
}

function parseJsonLd(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decodeHtml(block[1]).trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item)) { queue.push(...item); continue; }
        const type = Array.isArray(item['@type']) ? item['@type'].join(' ') : String(item['@type'] || '');
        if (/Product|Offer/i.test(type) || item.name || item.offers) return item;
        for (const value of Object.values(item)) {
          if (value && typeof value === 'object') queue.push(value);
        }
      }
    } catch (_) {}
  }
  return null;
}

function parseEbayItemHtml(html, itemId = '') {
  const body = String(html || '');
  const jsonLd = parseJsonLd(body) || {};
  const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : (jsonLd.offers || {});
  const imageValue = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
  const rawTitle = cleanField(jsonLd.name || metaContent(body, ['og:title', 'twitter:title']) || (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const title = rawTitle
    .replace(/\s*\|\s*eBay\s*$/i, '')
    .replace(/\s*for sale online\s*$/i, '')
    .trim();
  const price = cleanField(
    (offers && (offers.price || offers.lowPrice)) ||
    metaContent(body, ['product:price:amount', 'og:price:amount', 'twitter:data1']),
    80
  );
  const condition = cleanField(
    jsonLd.itemCondition ||
    metaContent(body, ['product:condition', 'og:condition']) ||
    (body.match(/"condition"\s*:\s*"([^"]+)"/i) || [])[1] || '',
    100
  ).replace(/^https?:\/\/schema\.org\//i, '').replace(/Condition$/i, '').trim();
  const category = cleanField(
    jsonLd.category ||
    metaContent(body, ['product:category', 'og:category']) || '',
    140
  );
  const image = cleanField(imageValue || metaContent(body, ['og:image', 'twitter:image']), 500);
  const description = cleanField(jsonLd.description || metaContent(body, ['og:description', 'description', 'twitter:description']), 500);
  const blocked = /Access Denied|Pardon Our Interruption|Checking your browser/i.test(body);
  return {
    ok: Boolean(title && !/Access Denied|Pardon Our Interruption|Error Page/i.test(title)),
    itemId,
    title,
    price,
    condition,
    category,
    productType: category || 'eBay listing',
    image,
    description,
    source: 'ebay-item-page',
    detailCount: [title, price, condition, category, image, description].filter(Boolean).length,
    blocked
  };
}

function extractEbayItemIdFromHtml(html) {
  const body = String(html || '');
  const canonical = cleanField(
    (body.match(/<link\b(?=[^>]*rel=["']canonical["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i) || [])[1] ||
    metaContent(body, ['og:url']),
    500
  );
  if (canonical) {
    const canonicalId = extractEbayItemId(canonical);
    if (canonicalId) return canonicalId;
  }
  const match = body.match(/\/itm\/(?:[^"'<>/\s]+\/)?(\d{9,15})(?:[?#/"'<\s]|$)/i);
  return match ? match[1] : '';
}

function getEbayCredentials(env = process.env) {
  const clientId = String(env.EBAY_CLIENT_ID || '').trim();
  const clientSecret = String(env.EBAY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  const configuredMarketplace = String(env.EBAY_MARKETPLACE_ID || 'EBAY_US').trim() || 'EBAY_US';
  const fallbackMarketplaces = String(env.EBAY_FALLBACK_MARKETPLACE_IDS || 'EBAY_US,EBAY_GB,EBAY_AU,EBAY_CA')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return {
    clientId,
    clientSecret,
    marketplaceId: configuredMarketplace,
    marketplaceIds: [...new Set([configuredMarketplace, ...fallbackMarketplaces])]
  };
}

function formatAmount(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanField(value, 80);
  const amount = value.value || value.Value || value.convertedFromValue || '';
  const currency = value.currency || value.CurrencyID || value['@currencyId'] || value.convertedFromCurrency || '';
  return cleanField([currency, amount].filter(Boolean).join(' '), 80);
}

function formatLocation(location = {}) {
  return cleanField([
    location.city,
    location.stateOrProvince,
    location.postalCode,
    location.country
  ].filter(Boolean).join(', '), 160);
}

function formatSeller(seller = {}) {
  const parts = [];
  if (seller.username) parts.push(`Seller: ${seller.username}`);
  if (seller.feedbackPercentage) parts.push(`${seller.feedbackPercentage}% positive`);
  if (seller.feedbackScore) parts.push(`${seller.feedbackScore} feedback`);
  return cleanField(parts.join(', '), 180);
}

function formatEstimatedAvailabilities(list = []) {
  return list.map(entry => {
    const parts = [];
    if (entry.availabilityThresholdType) parts.push(entry.availabilityThresholdType);
    if (entry.availabilityThreshold !== undefined) parts.push(String(entry.availabilityThreshold));
    if (entry.estimatedAvailabilityStatus) parts.push(entry.estimatedAvailabilityStatus);
    if (entry.estimatedAvailableQuantity !== undefined) parts.push(`${entry.estimatedAvailableQuantity} available`);
    return cleanField(parts.join(' '), 120);
  }).filter(Boolean).join('; ');
}

function formatShippingOptions(list = []) {
  return list.slice(0, 3).map(option => {
    const parts = [];
    if (option.shippingServiceCode) parts.push(option.shippingServiceCode);
    if (option.type) parts.push(option.type);
    if (option.shippingCost) parts.push(formatAmount(option.shippingCost));
    if (option.minEstimatedDeliveryDate || option.maxEstimatedDeliveryDate) {
      parts.push([option.minEstimatedDeliveryDate, option.maxEstimatedDeliveryDate].filter(Boolean).join(' to '));
    }
    return cleanField(parts.join(' - '), 180);
  }).filter(Boolean).join('; ');
}

function formatReturnTerms(returnTerms = {}) {
  const parts = [];
  if (returnTerms.returnsAccepted !== undefined) parts.push(returnTerms.returnsAccepted ? 'Returns accepted' : 'Returns not accepted');
  if (returnTerms.refundMethod) parts.push(`Refund: ${returnTerms.refundMethod}`);
  if (returnTerms.returnPeriod?.value) parts.push(`${returnTerms.returnPeriod.value} ${returnTerms.returnPeriod.unit || 'days'}`);
  if (returnTerms.returnShippingCostPayer) parts.push(`Return shipping: ${returnTerms.returnShippingCostPayer}`);
  return cleanField(parts.join(', '), 180);
}

function formatAspects(aspects = []) {
  return aspects.map(aspect => {
    const name = cleanField(aspect.name, 60);
    const values = Array.isArray(aspect.value) ? aspect.value : (Array.isArray(aspect.values) ? aspect.values : []);
    const value = cleanField(values.join(', '), 120);
    return name && value ? `${name}: ${value}` : '';
  }).filter(Boolean);
}

function firstFindingValue(value) {
  if (Array.isArray(value)) return firstFindingValue(value[0]);
  return value && typeof value === 'object' && '_' in value ? value._ : value;
}

function buildFindingDetailBundle(item, itemId) {
  const title = cleanField(firstFindingValue(item.title), 240);
  const category = cleanField(firstFindingValue(item.primaryCategory?.[0]?.categoryName), 180);
  const condition = cleanField(firstFindingValue(item.condition?.[0]?.conditionDisplayName), 120);
  const priceValue = firstFindingValue(item.sellingStatus?.[0]?.currentPrice?.[0]);
  const priceCurrency = item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'] || '';
  const price = cleanField([priceCurrency, priceValue].filter(Boolean).join(' '), 80);
  const image = cleanField(firstFindingValue(item.galleryURL), 500);
  const location = cleanField([firstFindingValue(item.location), firstFindingValue(item.country)].filter(Boolean).join(', '), 160);
  const listingType = cleanField(firstFindingValue(item.listingInfo?.[0]?.listingType), 100);
  const endTime = cleanField(firstFindingValue(item.listingInfo?.[0]?.endTime), 100);
  const detailLines = [
    title && `Title: ${title}`,
    category && `Category: ${category}`,
    condition && `Condition: ${condition}`,
    price && `Price: ${price}`,
    listingType && `Listing type: ${listingType}`,
    location && `Item location: ${location}`,
    endTime && `Listing ends: ${endTime}`
  ].filter(Boolean);
  return {
    ok: Boolean(title && detailLines.length >= 2),
    source: 'ebay-finding-api',
    itemId,
    title,
    productType: category || 'eBay listing',
    category,
    condition,
    price,
    buyingOptions: listingType,
    availability: '',
    seller: '',
    itemLocation: location,
    shipping: '',
    returnTerms: '',
    subtitle: '',
    image,
    itemSpecifics: [],
    description: cleanField(detailLines.join(' | '), 1200),
    detailCount: detailLines.length
  };
}

function buildBrowseDetailBundle(item, itemId) {
  const aspects = formatAspects(item.localizedAspects || item.itemSpecifics || []);
  const category = cleanField(item.categoryPath || item.category?.categoryName || '', 180);
  const condition = cleanField(item.condition || item.conditionDescription || '', 120);
  const price = formatAmount(item.price);
  const seller = formatSeller(item.seller || {});
  const location = formatLocation(item.itemLocation || {});
  const availability = formatEstimatedAvailabilities(item.estimatedAvailabilities || []);
  const shipping = formatShippingOptions(item.shippingOptions || []);
  const returns = formatReturnTerms(item.returnTerms || {});
  const buyingOptions = Array.isArray(item.buyingOptions) ? item.buyingOptions.join(', ') : '';
  const subtitle = cleanField(item.subtitle || item.shortDescription || '', 500);
  const title = cleanField(item.title, 240);

  const detailLines = [
    title && `Title: ${title}`,
    category && `Category: ${category}`,
    condition && `Condition: ${condition}`,
    price && `Price: ${price}`,
    buyingOptions && `Buying options: ${buyingOptions}`,
    availability && `Availability: ${availability}`,
    seller,
    location && `Item location: ${location}`,
    shipping && `Shipping: ${shipping}`,
    returns && `Returns: ${returns}`,
    subtitle && `Listing notes: ${subtitle}`,
    aspects.length ? `Item specifics: ${aspects.slice(0, 12).join('; ')}` : ''
  ].filter(Boolean);

  const image = cleanField(item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || item.additionalImages?.[0]?.imageUrl || '', 500);
  const productType = category || item.category?.categoryName || 'eBay listing';
  return {
    ok: Boolean(title && detailLines.length >= 2),
    source: 'ebay-api',
    itemId,
    title,
    productType,
    category,
    condition,
    price,
    buyingOptions,
    availability,
    seller: cleanField(seller.replace(/^Seller:\s*/i, ''), 180),
    itemLocation: location,
    shipping,
    returnTerms: returns,
    subtitle,
    image,
    itemSpecifics: aspects.slice(0, 20),
    description: cleanField(detailLines.join(' | '), 1200),
    detailCount: detailLines.length + aspects.length
  };
}

function buildShoppingDetailBundle(item = {}, itemId = '') {
  const specifics = [];
  const rawSpecifics = item.ItemSpecifics?.NameValueList || item.ItemSpecifics || [];
  for (const entry of Array.isArray(rawSpecifics) ? rawSpecifics : []) {
    const name = cleanField(entry.Name || entry.name, 60);
    const values = Array.isArray(entry.Value) ? entry.Value : (Array.isArray(entry.value) ? entry.value : [entry.Value || entry.value]);
    const value = cleanField(values.filter(Boolean).join(', '), 120);
    if (name && value) specifics.push(`${name}: ${value}`);
  }

  const title = cleanField(item.Title || item.title, 240);
  const category = cleanField(item.PrimaryCategoryName || item.PrimaryCategoryID || '', 180);
  const condition = cleanField(item.ConditionDisplayName || item.ConditionDescription || item.ConditionID || '', 120);
  const price = cleanField(formatAmount(item.ConvertedCurrentPrice || item.CurrentPrice || item.MinimumToBid), 80);
  const seller = cleanField([
    item.Seller?.UserID && `Seller: ${item.Seller.UserID}`,
    item.Seller?.PositiveFeedbackPercent && `${item.Seller.PositiveFeedbackPercent}% positive`,
    item.Seller?.FeedbackScore && `${item.Seller.FeedbackScore} feedback`
  ].filter(Boolean).join(', '), 180);
  const location = cleanField([item.Location, item.PostalCode, item.Country].filter(Boolean).join(', '), 160);
  const shippingCost = item.ShippingCostSummary?.ShippingServiceCost || item.ShippingDetails?.ShippingServiceOptions?.[0]?.ShippingServiceCost;
  const shipping = cleanField(formatAmount(shippingCost), 180);
  const returns = cleanField(item.ReturnPolicy?.ReturnsAccepted || item.ReturnPolicy?.ReturnsWithin || '', 180);
  const subtitle = cleanField(item.Subtitle || item.Description || '', 500);
  const image = cleanField(item.PictureURL?.[0] || item.GalleryURL || item.ViewItemURLForNaturalSearch || '', 500);
  const buyingOptions = cleanField(item.ListingType || item.BuyItNowAvailable && 'Buy It Now' || '', 120);

  const detailLines = [
    title && `Title: ${title}`,
    category && `Category: ${category}`,
    condition && `Condition: ${condition}`,
    price && `Price: ${price}`,
    buyingOptions && `Listing type: ${buyingOptions}`,
    seller,
    location && `Item location: ${location}`,
    shipping && `Shipping: ${shipping}`,
    returns && `Returns: ${returns}`,
    subtitle && `Listing notes: ${subtitle}`,
    specifics.length ? `Item specifics: ${specifics.slice(0, 12).join('; ')}` : ''
  ].filter(Boolean);

  return {
    ok: Boolean(title && detailLines.length >= 2),
    source: 'ebay-shopping-api',
    itemId,
    title,
    productType: category || 'eBay listing',
    category,
    condition,
    price,
    buyingOptions,
    availability: '',
    seller: cleanField(seller.replace(/^Seller:\s*/i, ''), 180),
    itemLocation: location,
    shipping,
    returnTerms: returns,
    subtitle,
    image,
    itemSpecifics: specifics.slice(0, 20),
    description: cleanField(detailLines.join(' | '), 1200),
    detailCount: detailLines.length + specifics.length
  };
}

function itemMatchesLegacyId(item = {}, itemId = '') {
  const legacyId = String(item.legacyItemId || item.itemId || '').trim();
  if (legacyId === itemId) return true;
  return legacyId.includes(itemId);
}

async function fetchBrowseJson(fetchImpl, url, token, marketplaceId, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId
    }
  }, timeoutMs);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function lookupEbayFindingApi(itemId, credentials, options = {}) {
  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, source: 'ebay-finding-api', reason: 'fetch-unavailable' };
  const globalIds = [...new Set((options.globalIds || ['EBAY-US', 'EBAY-GB', 'EBAY-AU', 'EBAY-ENCA']).filter(Boolean))];
  for (const globalId of globalIds) {
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findItemsByKeywords',
      'SERVICE-VERSION': '1.13.0',
      'SECURITY-APPNAME': credentials.clientId,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      'GLOBAL-ID': globalId,
      keywords: itemId,
      'paginationInput.entriesPerPage': '10'
    });
    const response = await fetchWithTimeout(fetchImpl, `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, options.timeoutMs || 8000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) continue;
    const items = data.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item || [];
    const matched = items.find(item => String(firstFindingValue(item.itemId)).trim() === itemId) || (items.length === 1 ? items[0] : null);
    if (matched) {
      const bundle = buildFindingDetailBundle(matched, itemId);
      if (bundle.ok) return { ...bundle, globalId };
    }
  }
  return { ok: false, source: 'ebay-finding-api', reason: 'no-results' };
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveEbayItemUrl(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, source: 'ebay-url-resolver', reason: 'missing-url' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { ok: false, source: 'ebay-url-resolver', reason: 'invalid-url' };
  }
  if (!isEbayHost(parsed.hostname)) {
    return { ok: false, source: 'ebay-url-resolver', reason: 'not-ebay-url' };
  }

  const directItemId = extractEbayItemId(raw);
  if (directItemId) {
    return { ok: true, source: 'ebay-url-resolver', itemId: directItemId, url: raw, html: '' };
  }

  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, source: 'ebay-url-resolver', reason: 'fetch-unavailable' };
  }

  try {
    const response = await fetchWithTimeout(fetchImpl, raw, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    }, options.timeoutMs || 9000);
    const html = await response.text().catch(() => '');
    const finalUrl = String(response.url || raw);
    const itemId = extractEbayItemId(finalUrl) || extractEbayItemIdFromHtml(html);
    return {
      ok: Boolean(itemId),
      source: 'ebay-url-resolver',
      itemId,
      url: finalUrl,
      html,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      source: 'ebay-url-resolver',
      reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed'
    };
  }
}

async function lookupEbayShoppingApi(itemId, credentials, options = {}) {
  if (!credentials?.clientId) return { ok: false, source: 'ebay-shopping-api', reason: 'missing-credentials' };
  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, source: 'ebay-shopping-api', reason: 'fetch-unavailable' };
  const accessToken = String(options.accessToken || '').trim();

  try {
    const params = new URLSearchParams({
      callname: 'GetSingleItem',
      responseencoding: 'JSON',
      appid: credentials.clientId,
      siteid: '0',
      version: '1199',
      ItemID: itemId,
      IncludeSelector: 'Details,Description,ItemSpecifics,ShippingCosts'
    });
    const response = await fetchWithTimeout(fetchImpl, `https://open.api.ebay.com/shopping?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { 'X-EBAY-API-IAF-TOKEN': accessToken } : {})
      }
    }, options.timeoutMs || 8000);
    const data = await response.json().catch(() => ({}));
    const item = data.Item || data.item;
    if (!response.ok || !item) {
      const reason = data.Errors?.[0]?.ShortMessage || data.Errors?.ShortMessage || data.Ack || 'no-item';
      console.warn('[ebay-shopping-api] lookup failed', { itemId, status: response.status, reason });
      return {
        ok: false,
        source: 'ebay-shopping-api',
        reason,
        status: response.status
      };
    }
    const bundle = buildShoppingDetailBundle(item, itemId);
    return bundle.ok ? bundle : { ok: false, source: 'ebay-shopping-api', reason: 'no-usable-details' };
  } catch (error) {
    return { ok: false, source: 'ebay-shopping-api', reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed' };
  }
}

async function lookupEbayBrowseApi(itemId, options = {}) {
  const env = options.env || process.env;
  const credentials = getEbayCredentials(env);
  if (!credentials) return { ok: false, source: 'ebay-api', reason: 'missing-credentials' };

  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, source: 'ebay-api', reason: 'fetch-unavailable' };

  try {
    const basicToken = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    const tokenResponse = await fetchWithTimeout(fetchImpl, 'https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }).toString()
    }, options.timeoutMs || 8000);
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      return { ok: false, source: 'ebay-api', reason: 'token-failed', status: tokenResponse.status, message: cleanField(tokenData.error_description || tokenData.error || 'Unable to authorize eBay lookup.', 180) };
    }

    const failures = [];
    for (const marketplaceId of credentials.marketplaceIds) {
      const { response: itemResponse, data: itemData } = await fetchBrowseJson(
        fetchImpl,
        `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`,
        tokenData.access_token,
        marketplaceId,
        options.timeoutMs || 8000
      );
      if (itemResponse.ok) {
        const bundle = buildBrowseDetailBundle(itemData, itemId);
        if (bundle.ok) return { ...bundle, marketplaceId };
        failures.push({ marketplaceId, status: itemResponse.status, reason: 'no-usable-details' });
      } else {
        const apiMessage = itemData.errors?.[0]?.message || itemData.error_description || itemData.message || 'Item lookup was not available.';
        failures.push({ marketplaceId, status: itemResponse.status, message: cleanField(apiMessage, 180) });
      }
    }

    for (const marketplaceId of credentials.marketplaceIds) {
      const { response: searchResponse, data: searchData } = await fetchBrowseJson(
        fetchImpl,
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(itemId)}&limit=10`,
        tokenData.access_token,
        marketplaceId,
        options.timeoutMs || 8000
      );
      if (!searchResponse.ok) continue;
      const summaries = Array.isArray(searchData.itemSummaries) ? searchData.itemSummaries : [];
      const matched = summaries.find(item => itemMatchesLegacyId(item, itemId)) || (summaries.length === 1 ? summaries[0] : null);
      if (matched) {
        const bundle = buildBrowseDetailBundle(matched, itemId);
        if (bundle.ok) return { ...bundle, source: 'ebay-api-search', marketplaceId };
      }
    }

    const shoppingResult = await lookupEbayShoppingApi(itemId, credentials, { ...options, accessToken: tokenData.access_token });
    if (shoppingResult.ok && shoppingResult.title) return shoppingResult;

    const findingResult = await lookupEbayFindingApi(itemId, credentials, options);
    if (findingResult.ok && findingResult.title) return findingResult;

    const lastFailure = failures[failures.length - 1] || {};
    return {
      ok: false,
      source: 'ebay-api',
      reason: lastFailure.reason || 'item-failed',
      status: lastFailure.status,
      message: lastFailure.message || 'Item lookup was not available across supported eBay marketplaces.'
    };
  } catch (error) {
    return { ok: false, source: 'ebay-api', reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed' };
  }
}

async function searchEbayBrowseApi(query, options = {}) {
  const term = cleanField(query, 160);
  if (!term) return { ok: false, source: 'ebay-api-search', reason: 'missing-query' };

  const env = options.env || process.env;
  const credentials = getEbayCredentials(env);
  if (!credentials) return { ok: false, source: 'ebay-api-search', reason: 'missing-credentials' };

  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, source: 'ebay-api-search', reason: 'fetch-unavailable' };

  try {
    const basicToken = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    const tokenResponse = await fetchWithTimeout(fetchImpl, 'https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }).toString()
    }, options.timeoutMs || 8000);
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      return { ok: false, source: 'ebay-api-search', reason: 'token-failed', status: tokenResponse.status };
    }

    const normalizedTerm = term.toLowerCase();
    for (const marketplaceId of credentials.marketplaceIds) {
      const params = new URLSearchParams({ q: term, limit: String(options.limit || 5) });
      const { response, data } = await fetchBrowseJson(
        fetchImpl,
        `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
        tokenData.access_token,
        marketplaceId,
        options.timeoutMs || 8000
      );
      if (!response.ok) continue;
      const summaries = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
      const matched = summaries.find(item => String(item.title || '').toLowerCase().includes(normalizedTerm)) || summaries[0];
      if (matched) {
        const bundle = buildBrowseDetailBundle(matched, String(matched.legacyItemId || matched.itemId || ''));
        if (bundle.ok) return { ...bundle, source: 'ebay-api-search', marketplaceId, query: term };
      }
    }
    return { ok: false, source: 'ebay-api-search', reason: 'no-results' };
  } catch (error) {
    return { ok: false, source: 'ebay-api-search', reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed' };
  }
}

module.exports = {
  extractEbayItemId,
  extractEbayTitleFromUrlSlug,
  resolveEbayItemUrl,
  parseEbayItemHtml,
  lookupEbayBrowseApi,
  lookupEbayShoppingApi,
  searchEbayBrowseApi,
  buildBrowseDetailBundle,
  buildShoppingDetailBundle,
  buildFindingDetailBundle,
  getEbayCredentials
};
