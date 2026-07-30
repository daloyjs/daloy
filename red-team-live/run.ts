/**
 * RED-TEAM LIVE ATTACKER — black-box engagement against a running daloyjs app.
 * ===========================================================================
 *
 * This is the "bad actor". It does NOT import the App. It spawns `target.ts`
 * as a SEPARATE process, waits for it to listen on a real TCP port, and then
 * attacks it the way a paid bounty hunter would:
 *
 *   - `fetch()` over the wire for application-layer attacks (auth bypass, JWT
 *     forgery, injection, SSRF, open redirect, data exposure, CORS, brute
 *     force).
 *   - raw `net` sockets for wire-level attacks the framework's in-memory
 *     dispatch can NEVER see: HTTP request smuggling, header-count floods,
 *     oversized-body framing, slowloris, and CRLF response splitting.
 *
 * Because the target runs in its own process, a successful crash shows up as
 * connection-refused — a real DoS FINDING — instead of killing the harness.
 *
 * Run it:  pnpm red-team:live      (or: node --import tsx red-team-live/run.ts)
 * Exit code is non-zero if any VULNERABLE finding is recorded.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { gzipSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
type Verdict = "DEFENDED" | "VULNERABLE" | "INFO";
interface Finding {
  category: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  attack: string; // what we sent
  observed: string; // what the server did
  verdict: Verdict;
}
const findings: Finding[] = [];
const record = (f: Finding) => findings.push(f);

let BASE = "";
let BASE_B = ""; // second app: global except()-based auth

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

/** Send raw bytes over a TCP socket and collect the response (latin1, framing-preserving). */
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

/** Open a connection, dribble a partial request, and report whether the server cut us off. */
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
      } catch {
        /* ignore */
      }
      resolve({ closedByServer, afterMs: Date.now() - t0 });
    };
    sock.on("connect", () => {
      // Send headers one trickle at a time and NEVER send the terminating blank line.
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
    sock.on("close", () => done(true)); // server hung up on us → defended
    sock.on("error", () => done(true));
    // If WE reach holdMs first and the socket is still open, the server tolerated the stall.
    setTimeout(() => done(false), holdMs);
  });
}

/** Perform a raw WebSocket upgrade handshake with an optional (spoofable) Origin. */
function wsHandshake(
  port: number,
  origin?: string
): Promise<{ status: number; statusLine: string }> {
  const lines = [
    "GET /ws HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==", // base64 of a 16-byte key
    "Sec-WebSocket-Version: 13",
  ];
  if (origin) lines.push(`Origin: ${origin}`);
  return rawSend(port, lines.join("\r\n") + "\r\n\r\n", 1500).then((r) => ({
    status: r.status,
    statusLine: r.statusLine,
  }));
}

// A forged JWT with an attacker-chosen header/payload (signature is irrelevant for alg attacks).
const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const forgeJwt = (header: object, payload: object, sig = "AAAA") =>
  `${seg(header)}.${seg(payload)}.${sig}`;

