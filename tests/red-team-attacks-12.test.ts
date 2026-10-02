/**
 * Red-team round 12: router capture decoding and `except()` / router path
 * agreement. Found by property-based fuzzing of the Node adapter + router +
 * `except()` stack (Cloudflare "adaptive AI WAF testing" style: mutate paths,
 * look for disagreement between the guard and the dispatcher).
 *
 * 1. Encoded separators in captures: `..%2F..%2Fsecret` bound `*path` as
 *    `"../../secret"` because the dot-segment guard only inspected whole
 *    decoded segments. `%00` / `%0A` also reached handlers.
 * 2. Trailing-slash differential: the router dispatches `/docs/` to `/docs`,
 *    but `except("/docs/*")` matched `/docs/` (empty `*`), skipping auth on the
 *    protected `/docs` handler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { App, bearerAuth, defineWebSocket, except } from "../src/index.js";
import { Router } from "../src/router.js";

const ok = { 200: { description: "ok" } } as const;

function captureRouter() {
  const r = new Router<string>();
  r.add("GET", "/files/*path", "files");
  r.add("GET", "/users/:id", "users");
  return r;
}

test("[capture] ordinary encoded values still bind", () => {
  const r = captureRouter();
  assert.deepEqual(r.find("GET", "/users/42")?.params, { id: "42" });
  assert.deepEqual(r.find("GET", "/users/a%20b")?.params, { id: "a b" });
  assert.deepEqual(r.find("GET", "/users/v1.2")?.params, { id: "v1.2" });
  assert.deepEqual(r.find("GET", "/users/..hidden")?.params, { id: "..hidden" });
  assert.deepEqual(r.find("GET", "/files/a/b.txt")?.params, { path: "a/b.txt" });
  assert.equal(r.find("GET", "/users/42")?.encodedSeparator, undefined);
  assert.equal(r.find("GET", "/files/a/b.txt")?.encodedSeparator, undefined);
});

test("[capture] encoded traversal and control characters never bind", () => {
  const r = captureRouter();
  for (const p of [
    "/files/..%2F..%2Fsecret",
    "/files/%2e%2e%2f",
    "/files/a/..%5C",
    "/files/a%2F..%2Fb",
    "/files/a%2F.",
    "/files/%00",
    "/files/a/%0a",
    "/users/..%2Fadmin",
    "/users/..%5cadmin",
    "/users/%2e%2e%2f",
    "/users/x%00",
    "/users/x%0d%0aSet-Cookie:a",
    "/users/%09",
    "/users/%7f",
  ]) {
    assert.equal(r.find("GET", p), undefined, p);
  }
});

test("[capture] decoded / or \\ is flagged on the match", () => {
  const r = captureRouter();
  const slash = r.find("GET", "/users/book%2F1");
  assert.deepEqual(slash?.params, { id: "book/1" });
  assert.equal(slash?.encodedSeparator, true);
  const back = r.find("GET", "/files/a/b%5Cc");
  assert.deepEqual(back?.params, { path: "a/b\\c" });
  assert.equal(back?.encodedSeparator, true);
});

function captureApp() {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/users/:id",
    responses: ok,
    handler: (ctx) => ({ status: 200 as const, body: { id: ctx.params.id } }),
  });
  app.route({
    method: "GET",
    path: "/books/:id",
    allowEncodedSlash: true,
    responses: ok,
    handler: (ctx) => ({ status: 200 as const, body: { id: ctx.params.id } }),
  });
  return app;
}

test("[capture] encoded slash is a 404 by default", async () => {
  const app = captureApp();
  const res = await app.fetch(new Request("http://x/users/book%2F1"));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("allow"), null);
  assert.equal((await app.fetch(new Request("http://x/users/42"))).status, 200);
});

test("[capture] allowEncodedSlash opts a route in, but not to traversal", async () => {
  const app = captureApp();
  const res = await app.fetch(new Request("http://x/books/book%2F1"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: "book/1" });
  for (const p of ["/books/..%2Fadmin", "/books/a%2F..", "/books/x%00"]) {
    assert.equal((await app.fetch(new Request(`http://x${p}`))).status, 404, p);
  }
});

function exceptApp() {
  const app = new App({ env: "development" });
  app.use(
    except(
      ["/health/", "/public/**", "/docs/*"],
      bearerAuth({ validate: (token) => token === "good" }),
    ),
  );
  for (const [path, name] of [
    ["/health", "health"],
    ["/docs", "docs-index"],
    ["/docs/:page", "docs-page"],
    ["/public", "public-index"],
    ["/public/*rest", "public"],
    ["/api/admin", "admin"],
  ] as const) {
    app.route({
      method: "GET",
      path,
      responses: ok,
      handler: () => ({ status: 200 as const, body: { route: name } }),
    });
  }
  return app;
}

test("[except] trailing slash cannot exempt the protected parent route", async () => {
  const app = exceptApp();
  for (const p of ["/docs", "/docs/", "/docs/.", "/docs/x/..", "/public", "/public/", "/public/./"]) {
    assert.equal((await app.fetch(new Request(`http://x${p}`))).status, 401, p);
  }
});

test("[except] exempt children and trailing-slash patterns still work", async () => {
  const app = exceptApp();
  for (const p of ["/docs/intro", "/docs/intro/", "/public/a", "/public/a/b/", "/health", "/health/"]) {
    assert.equal((await app.fetch(new Request(`http://x${p}`))).status, 200, p);
  }
});

const SEG = fc.constantFrom(
  "api", "admin", "public", "docs", "health", "users", "files", "a",
  ".", "..", "%2e", "%2E%2e", ".%2e", "%2f", "%2F", "%5c", "\\",
  "..%2f", "%2e%2e%2f", "..%5c", "%00", "%0a", "%09", "%20", ";x",
  "%61dmin", "%252e%252e", "%", "",
);
const PATH = fc
  .tuple(
    fc.array(SEG, { minLength: 1, maxLength: 5 }),
    fc.constantFrom("", "/", "?q=1", "#f"),
  )
  .map(([segs, tail]) => "/" + segs.join("/") + tail);

const hasDotOrControl = (v: string) =>
  /[\u0000-\u001f\u007f]/.test(v) ||
  v.split(/[\\/]/).some((c) => c === "." || c === "..");

test("[property] no generated path reaches a protected route without auth", async () => {
  const app = exceptApp();
  const exempt = new Set(["health", "docs-page", "public"]);
  await fc.assert(
    fc.asyncProperty(PATH, async (p) => {
      const res = await app.fetch(new Request(`http://x${p}`));
      if (res.status !== 200) return true;
      const { route } = (await res.json()) as { route: string };
      return exempt.has(route);
    }),
    { numRuns: 1500, seed: 20261002 },
  );
});

test("[property] captures never carry dot components, controls, or unflagged separators", async () => {
  const app = new App({ env: "development" });
  for (const path of ["/files/*path", "/users/:id"] as const) {
    app.route({
      method: "GET",
      path,
      responses: ok,
      handler: (ctx) => ({ status: 200 as const, body: ctx.params }),
    });
  }
  await fc.assert(
    fc.asyncProperty(PATH, async (p) => {
      const res = await app.fetch(new Request(`http://x${p}`));
      if (res.status === 500) return false;
      if (res.status !== 200) return true;
      const params = (await res.json()) as Record<string, string>;
      if (params.id !== undefined && /[\\/]/.test(params.id)) return false;
      return Object.values(params).every((v) => !hasDotOrControl(v));
    }),
    { numRuns: 1500, seed: 20261003 },
  );
});

test("[websocket] upgrade routes refuse encoded separators and traversal", () => {
  const app = new App({ logger: false });
  app.ws("/chat/:room", defineWebSocket({ open: () => {} }));
  app.ws("/files/*path", defineWebSocket({ open: () => {} }));
  assert.deepEqual(app.webSocketRoutes.find("/chat/general")?.params, { room: "general" });
  assert.deepEqual(app.webSocketRoutes.find("/chat/a%20b")?.params, { room: "a b" });
  assert.deepEqual(app.webSocketRoutes.find("/files/a/b")?.params, { path: "a/b" });
  for (const p of [
    "/chat/a%2Fb",
    "/chat/a%5Cb",
    "/chat/..%2Fadmin",
    "/chat/%00",
    "/files/a%2Fb",
    "/files/..%2F..%2Fsecret",
  ]) {
    assert.equal(app.webSocketRoutes.find(p), undefined, p);
  }
});
