/**
 * RED-TEAM LIVE ATTACKER — Extended pentest against @daloyjs/core.
 * ================================================================
 *
 * This extends the official red-team-live/run.ts with ADDITIONAL
 * undocumented / orthodox out-of-the-box attacks that are NOT in the
 * existing test suite:
 *
 *   - Unicode normalization / homoglyph attacks
 *   - Case-variation header smuggling
 *   - Malformed HTTP request lines
 *   - Chunked encoding abuse
 *   - Cookie prefix tossing (__Host- / __Secure-)
 *   - JSON duplicate-key collision
 *   - Very long URL path DoS
 *   - HTTP pipelining boundary abuse
 *   - Connection-header manipulation
 *   - Range header abuse
 *   - Accept-Language / Accept injection
 *   - Authorization header format confusion
 *   - ReDoS-style WAF evasion via comment nesting
 *   - JSON key-count structural boundary
 *   - Mixed encoding (% + unicode) in query strings
 *   - Host header injection via absolute URI
 *   - Content-Length mismatch (body shorter than declared)
 *   - Transfer-Encoding: chunked with invalid chunk size
 *   - Request smuggling via obfuscated TE header
 *   - JWT kid header injection / directory traversal in kid
 *   - Timing side-channel on rate-limit responses
 *   - Double Content-Type header confusion
 *   - Overly permissive Access-Control-Expose-Headers probing
 *   - X-Forwarded-* header spoofing without trustProxy
 *   - Large integer / bigint overflow in JSON
 *   - JSON with JavaScript comments (not standard, some parsers accept)
 *   - Unicode control characters in JSON keys
 *   - Nested object depth structural limit probing
 *   - Header name case folding abuse
 *   - URL-encoded NUL in path
 *   - Path with excessive dot segments
 *   - POST with empty Content-Length
 *   - Invalid HTTP version string
 *
 * Run:  pnpm red-team:live   (or: node --import tsx pentest-extended.ts)
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { gzipSync } from "node:zlib";
import { createHmac } from "node:crypto";

const HOST = "127.0.0.1";
type Verdict = "DEFENDED" | "VULNERABLE" | "INFO";
interface Finding {
  category: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  attack: string;
  observed: string;
  verdict: Verdict;
}
const findings: Finding[] = [];
const record = (f: Finding) => findings.push(f);

let BASE = "";
let BASE_B = "";

// ---------------------------------------------------------------------------
// Wire primitives
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  headers: Headers;
  text: string;
}
async function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {}
): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: opts.headers,
    body: opts.body,
    redirect: "manual",
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

function rawSend(
  port: number,
  payload: string | Buffer,
  waitMs = 1500
): Promise<{ raw: string; statusLine: string; status: number }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    let buf = "";
    const finish = () => {
      try {
        sock.destroy();
      } catch {}
      const statusLine = buf.split("\r\n")[0] ?? "";
      const m = /HTTP\/\d\.\d\s+(\d{3})/.exec(statusLine);
      resolve({ raw: buf, statusLine, status: m ? Number(m[1]) : 0 });
    };
    sock.setTimeout(waitMs);
    sock.on("connect", () => sock.write(payload));
    sock.on("data", (d) => {
      buf += d.toString("latin1");
    });
    sock.on("timeout", finish);
    sock.on("close", finish);
    sock.on("error", finish);
  });
}

function slowloris(
  port: number,
  holdMs: number
): Promise<{ closedByServer: boolean; afterMs: number }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    const t0 = Date.now();
    let settled = false;
    const done = (closedByServer: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {}
      resolve({ closedByServer, afterMs: Date.now() - t0 });
    };
    sock.on("connect", () => {
      sock.write("GET /healthz HTTP/1.1\r\nHost: target\r\n");
      let i = 0;
      const iv = setInterval(() => {
        if (settled) return clearInterval(iv);
        try {
          sock.write(`X-Drip-${i++}: keep-alive\r\n`);
        } catch {
          clearInterval(iv);
        }
      }, 300);
    });
    sock.on("close", () => done(true));
    sock.on("error", () => done(true));
    setTimeout(() => done(false), holdMs);
  });
}

function wsHandshake(
  port: number,
  origin?: string
): Promise<{ status: number; statusLine: string }> {
  const lines = [
    "GET /ws HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==",
    "Sec-WebSocket-Version: 13",
  ];
  if (origin) lines.push(`Origin: ${origin}`);
  return rawSend(port, lines.join("\r\n") + "\r\n\r\n", 1500).then((r) => ({
    status: r.status,
    statusLine: r.statusLine,
  }));
}

const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const forgeJwt = (header: object, payload: object, sig = "AAAA") =>
  `${seg(header)}.${seg(payload)}.${sig}`;

// ---------------------------------------------------------------------------
// Documented campaigns (from red-team-live/run.ts) — run for baseline
// ---------------------------------------------------------------------------

async function reconAndFingerprint() {
  const cat = "Recon / Information Gathering";
  const ok = await http("GET", "/healthz");
  const leaks = ["server", "x-powered-by", "x-aspnet-version", "x-runtime"].filter((h) =>
    ok.headers.get(h)
  );
  record({
    category: cat,
    title: "Framework / server fingerprinting headers",
    severity: "low",
    attack: "GET /healthz — inspect response headers for Server / X-Powered-By",
    observed: leaks.length ? `LEAKED: ${leaks.join(", ")}` : "no fingerprinting headers present",
    verdict: leaks.length ? "VULNERABLE" : "DEFENDED",
  });

  const nf = await http("GET", "/this-route-does-not-exist");
  const exposes = /\/(Users|home)\/|node:internal|\.ts:\d+|\n\s*at\s+/.test(nf.text);
  record({
    category: cat,
    title: "Error-response information disclosure (404)",
    severity: "medium",
    attack: "GET /this-route-does-not-exist — scrape body for stack / paths",
    observed: `status ${nf.status}, ct=${nf.headers.get("content-type")}, ${exposes ? "INTERNALS LEAKED" : "no stack / path leak"}`,
    verdict: exposes ? "VULNERABLE" : "DEFENDED",
  });
}

async function authAndJwt() {
  const cat = "Authentication / Authorization";

  const noTok = await http("GET", "/admin");
  record({
    category: cat,
    title: "Access protected /admin with no credentials",
    severity: "high",
    attack: "GET /admin (no Authorization header)",
    observed: `status ${noTok.status}`,
    verdict: noTok.status === 401 ? "DEFENDED" : "VULNERABLE",
  });

  const noneTok = forgeJwt({ alg: "none", typ: "JWT" }, { sub: "alice", scopes: ["admin"] }, "");
  const noneRes = await http("GET", "/admin", { headers: { authorization: `Bearer ${noneTok}` } });
  record({
    category: cat,
    title: "JWT alg:none forgery (admin escalation)",
    severity: "critical",
    attack: `GET /admin with forged {alg:"none", scopes:["admin"]} token`,
    observed:
      `status ${noneRes.status}` + (noneRes.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
    verdict:
      noneRes.status >= 400 && !noneRes.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
  });

  const fakeSig = forgeJwt(
    { alg: "HS256", typ: "JWT" },
    { sub: "alice", scopes: ["admin"], exp: Math.floor(Date.now() / 1000) + 600 }
  );
  const fakeRes = await http("GET", "/admin", { headers: { authorization: `Bearer ${fakeSig}` } });
  record({
    category: cat,
    title: "JWT forged-signature admin token",
    severity: "critical",
    attack: "GET /admin with HS256 token signed by attacker-guessed key",
    observed:
      `status ${fakeRes.status}` + (fakeRes.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
    verdict:
      fakeRes.status >= 400 && !fakeRes.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
  });

  const login = await http("POST", "/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "alice", pass: "correct-horse-battery" }),
  });
  let userToken = "";
  try {
    userToken = JSON.parse(login.text).token ?? "";
  } catch {}
  const escalate = userToken
    ? await http("GET", "/admin", { headers: { authorization: `Bearer ${userToken}` } })
    : null;
  record({
    category: cat,
    title: "Horizontal→vertical privilege escalation (user token → admin)",
    severity: "high",
    attack: "POST /login as alice then GET /admin with user token",
    observed: escalate
      ? `login ${login.status}, /admin ${escalate.status}` +
        (escalate.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : "")
      : "login failed",
    verdict:
      escalate && escalate.status === 403 && !escalate.text.includes("TOP-SECRET")
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const codes: number[] = [];
  for (let i = 0; i < 9; i++) {
    const r = await http("POST", "/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "alice", pass: `guess-${i}` }),
    });
    codes.push(r.status);
  }
  record({
    category: cat,
    title: "Unthrottled credential brute force",
    severity: "high",
    attack: "POST /login x9 with wrong passwords",
    observed: `status sequence ${codes.join(",")}`,
    verdict: codes.includes(429) ? "DEFENDED" : "VULNERABLE",
  });
}

async function injection() {
  const cat = "Injection (WSTG-INPV)";
  const payloads: Array<[string, string]> = [
    ["SQLi", "' OR 1=1--"],
    ["SQLi-encoded", "%27%20OR%201%3D1"],
    ["XSS", "<script>alert(1)</script>"],
    ["cmdi", "; cat /etc/passwd"],
  ];
  for (const [kind, raw] of payloads) {
    const r = await http("GET", `/search?q=${encodeURIComponent(raw)}`);
    record({
      category: cat,
      title: `${kind} via /search query`,
      severity: "high",
      attack: `GET /search?q=${raw}`,
      observed: `status ${r.status}`,
      verdict: r.status === 403 ? "DEFENDED" : "VULNERABLE",
    });
  }
  for (const [kind, raw] of [
    ["SQLi-double-encoded", "%2527%2520OR%25201%253D1"],
    ["SQLi-comment-split", "1/**/OR/**/1=1"],
  ] as const) {
    const r = await http("GET", `/search?q=${raw}`);
    record({
      category: cat,
      title: `${kind} via /search query`,
      severity: "high",
      attack: `GET /search?q=${raw}`,
      observed: `status ${r.status}`,
      verdict: r.status === 403 ? "DEFENDED" : "VULNERABLE",
    });
  }
  const nosql = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: { $ne: null }, price: { $gt: 0 } }),
  });
  record({
    category: cat,
    title: "NoSQL operator injection in body",
    severity: "high",
    attack: `POST /items {"name":{"$ne":null},...}`,
    observed: `status ${nosql.status}`,
    verdict:
      nosql.status === 422 || nosql.status === 403 || nosql.status === 400
        ? "DEFENDED"
        : "VULNERABLE",
  });
}

