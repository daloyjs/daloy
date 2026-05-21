/**
 * Wave 12 - mature-Node ergonomic-framework second-pass bake-ins
 * regression coverage.
 *
 * Exercises the static gates exported from
 * `scripts/verify-wave12-audits.ts` against the live source tree, and
 * the runtime behavior of the focused-slice defaults:
 *
 *   - The router does not split path segments on `;` (item 1).
 *   - The framework does not ship a standalone `setErrorHandler()` /
 *     `onError()` class method on `App` (item 2).
 *   - `requestId()` defaults to `trustIncoming: false` so client headers
 *     are not honored without an explicit opt-in (item 3).
 *   - The `HttpMethod` allowlist accepts only the seven canonical RFC
 *     7231 + RFC 5789 methods and no runtime `addHttpMethod()` API
 *     exists (item 4).
 *   - Responses produced during graceful shutdown carry
 *     `Connection: close` so HTTP/1.1 load balancers immediately stop
 *     re-using the socket (item 5).
 *
 * @since 0.31.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import { requestId } from "../src/middleware.js";

import { runWave12Audits } from "../scripts/verify-wave12-audits.js";

// ---------- live tree: every static audit passes ----------

test("wave12: all static audits pass on the live source tree", async () => {
  const findings = await runWave12Audits();
  const errors = findings.filter((f) => f.level !== "warn");
  if (errors.length > 0) {
    const summary = errors
      .map(
        (f) =>
          `[${f.audit}] ${f.file}${f.line > 0 ? `:${f.line}` : ""} - ${f.text}: ${f.message}`,
      )
      .join("\n");
    assert.fail(`Wave 12 audit gates flagged ${errors.length} error(s):\n${summary}`);
  }
});

// ---------- item 1: router does not split on `;` ----------

test("wave12: `/foo;bar` and `/foo` are distinct routes (no semicolon delimiter)", async () => {
  const app = new App({ secureDefaults: false });
  app.route({
    method: "GET",
    path: "/foo",
    operationId: "getFoo",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: "foo" }),
  });
  // Request a path that, on a framework that splits on `;`, would route
  // to `/foo`. DaloyJS must NOT route it there - it must 404.
  const matched = await app.request("/foo");
  assert.equal(matched.status, 200);
  const semicolon = await app.request("/foo;admin=true");
  assert.equal(
    semicolon.status,
    404,
    "`/foo;admin=true` must NOT be routed to `/foo` (semicolon is a literal path character).",
  );
});

test("wave12: a route registered with a literal `;` in its path is matched only on the literal", async () => {
  const app = new App({ secureDefaults: false });
  app.route({
    method: "GET",
    path: "/users/42;admin=true",
    operationId: "getLiteral",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: "literal" }),
  });
  const exact = await app.request("/users/42;admin=true");
  assert.equal(exact.status, 200);
  const plain = await app.request("/users/42");
  assert.equal(
    plain.status,
    404,
    "`/users/42` must NOT match a route registered as `/users/42;admin=true`.",
  );
});

// ---------- item 2: no standalone error-handler API on App ----------

test("wave12: App does not expose a `setErrorHandler` method", () => {
  const app = new App({ secureDefaults: false });
  assert.equal(
    (app as unknown as Record<string, unknown>).setErrorHandler,
    undefined,
    "App must not expose a `setErrorHandler()` method. Error handlers " +
      "compose through `use({ onError })` Hook bundles.",
  );
});

test("wave12: App does not expose a standalone `onError` method", () => {
  const app = new App({ secureDefaults: false });
  // `onError` may appear as a Hook bundle key inside object literals
  // passed to `use({ onError })` - that is the intended composition
  // path. What is forbidden is a top-level `App.prototype.onError`
  // method that would let a developer overwrite previously-registered
  // error handlers in a single call.
  const proto = Object.getPrototypeOf(app) as Record<string, unknown>;
  assert.equal(
    typeof proto.onError,
    "undefined",
    "App.prototype.onError must NOT be a method - error handlers " +
      "compose through `use({ onError })` Hook bundles.",
  );
});

// ---------- item 3: requestId() trust default ----------

test("wave12: requestId() ignores client-supplied X-Request-ID by default", async () => {
  const app = new App({ secureDefaults: false });
  app.use(requestId());
  let observed: string | undefined;
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      observed = (state as { requestId?: string }).requestId;
      return { status: 200 as const, body: undefined };
    },
  });
  const attacker = "attacker-injected-id";
  const res = await app.request("/whoami", {
    headers: { "x-request-id": attacker },
  });
  assert.equal(res.status, 200);
  assert.notEqual(
    observed,
    attacker,
    "Wave 12 item 6: requestId() must NOT honor client-supplied " +
      "`X-Request-ID` by default.",
  );
  assert.equal(
    res.headers.get("x-request-id"),
    observed,
    "The response header must reflect the framework-generated id.",
  );
});

test("wave12: requestId({ trustIncoming: true }) accepts a valid client header", async () => {
  const app = new App({ secureDefaults: false });
  app.use(requestId({ trustIncoming: true }));
  let observed: string | undefined;
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoamiTrust",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      observed = (state as { requestId?: string }).requestId;
      return { status: 200 as const, body: undefined };
    },
  });
  const clientId = "client-supplied-id-12345";
  const res = await app.request("/whoami", {
    headers: { "x-request-id": clientId },
  });
  assert.equal(res.status, 200);
  assert.equal(
    observed,
    clientId,
    "Opt-in trust must accept a valid client header.",
  );
});

// ---------- item 4: HttpMethod allowlist ----------

test("wave12: registering a route with a non-canonical HTTP method is refused", () => {
  const app = new App({ secureDefaults: false });
  assert.throws(
    () =>
      app.route({
        // Force a non-canonical method through an unsafe cast - the
        // runtime guard must still refuse it.
        method: "TRACE" as unknown as "GET",
        path: "/trace",
        operationId: "trace",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: undefined }),
      }),
    /TRACE|method/i,
    "Wave 12 item 11: route registration must refuse non-canonical " +
      "HTTP methods at runtime (TRACE, CONNECT, WebDAV verbs, etc.).",
  );
});

// ---------- item 5: 503 during draining carries Connection: close ----------

test("wave12: responses produced while draining carry `Connection: close`", async () => {
  const app = new App({ secureDefaults: false });
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: "pong" }),
  });
  // Pre-warm the dispatcher so the route is fully registered.
  const before = await app.fetch(new Request("http://x/ping"));
  assert.equal(before.status, 200);
  assert.equal(
    before.headers.get("connection"),
    null,
    "Non-draining responses must NOT advertise `Connection: close`.",
  );
  // Start the drain - close() flips the `draining` flag immediately.
  const closing = app.close({ timeoutMs: 100 });
  const during = await app.fetch(new Request("http://x/ping"));
  await closing;
  assert.equal(
    during.headers.get("connection"),
    "close",
    "Wave 12 item 17: every response produced while draining must " +
      "carry `Connection: close`.",
  );
});
