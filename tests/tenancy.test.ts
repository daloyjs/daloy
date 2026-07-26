import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  rateLimit,
  tenancy,
  tenantScope,
  tenantFromSubdomain,
  tenantFromHeader,
  tenantFromPathPrefix,
  tenantFromClaim,
  defaultTenantNormalize,
  type Hooks,
  type TenancyOptions,
} from "../src/index.js";

/**
 * Build an app whose `/whoami` handler echoes the resolved tenant from
 * `ctx.state.tenant` (or a custom state key) so tests can assert resolution.
 */
function whoamiApp(options: TenancyOptions, stateKey = "tenant", extra?: Hooks) {
  const app = new App({ hooks: tenancy(options) });
  if (extra) app.use(extra);
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: { 200: { description: "ok", body: z.object({ tenant: z.string().optional() }) } },
    handler: ({ state }) => ({
      status: 200 as const,
      body: { tenant: (state as Record<string, unknown>)[stateKey] as string | undefined },
    }),
  });
  return app;
}

// ---------------------------------------------------------------------------
// Resolvers — happy paths
// ---------------------------------------------------------------------------

test("tenantFromSubdomain resolves the leftmost label", async () => {
  const app = whoamiApp({ resolve: tenantFromSubdomain({ baseDomain: "example.com" }) });
  const res = await app.request("http://acme.example.com/whoami");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

test("tenantFromSubdomain honors the index option", async () => {
  const app = whoamiApp({ resolve: tenantFromSubdomain({ baseDomain: "example.com", index: 1 }) });
  // api.acme.example.com → labels ["api","acme"], index 1 → "acme"
  const res = await app.request("http://api.acme.example.com/whoami");
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

test("tenantFromHeader resolves from a request header", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id") });
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "globex" } });
  assert.deepEqual(await res.json(), { tenant: "globex" });
});

test("tenantFromPathPrefix resolves the first path segment", async () => {
  const app = whoamiApp({ resolve: tenantFromPathPrefix() });
  // Register the tenant-prefixed route shape.
  app.route({
    method: "GET",
    path: "/acme/ping",
    operationId: "acmePing",
    responses: { 200: { description: "ok" } },
    handler: ({ state }) => ({ status: 200 as const, body: { t: (state as any).tenant } }),
  });
  const res = await app.request("http://x/acme/ping");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { t: "acme" });
});

test("tenantFromClaim reads a verified auth claim off ctx.state.auth", async () => {
  // A prior hook plays the role of the auth verifier writing the AuthContext.
  const auth: Hooks = {
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).auth = {
        scheme: "jwt",
        credentials: { sub: "u1", org: "umbrella" },
      };
    },
  };
  const app = new App({ hooks: auth });
  app.use(tenancy({ resolve: tenantFromClaim("org") }));
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: { 200: { description: "ok" } },
    handler: ({ state }) => ({ status: 200 as const, body: { tenant: (state as any).tenant } }),
  });
  const res = await app.request("http://x/whoami");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tenant: "umbrella" });
});

test("tenantFromClaim stringifies a numeric claim and reads a credentials-less node", async () => {
  // No { credentials } wrapper: the state node itself carries the claim, and
  // the value is numeric.
  const seed: Hooks = {
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).session = { org: 42 };
    },
  };
  const app = new App({ hooks: seed });
  app.use(tenancy({ resolve: tenantFromClaim("org", { stateKey: "session" }) }));
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: { 200: { description: "ok" } },
    handler: ({ state }) => ({ status: 200 as const, body: { tenant: (state as any).tenant } }),
  });
  const res = await app.request("http://x/whoami");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tenant: "42" });
});

test("tenantFromClaim is unresolved when the principal is absent or the claim is missing", async () => {
  const app = whoamiApp({ resolve: tenantFromClaim("org"), require: false });
  // No ctx.state.auth at all → undefined → tenant-less (require:false).
  const res = await app.request("http://x/whoami");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
});

test("resolver array tries in order: first non-empty wins", async () => {
  const app = whoamiApp({
    resolve: [tenantFromHeader("x-tenant-id"), tenantFromSubdomain({ baseDomain: "example.com" })],
  });
  // Header missing → falls back to subdomain.
  const res = await app.request("http://acme.example.com/whoami");
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

// ---------------------------------------------------------------------------
// require + resolution failures — unhappy paths
// ---------------------------------------------------------------------------

test("require:true (default) rejects an unresolved tenant with 400", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id") });
  const res = await app.request("http://x/whoami"); // no header
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.title, "Bad Request");
});

test("require:false proceeds tenant-less when unresolved", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id"), require: false });
  const res = await app.request("http://x/whoami");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {}); // tenant is undefined → omitted
});

test("custom unresolvedStatus (403) is honored", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id"), unresolvedStatus: 403 });
  const res = await app.request("http://x/whoami");
  assert.equal(res.status, 403);
});

test("subdomain not under the declared baseDomain is treated as unresolved (host-spoof safe)", async () => {
  const app = whoamiApp({ resolve: tenantFromSubdomain({ baseDomain: "example.com" }) });
  // Attacker-controlled Host that is not under example.com → unresolved → 400,
  // never a 500 and never a trusted tenant.
  const res = await app.request("http://acme.evil.test/whoami");
  assert.equal(res.status, 400);
});

