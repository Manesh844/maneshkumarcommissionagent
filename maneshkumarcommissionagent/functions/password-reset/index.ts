// Manesh Kumar Commission Agent — password-reset Edge Function (Supabase)
// Deploy:  supabase functions deploy password-reset
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY, SITE_URL,
//          ALLOWED_ORIGINS
//
// Audit fixes vs v1:
//  #8   create/consume_password_reset ab PUBLIC RPC nahi. Wo internal
//       _create_password_reset / _consume_password_reset ban gaye hain aur
//       sirf yahi function (service_role) unhe call karta hai.
//       Flow: Browser → Edge Function → validate → update. Public
//       SECURITY DEFINER password-changing RPC ab exist hi nahi karta.
//  #9   In-memory Map limiter hata diya (multi-instance me bekaar tha).
//       Ab DB-backed rate_hit(): per-IP AUR per-email dono.
//  #10  CORS wildcard nahi — sirf ALLOWED_ORIGINS.
//
// Routes (same function, `action` field se):
//   POST {action:"request", email}                  → email bhejo
//   POST {action:"confirm", email, token, password} → password badlo

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

const SAME = { ok: true, message: "If the account exists, a reset link has been emailed." };

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  if (!cors["Access-Control-Allow-Origin"] && req.headers.get("origin")) {
    return json({ error: "origin not allowed" }, 403, cors);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "bad request" }, 400, cors);
    const action = String(body.action || "request");
    const em = String(body.email || "").toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      return json({ error: "Valid email required" }, 400, cors);
    }
    const ip = clientIp(req);

    // ---------- request a reset link ----------
    if (action === "request") {
      // dono taraf se throttle: IP flood aur ek hi email par bombing
      const okIp = await rateOk(db, "pwreset_ip", ip, 5, "15 minutes");
      const okEm = await rateOk(db, "pwreset_email", em, 3, "60 minutes");
      if (!okIp || !okEm) {
        return json({ error: "Too many requests. Try again later." }, 429, cors);
      }
      const { data: users } = await db.from("nukto_users")
        .select("id").ilike("email", em).limit(1);
      if (users && users.length) {
        const token = crypto.randomUUID() + crypto.randomUUID();
        const hash = await sha256(token);
        await db.rpc("_create_password_reset", { p_email: em, p_token_hash: hash });
        const site = Deno.env.get("SITE_URL") || "https://maneshkumarcommissionagent.dpdns.org";
        const link = `${site}/#reset:${token}~${encodeURIComponent(em)}`;
        await sendBrevo(em, "Manesh Kumar Commission Agent — Password Reset",
          `Assalam-o-Alaikum,\n\nApka password reset link (30 minute ke liye valid):\n\n${link}\n\nAgar aap ne request nahi ki, is email ko ignore karein.\n\n— Manesh Kumar Commission Agent`);
      }
      // hamesha same jawab → no user enumeration
      return json(SAME, 200, cors);
    }

    // ---------- confirm: token + naya password ----------
    if (action === "confirm") {
      if (!await rateOk(db, "pwconfirm_ip", ip, 10, "15 minutes")) {
        return json({ error: "Too many attempts." }, 429, cors);
      }
      const token = String(body.token || "");
      const pass = String(body.password || "");
      if (token.length < 20) return json({ error: "Invalid or expired link." }, 400, cors);
      if (pass.length < 8) {
        return json({ error: "Password must be at least 8 characters." }, 400, cors);
      }
      const tokenHash = await sha256(token);
      const newHash = await sha256(pass);   // client jaisa hi sha256 scheme
      const { data, error } = await db.rpc("_consume_password_reset", {
        p_email: em, p_token_hash: tokenHash, p_new_hash: newHash,
      });
      if (error) throw error;
      if (data !== true) return json({ error: "Invalid or expired link." }, 400, cors);
      return json({ ok: true, message: "Password updated. Please log in." }, 200, cors);
    }

    return json({ error: "unknown action" }, 400, cors);
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 500, cors);
  }
});

async function sendBrevo(to: string, subject: string, text: string) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Manesh Kumar Commission Agent", email: "no-reply@maneshkumarcommissionagent.dpdns.org" },
      to: [{ email: to }], subject, textContent: text,
    }),
  });
}
