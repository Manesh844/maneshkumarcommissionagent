# realonenukto → Nukto.Shop (https://nukto.shop)

> **Active website folder: `nukto-shop/`** — this is the only folder Vercel deploys.
> Vercel → Project → Settings → General → **Root Directory = `nukto-shop`**
> (Framework Preset = Other, no build command). Every push to `main` auto-redeploys.

## What's where

| Path | Purpose |
|---|---|
| `nukto-shop/` | ✅ The live store (storefront + admin). `index.html` + `catalog.js` + `vercel.json` are what the site needs. |
| `nukto-shop/DEPLOY_BACKEND.md` | Step-by-step go-live guide (Vercel → Cloudflare → Supabase SQL → Edge Functions → secrets). |
| `nukto-shop/README.md` | Beginner-friendly store guide (Roman Urdu). |
| `nukto-shop/TODO.md` | Engineering checklist + security-audit status. |
| `TODO.md` (repo root) | Owner's production-logic checklist (16 sections). |
| `csvfiles/`, `uploads/` | Weekly supplier CSV drops (source data for the catalog builder). |
| `image-search/` | Product images used by the catalog. |

## Notes

- The old `nukta-shop` name is retired (rebrand to **nukto** is complete). Do not
  recreate a `nukta-shop` folder — all work happens in `nukto-shop/`.
- Supabase tables were renamed `nukta_*` → `nukto_*` (see
  `nukto-shop/supabase_rename_nukta_to_nukto.sql` — run once on the live DB first).
- No secrets live in this repo: only the public Supabase `anon` key ships in the
  frontend (safe by design). Service-role / Brevo keys go in Supabase Edge
  Function secrets, never in code.

## Tests (for developers/agents)

```bash
node nukto-shop/tests/harness.js   # headless suite, must be 104 passed / 0 failed
python3 -m py_compile nukto-shop/build_catalog.py
```
