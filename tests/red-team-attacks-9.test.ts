/**
 * RED-TEAM ATTACK SUITE — WAVE 9 (Doyensec WAPT methodology, live-service pass)
 * ===========================================================================
 *
 * Run as an authorized penetration test against THIS framework, using the
 * Doyensec "Web Applications and APIs" methodology as the checklist. Every
 * probe stands up a real `App` (or the real logger) in the test harness and
 * fires the attack the way an external assessor would, then asserts the
 * framework HELD THE LINE.
 *
 * This wave deliberately targets the Doyensec categories the earlier waves
 * (1–8) had not exercised end-to-end:
 *
 *   - Information Gathering  — framework fingerprinting, error-code disclosure,
 *                             request-id predictability.
 *   - Authentication        — account enumeration (username oracle), uniform
 *                             auth failure, brute-force lock-out throttling.
 *   - Cryptography          — entropy / unpredictability of generated ids.
 *   - Session Management     — cross-session "session puzzling" isolation.
 *   - Data Validation        — XXE structural impossibility, log injection.
 *   - Configuration / Client — clickjacking + HSTS posture, Host-header
 *                             injection / cache poisoning, CORS preflight
 *                             configuration disclosure.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  cors,
  rateLimit,
  basicAuth,
  bearerAuth,
  session,
  createLogger,
} from "../src/index.js";

// A 32-byte session secret (the secure floor is 16 chars).
const SESSION_SECRET = "wave9-session-secret-32-bytes-min!";

/** Stand up a minimal app with one GET route returning `{ ok: true }`. */
function pingApp(env: "development" | "production" = "development"): App {
  const app = new App({ env, logger: false });
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

// A v4 UUID, the shape `crypto.randomUUID()` (the framework's CSPRNG id source) emits.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ===========================================================================
// Information Gathering — framework fingerprinting & error-code disclosure
// (WSTG-INFO-02 "Fingerprint Web Application Framework", -08 "Error Codes")
// ===========================================================================

test("[info/fingerprint] no Server / X-Powered-By / runtime headers on 200, 404, or 405", async () => {
  const app = pingApp();
  const probes = [
    await app.request("/ping"), // 200
    await app.request("/does-not-exist"), // 404
    await app.request("/ping", { method: "POST" }), // 405 (undeclared verb)
  ];
  assert.deepEqual(
    probes.map((r) => r.status),
    [200, 404, 405],
    "the three probe statuses are as expected"
  );
  const leaky = ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-runtime"];
  for (const res of probes) {
    for (const h of leaky) {
      assert.equal(res.headers.get(h), null, `${h} must never be sent (status ${res.status})`);
    }
  }
});

test("[info/errors] 404 / 405 bodies are RFC 9457 and leak no stack, file path, or framework internals", async () => {
  const app = pingApp("production"); // prod is the strictest redaction mode
  for (const res of [
    await app.request("/nope"),
    await app.request("/ping", { method: "DELETE" }),
  ]) {
    assert.equal(
      res.headers.get("content-type"),
      "application/problem+json",
      "errors are problem+json (RFC 9457)"
    );
    const text = await res.text();
    assert.ok(!/\/Users\/|\/home\/|[A-Za-z]:\\/.test(text), "no absolute filesystem path leaks");
    assert.ok(!text.includes("node:internal"), "no Node internal module path leaks");
    assert.ok(!/\.ts:\d+|\.js:\d+/.test(text), "no source-file:line leaks");
    assert.ok(!/\n\s*at\s+/.test(text), "no V8 stack frame leaks");
  }
});

test("[info/request-id] the x-request-id is a high-entropy v4 UUID, not a guessable counter", async () => {
  const app = pingApp();
  const ids: string[] = [];
  for (let i = 0; i < 256; i++) {
    const id = (await app.request("/ping")).headers.get("x-request-id");
    assert.ok(id, "every response carries an x-request-id");
    assert.match(id!, UUID_V4, "request id is a v4 UUID (CSPRNG-sourced)");
    ids.push(id!);
  }
  assert.equal(new Set(ids).size, ids.length, "no two request ids collide");
  // A predictable scheme (counter, timestamp) would leave most ids sharing a
  // long common prefix. Random UUIDs do not.
  const sharePrefix = ids.filter((id) => id.slice(0, 8) === ids[0]!.slice(0, 8)).length;
  assert.ok(sharePrefix < ids.length / 4, "ids are not sequentially prefixed (not a counter)");
});

// ===========================================================================
// Authentication — account enumeration & uniform failure
// (WSTG-IDNT-04 "Account Enumeration", WSTG-ATHN-* weak lock-out)
// ===========================================================================

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

test("[authn/enum] basicAuth gives a byte-identical 401 for an unknown user vs a known user with a wrong password", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(
    basicAuth({
      realm: "api",
      verify: (u, p) => (u === "alice" && p === "s3cret-correct" ? { username: u } : false),
    })
  );
  app.route({
    method: "GET",
    path: "/vault",
    operationId: "vault",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const unknownUser = await app.request("/vault", {
    headers: { authorization: basic("bob", "whatever") },
  });
  const knownUserWrongPass = await app.request("/vault", {
    headers: { authorization: basic("alice", "WRONG") },
  });

  assert.equal(unknownUser.status, 401);
  assert.equal(knownUserWrongPass.status, 401);
  // The whole observable response must be identical — no username oracle.
  assert.equal(
    await unknownUser.text(),
    await knownUserWrongPass.text(),
    "identical bodies (no enumeration)"
  );
  assert.equal(
    unknownUser.headers.get("www-authenticate"),
    knownUserWrongPass.headers.get("www-authenticate"),
    "identical WWW-Authenticate challenge"
  );
  // Sanity: the correct credentials DO get in (the guard isn't just always-401).
  const good = await app.request("/vault", {
    headers: { authorization: basic("alice", "s3cret-correct") },
  });
  assert.equal(good.status, 200);
});

test("[authn/enum] bearerAuth returns a uniform 403 for any invalid token; missing token is a 401 challenge", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(bearerAuth({ realm: "api", validate: async (t) => t === "the-one-valid-token" }));
  app.route({
    method: "GET",
    path: "/api",
    operationId: "api",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  // No credentials → 401 + challenge (RFC 6750), tells the client to authenticate.
  const missing = await app.request("/api");
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate") ?? "", /^Bearer/);

  // Two structurally different invalid tokens must be indistinguishable: a
  // short opaque token vs a JWT-shaped one both get the same 403.
  const opaque = await app.request("/api", { headers: { authorization: "Bearer deadbeef" } });
  const jwtish = await app.request("/api", {
    headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9." },
  });
  assert.equal(opaque.status, 403);
  assert.equal(jwtish.status, 403);
  // The two bodies differ ONLY by the per-request `instance` correlation id
  // (a random `urn:request:<uuid>` mandated by RFC 9457). That carries no
  // token-state signal, so an attacker still cannot tell the two apart: every
  // oracle-relevant field (type/title/detail/status) is identical.
  const stripTrace = (p: Record<string, unknown>) => {
    const { instance: _drop, ...rest } = p;
    return rest;
  };
  assert.deepEqual(
    stripTrace(await opaque.json()),
    stripTrace(await jwtish.json()),
    "invalid tokens are indistinguishable apart from the random trace id (no oracle)"
  );

  // Sanity: the valid token gets in.
  assert.equal(
    (await app.request("/api", { headers: { authorization: "Bearer the-one-valid-token" } }))
      .status,
    200
  );
});

test("[authn/lockout] rate-limit throttles a credential brute-force before unlimited guessing", async () => {
  const app = new App({ env: "development", logger: false });
  // Throttle first so attempts are capped regardless of the (wrong) credentials.
  app.use(rateLimit({ windowMs: 60_000, max: 3, keyGenerator: () => "attacker-fixed-key" }));
  app.use(basicAuth({ realm: "api", verify: () => false }));
  app.route({
    method: "GET",
    path: "/login",
    operationId: "login",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push(
      (await app.request("/login", { headers: { authorization: basic("alice", `guess-${i}`) } }))
        .status
    );
  }
  // First 3 hit the auth wall (401); attempts 4+ are shed by the limiter (429).
  assert.deepEqual(
    statuses.slice(0, 3),
    [401, 401, 401],
    "first attempts reach the (failing) auth check"
  );
  assert.ok(
    statuses.slice(3).every((s) => s === 429),
    `brute force is throttled after the cap (got ${statuses.join(",")})`
  );
});

// ===========================================================================
// Cryptography — entropy / unpredictability of generated identifiers
// (WSTG-CRYP "Insufficient entropy" / weak randomness)
// ===========================================================================

test("[crypto/entropy] freshly minted session ids are all unique and high-entropy", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(session({ secret: SESSION_SECRET }));
  app.route({
    method: "GET",
    path: "/new-session",
    operationId: "newSession",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }) as any } },
    handler: async ({ state }: any) => {
      state.session.set("touched", "1"); // force a real session id to be minted
      return { status: 200 as const, body: { id: state.session.id } };
    },
  });

  const ids: string[] = [];
  for (let i = 0; i < 200; i++) {
    // No Cookie header on any request → every call mints a brand-new session.
    const id = (await (await app.request("/new-session")).json()).id as string;
    assert.ok(typeof id === "string" && id.length >= 16, "session id is non-trivially long");
    ids.push(id);
  }
  assert.equal(new Set(ids).size, ids.length, "no two anonymous sessions collide");
});

