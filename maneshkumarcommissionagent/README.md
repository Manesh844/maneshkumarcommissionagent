# Nukto.Shop — Guide for You (Beginner-Friendly)

**Poora dropshipping store** tayyar hai — storefront + full admin. Roman Urdu mein.

> **Shortcut:** Admin = `/#admin` (login owner ke paas — password hashed hai, source mein bhi nahi likha)

---

## 🧭 Sabse pehle — yeh kaise chal raha hai (3 cheezein)

| Kya | Kahan hai | Kaam |
|---|---|---|
| **1. Storefront (site)** | `index.html` + `catalog.js` | Poori website + admin |
| **2. Supabase (cloud DB)** | `https://vneknnmhnbkltkhihbok.supabase.co` | orders/users/reviews/coupons/analytics/backups cloud mein save |
| **3. Vercel (hosting)** | GitHub → Vercel | Site ko internet par live karta hai |

**Yeh 3 files kaafi hain (repo mein):** `index.html`, `catalog.js`, `vercel.json`.

---

## ▶️ Chalana (local test)

```
cd /home/user/nukto-shop
python3 -m http.server 4000
```
Browser: `http://localhost:4000/` (ya upar live preview link).

---

## ▶️ Vercel par LIVE karna (GitHub se)

### STEP 1 — GitHub repo banao
1. **github.com** → login → **New repository** → naam do (e.g. `nukto-shop`) → **Create** karo. **Kuch bhi add mat karo** (README/LICENSE nahi).
2. Ab aapko ek page dikhega jisme **"…or push an existing repository from the command line"** likha hai + ek `git remote add origin ...` command.

### STEP 2 — Files repo mein daalo (command line)
Apne computer par folder kholo jahan ye files hain, aur yeh run karo (repo URL ki jagah apna daalo):

```bash
cd /home/user/nukto-shop
git init
git add .
git commit -m "Nukto.Shop store"
git branch -M main
git remote add origin https://github.com/APKA-USERNAME/nukto-shop.git
git push -u origin main
```

> `origin` ki URL GitHub par aapko mil jayegi (Step 1 ke waqt). Bas usko paste karo.

### STEP 3 — Vercel se connect karo
1. **vercel.com** → login (GitHub se) → **Add New Project**.
2. Apna **GitHub repo** select karo (`nukto-shop`).
3. **Framework Preset:** kuch select **mat karo** — **"Other"** rehne do (yeh static hai).
4. **Root Directory:** agar aapne files repo root mein rakhi hain to **`./`** rakho. (Agar `nukto-shop/` subfolder mein hain to **Root Directory = `nukto-shop`** set karo.)
5. **Deploy** dabao → kuch seconds → **live URL** milta hai (e.g. `https://nukto-shop-xxxxx.vercel.app`).

> Har baar GitHub par `git push` ke baad Vercel **apne aap re-deploy** kar deta hai (auto). Koi extra step nahi.

### Vercel ke liye kya files chahiye?
- **Sirf 3:** `index.html`, `catalog.js`, `vercel.json`. (Baki `build_catalog.py`, `README.md`, `supabase_setup.sql` sirf aapke kaam ke hain, site ki zaroorat nahi.)
- **Koi build/install command nahi** — pure static site. Vercel koi npm/nextjs nahi chalata.
- `vercel.json` maine bana di hai (security headers + clean URLs). Aapko kuch nahi karna.

---

## 🗄️ Supabase — kya database mein hai / kya nahi (IMPORTANT — honest)

Aapne poocha: **"product ki pictures sari details database mein aa gayi?"**

**Honest jawab: ABHI NAHI.** Is waqt:

| Data | Kahan hai | Database mein? |
|---|---|---|
| Saari products (9,804) + naam/price/img/desc | `catalog.js` (static file) | ❌ Nahin |
| Product **images** (URLs) | `catalog.js` ke `img` field mein (HHC CDN par hosted) | ❌ Nahin |
| **Edits** (price/stock/name) jo aap admin mein karte ho | Supabase `nukto_products` (sync) | ✅ Haan |
| **Orders, users, reviews, coupons, analytics, settings, backups** | Supabase | ✅ Haan |

