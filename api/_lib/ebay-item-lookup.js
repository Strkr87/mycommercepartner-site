const EBAY_ITEM_ID_RE = /(?:^|\D)(\d{9,15})(?:\D|$)/;

function extractEbayItemId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!/(^|\.)ebay\./i.test(host)) return '';
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

function getEbayCredentials(env = process.env) {
  const clientId = String(env.EBAY_CLIENT_ID || '').trim();
  const clientSecret = String(env.EBAY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    marketplaceId: String(env.EBAY_MARKETPLACE_ID || 'EBAY_US').trim() || 'EBAY_US'
  };
}

function formatAmount(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanField(value, 80);
  const amount = value.value || value.convertedFromValue || '';
  const currency = value.currency || value.convertedFromCurrency || '';
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

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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

    const itemResponse = await fetchWithTimeout(fetchImpl, `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': credentials.marketplaceId
      }
    }, options.timeoutMs || 8000);
    const itemData = await itemResponse.json().catch(() => ({}));
    if (!itemResponse.ok) {
      const apiMessage = itemData.errors?.[0]?.message || itemData.error_description || itemData.message || 'Item lookup was not available.';
      return { ok: false, source: 'ebay-api', reason: 'item-failed', status: itemResponse.status, message: cleanField(apiMessage, 180) };
    }

    const bundle = buildBrowseDetailBundle(itemData, itemId);
    if (!bundle.ok) return { ok: false, source: 'ebay-api', reason: 'no-usable-details', status: itemResponse.status };
    return bundle;
  } catch (error) {
    return { ok: false, source: 'ebay-api', reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed' };
  }
}

module.exports = {
  extractEbayItemId,
  parseEbayItemHtml,
  lookupEbayBrowseApi,
  buildBrowseDetailBundle,
  getEbayCredentials
};
