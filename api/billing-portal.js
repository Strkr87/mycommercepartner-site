const {
  authEnabled,
  paymentsEnabled,
  json,
  getUserFromToken,
  findStripeCustomerByEmail,
  stripeRequest
} = require("../lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!authEnabled() || !paymentsEnabled()) {
    json(res, 503, { error: "Billing is not configured" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const user = await getUserFromToken(accessToken);
  if (!user) {
    json(res, 401, { error: "Invalid session" });
    return;
  }

  const { origin = "" } = req.body || {};
  const siteOrigin = String(origin || "").replace(/\/$/, "");
  if (!siteOrigin) {
    json(res, 400, { error: "Missing site origin" });
    return;
  }

  const customer = await findStripeCustomerByEmail(user.email);
  if (!customer?.id) {
    json(res, 404, { error: "No billing account was found for this customer yet" });
    return;
  }

  const { response, data } = await stripeRequest("/v1/billing_portal/sessions", {
    customer: customer.id,
    return_url: `${siteOrigin}/?billing=updated`
  });

  if (!response.ok || !data?.url) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to open billing portal" });
    return;
  }

  json(res, 200, { url: data.url });
};
