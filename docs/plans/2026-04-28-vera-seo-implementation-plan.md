# MyCommercePartner SEO implementation plan — 2026-04-28

## Primary SEO targets
- Amazon marketplace account management
- eBay account management
- Amazon listing help
- eBay title optimization
- Amazon and eBay listing audit
- marketplace listing optimization
- ecommerce marketplace support
- product brand marketplace management
- marketplace account-health support
- Listing Rescue sprint

## Pages optimized in this pass
- `/` — primary landing page for Amazon and eBay marketplace account management.
- `/listing-rescue.html` — service landing page for a focused Amazon/eBay listing optimization sprint.
- `/blog.html` — resource hub for marketplace account management and listing-improvement guides.
- `/blog-amazon-listing-basics.html` — Amazon listing help article.
- `/blog-ebay-title-basics.html` — eBay title optimization article.
- `/blog-marketplace-review-basics.html` — Amazon/eBay listing audit checklist article.
- `/about.html`, `/faq.html`, `/contact.html` — supporting trust and conversion pages.
- `/website-reviews.html`, `/missed-lead-recovery.html` — lower-priority service pages retained in sitemap with lower priority.

## Technical/on-page work completed
- Added unique SEO titles and meta descriptions across public HTML pages.
- Added canonical URLs for public pages.
- Added Open Graph and Twitter summary metadata.
- Added JSON-LD schema:
  - Organization, WebSite, and ProfessionalService schema on the homepage.
  - Article schema on blog articles.
  - WebPage/CollectionPage schema on supporting pages.
- Added `robots.txt` with sitemap reference and crawl exclusions for dashboard, backup, and design-option pages.
- Added `sitemap.xml` for core public URLs.
- Added `noindex,follow` to `dashboard.html` because it is an application/account page rather than a search landing page.
- Updated Listing Rescue page copy and CTAs toward team-led Amazon/eBay listing cleanup rather than self-serve credit language.

## Next content topics
1. Amazon account management for product brands: what to fix before advertising.
2. eBay account management checklist for brands with stale inventory.
3. How to run a marketplace listing audit before hiring support.
4. Amazon listing optimization examples: title, bullets, images, details.
5. eBay item specifics guide: how missing details hurt buyer confidence.
6. Marketplace account-health basics for small product brands.
7. Product brand marketplace management: when to use a sprint vs ongoing support.

## Maintenance checklist
- Add every new article to `blog.html` and `sitemap.xml`.
- Keep public copy focused on team-led support, listing audits, and marketplace account management.
- Avoid guaranteed revenue claims.
- Avoid internal/tooling terms in public copy.
- Re-run local link and forbidden-term checks before each deploy.
