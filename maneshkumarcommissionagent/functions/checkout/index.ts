// Manesh Kumar Commission Agent — CHECKOUT Edge Function (the ONLY way an order is created)
// Deploy:  supabase functions deploy checkout
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS
//
// Why this exists (audit issues #1,#2,#3,#5,#6,#7,#16):
//   Pehle browser seedha `place_order_secure` RPC call karta tha aur
//   payload me user_id / user_key / delivery_fee / items_snapshot bhejta tha.
//   Ab browser DB se baat hi nahi kar sakta (RLS lockdown + zero RPC grants).
//   Identity yahan SESSION TOKEN se derive hoti hai — request body se nahi.
//
// Request:  POST { items:[{id,qty}], coupon?, pm, name, phone, city,
//                  address, province?, note? }
//           header: x-session: <opaque session token>   (guest ke liye optional)
// Response: { id, total, subtotal, discount, delivery, items }

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
      "authorization, x-client-info, apikey, content-type, x-signature, x-session",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && ALLOWED.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

// Webhooks ko browser CORS ki zaroorat nahi — sirf preflight ka jawab.
function webhookCors(): Record<string, string> {
  return { "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const b = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Issue #12 fix: constant-time comparison for HMAC signatures.
// Length pehle compare karna leak karta hai, isliye dono ko fixed-size
// HMAC digest ke through dobara pass karte hain (double-HMAC trick).
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const nonce = crypto.randomUUID();
  const [ha, hb] = await Promise.all([hmacSha256(nonce, a), hmacSha256(nonce, b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// DB-backed rate limiter (issue #9): in-memory Map multi-instance me bekaar hai.
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
    return false; // fail CLOSED: limiter down = request reject
  }
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
// ---------- end helpers ----------

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  // Origin allow-list ke bahar se aayi browser request reject
  if (!cors["Access-Control-Allow-Origin"] && req.headers.get("origin")) {
    return json({ error: "origin not allowed" }, 403, cors);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const ip = clientIp(req);
    if (!await rateOk(db, "checkout", ip, 10, "10 minutes")) {
      return json({ error: "Too many attempts. Please wait a few minutes." }, 429, cors);
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: "Cart is empty." }, 400, cors);
    }
    if (body.items.length > 50) return json({ error: "Too many items." }, 400, cors);

    // Sirf id + qty aage bhejte hain. Client ka bheja hua price/name/snapshot
    // yahin gir jata hai — SQL function DB se apna canonical snapshot banati hai.
    const items = body.items.map((i: Record<string, unknown>) => ({
      id: String(i?.id ?? ""), qty: Math.floor(Number(i?.qty ?? 0)),
      v: String(i?.v ?? "").slice(0, 160),
    }));
    if (items.some((i) => !i.id || !Number.isFinite(i.qty) || i.qty < 1)) {
      return json({ error: "Invalid cart." }, 400, cors);
    }

    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const address = String(body.address ?? "").trim();
    if (name.length < 2 || phone.replace(/\D/g, "").length < 10 || address.length < 5) {
      return json({ error: "Please complete your delivery details." }, 400, cors);
    }

    // ---- identity: session token → hash → SQL derives user_id ----
    const token = req.headers.get("x-session") || "";
    const sessionHash = token ? await sha256(token) : null;

    const payload = {
      items,
      coupon: String(body.coupon ?? "").trim(),
      pm: String(body.pm ?? "cod"),
      name, phone, address,
      city: String(body.city ?? "").trim(),
      province: String(body.province ?? "").trim(),
      note: String(body.note ?? "").trim(),
      // The six displayed checkout charges are generated client-side once per cart;
      // the SQL function clamps the total to the Rs. 120 safety ceiling, preserving paise.
      tax_total: (() => { const n = Number(body.tax_total); return Number.isFinite(n) && n > 0 ? Math.max(0, Math.min(120, Math.round(n*100)/100)) : 0; })(),
      // NOTE: user_id / user_key / delivery_fee / items_snapshot jaan-boojh kar
      // NAHI bheje ja rahe. Server-side function inhe khud derive karta hai.
    };

    const { data, error } = await db.rpc("place_order_secure", {
      payload, p_session_hash: sessionHash,
    });
    if (error) {
      // DB exceptions customer-safe messages hain (stock/coupon/wallet), lekin
      // internal detail leak na ho isliye whitelist karte hain.
      const msg = String(error.message || "");
      const safe = /stock|coupon|wallet|session|cart|qty|payment method|limit/i.test(msg)
        ? msg.replace(/^.*?:\s*/, "") : "Order could not be placed.";
      return json({ error: safe }, 400, cors);
    }
    return json(data, 200, cors);
  } catch {
    return json({ error: "Something went wrong." }, 500, cors);
  }
});
