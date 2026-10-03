# Manesh Kumar Commission Agent — Deploy Guide (browser only, koi CLI nahi)

> **Purani checklist bhool jayein.** `supabase_hardened.sql` aur
> `supabase_backend.sql` **DEPRECATED** hain — security audit me inme
> 16 holes mile thay. Neeche wali tarteeb hi sahi hai.

Repo base link (har file yahan se copy karein) — hamesha **`main`** branch se,
kyunke saare merged PR ab `main` par hain (purane `arena/*` branches stale hain):
`github.com/Manesh844/maneshkumarcommissionagent/blob/main/maneshkumarcommissionagent/`

### ⚠️ Rebrand ke baad sabse ahem baat — DATABASE KO HAATH NAHI LAGANA

Brand `nukto.shop` se **Manesh Kumar Commission Agent** ho gaya hai, lekin:

| Cheez | Naya naam? | Kyun |
|---|---|---|
| Website ka naam, logo, colour, emails, policies | ✅ Sab naya | Customer yahi dekhta hai |
| Supabase tables (`nukto_products`, `nukto_orders`, …) | ❌ **Same** | Live DB inhi naamon par chal rahi hai — rename karte hi har order/wallet/user orphan ho jata |
| Browser storage keys (`nukto.cart`, `nukto.user`, …) | ❌ **Same** | Purane customers ka cart, login aur order history isi key par hai |

**Koi rename SQL chalane ki zaroorat NAHI hai.** `supabase_rename_nukta_to_nukto.sql`
sirf un purani DBs ke liye hai jinme ab bhi `nukta_*` tables hain.

---

## STEP 1 — Vercel (pehle ye)

1. Repo ka **`main`** branch use karein.
   `github.com/Manesh844/maneshkumarcommissionagent/tree/main/maneshkumarcommissionagent`
2. Vercel → **Add New → Project** → repo `maneshkumarcommissionagent` import
3. **Settings → General → Root Directory = `maneshkumarcommissionagent`**
   ⚠️ Agar project pehle se bana hua hai (purana `nukto-shop` root) to ye
   zaroor update karein warna build fail hoga.
4. Framework Preset = **Other** · Build Command khali · Output Directory khali
5. Deploy → `xxx.vercel.app` khol kar check karein

## STEP 2 — DNS (domain: `maneshkumarcommissionagent.dpdns.org`)

Domain DigitalPlat (dpdns.org) se hai. Do raste hain:

**(a) Seedha Vercel par** — DigitalPlat DNS panel me:

| Type | Name | Target |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

**(b) Cloudflare ke zariye (recommended — CAPTCHA/DDoS protection milti hai)** —
pehle domain Cloudflare me add karein, DigitalPlat par Cloudflare ke nameservers
set karein, phir upar wale records Cloudflare me daalein.
Proxy pehle **OFF** (grey) rakhein taake Vercel SSL issue kar sake; "Valid
Configuration" aane ke baad proxy ON + SSL/TLS mode **Full (strict)**.

Vercel → Settings → Domains → `maneshkumarcommissionagent.dpdns.org`
+ `www.maneshkumarcommissionagent.dpdns.org` add karein.

## STEP 3 — Email receive (`support@maneshkumarcommissionagent.dpdns.org`)

Cloudflare → **Email → Email Routing** → Enable → Create address →
`support@maneshkumarcommissionagent.dpdns.org` → forward to apna Gmail.
Free, sirf receive. (Ye wahi email hai jo site ke Contact/Privacy/Refund
pages par chhapta hai, is liye iska chalna zaroori hai.)

## STEP 4 — Brevo DKIM (sending)

Brevo → Senders, Domains & IPs → Domains → Add
`maneshkumarcommissionagent.dpdns.org` → jo TXT records (DKIM/SPF/DMARC) mile
wo DNS me paste → Authenticate → Senders me
`no-reply@maneshkumarcommissionagent.dpdns.org` add.

## STEP 5 — Supabase SQL (tarteeb ahem hai)

SQL Editor → **New query** (snippet/logs/folder nahi) → har file alag Run.
**Table ke naam kahin nahi badalne** — ye files sirf policies/functions banati hain:

1. `supabase_rls_lockdown.sql` — har purani open policy drop, sirf 4
   public SELECT policies, grants revoke.
2. `supabase_backend_v2.sql` — secure functions + session/config/rate tables.
3. `supabase_storefront_sync.sql` — **sabse aakhir me**. Global sync ke liye
   `data`/`edited` columns, anon SELECT ko safe columns tak (cost/store kabhi
   readable nahi), aur `place_order_secure` me tombstone + variant-price +
   discount support. (Agar lockdown dobara chalao to ye file bhi dobara.)

