/**
 * The transient-failure error classes agree on their wire shape:
 * `TooManyRequestsError` validates `Retry-After` the same way
 * `ServiceUnavailableError` does, and every `RequestTimeoutError` variant
 * (408 / 503 / 504) is uncacheable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import { RequestTimeoutError, TooManyRequestsError } from "../src/errors.js";
import { rateLimit } from "../src/middleware.js";

test("TooManyRequestsError accepts a non-negative integer Retry-After", () => {
  for (const ok of [0, 1, 30, 86_400]) {
    const res = new TooManyRequestsError(ok).toResponse();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), String(ok));
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("TooManyRequestsError refuses a non-integer or negative Retry-After", () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new TooManyRequestsError(bad), RangeError, `accepted ${bad}`);
  }
});

test("TooManyRequestsError without Retry-After is still no-store", () => {
  const res = new TooManyRequestsError().toResponse();
  assert.equal(res.headers.get("retry-after"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("rateLimit() clamps Retry-After to 0 when the store's resetMs is already in the past", async () => {
  // A shared store (Redis, a skewed clock) can report a window that lapsed
  // before this process looked at it; the header must stay a valid integer.
  const app = new App({ logger: false, env: "test" });
  app.use(
    rateLimit({
      max: 1,
      windowMs: 60_000,
      keyGenerator: () => "k",
      store: { hit: async () => ({ count: 2, resetMs: Date.now() - 5_000 }) },
    })
  );
  app.route({
    method: "GET",
    path: "/",
    operationId: "root",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.fetch(new Request("http://localhost/"));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "0");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("RequestTimeoutError is uncacheable for every status variant", () => {
  for (const [status, expected] of [
    [undefined, 408],
    [408, 408],
    [503, 503],
    [504, 504],
  ] as const) {
    const err = status === undefined ? new RequestTimeoutError(5) : new RequestTimeoutError(5, status);
    assert.equal(err.status, expected);
    const res = err.toResponse();
    assert.equal(res.status, expected);
    assert.equal(res.headers.get("cache-control"), "no-store", `status ${expected}`);
  }
});

test("a request deadline answering 503 ships Cache-Control: no-store on the wire", async () => {
  const app = new App({
    logger: false,
    env: "production",
    requestTimeoutMs: 10,
    requestTimeoutStatus: 503,
  });
  app.route({
    method: "GET",
    path: "/slow",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: () =>
      new Promise<{ status: 200; body: undefined }>((resolve) =>
        setTimeout(() => resolve({ status: 200, body: undefined }), 200)
      ),
  });
  const res = await app.fetch(new Request("http://localhost/slow"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.type, "https://daloyjs.dev/errors/request-timeout");
  assert.equal(body.title, "Service Unavailable");
  // 5xx detail is redacted in production.
  assert.equal(body.detail, undefined);
});
