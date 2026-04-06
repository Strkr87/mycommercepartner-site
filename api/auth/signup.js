const { authEnabled, json, supabaseAuth, upsertProfile, serializeUser } = require("../../lib/platform");

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = 'hello@mycommercepartner.com';
const SITE_URL       = 'https://mycommercepartner.com';

async function sendWelcomeEmail(to, firstName) {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: `Welcome to MyCommercePartner, ${firstName}! 🎉`,
      html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .w{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .h{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:36px 40px;text-align:center}
    .h h1{margin:0;color:#fff;font-size:22px;font-weight:700}
    .h p{margin:6px 0 0;color:#a0aec0;font-size:13px}
    .b{padding:40px}
    .b h2{margin:0 0 12px;color:#1a1a2e;font-size:20px}
    .b p{margin:0 0 16px;color:#4a5568;font-size:15px;line-height:1.6}
    .box{background:#f7f8ff;border-left:4px solid #4f46e5;border-radius:6px;padding:16px 20px;margin:20px 0}
    .box p{margin:4px 0;color:#1a1a2e;font-size:14px}
    .btn{display:inline-block;background:#4f46e5;color:#fff!important;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;margin:8px 0}
    .ft{padding:24px 40px;background:#f7f8ff;text-align:center}
    .ft p{margin:0;color:#a0aec0;font-size:12px}
    .ft a{color:#4f46e5;text-decoration:none}
  </style>
</head>
<body>
  <div class="w">
    <div class="h"><h1>MyCommercePartner</h1><p>eBay Listing Optimization</p></div>
    <div class="b">
      <h2>Welcome aboard, ${firstName}! 👋</h2>
      <p>You've just unlocked the smarter way to list on eBay. Your account is ready — and you have <strong>2 free optimization credits</strong> waiting for you.</p>
      <div class="box">
        <p>✅ <strong>2 free optimizations</strong> — no credit card needed</p>
        <p>⚡ <strong>Optimized titles</strong> up to 80 characters packed with buyer keywords</p>
        <p>📋 <strong>Better descriptions</strong> that convert browsers into buyers</p>
        <p>📊 <strong>SEO score</strong> so you know exactly where to improve</p>
      </div>
      <p>Head to your dashboard and paste in your first listing to see what a difference it makes.</p>
      <p style="text-align:center;margin-top:24px">
        <a href="${SITE_URL}/dashboard" class="btn">Start Optimizing →</a>
      </p>
      <p style="margin-top:24px">Got questions? Just reply to this email — we read every one.</p>
    </div>
    <div class="ft">
      <p>MyCommercePartner &nbsp;·&nbsp; <a href="${SITE_URL}">mycommercepartner.com</a></p>
    </div>
  </div>
</body>
</html>`
    })
  }).catch(() => {});
}

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

  if (!response.ok || !data?.user?.id) {
    json(res, response.status || 400, { error: data?.msg || data?.error_description || "Unable to create account" });
    return;
  }

  const profile = await upsertProfile({
    id: data.user.id,
    email: data.user.email,
    full_name: name.trim(),
    plan: plan || null,
    trial_used: 0,
    credits_used: 0,
    listings_optimized: 0,
    signup_at: new Date().toISOString()
  });

  // Send welcome email (non-blocking)
  const firstName = name.trim().split(' ')[0];
  sendWelcomeEmail(data.user.email, firstName).catch(() => {});

  json(res, 200, {
    user: serializeUser(data.user, profile),
    session: data?.session?.access_token ? {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    } : null,
    trialUsed: Number(profile.trial_used || 0)
  });
};
