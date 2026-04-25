const {
  authEnabled,
  paymentsEnabled,
  json,
  getUserFromToken,
  stripeRequest
} = require("../lib/platform");
const { resolveOneTimeOffer } = require("../lib/offers");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!authEnabled() || !paymentsEnabled()) {
    json(res, 503, { error: "Payments are not configured" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const user = await getUserFromToken(accessToken);
  if (!user) {
    json(res, 401, { error: "Invalid session" });
    return;
  }

  const { credits = 0, origin = "" } = req.body || {};
  const offer = resolveOneTimeOffer(credits);
  if (!offer) {
    json(res, 400, { error: "Unknown credit pack selected" });
    return;
  }

  const siteOrigin = String(origin || "").replace(/\/$/, "");
  if (!siteOrigin) {
    json(res, 400, { error: "Missing site origin" });
    return;
  }

  const { response, data } = await stripeRequest("/v1/checkout/sessions", {
    mode: "payment",
    success_url: `${siteOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteOrigin}/?checkout=cancelled`,
    customer_email: user.email,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": offer.name,
    "line_items[0][price_data][product_data][description]": offer.description,
    "line_items[0][price_data][unit_amount]": String(offer.amount),
    "line_items[0][quantity]": "1",
    "metadata[user_id]": user.id,
    "metadata[email]": user.email,
    "metadata[kind]": offer.kind,
    "metadata[topup_credits]": String(offer.credits)
  });

  if (!response.ok || !data?.url) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to start top-up checkout" });
    return;
  }

  json(res, 200, { url: data.url });
};
