// NOTE: ye file ab sirf REFERENCE hai. Dashboard se deploy karte waqt Supabase
// relative imports (../_shared/) resolve nahi karta, isliye ye helpers har
// function ki index.ts me INLINE copy kar diye gaye hain. Yahan koi change
// karein to teeno functions me bhi update karna hoga.

// Manesh Kumar Commission Agent — shared Edge Function helpers (CORS + timing-safe compare + json)
// Issue #10 fix: CORS ab wildcard nahi. Sirf allow-list se match kiya hua
// origin echo hota hai; unknown origin ko koi ACAO header milta hi nahi.

const ALLOWED = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ||
    "https://maneshkumarcommissionagent.dpdns.org,https://www.maneshkumarcommissionagent.dpdns.org")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

export function corsFor(req: Request): Record<string, string> {
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
export function webhookCors(): Record<string, string> {
  return { "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}

export function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(secret: string, msg: string): Promise<string> {
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
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const nonce = crypto.randomUUID();
  const [ha, hb] = await Promise.all([hmacSha256(nonce, a), hmacSha256(nonce, b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// DB-backed rate limiter (issue #9): in-memory Map multi-instance me bekaar hai.
export async function rateOk(
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

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