**Kyun?** — Kyunki yeh site **static** hai. Products `catalog.js` se load hoti hain (fast), aur **dynamic cheezein** (jo badal rahi hain) Supabase mein save hoti hain. Yehi best practice hai.

> **Agar aap chahte ho ke saari 9,804 products bhi Supabase `nukto_products` table mein hoon** (taake admin edits sabko dikhein), to main **ek baar mein poori catalog upload** kar sakta hoon. Aap batao — `next week` mein ye kar doon. **Lekin site ke liye zaroori nahi** (site `catalog.js` se hi chalti hai).

> ⚠️ **Nikali hui SQL code ka kya hua?** — SQL Editor mein jo code diya tha wo **sirf ek baar tables banane** ke liye tha. **Tables ab permanently database mein hain** — SQL code hataane se tables delete nahi hote. (Jaise salaad — recipe phenk do to salaad nahi ud jata. 😄) Maine live test kiya, tables exist karti hain.

---

## 🔑 Keys (kya use hua / kya nahi)

- ✅ **Supabase Project URL + anon key** — daal di. Yehi kaafi.
- ❌ **service_role / secret keys** — **kabhi nahi** (poori database kholti hain).
- ❌ **Publishable key** — anon ka naya naam, same. Need nahi.
- ⏳ **Brevo API key** — abhi nahi. Next week (email ke liye).

---

## 📅 Weekly CSV workflow (jab aap har week naya CSV denge)

Aapne kaha — **har week naya CSV** milega jisme quantity/products change hoti hai. Wo **maine handle karna hai.** Plan:

1. Aap naya **CSV** bhejo (same format).
2. Main `build_catalog.py` se **naya `catalog.js`** banaunga.
3. Main **compare** karunga:
   - Product **CSV mein nahi** → **"Not Available"** (stock 0). *(Delete nahi — taake product page + history + reviews bach rahein.)*
   - **Naya** product → **"New"** tag.
   - **Stock kam/zyada** → update.

> Aap batao: **"Not Available"** (recommended) ya **hard delete**? Iska jawab mujhe de do.

---

## ✅ Next week ki list (yaad hai mujhe)
- EasyPaisa **merchant gateway**
- Admin: **Team add**
- Admin: **live safety features**
- Customer **Profile** page (name/password/email change)
- **Wallet** page (top-up, balance, deposit methods)
- **Delivery tracking**
- **Brevo (email)**
- **Google reCAPTCHA** (bots rokne)
- **Weekly CSV update**
- **(Agar aap chaho) Saari products Supabase mein upload**

---

## 📂 Files (repo mein abhi)

| File | Kya | Site ke liye? |
|---|---|---|
| `index.html` | Poora store + admin | ✅ Zaroori |
| `catalog.js` | 9,804 products | ✅ Zaroori |
| `vercel.json` | Vercel config | ✅ Zaroori |
| `build_catalog.py` | CSV → catalog generator (weekly) | ❌ Dev tool |
| `supabase_setup.sql` | DB setup (reference) | ❌ Reference |
| `README.md` | Yeh guide | ❌ Docs |

---

## 🔐 Admin
`/#admin` → login (username `admin1`, password owner ke paas)
Dashboard · Users · Products · Categories · Dropshipping · Pricing · Orders · Delivery · Wallet · Returns · **Analytics** · **Coupons** · **Integrations** (Supabase/Brevo/Backups) · Settings

> **Security note:** Brevo API key aur Supabase **service_role** kabhi kisi public page/code mein nahi. Sirf **anon** key aur Brevo **API key** aap mujhe bhej sakte ho.

---

## 🔐 Env Variables (Vercel) — kahan aur konsi

**Sabse pehle — yeh samjho:** yeh site **pure static** hai (no server). Is liye **jo bhi key frontend code par hai wo browser mein sabko dikhegi.** Is liye:

- **Supabase `anon` key** → **code mein hona SAFE hai** (yeh public ke liye hi bana hai, RLS ke saath). **Isse env variable mein daalna zaroori nahi.**
- **`service_role` / Secret keys** → **kabhi code mein NAHI** (ya to env mein Vercel backend, ya Supabase Edge Function). Isliye **kabhi bhi env mein aapke liye zaroori nahi** — sirf jis din hum BEHIND backend banayeinge.

