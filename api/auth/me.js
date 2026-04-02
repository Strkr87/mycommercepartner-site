const { authEnabled, json, getUserFromToken, getProfile, serializeUser } = require("../_lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!authEnabled()) {
    json(res, 503, { error: "Auth is not configured" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) {
    json(res, 401, { error: "Missing access token" });
    return;
  }

  const user = await getUserFromToken(accessToken);
  if (!user) {
    json(res, 401, { error: "Invalid session" });
    return;
  }

  const profile = await getProfile(user.id);
  json(res, 200, {
    user: serializeUser(user, profile || {}),
    trialUsed: Number(profile?.trial_used || 0)
  });
};
