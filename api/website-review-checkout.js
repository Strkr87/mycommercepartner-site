const {
  STRIPE_SECRET_KEY,
  json,
  stripeRequest
} = require("../lib/platform");

const WEBSITE_REVIEW_PACKAGES = {
  basic: {
    label: "Basic Upgrade",
    amount: 75000,
    description: "One focused website page or buyer-path cleanup with done-for-you implementation."
  },
  growth: {
    label: "Growth Upgrade",
    amount: 150000,
    description: "Homepage restructure, trust placement, and inquiry-flow cleanup with implementation and mobile polish."
  },
  premium: {
    label: "Premium Upgrade",
    amount: 225000,
    description: "More polished buyer path, stronger proof throughout, and refined done-for-you implementation."
  }
};

function cleanOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch (_) {
    return "";
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!STRIPE_SECRET_KEY) {
    json(res, 503, { error: "Payments are not configured" });
    return;
  }

  const { package: packageKey = "", origin = "" } = req.body || {};
  const key = String(packageKey || "").toLowerCase();
  const offer = WEBSITE_REVIEW_PACKAGES[key];
  const sitePage = cleanOrigin(origin);

  if (!offer) {
    json(res, 400, { error: "Unknown website review package" });
    return;
  }
  if (!sitePage) {
    json(res, 400, { error: "Missing site origin" });
    return;
  }

  const { response, data } = await stripeRequest("/v1/checkout/sessions", {
    mode: "payment",
    success_url: `${sitePage}?checkout=success&package=${encodeURIComponent(key)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${sitePage}?checkout=cancelled&package=${encodeURIComponent(key)}`,
    "customer_creation": "always",
    "phone_number_collection[enabled]": "true",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": `MyCommercePartner ${offer.label}`,
    "line_items[0][price_data][product_data][description]": offer.description,
    "line_items[0][price_data][unit_amount]": String(offer.amount),
    "line_items[0][quantity]": "1",
    "metadata[kind]": "website_review",
    "metadata[package]": key,
    "metadata[package_label]": offer.label
  });

  if (!response.ok || !data?.url) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to start checkout" });
    return;
  }

  json(res, 200, { url: data.url });
};
