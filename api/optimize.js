const TRIAL_LIMIT = 2;
const { authEnabled, getUserFromToken, getProfile, upsertProfile, applyCreditUse, creditState, ensureBillingPeriod } = require("../lib/platform");
const { extractEbayItemId, extractEbayTitleFromUrlSlug, parseEbayItemHtml, lookupEbayBrowseApi } = require("./_lib/ebay-item-lookup");

function pick(rx, s) {
  return (s.match(rx) || [, ""])[1];
}

function skuBits(s) {
  return (s || "")
    .split(/[|,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function rxEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanMarketplaceText(value) {
  return (value || "")
    .replace(/[|>]+/g, " ")
    .replace(/\b(?:condition|price):\s*[^\n|,;]+/ig, " ")
    .replace(/\b(?:free shipping|100% quality guaranteed|quality guaranteed|best seller|official site|buy online)\b/ig, " ")
    .replace(/\bUSD\s*\d+(?:\.\d{2})?\b/ig, " ")
    .replace(/\$\s*\d+(?:\.\d{2})?\b/g, " ")
    .replace(/[{}_^~¬¦!$?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return cleanMarketplaceText(value).replace(/\b[a-z][a-z0-9'/-]*\b/gi, (word) => {
    if (/^(and|or|for|with|of|to|in|the)$/i.test(word)) return word.toLowerCase();
    if (/^(oz|lb|lbs|ft|in)$/i.test(word)) return word.toLowerCase();
    if (/^(bpa|usb|led|uv|pvc|hdpe|hepa|ssd|ram|gps|wifi|imei)$/i.test(word)) return word.toUpperCase();
    if (/^\d/.test(word) || /^[A-Z0-9-]{3,}$/.test(word) || /[A-Z].*[A-Z]/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function parseSpecifics(value) {
  const out = {};
  for (const line of String(value || "").split(/\n+/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    out[match[1].trim().toLowerCase()] = cleanMarketplaceText(match[2]);
  }
  return out;
}

function specValue(specs, names) {
  for (const name of names) {
    const value = specs[name.toLowerCase()];
    if (value) return value;
  }
  return "";
}

function factValue(data, facts, names) {
  for (const name of names) {
    const value = specValue(facts, [name]);
    if (value) return value;
  }
  const source = `${data.specifics || ""}\n${data.description || ""}`;
  for (const name of names) {
    const match = source.match(new RegExp(`(?:^|\\n)\\s*${rxEscape(name)}\\s*:\\s*([^\\n]+)`, "i"));
    if (match) return cleanMarketplaceText(match[1]);
  }
  return "";
}

function primaryFacts(data) {
  const facts = parseSpecifics(data.specifics || "");
  return {
    facts,
    sku: cleanMarketplaceText((data.sku || "").trim() || factValue(data, facts, ["SKU", "MPN", "Manufacturer Part Number", "eBay Item ID", "Item ID"])),
    model: cleanMarketplaceText(factValue(data, facts, ["Model", "Model Number", "MPN", "Manufacturer Part Number"])),
    storageSize: cleanMarketplaceText(factValue(data, facts, ["Storage Capacity", "Storage", "Size", "Capacity", "Dimensions", "Pack Count", "Quantity", "Weight", "Coverage"])),
    compatibility: cleanMarketplaceText(factValue(data, facts, ["Compatibility", "Compatible Brand", "Compatible Model", "Network", "Carrier"])),
    included: cleanMarketplaceText(factValue(data, facts, ["Included", "Included Accessories", "Items Included", "What's Included"])),
    shippingReturns: String(factValue(data, facts, ["Shipping", "Returns", "Return Policy"]) || data.shipping || "").replace(/\s+/g, " ").trim(),
    condition: cleanMarketplaceText(factValue(data, facts, ["Condition", "Cosmetic Condition", "Condition Notes"]) || data.condition || "")
  };
}

function sentence(value) {
  const text = String(value || "").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function bulletProductName(data) {
  const product = compactProductType(data);
  return /^(?:product|item|marketplace listing|amazon listing|ebay listing)$/i.test(product)
    ? "item"
    : product.toLowerCase();
}

function factBullets(data) {
  const exact = primaryFacts(data);
  const product = bulletProductName(data);
  const lines = [];
  const modelParts = [exact.model, exact.sku].filter(Boolean);

  if (modelParts.length) {
    lines.push(`Model / SKU: ${modelParts.join(" / ")} for exact-match searches and compatibility checks`);
  }
  if (exact.storageSize) {
    lines.push(`Size / storage / pack count: ${exact.storageSize} so shoppers can compare the ${product} against similar options quickly`);
  }
  if (exact.compatibility) {
    lines.push(`Compatibility: ${exact.compatibility} to help buyers confirm fit, carrier support, or supported models before purchase`);
  }
  if (exact.included) {
    lines.push(`Included items: ${exact.included} so buyers know what is in the box before checkout`);
  }
  if (exact.shippingReturns) {
    lines.push(`Shipping / returns: ${exact.shippingReturns} to make delivery and return expectations clear before checkout`);
  }
  if (exact.condition) {
    lines.push(`Condition: ${exact.condition} disclosed in the description so buyers know what to expect without using title space`);
  }

  return lines.map(sentence);
}

function categoryWords(category) {
  return (category || "")
    .split(/[|>]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isOutOfStock(data) {
  const source = `${data.availability || ""}\n${data.specifics || ""}\n${data.description || ""}`;
  return /OUT_OF_STOCK|out\s+of\s+stock|Available Quantity:\s*0|estimatedAvailableQuantity[^\d]*0/i.test(source);
}

function productPhrase(data) {
  const title = cleanMarketplaceText(data.title || "");
  const cats = categoryWords(data.category);
  let phrase = title;
  for (const cat of cats) phrase = phrase.replace(new RegExp(rxEscape(cat), "ig"), " ");
  const model = pick(/Model:\s*([^\n]+)/i, data.specifics || "");
  if (data.brand) phrase = phrase.replace(new RegExp(rxEscape(data.brand), "ig"), " ");
  if (model) phrase = phrase.replace(new RegExp(rxEscape(model), "ig"), " ");
  phrase = phrase
    .replace(/\b(?:cleaner|new|used|open box|very good|good condition|good|acceptable|condition|refurbished|seller refurbished|for parts)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();

  const compact = `${title} ${data.description || ""} ${data.category || ""}`;
  if (/robot|vacuum/i.test(compact)) return "Robot Vacuum";
  if (/water bottle|bottle|tumbler/i.test(compact)) return "40 oz Stainless Steel Insulated Water Bottle";
  if (phrase) return phrase.split(" ").slice(0, 8).join(" ");
  return cats[cats.length - 1] || "Product";
}

function descriptionFeatures(data) {
  const source = `${data.title || ""}\n${data.specifics || ""}\n${data.description || ""}`;
  const features = [];
  const add = (rx, line) => { if (rx.test(source) && !features.includes(line)) features.push(line); };
  add(/360|vision|navigation|nav/i, "360 vision navigation helps the vacuum map rooms and clean with less guesswork");
  add(/edge/i, "Edge-cleaning design helps pick up dust along walls and room corners");
  add(/HEPA|filter/i, "HEPA filtration helps trap fine dust while it cleans your floors");
  add(/app|wifi|control/i, "App control lets you start, schedule, and manage cleaning from your phone");
  add(/insulat|cold|hot/i, "Double-wall insulation helps keep drinks cold or hot through busy days");
  add(/leak|lid|straw/i, "Leak-resistant lid and straw make it easier to carry between work, gym, and travel");
  add(/stainless/i, "Stainless steel build gives everyday durability without a fragile feel");
  return features;
}

function joinTitleParts(parts, max) {
  const clean = [];
  for (const part of parts) {
    const value = cleanMarketplaceText(part);
    if (!value) continue;
    const key = value.toLowerCase();
    if (clean.some((x) => x.toLowerCase() === key)) continue;
    clean.push(value);
  }
  let title = clean.join(" - ");
  if (max && title.length > max) {
    const id = clean[clean.length - 1];
    const suffix = id && /^[A-Z0-9-]{6,}$/i.test(id) ? ` - ${id}` : "";
    const available = max - suffix.length;
    title = `${title.slice(0, available).replace(/\s+\S*$/, "").replace(/[,-]\s*$/, "").trim()}${suffix}`;
  }
  return title;
}

function build80(tokens, fallback) {
  let title = "";
  const clean = [...new Set(tokens.map((x) => (x || "").replace(/\s+/g, " ").trim()).filter(Boolean))];

  for (const token of clean) {
    const next = title ? `${title} ${token}` : token;
    if (next.length <= 80) title = next;
  }

  if (title.length >= 72) return title;

  const extras = (fallback || "")
    .replace(/[|,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((word) => !/^(good|very|condition|used|new|open|box|acceptable|refurbished|seller|parts)$/i.test(word));

  for (const word of extras) {
    const lower = word.toLowerCase();
    if (clean.some((token) => token.toLowerCase().includes(lower))) continue;
    const next = title ? `${title} ${word}` : word;
    if (next.length <= 80) title = next;
    else break;
    if (title.length >= 78) break;
  }

  return title.slice(0, 80).trim();
}

function compactProductType(data) {
  const source = `${data.title || ""} ${data.category || ""} ${data.description || ""} ${data.specifics || ""}`;
  if (/robot|vacuum/i.test(source)) return "Robot Vacuum";
  if (/water bottle|bottle|tumbler/i.test(source)) return "Water Bottle";
  if (/cell phones?|smartphones?|iphone|android/i.test(source)) return "Smartphone";
  if (/laptop|notebook/i.test(source)) return "Laptop";
  if (/watch|smartwatch/i.test(source)) return "Smart Watch";
  return productPhrase(data);
}

function normalizeTitleWords(value) {
  const counts = new Map();
  const keep = new Set(["for", "with", "and", "or", "the", "of", "to", "in"]);
  return titleCase(value)
    .split(/\s+/)
    .filter((word) => {
      const key = word.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!key || keep.has(key)) return true;
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      return next <= 2;
    })
    .join(" ")
    .replace(/\s+,\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function fitTitleParts(parts, max, suffix = "") {
  const clean = [];
  for (const part of parts) {
    const value = normalizeTitleWords(part);
    if (!value) continue;
    const key = value.toLowerCase();
    if (clean.some((x) => x.toLowerCase() === key || key.includes(x.toLowerCase()) || x.toLowerCase().includes(key))) continue;
    clean.push(value);
  }
  let title = "";
  const available = suffix ? max - suffix.length : max;
  for (const part of clean) {
    const next = title ? `${title} ${part}` : part;
    if (next.length <= available) title = next;
  }
  return `${title.trim()}${suffix}`.trim();
}

function useCasesFromText(text) {
  const source = String(text || "").toLowerCase();
  return ["gym", "office", "hiking", "travel", "commute", "camping", "home", "patio", "garden", "pets", "jobsite"]
    .filter((term) => source.includes(term))
    .slice(0, 4);
}

function buildAmazonMarketplaceTitle(data, facts, brand, id) {
  const product = compactProductType(data);
  const capacity = specValue(facts, ["Capacity", "Size"]);
  const material = specValue(facts, ["Material"]);
  const color = specValue(facts, ["Color"]);
  const included = specValue(facts, ["Included", "Included Accessories"]);
  const model = specValue(facts, ["Model"]);
  const source = `${data.title || ""} ${data.description || ""} ${data.specifics || ""}`;
  const insulated = /insulat|cold|hot/i.test(source) && !/insulated/i.test(`${material} ${product}`) ? "Insulated" : "";
  const leak = /leak/i.test(source) ? "Leak-Resistant" : "";
  const includedTitle = /straw/i.test(included || source) ? "Straw Lid" : included;
  const useCases = useCasesFromText(source);
  const main = [capacity, material, product].filter(Boolean).join(" ");
  const suffix = id ? ` - ${id}` : "";
  const title = fitTitleParts([
    brand,
    main,
    model && !main.toLowerCase().includes(model.toLowerCase()) ? model : "",
    includedTitle,
    insulated,
    leak,
    color,
    useCases.length ? `for ${useCases.map(titleCase).join(", ")}` : ""
  ], 200, suffix);
  return title || joinTitleParts([brand, product, id], 200);
}

function buildEbayMarketplaceTitle(data, facts, brand, id) {
  const source = `${data.title || ""} ${data.category || ""} ${data.description || ""} ${data.specifics || ""}`;
  const model = specValue(facts, ["Model"]);
  const storage = specValue(facts, ["Storage Capacity", "Storage"]);
  const network = specValue(facts, ["Network", "Carrier"]);
  const color = specValue(facts, ["Color"]);
  const product = compactProductType(data);
  const suffix = id ? ` - ${id}` : "";

  if (/cell phones?|smartphones?|iphone/i.test(source)) {
    return fitTitleParts([brand, model, storage, network, color], 80, suffix);
  }

  if (/robot|vacuum/i.test(source)) {
    const leading = [brand, model, product].filter(Boolean).join(" ");
    return joinTitleParts([leading, id], 80);
  }

  const material = specValue(facts, ["Material"]);
  const capacity = specValue(facts, ["Capacity", "Size"]);
  return fitTitleParts([brand, model, capacity, material, product, color], 80, suffix);
}

function titleAI(data) {
  const bits = skuBits(data.sku);
  const facts = parseSpecifics(data.specifics || "");
  const brand = cleanMarketplaceText((data.brand || "").trim() || specValue(facts, ["Brand"]));
  const marketplace = String(data.marketplace || data.channel || "");
  const id = bits[0] || "";

  if (/amazon/i.test(marketplace)) {
    return buildAmazonMarketplaceTitle(data, facts, brand, id);
  }

  if (/ebay/i.test(marketplace) || /[|>]/.test(data.category || "")) {
    const title = buildEbayMarketplaceTitle(data, facts, brand, id);
    if (title) return title;
  }

  let tokens = [];

  if (data.category === "Cell Phones & Smartphones") {
    tokens = [
      brand,
      specValue(facts, ["Model"]),
      specValue(facts, ["Storage Capacity", "Storage"]),
      specValue(facts, ["Carrier", "Network"]),
      specValue(facts, ["Color"])
    ];
    const battery = specValue(facts, ["Battery Health"]);
    if (battery) tokens.push(`${battery} Battery`);
    tokens = tokens.concat(bits);
  } else if (data.category === "Fashion") {
    tokens = [
      brand,
      specValue(facts, ["Model"]),
      specValue(facts, ["Department"]),
      `Size ${specValue(facts, ["US Shoe Size", "Size"])}`,
      specValue(facts, ["Color"]),
      "Sneakers"
    ].concat(bits);
  } else {
    tokens = [brand, specValue(facts, ["Model"])].concat(bits);
    if (tokens.filter(Boolean).length < 2) return cleanMarketplaceText(data.title || "").slice(0, 80);
  }

  return build80(tokens, data.title || "");
}

function bullets(data) {
  const exactLines = factBullets(data);
  const product = compactProductType(data);
  const featureLines = descriptionFeatures(data);
  const lines = exactLines.concat(featureLines.map(sentence));
  if (!lines.length) lines.push(`${product} details are organized so buyers can compare the listing faster.`);
  return lines
    .filter(Boolean)
    .filter((line, index, arr) => arr.findIndex((x) => x.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 6);
}

function score(data) {
  let seo = 58;
  let conv = 55;
  let comp = 50;

  if ((data.title || "").length >= 55) seo += 10;
  if ((data.title || "").length <= 80) seo += 7;
  if (/unlocked|size|brand|model|color|storage|sneakers|iphone|nike/i.test(data.title || "")) seo += 8;
  if ((data.specifics || "").split("\n").length >= 5) seo += 9;
  if ((data.sku || "").trim()) seo += 8;
  if (/free|returns|day|shipping/i.test(data.shipping || "")) conv += 10;
  if (/tested|authentic|fully working|clean|fast/i.test(data.description || "")) conv += 8;
  if (/condition|wear|battery|included|box|photos/i.test((data.description || "") + (data.specifics || ""))) conv += 9;
  if ((data.goals || "").length > 40) comp += 10;
  if ((data.description || "").length > 120) comp += 12;
  if ((data.specifics || "").length > 60) comp += 16;
  if (isOutOfStock(data)) {
    seo -= 10;
    conv -= 18;
    comp -= 8;
  }

  seo = Math.max(20, Math.min(seo, 96));
  conv = Math.max(20, Math.min(conv, 95));
  comp = Math.max(20, Math.min(comp, 95));

  return { seo, conv, all: Math.round((seo + conv + comp) / 3) };
}

function buildResult(data) {
  const scores = score(data);
  const title = titleAI(data);
  const bulletItems = bullets(data);
  const exact = primaryFacts(data);
  const specifics = (data.specifics || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if ((data.brand || "").trim() && !specifics.some((x) => /^Brand:/i.test(x))) {
    specifics.unshift(`Brand: ${data.brand}`);
  }
  if ((data.sku || "").trim() && !specifics.some((x) => /^(SKU|Model #|MPN|Manufacturer Part Number):/i.test(x))) {
    specifics.push(`SKU / Model #: ${data.sku}`);
  }
  if (!specifics.some((x) => /^Cosmetic Condition:/i.test(x))) {
    specifics.push(`Cosmetic Condition: ${data.condition.replace("Used - ", "")} with visible signs of normal handling`);
  }
  if (!specifics.some((x) => /^Shipping:/i.test(x))) {
    specifics.push(`Shipping: ${data.shipping || "Calculated at checkout"}`);
  }

  const battery = pick(/Battery Health:\s*([^\n]+)/i, data.specifics || "");
  const notes = exact.condition || pick(/Condition Notes:\s*([^\n]+)/i, data.specifics || "") || "normal signs of use";
  const included = exact.included || "items shown in photos";

  const specificationLines = specifics.map((x) => `- ${x}`).join("\n");
  const exactFactLines = [
    exact.model && `Model: ${exact.model}`,
    exact.sku && `SKU / item ID: ${exact.sku}`,
    exact.storageSize && `Storage / size / pack count: ${exact.storageSize}`,
    exact.compatibility && `Compatibility: ${exact.compatibility}`,
    exact.included && `Included items: ${exact.included}`,
    exact.shippingReturns && `Shipping / returns: ${exact.shippingReturns}`,
    exact.condition && `Condition: ${exact.condition}`
  ].filter(Boolean).map((x) => `- ${x}`).join("\n");
  const description = `${title}. Clear product facts are shown up front so buyers can confirm fit, contents, and checkout expectations quickly.\n\nExact facts:\n${exactFactLines || "- Add model, size, compatibility, included items, shipping, and condition details for a stronger description."}${battery ? `\n- Battery health: ${battery}` : ""}\n\nCondition note:\n${notes}.\n\nIncluded:\n${included}.\n\nHighlights:\n${bulletItems.map((x) => `- ${x}`).join("\n")}\n\nItem specifications:\n${specificationLines}\n\nShipping and support:\n${exact.shippingReturns || data.shipping || "Calculated at checkout"}.\n\nPlease review photos carefully and message with any fit, compatibility, or condition questions before purchase.`;

  const actions = [
    (data.sku || "").trim()
      ? "Keep the strongest SKU or model number visible in the title or first detail line so exact-match buyers can qualify it faster."
      : (data.title || "").length > 75
        ? "Shorten the title slightly so important keywords stay visible on mobile."
        : "Move the strongest buyer-intent phrase to the front of the title.",
    /return/i.test(exact.shippingReturns || "")
      ? "Repeat your shipping and returns offer inside the description, not just near price."
      : "Add a clear returns promise to strengthen trust and reduce hesitation.",
    exact.included || /included|box|cable|accessories/i.test((data.description || "") + (data.specifics || ""))
      ? "Keep included accessories near the top so buyers qualify themselves faster."
      : "State exactly what is included to cut down on buyer questions.",
    exact.compatibility
      ? "Keep compatibility details in item specifics and bullets so buyers can confirm fit without messaging first."
      : "Add compatibility, carrier, fitment, or supported-model details when they matter.",
    exact.condition
      ? "Keep condition details in bullets and description instead of using title space for condition words."
      : "Add specific condition language so buyers trust what they are getting."
  ];

  const warnings = isOutOfStock(data)
    ? "Out of stock: this listing shows 0 available, so buyers may not be able to purchase until inventory is restored."
    : "";

  return {
    scores,
    title,
    specifics: specifics.join("\n"),
    bullets: bulletItems.map((x) => `- ${x}`).join("\n"),
    description,
    warnings,
    actions: actions.map((x, i) => `${i + 1}. ${x}`).join("\n"),
    next: `Suggested next modules:\n- Bulk optimizer for ${(data.category || "inventory").toLowerCase()} inventory\n- Competitor title gap detection\n- Saved prompts for repeatable ${String(data.condition || "").toLowerCase()} inventory\n- Team review workflow before publish\n- Seller analytics tied to listing score changes`
  };
}

async function fetchSubmittedEbayListing(listingUrl) {
  const inputUrl = String(listingUrl || "").trim();
  const itemId = extractEbayItemId(inputUrl);
  if (!itemId) return null;

  const apiResult = await lookupEbayBrowseApi(itemId);
  if (apiResult.ok && apiResult.title) return apiResult;

  try {
    const response = await fetch(`https://www.ebay.com/itm/${encodeURIComponent(itemId)}`, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache"
      }
    });
    const html = await response.text();
    const parsed = parseEbayItemHtml(html, itemId);
    if (parsed.ok && parsed.title) return parsed;
  } catch (_) {}

  const slugTitle = extractEbayTitleFromUrlSlug(inputUrl);
  return slugTitle ? {
    ok: true,
    itemId,
    title: slugTitle,
    productType: "eBay listing",
    category: "",
    condition: "",
    price: "",
    itemSpecifics: [],
    description: `Title: ${slugTitle}`
  } : null;
}

function mergeEbayListingData(data, listing) {
  if (!listing || !listing.ok) return data;
  const next = { ...data };
  if (!String(next.title || "").trim() && listing.title) next.title = listing.title;
  if (!String(next.sku || "").trim() && listing.itemId) next.sku = listing.itemId;
  if (!String(next.category || "").trim() && (listing.category || listing.productType)) next.category = listing.category || listing.productType;
  if (!String(next.condition || "").trim() && listing.condition) next.condition = listing.condition;
  if (!String(next.price || "").trim() && listing.price) next.price = listing.price;
  const listingDetails = [
    listing.itemId && `eBay Item ID: ${listing.itemId}`,
    listing.condition && `Condition: ${listing.condition}`,
    listing.price && `Price: ${listing.price}`,
    listing.seller && `Seller: ${listing.seller}`,
    listing.shipping && `Shipping: ${listing.shipping}`,
    listing.returnTerms && `Returns: ${listing.returnTerms}`,
    ...(Array.isArray(listing.itemSpecifics) ? listing.itemSpecifics : [])
  ].filter(Boolean);
  if (!String(next.specifics || "").trim() && listingDetails.length) next.specifics = listingDetails.join("\n");
  if (!String(next.description || "").trim() && listing.description) next.description = listing.description;
  return next;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const remoteUser = authEnabled() && accessToken ? await getUserFromToken(accessToken) : null;
    const remoteProfile = remoteUser ? await getProfile(remoteUser.id) : null;
    const profilePlan = remoteProfile?.plan || "";
    const hasPlan = Boolean(profilePlan || req.headers["x-user-plan"]);
    const used = remoteProfile ? Number(remoteProfile.trial_used || 0) : 0;
    const state = creditState(remoteProfile || { plan: profilePlan || String(req.headers["x-user-plan"] || "") });
    const creditsUsed = state.creditsUsed;
    const bonusCredits = state.bonusCredits;
    const creditsLimit = state.planLimit + state.bonusCredits;
    const creditsRemaining = state.totalCreditsRemaining;

    if (!remoteUser && !hasPlan) {
      res.status(401).json({ error: "Create an account to unlock your 2 free optimizations", authRequired: true, trialLimit: TRIAL_LIMIT });
      return;
    }
    if (!hasPlan && used >= TRIAL_LIMIT) {
      res.setHeader("X-Trial-Used", String(used));
      res.status(402).json({ error: "Trial limit reached", trialLimited: true, trialUsed: used, trialRemaining: 0 });
      return;
    }
    if (hasPlan && creditsRemaining <= 0) {
      res.status(402).json({
        error: "Credit limit reached",
        creditsLimited: true,
        creditsUsed,
        creditsLimit,
        creditsRemaining: 0,
        user: remoteUser && remoteProfile ? {
          id: remoteUser.id,
          email: remoteUser.email,
          name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
          plan: profilePlan,
          trialUsed: used,
          creditsUsed,
          bonusCredits,
          creditsLimit,
          creditsRemaining: 0,
          monthlyCreditsRemaining: state.monthlyCreditsRemaining
        } : null
      });
      return;
    }

    const requestBody = req.body || {};
    const listingUrl = requestBody.listingUrl || requestBody.siteUrl || requestBody.url || "";
    let optimizedInput = requestBody;
    if (listingUrl) {
      const listing = await fetchSubmittedEbayListing(listingUrl);
      optimizedInput = mergeEbayListingData(requestBody, listing);
    }
    const result = buildResult(optimizedInput);
    const nextUsed = hasPlan ? used : used + 1;
    const nextCreditState = hasPlan ? applyCreditUse(remoteProfile || { plan: profilePlan }) : null;
    const nextCreditsUsed = nextCreditState ? nextCreditState.nextCreditsUsed : creditsUsed;
    const nextBonusCredits = nextCreditState ? nextCreditState.nextBonusCredits : bonusCredits;
    if (!hasPlan && remoteUser && remoteProfile) {
      await upsertProfile({
        id: remoteUser.id,
        email: remoteUser.email,
        full_name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
        plan: profilePlan || null,
        trial_used: nextUsed,
        credits_used: creditsUsed,
        bonus_credits: bonusCredits,
        listings_optimized: Number(remoteProfile.listings_optimized || 0) + 1,
        signup_at: remoteProfile.signup_at || null
      });
    } else if (hasPlan && remoteUser && remoteProfile) {
      const billingPeriod = ensureBillingPeriod(remoteProfile);
      await upsertProfile({
        id: remoteUser.id,
        email: remoteUser.email,
        full_name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
        plan: profilePlan || null,
        trial_used: used,
        credits_used: nextCreditsUsed,
        bonus_credits: nextBonusCredits,
        listings_optimized: Number(remoteProfile.listings_optimized || 0) + 1,
        signup_at: remoteProfile.signup_at || null,
        stripe_customer_id: remoteProfile.stripe_customer_id || null,
        stripe_subscription_id: remoteProfile.stripe_subscription_id || null,
        billing_period_started_at: state.shouldResetPeriod ? billingPeriod.billing_period_started_at : (remoteProfile.billing_period_started_at || billingPeriod.billing_period_started_at),
        billing_period_ends_at: state.shouldResetPeriod ? billingPeriod.billing_period_ends_at : (remoteProfile.billing_period_ends_at || billingPeriod.billing_period_ends_at)
      });
    }
    res.setHeader("X-Trial-Used", String(nextUsed));
    result.trialUsed = nextUsed;
    result.trialRemaining = hasPlan ? null : Math.max(0, TRIAL_LIMIT - nextUsed);
    result.trialLimited = false;
    result.creditsUsed = hasPlan ? nextCreditsUsed : creditsUsed;
    result.bonusCredits = nextBonusCredits;
    result.creditsLimit = creditsLimit;
    result.creditsRemaining = hasPlan && nextCreditState ? nextCreditState.nextTotalCreditsRemaining : creditsRemaining;
    result.creditsLimited = false;
    if (remoteUser && remoteProfile) {
      result.user = {
        id: remoteUser.id,
        email: remoteUser.email,
        name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
        plan: profilePlan,
        trialUsed: nextUsed,
        creditsUsed: hasPlan ? nextCreditsUsed : creditsUsed,
        bonusCredits: hasPlan ? nextBonusCredits : bonusCredits,
        creditsLimit,
        creditsRemaining: hasPlan && nextCreditState ? nextCreditState.nextTotalCreditsRemaining : creditsRemaining,
        monthlyCreditsRemaining: hasPlan && nextCreditState ? nextCreditState.nextMonthlyCreditsRemaining : state.monthlyCreditsRemaining,
        listingsOptimized: Number(remoteProfile.listings_optimized || 0) + 1
      };
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to optimize listing" });
  }
};
