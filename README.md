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
| `maneshkumarcommissionagent/` | ✅ The live store (storefront + admin). `index.html` + `catalog.js` + `vercel.json` are all the site needs. |
| `maneshkumarcommissionagent/index.html` | The whole app: markup, CSS design system, and the storefront + admin JavaScript. |
| `maneshkumarcommissionagent/catalog.js` | Generated product catalog (~9,800 products) on `window.NUKTO_CATALOG`. Built, never hand-edited. |
| `maneshkumarcommissionagent/functions/` | Supabase Edge Functions (checkout, payment webhook, password reset, storefront sync). |
| `maneshkumarcommissionagent/*.sql` | Supabase schema, RLS lockdown, hardening. Comments rebranded; **table names deliberately unchanged**. |
| `maneshkumarcommissionagent/tests/harness.js` | Headless test suite that runs the real inline app code. |
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

## Tests (for developers/agents)

```bash
cd maneshkumarcommissionagent
node tests/harness.js            # headless suite — must be 256 passed / 0 failed
python3 -m py_compile build_catalog.py

# inline-JS syntax check
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');\
const b=[...h.matchAll(/<script(?![^>]*src)(?![^>]*ld\+json)[^>]*>(.*?)<\/script>/gs)].map(m=>m[1]);\
new Function(b.join('\n'));console.log('JS OK')"
```

## Local preview

```bash
cd maneshkumarcommissionagent
python3 -m http.server 8080      # then open http://localhost:8080
```