// ===========================================================================
// Session Management — cross-session isolation ("session puzzling")
// (WSTG-SESS-09 "Session Puzzling")
// ===========================================================================

test("[session/puzzling] data written under one session never leaks into another", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(session({ secret: SESSION_SECRET }));
  app.route({
    method: "POST",
    path: "/elevate",
    operationId: "elevate",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }) as any } },
    handler: async ({ state }: any) => {
      state.session.set("role", "admin");
      return { status: 200 as const, body: { id: state.session.id } };
    },
  });
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: {
      200: { description: "ok", body: z.object({ role: z.string().nullable() }) as any },
    },
    handler: async ({ state }: any) => ({
      status: 200 as const,
      body: { role: state.session.get("role") ?? null },
    }),
  });

  // Victim elevates to admin and receives their own session cookie.
  const elevated = await app.request("/elevate", { method: "POST" });
  const cookie = elevated.headers.get("set-cookie");
  assert.ok(cookie, "an authenticated session cookie was issued");

  // A DIFFERENT, cookie-less client must NOT inherit the admin role.
  const anon = await (await app.request("/whoami")).json();
  assert.equal(anon.role, null, "no cross-session leakage: anonymous client is not admin");

  // The victim, presenting their cookie, still sees their own data — proving
  // the role was bound to the session, not stored in shared global state.
  const owner = await (
    await app.request("/whoami", { headers: { cookie: cookie!.split(";")[0]! } })
  ).json();
  assert.equal(owner.role, "admin", "the owning session still reads its own data");
});

