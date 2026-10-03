// Manesh Kumar Commission Agent — payment gateway WEBHOOK Edge Function (Supabase)
// Deploy:  supabase functions deploy payment-webhook --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_SECRET
//
// Gateway webhook URL:
//   https://<project>.supabase.co/functions/v1/payment-webhook
//
// Audit fixes vs v1:
//  #11  amount ab record hota hai AUR order total se match kiya jata hai.
//       Mismatch = payment verify NAHI hoti (Rs.10 bhej kar Rs.10,000 ka
//       order paid nahi karwaya ja sakta).
//  #12  HMAC comparison constant-time hai (double-HMAC), `!==` nahi.
//  #10  Wildcard CORS hata diya — webhook server-to-server hai.
//  #13  release_order_stock ab public RPC nahi; internal _release_order_stock
//       sirf service_role se call hota hai (yahi function).
//
// Baaki guarantees: signature verify, idempotent pending→verified,
// order status kabhi customer ke browser se set nahi hota.

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
  const cors = webhookCors();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  try {
    const raw = await req.text();
    const sig = req.headers.get("x-signature") || "";
    const secret = Deno.env.get("WEBHOOK_SECRET") || "";
    if (!secret) return json({ error: "not configured" }, 500, cors);
    const expect = await hmacSha256(secret, raw);
    if (!await timingSafeEqual(sig, expect)) {
      return json({ error: "invalid signature" }, 401, cors);
    }

    const body = JSON.parse(raw);
    // ---- gateway-neutral mapping (EasyPaisa keys yahan add karo) ----
    const ref = String(body.reference || body.order_id || body.merchant_reference || "");
    const status = String(body.status || body.result || "").toLowerCase();
    // amount: gateway jo asal paisa confirm kar raha hai
    const amount = Number(
      body.amount ?? body.paid_amount ?? body.transaction_amount ?? body.txnAmount ?? NaN,
    );
    const txnRef = String(body.txn_id || body.transaction_id || ref);
    if (!ref) return json({ error: "missing reference" }, 400, cors);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const paid = ["paid", "success", "successful", "captured", "verified", "0000"].includes(status);
    const failed = ["failed", "cancelled", "canceled", "expired", "timeout", "declined"].includes(status);

    if (paid) {
      if (!Number.isFinite(amount)) {
        // Bina amount ke verify karna = issue #11. Reject, manual review.
        return json({ error: "missing amount; not verified" }, 400, cors);
      }
      // _mark_paid: row lock + amount == order.total check + idempotent
      const { data, error } = await db.rpc("_mark_paid", {
        p_oid: ref, p_amount: amount, p_ref: txnRef,
      });
      if (error) throw error;
      const res = data as Record<string, unknown>;
      if (res && res.ok === false) {
        // amount mismatch ya order missing → 409, gateway retry kar sakta hai
        return json({ ok: false, reason: res.reason }, 409, cors);
      }
      return json({ ok: true, ...(res || {}) }, 200, cors);
    }

    if (failed) {
      // stock hold release + order cancel (idempotent, internal function)
      const { error } = await db.rpc("_release_order_stock", { p_oid: ref });
      if (error) throw error;
      await db.from("nukto_orders")
        .update({ payment_status: "failed" })
        .eq("id", ref).eq("payment_status", "pending");
      return json({ ok: true }, 200, cors);
    }
    return json({ ok: true, ignored: status }, 200, cors);
  } catch {
    return json({ error: "Something went wrong." }, 500, cors);
  }
});
