/**
 * Audit 2026-11 (Cloudflare security-audit skill, daloy run-1): regression
 * tests for the eight confirmed findings. Each test names the finding
 * fingerprint it covers; happy and unhappy paths are paired per the repo's
 * secure-by-default rules.
 *
 * 1. `daloyjs/tenancy-response-cache-misorder-indeterminate-env` — the
 *    cache-before-tenancy boot guard now fails closed when the environment
 *    signal is indeterminate (edge runtimes carry no NODE_ENV), instead of
 *    warn-only.
 * 2. `src/mtls.ts:clientCertAuth-header-trust-without-proxy-posture-guard` —
 *    clientCertAuth({ header }) is refused without a declared proxy posture,
 *    and certificate-identity headers join the per-request spoofable-header
 *    refusal.
 * 3. `src/websocket.ts:WebSocketMessageGate.push-unbounded-queue` — the
 *    async-validation queue is bounded per connection (count + bytes) and
 *    overflows close the connection with 1009.
 * 4. `daloy/ip-reputation:matchingFeeds-ipv4-mapped-family-split` — an
 *    IPv4-mapped IPv6 client is also tested against v4 feed entries.
 * 5. `daloy/auto-ban:forwardedKey-ipv6-rotation-strike-evasion` — strike
 *    accounting canonicalizes client identities (IPv6 /64 grouping).
 * 6. `daloy/concurrency-limit:client-scope-ipv6-rotation-budget-evasion` —
 *    the per-client budget canonicalizes the same way.
 * 7. `daloyjs/combine.some-rollback-dependency-cache` — a denied some()
 *    branch's dependency-cache mutations are reconciled on rollback.
 * 8. `daloy-core:multipart-scriptable-image-probe-window-bypass` — the
 *    scriptable-image probe reads a bounded 64 KiB window and fails closed
 *    when the window is all XML prolog with more bytes following.
 *    (Multipart probe tests live in audit-2026-11-multipart.test.ts; the
 *    window-bypass cases are added there.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  autoBan,
  bearerAuth,
  clientCertAuth,
  concurrencyLimit,
  every,
  ipReputation,
  rateLimit,
  responseCache,
  some,
  tenancy,
  tenantFromHeader,
} from "../src/index.js";
import { defineDependency } from "../src/index.js";
import { ipRateLimitIdentity } from "../src/ip-match.js";
import {
  DEFAULT_WS_MAX_PAYLOAD_LENGTH,
  DEFAULT_WS_MAX_QUEUED_MESSAGES,
  normalizeWebSocketOptions,
  WebSocketMessageGate,
} from "../src/websocket.js";

const ok = { 200: { description: "OK" } };

async function get(app: App<any>, path: string, headers: Record<string, string>) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { "user-agent": "audit", ...headers } }));
}

/** Run `fn` with NODE_ENV deleted (indeterminate environment), restoring it after. */
async function withIndeterminateEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const saved = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
}

// ---------------------------------------------------------------------------
// 1. cache-before-tenancy fails closed when the environment is indeterminate
// ---------------------------------------------------------------------------

test("[boot-guards] cache-before-tenancy refuses with no environment signal (silent cross-tenant leak)", async () => {
  await withIndeterminateEnv(async () => {
    const app = new App({ logger: false, behindProxy: "none" });
    app.use(responseCache({ ttlSeconds: 60 }));
    app.use(tenancy({ resolve: [tenantFromHeader("x-tenant-id")] }));
    app.route({
      method: "GET",
      path: "/data",
      public: true,
      responses: ok,
      acknowledgeNoResponseBodySchema: true,
      handler: ({ state }: any) => ({ status: 200 as const, body: { secret: `for-${state.tenant}` } }),
    } as never);
    // The guard must throw for this issue class even without an env signal...
    assert.throws(() => app.assertSecureConfig(), /before tenancy\(\) in its effective hook chain/);
    // ...and the first request fails closed instead of serving a shared cache.
    const res = await get(app, "/data", { "x-tenant-id": "acme" });
    assert.equal(res.status, 500);
  });
});

test("[boot-guards] cache-before-tenancy: warn-only guards still do not throw when indeterminate", async () => {
  await withIndeterminateEnv(async () => {
    // session-without-csrf is NOT in the fail-closed set: it keeps the
    // warn-only indeterminate behavior (no throw from assertSecureConfig).
    const app = new App({ logger: false, behindProxy: "none" });
    app.route({
      method: "GET",
      path: "/ok",
      public: true,
      responses: ok,
      acknowledgeNoResponseBodySchema: true,
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    } as never);
    assert.deepEqual(app.assertSecureConfig(), []);
    assert.equal((await get(app, "/ok", {})).status, 200);
  });
});

