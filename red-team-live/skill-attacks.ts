/**
 * RED-TEAM LIVE — second-wave attacker driven by the `.claude/skills`
 * offensive playbooks (cure53-webapp-api-pentest, tob-insecure-defaults,
 * tob-sharp-edges, tob-constant-time-analysis).
 *
 * Every probe here is an attack class that `run.ts` does NOT already cover,
 * mapped to the skill pattern that motivates it:
 *
 *  - cure53 EXP-23-017 / FWD-01-002: SSRF via redirect + alternate IP encodings
 *  - cure53 EXP-20-008:            open redirect via incomplete normalization
 *  - cure53 EXP-23-005 / P11-02-005: rate-limit/ban keyed on spoofable XFF
 *  - cure53 EXP-23-017:            proxy block-list bypass via double-encoding
 *  - cure53 P11 (conclusions):     verbose parse-error disclosure
 *  - cure53 RSP-01-001:            credentialed CORS suffix/subdomain confusion
 *  - tob-sharp-edges "JWT pattern": alg/crit/kid/jku header confusion
 *  - tob-insecure-defaults:        fail-open WS origin policy (missing Origin)
 *
 * Usage:  node --import tsx red-team-live/skill-attacks.ts
 * Exit code is non-zero if any probe comes back VULNERABLE.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Verdict = "DEFENDED" | "VULNERABLE" | "INFO";
interface Finding {
  category: string;
  title: string;
  severity: string;
  skill: string; // the skill pattern that motivated the probe
  attack: string;
  observed: string;
  verdict: Verdict;
}

const findings: Finding[] = [];
const record = (f: Finding) => {
  findings.push(f);
  const icon = f.verdict === "VULNERABLE" ? "🔴" : f.verdict === "INFO" ? "🟡" : "✅";
  console.log(`${icon} [${f.verdict}] ${f.title} (${f.severity})`);
  console.log(`     skill:    ${f.skill}`);
  console.log(`     attack:   ${f.attack}`);
  console.log(`     observed: ${f.observed}\n`);
};

let PORT_A = 0;
let PORT_B = 0;
const baseA = () => `http://127.0.0.1:${PORT_A}`;
const baseB = () => `http://127.0.0.1:${PORT_B}`;

interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
}

async function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string | Buffer; base?: string } = {}
): Promise<HttpResult> {
  const res = await fetch(`${opts.base ?? baseA()}${path}`, {
    method,
    headers: opts.headers,
    body: opts.body,
    redirect: "manual",
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** Raw TCP request so we control the exact bytes on the wire. */
function raw(port: number, bytes: string, waitMs = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(port, "127.0.0.1");
    let out = "";
    sock.setTimeout(waitMs);
    sock.on("connect", () => sock.write(bytes));
    sock.on("data", (d) => (out += d.toString("latin1")));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(out);
    });
    sock.on("end", () => resolve(out));
    sock.on("error", reject);
  });
}

const statusLine = (rawText: string) => rawText.split("\r\n", 1)[0] ?? "(no response)";

// ---------------------------------------------------------------------------
// Boot the target in a separate process (same handshake as run.ts).
// ---------------------------------------------------------------------------
async function bootTarget() {
  const here = dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", join(here, "target.ts")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let buf = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("target boot timeout")), 30_000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const m = /RED_TEAM_TARGET_READY (\d+) (\d+)/.exec(buf);
      if (m) {
        PORT_A = Number(m[1]);
        PORT_B = Number(m[2]);
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`target exited early: ${code}`)));
  });
  return child;
}

// ---------------------------------------------------------------------------
// Attacker-controlled redirect server for SSRF-via-redirect probes.
// 302s to whatever path is asked: /to?u=<encoded absolute url>
// ---------------------------------------------------------------------------
function bootAttackerServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/to") {
      res.writeHead(302, { location: u.searchParams.get("u") ?? "/" });
      res.end();
      return;
    }
    // A canary endpoint that should never be reachable through fetchGuard.
    if (u.pathname === "/canary") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ATTACKER-CANARY-REACHED");
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const addr = server.address();
    return { server, port: typeof addr === "object" && addr ? addr.port : 0 };
  });
}

// ===========================================================================
// PROBES
// ===========================================================================

