# Nukto.Shop — Deploy Guide (browser only, koi CLI nahi)

> **Purani checklist bhool jayein.** `supabase_hardened.sql` aur
> `supabase_backend.sql` **DEPRECATED** hain — security audit me inme
> 16 holes mile thay. Neeche wali tarteeb hi sahi hai.

Repo base link (har file yahan se copy karein) — hamesha **`main`** branch se,
kyunke saare merged PR ab `main` par hain (purane `arena/*` branches stale hain):
`github.com/Manesh844/realonenukto/blob/main/nukto-shop/`

---

## STEP 1 — Vercel (pehle ye)

1. Repo ka **`main`** branch use karein — saare PR (#1–#6) merge ho chuke hain,
   is liye kisi purane PR/arena branch ka intezaar nahi karna.
   `github.com/Manesh844/realonenukto/tree/main/nukto-shop`
2. Vercel → **Add New → Project** → repo `realonenukto` import
3. **Settings → General → Root Directory = `nukto-shop`**
   ⚠️ Folder ka naam `nukta-shop` se `nukto-shop` ho gaya hai. Agar project
   pehle se bana hua hai to ye zaroor update karein warna build fail hoga.
4. Framework Preset = **Other** · Build Command khali · Output Directory khali
5. Deploy → `xxx.vercel.app` khol kar check karein

## STEP 2 — Cloudflare DNS (Vercel ke liye)

| Type | Name | Target | Proxy |
|---|---|---|---|
| A | `@` | `76.76.21.21` | **OFF** (grey) |
| CNAME | `www` | `cname.vercel-dns.com` | **OFF** (grey) |

Proxy pehle OFF rakhein taake Vercel SSL certificate issue kar sake.
Domain "Valid Configuration" dikhane ke baad proxy ON kar sakte hain, aur
tab Cloudflare → SSL/TLS → mode **Full (strict)**.

Vercel → Settings → Domains → `nukto.shop` + `www.nukto.shop` add karein.

## STEP 3 — Email receive (`care@nukto.shop`)

Cloudflare → **Email → Email Routing** → Enable → Create address →
`care@nukto.shop` → forward to apna Gmail. Free, sirf receive.

## STEP 4 — Brevo DKIM (sending)

Brevo → Senders, Domains & IPs → Domains → Add `nukto.shop` →
jo TXT records (DKIM/SPF/DMARC) mile wo Cloudflare DNS me paste →
Authenticate → Senders me `no-reply@nukto.shop` add.

## STEP 5 — Supabase SQL (tarteeb ahem hai)

SQL Editor → **New query** (snippet/logs/folder nahi) → har file alag Run:

1. `supabase_rename_nukta_to_nukto.sql` — **sabse pehle**. Tables
   `nukta_*` → `nukto_*`. `ALTER TABLE ... RENAME` data ko chhoota nahi.
2. `supabase_rls_lockdown.sql` — har purani open policy drop, sirf 4
   public SELECT policies, grants revoke.
3. `supabase_backend_v2.sql` — secure functions + session/config/rate tables.
4. `supabase_storefront_sync.sql` — **sabse aakhir me**. Global sync ke liye
   `data`/`edited` columns, anon SELECT ko safe columns tak (cost/store kabhi
   readable nahi), aur `place_order_secure` me tombstone + variant-price +
   discount support. (Agar lockdown dobara chalao to ye file bhi dobara.)

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
| `storefront-sync` | `functions/storefront-sync/index.ts` ← **naya**, admin Publish/Seed isi se |

`functions/_shared/http.ts` deploy **nahi** karna — wo sirf reference hai,
uske helpers teeno files me pehle se inline hain.

## STEP 7 — 7 Secrets

Edge Functions → Secrets → Add secret:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://vneknnmhnbkltkhihbok.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | aapki service_role key |
| `BREVO_API_KEY` | `xkeysib-...` |
| `SITE_URL` | `https://nukto.shop` |
| `WEBHOOK_SECRET` | `bf44ce...c548` |
| `ALLOWED_ORIGINS` | `https://nukto.shop,https://www.nukto.shop` ← warna CORS sab block karega |
| `ADMIN_SYNC_TOKEN` | neeche tarike se banao (**naya**, Publish/Seed isi se hota hai) |

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

## STEP 9 — Global Sync chalu karo (LIVE site par, admin panel se)

1. Live site kholo (`https://nukto.shop/#/admin`) → login → **Integrations** →
   **🌍 Global Storefront Sync** (STEP 7 wala token pehle Save karo).
2. **🧱 Seed Full Catalog** dabao → ~1–2 min (progress toast). Ye poori
   catalog server par dalta hai taake secure checkout har product validate
   kar sake. Admin overrides + real stock mehfooz rehte hain.
3. **🌍 Publish to All Devices** dabao → "Published!" aaye.
4. Verify: **doosre mobile / incognito window** me site kholo — admin ki
   price/banner/coupon sab wahan bhi dikhein = ✅
5. **Weekly CSV ke baad:** nayi catalog deploy hote hi dobara **Seed**,
   phir **Publish** (taake overrides wapas apply hon).

> ⚠️ Publish/Seed hamesha **live domain** se karo (`nukto.shop`) — localhost
> se Edge Function CORS block karti hai (by design).

---

## Aapki taraf se baaki

- **Supabase access token revoke karein** (chat me bheja tha = compromised)
- EasyPaisa: Store ID + Hash Key (approval ke baad) → webhook mapping
- Turnstile: Site Key + Secret Key → CAPTCHA integration

## Abhi bhi missing (jaan-boojh kar)

- Signup/login ke liye session-issuing Edge Function nahi bani — tab tak
  checkout **guest mode** me chalega (wallet payment login mangega).
- ~~Admin cloud writes band~~ → **AB CHALU**: Publish/Seed via
  `storefront-sync` (products/coupons/settings/categories global).
  Baaki: signup/login session-issuing + wallet-approval Edge Functions.
