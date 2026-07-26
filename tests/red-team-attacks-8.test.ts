/**
 * RED-TEAM ATTACK SUITE — WAVE 8 (OWASP WSTG / web-app + API methodology pass)
 * ===========================================================================
 *
 * A systematic sweep against the OWASP Web Security Testing Guide categories
 * (the methodology Doyensec co-authored), focused on the classes the earlier
 * waves had not yet exercised end-to-end: rendered-HTML XSS in the API docs,
 * HTTP Parameter Pollution, HTTP verb tampering / Cross-Site Tracing, and
 * CORS origin-matching bypasses. Every probe confirmed the framework already
 * defends the class; this wave locks those defenses in.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, cors } from "../src/index.js";
import { scalarHtml, redocHtml } from "../src/docs.js";

// ===========================================================================
// WSTG-CLNT / Data Validation — reflected XSS in the generated API-docs HTML
// ===========================================================================

const XSS = `"><script>PWNED</script>`;

test("[wstg/docs-xss] scalarHtml escapes a malicious title and specUrl (no tag/attr breakout)", () => {
  const html = scalarHtml({ title: XSS, specUrl: `https://x/${XSS}` });
  assert.ok(!html.includes("<script>PWNED"), "no <script> breakout from the title");
  assert.ok(!html.includes("PWNED</script>"), "no </script> breakout");
  assert.ok(!html.includes(`"><script`), "no attribute breakout");
  assert.ok(
    html.includes("PWNED"),
    "the value is still present (escaped), proving it was embedded"
  );
});

test("[wstg/docs-xss] redocHtml escapes a malicious title and specUrl", () => {
  const html = redocHtml({ title: XSS, specUrl: `https://x/${XSS}` });
  assert.ok(!html.includes("<script>PWNED"));
  assert.ok(!html.includes("PWNED</script>"));
  assert.ok(!html.includes(`"><script`));
});

// ===========================================================================
// WSTG-INPV — HTTP Parameter Pollution
// ===========================================================================

test("[wstg/hpp] duplicate query params become an array and cannot smuggle past a string schema", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "GET",
    path: "/q",
    operationId: "q",
    request: { query: z.object({ role: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ role: z.string() }) as any } },
    handler: async ({ query }: any) => ({ status: 200 as const, body: { role: query.role } }),
  });
  // A single value validates and passes through unchanged.
  const single = await app.request("/q?role=user");
  assert.equal(single.status, 200);
  assert.equal((await single.json()).role, "user");

  // Polluted params surface as ["user","admin"] — which a string schema rejects,
  // so the attacker cannot smuggle "admin" past a `z.string()` field.
  const polluted = await app.request("/q?role=user&role=admin");
  assert.equal(polluted.status, 422, "duplicate params -> array -> rejected by the string schema");
});

// ===========================================================================
// WSTG-CONF / WSTG-INPV — HTTP verb tampering & Cross-Site Tracing (XST)
// ===========================================================================

test("[wstg/verb-tampering] an undeclared method on a route returns 405 and never runs the handler", async () => {
  let ran = false;
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      ran = true;
      return { status: 200 as const, body: { ok: true } };
    },
  });
  for (const m of ["PUT", "DELETE", "PATCH", "FOOBAR"]) {
    assert.equal((await app.request("/r", { method: m })).status, 405, `${m} -> 405`);
  }
  assert.equal(ran, false, "no undeclared verb reached the GET handler");
});

test("[wstg/xst] the TRACE method is not dispatchable (no Cross-Site Tracing)", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  // The WHATWG Request constructor forbids TRACE/TRACK/CONNECT, so the request
  // is rejected before it can ever reach a handler — XST is not reachable. Use a
  // thunk so the assertion captures the (synchronous) constructor throw too.
  await assert.rejects(
    async () => app.request("/r", { method: "TRACE" }),
    "TRACE must not be processable"
  );
});

// ===========================================================================
// WSTG-CLNT — CORS origin-matching bypasses
// ===========================================================================

test("[wstg/cors] allowlist matching is exact — no prefix/suffix/null bypass", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(cors({ origin: "https://good.example" }));
  app.route({
    method: "GET",
    path: "/d",
    operationId: "d",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const acao = async (origin: string) =>
    (await app.request("/d", { headers: { origin } })).headers.get("access-control-allow-origin");

  // Exact match is reflected.
  assert.equal(await acao("https://good.example"), "https://good.example");
  // Superstring (attacker-controlled suffix) — the classic regex/substring bug.
  assert.equal(await acao("https://good.example.evil.com"), null);
  // Substring / prefix.
  assert.equal(await acao("https://good.exampl"), null);
  // Different scheme.
  assert.equal(await acao("http://good.example"), null);
  // The opaque "null" origin (sandboxed iframe / data: / file:) is not reflected.
  assert.equal(await acao("null"), null);
});
