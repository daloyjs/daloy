/**
 * `ServiceUnavailableError` (503): stable daloyjs.dev `type`, an uncacheable
 * response, a validated `Retry-After`, and 5xx `detail` redaction outside an
 * explicit development/test environment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import { ServiceUnavailableError } from "../src/errors.js";
import { ServiceUnavailableError as BarrelServiceUnavailableError } from "../src/index.js";

function appThrowing(env: "development" | "production", err: () => never): App {
  const app = new App({ env, logger: false });
  app.route({
    method: "GET",
    path: "/down",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: () => err(),
  });
  return app;
}

test("ServiceUnavailableError is exported from the barrel", () => {
  assert.equal(BarrelServiceUnavailableError, ServiceUnavailableError);
});

test("ServiceUnavailableError sets a daloyjs.dev type, Retry-After and no-store", async () => {
  const err = new ServiceUnavailableError(30);
  assert.equal(err.name, "ServiceUnavailableError");
  assert.equal(err.status, 503);
  const res = err.toResponse();
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "30");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.type, "https://daloyjs.dev/errors/service-unavailable");
  assert.equal(body.title, "Service Unavailable");
  assert.equal(body.status, 503);
});

test("ServiceUnavailableError without retryAfterSeconds sends no Retry-After", () => {
  const res = new ServiceUnavailableError().toResponse();
  assert.equal(res.headers.get("retry-after"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("ServiceUnavailableError accepts Retry-After: 0", () => {
  const res = new ServiceUnavailableError(0).toResponse();
  assert.equal(res.headers.get("retry-after"), "0");
});

test("ServiceUnavailableError refuses a non-integer or negative retryAfterSeconds", () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new ServiceUnavailableError(bad), RangeError, `accepted ${bad}`);
  }
});

test("ServiceUnavailableError thrown in a handler keeps its headers on the wire", async () => {
  const app = appThrowing("production", () => {
    throw new ServiceUnavailableError(45, "database failover in progress");
  });
  const res = await app.fetch(new Request("http://localhost/down"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "45");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.type, "https://daloyjs.dev/errors/service-unavailable");
  // Unhappy path for leakage: production redacts the 5xx detail.
  assert.equal(body.detail, undefined);
  assert.doesNotMatch(JSON.stringify(body), /failover/);
});

test("ServiceUnavailableError detail is shown only in an explicit development env", async () => {
  const app = appThrowing("development", () => {
    throw new ServiceUnavailableError(undefined, "database failover in progress");
  });
  const res = await app.fetch(new Request("http://localhost/down"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.detail, "database failover in progress");
});
