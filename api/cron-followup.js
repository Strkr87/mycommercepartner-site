// api/cron-followup.js
// Runs hourly via Vercel cron. Sends a 24hr follow-up email to users
// who signed up 23-25 hours ago and haven't received a follow-up yet.

const RESEND_API_KEY     = process.env.RESEND_API_KEY || '';
const SUPABASE_URL       = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CRON_SECRET        = process.env.CRON_SECRET || '';
const FROM_EMAIL         = 'hello@mycommercepartner.com';
const SITE_URL           = 'https://mycommercepartner.com';

async function sbAdmin(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function sendFollowUpEmail(to, firstName, trialUsed) {
  const hasUsedTrial = trialUsed > 0;
  const subject = hasUsedTrial
    ? `${firstName}, here's how to get even more from MyCommercePartner`
    : `${firstName}, you have 2 free optimizations waiting`;

  const html = `<!DOCTYPE html>
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
      ${hasUsedTrial ? `
      <h2>Nice work, ${firstName} 💪</h2>
      <p>You've already tried the optimizer — here's how sellers on the <strong>Starter plan</strong> are getting results:</p>
      <div class="box">
        <p>📈 <strong>Titles that rank higher</strong> — up to 80 characters of buyer keywords</p>
        <p>💬 <strong>Descriptions that convert</strong> — bullet-structured, mobile-friendly</p>
        <p>🔁 <strong>50 credits/month</strong> — enough to refresh your entire inventory</p>
      </div>
      <p>For $39/month you can optimize your whole store, not just one listing.</p>
      ` : `
      <h2>Still thinking it over, ${firstName}?</h2>
      <p>You signed up yesterday but haven't tried your free optimizations yet. Here's what you're missing:</p>
      <div class="box">
        <p>🔍 <strong>Smarter titles</strong> — keywords buyers actually search for</p>
        <p>📋 <strong>Better descriptions</strong> — structured for mobile, built to convert</p>
        <p>📊 <strong>SEO score</strong> — see exactly where your listing falls short</p>
      </div>
      <p>It takes about 60 seconds. Paste your listing and see the difference.</p>
      `}
      <p style="text-align:center;margin-top:24px">
        <a href="${SITE_URL}/dashboard" class="btn">${hasUsedTrial ? 'Upgrade to Starter →' : 'Try Your Free Credits →'}</a>
      </p>
    </div>
    <div class="ft">
      <p>MyCommercePartner &nbsp;·&nbsp; <a href="${SITE_URL}">mycommercepartner.com</a></p>
      <p style="margin-top:6px"><a href="${SITE_URL}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
}

module.exports = async (req, res) => {
  // Verify cron secret
  const authHeader = req.headers.authorization || '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: 'Supabase not configured' });
    return;
  }

  // Find users who signed up 23–25 hours ago and haven't gotten a followup
  const now = new Date();
  const from = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const to   = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();

  const { ok, data } = await sbAdmin(
    `/rest/v1/profiles?signup_at=gte.${encodeURIComponent(from)}&signup_at=lte.${encodeURIComponent(to)}&followup_sent=is.null&select=id,email,full_name,trial_used`
  );

  if (!ok || !Array.isArray(data)) {
    res.status(500).json({ error: 'Failed to query profiles' });
    return;
  }

  let sent = 0;
  for (const profile of data) {
    if (!profile.email) continue;
    const firstName = (profile.full_name || profile.email).split(' ')[0];
    try {
      await sendFollowUpEmail(profile.email, firstName, Number(profile.trial_used || 0));
      // Mark followup sent
      await sbAdmin(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ followup_sent: new Date().toISOString() }),
      });
      sent++;
      console.log(`[cron-followup] sent to ${profile.email}`);
    } catch (err) {
      console.error(`[cron-followup] failed for ${profile.email}:`, err.message);
    }
  }

  res.status(200).json({ ok: true, sent, checked: data.length });
};
