const {
  authEnabled,
  paymentsEnabled,
  json,
  getUserFromToken,
  getProfile,
  upsertProfile,
  serializeUser,
  stripeGet
} = require("../lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
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

  const sessionId = String(req.query.session_id || "");
  if (!sessionId) {
    json(res, 400, { error: "Missing session id" });
    return;
  }

  const { response, data } = await stripeGet(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (!response.ok || !data?.id) {
    json(res, response.status || 400, { error: data?.error?.message || "Unable to verify checkout" });
    return;
  }

  if (data.payment_status !== "paid" && data.status !== "complete") {
    json(res, 400, { error: "Checkout has not completed yet" });
    return;
  }

  if ((data.metadata?.user_id || "") !== user.id) {
    json(res, 403, { error: "Checkout session does not match this user" });
    return;
  }

  const existing = await getProfile(user.id);
  const kind = data.metadata?.kind || "plan";
  const topupCredits = Number(data.metadata?.topup_credits || 0);
  const profile = await upsertProfile({
    id: user.id,
    email: user.email,
    full_name: existing?.full_name || user.user_metadata?.full_name || user.email,
    plan: kind === "topup" ? existing?.plan || null : data.metadata?.plan || existing?.plan || null,
    trial_used: Number(existing?.trial_used || 0),
    credits_used: Number(existing?.credits_used || 0),
    bonus_credits: Number(existing?.bonus_credits || 0) + (kind === "topup" ? topupCredits : 0)
  });

  json(res, 200, {
    kind,
    topupCredits,
    user: serializeUser(user, profile)
  });
};
