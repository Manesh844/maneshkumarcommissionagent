# Nukto.Shop — TODO (from user's problem list, 2026-09-05)

Every item below was verified against `index.html` / `catalog.js` at commit `0ddfdc9`.
Line numbers refer to the file as it was when the list was written.

---

## A. Data & persistence layer (root cause of several reported bugs)

- [x] **A1. `store.set()` swallows localStorage quota errors silently.**
  `store.set = (k,v) => { try{ localStorage.setItem(...) } catch(e){} }` (line ~376).
  `saveAll()` writes 12 keys including full `users`, `orders`, `txns`, `analytics`
  (`analytics.productViews` + `addToCart` grow unbounded). Once the ~5 MB quota is hit,
  **every** admin edit silently stops persisting, and `nukto.user` is lost on reload
  (→ looks like "logged out / Create Account again").
  → Make `set()` return ok/fail, prune oversized analytics maps, surface a warning.

- [x] **A2. `saveAll()` calls `syncCloud()` on *every* save.**
  Each call builds a full `nukto_snapshot` row containing the entire store
  (`settings, supabase, coupons, analytics, prodEdit, users, orders, txns, returns`)
  and POSTs it to Supabase — including on every single keystroke of an inline stock edit.
  → Only sync on meaningful changes, debounce hard, never snapshot on routine saves.

- [x] **A3. `store` has no `del()`.** Needed to purge stale demo data (see C3).

## B. Storefront / catalogue

- [x] **B1. Remove the fake "Only N left in stock" urgency label.**
  `stockLabel()` (line 663) prints `⚡ Only N left in stock` for `stock <= 3`, and is
  rendered on **every** product card (line 1130) and the detail page (line 1359).
  Catalog stock is synthesised 1–60 (`build_catalog.py`), so 1,888 of 9,804 products
  (19%) permanently show it. That is the "5 left on every product" the user saw.
  → Keep a real `Out of Stock` label only.

- [x] **B2. Remove the Home page. Products page becomes the only landing page.**
  `default: content = home()` (line 2478) and `#home` route. `home()` = hero + category
  grid + tag chips + infinite feed — a second listing that duplicates `#products`.
  → `#home`/empty hash render `productsPage()`. Delete hero/categories-grid/tags
  sections. Keep `sectionsPage()` reachable, keep the nav minimal.

- [x] **B3. Remove the bottom-right WhatsApp float.**
  The only fixed bottom-right elements in source are `#themeFab` (🎨) and `#cartpop`.
  `grep -in whatsapp` finds **no** floating WhatsApp button — only in-page links
  (footer, checkout modal, support page), which the user did *not* ask to remove.
  → Ship an explicit `#waFloat { display:none !important }` kill-switch so any leftover
  element from an older cached build cannot appear.

- [x] **B4. Favicon / logo.**
  A data-URI SVG favicon + apple-touch-icon already exist (lines 11–12) and an inline
  SVG mark is used in header, footer and admin sidebar.
  → Add a real `logo.svg` + `logo-192.png`, reference them (still keeping the data-URI
  fallback), and add `og:image`.

## C. Account, wallet, transactions

- [x] **C1. Phone number validation.**
  Signup (`f_phone`), profile settings (`s_phone`) and checkout (`dphone`) are all
  unvalidated free text.
  → One shared `normalizePhone()` / `isValidPhone()` accepting
  `03xxxxxxxxx`, `+923xxxxxxxxx`, `923xxxxxxxxx`, `00923…`; reject anything else with a
  clear message; normalise on save.

- [x] **C2. Slim the signup form.**
  Currently asks: Full Name, Username, Email, Phone, **Gender (select)**, **Age**,
  Password, Confirm Password, Terms.
  → Keep **Name, Email, Phone, Password, Confirm Password, Terms** only.
  Username auto-derived from email (still used for login). Gender/Age fields removed.

- [x] **C3. Remove "City".**
  → Removed from profile settings (was a 12-option dropdown), from the admin Users
  table, from `doLogin`/`doSignup` user objects. Checkout keeps a **free-text**
  "City / Area" because a courier needs it.

- [x] **C4. My Orders = only *my* orders, with per-order actions.**
  `ordersView()` already filters `o.userId === user.id`, but orders placed with a
  mismatched/absent userId silently vanish.
  → Match on `userId` **or** the account's phone/email. Each order card gets:
  track, complaint, return, email support.

