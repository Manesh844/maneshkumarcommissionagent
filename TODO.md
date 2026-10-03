# Manesh Kumar Commission Agent — TODO

## REBRAND + REDESIGN 2026-10-02 (nukto.shop → Manesh Kumar Commission Agent) — ✅ complete

| Area | Done |
|---|---|
| Identity | Store name, short name, tagline, `<title>`, meta description, OG/Twitter cards, JSON-LD `Store` schema, canonical URLs |
| Domain | `nukto.shop` → `maneshkumarcommissionagent.dpdns.org` (frontend, Edge Functions `ALLOWED_ORIGINS` + `SITE_URL`, docs) |
| Email | `support@` / `no-reply@` / `orders@maneshkumarcommissionagent.dpdns.org`; Brevo sender + all transactional subjects |
| Logo | New `logo.svg` (gold shopping bag on a royal-blue tile) + animated `img/mkca-shopping-bag-loop.svg` for the boot splash; `favicon-32`, `logo-192`, `logo-512`, `og-cover` re-rendered; old GIF deleted |
| Colour | Violet → **Royal Blue `#1E3A8A` + Gold `#D4A017`**; full `:root` token set; theme `orange`/"Nukto Violet" → `royal`, with `THEME_ALIASES` so saved themes still resolve |
| Layout | Hero rebuilt (eyebrow, trust pills, dual CTA), footer rebuilt (4 columns), header + admin sidebar brand lockup, section headings get a gold rule, cards/buttons/notices/modals/auth re-styled |
| Lockup | `MANESH KUMAR` over `COMMISSION AGENT`, 40px mark desktop / 34px mobile, 38px footer, 30px admin — no mobile overflow |
| Wallet | "Nukto Wallet"/"Nukto Coins" → **MK Wallet / MK Coins** (1 MK Coin = 1 PKR), Urdu copy updated |
| Content | About rewritten for the commission-agent model; Contact, Terms, Privacy, Refund, Shipping, cookie banner, WhatsApp order message |
| Exports | `mkca-orders.csv`, `mkca-products.csv`, `mkca-backup-*.json` |
| SEO/PWA | `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, security + cache headers in `vercel.json` |
| Docs | Root `README.md`, store `README.md`, `DEPLOY_BACKEND.md`, `ECOMM_REVIEW.md`, SQL comment banners, `build_catalog.py` placeholder artwork |
| Tests | `tests/harness.js` brand assertions rewritten for the new lockup/logo/SVG mark — **256 passed / 0 failed** |

**Deliberately NOT changed (owner's instruction — "database ko haath nahi lagana"):**
Supabase tables `nukto_*`, browser `localStorage` keys `nukto.*`, and the
`window.NUKTO_CATALOG` global. These are storage identifiers that customers never
see; renaming them would require a live migration. Phone number `03420286170` /
`wa.me/923420286170` and the Sanghar address are unchanged by request.

**Follow-ups for the owner (not code):**
- Point DNS for `maneshkumarcommissionagent.dpdns.org` at Vercel, then set the Vercel
  Root Directory to `maneshkumarcommissionagent`.
- Update the Supabase Edge Function secrets `ALLOWED_ORIGINS` and `SITE_URL` to the new
  domain, otherwise checkout will be blocked by CORS.
- Add the Brevo DKIM/SPF records for the new domain and set up `support@` forwarding.

---

## PRODUCTION LOGIC MASTER LIST (owner's 16-section checklist — status 2026-09-05)

1. **Products** — ✅ create/edit/delete, stock label, variants, images/videos, categories, featured sections, related.
   ⬜ draft/published toggle, SKU field display, per-variant price/stock, tags manager, manual ordering.
2. **Pricing** — ✅ cost vs selling, ratio pricing, compare-at + discount %, coupons, free-shipping threshold, orders keep their price snapshot.
   ⬜ scheduled sales, fixed-per-product discount, price rounding rules page.
3. **Cart** — ✅ add/remove, qty change, stock validation, persistence. ⬜ cart expiry, min/max qty rules, "price changed since add" notice.
4. **Checkout** — ✅ info, address, phone validation, COD/wallet/bank, totals, confirmation. ✅ duplicate-submit guard + unique order ids (added).
   ⬜ billing-vs-shipping split, tax, session expiry.
5. **Orders** — ✅ statuses + admin change + customer notifications + order history. ⬜ partial refund, failed status.
6. **Payments** — ✅ COD, wallet, bank proof queue, never auto-"paid". ⬜ online gateway, callbacks, timeout release.
7. **Inventory** — ✅ stock from CSV, decrements on order, ✅ cancel/return restores stock (added), no negative stock.
   ⬜ true concurrency lock (needs server), variant-wise stock, adjustment history UI.
8. **Users** — ✅ profile, addresses, orders, wishlist, cart, wallet, login lockout (added). ⬜ guest checkout, password reset email.
9. **Wallet** — ✅ top-up request → pending → confirmed/failed, unique txn ids, admin adjustments logged, no negative balance.
   ⬜ server-authoritative balance (needs server).
10. **Coupons** — ✅ fixed/pct/free-delivery, start+expiry, min order, active flag, usage cap, ✅ once-per-customer (added).
    ⬜ max discount cap, product/category-specific, first-order coupons, stacking rules.
11. **Shipping** — ✅ flat fee + free-above editable in admin, delivery statuses. ⬜ zones, weight-based, courier + tracking number, delivery estimate.
12. **Search/filter** — ✅ title search, typo tolerance, category, price max, availability, discount, rating, sorting, pagination, empty state, ✅ keyword suggestions (added).
    ⬜ rating filter, color/size filters, brand filter.
13. **Reviews** — ✅ rating, text, verified purchase, admin moderation (hide/show), average rating. ⬜ images in reviews, report button, user edit/delete.
14. **Admin** — ✅ products/categories/orders/users/wallets/payments/coupons/shipping/reviews/banners/settings/analytics/activity log.
    ⬜ menus editor, SEO fields, maintenance mode.
15. **Security** — ✅ SHA-256 passwords, 2FA PIN, team roles, login brute-force lockout (added), input escaping, hardened Supabase RLS file.
    ⬜ server-side auth, sessions, rate limiting, CSRF, audit-log export (all need a backend).
16. **Edge cases** — ✅ double-pay guard, duplicate order ids, price-change safe (orders snapshot prices), cancel-restock, coupon expiry at checkout, refresh-safe success.
    ⬜ simultaneous last-item (needs server), partial returns, payment-callback replay, category-delete protection with products.

### 2026-09-05 (audit-prompt round)
- [x] New brand palette applied (#6C3CE9 primary / #F8F7FB bg / #202024 text / #171321 dark)
- [x] Cart always recalculates at CURRENT catalog price (variant-aware) — never stale add-time price
- [x] Out-of-stock/over-qty cart lines flagged; checkout blocked until fixed
- [x] Order status flow guard (delivered can't go back to pending etc.) + who/what logged
- [ ] Admin manual balance edit with mandatory reason (backend ledger requirement)
- [ ] Header/footer fully admin-editable (menus, social links, payment/shipping info blocks)

### 2026-09-05 (server-side safety layer — CODE READY)
- [x] True last-item lock: `reserve_stock()` atomic SQL + `place_order_secure()` — supabase_backend.sql
- [x] Tamper-proof orders: server recalculates price/coupon/delivery/wallet; client sends only IDs
- [x] Payment webhook: functions/payment-webhook (HMAC-verified, idempotent pending→verified, fail par stock release)
- [x] Password reset: functions/password-reset (Brevo email, hashed 30-min token) + #reset page + "Forgot Password?" link
- [ ] OWNER ACTION: DEPLOY_BACKEND.md ke 4 steps chalana (SQL + functions deploy + secrets + gateway webhook URL)

### 2026-09-05 (integration pipeline)
- [x] Keys received: service role + Brevo (chat mein) — deploy dashboard se hoga (sandbox network sirf github allow karta hai)
- [ ] OWNER: DEPLOY_BACKEND.md ke dashboard steps (SQL → functions → secrets → test)
- [ ] OWNER: sbp_ access token dashboard se REVOKE karein
- [ ] EasyPaisa integration — merchant approval aate hi store ID + hash key share → payment-webhook mein map
- [ ] Cloudflare: domain connect → Turnstile CAPTCHA (bot/DDoS protection) → phir Brevo DKIM/SPF records Cloudflare DNS mein
- [ ] Live hone ke baad: production smoke test (order + reset email + webhook)

---

### 2026-09-09 (Merge #9 — owner's to-do list, item-by-item status)

Products rows/columns (the main complaint):
- [x] **Products ab rows + columns mein fit hote hain** — `.cat-rail` ab horizontal flex scroller hai (har category = aik row, andar columns), aur home ke neeche endless `.pgrid` (responsive auto-fill) hai. Mobile par 2 columns, desktop par screen ke hisaab se jitni aa saken. Pichhle merge ki "vertical/ek-line" bug fix.

Owner's 7 points:
1. [x] **Charges order summary mein** — dono jagah (cart + checkout) same 6 charge rows, same amounts (`chargesBoxHTML`).
2. [x] **Tax & charges heading badi** (16px→19px) + professional tagline; expand chevron clean SVG; T&C text readable (14px, line-height 1.65) with TERMS & CONDITIONS label.
3. [x] **Unlimited products page** — koi pagination nahi; scroll karte jao feed chalta rahe (IntersectionObserver + Load more fallback).
4. [x] **Banner handwriting badi** — hero banner ab `banner-line` heading-style (clamp 20–28px, bold).
5. [x] **Smooth experience** — videos sirf visible hone par play/pause (`smoothMedia`), lazy media, append-only feed (scroll jump nahi), observers har render par wire.
6. [x] **Related + suggested products** — search par related, recommended/trending/crazy + shuffled tag suggestions har visitor ke liye alag.
7. [x] **Category rails + Categories page** — home par har category ki left-to-right rail (12–15 shuffled + "Show more"), up/down = rows, left/right = rail; header "Categories" ab `#categories` scroll page kholta hai.