/** cure53 FWD-01-002 / EXP-23-017 — SSRF: filter must check the *resolved* IP. */
async function ssrfAlternateEncodings() {
  const cat = "SSRF — alternate IP encodings (cure53 FWD-01-002)";
  const cases: Array<[string, string]> = [
    ["decimal IPv4 (2130706433)", `http://2130706433:${PORT_A}/healthz`],
    ["hex IPv4 (0x7f000001)", `http://0x7f000001:${PORT_A}/healthz`],
    ["short IPv4 (127.1)", `http://127.1:${PORT_A}/healthz`],
    ["IPv6 loopback ([::1])", `http://[::1]:${PORT_A}/healthz`],
    ["IPv4-mapped IPv6 ([::ffff:127.0.0.1])", `http://[::ffff:7f00:1]:${PORT_A}/healthz`],
    ["userinfo confusion (x@127.0.0.1)", `http://public.example@127.0.0.1:${PORT_A}/healthz`],
    ["0.0.0.0", `http://0.0.0.0:${PORT_A}/healthz`],
  ];
  for (const [label, u] of cases) {
    const r = await http("GET", `/fetch?url=${encodeURIComponent(u)}`);
    record({
      category: cat,
      title: `SSRF via ${label}`,
      severity: "critical",
      skill: "cure53-webapp-api-pentest — SSRF filter on URL string, not resolved IP",
      attack: `GET /fetch?url=${u}`,
      observed: `status ${r.status} (403 = blocked, 200 = FETCHED INTERNAL TARGET)`,
      verdict: r.status === 403 || r.status === 502 ? "DEFENDED" : "VULNERABLE",
    });
  }
}

/** cure53 FWD-01-002 — validation and request must use the same resolution (no redirect re-entry). */
async function ssrfViaRedirect(attackerPort: number) {
  const cat = "SSRF — redirect re-entry (cure53 FWD-01-002 anti-rebinding)";
  const targets: Array<[string, string]> = [
    ["redirect → loopback target", `${baseA()}/healthz`],
    ["redirect → cloud metadata", "http://169.254.169.254/latest/meta-data/"],
  ];
  for (const [label, dest] of targets) {
    const redirector = `http://127.0.0.1:${attackerPort}/to?u=${encodeURIComponent(dest)}`;
    // The redirector itself is loopback, so a naive guard blocks it outright —
    // that is ALSO safe. The interesting case is whether the guard follows the
    // 302 and re-validates the *destination*.
    const r = await http("GET", `/fetch?url=${encodeURIComponent(redirector)}`);
    record({
      category: cat,
      title: `SSRF via open 302 ${label}`,
      severity: "high",
      skill: "cure53-webapp-api-pentest — DNS-rebinding / redirect SSRF (FWD-01-002)",
      attack: `GET /fetch?url=<attacker 302> → ${dest}`,
      observed: `status ${r.status} (403/502 = blocked, 200 = followed redirect to internal)`,
      verdict: r.status === 403 || r.status === 502 ? "DEFENDED" : "VULNERABLE",
    });
  }
}

/**
 * cure53 EXP-20-008 — open redirect via incomplete URL normalization.
 *
 * The payloads below are placed in the query string SINGLE-encoded, so the
 * server decodes them exactly once and `safeRedirect()` sees the real
 * control character (the EXP-20-008 condition). A payload is only counted
 * VULNERABLE when the emitted Location header would actually navigate
 * off-origin in a browser:
 *   - it names the evil host (`//evil.example`, `https://evil.example`, …),
 *   - it uses a dangerous scheme (javascript:/data:/vbscript:),
 *   - or it carries a LITERAL tab/CR/LF byte, which the WHATWG URL parser
 *     strips mid-URL — turning `/<TAB>/evil.example` into `//evil.example`.
 */