### Kya phir env variable chahiye? (honest answer)
**Abhi NO.** Kyunki:
1. Static site hai — Vercel ke env vars sirf **build ke waqt** frontend mein inject hote hain, aur hamara **build step hai hi nahi**.
2. Anon key code mein hona safe hai.
3. Brevo API key bhi abhi nahi (next week, tab hum backend/edge function banayenge jahan env mein daalte hain).

### Jis DIN hum backend add karein (next week), tab yeh hoga:
- **Vercel mein** (Project → Settings → Environment Variables):
  - `SUPABASE_URL` = `https://vneknnmhnbkltkhihbok.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = (secret, end mein)
  - `BREVO_API_KEY` = `xkeysib-...`
- Ye env vars **commit nahi hote** (`.env.local` ya `.env` ko git ignore karte hain). Vercel secret rakhta hai.
- Frontend sirf **anon** padhega; secret sirf backend/edge function mein.

### Github repo PRIVATE hai — kya safe hai?
- **GitHub par repo private** = koi aur source code nahi dekh sakta. ✅
- **PRIVATE ka matlab:** repo ki files sirf aap aur jin ko access do. Isliye **repo mein source ka hona secure** hai.
- **LEKIN zaroori:** ek baar **Vercel par live hua**, to site ka code **har visitor ko browser mein dikhta hai** (page source / DevTools). Isliye **jo bhi secret site ke code mein hoga wo live site par leak hoga** — chaahe repo private ho.

**Neeche ka rule yaad rakho:**
> ✅ **Code mein sirf woh lo jo public hona hi hai** (anon key).  
> ❌ **Koi bhi secret** (service_role, Brevo key, admin ki plaintext password) **code/repo/site mein kabhi nahi** — wo backend/edge function + env vars mein.

### Admin password leak hoga kya?
- **Pehle** admin password source mein literal tha → **leak hota** (koi bhi DevTools mein dekh leta). Yeh maine ab fix kar diya — ab sirf SHA-256 hash hai.
- **Ab** password **SHA-256 hash** ke roop mein hai (plaintext nahi). Source mein sirf hash hai. Hash ko reverse karke password nikaalna **asin nahi**. ✅
- **Lekin honest baat:** pure frontend hash bhi kisi ko pata ho to wo brute-force kar sakta hai. Agar password **bahut strong** (lamba + random) ho to yeh mushkil. Aisa hi password maine set kiya hai.
- **Best (next week):** admin login ko **Supabase Auth** (real, server-side password) se jorna — tab password hash **server ke paas** rahega, browser mein kuch visible nahi.

> 💡 **Note:** Aapne kaha repo private hai — toh repo mein `index.html` par kabhi kisi ne dhyan nahi diya. **Par live site par zaroor.** Isliye ab password hash mein hai aur README mein bhi nahi likha. Strong password + hash = abhi ke liye safe.

**Kya aap chahte ho main aapko abhi ek naya strong password doon (jo aap sirf apne paas rakho) — ya aap khud koi password set karna chahte ho?** Batao, main usi ka hash daal doonga.

## 🏷️ Tags (clickable) — High Selling / Hot / Trending / Crazy / Winter / Special
- Website par **Home → "Shop by Tags"** aur **Products page** par tag chips hain.
- Click karne par sirf us tag ke products dikhte hain: `#tag:winter`, `#tag:special`, etc.
- Admin → **Products** par bhi tag filter (dropdown) + har product ke saath tag badges.
- Tags compute hote hain: `g/c/t/m` flags + keyword rules (Winter/Special) + runtime High-Selling (top ~12% best sellers).

## 📋 Ecommerce Audit / Roadmap
- **`ECOMM_REVIEW.md`** — professional gap-analysis: missing features, logics, errors, prioritized roadmap (P0–P5).

## 🎨 Theme switcher (the "dongle")
- Floating **🎨 button** (right-bottom) + header **🎨** — koi bhi visitor apni pasand ki look choose kar sakta hai.
- 7 looks: ⚪ White · 🌙 Dark · 🟢 Confident (teal+coral) · 🔵 Trust (blue+orange) · 💗 Premium (magenta+coral) · 🌿 Fresh (green+orange) · 🏜️ Warm (default).
- Choice **per device** save hota hai (localStorage). Dark mode me hero/text bhi adjust hota hai.

