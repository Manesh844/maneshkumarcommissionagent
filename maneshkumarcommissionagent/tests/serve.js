#!/usr/bin/env node
/* Local preview server that reproduces the production response headers.

   `python3 -m http.server` cannot be used to verify the incident hardening:
   it sends no Content-Security-Policy, so the console tests in INCIDENT.md
   section 4c would all silently "pass" for the wrong reason. This server reads
   the real vercel.json and applies its `headers` and `rewrites` rules, so what
   you test on http://localhost:8080 is what Vercel will send.

   Node standard library only - no dependencies, dev tool, never shipped to the
   browser (the site only loads index.html, app.js and catalog.js).

   Usage:  node tests/serve.js [port]      (default 8080)           */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

/* Sandbox-preview opt-in (ARENA_PREVIEW=1).
   Arena renders this dev server inside an iframe served from a different
   origin, which the production framing rules would refuse:
   `frame-ancestors 'self'` (CSP) and `X-Frame-Options: SAMEORIGIN`.
   With the flag set this server relaxes ONLY those two, so the preview is
   visible. Everything else - the whole CSP, HSTS, Permissions-Policy, the
   host-conditional rewrites - is still sent byte-for-byte as vercel.json
   declares it, and vercel.json itself is never touched, so production stays
   locked down. Run without the flag to verify the real production headers. */
const RELAX_FRAMING = /^(1|true|yes)$/i.test(String(process.env.ARENA_PREVIEW || ""));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".csv": "text/csv; charset=utf-8",
};

/* Vercel `source` values are already regular expressions (/(.*), /admin/(.*),
   /(.*)\.(png|jpg|...) ), so they are used verbatim, anchored at both ends. */
function toRe(source) {
  try { return new RegExp("^" + source + "$"); }
  catch (e) { return new RegExp("^" + source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"); }
}
const headerRules = (cfg.headers || []).map(h => ({ re: toRe(h.source), headers: h.headers }));
const rewrites = (cfg.rewrites || []).map(r => ({ re: toRe(r.source), to: r.destination, has: r.has || null }));
function hostOf(req){ return String(req.headers.host || "localhost").split(":")[0].toLowerCase(); }
function hasOk(req, has){
  if(!has) return true;
  return has.every(c => (c.type === "host")
    ? new RegExp("^(?:" + c.value + ")$").test(hostOf(req))
    : true);
}

function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) if (rule.re.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  if (RELAX_FRAMING) {
    delete out["X-Frame-Options"];
    if (out["Content-Security-Policy"]) {
      out["Content-Security-Policy"] =
        out["Content-Security-Policy"].replace(/frame-ancestors\s+'self'/, "frame-ancestors *");
    }
  }
  return out;
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch (e) { res.writeHead(400).end("bad request"); return; }

  for (const rw of rewrites) if (hasOk(req, rw.has) && rw.re.test(pathname)) { pathname = rw.to.replace(/\$1/g, ""); break; }

  let file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }   // no path traversal
  if (pathname.endsWith("/") || !path.extname(pathname)) {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    else if (!fs.existsSync(file)) file += ".html";                             // cleanUrls
  }

  fs.readFile(file, (err, buf) => {
    const sent = headersFor(pathname);
    if (err) {
      res.writeHead(404, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, sent));
      res.end("404 " + pathname);
      return;
    }
    res.writeHead(200, Object.assign({
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
    }, sent));
    res.end(req.method === "HEAD" ? undefined : buf);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("MKCA preview on http://0.0.0.0:" + PORT + "  (headers + rewrites from vercel.json)");
  const csp = (headerRules[0] && headerRules[0].headers.find(h => h.key === "Content-Security-Policy")) || null;
  console.log(csp ? "CSP active: " + csp.value.slice(0, 96) + "..." : "WARNING: no CSP rule found in vercel.json");
  console.log(RELAX_FRAMING
    ? "ARENA_PREVIEW=1 -> X-Frame-Options dropped and frame-ancestors relaxed to * ON THIS DEV SERVER ONLY (vercel.json unchanged)"
    : "Framing headers are production-strict (frame-ancestors 'self' + X-Frame-Options SAMEORIGIN). Set ARENA_PREVIEW=1 to embed in an iframe.");
});