test("[boot-guards] correctly ordered tenancy + cache still partitions per tenant with no env signal", async () => {
  await withIndeterminateEnv(async () => {
    const app = new App({ logger: false, behindProxy: "none" });
    app.use(tenancy({ resolve: [tenantFromHeader("x-tenant-id")] }));
    app.use(responseCache({ ttlSeconds: 60 }));
    let calls = 0;
    app.route({
      method: "GET",
      path: "/data",
      public: true,
      responses: ok,
      acknowledgeNoResponseBodySchema: true,
      handler: ({ state }: any) => {
        calls++;
        return { status: 200 as const, body: { secret: `for-${state.tenant}` } };
      },
    } as never);
    const a = await (await get(app, "/data", { "x-tenant-id": "acme" })).json();
    const b = await (await get(app, "/data", { "x-tenant-id": "globex" })).json();
    assert.equal((a as any).secret, "for-acme");
    assert.equal((b as any).secret, "for-globex", "tenants must never share a cache entry");
    assert.equal(calls, 2);
  });
});

// ---------------------------------------------------------------------------
// 2. clientCertAuth header mode requires a declared proxy posture
// ---------------------------------------------------------------------------

const XFCC =
  'Hash=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef;Subject="CN=svc-a"';

function mtlsApp(options: Record<string, unknown>): App<any> {
  const app = new App({ logger: false, ...options } as any);
  app.use(clientCertAuth({ header: { format: "xfcc" }, allowSubjectCNs: ["svc-a"] }));
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({
      status: 200 as const,
      body: { cn: ctx.state.clientCertificate?.subjectCN ?? null },
    }),
  } as never);
  return app;
}