// ===========================================================================
// Data Validation — XXE structural impossibility & log injection
// (WSTG-INPV-07 "XML External Entity", second-order / log injection)
// ===========================================================================

test("[inpv/xxe] an XML/SVG body carrying an external entity is rejected at content-type — no XML parser is reachable", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "POST",
    path: "/items",
    operationId: "items",
    request: { body: z.object({ name: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const xxe = `<?xml version="1.0"?><!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><foo>&xxe;</foo>`;
  for (const ct of ["application/xml", "text/xml", "image/svg+xml"]) {
    const res = await app.request("/items", {
      method: "POST",
      headers: { "content-type": ct },
      body: xxe,
    });
    assert.equal(res.status, 415, `${ct} is rejected as unsupported media type (never XML-parsed)`);
  }
});

test("[inpv/log-injection] CRLF + ANSI escapes in a logged value cannot forge a second log record", async () => {
  const lines: string[] = [];
  const log = createLogger({ write: (l) => lines.push(l) });

  // Attacker controls a header value and tries to inject a fake "fatal" record
  // plus a terminal-escape colour code to corrupt a console/SIEM tail.
  const hostile = 'Mozilla\r\n{"level":"fatal","msg":"FORGED ROOT LOGIN"}[31m ';
  log.info({ userAgent: hostile, path: "/normal" }, "request");

  assert.equal(lines.length, 1, "exactly one record was written — no injected second line");
  const line = lines[0]!;
  assert.ok(!line.includes("\n") && !line.includes("\r"), "no raw CR/LF can split the record");
  const parsed = JSON.parse(line); // a corrupted line would not be valid JSON
  assert.equal(
    parsed.userAgent,
    hostile,
    "the payload survives intact as escaped data, not structure"
  );
  assert.equal(parsed.level, "info", "the attacker's forged level did not override the real one");
});

// ===========================================================================
// Configuration / Client-Side — clickjacking, HSTS, Host injection, CORS
// (WSTG-CLNT-09 "Clickjacking", WSTG-CONF HSTS / Host header, CORS)
// ===========================================================================

test("[clnt/clickjacking] every response ships X-Frame-Options: DENY + CSP frame-ancestors 'none' + HSTS", async () => {
  const res = await pingApp().request("/ping");
  assert.equal(res.headers.get("x-frame-options"), "DENY", "framing is denied outright");
  assert.ok(
    (res.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"),
    "CSP also forbids framing (defense in depth)"
  );
  const hsts = res.headers.get("strict-transport-security") ?? "";
  assert.match(hsts, /max-age=\d{7,}/, "HSTS max-age is at least ~months (a year by default)");
  assert.ok(hsts.includes("includeSubDomains"), "HSTS covers subdomains");
});

test("[conf/host-injection] a forged Host / X-Forwarded-Host is not reflected into the OpenAPI server list", async () => {
  const app = new App({
    env: "development",
    logger: false,
    docs: true,
    openapi: {
      info: { title: "API", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
    },
  });
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/openapi.json", {
    headers: { host: "evil.attacker.test", "x-forwarded-host": "evil.attacker.test" },
  });
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.deepEqual(
    spec.servers,
    [{ url: "https://api.example.com" }],
    "the server list is the configured value, not the attacker's Host"
  );
  assert.ok(
    !JSON.stringify(spec).includes("evil.attacker.test"),
    "the forged host is reflected nowhere in the spec (no cache/link poisoning sink)"
  );
});

test("[clnt/cors-preflight] a disallowed origin's preflight leaks no CORS config; an allowed origin echoes the exact origin (never *)", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(cors({ origin: "https://good.example", credentials: true }));
  app.route({
    method: "GET",
    path: "/d",
    operationId: "d",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const preflight = (origin: string) =>
    app.request("/d", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });

  // Disallowed origin: no ACAO, no credentials, no methods/headers allowlist
  // (the API's accepted surface is NOT disclosed to an untrusted origin).
  const evil = await preflight("https://evil.example");
  assert.equal(
    evil.headers.get("access-control-allow-origin"),
    null,
    "no ACAO for a disallowed origin"
  );
  assert.equal(evil.headers.get("access-control-allow-credentials"), null, "no credentials grant");
  assert.equal(
    evil.headers.get("access-control-allow-methods"),
    null,
    "method allowlist not leaked"
  );
  assert.equal(
    evil.headers.get("access-control-allow-headers"),
    null,
    "header allowlist not leaked"
  );
  assert.ok(
    (evil.headers.get("vary") ?? "").includes("Origin"),
    "Vary: Origin prevents cache poisoning"
  );

  // Allowed origin: the EXACT origin is echoed (never the wildcard, which is
  // illegal with credentials anyway), plus the credentials grant.
  const good = await preflight("https://good.example");
  assert.equal(
    good.headers.get("access-control-allow-origin"),
    "https://good.example",
    "exact origin, not *"
  );
  assert.equal(good.headers.get("access-control-allow-credentials"), "true");
  assert.ok(
    (good.headers.get("access-control-allow-methods") ?? "").length > 0,
    "methods advertised to a trusted origin"
  );
});
