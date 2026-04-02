const {
  authEnabled,
  paymentsEnabled,
  json,
  getUserFromToken,
  getProfile,
  planToPriceId,
  stripeRequest
} = require("../lib/platform");

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

  const profile = await getProfile(user.id);
  const { plan = "", origin = "" } = req.body || {};
  const priceId = planToPriceId(plan);
  if (!priceId) {
    json(res, 400, { error: "Unknown plan selected" });
    return;
  }

  const siteOrigin = String(origin || "").replace(/\/$/, "");
  if (!siteOrigin) {
    json(res, 400, { error: "Missing site origin" });
    return;
  }

  const { response, data } = await stripeRequest("/v1/checkout/sessions", {
    mode: "subscription",
    success_url: `${siteOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteOrigin}/?checkout=cancelled`,
    customer_email: user.email,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": user.id,
    "metadata[plan]": plan,
    "metadata[email]": user.email,
    "metadata[current_plan]": profile?.plan || ""
  });

  if (!response.ok || !data?.url) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to start checkout" });
    return;
  }

  json(res, 200, { url: data.url });
};
