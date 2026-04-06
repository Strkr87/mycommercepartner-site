// api/contact.js — Contact form handler
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = 'hello@mycommercepartner.com';
const NOTIFY_EMAIL   = 'ken@mycommercepartner.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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
        subject: "Got your message — we'll be in touch soon",
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
      <p>We got your message and will get back to you within 24 hours.</p>
      <p>In the meantime, feel free to explore the dashboard and try your free optimization credits.</p>
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
