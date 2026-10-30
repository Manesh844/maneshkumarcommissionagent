// Manesh Kumar Commission Agent — ADMIN-AUTH Edge Function
// Deploy:  supabase functions deploy admin-auth --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS, ADMIN_SESSION_SECRET
//
// Kyun: admin panel ka login static site par SHA-256 hash compare se hota hai (offline
// bhi kaam kare). Ye function DB me rakhe hue roster (nukto_admin_users) se verify karta
// hai, taake:
//   * password Supabase me rotate ho to site redeploy kiye bagair chal jaye
//   * brute force per-IP + per-username DB rate limiter se ruke (rate_hit)
//   * plaintext password kahin na jaye — client hash bhi nahi bhejta, sirf function
//     ko credentials milti hain aur hash yahin banta hai
// Admin panel ka path (/#admin) discoverable nahi: ye function sirf credentials verify
// karti hai, koi user list ya role enumerate nahi karti.
//
// Request : POST { username, password }
// Response: { ok:true, username, role, token, expires_at } | { ok:false, reason }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && (ALLOWED.has(origin) || ALLOWED.size === 0)) h["Access-Control-Allow-Origin"] = origin;
  return h;
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

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

/* Stateless admin session token:  base64url(payload) + "." + hmac(payload)
   Payload me username/role/exp hota hai; secret sirf yahan (env) rehta hai. */
async function signToken(username: string, role: string, ttlMinutes: number, secret: string) {
  const exp = Date.now() + ttlMinutes * 60_000;
  const payload = btoa(JSON.stringify({ u: username, r: role, exp })).replace(/=+$/, "");
  const sig = (await hmacSha256(secret, payload)).slice(0, 32);
  return { token: `${payload}.${sig}`, expires_at: new Date(exp).toISOString() };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method not allowed" }, 405, cors);
  if (ALLOWED.size > 0 && !cors["Access-Control-Allow-Origin"] && req.headers.get("origin")) {
    return json({ ok: false, reason: "origin not allowed" }, 403, cors);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => null);
    const username = String(body?.username ?? "").trim().slice(0, 60);
    const password = String(body?.password ?? "");
    if (!username || !password) return json({ ok: false, reason: "missing credentials" }, 400, cors);
    if (password.length > 200) return json({ ok: false, reason: "invalid credentials" }, 400, cors);

    const passHash = await sha256(password);
    const { data, error } = await db.rpc("admin_verify", {
      p_username: username, p_pass_hash: passHash, p_ip: clientIp(req),
    });
    if (error) return json({ ok: false, reason: "invalid credentials" }, 401, cors);
    const res = (data || {}) as Record<string, unknown>;
    if (!res.ok) return json({ ok: false, reason: String(res.reason || "invalid credentials") }, 401, cors);

    const secret = Deno.env.get("ADMIN_SESSION_SECRET") || "";
    const out: Record<string, unknown> = {
      ok: true, username: String(res.username), role: String(res.role),
      pin_required: !!res.pin_required,
    };
    if (secret) Object.assign(out, await signToken(String(res.username), String(res.role), 720, secret));
    return json(out, 200, cors);
  } catch {
    return json({ ok: false, reason: "server error" }, 500, cors);
  }
});