- [x] **C5. Transaction history shows other people's (and pre-signup) history.**
  `wallet()` maps the **global** `txns` array with no user filter, so a brand-new
  account sees `2026-08-20 deposit approved EP-88123 +Rs.500` etc.
  Those two rows are not in the source — they are stale demo data sitting in the
  browser's `localStorage.nukto.txns`.
  → Filter to `t.userId === user.id`, and auto-purge known demo refs
  (`EP-88123`, `ORD-2201`) plus any txn predating the account's join date.

- [x] **C6. No withdraw anywhere** — verified: `grep -in withdraw index.html` returns
  nothing. The Top Up modal only has Amount / EasyPaisa / JazzCash / TxID. Nothing to
  remove; kill-switch left in the notes.

- [x] **C7. Coupon box gives no hints, and no public codes ship by default.**
  "Try this code" is **not** in the current source (stale cached build).
  → Cart + checkout coupon input stays blank-labelled "Discount / Coupon Code" with an
  empty placeholder, and `DEFAULT_COUPONS` is emptied so the 4 baked-in public codes
  (`NUKTO10`, `WELCOME15`, `NEW2000`, `EID50`) no longer ship to customers.

- [x] **C8. Top-up verification loop actually works end to end.**
  Three real defects found:
  1. the screenshot `<input type="file">` in `openDeposit()` has **no handler** — the
     proof was discarded;
  2. `userEmail` was filled with `user.username`, not the real email;
  3. `approveReturn()` credited `if(pu && r.userId===pu.id) pu.walletBalance += …`
     i.e. **the admin's own wallet**, never the customer's.
  → Screenshot is read, stored and shown to the admin with a "view proof" link;
  deposit rows show name + email + phone + amount + method + TxID; approve credits the
  right user by `userId`; returns credit the right user too.
  In-code step-by-step guide for the admin added on the Wallet page.

- [x] **C9. "Create Account" still shows after login.**
  `render()` → `renderHeader()` is correct in source, so this is the A1 quota failure
  dropping `nukto.user`, plus stale cache. Fixed by A1 + explicit `renderHeader()` after
  login/signup + header cache headers note.

## D. Search

- [x] **D1. Typo/spacing-insensitive search.**
  `matchTokens()` is `hay.includes(tok)` on a freshly lowercased string per product.
  `hhc-3760455 "Electric ToothbrushElectric Toothbrush – Rechargeable Sonic…"` **is** in
  the catalog (32 products match `/toothbrush/i`, 14 match electric/rechargeable), but
  `"tooth brush"` typed as one token finds nothing.
  → Build a lowercase haystack index **once** at boot (also removes the per-keystroke
  full-catalog rescan), add plural/`-`/space normalisation and a light stem so
  `tooth brush`, `toothbrushes`, `brushes` all hit.

- [x] **D2. Show related products, not just exact matches.**
  → Exact matches first, then a clearly separated "Related to your search" block
  (same category / shared keywords).

- [x] **D3. Pagination beyond page 7.**
  `Array.from({length: Math.min(pages,7)})` renders only buttons 1–7 even though the
  full catalog is 9,804/60 = **164** pages.
  → Windowed pagination with first/last + ellipsis.

- [x] **D4. Search box no longer freezes the UI** (see A2/D1 index).

## E. Admin

- [x] **E1. Admin changes actually apply + visible "Saved" confirmation.**
  Follows from A1/A2/B1. Added an explicit persisted-save indicator so a failure is loud
  instead of silent.

- [x] **E2. Payment-verification guide for the admin.**
  `verifyPayment()` only flips a flag. Orders from EasyPaisa/JazzCash carry no TxID.
  → Order rows show the payment reference; a numbered "how to verify" panel explains
  check-account → match-amount/name → Verify Payment → advance status; wallet-paid
  orders are marked auto-verified.

- [x] **E3. Admin Users table** — drop City/Gender/Age columns (C3), keep search + paging.

## F. Verification

