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
import { gzipSync } from "node:zlib";
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
    verdict:
      bigBody.status === 413 || bigBody.status === 400 || bigBody.status === 0
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
    const probes: Array<[string, string]> = [
      ["inline-comment SQLi", "un/**/ion sel/**/ect user,pass"],
      ["mixed-case SQLi", "uNiOn SeLeCt * fRoM users"],
      ["fullwidth-Unicode SQLi", "ｕｎｉｏｎ ｓｅｌｅｃｔ"],
      ["template-injection strings", "{{7*7}}${7*7}#{7*7}"],
    ];
    for (const [name, q] of probes) {
      const r = await http("GET", `/search?q=${encodeURIComponent(q)}`);
      record({
        category: cat,
        title: `WAF signature coverage — ${name}`,
        severity: "medium",
        attack: `GET /search?q=${q}`,
        observed:
          `status ${r.status}` +
          (r.status === 200
            ? " (passed the signature WAF — /search has no SQL/template sink, so this documents WAF coverage, not an exploit)"
            : " (blocked)"),
        verdict: "INFO",
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
