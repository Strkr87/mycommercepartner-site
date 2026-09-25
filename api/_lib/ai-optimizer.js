const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_MODEL = "claude-opus-5";
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function aiModel() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
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

function buildPrompt(data, draft) {
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
  return { system, user };
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
  const client = options.client || (process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS, maxRetries: 1 })
    : null);
  if (!client) return null;
  const { system, user } = buildPrompt(data, draft || {});

  try {
    const response = await client.beta.messages.create({
      model: options.model || aiModel(),
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RESPONSE_SCHEMA }
      },
      system,
      messages: [{ role: "user", content: user }]
    });
    if (response.stop_reason !== "end_turn") {
      console.error(`AI optimizer: unexpected stop_reason ${response.stop_reason}`);
      return null;
    }
    const text = response.content.find((block) => block.type === "text");
    if (!text) return null;
    return normalizeAiListing(JSON.parse(text.text), data);
  } catch (error) {
    console.error("AI optimizer failed:", error?.status || "", error?.message || error);
    return null;
  }
}

module.exports = { aiEnabled, aiModel, generateAiListing, normalizeAiListing, buildPrompt };
