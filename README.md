# MyCommercePartner Launch Stack

Launch-ready Vercel site for an eBay listing optimization SaaS.

## What is included

- Marketing + product landing page
- Interactive listing optimizer workspace
- Credit-based pricing
- Serverless `POST /api/optimize` endpoint for title and copy suggestions
- Free-trial gating with upgrade prompts
- Production auth scaffolding with Supabase
- Production subscription checkout scaffolding with Stripe
- Frontend fallback logic so the page still works if the API is unavailable

## Project structure

- `index.html` - front end
- `api/optimize.js` - Vercel serverless endpoint
- `api/config.js` - frontend runtime config
- `api/auth/*` - signup, login, and session endpoints
- `api/checkout.js` - Stripe checkout session creation
- `api/checkout-status.js` - post-checkout verification and plan activation
- `api/billing-portal.js` - Stripe customer portal launch for subscription management
- `vercel.json` - deployment configuration
- `supabase/schema.sql` - required database schema

## Go-live path

1. Push this folder to a Git repository.
2. Import the repository into Vercel.
3. Set the project root to `mycommercepartner-site`.
4. Create a Supabase project.
5. Run `supabase/schema.sql` in the Supabase SQL editor.
6. Create Stripe products and recurring prices for Starter, Growth, and Enterprise.
7. Add the environment variables below in Vercel.
8. Deploy.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_ENTERPRISE`

## What works after setup

- Real seller sign-up
- Real seller login
- Trial tracking tied to signed-in users
- Stripe subscription checkout from pricing buttons
- Plan activation after successful checkout return
- Customer self-serve billing management and cancellation through Stripe
- Trial limit enforcement before upgrade

## Remaining production tasks

- Replace heuristic optimizer logic in `api/optimize.js` with a real OpenAI integration
- Store listing runs per seller in Supabase
- Add credit deduction and replenishment rules by plan
- Add email verification and password reset flows

## Notes

- This repo is deployment-ready for a static + serverless launch path on Vercel.
- If Supabase or Stripe env vars are missing, the page falls back to demo-safe behavior instead of breaking.
