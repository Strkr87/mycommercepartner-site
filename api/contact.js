// api/contact.js — Contact form handler + website review checkout starter
const { STRIPE_SECRET_KEY, stripeRequest } = require('../lib/platform');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = 'hello@mycommercepartner.com';
const NOTIFY_EMAIL   = 'ken@mycommercepartner.com';

const WEBSITE_REVIEW_PACKAGES = {
  basic: {
    label: 'Basic Upgrade',
    amount: 75000,
    description: 'One focused website page or buyer-path cleanup with done-for-you implementation.'
  },
  growth: {
    label: 'Growth Upgrade',
    amount: 150000,
    description: 'Homepage restructure, trust placement, and inquiry-flow cleanup with implementation and mobile polish.'
  },
  premium: {
    label: 'Premium Upgrade',
    amount: 225000,
    description: 'More polished buyer path, stronger proof throughout, and refined done-for-you implementation.'
  }
};

function cleanPageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch (_) {
    return '';
  }
}

async function startWebsiteReviewCheckout(req, res) {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ error: 'Payments are not configured' });
    return;
  }

  const { package: packageKey = '', origin = '' } = req.body || {};
  const key = String(packageKey || '').toLowerCase();
  const offer = WEBSITE_REVIEW_PACKAGES[key];
  const sitePage = cleanPageUrl(origin);

  if (!offer) {
    res.status(400).json({ error: 'Unknown website review package' });
    return;
  }
  if (!sitePage) {
    res.status(400).json({ error: 'Missing site origin' });
    return;
  }

  const { response, data } = await stripeRequest('/v1/checkout/sessions', {
    mode: 'payment',
    success_url: `${sitePage}?checkout=success&package=${encodeURIComponent(key)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${sitePage}?checkout=cancelled&package=${encodeURIComponent(key)}`,
    customer_creation: 'always',
    'phone_number_collection[enabled]': 'true',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `MyCommercePartner ${offer.label}`,
    'line_items[0][price_data][product_data][description]': offer.description,
    'line_items[0][price_data][unit_amount]': String(offer.amount),
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'website_review',
    'metadata[package]': key,
    'metadata[package_label]': offer.label
  });

  if (!response.ok || !data?.url) {
    res.status(response.status || 400).json({ error: data?.error?.message || 'Unable to start checkout' });
    return;
  }

  res.status(200).json({ url: data.url });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (req.body?.action === 'website-review-checkout') {
    await startWebsiteReviewCheckout(req, res);
    return;
  }

  const { name = '', email = '', message = '' } = req.body || {};
  if (!name.trim() || !email.trim() || !message.trim()) {
    res.status(400).json({ error: 'Name, email, and message are required' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'Message too long' });
    return;
  }

  if (!RESEND_API_KEY) {
    res.status(500).json({ error: 'Email not configured' });
    return;
  }

  try {
    // Notify Ken
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        reply_to: email.trim(),
        subject: `New contact form message from ${name.trim()}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;border:1px solid #e2e8f0">
          <h2 style="margin:0 0 20px;color:#1a1a2e">New contact message</h2>
          <p><strong>Name:</strong> ${name.trim()}</p>
          <p><strong>Email:</strong> <a href="mailto:${email.trim()}">${email.trim()}</a></p>
          <p><strong>Message:</strong></p>
          <div style="background:#f7f8ff;border-left:4px solid #4f46e5;border-radius:6px;padding:16px 20px;white-space:pre-wrap">${message.trim().replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <p style="margin-top:20px;font-size:13px;color:#a0aec0">Reply directly to this email to respond to ${name.trim()}.</p>
        </div>`
      })
    });

    // Auto-reply to sender
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email.trim(),
        subject: "Got your site review request — we'll follow up within 24 hours",
        html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,sans-serif}
    .w{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .h{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:36px 40px;text-align:center}
    .h h1{margin:0;color:#fff;font-size:22px;font-weight:700}
    .b{padding:40px}
    .b h2{margin:0 0 12px;color:#1a1a2e}
    .b p{color:#4a5568;font-size:15px;line-height:1.6}
    .ft{padding:24px 40px;background:#f7f8ff;text-align:center}
    .ft p{margin:0;color:#a0aec0;font-size:12px}
    .ft a{color:#4f46e5;text-decoration:none}
  </style>
</head>
<body>
  <div class="w">
    <div class="h"><h1>MyCommercePartner</h1></div>
    <div class="b">
      <h2>Thanks, ${name.trim().split(' ')[0]}!</h2>
      <p>We got your site review request and will follow up within 24 hours with the clearest next step.</p>
      <p>If a Basic Upgrade is enough, we’ll recommend that instead of pushing you into a bigger package.</p>
      <p>If you need to add anything before we reply, just respond to this email.</p>
    </div>
    <div class="ft">
      <p>MyCommercePartner &nbsp;·&nbsp; <a href="https://mycommercepartner.com">mycommercepartner.com</a></p>
    </div>
  </div>
</body>
</html>`
      })
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