// ---------------------------------------------------------------------------
// Campaigns
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
    attack: "GET /admin with HS256 token signed by an attacker-guessed key",
    observed:
      `status ${fakeRes.status}` + (fakeRes.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : ""),
    verdict:
      fakeRes.status >= 400 && !fakeRes.text.includes("TOP-SECRET") ? "DEFENDED" : "VULNERABLE",
  });

  // Log in legitimately, then try to reach /admin with a user-scoped token.
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
  const escalate = userToken
    ? await http("GET", "/admin", { headers: { authorization: `Bearer ${userToken}` } })
    : null;
  record({
    category: cat,
    title: "Horizontal→vertical privilege escalation (user token → admin)",
    severity: "high",
    attack: "POST /login as alice (scopes:[user]) then GET /admin with that token",
    observed: escalate
      ? `login ${login.status}, /admin ${escalate.status}` +
        (escalate.text.includes("TOP-SECRET") ? " — SECRET LEAKED" : "")
      : "login failed",
    verdict:
      escalate && escalate.status === 403 && !escalate.text.includes("TOP-SECRET")
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // Brute force the login.
  const codes: number[] = [];
  for (let i = 0; i < 9; i++) {
    const r = await http("POST", "/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "alice", pass: `guess-${i}` }),
    });
    codes.push(r.status);
  }
  const throttled = codes.includes(429);
  record({
    category: cat,
    title: "Unthrottled credential brute force",
    severity: "high",
    attack: "POST /login x9 with wrong passwords",
    observed: `status sequence ${codes.join(",")}`,
    verdict: throttled ? "DEFENDED" : "VULNERABLE",
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
  // Double-encoded + comment-split evasions must also block (bounded multi-decode).
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
  // NoSQL operator injection in a JSON body.
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

  // The real amplification bound is the 16 KiB header BYTE cap, not the count.
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
  // Count-only flood (many tiny headers): Node drops headers past
  // maxHeadersCount silently rather than emitting 431 — bounded, not an
  // amplification vector, so this is informational, not a finding.
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
    observed: `response: ${countRes.statusLine || "(dropped)"} — Node truncates extras silently; total bytes still bounded by the 16 KiB cap`,
    verdict: "INFO",
  });

  // A `User-Agent` is required for this probe to measure what it claims to.
  // `botGuard()` blocks an empty UA by default and now enforces from `preBody`,
  // i.e. BEFORE body I/O, so a UA-less raw POST is rejected with 403 at header
  // time and the body limit is never reached. Sending a plausible UA lets the
  // request through the perimeter so the `bodyLimitBytes` path is the thing
  // actually under test.
  const bigBody = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nUser-Agent: Mozilla/5.0\r\n" +
      "Content-Type: application/json\r\nContent-Length: 1073741824\r\n\r\n{}",
    1500
  );
  record({
    category: cat,
    title: "Oversized-body resource exhaustion",
    severity: "high",
    attack: "Raw POST advertising a 1 GiB Content-Length (with a UA, so botGuard passes)",
    observed: `response: ${bigBody.statusLine || "(connection dropped)"}`,
    verdict:
      bigBody.status === 413 || bigBody.status === 400 || bigBody.status === 0
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // The same oversized request WITHOUT a UA: the perimeter gate refuses before
  // the advertised gigabyte is read at all. Cheaper than reaching the body
  // limit, and worth asserting so the ordering does not silently regress.
  const bigBodyNoUa = await rawSend(
    port,
    "POST /items HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\n" +
      "Content-Length: 1073741824\r\n\r\n{}",
    1500
  );
  record({
    category: cat,
    title: "Oversized body is refused at the perimeter before body I/O",
    severity: "medium",
    attack: "Raw POST advertising a 1 GiB Content-Length and no User-Agent",
    observed: `response: ${bigBodyNoUa.statusLine || "(connection dropped)"} — botGuard rejects in preBody, before the body is read`,
    verdict:
      bigBodyNoUa.status === 403 ||
      bigBodyNoUa.status === 413 ||
      bigBodyNoUa.status === 400 ||
      bigBodyNoUa.status === 0
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

  // CRLF response splitting via a reflected response header.
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
    attack: "GET /echo-header?v=safe%0d%0aSet-Cookie:admin=1 (reflected into x-echo)",
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
  const same = await wsHandshake(port, `http://127.0.0.1:${port}`);
  record({
    category: cat,
    title: "Same-origin WebSocket handshake is still accepted (no false-deny)",
    severity: "info",
    attack: `Raw WS upgrade to /ws with a same-origin Origin`,
    observed: `handshake: ${same.statusLine || "(connection dropped)"}`,
    verdict: same.status === 101 ? "DEFENDED" : "INFO",
  });
}

async function multipartAbuse() {
  const cat = "Multipart upload abuse";
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const upload = async (bytes: number[], type: string, name: string) => {
    const fd = new FormData();
    fd.append("avatar", new File([new Uint8Array(bytes)], name, { type }));
    const res = await fetch(BASE + "/upload", { method: "POST", body: fd });
    return { status: res.status };
  };

  // 1) Content-sniffing bypass: a non-PNG file masquerading as image/png.
  const fake = await upload([0x42, 0x4d, 1, 2, 3, 4], "image/png", "fake.png");
  record({
    category: cat,
    title: "Polyglot / disguised file (BMP bytes claiming image/png)",
    severity: "high",
    attack: "POST /upload with declared image/png but BMP magic bytes",
    observed: `status ${fake.status}`,
    verdict: fake.status === 422 || fake.status === 415 ? "DEFENDED" : "VULNERABLE",
  });

  // 2) Oversized upload (valid PNG magic but past the 64-byte cap).
  const big = await upload([...PNG_SIG, ...new Array(120).fill(0)], "image/png", "big.png");
  record({
    category: cat,
    title: "Oversized upload (resource exhaustion)",
    severity: "high",
    attack: "POST /upload with a ~128-byte file (cap is 64)",
    observed: `status ${big.status}`,
    verdict: big.status === 413 ? "DEFENDED" : "VULNERABLE",
  });

  // 3) Control: a small, genuine PNG is accepted (the guard is not always-deny).
  const ok = await upload([...PNG_SIG, 0, 0, 0, 13], "image/png", "ok.png");
  record({
    category: cat,
    title: "A legitimate small PNG is accepted (no false-positive)",
    severity: "info",
    attack: "POST /upload with a valid 12-byte PNG",
    observed: `status ${ok.status}`,
    verdict: ok.status === 201 ? "DEFENDED" : "INFO",
  });
}

async function rapidResetAndChurn(port: number) {
  const cat = "DoS resilience (HTTP/2 rapid-reset class)";
  // The Node adapter speaks HTTP/1.1 only, so the HTTP/2 stream-multiplexing
  // rapid-reset vector (CVE-2023-44487) has no surface here. Confirm h2 is not
  // negotiated by sending the HTTP/2 connection preface.
  const h2 = await rawSend(port, "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", 800);
  record({
    category: cat,
    title: "HTTP/2 prior-knowledge negotiation",
    severity: "info",
    attack: "Send the HTTP/2 connection preface (PRI * HTTP/2.0 …)",
    observed: `${h2.statusLine || "(connection dropped, no h2 upgrade)"} — adapter is HTTP/1.1 only; rapid-reset (CVE-2023-44487) is out of surface`,
    verdict: "INFO",
  });
  // HTTP/1.1 analog: flood the accept queue with connect-then-RST sockets.
  await Promise.all(
    Array.from(
      { length: 150 },
      () =>
        new Promise<void>((res) => {
          const s = net.connect(port, HOST);
          const close = () => {
            try {
              s.destroy();
            } catch {
              /* ignore */
            }
            res();
          };
          s.on("connect", () => {
            try {
              s.write("GET /healthz HTTP/1.1\r\n");
            } catch {
              /* ignore */
            }
            close();
          });
          s.on("error", close);
          setTimeout(close, 500);
        })
    )
  );
  let alive = false;
  try {
    alive = (await http("GET", "/healthz")).status === 200;
  } catch {
    alive = false;
  }
  record({
    category: cat,
    title: "Rapid connect/reset flood (150 sockets)",
    severity: "high",
    attack: "Open 150 sockets, send a partial request, reset immediately",
    observed: alive ? "server healthy after the flood" : "TARGET DOWN — connection refused",
    verdict: alive ? "DEFENDED" : "VULNERABLE",
  });
}

async function protocolAndParsing(port: number) {
  const cat = "Protocol / parsing abuse";

  // TRACE (Cross-Site Tracing) over a raw socket — must not echo the request.
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

  // Method-override smuggling — GET must not become DELETE.
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

  // HTTP Parameter Pollution — duplicate query smuggling past a string schema.
  const hpp = await http("GET", "/search?q=safe&q=' OR 1=1");
  record({
    category: cat,
    title: "HTTP Parameter Pollution (duplicate query keys)",
    severity: "medium",
    attack: "GET /search?q=safe&q=' OR 1=1",
    observed: `status ${hpp.status}`,
    verdict: hpp.status === 422 || hpp.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  // Content-type confusion — a JSON route must reject text/plain.
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

  // Stack-bomb JSON — deep nesting must fail fast, not crash.
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

  // Hash-flood — a very wide object must parse in bounded time.
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

  // Request-id entropy — many live ids must be unique, unguessable UUIDs.
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

  // Clickjacking / HSTS posture on a live response.
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

  // CSRF double-submit.
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

  // Decompression bomb.
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

  // Idempotency: replay + cross-tenant isolation.
  const pay = (key: string, auth: string, amount = 10) =>
    http("POST", "/pay", {
      headers: { "content-type": "application/json", "idempotency-key": key, authorization: auth },
      body: JSON.stringify({ amount }),
    });
  const a1 = await pay("k1", "Bearer USER_A");
  const replay = await pay("k1", "Bearer USER_A");
  const reuse = await pay("k1", "Bearer USER_A", 999); // same key, different body
  const crossTenant = await pay("k1", "Bearer USER_B"); // A's key, B's identity
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

  // Concurrency limit — overflow is shed with 503.
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

  // autoBan: three 401s from one IP trip a ban on an otherwise-valid route.
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

  // basic-auth account enumeration: unknown user vs known-user-wrong-password.
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
    attack: "Compare 401s for an unknown user vs a known user with a wrong password",
    observed: `unknown=${unknown.status}, wrong-pass=${wrongPass.status}, identical=${unknown.text === wrongPass.text}, good=${good.status}`,
    verdict:
      unknown.status === 401 &&
      wrongPass.status === 401 &&
      unknown.text === wrongPass.text &&
      good.status === 200
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // mTLS: a spoofed client-cert header must be ignored when not configured.
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
    attack: "GET /public/../api/admin (and encoded variants) to collapse past the guard",
    observed: bypassed
      ? "a traversal reached the protected handler!"
      : "every traversal stayed blocked",
    verdict: bypassed ? "VULNERABLE" : "DEFENDED",
  });
}

/**
 * Novel attack battery — vectors beyond the original 68-probe suite, added
 * after a manual off-script engagement (see
 * `.deepsec/data/daloy/reports/red-team-live-2026-07-29.md`). Covers:
 * except() case/double-encoding/semicolon/fullwidth/overlong-UTF-8 confusion,
 * HEAD-method and duplicate-Authorization bypass attempts, JWT kid/jku/x5u/
 * crit/zip header abuse + alg confusion, open-redirect parser differentials,
 * SSRF IP-literal differentials, one-sided CSRF tokens, WAF evasion encodings,
 * production error redaction, CSWSH origin variants, Expect:100-continue
 * timing (the F1 regression), chunk-framing abuse, and XFF chain parsing.
 */
async function novelProbes(port: number, portB: number) {
  // ---- except() path-confusion, extended ----
  {
    const cat = "Auth path-confusion (except)";
    const at = (path: string, method = "GET") =>
      fetch(BASE_B + path, { method, redirect: "manual" }).then(async (r) => ({
        status: r.status,
        body: await r.text().catch(() => ""),
      }));
    const variants: Array<[string, string, string]> = [
      ["case-swap on protected route", "/API/ADMIN", "GET /API/ADMIN (no token)"],
      ["mixed-case traversal", "/Public/../api/admin", "GET /Public/../api/admin"],
      ["double-encoded dots", "/public/%252e%252e/api/admin", "GET /public/%252e%252e/api/admin"],
      ["encoded slash traversal", "/public/..%2fapi%2fadmin", "GET /public/..%2fapi%2fadmin"],
      ["semicolon path param", "/public/;/../api/admin", "GET /public/;/../api/admin"],
      ["semicolon suffix on target", "/api/admin;.json", "GET /api/admin;.json"],
      ["encoded trailing slash", "/api/admin%2f", "GET /api/admin%2f"],
      ["trailing dot", "/api/admin.", "GET /api/admin."],
      ["double leading slash", "//api/admin", "GET //api/admin"],
      [
        "fullwidth solidus traversal",
        "/public/%ef%bc%8f..%ef%bc%8fapi%2fadmin",
        "GET /public/<U+FF0F>..<U+FF0F>api/admin",
      ],
      ["percent-encoded 'a'", "/api/%61dmin", "GET /api/%61dmin"],
    ];
    for (const [name, path, attack] of variants) {
      const r = await at(path);
      const leaked = r.status === 200 && r.body.includes('"ok":true');
      record({
        category: cat,
        title: `except() bypass — ${name}`,
        severity: "critical",
        attack,
        observed: `status ${r.status}`,
        verdict: leaked ? "VULNERABLE" : "DEFENDED",
      });
    }
    const head = await at("/api/admin", "HEAD");
    record({
      category: cat,
      title: "except() bypass — HEAD method on protected route",
      severity: "high",
      attack: "HEAD /api/admin (no token)",
      observed: `status ${head.status}`,
      verdict: head.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
    // Node joins duplicate Authorization headers with a comma; the guard must
    // not let a valid token in one slot smuggle the other past validation.
    const dupAuth = await rawSend(
      portB,
      `GET /api/admin HTTP/1.1\r\nHost: ${HOST}:${portB}\r\nAuthorization: Bearer good\r\nAuthorization: Bearer evil\r\nConnection: close\r\n\r\n`
    );
    record({
      category: cat,
      title: "Duplicate Authorization headers",
      severity: "high",
      attack: "Two Authorization headers ('Bearer good' + 'Bearer evil')",
      observed: `status ${dupAuth.status}`,
      verdict: dupAuth.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
    // Overlong UTF-8 slash (%c0%af) — rejected by spec-compliant decoders, but
    // a classic parser-differential bypass; send raw so fetch can't normalize it.
    const overlong = await rawSend(
      portB,
      `GET /public/%c0%af..%c0%afapi%c0%afadmin HTTP/1.1\r\nHost: ${HOST}:${portB}\r\nConnection: close\r\n\r\n`
    );
    record({
      category: cat,
      title: "Overlong UTF-8 encoded slash (raw)",
      severity: "high",
      attack: "GET /public/%c0%af..%c0%afapi%c0%afadmin",
      observed: `status ${overlong.status}`,
      verdict: overlong.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- JWT header abuse ----
  {
    const cat = "Authentication / Authorization";
    const payload = { sub: "mallory", scopes: ["admin"], exp: Math.floor(Date.now() / 1000) + 600 };
    const cases: Array<[string, object, string, "critical" | "high" | "medium"]> = [
      [
        "alg confusion (RS256 claim vs HS256-only verifier)",
        { alg: "RS256", typ: "JWT" },
        "token claiming RS256",
        "high",
      ],
      [
        "kid path injection",
        { alg: "HS256", kid: "../../../../dev/null" },
        "kid: ../../../../dev/null — verifier must ignore embedded key pointers",
        "high",
      ],
      [
        "jku URL injection (SSRF via key fetch)",
        { alg: "HS256", jku: "http://169.254.169.254/jwks.json" },
        "jku header pointing at cloud metadata — verifier must never fetch it",
        "critical",
      ],
      [
        "x5u certificate injection",
        { alg: "HS256", x5u: "http://evil.example/cert.pem" },
        "x5u header pointing at an attacker cert URL",
        "high",
      ],
      [
        "crit extension header",
        { alg: "HS256", crit: ["exp"] },
        "RFC 7515 crit extension — must reject if unsupported",
        "medium",
      ],
      [
        "zip (compressed-JWT bomb)",
        { alg: "HS256", zip: "DEF" },
        "zip:DEF header — verifier must not attempt decompression",
        "medium",
      ],
    ];
    for (const [name, header, attack, sev] of cases) {
      const tok = forgeJwt(header, payload);
      const r = await http("GET", "/admin", { headers: { authorization: `Bearer ${tok}` } });
      const leaked = r.text.includes("TOP-SECRET");
      record({
        category: cat,
        title: `JWT — ${name}`,
        severity: sev,
        attack,
        observed: `status ${r.status}${leaked ? " — SECRET LEAKED" : ""}`,
        verdict: r.status >= 400 && !leaked ? "DEFENDED" : "VULNERABLE",
      });
    }
    // Oversized token: send over a raw socket — undici EPIPEs when the server
    // (correctly) closes the connection at its 16 KiB header cap mid-write.
    const bigTok = forgeJwt({ alg: "HS256", pad: "A".repeat(1_000_000) }, payload);
    const bigRes = await rawSend(
      port,
      `GET /admin HTTP/1.1\r\nHost: ${HOST}:${port}\r\nAuthorization: Bearer ${bigTok}\r\nConnection: close\r\n\r\n`
    );
    record({
      category: cat,
      title: "JWT — oversized token (1 MB header segment)",
      severity: "medium",
      attack: "Bearer token with a 1 MB header segment (parser DoS probe, raw socket)",
      observed:
        `status ${bigRes.status}` +
        (bigRes.status === 0 ? " (connection dropped — header-cap refusal mid-write)" : ""),
      // A 431 is the clean refusal; status 0 means the socket was dropped
      // while the server rejected at its header-size cap (also a refusal —
      // the post-engagement liveness probe proves the process survived).
      verdict: bigRes.status >= 400 || bigRes.status === 0 ? "DEFENDED" : "VULNERABLE",
    });
  }

  // ---- Open-redirect parser differentials ----
  {
    const cat = "SSRF / Open Redirect";
    const targetHost = new URL(BASE).host;
    // The target's safeRedirect allowlist: same-origin plus app.example.com.
    // A redirect only "escapes" if it lands on a host outside BOTH.
    const allowlistedHosts = new Set([targetHost, "app.example.com"]);
    const escapesOrigin = (status: number, loc: string): boolean => {
      if (status !== 303) return false;
      if (/^(javascript|data|vbscript|file):/i.test(loc)) return true;
      try {
        return !allowlistedHosts.has(new URL(loc, BASE).host);
      } catch {
        return false; // unparseable Location is not a working redirect
      }
    };
    const targets: Array<[string, string]> = [
      ["mixed slash-backslash", "/\\/evil.example"],
      ["encoded backslash pair", "/%5c%5cevil.example"],
      ["quad slash", "////evil.example"],
      ["lookalike subdomain", "https://app.example.com.evil.example/"],
      ["userinfo trick", "https://app.example.com@evil.example/"],
      ["encoded userinfo", "https://app.example.com%40evil.example/"],
      ["backslash after host", "https://app.example.com\\.evil.example/"],
      ["ideographic full stop (U+3002)", "https://app.example.com%E3%80%82evil.example/"],
      ["scheme smuggling", "https:\\evil.example"],
      ["data: scheme", "data:text/html,<script>alert(1)</script>"],
      // F2 regression: encoded C0 controls must now be refused outright
      // (before the fix these were 303 with the encoded tab written verbatim).
      ["encoded tab (F2 regression)", "/%09/evil.example"],
      ["encoded LF + protocol-relative (F2 regression)", "/%0a//evil.example"],
    ];
    for (const [name, t] of targets) {
      const r = await http("GET", `/go?to=${encodeURIComponent(t)}`);
      const loc = r.headers.get("location") ?? "";
      record({
        category: cat,
        title: `Open redirect — ${name}`,
        severity: "high",
        attack: `GET /go?to=${t}`,
        observed: `status ${r.status}${loc ? `, Location: ${loc.slice(0, 70)}` : ""}`,
        verdict: escapesOrigin(r.status, loc) ? "VULNERABLE" : "DEFENDED",
      });
    }
  }

  // ---- SSRF IP-literal differentials ----
  {
    const cat = "SSRF / Open Redirect";
    const literals: Array<[string, string]> = [
      ["decimal IPv4 (2130706433 = 127.0.0.1)", "http://2130706433/"],
      ["hex IPv4 (0x7f000001)", "http://0x7f000001/"],
      ["octal IPv4 (0177.0.0.1)", "http://0177.0.0.1/"],
      ["short-form (127.1)", "http://127.1/"],
      ["zero host (0 = 0.0.0.0)", "http://0/"],
      ["IPv6 loopback", "http://[::1]/"],
      ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/"],
      ["trailing-dot localhost", "http://localhost./"],
      ["userinfo-masked loopback", "http://attacker@127.0.0.1/"],
    ];
    for (const [name, u] of literals) {
      const r = await http("GET", `/fetch?url=${encodeURIComponent(u)}`);
      record({
        category: cat,
        title: `SSRF — ${name}`,
        severity: "critical",
        attack: `GET /fetch?url=${u}`,
        observed: `status ${r.status}`,
        verdict: r.status === 403 ? "DEFENDED" : "VULNERABLE",
      });
    }
  }

  // ---- CSRF double-submit edges ----
  {
    const cat = "Stateful middleware";
    const cookieOnly = await fetch(`${BASE}/csrf-act`, {
      method: "POST",
      headers: { cookie: "csrf=tok" },
    });
    record({
      category: cat,
      title: "CSRF — cookie present, header missing",
      severity: "high",
      attack: "POST /csrf-act with the csrf cookie but no x-csrf-token header",
      observed: `status ${cookieOnly.status}`,
      verdict: cookieOnly.status === 403 ? "DEFENDED" : "VULNERABLE",
    });
    const headerOnly = await fetch(`${BASE}/csrf-act`, {
      method: "POST",
      headers: { "x-csrf-token": "tok" },
    });
    record({
      category: cat,
      title: "CSRF — header present, cookie missing",
      severity: "high",
      attack: "POST /csrf-act with x-csrf-token but no cookie",
      observed: `status ${headerOnly.status}`,
      verdict: headerOnly.status === 403 ? "DEFENDED" : "VULNERABLE",
    });
  }

  // ---- WAF evasion encodings (signature-coverage documentation) ----
  {
    const cat = "Injection (WSTG-INPV)";
    // Fullwidth-Unicode SQLi is a real signature-bypass class that was closed
    // by NFKC inspection variants (see src/waf.ts inspectionVariants). It is
    // asserted DEFENDED (403), not INFO. Inline-comment keyword splitting and
    // template-injection strings still pass the signature set by design —
    // they have no executable sink on /search and are recorded as coverage.
    const probes: Array<[string, string, "INFO" | "DEFENDED"]> = [
      ["inline-comment SQLi", "un/**/ion sel/**/ect user,pass", "INFO"],
      ["mixed-case SQLi", "uNiOn SeLeCt * fRoM users", "DEFENDED"],
      ["fullwidth-Unicode SQLi", "ｕｎｉｏｎ ｓｅｌｅｃｔ", "DEFENDED"],
      ["template-injection strings", "{{7*7}}${7*7}#{7*7}", "INFO"],
      // Composed evasions. Each half is blocked on its own — the fullwidth
      // tautology by the NFKC fold, the NUL/comment split by the control-char
      // and comment passes — but the fold was applied only to the decode chain
      // and its output never re-entered the other passes, so combining two
      // individually-blocked techniques walked straight through. Every
      // combination must converge on the same ASCII form the signatures anchor
      // on, so these are DEFENDED, not coverage notes.
      // Real NUL / `+` code points, not the literal text "%00" / "%2B": the
      // probe loop percent-encodes `q` on the way out, so a literal `%` would
      // arrive double-encoded and the probe would silently test a different
      // payload than its title claims.
      [
        "fullwidth SQLi split by NUL",
        "\uff07\u0000\uff2f\uff32\u0000\uff07\uff11\uff07\uff1d\uff07\uff11",
        "DEFENDED",
      ],
      ["fullwidth SQLi split by comment", "＇/**/ＯＲ/**/＇１＇＝＇１", "DEFENDED"],
      ["fullwidth SQLi split by plus", "＇+ＯＲ+＇１＇＝＇１", "DEFENDED"],
      // NFKC *creates* the comment delimiters here (fullwidth solidus and
      // asterisk fold to `/` and `*`), so the fold must run before the comment
      // pass, not merely alongside it.
      ["fullwidth comment delimiters", "ｕｎｉｏｎ／＊ｘ＊／ｓｅｌｅｃｔ a", "DEFENDED"],
      [
        "mixed ASCII/fullwidth across a NUL",
        "union\u0000\uff53\uff45\uff4c\uff45\uff43\uff54\u0000a",
        "DEFENDED",
      ],
    ];
    for (const [name, q, expected] of probes) {
      const r = await http("GET", `/search?q=${encodeURIComponent(q)}`);
      const blocked = r.status === 403;
      record({
        category: cat,
        title: `WAF signature coverage — ${name}`,
        severity: "medium",
        attack: `GET /search?q=${q}`,
        observed:
          `status ${r.status}` +
          (blocked
            ? " (blocked)"
            : " (passed the signature WAF — /search has no SQL/template sink, so this documents WAF coverage, not an exploit)"),
        verdict: expected === "DEFENDED" ? (blocked ? "DEFENDED" : "VULNERABLE") : "INFO",
      });
    }
  }

  // ---- Production error redaction ----
  {
    const cat = "Data Exposure / Mass Assignment";
    const stackRe = /at\s+\S+\s+\(|node:internal|\.ts:\d+/i;
    const bad = await http("POST", "/items", {
      headers: { "content-type": "application/json" },
      body: '{"name":',
    });
    record({
      category: cat,
      title: "Malformed JSON — stack leakage in 400",
      severity: "medium",
      attack: "POST /items with broken JSON; inspect the 400 body",
      observed: `status ${bad.status}, body ${bad.text.length}B${stackRe.test(bad.text) ? " LEAKS STACK" : ""}`,
      verdict: stackRe.test(bad.text) ? "VULNERABLE" : "DEFENDED",
    });
    const nf = await http("GET", "/no-such-route-xyz");
    record({
      category: cat,
      title: "404 shape — stack/framework leakage",
      severity: "low",
      attack: "GET /no-such-route-xyz in production mode",
      observed: `status ${nf.status}, body: ${nf.text.slice(0, 90)}`,
      verdict: stackRe.test(nf.text) ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- CSWSH origin variants ----
  {
    const cat = "WebSocket (CSWSH)";
    const subdomain = await wsHandshake(port, "https://app.example.com.evil.example");
    record({
      category: cat,
      title: "CSWSH — lookalike subdomain origin",
      severity: "high",
      attack: "WS upgrade with Origin: https://app.example.com.evil.example",
      observed: `handshake: ${subdomain.statusLine || "(connection dropped)"}`,
      verdict: subdomain.status !== 101 ? "DEFENDED" : "VULNERABLE",
    });
    const nullOrigin = await wsHandshake(port, "null");
    record({
      category: cat,
      title: "CSWSH — null origin",
      severity: "medium",
      attack: "WS upgrade with Origin: null",
      observed: `handshake: ${nullOrigin.statusLine || "(connection dropped)"}`,
      verdict: nullOrigin.status !== 101 ? "DEFENDED" : "VULNERABLE",
    });
    const noOrigin = await wsHandshake(port);
    record({
      category: cat,
      title: "CSWSH — absent Origin header (non-browser client posture)",
      severity: "info",
      attack: "WS upgrade with no Origin header",
      observed:
        `handshake: ${noOrigin.statusLine || "(connection dropped)"}` +
        (noOrigin.status === 101 ? " — accepted by design for non-browser clients" : ""),
      verdict: "INFO",
    });
  }

  // ---- Wire-level: Expect:100-continue timing + chunk abuse ----
  {
    const cat = "Protocol / parsing abuse";
    // Posture probe, deliberately INFO rather than a pass/fail assertion.
    //
    // Node answers `100 Continue` for any request that asks, including one
    // whose declared Content-Length exceeds `bodyLimitBytes`, so a hostile
    // client can hold sockets open awaiting a body that may be refused later.
    // A `checkContinue` listener that refuses at header time was tried and
    // reverted: `bodyLimitBytes` is enforced when the body is *parsed*, so a
    // route with no request body schema never enforces it, and rejecting early
    // made an `Expect` header change the outcome of an otherwise identical
    // request (curl, which sends `Expect` for large bodies, got 413 where
    // fetch got 200). Closing this properly needs a uniform transport-level
    // cap applied with or without `Expect` and emitted through the error
    // pipeline so it carries secureHeaders and a request id. Tracked as
    // post-1.0 work; this probe records the current posture.
    const expect100 = await rawSend(
      port,
      `POST /sink HTTP/1.1\r\nHost: ${HOST}:${port}\r\nContent-Type: application/json\r\nContent-Length: 99999999\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n`
    );
    record({
      category: cat,
      title: "Expect: 100-continue with oversized declared body",
      severity: "info",
      attack: "POST /sink, Content-Length: 99999999, Expect: 100-continue",
      observed:
        `first status line: ${expect100.statusLine || "(none)"}` +
        " — body limit is enforced at parse time, not at header time",
      verdict: "INFO",
    });
    const chunkExt = await rawSend(
      port,
      `POST /sink HTTP/1.1\r\nHost: ${HOST}:${port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5;evil=1\r\n{}\r\n\r\n0\r\n\r\n`
    );
    record({
      category: cat,
      title: "Chunk-extension smuggling",
      severity: "medium",
      attack: "Chunked body with a '5;evil=1' chunk-size line",
      observed: `status ${chunkExt.status}`,
      verdict: "INFO",
    });
    const giantChunk = await rawSend(
      port,
      `POST /sink HTTP/1.1\r\nHost: ${HOST}:${port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nFFFFFFFFFFFFFFFF\r\n`,
      3000
    );
    record({
      category: cat,
      title: "Giant chunk size (16 EB declared)",
      severity: "medium",
      attack: "Chunked body declaring chunk size 0xFFFFFFFFFFFFFFFF",
      observed: `status ${giantChunk.status || "(connection dropped)"}`,
      verdict: "INFO",
    });
  }

  // ---- X-Forwarded-For chain parsing posture ----
  {
    const cat = "Access control (bot / geo / ban / mTLS)";
    const innocentFirst = await http("GET", "/healthz", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
    });
    const bannedFirst = await http("GET", "/healthz", {
      headers: { "x-forwarded-for": "203.0.113.7, 1.2.3.4" },
    });
    record({
      category: cat,
      title: "XFF chain parsing — rightmost hop is trusted",
      severity: "medium",
      attack:
        "XFF '1.2.3.4, 203.0.113.7' (innocent first) vs '203.0.113.7, 1.2.3.4' (banned first) — which hop does geoBlock see?",
      observed:
        `innocent-first=${innocentFirst.status} banned-first=${bannedFirst.status} ` +
        "(rightmost = the hop your LB appends, correct under trustProxy; a client with direct " +
        "access to the origin can claim any IP, which is why prod refuses XFF by default)",
      verdict: "INFO",
    });
  }
}

/**
 * Narrow a probe body to a `BodyInit`.
 *
 * `Buffer` / `Uint8Array` default to an `ArrayBufferLike` backing store, which
 * admits `SharedArrayBuffer` and is therefore not assignable to `BodyInit`.
 * Re-wrapping the bytes over a fresh `ArrayBuffer` is a real conversion rather
 * than a cast, so each probe still puts the exact bytes it intends on the wire.
 * The copy is deliberate and affordable — probe bodies here are at most a few
 * hundred KiB.
 */
function toBodyInit(body: string | Uint8Array | undefined): BodyInit | undefined {
  if (body === undefined || typeof body === "string") return body;
  return new Uint8Array(body);
}

/** Build a client→server WS frame (masked by default; supports a forged declared length). */
function wsFrame(
  firstByte: number,
  payload: Buffer,
  opts: { mask?: boolean; declaredLen?: number } = {}
): Buffer {
  const mask = opts.mask !== false;
  const len = opts.declaredLen ?? payload.length;
  const parts: Buffer[] = [Buffer.from([firstByte])];
  const maskBit = mask ? 0x80 : 0x00;
  if (len < 126) parts.push(Buffer.from([maskBit | len]));
  else if (len <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = maskBit | 126;
    b.writeUInt16BE(len, 1);
    parts.push(b);
  } else {
    const b = Buffer.alloc(9);
    b[0] = maskBit | 127;
    b.writeBigUInt64BE(BigInt(len), 1);
    parts.push(b);
  }
  if (mask) {
    const key = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    parts.push(key);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i]! ^= key[i % 4]!;
    parts.push(masked);
  } else {
    parts.push(payload);
  }
  return Buffer.concat(parts);
}

/** Handshake on /ws, fire one or more hostile frames, collect whatever comes back (latin1). */
function wsFrameProbe(port: number, frames: Buffer, waitMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    let hs = "";
    let out = "";
    let upgraded = false;
    let settled = false;
    const fin = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(out);
    };
    // Hard fallback — the socket idle timer alone proved unreliable mid-fragment.
    const hard = setTimeout(fin, waitMs + 2500);
    sock.setTimeout(waitMs);
    sock.on("connect", () =>
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: ${HOST}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n`
      )
    );
    sock.on("data", (d) => {
      const s = d.toString("latin1");
      if (!upgraded) {
        hs += s;
        const end = hs.indexOf("\r\n\r\n");
        if (end !== -1) {
          upgraded = true;
          if (!/^HTTP\/\d\.\d 101/.test(hs)) {
            out = `(handshake rejected: ${hs.split("\r\n")[0]})`;
            return fin();
          }
          out = hs.slice(end + 4);
          sock.write(frames);
        }
      } else {
        out += s;
      }
    });
    sock.on("timeout", fin);
    sock.on("close", fin);
    sock.on("error", fin);
  });
}

/** Extract the close code from a server close frame, if one was sent. */
function wsCloseCode(out: string): string {
  const idx = out.indexOf("\x88");
  if (idx === -1 || idx + 3 >= out.length)
    return out.length ? `(no close frame: ${out.slice(0, 60)})` : "(closed silently)";
  return `close ${out.charCodeAt(idx + 2) * 256 + out.charCodeAt(idx + 3)}`;
}

/**
 * Wave 4 — folded from the standalone wave-4 engagement: race conditions
 * (TOCTOU), CL/TE parser differentials, post-upgrade WebSocket frame attacks,
 * multipart exotica, content-encoding confusion, prototype-pollution
 * persistence, protocol oddities, and trailer smuggling. The invalid-close-code
 * probe doubles as the live regression test for the F3 fix (close-code
 * validation in `decodeClosePayload`, src/websocket.ts).
 */
async function wave4Probes(port: number) {
  // ---- R1. Race conditions (TOCTOU) ---------------------------------------
  {
    const cat = "Race conditions (TOCTOU)";
    const key = `race-${Date.now()}`;
    const rs = await Promise.all(
      Array.from({ length: 12 }, () =>
        http("POST", "/pay", {
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
            authorization: "Bearer racer",
          },
          body: JSON.stringify({ amount: 10 }),
        })
      )
    );
    const calls = new Set(rs.map((r) => /"call":(\d+)/.exec(r.text)?.[1]).filter(Boolean));
    record({
      category: cat,
      title: "Idempotency double-spend race (12 concurrent, one key)",
      severity: "critical",
      attack:
        "12 simultaneous POST /pay with the same Idempotency-Key — a check-then-set gap " +
        "double-charges (the OWASP API4 race-condition class behind real-world payment bugs)",
      observed: `statuses ${rs.map((r) => r.status).join(",")}; distinct handler executions: ${calls.size}`,
      verdict: calls.size > 1 ? "VULNERABLE" : "DEFENDED",
    });

    const rl = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        http("POST", "/login", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user: "alice", pass: `guess-${i}` }),
        }).then((r) => r.status)
      )
    );
    const reached = rl.filter((s) => s !== 429).length;
    record({
      category: cat,
      title: "Rate-limit overrun race (25 concurrent vs max 5/60s)",
      severity: "high",
      attack:
        "25 simultaneous POST /login — a non-atomic check-then-increment would let more than " +
        "5 through (earlier campaigns may have pre-spent part of the window, which can only " +
        "LOWER the count; an overshoot past 5 is impossible to mask)",
      observed: `reached handler (non-429): ${reached}, throttled: ${rl.length - reached}`,
      verdict: reached > 5 ? "VULNERABLE" : "DEFENDED",
    });

    const cc = await Promise.all(
      Array.from({ length: 12 }, () => http("GET", "/slow").then((r) => r.status))
    );
    const admitted = cc.filter((s) => s === 200).length;
    record({
      category: cat,
      title: "Concurrency-limit overshoot race (12 concurrent vs maxConcurrent 1)",
      severity: "high",
      attack:
        "12 simultaneous GET /slow (maxConcurrent: 1, maxQueue: 0) — slot acquire must be atomic",
      observed: `statuses ${cc.join(",")} — ${admitted} admitted`,
      verdict: admitted > 1 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- R2. CL/TE parser differentials (desync) ----------------------------
  {
    const cat = "Request smuggling / framing";
    const r = await rawSend(
      port,
      "POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\nGET /healthz HTTP/1.1\r\nHost: x\r\n\r\n",
      2500
    );
    const sts = [...r.raw.matchAll(/HTTP\/\d\.\d (\d{3})/g)].map((m) => m[1]);
    record({
      category: cat,
      title: "Pipelined request after a CL:0 POST",
      severity: "high",
      attack:
        "POST /sink CL:0 immediately followed by a pipelined GET /healthz in the same segment",
      observed: `statuses: ${sts.join(", ") || "(none)"} — handled as two separate requests, never one smuggled body`,
      verdict: "INFO",
    });

    for (const [name, cl] of [
      ["hex Content-Length", "0x10"],
      ["plus-signed Content-Length", "+5"],
      ["leading-zero Content-Length", "00005"],
      ["decimal Content-Length", "5.0"],
      ["space-padded Content-Length", " 5"],
    ] as const) {
      const rx = await rawSend(
        port,
        `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${cl}\r\n\r\n{}"x"\r\n`,
        2000
      );
      record({
        category: cat,
        title: `Exotic Content-Length — ${name}`,
        severity: "high",
        attack: `POST /sink with Content-Length: ${JSON.stringify(cl)} (llhttp/framework desync probe)`,
        observed: `status: ${rx.status || "(connection dropped)"}`,
        verdict: rx.status >= 200 && rx.status < 300 ? "VULNERABLE" : "DEFENDED",
      });
    }

    const te = await rawSend(
      port,
      "POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n0\r\n\r\n",
      2000
    );
    record({
      category: cat,
      title: "TE: chunked + Content-Length: 0 (classic desync pair)",
      severity: "critical",
      attack: "POST /sink with both Transfer-Encoding: chunked and Content-Length: 0",
      observed: `status: ${te.status || "(connection dropped)"}`,
      verdict: te.status >= 200 && te.status < 300 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- R3. Post-upgrade WebSocket frame attacks ---------------------------
  {
    const cat = "WebSocket frame-layer";
    const wsCases: Array<[string, Finding["severity"], Buffer, string, RegExp]> = [
      [
        "reserved opcode 0x3",
        "high",
        wsFrame(0x83, Buffer.from("x")),
        "frame with reserved non-control opcode 0x3",
        /1002/,
      ],
      [
        "RSV1 bit set (no extension negotiated)",
        "high",
        wsFrame(0xc1, Buffer.from("x")),
        "text frame with RSV1=1",
        /1002/,
      ],
      [
        "fragmented control frame",
        "high",
        wsFrame(0x09, Buffer.from("x")),
        "FIN=0 ping (control frames must be atomic)",
        /1002/,
      ],
      [
        "oversized control payload (126 B)",
        "high",
        wsFrame(0x89, Buffer.alloc(126, 0x41)),
        "ping with a 126-byte payload (max 125)",
        /1002/,
      ],
      [
        "unmasked client frame",
        "high",
        wsFrame(0x81, Buffer.from("hi"), { mask: false }),
        "client frame without the mandatory mask",
        /1002|closed|silence/i,
      ],
      [
        "invalid UTF-8 in a text frame",
        "high",
        wsFrame(0x81, Buffer.from([0xff, 0xfe])),
        "text frame carrying 0xFF 0xFE",
        /1007|1002/,
      ],
      [
        "invalid close code 999 (F3 live regression)",
        "medium",
        wsFrame(0x88, Buffer.from([0x03, 0xe7])),
        "close frame with code 999 — must fail 1002, never echo 999",
        /1002|closed|silence/i,
      ],
      [
        "reserved close code 1005 from the peer",
        "medium",
        wsFrame(0x88, Buffer.from([0x03, 0xed])),
        "close frame with 1005 — reserved for local reporting, illegal on the wire",
        /1002|closed|silence/i,
      ],
      [
        "reserved close code 1006 from the peer",
        "medium",
        wsFrame(0x88, Buffer.from([0x03, 0xee])),
        "close frame with 1006 — reserved for local reporting, illegal on the wire",
        /1002|closed|silence/i,
      ],
      [
        "close code above the private range (5001)",
        "low",
        wsFrame(0x88, Buffer.from([0x13, 0x89])),
        "close frame with 5001 — past the 3000-4999 application range",
        /1002|closed|silence/i,
      ],
    ];
    for (const [name, sev, frame, attack, expect] of wsCases) {
      const out = await wsFrameProbe(port, frame);
      const code = wsCloseCode(out);
      record({
        category: cat,
        title: `WS frame — ${name}`,
        severity: sev,
        attack,
        observed: code,
        verdict: expect.test(code) ? "DEFENDED" : "VULNERABLE",
      });
    }
    {
      // A status-less CLOSE is the most common close there is, and it surfaces
      // internally as the 1005 sentinel — which RFC 6455 §7.4.1 forbids on the
      // wire. The echo path fed that sentinel straight back through the encoder,
      // so the server answered a perfectly benign close with CLOSE(1005): a
      // frame its own decoder now rejects with 1002. Correct behaviour is an
      // empty CLOSE, so this asserts on the payload length, not on a code.
      const out = await wsFrameProbe(port, wsFrame(0x88, Buffer.alloc(0)));
      const idx = out.indexOf("\x88");
      const echoedLen = idx === -1 ? -1 : out.charCodeAt(idx + 1) & 0x7f;
      const echoedCode =
        idx !== -1 && echoedLen >= 2 ? out.charCodeAt(idx + 2) * 256 + out.charCodeAt(idx + 3) : 0;
      record({
        category: cat,
        title: "WS close — status-less CLOSE is echoed without a status code",
        severity: "low",
        attack: "CLOSE frame with an empty payload",
        observed:
          idx === -1
            ? "no close frame echoed (connection dropped)"
            : `echoed close payload length ${echoedLen}${echoedCode ? ` (code ${echoedCode})` : ""}`,
        // Either an empty echo or no echo at all is conforming. Echoing 1005 or
        // 1006 back is the regression.
        verdict: echoedCode === 1005 || echoedCode === 1006 ? "VULNERABLE" : "DEFENDED",
      });
    }
    {
      const out = await wsFrameProbe(
        port,
        wsFrame(0x82, Buffer.alloc(0), { declaredLen: 0xffffffff }),
        3000
      );
      record({
        category: cat,
        title: "WS frame — 4 GiB declared payload, never delivered",
        severity: "high",
        attack:
          "binary frame header declaring 0xFFFFFFFF bytes then silence (memory-exhaustion probe)",
        observed: `${wsCloseCode(out)} — no allocation crash`,
        verdict: "INFO",
      });
    }
    {
      const frag1 = wsFrame(0x02, Buffer.from("hel")); // FIN=0 binary, starts a message
      const ping = wsFrame(0x89, Buffer.from("ok")); // legal interleaved control frame
      const illegal = wsFrame(0x81, Buffer.from("x")); // new data frame mid-fragment → 1002
      const out = await wsFrameProbe(port, Buffer.concat([frag1, ping, illegal]));
      const code = wsCloseCode(out);
      record({
        category: cat,
        title: "WS frame — new message opcode mid-fragment",
        severity: "high",
        attack:
          "fragmented binary, interleaved ping (legal), then a fresh text frame before FIN (illegal)",
        observed: code,
        verdict: /1002/.test(code) ? "DEFENDED" : "VULNERABLE",
      });
    }
  }

  // ---- R4. Multipart exotica ----------------------------------------------
  {
    const cat = "Multipart exotica";
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const mp = (
      parts: { name: string; data: Buffer; type?: string; filename?: string }[],
      boundary = "XBOUNDARY"
    ) => {
      const chunks: Buffer[] = [];
      for (const p of parts) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`
          ),
          p.data,
          Buffer.from("\r\n")
        );
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return Buffer.concat(chunks);
    };
    const up = (body: Buffer) =>
      fetch(`${BASE}/upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=XBOUNDARY" },
        body: toBodyInit(body),
      });

    const t0 = Date.now();
    const flood = await up(
      mp(
        Array.from({ length: 1000 }, (_, i) => ({
          name: `f${i}`,
          data: PNG,
          type: "image/png",
          filename: `p${i}.png`,
        }))
      )
    );
    record({
      category: cat,
      title: "Multipart part-count flood (1000 parts)",
      severity: "high",
      attack: "POST /upload with 1000 tiny PNG parts (per-part bookkeeping DoS)",
      observed: `status ${flood.status} in ${Date.now() - t0}ms`,
      verdict: flood.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });

    const trav = await up(
      mp([{ name: "avatar", data: PNG, type: "image/png", filename: "../../evil.png" }])
    );
    record({
      category: cat,
      title: "Multipart filename path traversal",
      severity: "medium",
      attack:
        'POST /upload with filename="../../evil.png" — the name must never reach a filesystem path unfiltered',
      observed: `status ${trav.status} (target never writes to disk; the raw name is handler-facing data — handler responsibility)`,
      verdict: "INFO",
    });

    const tricky = await up(
      mp([
        {
          name: "avatar",
          data: Buffer.concat([PNG, Buffer.from("\r\n--XBOUNDARY--\r\n")]),
          type: "image/png",
          filename: "b.png",
        },
      ])
    );
    record({
      category: cat,
      title: "Multipart boundary embedded in file content",
      severity: "medium",
      attack:
        "file bytes contain the literal boundary terminator — parser must not mis-split into a 500",
      observed: `status ${tricky.status}`,
      verdict: tricky.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });

    const t1 = Date.now();
    const trunc = await up(
      Buffer.concat([
        Buffer.from(
          '--XBOUNDARY\r\nContent-Disposition: form-data; name="avatar"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n'
        ),
        PNG,
      ])
    );
    record({
      category: cat,
      title: "Multipart truncated (no closing boundary)",
      severity: "medium",
      attack: "POST /upload with a body that ends mid-part",
      observed: `status ${trunc.status} in ${Date.now() - t1}ms`,
      verdict: trunc.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- R5. Content-encoding confusion --------------------------------------
  {
    const cat = "Content-encoding confusion";
    const postBin = (path: string, body: Buffer, headers: Record<string, string>) =>
      fetch(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: toBodyInit(body),
      });

    const mislabel = await postBin(
      "/ingest",
      deflateSync(JSON.stringify({ value: "x".repeat(100) })),
      { "content-encoding": "gzip" }
    );
    record({
      category: cat,
      title: "gzip-labeled raw deflate body",
      severity: "medium",
      attack: "POST /ingest Content-Encoding: gzip with raw DEFLATE bytes (wrong wrapper)",
      observed: `status ${mislabel.status} — label/actual mismatch must 4xx, never 500 or silent pass-through`,
      verdict: mislabel.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });

    const nested = await postBin(
      "/ingest",
      gzipSync(gzipSync(JSON.stringify({ value: "x".repeat(100) }))),
      { "content-encoding": "gzip" }
    );
    record({
      category: cat,
      title: "Nested gzip (double-compressed) body",
      severity: "high",
      attack:
        "gzip(gzip(json)) with a single gzip declaration — layer-1 ratio passes, handler would get compressed bytes",
      observed: `status ${nested.status}`,
      verdict: nested.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });

    const utf16 = await postBin(
      "/items",
      Buffer.from(JSON.stringify({ name: "x", price: 1 }), "utf16le"),
      { "content-type": "application/json; charset=utf-16" }
    );
    record({
      category: cat,
      title: "UTF-16 charset JSON body",
      severity: "medium",
      attack:
        "POST /items with application/json; charset=utf-16 and UTF-16LE bytes — accepting mojibake is a parsing-smuggling gap",
      observed: `status ${utf16.status}`,
      verdict: utf16.status === 201 ? "VULNERABLE" : "DEFENDED",
    });

    const bom = await postBin(
      "/items",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify({ name: "x", price: 1 })),
      ]),
      {}
    );
    record({
      category: cat,
      title: "BOM-prefixed JSON body",
      severity: "low",
      attack: "POST /items with EF BB BF before the JSON",
      observed: `status ${bom.status}`,
      verdict: bom.status >= 500 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- R6. Prototype-pollution persistence ---------------------------------
  {
    const cat = "Prototype pollution";
    const r1 = await http("GET", "/search?q=x&__proto__[polluted]=yes&constructor[prototype][y]=1");
    const r2 = await http("POST", "/sink", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: JSON.parse('{"__proto__":{"polluted":"yes"}}') }),
    });
    const r3 = await http("POST", "/items", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "clean", price: 1 }),
    });
    record({
      category: cat,
      title: "Query + JSON __proto__ pollution with persistence check",
      severity: "critical",
      attack:
        "GET /search?q=x&__proto__[polluted]=yes, POST /sink with a __proto__ body, then a normal POST /items",
      observed: `search=${r1.status} sink=${r2.status} follow-up=${r3.status} (follow-up 201 = no global corruption)`,
      verdict: r3.status !== 201 ? "VULNERABLE" : "DEFENDED",
    });
  }

  // ---- R7. Protocol oddities -----------------------------------------------
  {
    const cat = "Protocol oddities";
    const oddities: Array<[string, Finding["severity"], string, string]> = [
      [
        "OPTIONS * (asterisk-form)",
        "low",
        "OPTIONS * HTTP/1.1\r\nHost: x\r\n\r\n",
        "asterisk-form request line",
      ],
      [
        "CONNECT authority-form",
        "medium",
        "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: x\r\n\r\n",
        "CONNECT to a tunnel authority",
      ],
      ["HTTP/0.9 request", "medium", "GET /healthz\r\n\r\n", "request line with no HTTP version"],
      [
        "obs-fold header",
        "high",
        "GET /healthz HTTP/1.1\r\nHost: x\r\nX-Fold: a\r\n b\r\n\r\n",
        "obsolete line folding in a header value",
      ],
      [
        "method with embedded space",
        "medium",
        "GE T /healthz HTTP/1.1\r\nHost: x\r\n\r\n",
        "space inside the method token",
      ],
    ];
    for (const [name, sev, payload, attack] of oddities) {
      const r = await rawSend(port, payload);
      record({
        category: cat,
        title: `Protocol — ${name}`,
        severity: sev,
        attack,
        observed: `status: ${r.status || "(connection dropped)"}`,
        verdict: "INFO",
      });
    }
    {
      const r = await rawSend(
        port,
        "GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA\r\n\r\n"
      );
      record({
        category: cat,
        title: "h2c cleartext HTTP/2 upgrade",
        severity: "high",
        attack: "GET /healthz with Upgrade: h2c + HTTP2-Settings — must not switch protocols",
        observed: `status: ${r.status || "(connection dropped)"}`,
        verdict: r.status === 101 ? "VULNERABLE" : "DEFENDED",
      });
    }
    {
      const r = await rawSend(
        port,
        "GET /healthz HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n"
      );
      record({
        category: cat,
        title: "WebSocket upgrade to a non-WS route",
        severity: "medium",
        attack: "valid WS handshake headers against /healthz (no WS handler)",
        observed: `status: ${r.status || "(connection dropped)"}`,
        verdict: r.status === 101 ? "VULNERABLE" : "DEFENDED",
      });
    }
    {
      const r = await rawSend(
        port,
        "POST /sink HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nExpect: bananas\r\n\r\n{}"
      );
      record({
        category: cat,
        title: "Unknown Expect token",
        severity: "low",
        attack: "POST /sink with Expect: bananas — must be 417 or ignored, never an invitation",
        observed: `status: ${r.status || "(connection dropped)"}`,
        verdict: "INFO",
      });
    }
  }

  // ---- R8. Trailer smuggling + reflection ----------------------------------
  {
    const cat = "Trailer smuggling / reflection";
    const body = JSON.stringify({ amount: 5 });
    const r = await rawSend(
      port,
      `POST /pay HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nIdempotency-Key: trailer-${Date.now()}\r\nTransfer-Encoding: chunked\r\nTrailer: Authorization\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\nAuthorization: Bearer SMUGGLED-TRAILER\r\n\r\n`,
      2500
    );
    const smuggled = r.raw.includes("SMUGGLED-TRAILER");
    record({
      category: cat,
      title: "Trailer-field smuggling into request headers",
      severity: "critical",
      attack:
        "Chunked POST /pay with Trailer: Authorization — if the trailer merges into request " +
        "headers, the handler sees a forged identity (observable via /pay's owner field)",
      observed: smuggled
        ? "SMUGGLED VALUE REACHED THE HANDLER"
        : `status ${r.status}, trailer not visible to the handler`,
      verdict: smuggled ? "VULNERABLE" : "DEFENDED",
    });

    const res = await fetch(`${BASE}/no-such%0d%0aroute%0d%0aInjected:%20yes`);
    const text = await res.text();
    const rawCrlf = text.includes("\r") || text.includes("\n");
    record({
      category: cat,
      title: "CRLF-encoded path reflection in a 404 body",
      severity: "medium",
      attack:
        "GET /no-such%0d%0aroute%0d%0aInjected:%20yes — the reflected path must stay JSON-escaped",
      observed: `status ${res.status}, raw CR/LF in body: ${rawCrlf}, body: ${text.slice(0, 120)}`,
      verdict: rawCrlf ? "VULNERABLE" : "DEFENDED",
    });
  }
}

async function unorthodoxAttacks(port: number, portB: number) {
  const cat = "Unorthodox vectors";

  // Browsers send Origin: null for file:// pages, sandboxed iframes, and some
  // redirects. A configured allowlist must not reflect that opaque origin.
  const nullOrigin = await http("GET", "/users/1", { headers: { origin: "null" } });
  const nullAcao = nullOrigin.headers.get("access-control-allow-origin");
  record({
    category: cat,
    title: "CORS null-origin bypass",
    severity: "medium",
    attack: "GET /users/1 with Origin: null",
    observed: `status ${nullOrigin.status}, Access-Control-Allow-Origin=${nullAcao ?? "(none)"}`,
    verdict: nullOrigin.status === 200 && nullAcao === null ? "DEFENDED" : "VULNERABLE",
  });

  // Duplicate Host headers must be rejected rather than leaving different
  // intermediaries free to choose different request authorities.
  const multiHost = await rawSend(
    port,
    "GET /healthz HTTP/1.1\r\nHost: attacker.com\r\nHost: target.com\r\n\r\n"
  );
  record({
    category: cat,
    title: "Multiple Host headers",
    severity: "medium",
    attack: "Raw GET /healthz with two Host headers",
    observed: `response: ${multiHost.statusLine || "(dropped)"}`,
    verdict: multiHost.status === 400 ? "DEFENDED" : "VULNERABLE",
  });

  // A single extremely long header value exercises a different parser path
  // than many small headers and must hit the configured byte limit.
  const longHeader = await rawSend(
    port,
    `GET /healthz HTTP/1.1\r\nHost: t\r\nX-Long: ${"A".repeat(20_000)}\r\n\r\n`
  );
  record({
    category: cat,
    title: "Oversized single header value",
    severity: "medium",
    attack: "Raw GET with one 20 KiB header value",
    observed: `response: ${longHeader.statusLine || "(dropped)"}`,
    verdict: longHeader.status === 431 || longHeader.status === 400 ? "DEFENDED" : "VULNERABLE",
  });

  // A vulnerable path parser might truncate at NUL and route to /users/1.
  const nullByte = await rawSend(port, "GET /users/1%00/admin HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Null byte injection in path",
    severity: "medium",
    attack: "GET /users/1%00/admin",
    observed: `response: ${nullByte.statusLine || "(dropped)"}`,
    verdict:
      nullByte.status === 400 ||
      nullByte.status === 401 ||
      nullByte.status === 403 ||
      nullByte.status === 404
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // Absolute-form request targets are valid for proxies. The origin adapter
  // must route by pathname without treating the target authority as trusted.
  const absolute = await rawSend(
    port,
    `GET http://${HOST}:${port}/healthz HTTP/1.1\r\nHost: ${HOST}:${port}\r\nUser-Agent: redteam-absolute-uri/1.0\r\n\r\n`
  );
  record({
    category: cat,
    title: "Absolute-URI request line",
    severity: "low",
    attack: "GET http://host:port/healthz HTTP/1.1",
    observed: `response: ${absolute.statusLine || "(dropped)"}`,
    verdict:
      absolute.status === 200 || absolute.status === 404
        ? "DEFENDED"
        : absolute.status >= 500 || absolute.status === 0
          ? "VULNERABLE"
          : "INFO",
  });

  // Declaring JSON while sending form data must not reach the handler through
  // a lenient parser and bypass the JSON structural limits.
  const ctConfusion = await http("POST", "/sink", {
    headers: { "content-type": "application/json" },
    body: "data=value",
  });
  record({
    category: cat,
    title: "JSON content-type with URL-encoded body",
    severity: "medium",
    attack: "POST /sink Content-Type: application/json with form body",
    observed: `status ${ctConfusion.status}`,
    verdict:
      ctConfusion.status === 400 || ctConfusion.status === 415 || ctConfusion.status === 422
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // Windows-style separators must not collapse through the router or except()
  // guard and turn this public-looking path into the protected admin route.
  const backslash = await rawSend(portB, "GET /public\\..\\api\\admin HTTP/1.1\r\nHost: t\r\n\r\n");
  record({
    category: cat,
    title: "Backslash path traversal",
    severity: "high",
    attack: "GET /public\\..\\api\\admin on the except() app via port B",
    observed: `response: ${backslash.statusLine || "(dropped)"}`,
    verdict:
      backslash.status === 400 ||
      backslash.status === 401 ||
      backslash.status === 403 ||
      backslash.status === 404
        ? "DEFENDED"
        : "VULNERABLE",
  });

  // A non-numeric suffix after the port is a malformed authority. It must be
  // rejected as a client error rather than surfacing as a framework 500.
  const invalidPortSuffix = await rawSend(
    port,
    `GET /healthz HTTP/1.1\r\nHost: ${HOST}:${port}.\r\nUser-Agent: redteam-invalid-port/1.0\r\n\r\n`
  );
  record({
    category: cat,
    title: "Malformed Host port suffix",
    severity: "low",
    attack: "GET /healthz with Host: 127.0.0.1:<port>.",
    observed: `response: ${invalidPortSuffix.statusLine || "(dropped)"}`,
    verdict: invalidPortSuffix.status === 400 ? "DEFENDED" : "VULNERABLE",
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report(): number {
  const byCat = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f);
  }
  const icon = (v: Verdict) => (v === "DEFENDED" ? "✅" : v === "VULNERABLE" ? "🚨" : "ℹ️ ");

  const line = "═".repeat(78);
  console.log("\n" + line);
  console.log("  FBI CYBER DIVISION — LIVE RED-TEAM ENGAGEMENT REPORT");
  console.log(`  Target: @daloyjs/core service @ ${BASE}`);
  console.log(`  Method: black-box, over-the-wire (fetch + raw TCP sockets)`);
  console.log(line);

  for (const [cat, fs] of byCat) {
    console.log(`\n▼ ${cat}`);
    for (const f of fs) {
      console.log(`  ${icon(f.verdict)} [${f.verdict}] ${f.title}  (${f.severity})`);
      console.log(`       attack:   ${f.attack}`);
      console.log(`       observed: ${f.observed}`);
    }
  }

  const vuln = findings.filter((f) => f.verdict === "VULNERABLE");
  const def = findings.filter((f) => f.verdict === "DEFENDED");
  const info = findings.filter((f) => f.verdict === "INFO");
  console.log("\n" + line);
  console.log(
    `  SUMMARY: ${def.length} DEFENDED · ${vuln.length} VULNERABLE · ${info.length} INFO  (of ${findings.length} probes)`
  );
  if (vuln.length === 0) {
    console.log("  VERDICT: No exploitable weakness found. The framework held the line.");
  } else {
    console.log("  VERDICT: EXPLOITABLE FINDINGS PRESENT — see 🚨 entries above.");
    for (const f of vuln) console.log(`    🚨 ${f.category} :: ${f.title}`);
  }
  console.log(line + "\n");
  return vuln.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Orchestration: boot the target, attack, tear down.
// ---------------------------------------------------------------------------

function startTarget(): Promise<{ port: number; portB: number; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const targetPath = fileURLToPath(new URL("./target.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", targetPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("target did not become ready in 15s\n" + stderr));
    }, 15_000);
    child.stdout.on("data", (d) => {
      const m = /RED_TEAM_TARGET_READY (\d+) (\d+)/.exec(d.toString());
      if (m) {
        clearTimeout(timer);
        resolve({ port: Number(m[1]), portB: Number(m[2]), kill: () => child.kill("SIGKILL") });
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`target exited early (code ${code})\n${stderr}`));
    });
  });
}

async function main() {
  console.log("⚔️  Booting target service and opening the engagement…");
  const { port, portB, kill } = await startTarget();
  BASE = `http://${HOST}:${port}`;
  BASE_B = `http://${HOST}:${portB}`;
  console.log(`🎯  Target live on ${BASE} (and ${BASE_B}) — commencing attacks.\n`);

  try {
    await reconAndFingerprint();
    await authAndJwt();
    await injection();
    await ssrfAndRedirect();
    await dataExposureAndMassAssignment();
    await corsAbuse();
    await wireLevel(port);
    await websocketHijack(port);
    await multipartAbuse();
    await rapidResetAndChurn(port);
    await protocolAndParsing(port);
    await statefulMiddleware();
    await accessControlFeeds();
    await exceptPathConfusion();
    await novelProbes(port, portB);
    await wave4Probes(port);
    await unorthodoxAttacks(port, portB);
  } finally {
    // Confirm the target survived the engagement (crash = DoS finding).
    let alive = false;
    try {
      alive = (await http("GET", "/healthz")).status === 200;
    } catch {
      alive = false;
    }
    record({
      category: "Resilience",
      title: "Target process survived the full engagement",
      severity: "critical",
      attack: "post-engagement liveness probe (GET /healthz)",
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
