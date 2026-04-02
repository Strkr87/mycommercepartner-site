const { authEnabled, json, supabaseAuth, upsertProfile, serializeUser } = require("../_lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!authEnabled()) {
    json(res, 503, { error: "Auth is not configured" });
    return;
  }

  const { name = "", email = "", password = "", plan = "" } = req.body || {};
  if (!name.trim() || !email.trim() || !password.trim()) {
    json(res, 400, { error: "Name, email, and password are required" });
    return;
  }

  const { response, data } = await supabaseAuth("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      data: { full_name: name.trim() }
    })
  });

  if (!response.ok || !data?.user?.id || !data?.session?.access_token) {
    json(res, response.status || 400, { error: data?.msg || data?.error_description || "Unable to create account" });
    return;
  }

  const profile = await upsertProfile({
    id: data.user.id,
    email: data.user.email,
    full_name: name.trim(),
    plan: plan || null,
    trial_used: 0
  });

  json(res, 200, {
    user: serializeUser(data.user, profile),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    },
    trialUsed: Number(profile.trial_used || 0)
  });
};
