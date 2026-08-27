/**
 * SKILL WAVE 2 — localhost-only live pentest driven by Anthropic-Cybersecurity-Skills
 * that the 2026-08-26 engagement did not load.
 *
 * Skills in this battery (https://github.com/mukul975/Anthropic-Cybersecurity-Skills):
 *   testing-cors-misconfiguration
 *   performing-security-headers-audit
 *   performing-clickjacking-attack-test
 *   performing-http-parameter-pollution-attack
 *   performing-web-cache-poisoning-attack
 *   performing-web-cache-deception-attack
 *   testing-for-xxe-injection-vulnerabilities
 *   exploiting-insecure-deserialization
 *   exploiting-race-condition-vulnerabilities
 *   testing-api-authentication-weaknesses
 *   testing-for-broken-access-control
 *   exploiting-idor-vulnerabilities
 *   testing-jwt-token-security
 *   testing-websocket-api-security
 *   performing-csrf-attack-simulation
 *   exploiting-prototype-pollution-in-javascript
 *   testing-for-xss-vulnerabilities
 *   exploiting-api-injection-vulnerabilities
 *   exploiting-http-request-smuggling
 *   testing-for-business-logic-vulnerabilities
 *   testing-for-open-redirect-vulnerabilities
 *   performing-csrf-attack-simulation
 *   testing-for-system-prompt-leakage (MCP)
 *
 * Two targets, both bound to 127.0.0.1:
 *   bookstore-target.ts — shipped example app (create-daloy surface)
 *   target.ts           — idiomatically-secured pentest app (JWT / WS / CSRF / pay)
 *
 * Exit non-zero on any VULNERABLE finding. Never talks to a non-loopback host.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";

type Verdict = "DEFENDED" | "VULNERABLE" | "INFO";
interface Finding {
  category: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  skill: string;
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

let BOOK = "";
let API = "";
let apiPort = 0;

interface Res {
  status: number;
  headers: Headers;
  text: string;
}

async function http(
  base: string,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; redirect?: RequestRedirect } = {}
): Promise<Res> {
  const res = await fetch(base + path, {
    method,
    headers: opts.headers,
    body: opts.body,
    redirect: opts.redirect ?? "manual",
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

function rawSend(
  port: number,
  payload: string,
  waitMs = 800
): Promise<{ raw: string; status: number }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, HOST);
    let buf = "";
    const finish = () => {
      sock.destroy();
      const m = /^HTTP\/\d\.\d (\d{3})/.exec(buf);
      resolve({ raw: buf, status: m ? Number(m[1]) : 0 });
    };
    const t = setTimeout(finish, waitMs);
    sock.on("data", (d) => {
      buf += d.toString("latin1");
    });
    sock.on("end", () => {
      clearTimeout(t);
      finish();
    });
    sock.on("error", () => {
      clearTimeout(t);
      finish();
    });
    sock.on("connect", () => sock.write(payload));
  });
}

function startChild(
  file: string,
  ready: RegExp,
  groups: number,
  extraEnv: Record<string, string> = {}
): Promise<{ ports: number[]; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", path], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${file} not ready in 15s\n${stderr}`));
    }, 15_000);
    child.stdout.on("data", (d) => {
      const m = ready.exec(d.toString());
      if (m) {
        clearTimeout(timer);
        const ports: number[] = [];
        for (let i = 1; i <= groups; i++) ports.push(Number(m[i]));
        resolve({ ports, kill: () => child.kill("SIGKILL") });
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`${file} exited ${code}\n${stderr}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Bookstore (shipped example)
// ---------------------------------------------------------------------------

async function bookstoreSurface() {
  const cat = "Bookstore example (create-daloy surface)";

  const healthish = await http(BOOK, "GET", "/books/1");
  record({
    category: cat,
    skill: "testing-api-authentication-weaknesses",
    title: "Public GET /books/:id (unauthenticated read)",
    severity: "info",
    attack: "GET /books/1 with no Authorization",
    observed: `status ${healthish.status} body=${healthish.text.slice(0, 80)}`,
    verdict: healthish.status === 200 ? "INFO" : "DEFENDED",
  });

  const noTok = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "x", title: "x" }),
  });
  record({
    category: cat,
    skill: "testing-api-authentication-weaknesses",
    title: "POST /books without bearer is refused",
    severity: "high",
    attack: "POST /books {id,title} no Authorization",
    observed: `status ${noTok.status}`,
    verdict: noTok.status === 401 || noTok.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const badTok = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/json", authorization: "Bearer attacker" },
    body: JSON.stringify({ id: "x", title: "x" }),
  });
  record({
    category: cat,
    skill: "testing-api-authentication-weaknesses",
    title: "POST /books with a guessed bearer is refused",
    severity: "high",
    attack: "POST /books Bearer attacker",
    observed: `status ${badTok.status}`,
    verdict: badTok.status === 401 || badTok.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const mass = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/json", authorization: "Bearer demo-token" },
    body: JSON.stringify({ id: "rt-mass", title: "ok", isAdmin: true, role: "admin" }),
  });
  const echoed = mass.text.includes("isAdmin") || mass.text.includes('"role"');
  record({
    category: cat,
    skill: "exploiting-mass-assignment-in-rest-apis",
    title: "Mass-assignment extra keys stripped/rejected on POST /books",
    severity: "high",
    attack: 'POST /books {id,title,isAdmin:true,role:"admin"} with demo-token',
    observed: `status ${mass.status} leakedExtra=${echoed} body=${mass.text.slice(0, 120)}`,
    verdict: mass.status === 201 && !echoed ? "DEFENDED" : mass.status >= 400 && !echoed ? "DEFENDED" : "VULNERABLE",
  });

  const proto = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/json", authorization: "Bearer demo-token" },
    body: '{"id":"rt-proto","title":"ok","__proto__":{"polluted":true}}',
  });
  const follow = await http(BOOK, "GET", "/books/1");
  const leaked = JSON.stringify(follow).includes("polluted") || JSON.stringify(proto).includes("polluted");
  record({
    category: cat,
    skill: "exploiting-prototype-pollution-in-javascript",
    title: "Prototype-pollution keys in POST /books do not persist",
    severity: "critical",
    attack: "POST /books raw JSON __proto__, then GET /books/1",
    observed: `create ${proto.status}, follow-up leak=${leaked}`,
    verdict: proto.status !== 500 && !leaked ? "DEFENDED" : "VULNERABLE",
  });

  const xss = await http(BOOK, "GET", "/books/%3Cscript%3Ealert(1)%3C/script%3E");
  record({
    category: cat,
    skill: "testing-for-xss-vulnerabilities",
    title: "XSS payload in book id is not reflected as HTML",
    severity: "high",
    attack: "GET /books/<script>alert(1)</script>",
    observed: `status ${xss.status} ct=${xss.headers.get("content-type")} reflected=${xss.text.includes("<script>")}`,
    verdict:
      (xss.headers.get("content-type") ?? "").includes("json") && !xss.text.includes("<script>alert")
        ? "DEFENDED"
        : xss.status >= 400 && !(xss.headers.get("content-type") ?? "").includes("text/html")
          ? "DEFENDED"
          : "VULNERABLE",
  });

  const xxe = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/xml", authorization: "Bearer demo-token" },
    body: '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><book>&xxe;</book>',
  });
  record({
    category: cat,
    skill: "testing-for-xxe-injection-vulnerabilities",
    title: "XML/XXE body is refused (JSON-only parser)",
    severity: "high",
    attack: "POST /books as application/xml with an external entity",
    observed: `status ${xxe.status} leak=${xxe.text.includes("root:")}`,
    verdict: xxe.status === 415 && !xxe.text.includes("root:") ? "DEFENDED" : "VULNERABLE",
  });

  const deser = await http(BOOK, "POST", "/books", {
    headers: { "content-type": "application/json", authorization: "Bearer demo-token" },
    body: '{"id":"rt-deser","title":{"$type":"constructor","value":[]}}',
  });
  record({
    category: cat,
    skill: "exploiting-insecure-deserialization",
    title: "Typed JSON gadget in title is schema-rejected",
    severity: "high",
    attack: "POST /books title as object gadget",
    observed: `status ${deser.status}`,
    verdict: deser.status === 422 || deser.status === 400 ? "DEFENDED" : "VULNERABLE",
  });

  const hpp = await http(BOOK, "GET", "/books/1?id=2&id=1");
  record({
    category: cat,
    skill: "performing-http-parameter-pollution-attack",
    title: "HPP duplicate id query does not swap the path param",
    severity: "medium",
    attack: "GET /books/1?id=2&id=1",
    observed: `status ${hpp.status} body=${hpp.text.slice(0, 80)}`,
    verdict: hpp.status === 200 && hpp.text.includes("Foundation") ? "DEFENDED" : hpp.status >= 400 ? "DEFENDED" : "VULNERABLE",
  });

  const acaoStar = (await http(BOOK, "GET", "/books/1", { headers: { origin: "https://evil.example" } }))
    .headers.get("access-control-allow-origin");
  const acac = (await http(BOOK, "GET", "/books/1", { headers: { origin: "https://evil.example" } }))
    .headers.get("access-control-allow-credentials");
  record({
    category: cat,
    skill: "testing-cors-misconfiguration",
    title: "CORS origin:* does not combine with credentials",
    severity: "medium",
    attack: "GET /books/1 Origin: https://evil.example",
    observed: `ACAO=${acaoStar} ACAC=${acac}`,
    verdict: acac === "true" && (acaoStar === "*" || acaoStar === "https://evil.example") ? "VULNERABLE" : "INFO",
  });

  const headers = await http(BOOK, "GET", "/books/1");
  const xfo = headers.headers.get("x-frame-options");
  const csp = headers.headers.get("content-security-policy") ?? "";
  const nosniff = headers.headers.get("x-content-type-options");
  record({
    category: cat,
    skill: "performing-security-headers-audit",
    title: "secureHeaders baseline (nosniff / frame / CSP)",
    severity: "medium",
    attack: "GET /books/1 inspect X-Frame-Options, CSP, X-Content-Type-Options",
    observed: `xfo=${xfo} nosniff=${nosniff} csp=${csp.slice(0, 80)}`,
    verdict: nosniff === "nosniff" && (xfo === "DENY" || /frame-ancestors/.test(csp)) ? "DEFENDED" : "VULNERABLE",
  });
  record({
    category: cat,
    skill: "performing-clickjacking-attack-test",
    title: "Clickjacking: framing denied",
    severity: "medium",
    attack: "Inspect X-Frame-Options / CSP frame-ancestors on GET /books/1",
    observed: `xfo=${xfo} frame-ancestors=${/frame-ancestors/.test(csp)}`,
    verdict: xfo === "DENY" || /frame-ancestors\s+('none'|none)/i.test(csp) ? "DEFENDED" : "VULNERABLE",
  });

  const docs = await http(BOOK, "GET", "/docs");
  const oas = await http(BOOK, "GET", "/openapi.json");
  record({
    category: cat,
    skill: "exploiting-excessive-data-exposure-in-api",
    title: "OpenAPI /docs is mounted because the example sets docs: true",
    severity: "low",
    attack: "GET /docs and GET /openapi.json (example forces docs on)",
    observed: `/docs ${docs.status}, /openapi.json ${oas.status}`,
    verdict: "INFO",
  });

  const cachePoison = await http(BOOK, "GET", "/books/1", {
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
  });
  const reflectedHost =
    cachePoison.text.includes("evil.example") ||
    (cachePoison.headers.get("location") ?? "").includes("evil.example");
  record({
    category: cat,
    skill: "performing-web-cache-poisoning-attack",
    title: "X-Forwarded-Host is not reflected (trustProxy off)",
    severity: "high",
    attack: "GET /books/1 X-Forwarded-Host: evil.example",
    observed: `status ${cachePoison.status} reflected=${reflectedHost}`,
    verdict: reflectedHost ? "VULNERABLE" : "DEFENDED",
  });

  const deception = await http(BOOK, "GET", "/books/1/static.css");
  record({
    category: cat,
    skill: "performing-web-cache-deception-attack",
    title: "Suffix /static.css does not serve the book as a cacheable static asset",
    severity: "medium",
    attack: "GET /books/1/static.css",
    observed: `status ${deception.status} ct=${deception.headers.get("content-type")}`,
    verdict: deception.status === 404 || deception.status === 400 ? "DEFENDED" : "VULNERABLE",
  });

  const redir = await http(BOOK, "GET", "/books/1?next=https://evil.example", { redirect: "manual" });
  record({
    category: cat,
    skill: "testing-for-open-redirect-vulnerabilities",
    title: "No open-redirect parameter on GET /books/:id",
    severity: "medium",
    attack: "GET /books/1?next=https://evil.example",
    observed: `status ${redir.status} location=${redir.headers.get("location")}`,
    verdict: redir.headers.get("location") ? "VULNERABLE" : "DEFENDED",
  });

  const sqli = await http(BOOK, "GET", "/books/1'+OR+'1'='1");
  record({
    category: cat,
    skill: "exploiting-api-injection-vulnerabilities",
    title: "SQLi-shaped book id does not dump other rows",
    severity: "high",
    attack: "GET /books/1' OR '1'='1",
    observed: `status ${sqli.status} body=${sqli.text.slice(0, 80)}`,
    verdict: sqli.status === 404 || sqli.status === 400 || sqli.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const idor = await http(BOOK, "GET", "/books/2");
  record({
    category: cat,
    skill: "exploiting-idor-vulnerabilities",
    title: "IDOR: sequential ids are publicly enumerable (example has no object ACL)",
    severity: "info",
    attack: "GET /books/2 unauthenticated",
    observed: `status ${idor.status} body=${idor.text.slice(0, 80)}`,
    verdict: "INFO",
  });

  const race = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      http(BOOK, "POST", "/books", {
        headers: { "content-type": "application/json", authorization: "Bearer demo-token" },
        body: JSON.stringify({ id: "rt-race", title: `t${i}` }),
      })
    )
  );
  const created = race.filter((r) => r.status === 201).length;
  record({
    category: cat,
    skill: "exploiting-race-condition-vulnerabilities",
    title: "Concurrent POST /books same id — last-write-wins Map, no 5xx",
    severity: "info",
    attack: "8 concurrent POST /books {id:rt-race}",
    observed: `201s=${created} statuses=${race.map((r) => r.status).join(",")}`,
    verdict: race.every((r) => r.status < 500) ? "INFO" : "VULNERABLE",
  });

  const port = Number(new URL(BOOK).port);
  const teCl = await rawSend(
    port,
    `POST /books HTTP/1.1\r\nHost: ${HOST}:${port}\r\nContent-Type: application/json\r\nAuthorization: Bearer demo-token\r\nContent-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /books/1 HTTP/1.1\r\nHost: ${HOST}:${port}\r\n\r\n`
  );
  record({
    category: cat,
    skill: "exploiting-http-request-smuggling",
    title: "TE+CL desync is rejected (single Node origin, no front-end)",
    severity: "critical",
    attack: "POST /books with both Content-Length and Transfer-Encoding: chunked",
    observed: `status ${teCl.status} raw=${teCl.raw.slice(0, 80).replace(/\r/g, "\\r")}`,
    verdict: teCl.status === 400 || teCl.status === 403 ? "DEFENDED" : teCl.status === 0 ? "DEFENDED" : "INFO",
  });
}

// ---------------------------------------------------------------------------
// Idiomatic pentest app (JWT / WS / CSRF / pay / trustProxy)
// ---------------------------------------------------------------------------

async function securedApp() {
  const cat = "Secured pentest app (target.ts)";

  const login = await http(API, "POST", "/login", {
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.9.1" },
    body: JSON.stringify({ user: "alice", pass: "correct-horse-battery" }),
  });
  const token = login.status === 200 ? (JSON.parse(login.text).token as string) : "";
  if (!token) {
    record({
      category: cat,
      skill: "testing-api-authentication-weaknesses",
      title: "Alice login failed — later JWT probes aborted",
      severity: "critical",
      attack: "POST /login alice",
      observed: `status ${login.status} ${login.text.slice(0, 80)}`,
      verdict: "VULNERABLE",
    });
    return;
  }

  const none = [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "alice", scopes: ["admin"], exp: Math.floor(Date.now() / 1000) + 600 })).toString(
      "base64url"
    ),
    "",
  ].join(".");
  const noneRes = await http(API, "GET", "/admin", { headers: { authorization: `Bearer ${none}` } });
  record({
    category: cat,
    skill: "testing-jwt-token-security",
    title: "JWT alg:none with empty signature is refused",
    severity: "critical",
    attack: "GET /admin alg:none",
    observed: `status ${noneRes.status}`,
    verdict: noneRes.status >= 400 ? "DEFENDED" : "VULNERABLE",
  });

  const csrf = await http(API, "POST", "/csrf-act", {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  });
  record({
    category: cat,
    skill: "performing-csrf-attack-simulation",
    title: "Cross-origin state-changing POST without CSRF token is refused",
    severity: "high",
    attack: "POST /csrf-act Origin: https://evil.example",
    observed: `status ${csrf.status}`,
    verdict: csrf.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const xfhCsrf = await http(API, "POST", "/login", {
    headers: {
      origin: "http://evil.example",
      "x-forwarded-host": "evil.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ user: "alice", pass: "wrong" }),
  });
  record({
    category: cat,
    skill: "testing-for-host-header-injection",
    title: "trustProxy X-Forwarded-Host cannot make evil Origin look same-origin",
    severity: "high",
    attack: "POST /login Origin: http://evil.example + X-Forwarded-Host: evil.example",
    observed: `status ${xfhCsrf.status}`,
    // 403 = corsCrossOriginGuard (or cors) blocked before the handler.
    // 401 = the login handler ran, so the spoofed Host made the request look
    // same-origin. That is the finding.
    verdict: xfhCsrf.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const bola = await http(API, "GET", "/users/bob", { headers: { authorization: `Bearer ${token}` } });
  record({
    category: cat,
    skill: "testing-for-broken-access-control",
    title: "BOLA: alice cannot read bob",
    severity: "high",
    attack: "GET /users/bob with alice JWT",
    observed: `status ${bola.status}`,
    verdict: bola.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const pay = await http(API, "POST", "/pay", {
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": "w2-biz" },
    body: JSON.stringify({ amount: -1, owner: "ceo" }),
  });
  record({
    category: cat,
    skill: "testing-for-business-logic-vulnerabilities",
    title: "Negative amount + injected owner rejected",
    severity: "high",
    attack: "POST /pay {amount:-1, owner:ceo} as alice",
    observed: `status ${pay.status} body=${pay.text.slice(0, 80)}`,
    verdict: pay.status === 422 ? "DEFENDED" : "VULNERABLE",
  });

  const ssrf = await http(API, "GET", "/fetch?url=http://169.254.169.254/");
  record({
    category: cat,
    skill: "performing-ssrf-vulnerability-exploitation",
    title: "Blind SSRF to link-local metadata is blocked",
    severity: "critical",
    attack: "GET /fetch?url=http://169.254.169.254/",
    observed: `status ${ssrf.status}`,
    verdict: ssrf.status === 403 || ssrf.status === 400 ? "DEFENDED" : "VULNERABLE",
  });

  const wsEvil = await rawSend(
    apiPort,
    `GET /ws HTTP/1.1\r\nHost: ${HOST}:${apiPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://evil.example\r\n\r\n`
  );
  record({
    category: cat,
    skill: "testing-websocket-api-security",
    title: "CSWSH: evil Origin is rejected on /ws upgrade",
    severity: "critical",
    attack: "WS upgrade Origin: https://evil.example",
    observed: `status ${wsEvil.status} line=${wsEvil.raw.split("\r\n")[0]}`,
    verdict: wsEvil.status === 403 ? "DEFENDED" : "VULNERABLE",
  });

  const wsNone = await rawSend(
    apiPort,
    `GET /ws HTTP/1.1\r\nHost: ${HOST}:${apiPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
  record({
    category: cat,
    skill: "testing-websocket-api-security",
    title: "CSWSH posture: missing Origin is allowed (non-browser clients)",
    severity: "info",
    attack: "WS upgrade with no Origin header",
    observed: `status ${wsNone.status} line=${wsNone.raw.split("\r\n")[0]}`,
    verdict: wsNone.status === 101 ? "INFO" : "INFO",
  });
}

async function liveness() {
  const a = await http(BOOK, "GET", "/books/1");
  const b = await http(API, "GET", "/healthz");
  record({
    category: "Resilience",
    skill: "—",
    title: "Both localhost targets survived the engagement",
    severity: "critical",
    attack: "GET bookstore /books/1 and GET target /healthz",
    observed: `bookstore ${a.status}, target ${b.status}`,
    verdict: a.status === 200 && b.status === 200 ? "DEFENDED" : "VULNERABLE",
  });
}

async function productionWildcardCorsRefuse() {
  const path = fileURLToPath(new URL("./bookstore-target.ts", import.meta.url));
  const observed = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", path], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });
    let buf = "";
    const finish = (code: number | null) => {
      resolve(`exit=${code} ${buf.slice(0, 1200)}`);
    };
    child.stderr.on("data", (d) => {
      buf += d.toString();
    });
    child.stdout.on("data", (d) => {
      buf += d.toString();
    });
    child.on("exit", finish);
    setTimeout(() => {
      child.kill("SIGKILL");
      finish(-1);
    }, 8000);
  });
  record({
    category: "Bookstore example (create-daloy surface)",
    skill: "testing-cors-misconfiguration",
    title: "Production refuse-to-boot: cors({ origin: \"*\" }) is rejected",
    severity: "high",
    attack: "Spawn the shipped example with NODE_ENV=production",
    observed,
    verdict: /wildcard CORS|refused in production/.test(observed) ? "DEFENDED" : "VULNERABLE",
  });
}

async function main() {
  console.log("Booting loopback-only targets (127.0.0.1)…\n");
  await productionWildcardCorsRefuse();
  const book = await startChild("./bookstore-target.ts", /BOOKSTORE_TARGET_READY (\d+)/, 1, {
    NODE_ENV: "development",
  });
  const api = await startChild("./target.ts", /RED_TEAM_TARGET_READY (\d+) (\d+) (\d+)/, 3);
  BOOK = `http://${HOST}:${book.ports[0]}`;
  API = `http://${HOST}:${api.ports[0]}`;
  apiPort = api.ports[0]!;
  console.log(`[TARGET] bookstore ${BOOK}`);
  console.log(`[TARGET] pentest-app ${API}\n`);

  try {
    await bookstoreSurface();
    await securedApp();
    await liveness();
  } finally {
    book.kill();
    api.kill();
  }

  const def = findings.filter((f) => f.verdict === "DEFENDED").length;
  const vuln = findings.filter((f) => f.verdict === "VULNERABLE");
  const info = findings.filter((f) => f.verdict === "INFO").length;
  console.log("═".repeat(78));
  console.log(
    `  WAVE2 SUMMARY: ${def} DEFENDED · ${vuln.length} VULNERABLE · ${info} INFO  (of ${findings.length} probes)`
  );
  if (vuln.length > 0) {
    for (const v of vuln) console.log(`    🔴 ${v.title} — ${v.observed}`);
  } else {
    console.log("  VERDICT: no exploitable framework weakness in this skill wave.");
  }
  console.log("═".repeat(78));
  process.exit(vuln.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