test("[mtls] header mode without proxy posture is refused in production AND indeterminate env", async () => {
  const prod = mtlsApp({ env: "production" });
  assert.throws(() => prod.assertSecureConfig(), /clientCertAuth\(\{ header/);
  assert.equal((await prod.fetch(new Request("http://localhost/", { headers: { "x-forwarded-client-cert": XFCC } }))).status, 500);

  await withIndeterminateEnv(async () => {
    const indeterminate = mtlsApp({});
    assert.throws(() => indeterminate.assertSecureConfig(), /clientCertAuth\(\{ header/);
  });
});

test("[mtls] header mode is refused with explicitly proxy-less postures", () => {
  assert.throws(() => mtlsApp({ env: "production", trustProxy: false }).assertSecureConfig(), /clientCertAuth\(\{ header/);
  assert.throws(() => mtlsApp({ env: "production", behindProxy: "none" }).assertSecureConfig(), /clientCertAuth\(\{ header/);
});

test("[mtls] header mode works when a real proxy posture is declared", async () => {
  const app = mtlsApp({ env: "production", behindProxy: { hops: 1 } });
  app.assertSecureConfig();
  const res = await app.fetch(new Request("http://localhost/", { headers: { "x-forwarded-client-cert": XFCC } }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).cn, "svc-a");

  const trusted = mtlsApp({ env: "production", trustProxy: true });
  trusted.assertSecureConfig();
  const res2 = await trusted.fetch(new Request("http://localhost/", { headers: { "x-forwarded-client-cert": XFCC } }));
  assert.equal(res2.status, 200);
});

test("[mtls] structured header names register for the per-request spoofable-header refusal", async () => {
  // In production with no proxy posture, a request carrying a configured
  // structured identity header is refused at dispatch (500), matching the
  // X-Forwarded-For behavior — even though the boot refusal already covers
  // the registered middleware case.
  const app = new App({ logger: false, env: "production" });
  app.use(
    clientCertAuth({
      header: { format: "structured", subjectDN: "x-ssl-client-s-dn", verify: "x-ssl-client-verify" },
      allowSubjectCNs: ["svc-a"],
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.throws(() => app.assertSecureConfig(), /x-ssl-client-s-dn/);
});

test("[mtls] production app without mTLS still refuses a stray x-forwarded-client-cert header", async () => {
  const app = new App({ logger: false, env: "production" });
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  const res = await app.fetch(new Request("http://localhost/", { headers: { "x-forwarded-client-cert": XFCC } }));
  assert.equal(res.status, 500, "spoofable certificate-identity header must be refused like X-Forwarded-For");
});

// ---------------------------------------------------------------------------
// 3. WebSocketMessageGate bounds the async-validation queue
// ---------------------------------------------------------------------------

/** A Standard-Schema whose validation stalls until `release()` is called. */
function stalledSchema() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let pending = true;
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "audit",
      async validate(value: unknown) {
        if (pending) await gate;
        return { value };
      },
    },
  };
  return {
    schema: schema as never,
    release: () => {
      pending = false;
      release();
    },
  };
}

test("[ws-gate] queue overflow delivers a 1009 failure instead of unbounded retention", async () => {
  const { schema, release } = stalledSchema();
  const outcomes: Array<{ ok: boolean; code?: number }> = [];
  const gate = new WebSocketMessageGate(schema, (result) => {
    outcomes.push({ ok: result.ok, code: result.ok ? undefined : result.code });
  });
  gate.push('"m0"', false); // stalls validation
  const overflowAt = DEFAULT_WS_MAX_QUEUED_MESSAGES; // 64 queued behind the stalled one
  for (let i = 0; i < overflowAt; i++) gate.push(`"m${i + 1}"`, false);
  assert.equal(outcomes.length, 0, "nothing delivers while validation is stalled");
  gate.push('"overflow"', false);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.ok, false);
  assert.equal(outcomes[0]!.code, 1009);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    outcomes.filter((o) => o.ok).length,
    1 + overflowAt,
    "bounded queue drains in arrival order once validation resumes",
  );
});

test("[ws-gate] byte cap closes the queue before the message cap for large messages", () => {
  const { schema } = stalledSchema();
  const outcomes: Array<{ ok: boolean; code?: number }> = [];
  const gate = new WebSocketMessageGate(
    schema,
    (result) => {
      outcomes.push({ ok: result.ok, code: result.ok ? undefined : result.code });
    },
    { maxQueuedMessages: 1000, maxQueuedBytes: 4096 },
  );
  gate.push('"m0"', false); // stalled validation
  gate.push("x".repeat(3000), false); // queued: 3000
  gate.push("x".repeat(3000), false); // 3000 + 3000 > 4096 → overflow
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.code, 1009);
});

test("[ws-gate] sync schemas never queue (control)", () => {
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "audit",
      validate: (value: unknown) => ({ value }),
    },
  };
  const seen: unknown[] = [];
  const gate = new WebSocketMessageGate(schema as never, (result, data) => {
    if (result.ok) seen.push(data);
  });
  for (let i = 0; i < 200; i++) gate.push(`"m${i}"`, false);
  assert.equal(seen.length, 200, "sync validation delivers inline with no queue bound applied");
});

test("[ws-gate] option normalization validates the new caps", () => {
  const base = { message() {} } as never;
  const resolved = normalizeWebSocketOptions(base, { production: false, secureDefaults: true });
  assert.equal(resolved.maxQueuedMessages, DEFAULT_WS_MAX_QUEUED_MESSAGES);
  assert.equal(resolved.maxQueuedBytes, 2 * DEFAULT_WS_MAX_PAYLOAD_LENGTH);
  assert.throws(
    () => normalizeWebSocketOptions({ message() {}, maxQueuedMessages: 0 } as never, { production: false, secureDefaults: true }),
    /maxQueuedMessages must be a positive integer/,
  );
  assert.throws(
    () => normalizeWebSocketOptions({ message() {}, maxQueuedBytes: -1 } as never, { production: false, secureDefaults: true }),
    /maxQueuedBytes must be a positive integer/,
  );
  const custom = normalizeWebSocketOptions(
    { message() {}, maxQueuedMessages: 4, maxQueuedBytes: 8192 } as never,
    { production: false, secureDefaults: true },
  );
  assert.equal(custom.maxQueuedMessages, 4);
  assert.equal(custom.maxQueuedBytes, 8192);
});

// ---------------------------------------------------------------------------
// 4. ipReputation matches IPv4 feed entries for IPv4-mapped IPv6 clients
// ---------------------------------------------------------------------------

test("[ip-reputation] IPv4 feed entries match clients arriving as ::ffff:a.b.c.d", async () => {
  const controller = ipReputation({
    feeds: [{ name: "dummy-feed", fetch: async () => ["203.0.113.7", "198.51.100.0/24"] }],
    loadOnStart: false,
    refreshIntervalMs: 0,
  });
  await controller.refresh();
  assert.equal(controller.has("203.0.113.7"), true, "plain v4 still matches");
  assert.equal(controller.has("::ffff:203.0.113.7"), true, "mapped form must match the v4 entry");
  assert.equal(controller.has("::ffff:198.51.100.99"), true, "mapped form must match the v4 CIDR");
  assert.equal(controller.has("2001:db8::1"), false, "non-mapped v6 never matches v4 entries");
  controller.stop();
});

test("[ip-reputation] v6 feeds still match native v6 clients (no regression)", async () => {
  const controller = ipReputation({
    feeds: [{ name: "v6-feed", fetch: async () => ["2001:db8:bad::/48"] }],
    loadOnStart: false,
    refreshIntervalMs: 0,
  });
  await controller.refresh();
  assert.equal(controller.has("2001:db8:bad::1"), true);
  assert.equal(controller.has("2001:db8:cafe::1"), false);
  assert.equal(controller.has("203.0.113.7"), false, "v4 client never matches a v6-only feed");
  controller.stop();
});

// ---------------------------------------------------------------------------
// 5 + 6. autoBan / concurrencyLimit canonicalize client identity (IPv6 /64)
// ---------------------------------------------------------------------------

const mkCtx = (xff: string) =>
  ({
    request: new Request("http://localhost/login", { headers: { "x-forwarded-for": xff } }),
    state: {} as Record<string, unknown>,
    set: { headers: new Headers() },
  }) as never;

test("[auto-ban] strikes rotating within one IPv6 /64 accumulate onto one identity", async () => {
  const guard = autoBan({ trustProxyHeaders: true, maxStrikes: 3, windowMs: 600_000, groupId: `audit-ab-${Math.random()}` });
  const fail = async (ip: string) => {
    const ctx = mkCtx(ip);
    await guard.preBody!(ctx);
    await guard.onSend!(new Response(null, { status: 401 }), ctx);
  };
  await fail("2001:db8:cafe:2::1");
  await fail("2001:db8:cafe:2::2");
  await fail("2001:db8:cafe:2::3");
  await assert.rejects(async () => {
    await guard.preBody!(mkCtx("2001:db8:cafe:2::4"));
  }, /Too Many Requests/);
});

test("[auto-ban] mapped and plain IPv4 forms share one strike record; ipv6Subnet validates", async () => {
  const guard = autoBan({ trustProxyHeaders: true, maxStrikes: 2, windowMs: 600_000, groupId: `audit-ab-${Math.random()}` });
  const fail = async (ip: string) => {
    const ctx = mkCtx(ip);
    await guard.preBody!(ctx);
    await guard.onSend!(new Response(null, { status: 401 }), ctx);
  };
  await fail("203.0.113.10");
  await fail("::ffff:203.0.113.10");
  await assert.rejects(async () => {
    await guard.preBody!(mkCtx("203.0.113.10"));
  }, /Too Many Requests/);
  assert.throws(() => autoBan({ trustProxyHeaders: true, ipv6Subnet: 0 }), /ipv6Subnet/);
  assert.throws(() => autoBan({ trustProxyHeaders: true, ipv6Subnet: 129 }), /ipv6Subnet/);
});

test("[concurrency-limit] scope client groups one IPv6 /64 into one budget", async () => {
  const guard = concurrencyLimit({
    maxConcurrent: 1,
    maxQueue: 0,
    scope: "client",
    trustProxyHeaders: true,
  });
  const tryAcquire = async (xff: string): Promise<"admitted" | "rejected"> => {
    try {
      await guard.beforeHandle!(mkCtx(xff));
      return "admitted";
    } catch {
      return "rejected";
    }
  };
  assert.equal(await tryAcquire("2001:db8:aaaa::1"), "admitted"); // holds the only slot
  assert.equal(await tryAcquire("2001:db8:aaaa::2"), "rejected", "same /64 must share the budget");
  assert.equal(await tryAcquire("2001:db8:aaab::1"), "admitted", "a different /64 has its own budget");
  assert.throws(
    () => concurrencyLimit({ maxConcurrent: 1, scope: "client", trustProxyHeaders: true, ipv6Subnet: 200 }),
    /ipv6Subnet/,
  );
});

test("[ipv6-keying] parity with rateLimit: all three guards share ipRateLimitIdentity semantics", () => {
  assert.equal(ipRateLimitIdentity("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipRateLimitIdentity("2001:db8:dead:beef::99"), "2001:db8:dead:beef:0:0:0:0/64");
});

// ---------------------------------------------------------------------------
// 7. some() rollback reconciles the dependency-results cache
// ---------------------------------------------------------------------------

test("[some] a denied branch's dependency-cache value is not served to the winning identity", async () => {
  const warmup = defineDependency({ name: "warmup", resolve: () => "ok" });
  const depTenant = defineDependency({
    name: "tenant",
    resolve: (ctx: any) => ({ tenantOf: ctx.state.user?.id ?? null }),
  });
  const denyAlice = {
    async beforeHandle(ctx: any) {
      if (ctx.state.user?.id === "alice") {
        return new Response(JSON.stringify({ type: "about:blank", title: "Forbidden", status: 403 }), {
          status: 403,
          headers: { "content-type": "application/problem+json" },
        });
      }
    },
  };
  const branchA = every(
    bearerAuth({ validate: (t) => (t === "tok" ? { id: "alice" } : false) }),
    depTenant,
    denyAlice,
  );
  const branchB = every(bearerAuth({ validate: (t) => (t === "tok" ? { id: "bob" } : false) }), depTenant);

  const app = new App({ logger: false, behindProxy: "none" });
  app.use(warmup);
  app.route({
    method: "GET",
    path: "/t",
    public: true,
    hooks: some(branchA, branchB),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: ({ state }: any) => ({ status: 200 as const, body: { user: state.user?.id, tenant: state.tenant } }),
  } as never);

  const res = await get(app, "/t", { authorization: "Bearer tok" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.user, "bob");
  assert.equal(
    body.tenant?.tenantOf,
    "bob",
    "the winning branch must re-resolve the dependency, not read the denied branch's cache entry",
  );
});

test("[some] rollback still stamps pre-gate dependency results for the winning branch", async () => {
  // Happy path: a dependency resolved BEFORE the some() gate stays visible —
  // rollback reconciles branch mutations, it must not wipe pre-existing entries.
  const warmup = defineDependency({ name: "warmup2", resolve: () => "pre-gate" });
  const denied = {
    async beforeHandle() {
      return new Response(JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401 }), {
        status: 401,
        headers: { "content-type": "application/problem+json" },
      });
    },
  };
  const allowed = { async beforeHandle() {} };
  const app = new App({ logger: false, behindProxy: "none" });
  app.use(warmup);
  app.route({
    method: "GET",
    path: "/u",
    public: true,
    hooks: some(every(denied), every(allowed)),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: ({ state }: any) => ({ status: 200 as const, body: { warmup: state.warmup2 } }),
  } as never);
  const res = await get(app, "/u", {});
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).warmup, "pre-gate");
});


test("[mtls] every()/some() composition unions header names from multiple clientCertAuth({ header }) bundles", () => {
  // Symbol-keyed markers are first-wins by default in mergeCombineHooks; the
  // header-mode marker must instead union, or a second bundle's structured
  // header names would escape the boot guard message and the per-request
  // spoofable-header refusal.
  const app = new App({ logger: false, env: "production" });
  app.use(
    every(
      clientCertAuth({ header: { format: "xfcc", name: "x-custom-xfcc" }, allowSubjectCNs: ["svc-a"] }),
      clientCertAuth({
        header: { format: "structured", subjectDN: "x-ssl-client-s-dn", verify: "x-ssl-client-verify" },
        allowSubjectCNs: ["svc-a"],
      }),
    ),
  );
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.throws(
    () => app.assertSecureConfig({ production: true }),
    (err: Error) =>
      /mtls|clientCertAuth\(\{ header/.test(err.message) &&
      /x-custom-xfcc/.test(err.message) &&
      /x-ssl-client-s-dn/.test(err.message) &&
      /x-ssl-client-verify/.test(err.message),
  );
});

test("[mtls] internal-service preset names itself as the source of the proxy-less posture", () => {
  assert.throws(
    () => mtlsApp({ env: "production", preset: "internal-service" }).assertSecureConfig(),
    /trustProxy: false.*set by preset: "internal-service"/,
  );
  // Declaring the mesh sidecar alongside the preset is the documented fix.
  mtlsApp({ env: "production", preset: "internal-service", behindProxy: { hops: 1 } }).assertSecureConfig();
});
