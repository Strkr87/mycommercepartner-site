# Demand test: will eBay sellers pay to fix their listings in bulk?

**Run for:** 3 weeks. **Budget:** $0 plus about 1 hour a day.

## The question

eBay's free "Magical Listing" tool now writes titles and descriptions for new listings, so a single-listing rewriter is hard to charge for. The bet worth testing is different:

> Sellers with 100+ live listings will pay about $49/month for a tool that finds their weakest listings and fixes them in bulk.

## Decision rule (set before starting, so the results decide)

| After 3 weeks | Meaning | Next step |
|---|---|---|
| **3+ sellers pay** (founding month or the $199 cleanup pack) | Real demand | Build the eBay connection and bulk fixing |
| 10+ checkup requests, 0–2 pay | Interest, but not in paying for this | Change the offer (price, done-for-you service) and re-test for 2 weeks |
| Under 10 checkup requests after 30+ conversations | Weak demand | Stop and pick a different problem |

"Sounds cool" and "I'd use that" don't count. Only payments and checkup requests count.

## Evidence so far (from public research, Sept 2026)

- **The pain is real and frequent.** eBay's community forums have steady threads like "listing not getting views", "items ending with no views" and "views but no sales". Common advice points back to titles and item specifics.
- **eBay's free AI draws complaints.** Sellers report wrong item identification, wrong specifics and generic descriptions, and some say correcting it takes longer than writing the listing themselves. That makes "only uses facts from your listing" a real selling point.
- **People already pay for this.** Frooition sells bulk revision and managed eBay SEO, Optiseller sells a tool for finding missing item specifics, and ZIK Analytics sells title building with search data. Paying competitors are a good sign: the market exists.

Sources:
- https://community.ebay.com/t5/Selling/Listing-not-getting-views/m-p/35025709
- https://www.valueaddedresource.net/ebay-ai-magical-listing-complaints/
- https://community.ebay.com/t5/Selling/A-I-description-errors-running-rampant-on-ebay/m-p/34965189/highlight/true
- https://www.frooition.com/blog/why-your-ebay-listings-are-invisible-and-how-to-fix-it/
- https://www.zikanalytics.com/blog/ebay-title/

## Where to find sellers

1. **eBay Community, Selling board** (community.ebay.com). Answer "no views" threads with real, specific help. Don't post links in the first replies; build a history first.
2. **Reddit:** r/Flipping, r/eBay, r/EbaySellerAdvice. Same approach: be helpful first, then offer the free checkup where the rules allow it. Read each subreddit's self-promotion rules.
3. **Facebook groups** for eBay resellers (search "eBay sellers", "reseller community"). Many allow promotion on set days.
4. **Direct outreach.** Search eBay for categories you know, find stores with 100+ listings and weak titles (all caps, cut-off, missing brand or model), and message them through eBay or their store's contact details.
5. **YouTube reseller channels.** Comment on "why my eBay listings don't sell" videos.

## Scripts

**Forum or Reddit reply** (on a "no views / no sales" thread):
> Looked at your listing. Three things jump out: [specific issue 1], [specific issue 2], [specific issue 3]. Fixing item specifics usually matters most, since that's what eBay's filters use. Happy to look at more if you want.

If they reply, offer: *"I'm testing a tool that does this across a whole store. I can run your 20 weakest listings through it for free if you're up for giving feedback."*

**Direct message to a store:**
> Hi, I help eBay sellers fix listings that aren't getting views. I noticed a few of yours (like "[their title]") are missing [brand/model/size] in the title and some item specifics, which hurts search. I'm offering free checkups of a store's 20 weakest listings while I test a new tool. Want one? No catch, I just want feedback.

**The ask, after sending a checkup** (this is the real test):
> Glad it was useful. I'm building this to connect to your store and fix everything in bulk, then show you the change in views and sales. Founding members get it for $49/month, locked in. Want in? I can also do these 20 fixes for you now as a one-off for $199.

Then stop talking and see what they say. Take payment right away (a Stripe payment link) if they say yes.

## Running a checkup (about 20 minutes each)

1. Open their store and sort by oldest, or look for listings with no watchers.
2. Pick the 20 weakest: bad titles, missing specifics, thin descriptions.
3. Run each through `/v2` (or the dashboard) and paste the results into a Google Doc: current title vs. new title, missing item specifics, top 3 fixes.
4. Send the doc with the ask above.

## Tracking

Keep one sheet with columns: date, seller, source (forum/Reddit/FB/DM), listings count, checkup sent (y/n), response to ask, paid (y/n, amount), notes and quotes.

Also check weekly:
- Vercel → Analytics: visits to `/v2`, and where they came from.
- Your inbox for "Store checkup + bulk-fix early access" requests from the `/v2` form.

## Setup checklist

- [ ] Enable Web Analytics in Vercel (Project → Analytics → Enable). The tracking script is already on `/` and `/v2`.
- [ ] Make `/v2` reachable on mycommercepartner.com (merge the branch) so outreach links point at the real domain.
- [ ] Confirm the SMTP settings (`SMTP_USER`, `SMTP_PASS`) are set in production so checkup requests reach your inbox.
- [ ] Create a Stripe payment link for the "$49 founding month".
- [ ] Set up the tracking sheet.