## 🖼️ Gallery + variants (product page)
- Product detail par **image thumbnail strip** (click-to-swap) — 8,474 products mein ≥2 images.
- **Size/Color options** (1,659 products) — option select karne par **price update**; cart/checkout/order mein bhi dikhta hai.

## 🔍 Search upgrade
- **Synonyms + related keywords** ("tooth brush" → toothbrush / toothpaste / oral / care / brush).
- Search dropdown me "**See all N results**" + **Related searches** chips.
- No-results par **best-seller recommendations** dikhte hain.
- Products page par **🏷️ On-sale filter** bhi.

## ✨ Trust & conversion polish
- **Breadcrumbs** (product page): `Home › Category › Product`.
- **Stock urgency**: jab stock ≤3 to "⚡ Only X left" badge (stock ab seeded/realistic hai, stable per SKU).
- **Social proof**: product page par "🔥 X logon ne yeh khareeda · 🛒 Y abhi cart mein".
- **Admin → Products bulk actions**: checkbox se select karein → bulk **10% off** / **out-of-stock** / **delete**.

## 🏷️ Tags (clickable) — High Selling / Hot / Trending / Crazy / Winter / Special
- Website par **Home → "Shop by Tags"** aur **Products page** par tag chips hain.
- Click karne par sirf us tag ke products dikhte hain: `#tag:winter`, `#tag:special`, etc.
- Admin → **Products** par bhi tag filter (dropdown) + har product ke saath tag badges.
- Tags compute hote hain: `g/c/t/m` flags + keyword rules (Winter/Special) + runtime High-Selling (top ~12% best sellers).

## 📋 Ecommerce Audit / Roadmap
- **`ECOMM_REVIEW.md`** — professional gap-analysis: missing features, logics, errors, prioritized roadmap (P0–P5), **with today's completed items marked ✅**.

## 🔁 Weekly CSV workflow (updated)
- Aap jo naya catalog CSV send karo, `build_catalog.py` se `catalog.js` regenerate hoga.
- Build ab: **category parser fix** (comma + `>`), **no-image products → branded placeholder**, gallery array (`gal`), variants (`vars`), aur **winter/special** tags (`tags`).
- Missing products → **"Not Available"** (recommended) ya **hard-delete** — aap ye confirm karo.

## ✅ Latest storefront updates

- **Applicable options only:** colour, size, pack/quantity, capacity and other supplier options are shown on products that actually have them. Repeated supplier rows are consolidated into one product with selectable price/options; old SKU links still resolve to the canonical item.
- **Checkout confirmation:** selected colour/size/options are shown again at checkout and must be confirmed before placing the order. Products with no options do not show an empty selector.
- **Measurements:** values such as `100 ml`, `30 g`, `Pack of 3`, and piece counts are surfaced in Product Details when present in the catalog.
- **Mobile layout:** the header/search/settings/wallet controls and product grid use the full viewport with no forced zoom-out or right-side blank space. Product order is shuffled on every fresh page load.
- **Checkout charges:** six expandable rows — 🎬 Netflix Fund, 👕 Clothes Charge, 🍔 Food Charge, ⚡ Bijli Bill, 🧾 Dukaan Chalane Ka Kharcha, and 📣 Dukaan Ki Publicity — with Roman Urdu notes. Each unique random amount is 500–1999 paise (below Rs. 20.00), displayed with two decimals and zero-padding. There is no combined-total cap in the UI. Version-2 charges persist per cart signature across refreshes; order snapshots preserve them. Totals and wallet balances retain paise; the server uses a Rs. 120 safety ceiling.
- **Editable product discounts:** Admin → **Products** or Admin → **Pricing** has a per-product Discount (%) field. Enter any percentage from 0–90; enter 0 to remove it. The bulk “10% off” action now writes an editable 10% promotion instead of permanently changing the base price.
- **Payment presentation:** EasyPaisa and JazzCash use branded, accessible wallet marks at checkout.

For a deployed Supabase checkout, apply the latest `supabase_backend_v2.sql` migration/function after deploying the updated `functions/checkout` function so the checkout charge total and selected option label are included in the server order snapshot.