async function openRedirectNormalization() {
  const cat = "Open Redirect — normalization gaps (cure53 EXP-20-008)";
  // Raw query strings, appended verbatim after `/go?to=`.
  const payloads = [
    "/%09/evil.example", // decodes to /<TAB>/evil.example — the EXP-20-008 primitive
    "/%0d/evil.example",
    "/%0a/evil.example",
    "/%0b/evil.example",
    "/%0c/evil.example",
    "/%20/evil.example",
    "%2f%2fevil.example",
    "%2f%09%2fevil.example", // the exact EXP-20-008 payload
    "/%5c%5cevil.example",
    "///evil.example",
    "\\\\evil.example",
    "https:%2f%2fevil.example",
    "https://app.example.com.evil.example/",
    "https://app.example.com@evil.example/",
    "https://evil.example#@app.example.com",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "JaVaScRiPt:alert(1)",
    "java%09script:alert(1)",
  ];
  for (const p of payloads) {
    const r = await http("GET", `/go?to=${p}`);
    const loc = r.headers.get("location") ?? "";
    const literalCtrl = /[\x09\x0a\x0d]/.test(loc);
    const offOrigin =
      /^(https?:)?\\?\/\\?\/+[a-z0-9.-]*evil\.example/i.test(loc.trim()) ||
      /^(javascript|vbscript|data)\s*:/i.test(loc.trim()) ||
      (/[?#]/.test(loc) === false && /evil\.example/i.test(loc) && !loc.startsWith("/"));
    const escaped = literalCtrl || offOrigin;
    record({
      category: cat,
      title: `Open redirect payload ${p.slice(0, 44)}`,
      severity: "medium",
      skill: "cure53-webapp-api-pentest — returnUrl normalization bypass (EXP-20-008)",
      attack: `GET /go?to=${p}`,
      observed: `status ${r.status}, Location=${JSON.stringify(loc)}${literalCtrl ? " — LITERAL CONTROL BYTE IN HEADER" : ""}`,
      verdict: escaped ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** cure53 EXP-23-005 / P11-02-005 — anti-automation keyed on spoofable client IP. */
async function banEvasionViaXff() {
  const cat = "Rate-limit / autoBan — spoofable XFF (cure53 EXP-23-005, P11-02-005)";

  // Deployment model: an append-mode load balancer sits in front of the app.
  // The attacker's direct input occupies the LEFT of X-Forwarded-For; the LB
  // appends the client IP it actually observed on the RIGHT. The probes below
  // emulate that append exactly, the way EXP-23-005 models ALB append mode.

  // 1) Strike evasion: rotate the attacker-controlled left entry on every
  //    failed login while the LB-observed IP stays constant. Under the old
  //    leftmost-keyed resolver each attempt opened a fresh bucket and the ban
  //    never fired; the spoof-resistant rightmost read must accumulate.
  let banned = false;
  const statuses: number[] = [];
  for (let i = 0; i < 10 && !banned; i++) {
    const r = await http("GET", "/ab-login", {
      headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.5` },
    });
    statuses.push(r.status);
    if (r.status === 429) banned = true;
  }
  record({
    category: cat,
    title: "autoBan strike evasion by rotating spoofed XFF entries",
    severity: "high",
    skill: "cure53-webapp-api-pentest — rate-limit keyed on attacker-controllable XFF (EXP-23-005)",
    attack: "failed /ab-login ×N, leftmost XFF entry rotated per attempt (append-mode LB model)",
    observed: banned
      ? `ban fired after rotation — statuses: ${statuses.join(",")}`
      : `all attempts returned 401 — unlimited brute force, strikes never accumulate: ${statuses.join(",")}`,
    verdict: banned ? "DEFENDED" : "VULNERABLE",
  });

  // 2) Victim banning: spoof the victim's IP in the attacker-controlled left
  //    entry. Under the old resolver the strikes landed on the victim; now
  //    they must land on the LB-observed attacker IP.
  const victim = "203.0.113.99";
  const attackerIp = "198.51.100.23";
  for (let i = 0; i < 4; i++) {
    await http("GET", "/ab-login", {
      headers: { "x-forwarded-for": `${victim}, ${attackerIp}` },
    });
  }
  const asVictim = await http("GET", "/ab-public", {
    headers: { "x-forwarded-for": `10.1.2.3, ${victim}` },
  });
  const asAttacker = await http("GET", "/ab-public", {
    headers: { "x-forwarded-for": `10.9.9.9, ${attackerIp}` },
  });
  record({
    category: cat,
    title: "autoBan victim-IP banning (pre-emptive DoS via spoofed XFF)",
    severity: "medium",
    skill:
      "cure53-webapp-api-pentest — limiter keyed on spoofable IP enables self-DoS (P11-02-005)",
    attack: `4 failed logins spoofing XFF of victim ${victim} (append-mode LB model)`,
    observed:
      `victim's /ab-public: ${asVictim.status} (429 = attacker can ban arbitrary IPs), ` +
      `attacker's /ab-public: ${asAttacker.status}`,
    verdict: asVictim.status === 429 ? "VULNERABLE" : "DEFENDED",
  });

  // 3) Residual posture note (INFO): with NO proxy in front at all, any
  //    forwarded-header trust is attacker-controlled by definition — the
  //    middlewares document that proxy-header trust requires a proxy chain
  //    the operator controls. Confirm the framework cannot do anything else
  //    in that misconfigured deployment: single-entry XFF keys on that entry.
  const direct = await http("GET", "/ab-public", {
    headers: { "x-forwarded-for": "192.0.2.77" },
  });
  record({
    category: cat,
    title: "posture: single-entry XFF with no proxy in front (deployment-misconfig case)",
    severity: "info",
    skill: "tob-insecure-defaults — documented trust boundary, not a framework flaw",
    attack: "GET /ab-public with a bare single-entry XFF (no LB append)",
    observed: `status ${direct.status} — identity comes from the only entry present; documented as requiring a controlled proxy chain`,
    verdict: "INFO",
  });
}

/** cure53 EXP-23-017 — proxy/guard block-list bypass via encoded path segments. */
async function exceptPathConfusion() {
  const cat = "except() path confusion — round 2 (cure53 EXP-23-017)";
  const paths = [
    "/public/%252e%252e/api/admin", // double-encoded ../ (the EXP-23-017 payload)
    "/public/%252e%252e%252fapi%252fadmin",
    "/public/%2e%2e/api/admin",
    "/public/%2e%2e%2fapi%2fadmin",
    "//public/../api/admin",
    "/public//../api/admin",
    "/public/..;/api/admin",
    "/public/;%2f..%2fapi%2fadmin",
    "/PUBLIC/../api/admin",
    "/public/....//api/admin",
    "/api/../public/../api/admin",
    "/public/%c0%ae%c0%ae/api/admin", // overlong UTF-8 dots
    "/public/..%00/api/admin",
  ];
  for (const p of paths) {
    let r: HttpResult;
    try {
      r = await http("GET", p, { base: baseB() });
    } catch (e) {
      record({
        category: cat,
        title: `except() bypass via ${p}`,
        severity: "critical",
        skill:
          "cure53-webapp-api-pentest — double-encoded traversal past a block-list (EXP-23-017)",
        attack: `GET ${p} on except()-guarded app`,
        observed: `request failed: ${(e as Error).message}`,
        verdict: "INFO",
      });
      continue;
    }
    record({
      category: cat,
      title: `except() bypass via ${p.slice(0, 46)}`,
      severity: "critical",
      skill: "cure53-webapp-api-pentest — double-encoded traversal past a block-list (EXP-23-017)",
      attack: `GET ${p} on except()-guarded app (no token)`,
      observed: `status ${r.status} (200 = AUTH BYPASSED)`,
      verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** tob-insecure-defaults — does the WS same-origin policy fail open? */
async function websocketOriginEdgeCases() {
  const cat = "WebSocket origin policy (tob-insecure-defaults fail-open)";
  const cases: Array<[string, string | null]> = [
    ["missing Origin header", null],
    ["Origin: null", "null"],
    ["suffix-lookalike origin", "https://app.example.com.evil.example"],
    ["scheme downgrade", "http://app.example.com"],
  ];
  for (const [label, origin] of cases) {
    const headers: Record<string, string> = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString("base64"),
    };
    if (origin !== null) headers.Origin = origin;
    const resp = await raw(
      PORT_A,
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT_A}\r\n` +
        Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join("") +
        "\r\n"
    );
    const upgraded = /101/.test(statusLine(resp));
    record({
      category: cat,
      title: `CSWSH — ${label}`,
      severity: "high",
      skill:
        "tob-insecure-defaults — fail-open check on missing config; cure53 RSP-01-001 cross-origin",
      attack: `WS upgrade with ${label}`,
      observed: `${statusLine(resp)} (101 = handshake ACCEPTED)`,
      // A "same-origin" policy that accepts a missing Origin fails open for
      // non-browser clients; cross-origin lookalikes must never pass.
      verdict:
        label === "missing Origin header"
          ? upgraded
            ? "INFO" // non-browser clients omit Origin; note the posture
            : "DEFENDED"
          : upgraded
            ? "VULNERABLE"
            : "DEFENDED",
    });
  }
}

/** cure53 P11 — parse errors must not leak internals before/after validation. */
async function errorDisclosure() {
  const cat = "Error disclosure (cure53 P11 verbose-parse-errors)";
  const cases: Array<[string, string, string | Buffer, Record<string, string>]> = [
    ["malformed JSON", "/items", '{"name": "x", "price":}', { "content-type": "application/json" }],
    ["truncated JSON", "/items", '{"name": "x"', { "content-type": "application/json" }],
    ["JSON with BOM", "/items", '﻿{"name":"x","price":1}', { "content-type": "application/json" }],
    [
      "invalid UTF-8 JSON",
      "/items",
      Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0xfe, 0x7d]),
      { "content-type": "application/json" },
    ],
    ["JSON literal root", "/items", "null", { "content-type": "application/json" }],
  ];
  for (const [label, path, body, headers] of cases) {
    const r = await http("POST", path, { headers, body });
    const leaks = /stack|at Object\.|node_modules|\/src\/|zoderror|expected .+ at line/i.test(
      r.text
    );
    record({
      category: cat,
      title: `Parse-error disclosure — ${label}`,
      severity: "low",
      skill: "cure53-webapp-api-pentest — verbose errors reveal request structure (P11)",
      attack: `POST ${path} with ${label}`,
      observed: `status ${r.status}, body=${r.text.slice(0, 140).replace(/\n/g, " ")}`,
      verdict: leaks ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** Decompression edge cases beyond the plain bomb. */
async function decompressionEdgeCases() {
  const { gzipSync } = await import("node:zlib");
  const cat = "Decompression — edge cases";
  const payload = JSON.stringify({ value: "A".repeat(64) });

  // 1) Double-wrapped gzip with a single Content-Encoding: gzip header.
  const doubleGzip = gzipSync(gzipSync(Buffer.from(payload)));
  const r1 = await http("POST", "/ingest", {
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: doubleGzip as unknown as Buffer,
  });
  record({
    category: cat,
    title: "Double-gzip body with single Content-Encoding: gzip",
    severity: "low",
    skill: "cure53-webapp-api-pentest — parser differential between layers",
    attack: "POST /ingest gzip(gzip(body)), one CE header",
    observed: `status ${r1.status}, body=${r1.text.slice(0, 100)}`,
    verdict: r1.status < 500 ? "DEFENDED" : "VULNERABLE",
  });

  // 2) Unknown content-encoding — must be rejected, not passed through raw.
  const r2 = await http("POST", "/ingest", {
    headers: { "content-type": "application/json", "content-encoding": "zstd" },
    body: payload,
  });
  record({
    category: cat,
    title: "Unknown Content-Encoding: zstd",
    severity: "medium",
    skill: "tob-sharp-edges — silent failure on unrecognized security-relevant input",
    attack: "POST /ingest with Content-Encoding: zstd",
    observed: `status ${r2.status}, body=${r2.text.slice(0, 100)}`,
    verdict:
      r2.status === 415 || r2.status === 400 ? "DEFENDED" : r2.status < 300 ? "VULNERABLE" : "INFO",
  });

  // 3) Case-variant encoding value.
  const r3 = await http("POST", "/ingest", {
    headers: { "content-type": "application/json", "content-encoding": "GZIP" },
    body: gzipSync(Buffer.from(payload)) as unknown as Buffer,
  });
  record({
    category: cat,
    title: "Content-Encoding case variant (GZIP)",
    severity: "low",
    skill: "tob-sharp-edges — stringly-typed security values",
    attack: "POST /ingest with Content-Encoding: GZIP (uppercase)",
    observed: `status ${r3.status}, body=${r3.text.slice(0, 100)}`,
    verdict: r3.status < 500 ? "DEFENDED" : "VULNERABLE",
  });
}

/** HPP on the redirect parameter — last/first-wins confusion. */
async function hppOnRedirect() {
  const cat = "HTTP Parameter Pollution — redirect target";
  const r = await http(
    "GET",
    `/go?to=${encodeURIComponent("/healthz")}&to=${encodeURIComponent("https://evil.example")}`
  );
  const loc = r.headers.get("location") ?? "";
  const escaped = /evil\.example/i.test(loc);
  record({
    category: cat,
    title: "HPP duplicate `to` param (safe first, evil second)",
    severity: "medium",
    skill: "cure53-webapp-api-pentest — input-injection sweep / parameter pollution",
    attack: "GET /go?to=/healthz&to=https://evil.example",
    observed: `status ${r.status}, Location=${JSON.stringify(loc)}`,
    verdict: escaped ? "VULNERABLE" : "DEFENDED",
  });
}

/** Method-override header variants beyond the one run.ts probes. */
async function methodOverrideVariants() {
  const cat = "Method override — header variants";
  const headers: Array<[string, Record<string, string>]> = [
    ["X-HTTP-Method-Override", { "x-http-method-override": "DELETE" }],
    ["X-HTTP-Method", { "x-http-method": "DELETE" }],
    ["X-Method-Override", { "x-method-override": "DELETE" }],
    ["X-Original-Method", { "x-original-method": "DELETE" }],
  ];
  for (const [label, h] of headers) {
    const r = await http("POST", "/resource", { headers: h });
    record({
      category: cat,
      title: `POST /resource with ${label}: DELETE`,
      severity: "high",
      skill: "cure53-webapp-api-pentest — defenses mis-wired (verb confusion)",
      attack: `POST /resource + ${label}: DELETE`,
      observed: `status ${r.status} (200 = DELETE handler reached via POST)`,
      verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
  }
  const r = await http("POST", "/resource?_method=DELETE");
  record({
    category: cat,
    title: "POST /resource?_method=DELETE",
    severity: "high",
    skill: "cure53-webapp-api-pentest — defenses mis-wired (verb confusion)",
    attack: "POST /resource?_method=DELETE",
    observed: `status ${r.status}`,
    verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
  });
}

/** tob-sharp-edges "JWT pattern" — header-driven algorithm confusion variants. */
async function jwtHeaderConfusion() {
  const cat = "JWT header confusion (tob-sharp-edges JWT pattern)";
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = { sub: "alice", scopes: ["admin"], iat: 1, exp: 4_000_000_000 };
  const tokens: Array<[string, string]> = [
    ["alg case variant hs256", `${b64({ alg: "hs256", typ: "JWT" })}.${b64(payload)}.fakesig`],
    ["alg with whitespace", `${b64({ alg: " HS256", typ: "JWT" })}.${b64(payload)}.fakesig`],
    [
      "kid path traversal",
      `${b64({ alg: "HS256", kid: "../../../../etc/passwd" })}.${b64(payload)}.fakesig`,
    ],
    [
      "jku injection",
      `${b64({ alg: "HS256", jku: "http://evil.example/jwks.json" })}.${b64(payload)}.fakesig`,
    ],
    [
      "x5u injection",
      `${b64({ alg: "HS256", x5u: "http://evil.example/cert" })}.${b64(payload)}.fakesig`,
    ],
    ["crit extension", `${b64({ alg: "HS256", crit: ["exp"], exp: "x" })}.${b64(payload)}.fakesig`],
    ["exp as string", `${b64({ alg: "HS256" })}.${b64({ ...payload, exp: "4000000000" })}.fakesig`],
  ];
  for (const [label, token] of tokens) {
    const r = await http("GET", "/admin", {
      headers: { authorization: `Bearer ${token}` },
    });
    record({
      category: cat,
      title: `JWT ${label}`,
      severity: "critical",
      skill: "tob-sharp-edges — untrusted input must not control security decisions",
      attack: `GET /admin with ${label} token`,
      observed: `status ${r.status} (200 = FORGED ADMIN)`,
      verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** Transfer-Encoding / Content-Length obfuscation beyond dup-CL and TE+CL. */
async function teObfuscation() {
  const cat = "Wire-level TE/CL obfuscation";
  const cases: Array<[string, string]> = [
    [
      "Transfer-Encoding: xchunked",
      `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: xchunked\r\n\r\n5\r\n{"a":1\r\n0\r\n\r\n`,
    ],
    [
      "Transfer-Encoding: identity, chunked",
      `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: identity, chunked\r\n\r\n5\r\n{"a":1\r\n0\r\n\r\n`,
    ],
    [
      "Content-Length with + prefix",
      `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: +7\r\n\r\n{"a":1}`,
    ],
    [
      "Content-Length with leading zeros",
      `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 007\r\n\r\n{"a":1}`,
    ],
    [
      "Content-Length with hex",
      `POST /sink HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 0x7\r\n\r\n{"a":1}`,
    ],
  ];
  for (const [label, bytes] of cases) {
    const resp = await raw(PORT_A, bytes);
    const line = statusLine(resp);
    // Anything other than a clean 4xx means the server accepted ambiguous
    // framing — a smuggling primitive.
    const accepted = / 2\d\d /.test(line);
    record({
      category: cat,
      title: label,
      severity: "high",
      skill: "cure53-webapp-api-pentest — parser differentials between proxies/servers",
      attack: `raw POST /sink with ${label}`,
      observed: line,
      verdict: accepted ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** Multipart filename traversal + polyglot. */
async function multipartAbuse() {
  const cat = "Multipart upload abuse — round 2";
  const boundary = "----skillprobe";
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 1) Path traversal in the filename parameter.
  const body1 = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="../../../tmp/pwned.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    pngMagic,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r1 = await http("POST", "/upload", {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: body1,
  });
  record({
    category: cat,
    title: "Path traversal in multipart filename",
    severity: "medium",
    skill: "cure53-webapp-api-pentest — path traversal breaking a trust boundary",
    attack: 'filename="../../../tmp/pwned.png"',
    observed: `status ${r1.status}, body=${r1.text.slice(0, 120)}`,
    // The handler doesn't write to disk, so the framework can only be expected
    // to sanitize/flag; a 201 with the traversal string untouched is INFO.
    verdict: r1.status === 201 ? "INFO" : "DEFENDED",
  });

  // 2) PNG+HTML polyglot: valid magic bytes, active content appended.
  const polyglot = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    pngMagic,
    Buffer.from("<script>alert(1)</script>"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r2 = await http("POST", "/upload", {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: polyglot,
  });
  record({
    category: cat,
    title: "PNG+HTML polyglot passes magic-byte check",
    severity: "low",
    skill: "cure53-webapp-api-pentest — upload parsers as an attack surface",
    attack: "file with PNG magic bytes + trailing <script>",
    observed: `status ${r2.status} (201 = polyglot accepted)`,
    verdict: r2.status === 201 ? "INFO" : "DEFENDED",
  });

  // 3) Boundary parameter duplication — parser differential.
  const r3 = await raw(
    PORT_A,
    `POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=a; boundary=${boundary}\r\nContent-Length: ${body1.length}\r\n\r\n` +
      body1.toString("latin1")
  );
  record({
    category: cat,
    title: "Duplicate boundary parameter",
    severity: "low",
    skill: "cure53-webapp-api-pentest — parser differential between layers",
    attack: "Content-Type with two boundary= params",
    observed: statusLine(r3),
    verdict: / 5\d\d /.test(statusLine(r3)) ? "VULNERABLE" : "DEFENDED",
  });
}

/** CORS lookalike origins beyond plain evil/null. */
async function corsLookalikes() {
  const cat = "CORS — lookalike origins (cure53 RSP-01-001)";
  const origins = [
    "https://app.example.com.evil.example",
    "https://app.example.com.", // trailing dot
    "https://APP.EXAMPLE.COM", // case
    "https://app.example.com:443@evil.example",
    "https://evilapp.example.com",
  ];
  for (const o of origins) {
    const r = await http("GET", "/users/1", { headers: { origin: o } });
    const acao = r.headers.get("access-control-allow-origin");
    const reflected = acao === o || acao === "*";
    record({
      category: cat,
      title: `CORS origin ${o.slice(0, 44)}`,
      severity: "medium",
      skill:
        "cure53-webapp-api-pentest — credentialed CORS reflects lookalike origins (RSP-01-001)",
      attack: `GET /users/1 with Origin: ${o}`,
      observed: `ACAO=${acao ?? "(none)"}`,
      verdict: reflected ? "VULNERABLE" : "DEFENDED",
    });
  }
}

/** CRLF via percent-encoded bytes + oversized reflected header. */
async function headerReflectionEdgeCases() {
  const cat = "Header reflection — edge cases";
  const r1 = await http("GET", `/echo-header?v=${encodeURIComponent("ok\r\nX-Injected: yes")}`);
  const alive1 = (await http("GET", "/healthz")).status === 200;
  record({
    category: cat,
    title: "Percent-encoded CRLF reaching response header",
    severity: "high",
    skill: "cure53-webapp-api-pentest — header-handling flaws",
    attack: "GET /echo-header?v=ok%0d%0aX-Injected:%20yes",
    observed: `status ${r1.status}, injected header present: ${r1.headers.has("x-injected")}, server alive: ${alive1}`,
    verdict: r1.headers.has("x-injected") || !alive1 ? "VULNERABLE" : "DEFENDED",
  });

  const r2 = await http("GET", `/echo-header?v=${"A".repeat(8192)}`);
  record({
    category: cat,
    title: "8 KiB reflected response header value",
    severity: "low",
    skill: "tob-insecure-defaults — unbounded values as resource-exhaustion surface",
    attack: "GET /echo-header?v=<8 KiB of A>",
    observed: `status ${r2.status}, x-echo length=${r2.headers.get("x-echo")?.length ?? 0}`,
    verdict: "INFO",
  });
}

/** Route normalization differentials on the main app. */
async function routeNormalization() {
  const cat = "Route normalization differentials";
  const cases: Array<[string, number]> = [
    ["/users/%31", 200], // encoded "1"
    ["//users/1", 200],
    ["/users//1", 200],
    ["/./users/1", 200],
    ["/users/1/", 200],
  ];
  for (const [p, wantIfRouted] of cases) {
    const r = await http("GET", p);
    record({
      category: cat,
      title: `GET ${p}`,
      severity: "low",
      skill: "cure53-webapp-api-pentest — canonical path must equal routed path",
      attack: `GET ${p}`,
      observed: `status ${r.status}`,
      verdict: "INFO",
    });
    void wantIfRouted;
  }
  // /admin is scope-protected; a case-variant must NOT fall through to a 200.
  const r = await http("GET", "/ADMIN");
  record({
    category: cat,
    title: "GET /ADMIN (case variant of protected route)",
    severity: "medium",
    skill: "cure53-webapp-api-pentest — authorization matrix must be case-consistent",
    attack: "GET /ADMIN (no token)",
    observed: `status ${r.status} (200 = case-confusion bypass)`,
    verdict: r.status === 200 ? "VULNERABLE" : "DEFENDED",
  });
}

/** Login rate-limit: is the shared key a global-DoS vector? (INFO posture probe) */
async function loginLimitPosture() {
  const cat = "Login rate-limit posture (P11-02-005 global-key class)";
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await http("POST", "/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "alice", pass: "wrong" }),
    });
    statuses.push(r.status);
  }
  const limited = statuses.includes(429);
  record({
    category: cat,
    title: "Login limiter engages after 5 attempts (shared key)",
    severity: "info",
    skill: "cure53-webapp-api-pentest — global limiter self-DoS vs unthrottled brute force",
    attack: "7× POST /login with wrong password",
    observed: `statuses: ${statuses.join(",")}`,
    verdict: limited ? "DEFENDED" : "VULNERABLE",
  });
}

// ===========================================================================
async function main() {
  console.log("Booting red-team target…");
  const target = await bootTarget();
  console.log(`Target up: app A on :${PORT_A}, app B on :${PORT_B}\n`);
  const attacker = await bootAttackerServer();
  console.log(`Attacker redirect server on :${attacker.port}\n`);

  try {
    await loginLimitPosture(); // before brute-force probes consume the budget
    await ssrfAlternateEncodings();
    await ssrfViaRedirect(attacker.port);
    await openRedirectNormalization();
    await exceptPathConfusion();
    await websocketOriginEdgeCases();
    await errorDisclosure();
    await decompressionEdgeCases();
    await hppOnRedirect();
    await methodOverrideVariants();
    await jwtHeaderConfusion();
    await teObfuscation();
    await multipartAbuse();
    await corsLookalikes();
    await headerReflectionEdgeCases();
    await routeNormalization();
    await banEvasionViaXff(); // last: it bans IPs and could disturb other probes

    // Post-engagement liveness.
    const alive = (await http("GET", "/healthz")).status === 200;
    record({
      category: "Resilience",
      title: "Target survived the second-wave engagement",
      severity: "critical",
      skill: "—",
      attack: "GET /healthz after all probes",
      observed: alive ? "still serving" : "PROCESS DOWN",
      verdict: alive ? "DEFENDED" : "VULNERABLE",
    });
  } finally {
    attacker.server.close();
    target.kill("SIGTERM");
  }

  const counts = { DEFENDED: 0, VULNERABLE: 0, INFO: 0 } as Record<Verdict, number>;
  for (const f of findings) counts[f.verdict]++;
  console.log("═".repeat(78));
  console.log(
    `  SUMMARY: ${counts.DEFENDED} DEFENDED · ${counts.VULNERABLE} VULNERABLE · ${counts.INFO} INFO (of ${findings.length} probes)`
  );
  console.log("═".repeat(78));
  if (counts.VULNERABLE > 0) {
    console.log("\nVULNERABLE findings:");
    for (const f of findings.filter((f) => f.verdict === "VULNERABLE")) {
      console.log(`  - [${f.severity}] ${f.title}`);
      console.log(`    ${f.observed}`);
    }
    process.exit(1);
  }
}

await main();
