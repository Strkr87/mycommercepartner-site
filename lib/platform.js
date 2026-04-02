const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const PRICE_STARTER = process.env.STRIPE_PRICE_STARTER || "";
const PRICE_GROWTH = process.env.STRIPE_PRICE_GROWTH || "";
const PRICE_ENTERPRISE = process.env.STRIPE_PRICE_ENTERPRISE || "";

function planCreditLimit(plan) {
  if (plan === "Starter") return 50;
  if (plan === "Growth") return 250;
  if (plan === "Enterprise") return 800;
  return 0;
}

function json(res, status, body, headers = {}) {
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.status(status).json(body);
}

function authEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function paymentsEnabled() {
  return Boolean(STRIPE_SECRET_KEY && PRICE_STARTER && PRICE_GROWTH && PRICE_ENTERPRISE);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function supabaseAuth(path, options = {}) {
  return fetchJson(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function supabaseAdmin(path, options = {}) {
  return fetchJson(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
}

async function getUserFromToken(accessToken) {
  if (!authEnabled() || !accessToken) return null;
  const { response, data } = await supabaseAuth("/auth/v1/user", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok || !data?.id) return null;
  return data;
}

async function getProfile(userId) {
  if (!authEnabled() || !userId) return null;
  const { response, data } = await supabaseAdmin(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`);
  if (!response.ok || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function upsertProfile(profile) {
  const { response, data } = await supabaseAdmin("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(profile)
  });
  if (!response.ok) throw new Error(data?.message || "Unable to save profile");
  return Array.isArray(data) ? data[0] : data;
}

function serializeUser(user, profile = {}) {
  const creditsUsed = Number(profile.credits_used || 0);
  const bonusCredits = Number(profile.bonus_credits || 0);
  const creditsLimit = planCreditLimit(profile.plan || "") + bonusCredits;
  return {
    id: user.id,
    email: user.email,
    name: profile.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email,
    plan: profile.plan || "",
    trialUsed: Number(profile.trial_used || 0),
    creditsUsed,
    bonusCredits,
    creditsLimit,
    creditsRemaining: creditsLimit ? Math.max(0, creditsLimit - creditsUsed) : 0
  };
}

function planToPriceId(plan) {
  if (plan === "Starter") return PRICE_STARTER;
  if (plan === "Growth") return PRICE_GROWTH;
  if (plan === "Enterprise") return PRICE_ENTERPRISE;
  return "";
}

async function findStripeCustomerByEmail(email) {
  if (!paymentsEnabled() || !email) return null;
  const { response, data } = await stripeGet(`/v1/customers?email=${encodeURIComponent(email)}&limit=1`);
  if (!response.ok || !Array.isArray(data?.data) || !data.data.length) return null;
  return data.data[0];
}

async function stripeRequest(path, body) {
  const encoded = new URLSearchParams(body);
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: encoded.toString()
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function stripeGet(path) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY,
  authEnabled,
  paymentsEnabled,
  json,
  supabaseAuth,
  supabaseAdmin,
  getUserFromToken,
  getProfile,
  upsertProfile,
  serializeUser,
  planCreditLimit,
  planToPriceId,
  findStripeCustomerByEmail,
  stripeRequest,
  stripeGet
};
