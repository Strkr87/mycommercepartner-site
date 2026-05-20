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
    image,
    description,
    source: 'ebay-item-page',
    blocked
  };
}

module.exports = { extractEbayItemId, parseEbayItemHtml };
