/**
 * Regression tests for the Qinglong-class authentication-bypass pattern
 * disclosed as CVE-2026-3965 / CVE-2026-4047
 * (https://snyk.io/blog/qinglong-task-scheduler-rce-vulnerabilities/).
 *
 * Both Qinglong CVEs share the same root cause: a mismatch between the
 * security middleware's idea of "what path this request is on" and the
 * framework's actual routing logic. In Qinglong:
 *
 *   - CVE-2026-3965: a `/open/*` → `/api/*` URL rewrite let unauthenticated
 *     requests reach an admin handler whose auth middleware was scoped to
 *     `/api/*`.
 *   - CVE-2026-4047: the auth middleware compared the path case-sensitively
 *     to `/api/`, but Express matched the route case-insensitively, so
 *     `/aPi/...` reached the admin handler with auth skipped.
 *
 * Daloy's design choices that prevent the bug:
 *
 *   - The router is exact, case-sensitive, and rejects `..` / `//` and other
 *     traversal patterns before walking the trie.
 *   - There is no implicit URL rewrite layer — handlers are reached via the
 *     same `url.pathname` the application code sees.
 *   - The `except()` matcher uses the same `url.pathname` view as the
 *     router and is also case-sensitive, so a case-mutated or
 *     trailing-slash-mutated request that the router would have routed to a
 *     protected handler does NOT match an exempt pattern; auth still runs.
 *     The matcher fails CLOSED.
 *
 * These tests lock those properties in so a future refactor of either the
 * router or `except()` cannot reintroduce the Qinglong class of bug.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, bearerAuth, except } from "../src/index.js";

function protectedApp() {
  const app = new App({ env: "development" });
  app.use(except(["/health", "/public/**"], bearerAuth({ validate: (token) => token === "good" })));
  app.route({
    method: "GET",
    path: "/api/admin",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/health",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("Qinglong CVE-2026-4047: case-mutated path cannot bypass except() auth", async () => {
  const app = protectedApp();
  // Without auth header, /api/admin is 401.
  assert.equal((await app.fetch(new Request("http://x/api/admin"))).status, 401);
  // Case-mutated variants ('/aPi/admin', '/API/ADMIN') must NOT reach the
  // handler with auth skipped. The router is case-sensitive, so these are
  // simply 404s — not a 200 (bypass) and not a 401 from the protected
  // route. Either outcome (404 or 401) is acceptable; a 200 would be the
  // CVE.
  for (const variant of ["/aPi/admin", "/API/ADMIN", "/Api/Admin"]) {
    const res = await app.fetch(new Request(`http://x${variant}`));
    assert.notEqual(res.status, 200, `case-mutated ${variant} must not 200`);
  }
});

test("Qinglong CVE-2026-4047: case-mutated exempt path does not skip auth on a different case-matched route", async () => {
  // Developer registers an exempt pattern for `/health`. An attacker who
  // somehow reaches a protected route via a case variant must NOT have
  // auth skipped just because the case variant "happens to" share a
  // prefix with the exempt pattern.
  const app = new App({ env: "development" });
  app.use(except("/health", bearerAuth({ validate: () => false })));
  app.route({
    method: "GET",
    path: "/health/admin",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // /health/admin is NOT exempt (the pattern is exact `/health`). Auth
  // runs and denies. /HEALTH/ADMIN is a 404 (case-sensitive router).
  assert.equal((await app.fetch(new Request("http://x/health/admin"))).status, 401);
  assert.notEqual((await app.fetch(new Request("http://x/HEALTH/ADMIN"))).status, 200);
});

test("Qinglong CVE-2026-3965: no implicit URL rewrite — /open/* does not reach /api/*", async () => {
  // The Qinglong CVE relied on a `/open/*` → `/api/*` rewrite that was
  // configured in the application but unknown to the auth middleware.
  // Daloy ships no such rewrite. Verify that registering `/api/admin`
  // does not also expose it under `/open/admin`.
  const app = protectedApp();
  const res = await app.fetch(new Request("http://x/open/admin"));
  // The security property under test is that the /api/admin handler is NOT
  // reachable via /open/admin (no implicit URL rewrite) — i.e. never a 200.
  // Because protectedApp() installs auth globally via app.use(except(...)),
  // perimeter guards now run on the cold (no-match) path too, so an
  // unauthenticated request to an unmatched path is rejected with 401 rather
  // than 404 (route-enumeration resistance). Either is acceptable here; a 200
  // would be the CVE.
  assert.notEqual(res.status, 200);
  assert.equal(res.status, 401);
});

test("except() pattern uses the same url.pathname the router sees (no double-decode)", async () => {
  // If `except()` ever percent-decoded the path before matching while the
  // router did not (or vice versa), an attacker could craft a path that
  // looks exempt to the auth gate but resolves to a protected handler
  // via the router. Verify both sides see the raw, percent-encoded
  // pathname.
  const app = new App({ env: "development" });
  app.use(except("/health", bearerAuth({ validate: () => false })));
  app.route({
    method: "GET",
    path: "/admin",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // %61 = 'a'. If something double-decoded, /%61dmin could route to
  // /admin while the auth gate sees something else. With consistent
  // raw-pathname handling, this is just a 404.
  const res = await app.fetch(new Request("http://x/%61dmin"));
  assert.notEqual(res.status, 200);
});

test("trailing-slash variants do not bypass auth via except()", async () => {
  // The router treats `/admin` and `/admin/` as the same route. The
  // except() matcher is exact-string for non-wildcard patterns. The
  // combination must fail CLOSED: a request that the router routes to a
  // protected handler must NOT skip auth just because the trailing-slash
  // variant matches an unrelated exempt pattern.
  const app = new App({ env: "development" });
  app.use(except("/admin/", bearerAuth({ validate: () => false })));
  app.route({
    method: "GET",
    path: "/admin",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // The router strips the trailing slash and matches `/admin`. The
  // except pattern is `/admin/` (exact), which does NOT match the raw
  // pathname `/admin`. Auth runs → 401. Fail-closed.
  assert.equal((await app.fetch(new Request("http://x/admin"))).status, 401);
  // The opposite direction: a request to `/admin/` reaches the same
  // handler AND matches the exempt pattern → 200. This is the
  // developer's stated intent; we just verify the behavior is stable.
  assert.equal((await app.fetch(new Request("http://x/admin/"))).status, 200);
});

test("path traversal attempts are rejected before any hook runs", async () => {
  // Sanity check: traversal sequences `..` and `//` are rejected by the
  // router. Even an attacker who learned an exempt pattern cannot escape
  // out of it via traversal.
  const app = protectedApp();
  for (const path of ["/health/../api/admin", "/public//../../api/admin", "/api//admin"]) {
    const res = await app.fetch(new Request(`http://x${path}`));
    assert.notEqual(res.status, 200, `traversal ${path} must not 200`);
  }
});
