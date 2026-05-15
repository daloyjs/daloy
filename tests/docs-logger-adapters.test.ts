import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../src/index.js";
import { scalarHtml, swaggerUiHtml, htmlResponse, docsContentSecurityPolicy } from "../src/docs.js";
import { createLogger } from "../src/logger.js";
import { toFetchHandler } from "../src/adapters/cloudflare.js";
import { toEdgeHandler } from "../src/adapters/vercel.js";
import { serve as serveBun } from "../src/adapters/bun.js";
import { serve as serveDeno } from "../src/adapters/deno.js";

test("docs HTML escapes untrusted title and spec URL", () => {
  const scalar = scalarHtml({ title: "<img>", specUrl: "/openapi.json?x=<script>" });
  assert.match(scalar, /&lt;img&gt;/);
  assert.match(scalar, /\/openapi\.json\?x=&lt;script&gt;/);
  assert.doesNotMatch(scalar, /<img>/);

  const swagger = swaggerUiHtml({ title: "Docs & API", specUrl: "\";alert(1)//" });
  assert.match(swagger, /Docs &amp; API/);
  assert.doesNotMatch(swagger, /";alert\(1\)\/\//);
});

test("docs helpers support self-hosted assets and nonce-based scripts", () => {
  const scalar = scalarHtml({
    specUrl: "/openapi.json",
    scriptNonce: "nonce-123",
    assets: { scalarScriptUrl: "/docs-assets/scalar.js" },
  });
  assert.match(scalar, /src="\/docs-assets\/scalar\.js"/);
  assert.match(scalar, /nonce="nonce-123"/);

  const swagger = swaggerUiHtml({
    specUrl: "/openapi.json",
    scriptNonce: "nonce-123",
    assets: {
      swaggerUiCssUrl: "/docs-assets/swagger-ui.css",
      swaggerUiBundleUrl: "/docs-assets/swagger-ui.js",
    },
  });
  assert.match(swagger, /href="\/docs-assets\/swagger-ui\.css"/);
  assert.match(swagger, /src="\/docs-assets\/swagger-ui\.js"/);
  assert.match(swagger, /nonce="nonce-123"/);
});

test("htmlResponse sets HTML content type and strict docs headers", async () => {
  const res = htmlResponse("<p>ok</p>");
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy") ?? "", /cdn\.jsdelivr\.net/);
  assert.equal(await res.text(), "<p>ok</p>");
});

test("htmlResponse can emit a self-hosted nonce-based docs CSP", () => {
  const nonce = "nonce-123";
  const res = htmlResponse("<p>ok</p>", {
    assetOrigins: [],
    scriptNonce: nonce,
    allowInlineStyles: false,
  });
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'nonce-nonce-123'/);
  assert.doesNotMatch(csp, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
});

test("docsContentSecurityPolicy can target custom asset origins", () => {
  const csp = docsContentSecurityPolicy({ assetOrigins: ["https://docs.example.com"], scriptNonce: "abc" });
  assert.match(csp, /script-src 'self' https:\/\/docs\.example\.com 'nonce-abc'/);
  assert.match(csp, /style-src 'self' https:\/\/docs\.example\.com 'unsafe-inline'/);
});

test("structured logger respects level, child bindings, and string messages", () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "warn", bindings: { app: "test" }, write: (line) => lines.push(line) });
  logger.info("hidden");
  logger.warn({ route: "/x" }, "warned");
  logger.child({ requestId: "r1" }).error("failed");

  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), { level: "warn", app: "test", route: "/x", msg: "warned", time: JSON.parse(lines[0]!).time });
  const err = JSON.parse(lines[1]!);
  assert.equal(err.level, "error");
  assert.equal(err.app, "test");
  assert.equal(err.requestId, "r1");
  assert.equal(err.msg, "failed");
});

test("cloudflare and vercel adapters delegate to app.fetch", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const cf = await toFetchHandler(app).fetch(new Request("http://test.local/ok"));
  const edge = await toEdgeHandler(app)(new Request("http://test.local/ok"));
  assert.equal(cf.status, 200);
  assert.equal(edge.status, 200);
  assert.deepEqual(await cf.json(), { ok: true });
  assert.deepEqual(await edge.json(), { ok: true });
});

test("bun and deno adapters fail loudly outside their runtimes", () => {
  assert.throws(() => serveBun(new App({ logger: false })), /Bun runtime not detected/);
  assert.throws(() => serveDeno(new App({ logger: false })), /Deno runtime not detected/);
});
