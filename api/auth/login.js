const { authEnabled, json, supabaseAuth, getProfile, serializeUser } = require("../../lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!authEnabled()) {
    json(res, 503, { error: "Auth is not configured" });
    return;
  }

  const { email = "", password = "" } = req.body || {};
  if (!email.trim() || !password.trim()) {
    json(res, 400, { error: "Email and password are required" });
    return;
  }

  const { response, data } = await supabaseAuth("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password
    })
  });

  if (!response.ok || !data?.user?.id) {
    json(res, response.status || 401, { error: data?.error_description || "Unable to log in" });
    return;
  }

  const profile = await getProfile(data.user.id);

  json(res, 200, {
    user: serializeUser(data.user, profile || {}),
    session: data?.access_token ? {
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    } : null,
    trialUsed: Number(profile?.trial_used || 0)
  });
};
