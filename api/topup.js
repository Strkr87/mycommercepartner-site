const {
  authEnabled,
  paymentsEnabled,
  json,
  getUserFromToken,
  stripeRequest
} = require("../lib/platform");

const TOPUP_OPTIONS = {
  100: 5900,
  250: 12900,
  500: 22900
};

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
  const topupCredits = Number(credits || 0);
  const amount = TOPUP_OPTIONS[topupCredits];
  if (!amount) {
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
    "line_items[0][price_data][product_data][name]": `${topupCredits} Credit Top-Up`,
    "line_items[0][price_data][product_data][description]": `Extra listing optimization credits for MyCommercePartner`,
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][quantity]": "1",
    "metadata[user_id]": user.id,
    "metadata[email]": user.email,
    "metadata[kind]": "topup",
    "metadata[topup_credits]": String(topupCredits)
  });

  if (!response.ok || !data?.url) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to start top-up checkout" });
    return;
  }

  json(res, 200, { url: data.url });
};
