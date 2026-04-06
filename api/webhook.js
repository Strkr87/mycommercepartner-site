// api/webhook.js — Stripe webhook handler
// Handles: checkout.session.completed, customer.subscription.deleted, invoice.payment_failed
//
// Required env vars (set in Vercel dashboard):
//   STRIPE_SECRET_KEY         — sk_live_...
//   STRIPE_WEBHOOK_SECRET     — whsec_... (from Stripe webhook dashboard)
//   SUPABASE_URL              — https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (not anon key)

const crypto = require('crypto');

// ─── Config ────────────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_URL          = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Price ID → plan credits map (covers both old and new price IDs)
const PLAN_CREDITS = { Starter: 50, Growth: 250, Enterprise: 800 };

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
    // User hasn't signed up yet — store pending upgrade keyed by email
    // They'll get their plan when they sign up
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
    }).catch(() => {}); // non-fatal if table doesn't exist yet
    return;
  }

  const kind = session.metadata?.kind || 'plan';
  const topupCredits = Number(session.metadata?.topup_credits || 0);
  const planName = session.metadata?.plan || null;

  const updated = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    trial_used: Number(profile.trial_used || 0),
    credits_used: Number(profile.credits_used || 0),
  };

  if (kind === 'plan' && planName) {
    // Subscription purchase — set plan, reset credits
    updated.plan = planName;
    updated.bonus_credits = Number(profile.bonus_credits || 0);
    console.log(`[webhook] upgrading ${email} → ${planName}`);
  } else if (kind === 'topup' || kind === 'audit' || kind === 'dfy') {
    // One-time purchase — add bonus credits
    updated.plan = profile.plan || null;
    updated.bonus_credits = Number(profile.bonus_credits || 0) + topupCredits;
    console.log(`[webhook] adding ${topupCredits} bonus credits to ${email} (${kind})`);
  }

  await upsertProfile(updated);
  console.log(`[webhook] profile updated for ${email}`);
}

async function handleSubscriptionDeleted(subscription) {
  // Find customer email via Stripe
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
    plan: null, // downgrade to free
    trial_used: Number(profile.trial_used || 0),
    credits_used: Number(profile.credits_used || 0),
    bonus_credits: Number(profile.bonus_credits || 0),
  });
  console.log(`[webhook] downgraded ${customer.email} to free (subscription cancelled)`);
}

async function handlePaymentFailed(invoice) {
  // Log only — could send email notification in future
  const email = invoice.customer_email || '';
  console.log(`[webhook] invoice.payment_failed for ${email} — amount: $${(invoice.amount_due || 0) / 100}`);
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
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        // Unhandled event — acknowledged but ignored
        break;
    }
  } catch (err) {
    console.error(`[webhook] handler error for ${event.type}:`, err.message);
    // Still return 200 so Stripe doesn't retry — log the error
    res.status(200).json({ received: true, warning: 'Handler error logged' });
    return;
  }

  res.status(200).json({ received: true });
};
