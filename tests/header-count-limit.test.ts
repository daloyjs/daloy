import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  assertHeaderCountWithinLimit,
  DEFAULT_MAX_HEADER_COUNT,
  RequestHeaderFieldsTooLargeError,
} from "../src/index.js";

/** Build a Headers object carrying `n` distinct header fields. */
function headersWithCount(n: number): Headers {
  const h = new Headers();
  for (let i = 0; i < n; i++) h.set(`x-test-${i}`, "1");
  return h;
}

test("DEFAULT_MAX_HEADER_COUNT is a sane finite cap", () => {
  assert.equal(DEFAULT_MAX_HEADER_COUNT, 100);
});

test("assertHeaderCountWithinLimit allows a request at the limit (happy path)", () => {
  assert.doesNotThrow(() =>
    assertHeaderCountWithinLimit(headersWithCount(100), 100),
  );
});

test("assertHeaderCountWithinLimit rejects a header flood (unhappy path)", () => {
  assert.throws(
    () => assertHeaderCountWithinLimit(headersWithCount(101), 100),
    RequestHeaderFieldsTooLargeError,
  );
});

test("assertHeaderCountWithinLimit treats 0 as disabled", () => {
  assert.doesNotThrow(() =>
    assertHeaderCountWithinLimit(headersWithCount(5000), 0),
  );
});

test("assertHeaderCountWithinLimit treats negative / non-finite as disabled", () => {
  assert.doesNotThrow(() =>
    assertHeaderCountWithinLimit(headersWithCount(500), -1),
  );
  assert.doesNotThrow(() =>
    assertHeaderCountWithinLimit(headersWithCount(500), Number.NaN),
  );
  assert.doesNotThrow(() =>
    assertHeaderCountWithinLimit(headersWithCount(500), Number.POSITIVE_INFINITY),
  );
});

test("RequestHeaderFieldsTooLargeError renders RFC 9457 431", () => {
  const err = new RequestHeaderFieldsTooLargeError(100);
  const res = err.toResponse();
  assert.equal(res.status, 431);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
});

test("App rejects a header-count flood with 431 (unhappy path)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/ok", { headers: headersWithCount(200) });
  assert.equal(res.status, 431);
  const body = (await res.json()) as { type: string; status: number };
  assert.equal(body.status, 431);
  assert.match(body.type, /request-header-fields-too-large/);
});

test("App allows a normal request under the default cap (happy path)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/ok", {
    headers: { accept: "application/json", "x-trace": "abc" },
  });
  assert.equal(res.status, 200);
});

test("App maxHeaderCount: 0 disables the guard", async () => {
  const app = new App({ logger: false, maxHeaderCount: 0 });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/ok", { headers: headersWithCount(500) });
  assert.equal(res.status, 200);
});

test("App maxHeaderCount: custom tighter cap is enforced", async () => {
  const app = new App({ logger: false, maxHeaderCount: 10 });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const tooMany = await app.request("/ok", { headers: headersWithCount(20) });
  assert.equal(tooMany.status, 431);
  const justRight = await app.request("/ok", { headers: headersWithCount(5) });
  assert.equal(justRight.status, 200);
});

test("getSecurityPosture reports the resolved maxHeaderCount", () => {
  const dflt = new App({ logger: false });
  assert.equal(dflt.getSecurityPosture().maxHeaderCount, 100);
  const custom = new App({ logger: false, maxHeaderCount: 42 });
  assert.equal(custom.getSecurityPosture().maxHeaderCount, 42);
});
