# MANESH KUMAR COMMISSION AGENT

**Live site:** https://maneshkumarcommissionagent.dpdns.org
**Support:** support@maneshkumarcommissionagent.dpdns.org · 0342 0286170 (WhatsApp)

> **Active website folder: `maneshkumarcommissionagent/`** — this is the only folder Vercel deploys.
> Vercel → Project → Settings → General → **Root Directory = `maneshkumarcommissionagent`**
> (Framework Preset = Other, no build command). Every push to `main` auto-redeploys.

---

## ⚠️ Database rule — read this first

The Supabase schema is **live and untouched**. Tables are still named
`nukto_products`, `nukto_orders`, `nukto_users`, `nukto_settings`, `nukto_coupons`,
`nukto_reviews`, `nukto_transactions`, `nukto_returns`, `nukto_analytics`,
`nukto_snapshot`, `nukto_config` — and the browser's `localStorage` keys are still
`nukto.*`.

**Do not rename them.** They are storage identifiers, invisible to customers, and the
production database + every existing row is keyed on them. Renaming would require a
migration and would break the live store. The 2026 rebrand changed only what people
*see*: brand name, domain, colours, logo and copy.

---

## What's where

| Path | Purpose |
|---|---|
| `maneshkumarcommissionagent/` | ✅ The live store (storefront + admin). `index.html` + `app.js` + `catalog.js` + `vercel.json` are all the site needs. |
| `maneshkumarcommissionagent/index.html` | Markup + the CSS design system + the small pre-paint theme bootstrap (the **only** inline `<script>` left in the page). |
| `maneshkumarcommissionagent/app.js` | The storefront + admin application, externalised out of `index.html` on 2026-10-28, plus the runtime security guard (host allow-list, injection watcher, clipboard guard). |
| `maneshkumarcommissionagent/catalog.js` | Generated product catalog (~9,800 products) on `window.NUKTO_CATALOG`. Built, never hand-edited. |
| `maneshkumarcommissionagent/functions/` | Supabase Edge Functions (checkout, payment webhook, password reset, storefront sync). |
| `maneshkumarcommissionagent/*.sql` | Supabase schema, RLS lockdown, hardening. Comments rebranded; **table names deliberately unchanged**. |
| `maneshkumarcommissionagent/tests/harness.js` | Headless test suite that runs the real app code (`index.html` bootstrap + `app.js`). |
| `INCIDENT.md` (repo root) | 🔒 2026-10-28 fake-Cloudflare-Turnstile / ClickFix incident report: IOC sweep, findings table, hardening list, verification steps, credential-rotation checklist. Not inside the deploy folder, so it is never served publicly. |
| `maneshkumarcommissionagent/DEPLOY_BACKEND.md` | Step-by-step go-live guide (Vercel → DNS → Supabase SQL → Edge Functions → secrets). |
| `maneshkumarcommissionagent/README.md` | Beginner-friendly store guide (Roman Urdu). |
| `maneshkumarcommissionagent/TODO.md` | Engineering checklist + security-audit status. |
| `TODO.md` (repo root) | Owner's production-logic checklist (16 sections). |
| `csvfiles/`, `uploads/` | Weekly supplier CSV drops (source data for the catalog builder). |
| `image-search/` | Product images used by the catalog. |

## Brand

| Token | Value |
|---|---|
| Name | Manesh Kumar Commission Agent |
| Short name | MK Commission Agent |
| Tagline | Socho · Dekho · Kharido — Bharosay Ke Saath |
| Primary | Royal Blue `#1E3A8A` (deep `#152C6B`, navy `#0C1733`) |
| Accent | Gold `#D4A017` / `#E3B23C` |
| Logo | `maneshkumarcommissionagent/logo.svg` — gold shopping bag on a royal-blue tile |
| Animated mark | `maneshkumarcommissionagent/img/mkca-shopping-bag-loop.svg` (boot splash) |
| Wallet | MK Wallet · MK Coins (1 MK Coin = 1 PKR) |

All design tokens live in the `:root` block near the top of
`maneshkumarcommissionagent/index.html`. Change a colour there and it propagates
across the storefront, the admin panel and the emails.

## Notes

- No secrets live in this repo: only the public Supabase `anon` key ships in the
  frontend (safe by design). Service-role / Brevo keys go in Supabase Edge Function
  secrets, never in code.
- `supabase_rename_nukta_to_nukto.sql` is a historical one-off from an older rebrand.
  It has already been applied to the live database — **do not run it again**.

## 🔒 Security

Audited 2026-10-28 after a **fake Cloudflare Turnstile / ClickFix** popup was
reported on the shop. Full report, IOC list and owner checklist: **[`INCIDENT.md`](INCIDENT.md)**.

- **No third-party code, ever.** The page loads exactly two scripts, both
  same-origin: `catalog.js` (generated) and `app.js`. There is no `package.json`,
  no lockfile and no CDN script — so there is no supply chain to poison.
- **CSP + hardening headers** are set in `maneshkumarcommissionagent/vercel.json`
  and apply to every response: `default-src 'self'`, `object-src 'none'`,
  `frame-src 'none'`, `frame-ancestors 'self'`, `upgrade-insecure-requests`,
  `connect-src` limited to this project's Supabase + `api.brevo.com`, `img-src` /
  `media-src` limited to the three catalogue CDNs, HSTS 2 years + preload,
  `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, COOP and a
  restrictive `Permissions-Policy`. `'unsafe-inline'` is still required by
  `script-src`; the plan to remove it is documented in the comment above the
  theme bootstrap in `index.html`.
- **Runtime guard** (top of `app.js`, armed in `boot()`): the app refuses to run
  on a domain that is not `nukto.shop` / `www.nukto.shop` / `*.vercel.app` /
  `*.e2b.app` / `maneshkumarcommissionagent.dpdns.org` / localhost; a
  `MutationObserver` removes and reports any injected `<script>`, `<iframe>`,
  `<object>`, `<embed>` or `<base>` from outside the allow-list; and
  `safeCopyText()` is the only clipboard writer, refusing anything shaped like a
  Windows command (`cmd /d /q /c`, `powershell`, `wscript`, `%LOCALAPPDATA%`,
  backslash paths, `.vbs`). `lockClipboard()` wraps
  `navigator.clipboard.writeText` so even code this app did not write cannot put
  such a payload on the clipboard.
- Every refusal is logged to `localStorage["nukto.security"]`, printed with
  `console.error`, and listed on the admin dashboard under
  **🛡️ Security events**. If that panel is ever non-empty, read `INCIDENT.md`.
- **Owner rule:** no real CAPTCHA ever asks you to press Win + R and paste. If a
  page asks for that, close the tab and treat the machine as compromised.

## Tests (for developers/agents)

```bash
cd maneshkumarcommissionagent
node tests/harness.js            # headless suite — must be 417 passed / 0 failed
python3 -m py_compile build_catalog.py

# syntax check: the externalised app + whatever is still inline in index.html
node -e "const fs=require('fs');new Function(fs.readFileSync('app.js','utf8'));\
const h=fs.readFileSync('index.html','utf8');\
const b=[...h.matchAll(/<script(?![^>]*src)(?![^>]*ld\+json)[^>]*>(.*?)<\/script>/gs)].map(m=>m[1]);\
new Function(b.join('\n'));console.log('JS OK')"
```

## Local preview

```bash
cd maneshkumarcommissionagent
python3 -m http.server 8080      # then open http://localhost:8080
```