async function ssrfAndRedirect() {
  const cat = "SSRF / Open Redirect";
  const ssrfUrls = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:80/",
    "http://10.0.0.1/",
    "file:///etc/passwd",
  ];
  for (const u of ssrfUrls) {
    const r = await http("GET", `/fetch?url=${encodeURIComponent(u)}`);
    record({
      category: cat,
      title: `SSRF to ${u.slice(0, 40)}`,
      severity: "critical",
      attack: `GET /fetch?url=${u}`,
      observed: `status ${r.status}`,
      verdict: r.status === 403 ? "DEFENDED" : "VULNERABLE",
    });
  }
  const redirects = [
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ];
  for (const t of redirects) {
    const r = await http("GET", `/go?to=${encodeURIComponent(t)}`);
    const loc = r.headers.get("location") ?? "";
    const escaped = /evil|javascript:/i.test(loc);
    record({
      category: cat,
      title: `Open redirect to ${t}`,
      severity: "medium",
      attack: `GET /go?to=${t}`,
      observed: `status ${r.status}, Location="${loc}"`,
      verdict: !escaped ? "DEFENDED" : "VULNERABLE",
    });
  }
}

async function dataExposureAndMassAssignment() {
  const cat = "Data Exposure / Mass Assignment";
  const u = await http("GET", "/users/1");
  const leaked = /passwordhash|\$2b\$/i.test(u.text);
  record({
    category: cat,
    title: "Excessive data exposure (OWASP API3) — passwordHash leak",
    severity: "high",
    attack: "GET /users/1 (handler returns passwordHash; schema should strip it)",
    observed: `status ${u.status}, body=${u.text.slice(0, 120)}`,
    verdict: leaked ? "VULNERABLE" : "DEFENDED",
  });

  const ma = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "widget", price: 9.99, role: "admin", isAdmin: true }),
  });
  record({
    category: cat,
    title: "Mass assignment of privileged fields",
    severity: "high",
    attack: `POST /items {name, price, role:"admin", isAdmin:true}`,
    observed: `status ${ma.status}` + (/admin/i.test(ma.text) ? " — extra field echoed!" : ""),
    verdict:
      ma.status === 422 || (ma.status < 300 && !/admin/i.test(ma.text)) ? "DEFENDED" : "VULNERABLE",
  });

  const proto = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: '{"name":"x","price":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
  });
  const stillHealthy = (await http("GET", "/healthz")).status === 200;
  record({
    category: cat,
    title: "Prototype pollution via JSON body",
    severity: "critical",
    attack: `POST /items with __proto__ / constructor.prototype payload`,
    observed: `status ${proto.status}, server healthy afterward: ${stillHealthy}`,
    verdict:
      stillHealthy &&
      (proto.status === 422 || (proto.status < 300 && !proto.text.includes("polluted")))
        ? "DEFENDED"
        : "VULNERABLE",
  });
}

async function corsAbuse() {
  const cat = "Cross-Origin (CORS)";
  const evil = await http("GET", "/users/1", { headers: { origin: "https://evil.example" } });
  const acao = evil.headers.get("access-control-allow-origin");
  record({
    category: cat,
    title: "CORS origin reflection to an untrusted site",
    severity: "medium",
    attack: "GET /users/1 with Origin: https://evil.example",
    observed: `Access-Control-Allow-Origin=${acao ?? "(none)"}`,
    verdict: acao === null ? "DEFENDED" : "VULNERABLE",
  });
  const pf = await http("OPTIONS", "/users/1", {
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "DELETE",
      "access-control-request-headers": "authorization",
    },
  });
  const leaksConfig =
    pf.headers.get("access-control-allow-methods") || pf.headers.get("access-control-allow-origin");
  record({
    category: cat,
    title: "CORS preflight config disclosure to untrusted origin",
    severity: "low",
    attack: "OPTIONS /users/1 preflight from https://evil.example",
    observed: `status ${pf.status}, allow-methods=${pf.headers.get("access-control-allow-methods") ?? "(none)"}`,
    verdict: leaksConfig ? "VULNERABLE" : "DEFENDED",
  });
}