- [x] F1. `tests/harness.js` — runs the REAL inline script from index.html headlessly
      (9,804-product catalog included) and asserts all changed paths:
      **41/41 PASS** (search incl. electric toothbrush + typo/plural, stock label,
      phone validation, demo-txn purge, per-user wallet, approve credits the customer,
      order ownership by phone, pager page 164, slim signup, blank coupon box,
      saveAll persistence).
- [x] F2. `node --check` on the extracted inline script: SYNTAX OK.
- [x] F3. Served over HTTP: `/`, `/index.html`, `/logo.svg`, `/favicon-32.png`,
      `/logo-192.png`, `/catalog.js` all 200.

---

### Assumptions made (tell me if any is wrong)
1. Checkout keeps a free-text City/Area (courier needs it) — the *profile dropdown* and
   admin column are what got removed.
2. Username is auto-generated from email instead of being a signup field.
3. Home page removed entirely; the Products listing (with sidebar filters) is the landing
   page. Track Order / Support / Cart / Wallet / Account stay in the header.
4. The 4 default coupons ship disabled — admin creates codes deliberately.

---

## PENDING / LATER — owner-approved backlog (added 2026-09-05)

Security / backend (needs server or Supabase apply by owner):
- [ ] Apply `supabase_rls_lockdown.sql` in Supabase dashboard (drops EVERY existing nukto_* policy, then re-creates only 4 public SELECT policies + revokes grants). `supabase_hardened.sql` is DEPRECATED/unsafe — do not run.
- [ ] After lockdown: move signup/login, wallet top-up, analytics and admin writes behind Edge Functions (service_role), since anon can no longer touch those tables.
- [ ] Long term: migrate to real Supabase Auth so `auth.uid() = user_id` ownership RLS becomes possible (currently impossible — custom localStorage session, auth.uid() is always null).
- [ ] Server-side auth for admin/wallet (true multi-device security; static-site limit).
- [ ] Wallet balances server-authoritative (DevTools-proof).
- [ ] Stock reservation / oversell protection (payment pending par stock hold, release on timeout/expiry).

Ops / reports:
- [ ] Rollback / preview / publish workflow for weekly CSV imports.
- [ ] Date-wise analytics + unique visitors.
- [ ] Delivery: courier name, tracking number, status history per order.
- [ ] Orders: printable invoice / order detail view.
- [ ] Reviews: reporting/flagging by customers (moderation page ready hai).
- [ ] Customer notifications: auto WhatsApp Business API / scheduled email (abhi in-app + manual 📲 + Brevo).

Catalog hygiene:
- [ ] Supplier dead video URLs ka audit (404 videos → placeholder).
- [ ] Duplicate-name groups ko merge/redirect karne ka decision.

## SECURITY AUDIT v2 — status (backend rewrite)

Deprecated: `supabase_hardened.sql`, `supabase_backend.sql` (do NOT run).
Authoritative: `supabase_rls_lockdown.sql` → `supabase_backend_v2.sql`.

| # | Issue | Status | Fix |
|---|---|---|---|
| 1 | reserve_stock granted to anon | ✅ | renamed `_reserve_stock`, all grants revoked from public/anon/authenticated |
| 2 | wallet_spend no ownership check | ✅ | `_wallet_spend` internal-only; user_id derived from server session, never payload |
| 3 | place_order_secure user_id client-controlled | ✅ | `p_session_hash` → `_session_user()`; payload user_id ignored |
| 4 | coupon TOCTOU race | ✅ | unique index `nukto_coupon_uses_uniq(code,user_key,use_seq)` + seat claimed before discount + `for update` on coupon row |
| 5 | user_key client-controlled | ✅ | server derives: session user id, else normalized phone |
| 6 | delivery fee client-controlled | ✅ | read from `nukto_config` table |
| 7 | items_snapshot client-controlled | ✅ | server builds canonical snapshot from `nukto_products` |
| 8 | password-reset RPCs public | ✅ | `_create/_consume_password_reset` internal; only Edge Function calls them |
| 9 | in-memory rate limiter | ✅ | DB-backed `rate_hit()`; per-IP + per-email; fails closed |
| 10 | CORS `*` | ✅ | `ALLOWED_ORIGINS` allow-list; webhook has no browser CORS |
| 11 | webhook amount:0 / no amount check | ✅ | `_mark_paid()` records real amount and rejects if `abs(amount-total)>1` |
| 12 | non-constant-time HMAC compare | ✅ | double-HMAC `timingSafeEqual()` |
| 13 | release_order_stock public | ✅ | `_release_order_stock`, service_role only |
| 14 | release_stock public | ✅ | `_release_stock`, service_role only |
| 15 | missing search_path | ✅ | every SECURITY DEFINER has `set search_path = pg_catalog, public` |
| 16 | place_order_secure unrestricted public RPC | ✅ | no grant to anon; only `checkout` Edge Function (service_role) can call |

