// api/contact.js — Contact form handler + website review checkout starter
const { STRIPE_SECRET_KEY, stripeRequest } = require('../lib/platform');
const { extractEbayItemId, parseEbayItemHtml, lookupEbayBrowseApi } = require('./_lib/ebay-item-lookup');
const nodemailer = require('nodemailer');

const SMTP_HOST   = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
const SMTP_USER   = process.env.SMTP_USER || process.env.GMAIL_USER || process.env.EMAIL_USER || 'hello@mycommercepartner.com';
const SMTP_PASS   = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || process.env.GOOGLE_APP_PASSWORD || process.env.EMAIL_PASSWORD || '';
const FROM_EMAIL  = process.env.FROM_EMAIL || SMTP_USER;
const NOTIFY_EMAILS = (process.env.CONTACT_NOTIFY_EMAILS || 'hello@mycommercepartner.com')
  .split(',')
  .map(email => email.trim())
  .filter(Boolean);

let smtpTransporter;
function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return smtpTransporter;
}

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

const MISSED_LEAD_PACKAGES = {
  setup: {
    label: 'Missed Lead Recovery Setup',
    amount: 99700,
    mode: 'payment',
    description: 'One-time setup for missed-call response planning, form follow-up messages, booking/review flow cleanup, and launch support.'
  },
  managed: {
    label: 'Managed Follow-Up',
    amount: 49700,
    mode: 'subscription',
    interval: 'month',
    description: 'Monthly support to keep follow-up messages, review requests, reporting, and small customer-response path fixes improving.'
  }
};

const MARKETPLACE_AUDIT_PACKAGES = {
  intro: {
    label: 'Marketplace Listing Audit — Intro',
    amount: 9700,
    description: 'Focused review for 1–3 Amazon or eBay listings with priority fixes and next-step recommendations.'
  },
  standard: {
    label: 'Marketplace Listing Audit — Standard',
    amount: 19700,
    description: 'Expanded review for priority marketplace listings with title, detail, buyer-confidence, and cleanup recommendations.'
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendSmtpEmail(payload, label) {
  try {
    return await getSmtpTransporter().sendMail({
      from: payload.from,
      to: payload.to,
      replyTo: payload.reply_to,
      subject: payload.subject,
      html: payload.html
    });
  } catch (err) {
    console.error(`[contact] SMTP ${label} failed:`, err.message);
    throw new Error(`SMTP ${label} failed: ${err.message}`);
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


async function startMissedLeadCheckout(req, res) {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ error: 'Payments are not configured' });
    return;
  }

  const { package: packageKey = '', origin = '' } = req.body || {};
  const key = String(packageKey || '').toLowerCase();
  const offer = MISSED_LEAD_PACKAGES[key];
  const sitePage = cleanPageUrl(origin);

  if (!offer) {
    res.status(400).json({ error: 'Unknown missed lead package' });
    return;
  }
  if (!sitePage) {
    res.status(400).json({ error: 'Missing site origin' });
    return;
  }

  const payload = {
    mode: offer.mode,
    success_url: `${sitePage}?checkout=success&offer=${encodeURIComponent(key)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${sitePage}?checkout=cancelled&offer=${encodeURIComponent(key)}`,
    'phone_number_collection[enabled]': 'true',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `MyCommercePartner ${offer.label}`,
    'line_items[0][price_data][product_data][description]': offer.description,
    'line_items[0][price_data][unit_amount]': String(offer.amount),
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'missed_lead_recovery',
    'metadata[package]': key,
    'metadata[package_label]': offer.label
  };

  if (offer.mode === 'payment') {
    payload.customer_creation = 'always';
  }
  if (offer.mode === 'subscription') {
    payload['line_items[0][price_data][recurring][interval]'] = offer.interval || 'month';
    payload['subscription_data[metadata][kind]'] = 'missed_lead_recovery';
    payload['subscription_data[metadata][package]'] = key;
  }

  const { response, data } = await stripeRequest('/v1/checkout/sessions', payload);

  if (!response.ok || !data?.url) {
    res.status(response.status || 400).json({ error: data?.error?.message || 'Unable to start checkout' });
    return;
  }

  res.status(200).json({ url: data.url });
}

async function startMarketplaceAuditCheckout(req, res) {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ error: 'Payments are not configured' });
    return;
  }

  const { package: packageKey = '', origin = '', email = '' } = req.body || {};
  const key = String(packageKey || '').toLowerCase();
  const offer = MARKETPLACE_AUDIT_PACKAGES[key];
  const sitePage = cleanPageUrl(origin);

  if (!offer) {
    res.status(400).json({ error: 'Unknown marketplace audit package' });
    return;
  }
  if (!sitePage) {
    res.status(400).json({ error: 'Missing site origin' });
    return;
  }

  const payload = {
    mode: 'payment',
    success_url: `${sitePage}?checkout=success&audit=${encodeURIComponent(key)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${sitePage}?checkout=cancelled&audit=${encodeURIComponent(key)}`,
    customer_creation: 'always',
    'phone_number_collection[enabled]': 'true',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `MyCommercePartner ${offer.label}`,
    'line_items[0][price_data][product_data][description]': offer.description,
    'line_items[0][price_data][unit_amount]': String(offer.amount),
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'marketplace_listing_audit',
    'metadata[package]': key,
    'metadata[package_label]': offer.label
  };

  const customerEmail = String(email || '').trim();
  if (customerEmail) payload.customer_email = customerEmail;

  const { response, data } = await stripeRequest('/v1/checkout/sessions', payload);

  if (!response.ok || !data?.url) {
    res.status(response.status || 400).json({ error: data?.error?.message || 'Unable to start checkout' });
    return;
  }

  res.status(200).json({ url: data.url });
}