> `supabase_rename_nukta_to_nukto.sql` **sirf** us surat me chalayein jab aapki
> DB me ab bhi `nukta_*` tables maujood hon (bohot purani install). Warna skip.

⚠️ Pehle Supabase → Database → **Backups** check kar lein.
Har file ke aakhir me VERIFY queries hain — unka output bhej dein.

## STEP 6 — 4 Edge Functions

Edge Functions → **Create a new function** → naam bilkul yahi →
poora `index.ts` paste → Deploy → **Verify JWT OFF**:

| Function | File |
|---|---|
| `checkout` | `functions/checkout/index.ts` ← orders ab isi se bante hain |
| `password-reset` | `functions/password-reset/index.ts` |
| `payment-webhook` | `functions/payment-webhook/index.ts` |
| `storefront-sync` | `functions/storefront-sync/index.ts` ← admin Publish/Seed isi se |

`functions/_shared/http.ts` deploy **nahi** karna — wo sirf reference hai,
uske helpers baaki files me pehle se inline hain.

## STEP 7 — 7 Secrets

Edge Functions → Secrets → Add secret:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://vneknnmhnbkltkhihbok.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | aapki service_role key |
| `BREVO_API_KEY` | `xkeysib-...` |
| `SITE_URL` | `https://maneshkumarcommissionagent.dpdns.org` |
| `WEBHOOK_SECRET` | aapka webhook secret |
| `ALLOWED_ORIGINS` | `https://maneshkumarcommissionagent.dpdns.org,https://www.maneshkumarcommissionagent.dpdns.org` ← warna CORS sab block karega |
| `ADMIN_SYNC_TOKEN` | neeche tarike se banao (Publish/Seed isi se hota hai) |

> 🔴 **Rebrand ke baad `ALLOWED_ORIGINS` aur `SITE_URL` zaroor update karein.**
> Agar purana `https://nukto.shop` laga raha to naye domain se har checkout,
> password-reset aur Publish CORS par block ho jayega.

**ADMIN_SYNC_TOKEN banana (bina CLI, 1 minute):**
1. Supabase → SQL Editor → New query → ye chalao:
   `select md5(random()::text||clock_timestamp()::text)||md5(random()::text);`
2. Jo 64-character code aaye usay copy karo.
3. Edge Functions → Secrets → `ADMIN_SYNC_TOKEN` naam se Add secret.
4. Wahi code site par Admin → Integrations → **Global Storefront Sync** →
   token box me paste → **Save Token**. (Ye token repo/code me KABHI
   mat likhna — sirf Supabase + admin ka browser.)

## STEP 8 — Test

Site → Login → "Forgot Password?" → email aaye = ✅
Email me bheja gaya link naye domain par jana chahiye.

## STEP 9 — Global Sync chalu karo (LIVE site par, admin panel se)

1. Live site kholo (`https://maneshkumarcommissionagent.dpdns.org/#/admin`) →
   login → **Integrations** → **🌍 Global Storefront Sync** (STEP 7 wala
   token pehle Save karo).
2. **🧱 Seed Full Catalog** dabao → ~1–2 min (progress toast). Ye poori
   catalog server par dalta hai taake secure checkout har product validate
   kar sake. Admin overrides + real stock mehfooz rehte hain.
3. **🌍 Publish to All Devices** dabao → "Published!" aaye.
4. Verify: **doosre mobile / incognito window** me site kholo — admin ki
   price/banner/coupon sab wahan bhi dikhein = ✅
5. **Weekly CSV ke baad:** nayi catalog deploy hote hi dobara **Seed**,
   phir **Publish** (taake overrides wapas apply hon).

> ⚠️ Publish/Seed hamesha **live domain** se karo
> (`maneshkumarcommissionagent.dpdns.org`) — localhost se Edge Function CORS
> block karti hai (by design).

---

## Aapki taraf se baaki

- **Supabase access token revoke karein** (chat me bheja tha = compromised)
- EasyPaisa: Store ID + Hash Key (approval ke baad) → webhook mapping
- Turnstile: Site Key + Secret Key → CAPTCHA integration
- Brevo par purana `nukto.shop` sender hata kar naya domain authenticate karein

## Abhi bhi missing (jaan-boojh kar)

- Signup/login ke liye session-issuing Edge Function nahi bani — tab tak
  checkout **guest mode** me chalega (wallet payment login mangega).
- ~~Admin cloud writes band~~ → **AB CHALU**: Publish/Seed via
  `storefront-sync` (products/coupons/settings/categories global).
  Baaki: signup/login session-issuing + wallet-approval Edge Functions.