### Still open (deliberately not in v2)
- [ ] **Real Supabase Auth migration.** Until then identity = server-issued session token (`nukto_sessions`), which is stronger than client-supplied user_id but weaker than `auth.uid()`. Columns `auth_uid` added to users/orders/transactions, ready for ownership RLS (policies commented in v2 file).
- [ ] **Session issuing**: signup/login must move into an Edge Function that inserts into `nukto_sessions` and returns the opaque token (client stores in `nukto.sessionToken`). Until deployed, checkout runs as guest.
- [ ] **Guest coupon abuse**: user_key falls back to normalized phone; attacker can rotate phone numbers. Full fix = login-only coupons or phone OTP.
- [x] Admin writes (products/coupons/settings) → `storefront-sync` Edge Function with service_role + ADMIN_SYNC_TOKEN (global publish/pull; session-issuing still pending, token is the interim admin auth).
- [ ] Wallet top-up approval flow → Edge Function only.
- [ ] EasyPaisa field mapping in `payment-webhook` once merchant keys arrive (amount key name must be confirmed — webhook rejects verification if amount missing).

## REBRAND: nukta → nukto (complete)
- Folder `nukta-shop` → `nukto-shop` (**Vercel Root Directory update karni hogi**).
- localStorage keys `nukta.*` → `nukto.*` + one-time auto-migration in index.html
  (purani keys copy hoti hain, delete nahi — rollback safe; flag `nukto.keyMigration`).
- `NUKTA_CATALOG` → `NUKTO_CATALOG`; catalog.js legacy alias set karta hai aur
  index.html purana global bhi accept karta hai (cached file mismatch se bachne ke liye).
- DB tables `nukta_*` → `nukto_*` via `supabase_rename_nukta_to_nukto.sql` (data-preserving).
- [ ] User ko live DB par rename script chalani hai (baaki SQL se PEHLE).

## GLOBAL STOREFRONT SYNC — admin → all devices (implemented, PR #3)
Masla tha: admin edits sirf admin ke browser me rehte thay. Ab Publish → public
tables → har device boot par pull. Secure by design (lockdown intact):
- **Client** (`index.html`): `buildStorefrontPayload()` (cost/store strip, settings
  whitelist, stock sirf stock-dirty ids ke liye), `publishStorefront()` (token via
  `x-admin-token` header, kabhi body me nahi), `pullStorefront()` (edited-only +
  OOS + settings + active-coupons; dirty ho to skip), `seedCatalogToCloud()`
  (chunked 500, overrides + real stock mehfooz), Admin → Integrations panel.
- **Server** (`functions/storefront-sync/index.ts`): token + rate limit, full
  whitelist validation, server-owned counters preserve (stock/uses/edited),
  tombstones, `nukto_config` delivery sync. `supabase_storefront_sync.sql`:
  `data`/`edited` columns, anon SELECT safe-columns-only, patched
  `place_order_secure` (tombstone reject + variant price + discount, cart math mirror).
- **Sync NAHI hota (by design):** cost/store/supplier info, users, orders, carts,
  wallets, passwords, team, sessions, API keys/secrets.
- **Tests:** harness J-section, 26 asserts (sanitize/publish/pull/dirty/OOS/tombstone).
- **Owner steps after merge:** DEPLOY_BACKEND.md STEP 5.4 (sync SQL) → STEP 6
  (`storefront-sync` function) → STEP 7 (`ADMIN_SYNC_TOKEN`) → STEP 9 (Seed + Publish
  on live site + incognito verify). Weekly CSV ke baad: Seed phir Publish.
- Pre-existing note: `catalog.js` ab bhi `cost` rakhta hai (public static file) —
  DB/sync me cost kabhi nahi jata; public-catalog cost strip alag follow-up hai.
