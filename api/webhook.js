// api/webhook.js — Stripe webhook handler
// Handles: checkout.session.completed, customer.subscription.updated,
//          customer.subscription.deleted, invoice.payment_failed
//
// Required env vars (set in Vercel dashboard):
//   STRIPE_SECRET_KEY         — sk_live_...
//   STRIPE_WEBHOOK_SECRET     — whsec_... (from Stripe webhook dashboard)
//   SUPABASE_URL              — https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (not anon key)
//   RESEND_API_KEY            — re_... (from resend.com)

const crypto = require('crypto');

// ─── Config ────────────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY     || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_URL          = process.env.SUPABASE_URL          || '';
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY        = process.env.RESEND_API_KEY        || '';

const FROM_EMAIL = 'hello@mycommercepartner.com';
const SITE_URL   = 'https://mycommercepartner.com';

// Plan details for emails
const PLAN_INFO = {
  Starter:    { credits: 50,  price: '$39/mo' },
  Growth:     { credits: 250, price: '$99/mo' },
  Enterprise: { credits: 800, price: '$249/mo' },
};

// ─── Email helper ────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`[email] sent "${subject}" to ${to}`);
    } else {
      console.error(`[email] failed to send to ${to}:`, JSON.stringify(data));
    }
  } catch (err) {
    console.error('[email] fetch error:', err.message);
  }
}

// ─── Email templates ─────────────────────────────────────────────────────────
function emailBase(bodyContent) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 36px 40px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 6px 0 0; color: #a0aec0; font-size: 13px; }
    .body { padding: 40px; }
    .body h2 { margin: 0 0 12px; color: #1a1a2e; font-size: 20px; }
    .body p { margin: 0 0 16px; color: #4a5568; font-size: 15px; line-height: 1.6; }
    .highlight-box { background: #f7f8ff; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .highlight-box p { margin: 0; color: #1a1a2e; font-size: 14px; }
    .highlight-box strong { color: #4f46e5; }
    .btn { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0; }
    .footer { padding: 24px 40px; background: #f7f8ff; text-align: center; }
    .footer p { margin: 0; color: #a0aec0; font-size: 12px; }
    .footer a { color: #4f46e5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>MyCommercePartner</h1>
      <p>eBay Listing Optimization</p>
    </div>
    <div class="body">
      ${bodyContent}
    </div>
    <div class="footer">
      <p>MyCommercePartner &nbsp;·&nbsp; <a href="${SITE_URL}">mycommercepartner.com</a></p>
      <p style="margin-top:6px;">Questions? Reply to this email anytime.</p>
    </div>
  </div>
</body>
</html>`;
}

function purchaseConfirmationEmail({ name, planName, credits, price }) {
  const displayName = name ? name.split(' ')[0] : 'there';
  return emailBase(`
    <h2>You're all set, ${displayName}! 🎉</h2>
    <p>Your <strong>${planName} plan</strong> is now active. Here's what you have access to:</p>
    <div class="highlight-box">
      <p>📦 <strong>Plan:</strong> ${planName} — ${price}</p>
      <p>⚡ <strong>Monthly Credits:</strong> ${credits} listing optimizations</p>
      <p>✅ <strong>Status:</strong> Active</p>
    </div>
    <p>Head to your dashboard to start optimizing your eBay listings and watch your sales climb.</p>
    <p style="text-align:center;margin-top:24px;">
      <a href="${SITE_URL}/dashboard" class="btn">Go to Dashboard →</a>
    </p>
    <p style="margin-top:24px;">If you have any questions or need help getting started, just reply to this email — we're here for you.</p>
  `);
}

function topupConfirmationEmail({ name, credits, kind }) {
  const displayName = name ? name.split(' ')[0] : 'there';
  const kindLabel = kind === 'audit' ? 'Listing Audit' : kind === 'dfy' ? 'Done-For-You Package' : 'Credit Pack';
  return emailBase(`
    <h2>Purchase confirmed, ${displayName}! ✅</h2>
    <p>Your <strong>${kindLabel}</strong> purchase was successful.</p>
    <div class="highlight-box">
      <p>⚡ <strong>${credits} bonus credits</strong> have been added to your account</p>
      <p>📋 These are yours to use anytime — they never expire</p>
    </div>
    <p>Log in to your dashboard to put them to work.</p>
    <p style="text-align:center;margin-top:24px;">
      <a href="${SITE_URL}/dashboard" class="btn">Go to Dashboard →</a>
    </p>
  `);
}

function cancellationEmail({ name }) {
  const displayName = name ? name.split(' ')[0] : 'there';
  return emailBase(`
    <h2>Your subscription has been cancelled</h2>
    <p>Hi ${displayName}, we've processed your cancellation. Your account has been moved to the free plan.</p>
    <div class="highlight-box">
      <p>Your remaining credits are still available until they run out.</p>
    </div>
    <p>We'd love to know what we could have done better. If you have a moment, hit reply and let us know — it genuinely helps.</p>
    <p>If you change your mind, you can resubscribe anytime:</p>
    <p style="text-align:center;margin-top:24px;">
      <a href="${SITE_URL}/#pricing" class="btn">View Plans →</a>
    </p>
  `);
}

function paymentFailedEmail({ name, amount }) {
  const displayName = name ? name.split(' ')[0] : 'there';
  return emailBase(`
    <h2>Payment failed — action needed</h2>
    <p>Hi ${displayName}, we weren't able to process your payment of <strong>$${amount}</strong>.</p>
    <p>To keep your account active, please update your payment method:</p>
    <p style="text-align:center;margin-top:24px;">
      <a href="${SITE_URL}/api/billing-portal" class="btn">Update Payment Method →</a>
    </p>
    <p style="margin-top:24px;color:#e53e3e;font-size:13px;">If payment isn't resolved within 3 days, your account will be moved to the free plan.</p>
  `);
}

// ─── Supabase helpers ───────────────────────────────────────────────────────
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
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function getProfileByEmail(email) {
  const { ok, data } = await sbAdmin(
    `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`
  );
  if (!ok || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function getProfileById(userId) {
  const { ok, data } = await sbAdmin(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`
  );
  if (!ok || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function upsertProfile(profile) {
  const { ok, data } = await sbAdmin('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profile),
  });
  if (!ok) throw new Error(JSON.stringify(data));
  return Array.isArray(data) ? data[0] : data;
}

// ─── Stripe helpers ─────────────────────────────────────────────────────────
async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// ─── Signature verification ─────────────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signature, secret) {
  const parts = {};
  signature.split(',').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) parts[k] = parts[k] ? parts[k] + ',' + v : v;
  });
  if (!parts.t || !parts.v1) return false;
  const payload = `${parts.t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
  } catch {
    return false;
  }
}

// ─── Event handlers ─────────────────────────────────────────────────────────
async function handleCheckoutCompleted(session) {
  const email =
    session.customer_details?.email ||
    session.metadata?.email ||
    '';

  if (!email) {
    console.error('[webhook] checkout.session.completed — no email found', session.id);
    return;
  }

  // Find user — prefer metadata user_id, fall back to email lookup
  let profile = null;
  if (session.metadata?.user_id) {
    profile = await getProfileById(session.metadata.user_id);
  }
  if (!profile) {
    profile = await getProfileByEmail(email);
  }

  if (!profile) {
    console.log(`[webhook] no profile found for ${email} — storing pending upgrade`);
    await sbAdmin('/rest/v1/pending_upgrades', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        email,
        kind: session.metadata?.kind || 'plan',
        plan: session.metadata?.plan || null,
        topup_credits: Number(session.metadata?.topup_credits || 0),
        stripe_session_id: session.id,
        created_at: new Date().toISOString(),
      }),
    }).catch(() => {});
    return;
  }

  const kind       = session.metadata?.kind || 'plan';
  const topupCreds = Number(session.metadata?.topup_credits || 0);
  const planName   = session.metadata?.plan || null;
  const userName   = profile.full_name || '';

  const updated = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    trial_used: Number(profile.trial_used || 0),
    credits_used: Number(profile.credits_used || 0),
  };

  if (kind === 'plan' && planName) {
    updated.plan = planName;
    updated.bonus_credits = Number(profile.bonus_credits || 0);
    console.log(`[webhook] upgrading ${email} → ${planName}`);

    const info = PLAN_INFO[planName] || { credits: 0, price: '' };
    await sendEmail({
      to: email,
      subject: `You're on the ${planName} plan — welcome! 🎉`,
      html: purchaseConfirmationEmail({ name: userName, planName, credits: info.credits, price: info.price }),
    });
  } else if (kind === 'topup' || kind === 'audit' || kind === 'dfy') {
    updated.plan = profile.plan || null;
    updated.bonus_credits = Number(profile.bonus_credits || 0) + topupCreds;
    console.log(`[webhook] adding ${topupCreds} bonus credits to ${email} (${kind})`);

    await sendEmail({
      to: email,
      subject: 'Purchase confirmed — credits added ✅',
      html: topupConfirmationEmail({ name: userName, credits: topupCreds, kind }),
    });
  }

  await upsertProfile(updated);
  console.log(`[webhook] profile updated for ${email}`);
}