Verification: `node tests/harness.js` → **205 passed, 0 failed**.

---

### 2026-09-10 (Merge #11 round-2 — owner's new to-do, item-by-item)

- [x] **Charges expand → TERMS & CONDITIONS ke baad punchlines** — bijli "Bijli ka bill tera baap bharega", netflix "Netflix ka paisa bhi to kahin se aayega", kapray "Nanga thori ghoomna hai", food "Bhai hum bhi khaate hain", dukaan "Dukaan hawa mein thori chalti hai", publicity "Logon ko pata bhi toh chale dukaan hai". (`.chc-punch` bold line.)
- [x] **Jiske charges zyada, usko line se batao** — dynamic hint har cart mein: sabse bare charge par "· sabse zyada", sabse chhote par "· sabse kam".
- [x] **Categories page** — oper categories ke naam (chips); neeche har category ke products left-to-right rail; "Show more" (purana "High demand best sellers" hata) click par us category par redirect; sari categories ek-ek karke products ke sath.
- [x] **Sort option modern** — `.select` appearance:none + custom chevron + hover/focus polish.
- [x] **Poora website fluid/responsive** — `.wrap/.nav-inner/.foot-in/.foot-bar` se fixed 1320px hata (ab `max-width:none` + fluid padding); `.pgrid` ab `auto-fill,minmax(176px,1fr)` (zoom/width ke sath columns khud badhte/ghatte hain); `.skGrid/.how/.trust/.foot-in` bhi auto-fit. Koi fixed columns nahi; koi bara khali space nahi.

Verification: `node tests/harness.js` → **221 passed, 0 failed**.