async function wireLevel(port: number) {
  const cat = "Wire-level (smuggling / DoS / splitting)";

  const dupCl = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nContent-Length: 6\r\nContent-Length: 5\r\nContent-Type: application/json\r\n\r\n{}\r\n\r\n"
  );
  record({
    category: cat,
    title: "HTTP request smuggling — duplicate Content-Length",
    severity: "critical",
    attack: "Raw POST with two conflicting Content-Length headers",
    observed: `response: ${dupCl.statusLine || "(connection dropped)"}`,
    verdict: dupCl.status === 400 || dupCl.status === 0 ? "DEFENDED" : "VULNERABLE",
  });

  const teCl = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n"
  );
  record({
    category: cat,
    title: "HTTP request smuggling — Transfer-Encoding + Content-Length desync",
    severity: "critical",
    attack: "Raw POST with both Transfer-Encoding: chunked and Content-Length",
    observed: `response: ${teCl.statusLine || "(connection dropped)"}`,
    verdict: teCl.status === 400 || teCl.status === 0 ? "DEFENDED" : "VULNERABLE",
  });

  const internal = await rawSend(
    port,
    "GET /healthz HTTP/1.1\r\nHost: t\r\nx-daloy-internal-user: admin\r\n\r\n"
  );
  record({
    category: cat,
    title: "Reserved internal-header smuggling (CVE-2025-29927 class)",
    severity: "high",
    attack: "Raw GET with a spoofed x-daloy-internal-user header",
    observed: `response: ${internal.statusLine || "(connection dropped)"}`,
    verdict: internal.status === 400 || internal.status === 0 ? "DEFENDED" : "INFO",
  });

  const bigHeaders =
    "GET /healthz HTTP/1.1\r\nHost: t\r\n" +
    Array.from({ length: 60 }, (_, i) => `X-Flood-${i}: ${"A".repeat(400)}`).join("\r\n") +
    "\r\n\r\n";
  const floodRes = await rawSend(port, bigHeaders);
  record({
    category: cat,
    title: "Header byte-size flood (HTTP/2-Bomb amplification dimension)",
    severity: "high",
    attack: "Raw GET with ~24 KiB of header fields (cap is 16 KiB)",
    observed: `response: ${floodRes.statusLine || "(connection dropped)"}`,
    verdict:
      floodRes.status === 431 || floodRes.status === 400 || floodRes.status === 0
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const countFlood =
    "GET /healthz HTTP/1.1\r\nHost: t\r\n" +
    Array.from({ length: 500 }, (_, i) => `X-C${i}: v`).join("\r\n") +
    "\r\n\r\n";
  const countRes = await rawSend(port, countFlood);
  record({
    category: cat,
    title: "Header-count flood (500 tiny headers, cap 100)",
    severity: "info",
    attack: "Raw GET with 500 tiny header fields",
    observed: `response: ${countRes.statusLine || "(dropped)"} — Node truncates extras silently`,
    verdict: "INFO",
  });

  const bigBody = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 1073741824\r\n\r\n{}",
    1500
  );
  record({
    category: cat,
    title: "Oversized-body resource exhaustion",
    severity: "high",
    attack: "Raw POST advertising a 1 GiB Content-Length",
    observed: `response: ${bigBody.statusLine || "(connection dropped)"}`,
    // 403 is also a defense: the CSRF/WAF gate refuses the request before a
    // single byte of the advertised 1 GiB body is read.
    verdict:
      bigBody.status === 413 ||
      bigBody.status === 400 ||
      bigBody.status === 403 ||
      bigBody.status === 0
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const slow = await slowloris(port, 4000);
  record({
    category: cat,
    title: "Slowloris (slow-header connection starvation)",
    severity: "high",
    attack: "Open socket, dribble headers, never finish the request",
    observed: slow.closedByServer
      ? `server closed the stalled socket after ${slow.afterMs}ms`
      : `socket still open after ${slow.afterMs}ms`,
    verdict: slow.closedByServer ? "DEFENDED" : "VULNERABLE",
  });

  const split = await http(
    "GET",
    `/echo-header?v=${encodeURIComponent("safe\r\nSet-Cookie: admin=1\r\nX-Injected: pwned")}`
  );
  const injected =
    split.headers.get("set-cookie") === "admin=1" || split.headers.get("x-injected") === "pwned";
  record({
    category: cat,
    title: "CRLF response splitting via reflected header",
    severity: "high",
    attack: "GET /echo-header?v=safe%0d%0aSet-Cookie:admin=1",
    observed: `status ${split.status}, injected header present: ${injected}`,
    verdict: !injected ? "DEFENDED" : "VULNERABLE",
  });
}

async function websocketHijack(port: number) {
  const cat = "WebSocket (CSWSH)";
  const evil = await wsHandshake(port, "https://evil.example");
  record({
    category: cat,
    title: "Cross-Site WebSocket Hijacking (cross-origin handshake)",
    severity: "high",
    attack: "Raw WS upgrade to /ws with Origin: https://evil.example",
    observed: `handshake: ${evil.statusLine || "(connection dropped)"}`,
    verdict: evil.status !== 101 ? "DEFENDED" : "VULNERABLE",
  });
}

async function protocolAndParsing(port: number) {
  const cat = "Protocol / parsing abuse";

  const trace = await rawSend(
    port,
    "TRACE /healthz HTTP/1.1\r\nHost: t\r\nX-Marker: SECRETVALUE\r\n\r\n"
  );
  record({
    category: cat,
    title: "HTTP verb tampering — TRACE / Cross-Site Tracing (XST)",
    severity: "medium",
    attack: "Raw TRACE /healthz with a marker header",
    observed: `${trace.statusLine || "(dropped)"}${trace.raw.includes("SECRETVALUE") ? " — REQUEST ECHOED!" : ""}`,
    verdict: trace.status !== 200 && !trace.raw.includes("SECRETVALUE") ? "DEFENDED" : "VULNERABLE",
  });

  const mo = await http("GET", "/resource", {
    headers: { "x-http-method-override": "DELETE", "x-method-override": "DELETE" },
  });
  record({
    category: cat,
    title: "HTTP method-override smuggling (GET → DELETE)",
    severity: "high",
    attack: "GET /resource with X-HTTP-Method-Override: DELETE",
    observed: `status ${mo.status}`,
    verdict: mo.status === 405 ? "DEFENDED" : "VULNERABLE",
  });

  const hpp = await http("GET", "/search?q=safe&q=' OR 1=1");
  record({
    category: cat,
    title: "HTTP Parameter Pollution (duplicate query keys)",
    severity: "medium",
    attack: "GET /search?q=safe&q=' OR 1=1",
    observed: `status ${hpp.status}`,
    verdict: hpp.status === 422 || hpp.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const ct = await http("POST", "/items", {
    headers: { "content-type": "text/plain" },
    body: "name=x&price=1",
  });
  record({
    category: cat,
    title: "Content-type confusion on a JSON body route",
    severity: "low",
    attack: "POST /items with Content-Type: text/plain",
    observed: `status ${ct.status}`,
    verdict: ct.status === 415 ? "DEFENDED" : "VULNERABLE",
  });

  const depth = 200_000;
  const t0 = Date.now();
  const bomb = await http("POST", "/sink", {
    headers: { "content-type": "application/json" },
    body: `{"data":${"[".repeat(depth)}${"]".repeat(depth)}}`,
  });
  record({
    category: cat,
    title: "Stack-bomb JSON (deeply nested arrays)",
    severity: "high",
    attack: "POST /sink with 200k nested arrays",
    observed: `status ${bomb.status} in ${Date.now() - t0}ms`,
    verdict: bomb.status === 400 && Date.now() - t0 < 3000 ? "DEFENDED" : "VULNERABLE",
  });

  const wide: Record<string, string> = {};
  for (let i = 0; i < 50_000; i++) wide["k" + i] = "v";
  const t1 = Date.now();
  const flood = await http("POST", "/wide", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wide),
  });
  record({
    category: cat,
    title: "Hash-flood (50k-key JSON object)",
    severity: "medium",
    attack: "POST /wide with 50,000 keys",
    observed: `status ${flood.status} in ${Date.now() - t1}ms`,
    verdict:
      (flood.status === 200 || flood.status === 400) && Date.now() - t1 < 3000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = new Set<string>();
  let allUuid = true;
  for (let i = 0; i < 64; i++) {
    const id = (await http("GET", "/healthz")).headers.get("x-request-id") ?? "";
    if (!UUID.test(id)) allUuid = false;
    ids.add(id);
  }
  record({
    category: cat,
    title: "Predictable request identifiers",
    severity: "low",
    attack: "Collect 64 live x-request-id values",
    observed: `${ids.size}/64 unique, all v4 UUID: ${allUuid}`,
    verdict: ids.size === 64 && allUuid ? "DEFENDED" : "VULNERABLE",
  });

  const h = (await http("GET", "/healthz")).headers;
  const framed =
    h.get("x-frame-options") === "DENY" &&
    (h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'");
  const hsts = /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? "");
  record({
    category: cat,
    title: "Clickjacking / HSTS response posture",
    severity: "medium",
    attack: "Inspect X-Frame-Options / CSP frame-ancestors / HSTS on a live response",
    observed: `X-Frame-Options=${h.get("x-frame-options")}, HSTS=${hsts}`,
    verdict: framed && hsts ? "DEFENDED" : "VULNERABLE",
  });
}

async function statefulMiddleware() {
  const cat = "Stateful middleware";

  const noToken = await http("POST", "/csrf-act");
  const matched = await http("POST", "/csrf-act", {
    headers: { cookie: "csrf=tok", "x-csrf-token": "tok" },
  });
  record({
    category: cat,
    title: "CSRF (state-changing POST without a valid token)",
    severity: "high",
    attack: "POST /csrf-act with no token, then with matching cookie+header",
    observed: `no-token ${noToken.status}, matched ${matched.status}`,
    verdict: noToken.status === 403 && matched.status === 200 ? "DEFENDED" : "VULNERABLE",
  });

  const huge = JSON.stringify({ value: "A".repeat(500_000) });
  const gz = gzipSync(Buffer.from(huge));
  const bomb = await fetch(BASE + "/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: gz,
  });
  record({
    category: cat,
    title: "Decompression bomb (gzip inflating past the cap)",
    severity: "high",
    attack: "POST /ingest, ~500 KB inflating from a few hundred gzip bytes",
    observed: `status ${bomb.status}`,
    verdict: bomb.status === 413 ? "DEFENDED" : "VULNERABLE",
  });

  const pay = (key: string, auth: string, amount = 10) =>
    http("POST", "/pay", {
      headers: { "content-type": "application/json", "idempotency-key": key, authorization: auth },
      body: JSON.stringify({ amount }),
    });
  const a1 = await pay("k1", "Bearer USER_A");
  const replay = await pay("k1", "Bearer USER_A");
  const reuse = await pay("k1", "Bearer USER_A", 999);
  const crossTenant = await pay("k1", "Bearer USER_B");
  const aOwner = JSON.parse(a1.text).owner;
  const bOwner = JSON.parse(crossTenant.text).owner ?? "";
  record({
    category: cat,
    title: "Idempotency replay + cross-tenant response disclosure (CWE-524)",
    severity: "high",
    attack: "Replay a key; reuse with a new body; reuse another user's key",
    observed: `replayed=${replay.headers.get("idempotency-replayed")}, key+newbody=${reuse.status}, B-got-own=${bOwner !== aOwner}`,
    verdict:
      replay.headers.get("idempotency-replayed") &&
      reuse.status === 422 &&
      bOwner !== aOwner &&
      bOwner === "Bearer USER_B"
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const [r1, r2] = await Promise.all([http("GET", "/slow"), http("GET", "/slow")]);
  const codes = [r1.status, r2.status].sort();
  record({
    category: cat,
    title: "Concurrency-limit load shedding",
    severity: "medium",
    attack: "Two concurrent GET /slow (maxConcurrent: 1, no queue)",
    observed: `statuses ${codes.join(",")}`,
    verdict: codes[0] === 200 && codes[1] === 503 ? "DEFENDED" : "VULNERABLE",
  });
}

async function accessControlFeeds() {
  const cat = "Access control (bot / geo / ban / mTLS)";

  const bot = await http("GET", "/healthz", { headers: { "user-agent": "evil-scraper/1.0" } });
  record({
    category: cat,
    title: "Blocked user-agent (bot guard)",
    severity: "low",
    attack: "GET /healthz with User-Agent: evil-scraper/1.0",
    observed: `status ${bot.status}`,
    verdict: bot.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const geo = await http("GET", "/healthz", { headers: { "x-forwarded-for": "203.0.113.7" } });
  record({
    category: cat,
    title: "Geo-blocked country",
    severity: "low",
    attack: "GET /healthz from a denied country (X-Forwarded-For)",
    observed: `status ${geo.status}`,
    verdict: geo.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const atk = { "x-forwarded-for": "6.6.6.6" };
  const strikes: number[] = [];
  for (let i = 0; i < 3; i++)
    strikes.push((await http("GET", "/ab-login", { headers: atk })).status);
  const banned = await http("GET", "/ab-public", { headers: atk });
  const innocent = await http("GET", "/ab-public", { headers: { "x-forwarded-for": "9.9.9.9" } });
  record({
    category: cat,
    title: "Brute-force auto-ban (fail2ban-style)",
    severity: "medium",
    attack: "3× failed /ab-login from one IP, then hit /ab-public",
    observed: `strikes ${strikes.join(",")}, banned=${banned.status}, other-ip=${innocent.status}`,
    verdict: banned.status === 429 && innocent.status === 200 ? "DEFENDED" : "VULNERABLE",
  });

  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
  const unknown = await http("GET", "/basic-vault", {
    headers: { authorization: basic("bob", "x") },
  });
  const wrongPass = await http("GET", "/basic-vault", {
    headers: { authorization: basic("alice", "WRONG") },
  });
  const good = await http("GET", "/basic-vault", {
    headers: { authorization: basic("alice", "s3cret-correct") },
  });
  record({
    category: cat,
    title: "Account enumeration via basic-auth response differences",
    severity: "medium",
    attack: "Compare 401s for unknown user vs known user with wrong password",
    observed: `unknown=${unknown.status}, wrong-pass=${wrongPass.status}, identical=${unknown.text === wrongPass.text}, good=${good.status}`,
    verdict:
      unknown.status === 401 &&
      wrongPass.status === 401 &&
      unknown.text === wrongPass.text &&
      good.status === 200
        ? "DEFENDED"
        : "VULNERABLE",
  });

  const mtls = await http("GET", "/mtls", {
    headers: { "x-forwarded-client-cert": 'Subject="CN=admin";Hash=deadbeef' },
  });
  record({
    category: cat,
    title: "Spoofed mTLS client-cert header (XFCC)",
    severity: "high",
    attack: "GET /mtls with a forged X-Forwarded-Client-Cert",
    observed: `status ${mtls.status}`,
    verdict: mtls.status === 401 ? "DEFENDED" : "VULNERABLE",
  });
}

async function exceptPathConfusion() {
  const cat = "Auth path-confusion (except)";
  const at = (path: string) => fetch(BASE_B + path, { redirect: "manual" }).then((r) => r.status);

  const direct = await at("/api/admin");
  record({
    category: cat,
    title: "Protected route reachable without credentials",
    severity: "high",
    attack: "GET /api/admin (no token) on the except()-guarded app",
    observed: `status ${direct}`,
    verdict: direct === 401 ? "DEFENDED" : "VULNERABLE",
  });

  let bypassed = false;
  for (const p of ["/public/../api/admin", "/public/%2e%2e/api/admin", "/public//api/admin"]) {
    if ((await at(p)) === 200) bypassed = true;
  }
  record({
    category: cat,
    title: "Path-traversal auth bypass through an except() exemption",
    severity: "critical",
    attack: "GET /public/../api/admin (and encoded variants)",
    observed: bypassed
      ? "a traversal reached the protected handler!"
      : "every traversal stayed blocked",
    verdict: bypassed ? "VULNERABLE" : "DEFENDED",
  });
}

// ---------------------------------------------------------------------------
// UNDOCUMENTED / ORTHODOX OUT-OF-THE-BOX ATTACKS (not in existing test suite)
// ---------------------------------------------------------------------------

async function undocumentedAttacks(port: number, portB: number) {
  const cat = "UNDOCUMENTED — Orthogonal / out-of-the-box vectors";

  // 1. Unicode normalization / homoglyph in path
  const unicodePath = await rawSend(port, "GET /users/\uFF11 HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Unicode fullwidth digit in path (homoglyph)",
    severity: "medium",
    attack: "GET /users/\uFF11 (fullwidth '1')",
    observed: `response: ${unicodePath.statusLine || "(dropped)"}`,
    verdict: unicodePath.status === 404 ? "DEFENDED" : "INFO",
  });

  // 2. Case-variation on reserved internal header
  const caseInternal = await rawSend(
    port,
    "GET /healthz HTTP/1.1\r\nHost: t\r\nX-DALOY-INTERNAL-SUBREQUEST: 1\r\n\r\n"
  );
  record({
    category: cat,
    title: "Reserved internal header — uppercase variant",
    severity: "medium",
    attack: "Raw GET with X-DALOY-INTERNAL-SUBREQUEST (uppercase)",
    observed: `response: ${caseInternal.statusLine || "(dropped)"}`,
    verdict: caseInternal.status === 400 || caseInternal.status === 0 ? "DEFENDED" : "VULNERABLE",
  });

  // 3. Malformed HTTP request line
  const malformed = await rawSend(port, "GETTTT /healthz HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Malformed HTTP method (GETTTT)",
    severity: "low",
    attack: "Raw GETTTT /healthz HTTP/1.1",
    observed: `response: ${malformed.statusLine || "(dropped)"}`,
    verdict:
      malformed.status === 400 ||
      malformed.status === 501 ||
      malformed.status === 405 ||
      malformed.status === 0
        ? "DEFENDED"
        : "INFO",
  });

  // 4. Invalid HTTP version
  const badVersion = await rawSend(port, "GET /healthz HTTP/9.9\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Invalid HTTP version string (HTTP/9.9)",
    severity: "low",
    attack: "Raw GET /healthz HTTP/9.9",
    observed: `response: ${badVersion.statusLine || "(dropped)"}`,
    verdict:
      badVersion.status === 400 || badVersion.status === 505 || badVersion.status === 0
        ? "DEFENDED"
        : "INFO",
  });

  // 5. Chunked encoding with invalid chunk size
  const badChunk = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\nZZZZ\r\n{}\r\n0\r\n\r\n"
  );
  record({
    category: cat,
    title: "Chunked encoding with non-hex chunk size",
    severity: "medium",
    attack: "Raw POST with Transfer-Encoding: chunked and chunk-size 'ZZZZ'",
    observed: `response: ${badChunk.statusLine || "(dropped)"}`,
    verdict: badChunk.status === 400 || badChunk.status === 0 ? "DEFENDED" : "INFO",
  });

  // 6. Content-Length mismatch (body shorter than declared)
  const shortBody = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{}",
    1500
  );
  record({
    category: cat,
    title: "Content-Length mismatch (body shorter than declared)",
    severity: "medium",
    attack: "Raw POST with Content-Length: 100 but body is '{}'",
    observed: `response: ${shortBody.statusLine || "(dropped)"}`,
    verdict:
      shortBody.status === 400 || shortBody.status === 408 || shortBody.status === 0
        ? "DEFENDED"
        : "INFO",
  });

  // 7. Cookie prefix tossing (__Host- without Secure)
  const cookieToss = await http("GET", "/users/1", {
    headers: { cookie: "__Host-session=evil; session=legit" },
  });
  record({
    category: cat,
    title: "Cookie prefix tossing (__Host- bypass attempt)",
    severity: "low",
    attack: "GET /users/1 with __Host-session cookie (no Secure flag check at request boundary)",
    observed: `status ${cookieToss.status} — cookie prefix tossing is a browser-enforced policy`,
    verdict: "INFO",
  });

  // 8. JSON duplicate-key collision
  const dupKey = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: '{"name": "safe", "name": "evil", "price": 1}',
  });
  record({
    category: cat,
    title: "JSON duplicate-key collision",
    severity: "medium",
    attack: 'POST /items {"name":"safe","name":"evil","price":1}',
    observed: `status ${dupKey.status}, body=${dupKey.text.slice(0, 80)}`,
    verdict: dupKey.status < 300 || dupKey.status === 422 ? "DEFENDED" : "INFO",
  });

  // 9. Very long URL path DoS
  const longPath = "/" + "a/".repeat(5000) + "healthz";
  const t0 = Date.now();
  const longPathRes = await http("GET", longPath);
  record({
    category: cat,
    title: "Very long URL path (pathological routing)",
    severity: "medium",
    attack: "GET with a 5000-segment path",
    observed: `status ${longPathRes.status} in ${Date.now() - t0}ms`,
    verdict:
      (longPathRes.status === 404 || longPathRes.status === 400) && Date.now() - t0 < 2000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // 10. HTTP pipelining boundary abuse
  const pipeline = await rawSend(
    port,
    "GET /healthz HTTP/1.1\r\nHost: t\r\n\r\nGET /admin HTTP/1.1\r\nHost: t\r\n\r\n"
  );
  const twoResponses = (pipeline.raw.match(/HTTP\/1\.1/g) || []).length >= 2;
  record({
    category: cat,
    title: "HTTP pipelining — multiple requests on one socket",
    severity: "low",
    attack: "Raw pipelined GET /healthz + GET /admin",
    observed: `received ${(pipeline.raw.match(/HTTP\/1\.1/g) || []).length} HTTP responses`,
    verdict: twoResponses ? "DEFENDED" : "INFO",
  });

  // 11. Connection: keep-alive with oversized pipelining
  const keepAliveFlood =
    "GET /healthz HTTP/1.1\r\nHost: t\r\nConnection: keep-alive\r\n\r\n".repeat(50);
  const t1 = Date.now();
  const kaRes = await rawSend(port, keepAliveFlood, 2000);
  record({
    category: cat,
    title: "Connection keep-alive flood (50 pipelined requests)",
    severity: "medium",
    attack: "Send 50 pipelined GETs on one connection",
    observed: `status ${kaRes.status}, elapsed ${Date.now() - t1}ms`,
    verdict: Date.now() - t1 < 3000 ? "DEFENDED" : "VULNERABLE",
  });

  // 12. Range header abuse
  const range = await http("GET", "/healthz", { headers: { range: "bytes=0-999999999" } });
  record({
    category: cat,
    title: "Range header abuse (excessive range)",
    severity: "low",
    attack: "GET /healthz with Range: bytes=0-999999999",
    observed: `status ${range.status}`,
    verdict: range.status === 200 || range.status === 416 ? "DEFENDED" : "INFO",
  });

  // 13. Accept-Language injection
  const lang = await http("GET", "/healthz", {
    headers: { "accept-language": "<script>alert(1)</script>" },
  });
  record({
    category: cat,
    title: "Accept-Language header injection (XSS vector)",
    severity: "low",
    attack: "GET /healthz with Accept-Language: <script>alert(1)</script>",
    observed: `status ${lang.status}`,
    verdict: lang.status === 200 ? "DEFENDED" : "INFO",
  });

  // 14. Authorization header format confusion
  const authConfusion = await http("GET", "/admin", { headers: { authorization: "Bearer " } });
  record({
    category: cat,
    title: "Authorization header format confusion (empty token)",
    severity: "low",
    attack: "GET /admin with Authorization: Bearer (empty token)",
    observed: `status ${authConfusion.status}`,
    verdict:
      authConfusion.status === 401 || authConfusion.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  // 15. ReDoS-style WAF evasion via nested SQL comments
  const nestedComment = await http(
    "GET",
    `/search?q=${encodeURIComponent("1/**/OR/**/(SELECT/**/1)")}`
  );
  record({
    category: cat,
    title: "WAF evasion — nested SQL comment obfuscation",
    severity: "medium",
    attack: "GET /search?q=1/**/OR/**/(SELECT/**/1)",
    observed: `status ${nestedComment.status}`,
    verdict: nestedComment.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  // 16. Mixed encoding in query string (% + unicode)
  const mixedEnc = await http("GET", "/search?q=%2527%20OR%20%C0%A71%3D1");
  record({
    category: cat,
    title: "Mixed encoding (% + overlong UTF-8) in query",
    severity: "medium",
    attack: "GET /search?q=%2527%20OR%20%C0%A71%3D1 (overlong UTF-8 encoding of apostrophe)",
    observed: `status ${mixedEnc.status}`,
    verdict: mixedEnc.status === 403 || mixedEnc.status === 400 ? "DEFENDED" : "INFO",
  });

  // 17. Host header injection via absolute URI (different host)
  const hostInject = await rawSend(
    port,
    `GET http://evil.com/healthz HTTP/1.1\r\nHost: ${HOST}:${port}\r\n\r\n`
  );
  record({
    category: cat,
    title: "Host header injection via absolute URI",
    severity: "medium",
    attack: "GET http://evil.com/healthz HTTP/1.1",
    observed: `response: ${hostInject.statusLine || "(dropped)"}`,
    verdict: hostInject.status === 400 || hostInject.status === 404 ? "DEFENDED" : "INFO",
  });

  // 18. Double Content-Type header confusion
  const doubleCT = await rawSend(
    port,
    'POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: text/plain\r\nContent-Type: application/json\r\n\r\n{"name":"x","price":1}'
  );
  record({
    category: cat,
    title: "Double Content-Type header confusion",
    severity: "medium",
    attack: "Raw POST with Content-Type: text/plain AND Content-Type: application/json",
    observed: `response: ${doubleCT.statusLine || "(dropped)"}`,
    verdict: doubleCT.status === 415 || doubleCT.status === 400 ? "DEFENDED" : "INFO",
  });

  // 19. X-Forwarded-* header spoofing WITHOUT trustProxy (on a separate route that doesn't trust proxy)
  // This probes whether the framework leaks spoofed IPs to non-trusted routes.
  const noTrustProxy = await http("GET", "/healthz", {
    headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
  });
  record({
    category: cat,
    title: "X-Forwarded-For spoofing on non-trusted route",
    severity: "low",
    attack:
      "GET /healthz with X-Forwarded-For: 1.2.3.4 (app has trustProxy: true, so this is informational)",
    observed: `status ${noTrustProxy.status} — the app explicitly trusts proxy headers`,
    verdict: "INFO",
  });

  // 20. Large integer / bigint overflow in JSON
  const bigInt = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: '{"name":"x","price":999999999999999999999999999999999999}',
  });
  record({
    category: cat,
    title: "JSON large numeric overflow (price field)",
    severity: "medium",
    attack: "POST /items with price: 999999999999999999999999999999999999",
    observed: `status ${bigInt.status}, body=${bigInt.text.slice(0, 80)}`,
    verdict: bigInt.status === 422 || bigInt.status === 400 ? "DEFENDED" : "INFO",
  });

  // 21. JSON with JavaScript comments (some parsers accept them)
  const jsonComment = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: '/*comment*/{"name":"x","price":1}',
  });
  record({
    category: cat,
    title: "JSON with JavaScript-style comments",
    severity: "medium",
    attack: "POST /items with /*comment*/ prefix in JSON body",
    observed: `status ${jsonComment.status}`,
    verdict: jsonComment.status === 400 || jsonComment.status === 422 ? "DEFENDED" : "INFO",
  });

  // 22. Unicode control characters in JSON keys
  const ctrlKey = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: '{"name\u0000":"x","price":1}',
  });
  record({
    category: cat,
    title: "Unicode control character (NUL) in JSON key",
    severity: "medium",
    attack: "POST /items with NUL byte inside JSON key",
    observed: `status ${ctrlKey.status}`,
    verdict: ctrlKey.status === 400 || ctrlKey.status === 422 ? "DEFENDED" : "INFO",
  });

  // 23. Nested object depth structural limit probing
  const nested = '{"a":'.repeat(60) + "1" + "}".repeat(60);
  const t2 = Date.now();
  const nestedRes = await http("POST", "/sink", {
    headers: { "content-type": "application/json" },
    body: nested,
  });
  record({
    category: cat,
    title: "JSON nested object depth (60 levels)",
    severity: "medium",
    attack: "POST /sink with 60-level nested JSON object",
    observed: `status ${nestedRes.status} in ${Date.now() - t2}ms`,
    verdict:
      (nestedRes.status === 200 || nestedRes.status === 400) && Date.now() - t2 < 2000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // 24. Header name case folding abuse
  const caseFold = await rawSend(
    port,
    "GET /healthz HTTP/1.1\r\nhost: t\r\nHOST: evil\r\nHoSt: other\r\n\r\n"
  );
  record({
    category: cat,
    title: "Header name case-folding abuse (duplicate Host via case variation)",
    severity: "medium",
    attack: "Raw GET with host, HOST, and HoSt headers",
    observed: `response: ${caseFold.statusLine || "(dropped)"}`,
    verdict: caseFold.status === 400 || caseFold.status === 0 ? "DEFENDED" : "INFO",
  });

  // 25. URL-encoded NUL in path
  const nullPath = await rawSend(port, "GET /users/1%00admin HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "URL-encoded NUL byte in path (null injection)",
    severity: "medium",
    attack: "GET /users/1%00admin",
    observed: `response: ${nullPath.statusLine || "(dropped)"}`,
    verdict: nullPath.status === 400 || nullPath.status === 404 ? "DEFENDED" : "INFO",
  });

  // 26. Excessive dot-segments in path
  const dots = await rawSend(
    port,
    "GET /" + "../".repeat(100) + "healthz HTTP/1.1\r\nHost: t\r\n\r\n"
  );
  record({
    category: cat,
    title: "Excessive dot-segments in path (path traversal stress)",
    severity: "medium",
    attack: "GET with 100x '../' prefix before healthz",
    observed: `response: ${dots.statusLine || "(dropped)"}`,
    verdict:
      dots.status === 400 || dots.status === 404 || dots.status === 200 ? "DEFENDED" : "INFO",
  });

  // 27. POST with empty Content-Length
  const emptyCL = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\n"
  );
  record({
    category: cat,
    title: "POST with empty body (Content-Length: 0)",
    severity: "low",
    attack: "Raw POST /items with Content-Length: 0",
    observed: `response: ${emptyCL.statusLine || "(dropped)"}`,
    verdict: emptyCL.status === 400 || emptyCL.status === 422 ? "DEFENDED" : "INFO",
  });

  // 28. Transfer-Encoding obfuscation (tab between words)
  const teObf = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nTransfer-Encoding:\tchunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n"
  );
  record({
    category: cat,
    title: "Transfer-Encoding obfuscation (tab separator)",
    severity: "high",
    attack: "Raw POST with Transfer-Encoding:\tchunked + Content-Length",
    observed: `response: ${teObf.statusLine || "(dropped)"}`,
    verdict: teObf.status === 400 || teObf.status === 0 ? "DEFENDED" : "VULNERABLE",
  });

  // 29. JWT kid header injection / directory traversal
  const kidTraverse = forgeJwt(
    { alg: "HS256", typ: "JWT", kid: "../../../etc/passwd" },
    { sub: "alice", scopes: ["admin"], exp: Math.floor(Date.now() / 1000) + 600 }
  );
  const kidRes = await http("GET", "/admin", {
    headers: { authorization: `Bearer ${kidTraverse}` },
  });
  record({
    category: cat,
    title: "JWT kid header directory traversal",
    severity: "medium",
    attack: 'GET /admin with JWT kid="../../../etc/passwd"',
    observed: `status ${kidRes.status}`,
    verdict: kidRes.status >= 400 ? "DEFENDED" : "VULNERABLE",
  });

  // 30. Timing side-channel on rate-limit responses (same error message for different failures)
  const rate1 = await http("POST", "/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "alice", pass: "wrong1" }),
  });
  const rate2 = await http("POST", "/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "alice", pass: "wrong2" }),
  });
  record({
    category: cat,
    title: "Rate-limit response consistency (enumeration probe)",
    severity: "low",
    attack: "Two failed logins — compare response bodies",
    observed: `status1=${rate1.status}, status2=${rate2.status}, identical=${rate1.text === rate2.text}`,
    verdict: rate1.text === rate2.text ? "DEFENDED" : "INFO",
  });

  // 31. Request with no Host header at all
  const noHost = await rawSend(port, "GET /healthz HTTP/1.1\r\n\r\n");
  record({
    category: cat,
    title: "Missing Host header",
    severity: "medium",
    attack: "Raw GET /healthz HTTP/1.1 with no Host header",
    observed: `response: ${noHost.statusLine || "(dropped)"}`,
    verdict: noHost.status === 400 || noHost.status === 0 ? "DEFENDED" : "INFO",
  });

  // 32. JSON key-count boundary (exactly at jsonMaxKeys limit)
  const atLimit: Record<string, string> = {};
  for (let i = 0; i < 10_000; i++) atLimit[`k${i}`] = "v";
  const t3 = Date.now();
  const limitRes = await http("POST", "/wide", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(atLimit),
  });
  record({
    category: cat,
    title: "JSON key-count boundary (exactly 10,000 keys = jsonMaxKeys default)",
    severity: "medium",
    attack: "POST /wide with exactly 10,000 keys",
    observed: `status ${limitRes.status} in ${Date.now() - t3}ms`,
    verdict:
      (limitRes.status === 200 || limitRes.status === 400) && Date.now() - t3 < 3000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // 33. Overly permissive Access-Control-Expose-Headers probing
  const expose = await http("GET", "/users/1", { headers: { origin: "https://app.example.com" } });
  const exposeHeaders = expose.headers.get("access-control-expose-headers");
  record({
    category: cat,
    title: "Access-Control-Expose-Headers leakage",
    severity: "low",
    attack: "GET /users/1 with allowed Origin to inspect expose-headers",
    observed: `Access-Control-Expose-Headers=${exposeHeaders ?? "(none)"}`,
    verdict: exposeHeaders === null || exposeHeaders === "" ? "DEFENDED" : "INFO",
  });

  // 34. WebSocket subprotocol smuggling
  const wsProto = await rawSend(
    port,
    [
      "GET /ws HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Protocol: evil-protocol",
      "Origin: http://127.0.0.1",
    ].join("\r\n") + "\r\n\r\n"
  );
  record({
    category: cat,
    title: "WebSocket subprotocol smuggling",
    severity: "low",
    attack: "WS upgrade with unexpected Sec-WebSocket-Protocol",
    observed: `handshake: ${wsProto.statusLine || "(dropped)"}`,
    verdict: wsProto.status !== 101 ? "DEFENDED" : "INFO",
  });

  // 35. Obfuscated Transfer-Encoding: chun\x00ked (NUL in header value)
  const teNul = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chun\x00ked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n"
  );
  record({
    category: cat,
    title: "Transfer-Encoding with NUL byte in value",
    severity: "high",
    attack: "Raw POST with Transfer-Encoding: chun\x00ked + Content-Length",
    observed: `response: ${teNul.statusLine || "(dropped)"}`,
    verdict: teNul.status === 400 || teNul.status === 0 ? "DEFENDED" : "VULNERABLE",
  });

  // 36. Very long query string (URL parsing DoS)
  const longQuery = "?q=" + "a".repeat(50_000);
  const t4 = Date.now();
  const lqRes = await http("GET", "/search" + longQuery);
  record({
    category: cat,
    title: "Very long query string (50k chars)",
    severity: "medium",
    attack: "GET /search?q=AAAA... (50,000 chars)",
    observed: `status ${lqRes.status} in ${Date.now() - t4}ms`,
    verdict:
      (lqRes.status === 200 ||
        lqRes.status === 400 ||
        lqRes.status === 414 ||
        lqRes.status === 431) &&
      Date.now() - t4 < 2000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // 37. JSON array with massive number of elements
  const bigArray = JSON.stringify(new Array(100_000).fill("x"));
  const t5 = Date.now();
  const baRes = await http("POST", "/sink", {
    headers: { "content-type": "application/json" },
    body: `{"data":${bigArray}}`,
  });
  record({
    category: cat,
    title: "JSON massive array (100k elements)",
    severity: "medium",
    attack: "POST /sink with 100,000-element array",
    observed: `status ${baRes.status} in ${Date.now() - t5}ms`,
    verdict:
      (baRes.status === 200 || baRes.status === 400) && Date.now() - t5 < 3000
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // 38. Request with both Authorization and Cookie (credential confusion)
  const dualAuth = await http("GET", "/admin", {
    headers: { authorization: "Bearer fake", cookie: "session=fake" },
  });
  record({
    category: cat,
    title: "Dual credential confusion (Bearer + Cookie)",
    severity: "low",
    attack: "GET /admin with both Authorization and Cookie headers",
    observed: `status ${dualAuth.status}`,
    verdict: dualAuth.status >= 400 ? "DEFENDED" : "INFO",
  });

  // 39. HTTP/1.0 request (no Host required in 1.0)
  const http10 = await rawSend(port, "GET /healthz HTTP/1.0\r\n\r\n");
  record({
    category: cat,
    title: "HTTP/1.0 request (no Host header)",
    severity: "low",
    attack: "GET /healthz HTTP/1.0 with no Host",
    observed: `response: ${http10.statusLine || "(dropped)"}`,
    verdict: http10.status === 200 || http10.status === 400 ? "DEFENDED" : "INFO",
  });

  // 40. Request with Content-Length and chunked body mismatch
  const clChunked = await rawSend(
    port,
    'POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n5\r\n{"a":1}\r\n0\r\n\r\n'
  );
  record({
    category: cat,
    title: "Content-Length + chunked body mismatch",
    severity: "medium",
    attack: "Raw POST with Content-Length: 10 but chunked-encoded body",
    observed: `response: ${clChunked.statusLine || "(dropped)"}`,
    verdict: clChunked.status === 400 || clChunked.status === 0 ? "DEFENDED" : "INFO",
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v1.1.0 hardening probes — regression coverage for the live-pentest findings
// that produced the 1.1.0 release (JWT crit, verifier lifetime cap, parser
// header-cap truncation, WS frame-protocol discipline).
// ---------------------------------------------------------------------------

/** Validly-signed HS256 token (harness-known secret — models a compromised / misconfigured issuer sharing the key). */
function signHs256(header: object, payload: object, secret: string): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${sig.toString("base64url")}`;
}

async function v101HardeningProbes(port: number) {
  const cat = "v1.1.0 hardening";
  // Mirrors target.ts — a *validly signed* but malicious token. Threat model:
  // a second issuer sharing the key, or a signing-side bug; the verifier must
  // still refuse structurally abusive tokens.
  const SECRET = "live-target-jwt-secret-32-bytes!!";
  const now = Math.floor(Date.now() / 1000);

  const critTok = signHs256(
    { alg: "HS256", typ: "JWT", crit: ["exp"], exp: now + 300 },
    { sub: "alice", scopes: ["admin"], exp: now + 300 },
    SECRET
  );
  const critRes = await http("GET", "/admin", { headers: { authorization: `Bearer ${critTok}` } });
  record({
    category: cat,
    title: "JWT crit header rejected despite valid signature (RFC 7515 §4.1.11)",
    severity: "high",
    attack: 'GET /admin with validly-signed {crit:["exp"], exp} token',
    observed:
      `status ${critRes.status}` + (critRes.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
    verdict:
      critRes.status >= 400 && !critRes.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
  });

  const centuryTok = signHs256(
    { alg: "HS256", typ: "JWT" },
    { sub: "alice", scopes: ["admin"], iat: now, exp: now + 100 * 365 * 24 * 3600 },
    SECRET
  );
  const centRes = await http("GET", "/admin", {
    headers: { authorization: `Bearer ${centuryTok}` },
  });
  record({
    category: cat,
    title: "JWT 100-year lifetime rejected by verifier maxLifetimeSeconds",
    severity: "high",
    attack: "GET /admin with validly-signed token, exp-iat = 100 years",
    observed:
      `status ${centRes.status}` + (centRes.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
    verdict:
      centRes.status >= 400 && !centRes.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
  });

  let flood = "GET /healthz HTTP/1.1\r\nHost: t\r\n";
  for (let i = 0; i < 250; i++) flood += `X-Flood-${i}: v\r\n`;
  flood += "\r\n";
  const floodRes = await rawSend(port, flood);
  record({
    category: cat,
    title: "Header-count flood refused 431 (no silent llhttp truncation)",
    severity: "medium",
    attack: "Raw GET with 251 header fields (parser cap is 100)",
    observed: floodRes.statusLine || "(dropped)",
    verdict: floodRes.status === 431 ? "DEFENDED" : "VULNERABLE",
  });

  // Post-upgrade WS frame discipline: a client frame without the RFC 6455
  // mask bit must get the connection killed, not processed.
  const wsClosed = await new Promise<boolean>((resolve) => {
    const sock = net.connect(port, HOST);
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 3_000);
    sock.on("connect", () =>
      sock.write(
        "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n" +
          `Origin: http://127.0.0.1:${port}\r\n\r\n`
      )
    );
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      if (buf.includes("\r\n\r\n") && buf.startsWith("HTTP/1.1 101")) {
        // unmasked text frame: FIN|opcode=1, MASK=0, len=2, "hi"
        sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
      }
    });
    sock.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  record({
    category: cat,
    title: "Unmasked client WebSocket frame -> connection killed",
    severity: "medium",
    attack: "WS upgrade then a text frame with MASK=0",
    observed: wsClosed ? "server closed the connection" : "connection stayed open",
    verdict: wsClosed ? "DEFENDED" : "VULNERABLE",
  });
}

async function main() {
  const targetPath = new URL("target.ts", import.meta.url).pathname;
  const target = spawn("node", ["--import", "tsx", targetPath], {
    stdio: ["inherit", "pipe", "inherit"],
    cwd: process.cwd(),
  });

  let portA = 0;
  let portB = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("target did not announce ready in 15s")),
      15_000
    );
    target.stdout!.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      const m = /RED_TEAM_TARGET_READY (\d+) (\d+)/.exec(line);
      if (m) {
        portA = Number(m[1]);
        portB = Number(m[2]);
        clearTimeout(timer);
        resolve();
      }
    });
    target.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    target.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`target exited ${code}`));
    });
  });

  BASE = `http://${HOST}:${portA}`;
  BASE_B = `http://${HOST}:${portB}`;
  console.log(`\n[TARGET] App A on ${portA}, App B on ${portB}\n`);

  // Run all documented campaigns
  await reconAndFingerprint();
  await authAndJwt();
  await injection();
  await ssrfAndRedirect();
  await dataExposureAndMassAssignment();
  await corsAbuse();
  await wireLevel(portA);
  await websocketHijack(portA);
  await protocolAndParsing(portA);
  await statefulMiddleware();
  await accessControlFeeds();
  await exceptPathConfusion();

  // Run UNDOCUMENTED / orthodox out-of-the-box attacks
  await undocumentedAttacks(portA, portB);

  // Run v1.1.0 regression probes
  await v101HardeningProbes(portA);

  // Report
  const vulnerable = findings.filter((f) => f.verdict === "VULNERABLE");
  const defended = findings.filter((f) => f.verdict === "DEFENDED");
  const info = findings.filter((f) => f.verdict === "INFO");

  console.log("\n" + "=".repeat(80));
  console.log("RED-TEAM LIVE PENTEST REPORT");
  console.log("=".repeat(80));
  console.log(`Total probes:  ${findings.length}`);
  console.log(`DEFENDED:      ${defended.length}`);
  console.log(`VULNERABLE:    ${vulnerable.length}`);
  console.log(`INFO:          ${info.length}`);
  console.log("-".repeat(80));

  if (vulnerable.length > 0) {
    console.log("\n⚠️  VULNERABLE FINDINGS:\n");
    for (const f of vulnerable) {
      console.log(`[${f.severity.toUpperCase()}] ${f.category} — ${f.title}`);
      console.log(`    Attack:   ${f.attack}`);
      console.log(`    Observed: ${f.observed}`);
      console.log("");
    }
  }

  const criticalHigh = findings.filter(
    (f) => (f.severity === "critical" || f.severity === "high") && f.verdict === "VULNERABLE"
  );
  console.log("\n" + "=".repeat(80));
  console.log(`Critical/High vulns: ${criticalHigh.length}`);
  console.log("=".repeat(80) + "\n");

  // Cleanup
  target.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  try {
    target.kill("SIGKILL");
  } catch {}

  process.exit(vulnerable.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
