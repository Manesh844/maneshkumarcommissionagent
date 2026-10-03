// Manesh Kumar Commission Agent — STOREFRONT-SYNC Edge Function (admin publish → all devices)
// Deploy:  dashboard → Edge Functions → Create "storefront-sync" → paste → Deploy → Verify JWT OFF
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS, ADMIN_SYNC_TOKEN
//
// Kya karta hai:
//   action "publish": admin ke sanitized snapshot (products/coupons/settings/
//     categories) ko public tables me likhta hai. Har device boot par wahi
//     tables pull karta hai → admin edits globally shared.
//   action "seed_products": poori catalog (chunked, 500/batch) ko
//     nukto_products me bharta hai taake secure checkout har product
//     validate kar sake. Admin overrides + real stock kabhi overwrite nahi.
//
// SECURITY (threat model):
//   * Ye function PUBLIC tables likhta hai, isliye iska caller sirf ADMIN
//     ho sakta hai: ADMIN_SYNC_TOKEN (timing-safe compare) + rate limit.
//     Token sirf admin ke browser + Supabase secrets me — repo me KABHI NAHI.
//   * WHITELIST validation: cost / store / supplier info bhejo ya na bhejo,
//     yahan DROP hoti hai. Customer data (users/orders/carts/wallets/
//     passwords), team, sessions, API keys — accept hi nahi hote.
//   * Server-owned counters kabhi client se overwrite nahi hote:
//     stock (orders decrement karte hain) sirf stockIds/new rows ke liye,
//     coupon `uses` kabhi nahi, edited rows par seed price kabhi nahi.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- inlined helpers (dashboard deploy me _shared import kaam nahi karta) ----------
const ALLOWED = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ||
    "https://maneshkumarcommissionagent.dpdns.org,https://www.maneshkumarcommissionagent.dpdns.org")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-signature, x-session, x-admin-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && ALLOWED.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const b = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare (double-HMAC trick — length leak nahi).
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const nonce = crypto.randomUUID();
  const [ha, hb] = await Promise.all([hmacSha256(nonce, a), hmacSha256(nonce, b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// DB-backed rate limiter (multi-instance safe). Fail CLOSED.
async function rateOk(
  db: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  bucket: string, key: string, limit: number, windowSql: string,
): Promise<boolean> {
  try {
    const { data } = await db.rpc("rate_hit", {
      p_bucket: bucket, p_key: key, p_limit: limit, p_window: windowSql,
    });
    return data !== false;
  } catch {
    return false;
  }
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
// ---------- end helpers ----------

// ---------- strict whitelist validators (cost/store yahan pahunch hi nahi sakte) ----------
const ID_RE = /^[A-Za-z0-9_.\-]{1,120}$/;
const CODE_RE = /^[A-Z0-9][A-Z0-9_\-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9\-_]{1,80}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
function int(v: unknown, min: number, max: number): number | null {
  const n = num(v, min, max);
  return n === null ? null : Math.round(n);
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Product patch sanitize: SAFE columns + data.* sirf. cost/store/cost-ratios DROP.
function cleanProduct(p: Record<string, unknown>): Record<string, unknown> | null {
  const id = typeof p?.id === "string" ? p.id.trim() : "";
  if (!ID_RE.test(id)) return null;
  const o: Record<string, unknown> = { id };
  const name = str(p.name, 200); if (name) o.name = name;
  const cat = str(p.cat, 80); if (cat) o.cat = cat;
  const catLabel = str(p.cat_label ?? p.catLabel, 120); if (catLabel) o.cat_label = catLabel;
  const emoji = str(p.emoji, 16); if (emoji) o.emoji = emoji;
  const price = num(p.price, 0, 10000000); if (price !== null) o.price = Math.round(price);
  const img = str(p.img, 2000); if (img) o.img = img;
  const desc = str(p.description ?? p.desc, 5000); if (desc) o.description = desc;
  const stock = int(p.stock, 0, 1000000); if (stock !== null) o.stock = stock;
  // data patch (gallery / variants / discount) — alag se validate
  const data: Record<string, unknown> = {};
  if (Array.isArray(p.gal)) {
    const gal = p.gal.filter((u) => typeof u === "string" && u.trim()).slice(0, 12)
      .map((u) => String(u).trim().slice(0, 2000));
    data.gal = gal; // explicit [] clears (key present = admin intent)
  }
  if (Array.isArray(p.vars)) {
    const vars = p.vars.slice(0, 50).map((v) => {
      const r = v as Record<string, unknown>;
      const la = str(r?.la ?? r?.label, 160);
      const pr = num(r?.pr ?? r?.price, 0, 10000000);
      return la && pr !== null ? { la, pr: Math.round(pr) } : null;
    }).filter(Boolean);
    data.vars = vars; // explicit [] clears (key present = admin intent)
  }
  const disc = num(p.discount, 0, 90);
  if (disc !== null) data.discount = Math.round(disc);
  if (Object.keys(data).length) o.data = data;
  return o;
}

function cleanCoupon(c: Record<string, unknown>): Record<string, unknown> | null {
  const code = typeof c?.code === "string" ? c.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) return null;
  const type = c.type === "flat" ? "flat" : c.type === "ship" ? "ship" : c.type === "pct" || c.type === "percent" ? "pct" : null;
  if (!type) return null;
  // NOTE: `uses` jaan-boojh kar accept NAHI — server counter hai (orders par +1).
  const o: Record<string, unknown> = {
    id: code, code, type,
    value: type === "pct" ? (num(c.value, 0, 90) ?? 0) : (num(c.value, 0, 1000000) ?? 0),
    min_order: num(c.min_order ?? c.minOrder, 0, 10000000) ?? 0,
    active: c.active !== false,
    max_uses: int(c.max_uses ?? c.maxUses, 0, 1000000) ?? 0,
    note: str(c.note, 500) ?? "",
  };
  const exp = str(c.expiry, 10); o.expiry = exp && DATE_RE.test(exp) ? exp : null;
  const st = str(c.start ?? c.start_date, 10); o.start_date = st && DATE_RE.test(st) ? st : null;
  return o;
}

const SETTING_KEYS: Record<string, "s" | "n"> = {
  storeName: "s", tagline: "s", banner: "s", deliveryNote: "s",
  supportEmail: "s", phone: "s", whatsapp: "s", easypaisa: "s", jazzcash: "s",
  deliveryFee: "n", deliveryFreeAbove: "n",
};
// ---------- end validators ----------

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  if (!cors["Access-Control-Allow-Origin"] && req.headers.get("origin")) {
    return json({ error: "origin not allowed" }, 403, cors);
  }

  const secret = Deno.env.get("ADMIN_SYNC_TOKEN") || "";
  if (!secret) return json({ error: "sync not configured" }, 500, cors);

  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > 6_000_000) {
    return json({ error: raw ? "payload too large" : "empty body" }, raw ? 413 : 400, cors);
  }
  const body = await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid JSON" }, 400, cors);

  const token = req.headers.get("x-admin-token") || String((body as Record<string, unknown>).token || "");
  if (!token || !await timingSafeEqual(token, secret)) {
    return json({ error: "unauthorized" }, 401, cors);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ip = clientIp(req);
  const action = String((body as Record<string, unknown>).action || "");

  try {
    // ================= PUBLISH (admin snapshot → public tables) =================
    if (action === "publish") {
      if (!await rateOk(db, "sync-publish", ip, 40, "1 hour")) {
        return json({ error: "Too many publishes. Try again later." }, 429, cors);
      }
      const b = body as Record<string, unknown>;
      const counts: Record<string, number> = { products: 0, tombstones: 0, coupons: 0, graves: 0, settings: 0 };

      // ---- 1) products (+ customs; tombstones alag) ----
      const rawProducts = Array.isArray(b.products) ? b.products : [];
      if (rawProducts.length > 12000) return json({ error: "too many products" }, 400, cors);
      const stockIds = new Set(
        (Array.isArray(b.stockIds) ? b.stockIds : []).filter((x) => typeof x === "string"),
      );
      const cleaned = (rawProducts as Record<string, unknown>[])
        .map(cleanProduct).filter((x): x is Record<string, unknown> => !!x);
      for (const batch of chunk(cleaned, 200)) {
        const ids = batch.map((p) => p.id as string);
        const { data: existing } = await db.from("nukto_products")
          .select("id,stock,data").in("id", ids);
        const exMap = new Map(
          ((existing || []) as Record<string, unknown>[]).map((r) => [r.id as string, r]),
        );
        const rows = batch.map((p) => {
          const ex = exMap.get(p.id as string);
          const exData = (ex?.data && typeof ex.data === "object" ? ex.data : {}) as Record<string, unknown>;
          const patch = (p.data && typeof p.data === "object" ? p.data : {}) as Record<string, unknown>;
          // stock: nayi row → di hui value; purani row → sirf stockIds wali (real inventory mehfooz)
          const row: Record<string, unknown> = {
            id: p.id, edited: true, updated_at: new Date().toISOString(),
            data: { ...exData, ...patch, deleted: false },
          };
          for (const k of ["name", "cat", "cat_label", "emoji", "price", "img", "description"]) {
            if (p[k] !== undefined) row[k] = p[k];
          }
          if (p.stock !== undefined && (!ex || stockIds.has(p.id as string))) row.stock = p.stock;
          else if (ex) row.stock = (ex as Record<string, unknown>).stock;
          else if (p.stock !== undefined) row.stock = p.stock;
          return row;
        });
        const { error } = await db.from("nukto_products").upsert(rows, { onConflict: "id" });
        if (error) return json({ error: "products upsert failed" }, 500, cors);
        counts.products += rows.length;
      }

      // ---- 2) tombstones (admin-deleted → har device par ghaib + unorderable) ----
      const graves = (Array.isArray(b.tombstones) ? b.tombstones : [])
        .filter((x) => typeof x === "string" && ID_RE.test(x.trim())).slice(0, 12000);
      for (const batch of chunk(graves, 200)) {
        const { data: existing } = await db.from("nukto_products")
          .select("id,data").in("id", batch);
        const exMap = new Map(
          ((existing || []) as Record<string, unknown>[]).map((r) => [r.id as string, r]),
        );
        const rows = batch.map((id) => {
          const ex = exMap.get(id);
          const exData = (ex?.data && typeof ex.data === "object" ? ex.data : {}) as Record<string, unknown>;
          return { id, edited: true, updated_at: new Date().toISOString(), data: { ...exData, deleted: true } };
        });
        const { error } = await db.from("nukto_products").upsert(rows, { onConflict: "id" });
        if (error) return json({ error: "tombstone upsert failed" }, 500, cors);
        counts.tombstones += rows.length;
      }

      // ---- 3) coupons (uses server-owned: update par preserve, insert par 0) ----
      const rawCoupons = Array.isArray(b.coupons) ? b.coupons : [];
      if (rawCoupons.length > 500) return json({ error: "too many coupons" }, 400, cors);
      const cclean = (rawCoupons as Record<string, unknown>[])
        .map(cleanCoupon).filter((x): x is Record<string, unknown> => !!x);
      if (cclean.length) {
        const codes = cclean.map((c) => c.code as string);
        const { data: existing } = await db.from("nukto_coupons").select("code,uses").in("code", codes);
        const useMap = new Map(
          ((existing || []) as Record<string, unknown>[]).map((r) => [String(r.code).toUpperCase(), Number(r.uses) || 0]),
        );
        const rows = cclean.map((c) => ({ ...c, uses: useMap.get(c.code as string) ?? 0 }));
        const { error } = await db.from("nukto_coupons").upsert(rows, { onConflict: "id" });
        if (error) return json({ error: "coupons upsert failed" }, 500, cors);
        counts.coupons = rows.length;
      }
      // retired codes: server se delete (pull par graves se local se bhi hattein ge)
      const cgraves = (Array.isArray(b.couponGraves) ? b.couponGraves : [])
        .filter((x) => typeof x === "string" && CODE_RE.test(x.trim().toUpperCase())).slice(0, 500)
        .map((x) => String(x).trim().toUpperCase());
      if (cgraves.length) {
        const { error: delErr } = await db.from("nukto_coupons").delete().in("code", cgraves);
        if (delErr) return json({ error: "coupon graves delete failed" }, 500, cors);
        counts.graves = cgraves.length;
      }

      // ---- 4) settings (whitelist keys) + categories + graves (JSON rows) ----
      const srows: Record<string, unknown>[] = [];
      const s = (b.settings && typeof b.settings === "object" ? b.settings : {}) as Record<string, unknown>;
      for (const [k, kind] of Object.entries(SETTING_KEYS)) {
        const v = s[k];
        if (kind === "n") {
          const n = num(v, 0, 10000000);
          if (n !== null) srows.push({ id: "store:" + k, setting_key: k, value: String(Math.round(n)) });
        } else {
          const t = str(v as unknown, k === "banner" ? 1000 : 500);
          if (t !== null) srows.push({ id: "store:" + k, setting_key: k, value: t });
        }
      }
      const cats = (b.categories && typeof b.categories === "object" ? b.categories : {}) as Record<string, unknown>;
      const jrow = (key: string, val: unknown, maxLen: number) => {
        try {
          const j = JSON.stringify(val ?? (key === "catOverrides" ? {} : []));
          if (j.length <= maxLen) srows.push({ id: "store:" + key, setting_key: key, value: j });
        } catch { /* ignore unserializable */ }
      };
      if (Array.isArray(cats.custom)) {
        const custom = cats.custom.slice(0, 500)
          .filter((c) => c && typeof c === "object")
          .map((c) => {
            const r = c as Record<string, unknown>;
            const slug = typeof r.slug === "string" ? r.slug.trim().toLowerCase() : "";
            if (!SLUG_RE.test(slug)) return null;
            return { slug, name: str(r.name, 120) || slug, emoji: str(r.emoji, 16) || "📦" };
          }).filter(Boolean);
        jrow("customCategories", custom, 60000);
      }
      if (Array.isArray(cats.hidden)) {
        jrow("hiddenCategories", cats.hidden.filter((x) => typeof x === "string" && SLUG_RE.test(x.trim().toLowerCase())).slice(0, 500), 30000);
      }
      if (cats.overrides && typeof cats.overrides === "object") {
        const ov: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cats.overrides as Record<string, unknown>).slice(0, 2000)) {
          if (!SLUG_RE.test(k.trim().toLowerCase()) || !v || typeof v !== "object") continue;
          const r = v as Record<string, unknown>;
          ov[k.trim().toLowerCase()] = { name: str(r.name, 120) || k, emoji: str(r.emoji, 16) || "📦" };
        }
        jrow("catOverrides", ov, 200000);
      }
      jrow("couponGraves", cgraves.slice(0, 500), 30000);
      if (srows.length) {
        const { error } = await db.from("nukto_settings").upsert(srows, { onConflict: "id" });
        if (error) return json({ error: "settings upsert failed" }, 500, cors);
        counts.settings = srows.length;
      }
      // server checkout bhi wahi delivery config parhe (nukto_config, client-locked)
      const df = num(s.deliveryFee, 0, 100000), fa = num(s.deliveryFreeAbove, 0, 10000000);
      if (df !== null) await db.from("nukto_config").update({ num: Math.round(df) }).eq("key", "delivery_fee");
      if (fa !== null) await db.from("nukto_config").update({ num: Math.round(fa) }).eq("key", "delivery_free_above");

      return json({ ok: true, counts }, 200, cors);
    }

    // ================= SEED (catalog → nukto_products, chunked 500) =================
    if (action === "seed_products") {
      if (!await rateOk(db, "sync-seed", ip, 300, "1 hour")) {
        return json({ error: "Too many seed requests. Try again later." }, 429, cors);
      }
      const b = body as Record<string, unknown>;
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length || rows.length > 500) return json({ error: "rows must be 1..500" }, 400, cors);
      const cleaned = (rows as Record<string, unknown>[]).map((r) => {
        const c = cleanProduct(r);
        if (!c || c.name === undefined || c.price === undefined || c.stock === undefined) return null;
        return c;
      }).filter((x): x is Record<string, unknown> => !!x);
      if (!cleaned.length) return json({ error: "no valid rows" }, 400, cors);
      const ids = cleaned.map((r) => r.id as string);
      const { data: existing } = await db.from("nukto_products").select("id,edited").in("id", ids);
      const exMap = new Map(
        ((existing || []) as Record<string, unknown>[]).map((r) => [r.id as string, r.edited === true]),
      );
      // nayi rows: poori (stock samet). purani UNEDITED: base fields (stock NAHI —
      // real inventory mehfooz). purani EDITED: skip (admin override jeetta hai).
      const toUpsert: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const r of cleaned) {
        const id = r.id as string;
        if (!exMap.has(id)) {
          toUpsert.push({
            id, name: r.name, cat: r.cat ?? "other", cat_label: r.cat_label ?? "Other",
            emoji: r.emoji ?? "📦", price: r.price, img: r.img ?? "", description: r.description ?? "",
            stock: r.stock, updated_at: new Date().toISOString(),
          });
        } else if (exMap.get(id)) {
          skipped++;
        } else {
          const u: Record<string, unknown> = { id, updated_at: new Date().toISOString() };
          for (const k of ["name", "cat", "cat_label", "emoji", "price", "img", "description"]) {
            if (r[k] !== undefined) u[k] = r[k];
          }
          toUpsert.push(u);
        }
      }
      if (toUpsert.length) {
        const { error } = await db.from("nukto_products").upsert(toUpsert, { onConflict: "id" });
        if (error) return json({ error: "seed upsert failed" }, 500, cors);
      }
      return json({ ok: true, upserted: toUpsert.length, skipped }, 200, cors);
    }

    return json({ error: "unknown action" }, 400, cors);
  } catch {
    return json({ error: "Something went wrong." }, 500, cors);
  }
});
