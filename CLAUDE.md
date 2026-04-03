# MyCommercePartner — CLAUDE.md

This file gives Claude context about the mycommercepartner.com codebase so it can orient quickly and contribute effectively.

---

## What This Project Does

MyCommercePartner is a SaaS tool that helps eBay sellers optimize their product listings. Users paste in their listing data (title, SKU, category, item specifics, condition, shipping) and the app returns an optimized title, bullet points, a full description, plus SEO, Conversion, and Completeness scores with actionable suggestions.

The current optimizer is **heuristic/rule-based** (not AI). The next major milestone is replacing it with a real **OpenAI-powered** optimizer.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — single `index.html` file |
| Backend | Node.js serverless functions (Vercel) |
| Database | Supabase (PostgreSQL with Row-Level Security) |
| Auth | Supabase Auth (email/password, Bearer tokens) |
| Payments | Stripe (subscriptions + one-time credit topups) |
| Deployment | Vercel |
| Build tools | None — no bundler, no npm, no package.json |

---

## Project Structure

```
mycommercepartner-site/
├── index.html              # Entire frontend: marketing site + app (SPA)
├── CLAUDE.md               # This file
├── README.md               # Setup and go-live instructions
├── vercel.json             # Deployment config + security headers
├── api/
│   ├── _lib/platform.js   # Fallback 404 handler
│   ├── auth/
│   │   ├── signup.js      # POST /api/auth/signup
│   │   ├── login.js       # POST /api/auth/login
│   │   └── me.js          # GET /api/auth/me (session check)
│   ├── optimize.js        # POST /api/optimize — core listing optimizer
│   ├── config.js          # GET /api/config — feature flags for frontend
│   ├── checkout.js        # POST /api/checkout — Stripe subscription checkout
│   ├── checkout-status.js # GET /api/checkout-status — activate plan post-payment
│   ├── billing-portal.js  # POST /api/billing-portal — Stripe self-serve portal
│   └── topup.js           # POST /api/topup — one-time credit purchase
├── lib/
│   └── platform.js        # Frontend helper library (auth, plans, credit limits)
├── supabase/
│   └── schema.sql         # DB schema: profiles + guest_trials tables
└── assets/                # Marketing images
```

---

## Database Schema

### `public.profiles`
Stores all registered users and their subscription state.

| Column | Type | Notes |
|---|---|---|
| id | UUID | FK → auth.users |
| email | text | |
| full_name | text | |
| plan | text | `Starter`, `Growth`, `Enterprise`, or `null` |
| trial_used | int | 0–2; guests tracked separately |
| credits_used | int | Resets or accumulates per plan logic |
| bonus_credits | int | Added from one-time topup purchases |
| created_at / updated_at | timestamptz | Auto-managed via trigger |

### `public.guest_trials`
Anonymous trial tracking without requiring sign-up.

| Column | Type | Notes |
|---|---|---|
| fingerprint | text (PK) | SHA256 of device identifier |
| trial_used | int | 0–2 free uses |

**RLS:** Users can only read/update their own profiles. Service role manages guest trials.

---

## Plans & Credits

| Plan | Monthly Credit Limit |
|---|---|
| Starter | 50 |
| Growth | 250 |
| Enterprise | 800 |

Users can also purchase bonus credit topups (100/$59, 250/$129, 500/$229) as one-time purchases via Stripe.

Guest users get **2 free trials** before being prompted to sign up.

---

## Environment Variables

All secrets are set in Vercel environment variables. Never commit them.

```
SUPABASE_URL              # Supabase project API URL
SUPABASE_ANON_KEY         # Safe for frontend/client use
SUPABASE_SERVICE_ROLE_KEY # Admin key — server-side only (optimize, topup, checkout-status)
STRIPE_SECRET_KEY         # Stripe API key
STRIPE_PRICE_STARTER      # Stripe price ID for Starter plan
STRIPE_PRICE_GROWTH       # Stripe price ID for Growth plan
STRIPE_PRICE_ENTERPRISE   # Stripe price ID for Enterprise plan
```

---

## API Conventions

- All handlers export `async (req, res)` serverless functions
- Method not supported → `405 Method Not Allowed`
- Auth errors → `401 Unauthorized`
- Payment/credit errors → `402 Payment Required`
- All responses are JSON
- Auth uses `Authorization: Bearer <token>` header
- Feature flags in `api/config.js` allow graceful degradation when services are unavailable

---

## Frontend Conventions

- Everything lives in one `index.html` file — embedded CSS and JS, no external bundles
- Session tokens stored in `localStorage`
- Auth modals (login/signup) are overlay-based
- The hero/marketing section hides when user is logged in
- Scores (SEO, Conversion, Completeness) update in real-time
- Client-side fallback optimizer runs if `/api/optimize` is unreachable

---

## Current Status (as of April 2026)

**~80% production-ready.** Core platform is fully functional:

✅ User signup, login, session management
✅ Heuristic listing optimizer (rule-based)
✅ Guest trial enforcement (2 free uses via device fingerprint)
✅ Plan-based credit limits
✅ Stripe subscription checkout
✅ Stripe billing portal (self-serve upgrade/cancel)
✅ One-time credit topup purchases
✅ Mobile-responsive UI
✅ Vercel deployment with security headers
✅ Supabase RLS policies

---

## What We're Building Toward

The key next milestones in priority order:

1. **Replace heuristic optimizer with OpenAI** — Call GPT-4 (or similar) in `api/optimize.js` to generate real AI-powered titles, bullets, and descriptions instead of rule-based output.

2. **Listing history** — Persist each optimization run per user in a new `listing_runs` table (user_id, input, output, scores, timestamp). Show history in the dashboard.

3. **Credit deduction logic** — Properly deduct from `bonus_credits` first, then `credits_used` against the plan limit on each optimize call.

4. **Email verification** — Supabase has built-in email confirmation; it just needs to be wired into the signup flow.

5. **Password reset** — Supabase supports this natively; add a "Forgot password?" link and flow.

6. **Stripe webhooks** — Replace the manual `checkout-status` polling with proper `checkout.session.completed` and `customer.subscription.updated` webhook handlers.

---

## Key Files to Know

- **`api/optimize.js`** — The core of the product. This is where the optimizer logic lives and where OpenAI integration will go.
- **`lib/platform.js`** — Frontend auth + plan helpers. Contains `planCreditLimit()` and user serialization.
- **`supabase/schema.sql`** — Run this once when setting up a new Supabase project.
- **`index.html`** — The entire frontend. Search for `// === SECTION:` comments to navigate.

---

## Common Tasks

**Add a new API endpoint:**
Create `api/your-endpoint.js`, export `async (req, res)`. It's auto-routed by Vercel at `/api/your-endpoint`.

**Update the optimizer logic:**
Edit `api/optimize.js`. The main logic is in the `optimize()` function. The entry handler is `module.exports`.

**Update pricing or plan limits:**
Update `lib/platform.js` → `planCreditLimit()` and `planPriceId()`. Also update the pricing table in `index.html`.

**Modify the database schema:**
Update `supabase/schema.sql` and run the relevant SQL in the Supabase SQL editor. For new tables, add RLS policies.

**Deploy:**
Push to the main branch. Vercel auto-deploys on push.