test("apex host (no subdomain) under the base resolves to no tenant → 400 when required", async () => {
  const app = whoamiApp({ resolve: tenantFromSubdomain({ baseDomain: "example.com" }) });
  const res = await app.request("http://example.com/whoami");
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// allow list / validator + normalization — security
// ---------------------------------------------------------------------------

test("allow array accepts a listed tenant", async () => {
  const app = whoamiApp({
    resolve: tenantFromHeader("x-tenant-id"),
    allow: ["acme", "globex"],
  });
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "globex" } });
  assert.deepEqual(await res.json(), { tenant: "globex" });
});

test("allow array rejects an unlisted tenant with 404 (no enumeration)", async () => {
  const app = whoamiApp({
    resolve: tenantFromHeader("x-tenant-id"),
    allow: ["acme", "globex"],
  });
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "intruder" } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).title, "Not Found");
});

test("allow function validator gates tenants", async () => {
  const app = whoamiApp({
    resolve: tenantFromHeader("x-tenant-id"),
    allow: (id) => id.startsWith("ok-"),
  });
  assert.equal(
    (await app.request("http://x/whoami", { headers: { "x-tenant-id": "ok-1" } })).status,
    200
  );
  assert.equal(
    (await app.request("http://x/whoami", { headers: { "x-tenant-id": "no-1" } })).status,
    404
  );
});

test("default normalizer lowercases and trims a valid id", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id") });
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "  ACME  " } });
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

test("default normalizer rejects key/log-injection payloads with 404", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id") });
  // Header-deliverable but invalid tenant ids (control chars like \n/\r are
  // rejected by the HTTP layer before they ever reach us — see the unit test
  // below for those).
  for (const evil of ["a:b", "../etc", "a b", "*", "a/b", ".", "a;b", "a,b"]) {
    const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": evil } });
    assert.equal(res.status, 404, `expected ${JSON.stringify(evil)} to be rejected`);
  }
});

test("custom normalize can reshape the id", async () => {
  const app = whoamiApp({
    resolve: tenantFromHeader("x-tenant-id"),
    normalize: (raw) => {
      const n = raw
        .trim()
        .toLowerCase()
        .replace(/^tenant-/, "");
      return /^[a-z0-9]+$/.test(n) ? n : undefined;
    },
  });
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "TENANT-acme" } });
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

test("custom stateKey stores the tenant under the chosen key", async () => {
  const app = whoamiApp({ resolve: tenantFromHeader("x-tenant-id"), stateKey: "org" }, "org");
  const res = await app.request("http://x/whoami", { headers: { "x-tenant-id": "acme" } });
  assert.deepEqual(await res.json(), { tenant: "acme" });
});

test("defaultTenantNormalize is exported and validates the grammar", () => {
  assert.equal(defaultTenantNormalize("Acme"), "acme");
  assert.equal(defaultTenantNormalize("a-b_c1"), "a-b_c1");
  assert.equal(defaultTenantNormalize("-bad"), undefined);
  assert.equal(defaultTenantNormalize("bad-"), undefined);
  assert.equal(defaultTenantNormalize("a b"), undefined);
  assert.equal(defaultTenantNormalize(""), undefined);
  // Control-character / separator injection vectors are all rejected.
  assert.equal(defaultTenantNormalize("a\nb"), undefined);
  assert.equal(defaultTenantNormalize("a\r\nb"), undefined);
  assert.equal(defaultTenantNormalize("a:b"), undefined);
  assert.equal(defaultTenantNormalize("../etc"), undefined);
});

// ---------------------------------------------------------------------------
// Construction-time guards — unhappy paths
// ---------------------------------------------------------------------------

test("tenancy throws when given no resolvers", () => {
  assert.throws(() => tenancy({ resolve: [] }), /at least one resolver/);
});

test("tenancy throws on a malformed allowlist entry", () => {
  assert.throws(
    () => tenancy({ resolve: tenantFromHeader("x-tenant-id"), allow: ["acme", "Bad Tenant!"] }),
    /not a valid tenant id/
  );
});

// ---------------------------------------------------------------------------
// tenantScope() helper
// ---------------------------------------------------------------------------

test("tenantScope returns a tenant: prefixed key", () => {
  const scope = tenantScope();
  assert.equal(scope({ state: { tenant: "acme" } } as any), "tenant:acme");
});

test("tenantScope falls back when no tenant is present", () => {
  assert.equal(tenantScope()({ state: {} } as any), "tenant:unknown");
  assert.equal(tenantScope({ fallback: "anon" })({ state: {} } as any), "anon");
});

test("tenantScope honors a custom stateKey", () => {
  assert.equal(
    tenantScope({ stateKey: "org" })({ state: { org: "globex" } } as any),
    "tenant:globex"
  );
});

// ---------------------------------------------------------------------------
// Integration: per-tenant isolation via rateLimit + tenantScope
// ---------------------------------------------------------------------------

test("tenantScope isolates rate-limit buckets per tenant", async () => {
  const app = new App({
    hooks: tenancy({ resolve: tenantFromHeader("x-tenant-id"), allow: ["acme", "globex"] }),
  });
  // tenancy (global) runs before rateLimit (group), so ctx.state.tenant is set
  // by the time the keyGenerator runs.
  app.use(rateLimit({ windowMs: 60_000, max: 2, keyGenerator: tenantScope() }));
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });

  const hit = (tenant: string) => app.request("http://x/x", { headers: { "x-tenant-id": tenant } });

  // acme burns through its budget of 2.
  assert.equal((await hit("acme")).status, 200);
  assert.equal((await hit("acme")).status, 200);
  assert.equal((await hit("acme")).status, 429); // acme is now limited

  // globex has its own independent bucket — unaffected by acme.
  assert.equal((await hit("globex")).status, 200);
  assert.equal((await hit("globex")).status, 200);
  assert.equal((await hit("globex")).status, 429);
});
