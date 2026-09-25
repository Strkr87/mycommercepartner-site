const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 20000;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "bullets", "description", "actions"],
  properties: {
    title: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    actions: { type: "array", items: { type: "string" } }
  }
};

function aiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function aiModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function titleLimit(data) {
  return /amazon/i.test(String(data.marketplace || data.channel || "")) ? 200 : 80;
}

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function listingInput(data) {
  const fields = {
    marketplace: data.marketplace || data.channel || "eBay",
    currentTitle: data.title,
    brand: data.brand,
    sku: data.sku,
    category: data.category,
    condition: data.condition,
    price: data.price,
    shipping: data.shipping,
    itemSpecifics: data.specifics,
    currentDescription: data.description,
    sellerGoals: data.goals
  };
  return Object.entries(fields)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}: ${String(value).slice(0, 4000)}`)
    .join("\n");
}

function buildMessages(data, draft) {
  const limit = titleLimit(data);
  const system = [
    "You are an expert marketplace listing copywriter for eBay and Amazon sellers.",
    "Rewrite the seller's listing to rank in marketplace search and convert buyers.",
    "Rules:",
    `- title: at most ${limit} characters. Lead with brand, model, and the strongest buyer search terms. No ALL CAPS words except model codes, no emojis, no punctuation spam, no words like "L@@K", "wow", or "best".`,
    "- bullets: 3 to 5 short, scannable buyer-benefit lines, each backed by a stated fact. No leading dashes or numbers.",
    "- description: 2 to 4 short plain-text paragraphs covering what it is, key specs and compatibility, condition and what's included, then shipping/returns. No HTML, no markdown.",
    "- actions: 3 to 5 specific, prioritized changes the seller should make to this listing (missing specifics, photos, pricing signals, policy gaps).",
    "- Use ONLY facts present in the input. Never invent specs, compatibility, accessories, warranties, or condition claims. If a fact is missing, leave it out and suggest adding it in actions.",
    "- Out-of-stock or zero-quantity listings: call that out first in actions."
  ].join("\n");
  const user = [
    "Seller listing input:",
    listingInput(data) || "(no details provided)",
    "",
    "Rule-based draft for reference (improve on it; do not copy weak phrasing):",
    `title: ${draft.title || ""}`,
    `bullets:\n${draft.bullets || ""}`
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function cleanList(items, max) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeAiListing(raw, data) {
  if (!raw || typeof raw !== "object") return null;
  const title = clip(raw.title, titleLimit(data));
  const bullets = cleanList(raw.bullets, 5);
  const description = String(raw.description || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const actions = cleanList(raw.actions, 5);
  if (!title || bullets.length < 2 || description.length < 40) return null;
  return { title, bullets, description, actions };
}

async function generateAiListing(data, draft, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: options.model || aiModel(),
        temperature: 0.4,
        messages: buildMessages(data, draft || {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: "listing_optimization", strict: true, schema: RESPONSE_SCHEMA }
        }
      })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return null;
    return normalizeAiListing(JSON.parse(content), data);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { aiEnabled, aiModel, generateAiListing, normalizeAiListing, buildMessages };