async function lookupEbayItemDetails(req, res) {
  const itemId = extractEbayItemId(req.body?.itemId || req.body?.url || '');
  if (!itemId) {
    res.status(400).json({ ok: false, message: 'Enter a valid eBay item number.' });
    return;
  }

  const apiResult = await lookupEbayBrowseApi(itemId);
  if (apiResult.ok && apiResult.title) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(apiResult);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`https://www.ebay.com/itm/${encodeURIComponent(itemId)}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    });
    const html = await response.text();
    const parsed = parseEbayItemHtml(html, itemId);
    if (response.ok && parsed.ok) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.status(200).json(parsed);
      return;
    }
  } catch (_) {
    // Return the same simple fallback below.
  } finally {
    clearTimeout(timer);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: false,
    itemId,
    source: 'fallback',
    message: 'We found the eBay item number, but could not read enough public listing details.'
  });
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

  if (req.body?.action === 'missed-lead-checkout') {
    await startMissedLeadCheckout(req, res);
    return;
  }

  if (req.body?.action === 'marketplace-audit-checkout') {
    await startMarketplaceAuditCheckout(req, res);
    return;
  }

  if (req.body?.action === 'ebay-item-lookup') {
    await lookupEbayItemDetails(req, res);
    return;
  }

  const { name = '', email = '', siteUrl = '', package: packageInterest = '', message = '' } = req.body || {};
  if (!name.trim() || !email.trim() || !message.trim()) {
    res.status(400).json({ error: 'Name, email, and message are required' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'Message too long' });
    return;
  }

  const safeName = name.trim();
  const safeEmail = email.trim();
  const safeSiteUrl = siteUrl.trim();
  const safePackageInterest = packageInterest.trim() || 'Not sure yet';
  const safeMessage = message.trim();
  const safeNameHtml = escapeHtml(safeName);
  const safeEmailHtml = escapeHtml(safeEmail);
  const safeSiteUrlHtml = escapeHtml(safeSiteUrl);
  const safePackageInterestHtml = escapeHtml(safePackageInterest);
  const safeMessageHtml = escapeHtml(safeMessage);

  if (!SMTP_USER || !SMTP_PASS) {
    res.status(500).json({ error: 'Email not configured' });
    return;
  }

  try {
    // Notify Ken / internal mailbox first. If this fails, the form should show an error instead of a false success.
    await sendSmtpEmail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAILS,
      reply_to: safeEmail,
      subject: `New MyCommercePartner request from ${safeName}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;border:1px solid #e2e8f0">
        <h2 style="margin:0 0 20px;color:#1a1a2e">New MyCommercePartner request</h2>
        <p><strong>Name:</strong> ${safeNameHtml}</p>
        <p><strong>Email:</strong> <a href="mailto:${safeEmailHtml}">${safeEmailHtml}</a></p>
        <p><strong>Marketplace or website link:</strong> ${safeSiteUrl ? `<a href="${safeSiteUrlHtml}">${safeSiteUrlHtml}</a>` : 'Not provided'}</p>
        <p><strong>Request type:</strong> ${safePackageInterestHtml}</p>
        <p><strong>What they want reviewed:</strong></p>
        <div style="background:#f7f8ff;border-left:4px solid #4f46e5;border-radius:6px;padding:16px 20px;white-space:pre-wrap">${safeMessageHtml}</div>
        <p style="margin-top:20px;font-size:13px;color:#a0aec0">Reply directly to this email to respond to ${safeNameHtml}.</p>
      </div>`
    }, 'internal notification');

    // Auto-reply to sender. Do not fail the lead notification if the customer confirmation is rejected.
    try {
      await sendSmtpEmail({
        from: FROM_EMAIL,
        to: safeEmail,
        subject: "Got your MyCommercePartner request — we'll follow up within 24 hours",
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
      <h2>Thanks, ${escapeHtml(safeName.split(' ')[0])}!</h2>
      <p>We got your MyCommercePartner request and will follow up within 24 hours with the clearest next step.</p>
      <p>If a small first step is enough, we’ll recommend that instead of pushing you into a bigger package.</p>
      <p>If you need to add anything before we reply, just respond to this email.</p>
    </div>
    <div class="ft">
      <p>MyCommercePartner &nbsp;·&nbsp; <a href="https://mycommercepartner.com">mycommercepartner.com</a></p>
    </div>
  </div>
</body>
</html>`
      }, 'sender auto-reply');
    } catch (autoReplyErr) {
      console.error('[contact] auto-reply skipped:', autoReplyErr.message);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