async function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;
  const { ok, data: customer } = await stripeGet(`/v1/customers/${encodeURIComponent(customerId)}`);
  if (!ok || !customer?.email) {
    console.error('[webhook] subscription.deleted — could not fetch customer', customerId);
    return;
  }

  const profile = await getProfileByEmail(customer.email);
  if (!profile) {
    console.log(`[webhook] subscription.deleted — no profile for ${customer.email}`);
    return;
  }

  await upsertProfile({
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    plan: null,
    trial_used: Number(profile.trial_used || 0),
    credits_used: Number(profile.credits_used || 0),
    bonus_credits: Number(profile.bonus_credits || 0),
  });

  await sendEmail({
    to: customer.email,
    subject: 'Your MyCommercePartner subscription has been cancelled',
    html: cancellationEmail({ name: profile.full_name }),
  });

  console.log(`[webhook] downgraded ${customer.email} to free (subscription cancelled)`);
}

async function handlePaymentFailed(invoice) {
  const email  = invoice.customer_email || '';
  const amount = ((invoice.amount_due || 0) / 100).toFixed(2);
  console.log(`[webhook] invoice.payment_failed for ${email} — amount: $${amount}`);

  if (email) {
    const profile = await getProfileByEmail(email);
    await sendEmail({
      to: email,
      subject: 'Action required — payment failed',
      html: paymentFailedEmail({ name: profile?.full_name || '', amount }),
    });
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set');
    res.status(500).json({ error: 'Webhook not configured' });
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    res.status(400).json({ error: 'Could not read body' });
    return;
  }

  const signature = req.headers['stripe-signature'] || '';
  if (!verifySignature(rawBody, signature, STRIPE_WEBHOOK_SECRET)) {
    console.error('[webhook] signature verification failed');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  console.log(`[webhook] received: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        // Handled via checkout.session.completed for upgrades
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[webhook] handler error for ${event.type}:`, err.message);
    res.status(200).json({ received: true, warning: 'Handler error logged' });
    return;
  }

  res.status(200).json({ received: true });
};
