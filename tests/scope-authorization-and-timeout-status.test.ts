/**
 * 1.10.0 regressions and features found while migrating an Entra ID protected
 * service:
 *
 *  1. `jwk()` ignored a string-valued `scp` claim. Entra ID issues delegated
 *     scopes as a space-delimited string, so every Entra user got `403`.
 *  2. `requireScopes()` always authorized in `beforeHandle`, after the body was
 *     parsed, so a valid token with too few scopes plus a malformed body got
 *     `400` instead of `403`. `{ phase: "preBody" }` authorizes first.
 *  3. `requireScopes(..., { phase: "preBody", match: "any" })` accepts any one
 *     of several scopes without weakening stored-response replay checks.
 *  4. `every(requireScopes(a), requireScopes(b))` kept only the first
 *     bundle's replay marker, so a shared-namespace replay skipped scope `b`.
 *  5. `requestTimeoutStatus` lets the handler deadline answer `504` / `503`.
 *  6. A CORS-intercepted automatic preflight now carries `X-Request-Id`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  MemoryIdempotencyStore,
  REQUIRE_SCOPES_HOOK_MARKER,
  RequestTimeoutError,
  cors,
  createJwtSigner,
  every,
  idempotency,
  jwk,
  requireScopes,
  type Hooks,
  type JwkSet,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Test-only auth: `x-scopes: a b` authenticates a user owning those scopes. */
const headerAuth: Hooks = {
  preBody(ctx) {
    const raw = ctx.request.headers.get("x-scopes");
    if (raw === null) return undefined;
    (ctx.state as Record<string, unknown>).user = {
      sub: "user",
      scopes: raw.split(" ").filter(Boolean),
    };
    return undefined;
  },
};

function itemsApp(scopeHooks: Hooks, onHandle?: () => void): App {
  const app = new App({ env: "test", logger: false });
  app.use(headerAuth);
  app.route({
    method: "POST",
    path: "/items",
    operationId: "createItem",
    hooks: scopeHooks,
    request: { body: z.object({ name: z.string() }).strict() as any },
    responses: { 201: { description: "created", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      onHandle?.();
      return { status: 201 as const, body: { ok: true } };
    },
  });
  return app;
}

function post(app: App, body: string, scopes?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (scopes !== undefined) headers["x-scopes"] = scopes;
  return app.fetch(new Request("http://x/items", { method: "POST", headers, body }));
}

const MALFORMED = "{not json";
const VALID = JSON.stringify({ name: "widget" });

// ---------------------------------------------------------------------------
// 2. requireScopes({ phase: "preBody" })
// ---------------------------------------------------------------------------

test("requireScopes default phase still parses the body first (400 before 403)", async () => {
  const app = itemsApp(requireScopes(["items:write"]));
  assert.equal((await post(app, MALFORMED, "other")).status, 400);
  assert.equal((await post(app, VALID, "other")).status, 403);
});

test("requireScopes preBody: insufficient scope + malformed body is 403, not 400", async () => {
  let handled = 0;
  const app = itemsApp(requireScopes(["items:write"], { phase: "preBody" }), () => handled++);

  const forbidden = await post(app, MALFORMED, "other");
  assert.equal(forbidden.status, 403);
  assert.match(((await forbidden.json()) as { detail: string }).detail, /items:write/);

  // Authorized callers still get normal validation and handling.
  assert.equal((await post(app, MALFORMED, "items:write")).status, 400);
  assert.equal((await post(app, VALID, "items:write")).status, 201);
  assert.equal(handled, 1);
});

test("requireScopes preBody: no credentials is a 401 challenge before body I/O", async () => {
  const app = itemsApp(requireScopes(["items:write", "items:read"], { phase: "preBody" }));
  const request = new Request("http://x/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: MALFORMED,
  });
  const res = await app.fetch(request);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(
    res.headers.get("www-authenticate"),
    'Bearer scope="items:write items:read", error="insufficient_scope"'
  );
  // Rejected before the framework read the request body.
  assert.equal(request.bodyUsed, false);
});

test("requireScopes preBody rejection leaves an unauthorized body unread", async () => {
  const app = itemsApp(requireScopes(["items:write"], { phase: "preBody" }));
  const request = new Request("http://x/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-scopes": "other" },
    body: VALID,
  });
  assert.equal((await app.fetch(request)).status, 403);
  assert.equal(request.bodyUsed, false);
});

test("requireScopes preBody: a user without a scopes array owns nothing", async () => {
  const app = new App({ env: "test", logger: false });
  app.use({
    preBody(ctx) {
      (ctx.state as Record<string, unknown>).user = { sub: "no-scopes" };
    },
  });
  app.route({
    method: "GET",
    path: "/r",
    hooks: requireScopes(["a"], { phase: "preBody" }),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/r")).status, 403);
});

test("requireScopes: an inherited scopes property grants nothing (own property only)", async () => {
  // A polluted Object.prototype — or any prototype-level `scopes` — must not
  // satisfy the check; only a stamped own property counts.
  const inherited = Object.create({ scopes: ["a"] }) as Record<string, unknown>;
  inherited.sub = "proto-user";
  const app = new App({ env: "test", logger: false });
  app.use({
    preBody(ctx) {
      (ctx.state as Record<string, unknown>).user = inherited;
    },
  });
  app.route({
    method: "GET",
    path: "/r",
    hooks: requireScopes(["a"], { phase: "preBody" }),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/r")).status, 403);
  // Sanity: the same shape as an own property is accepted.
  const own = new App({ env: "test", logger: false });
  own.use({
    preBody(ctx) {
      (ctx.state as Record<string, unknown>).user = { sub: "own-user", scopes: ["a"] };
    },
  });
  own.route({
    method: "GET",
    path: "/r",
    hooks: requireScopes(["a"], { phase: "preBody" }),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await own.request("/r")).status, 200);
});

// ---------------------------------------------------------------------------
// 3. match: "any"
// ---------------------------------------------------------------------------

test("requireScopes match any: one accepted scope is enough", async () => {
  const app = itemsApp(
    requireScopes(["agent.chat", "agent.admin"], { phase: "preBody", match: "any" })
  );
  assert.equal((await post(app, VALID, "agent.chat")).status, 201);
  assert.equal((await post(app, VALID, "other agent.admin")).status, 201);
});

test("requireScopes match any: owning none of the scopes is 403 even with a malformed body", async () => {
  const app = itemsApp(
    requireScopes(["agent.chat", "agent.admin"], { phase: "preBody", match: "any" })
  );
  for (const scopes of ["other", ""]) {
    const res = await post(app, MALFORMED, scopes);
    assert.equal(res.status, 403);
    assert.match(
      ((await res.json()) as { detail: string }).detail,
      /any of\): agent\.chat, agent\.admin/
    );
  }
});

test("requireScopes match any: no credentials is a 401 listing the accepted scopes", async () => {
  const app = itemsApp(requireScopes(["agent.chat", "agent.admin"], { phase: "preBody", match: "any" }));
  const res = await post(app, VALID);
  assert.equal(res.status, 401);
  assert.equal(
    res.headers.get("www-authenticate"),
    'Bearer scope="agent.chat agent.admin", error="insufficient_scope"'
  );
});

test("requireScopes match any: a user without a scopes array owns nothing", async () => {
  const app = new App({ env: "test", logger: false });
  app.use({
    preBody(ctx) {
      (ctx.state as Record<string, unknown>).user = { sub: "no-scopes", scopes: "a" };
    },
  });
  app.route({
    method: "GET",
    path: "/r",
    hooks: requireScopes(["a"], { phase: "preBody", match: "any" }),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/r")).status, 403);
});

test("requireScopes: all-of guards carry the replay marker, any-of guards do not", () => {
  const marker = REQUIRE_SCOPES_HOOK_MARKER as PropertyKey;
  const allPre = requireScopes(["a", "b"], { phase: "preBody" }) as Record<PropertyKey, unknown>;
  const any = requireScopes(["a", "b"], { phase: "preBody", match: "any" }) as Record<
    PropertyKey,
    unknown
  >;
  assert.deepEqual(allPre[marker], ["a", "b"]);
  assert.equal(typeof allPre.preBody, "function");
  assert.equal(allPre.beforeHandle, undefined);
  assert.equal(any[marker], undefined);
  assert.equal(typeof (requireScopes(["a"]) as Hooks).beforeHandle, "function");
});

test("requireScopes refuses invalid options at construction", () => {
  assert.throws(
    () => requireScopes(["a"], { match: "any" }),
    /match "any" requires phase "preBody"/
  );
  assert.throws(
    () => requireScopes(["a"], { phase: "beforeHandle", match: "any" }),
    /match "any" requires phase "preBody"/
  );
  assert.throws(
    () => requireScopes(["a"], { phase: "onRequest" as never }),
    /phase must be "beforeHandle" or "preBody"/
  );
  assert.throws(
    () => requireScopes(["a"], { phase: "preBody", match: "some" as never }),
    /match must be "all" or "any"/
  );
  assert.throws(() => requireScopes(["a"], null as never), /options must be an object/);
  // Scope-list validation still applies with options.
  assert.throws(() => requireScopes([], { phase: "preBody" }), /non-empty array/);
});

// ---------------------------------------------------------------------------
// Stored-response replays keep their scope checks
// ---------------------------------------------------------------------------

function sharedReplayApp(scopeHooks: Hooks, onHandle: () => void): App {
  const app = new App({ env: "test", logger: false });
  app.use(headerAuth);
  // A shared namespace (for example a tenant-wide scope) is where replay scope
  // checks matter: every caller can hit the same stored response.
  app.use(idempotency({ store: new MemoryIdempotencyStore(), allowUnscopedCallers: true }));
  app.route({
    method: "POST",
    path: "/orders",
    operationId: "createOrder",
    hooks: scopeHooks,
    request: { body: z.object({ item: z.string() }).strict() as any },
    responses: { 201: { description: "created", body: z.object({ n: z.number() }) as any } },
    handler: async () => {
      onHandle();
      return { status: 201 as const, body: { n: 1 } };
    },
  });
  return app;
}

function order(app: App, scopes: string): Promise<Response> {
  return app.fetch(
    new Request("http://x/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "k-1", "x-scopes": scopes },
      body: JSON.stringify({ item: "widget" }),
    })
  );
}

test("any-of preBody guard rejects before an idempotency replay can be served", async () => {
  let handled = 0;
  const app = sharedReplayApp(
    requireScopes(["orders:write", "orders:admin"], { phase: "preBody", match: "any" }),
    () => handled++
  );
  const first = await order(app, "orders:write");
  assert.equal(first.status, 201);

  // A caller with an accepted scope replays the stored response.
  const replay = await order(app, "orders:admin");
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");

  // A caller with none of the accepted scopes never sees the stored response.
  const denied = await order(app, "other");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("idempotency-replayed"), null);
  assert.equal(handled, 1);
});

test("every(requireScopes(a), requireScopes(b)) keeps scope b in the replay check", async () => {
  let handled = 0;
  const app = sharedReplayApp(
    every(requireScopes(["orders:write"]), requireScopes(["orders:approve"])),
    () => handled++
  );
  assert.equal((await order(app, "orders:write orders:approve")).status, 201);

  // Owning only the first bundle's scope must not unlock the stored response.
  const denied = await order(app, "orders:write");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("idempotency-replayed"), null);

  const replay = await order(app, "orders:approve orders:write");
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(handled, 1);
});

test("every() unions requireScopes replay markers without duplicates", () => {
  const merged = every(
    requireScopes(["a", "b"]),
    requireScopes(["b", "c"]),
    { onSend: (res) => res }
  ) as Record<PropertyKey, unknown>;
  assert.deepEqual(merged[REQUIRE_SCOPES_HOOK_MARKER as PropertyKey], ["a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// 1. jwk(): string-valued `scp` (Microsoft Entra ID)
// ---------------------------------------------------------------------------

async function entraFixture(): Promise<{
  jwks: JwkSet;
  token: (claims: Record<string, unknown>) => Promise<string>;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "entra" },
  });
  return {
    jwks: { keys: [{ ...pub, kid: "entra", alg: "ES256", use: "sig" } as JsonWebKey] },
    token: (claims) => {
      const now = Math.floor(Date.now() / 1000);
      return signer.sign({
        sub: "user",
        iss: "https://login.microsoftonline.com/tenant/v2.0",
        aud: "api://ask-ai",
        iat: now,
        exp: now + 300,
        ...claims,
      });
    },
  };
}

function entraApp(jwks: JwkSet, scopeHooks: Hooks): App {
  const app = new App({ env: "test", logger: false });
  app.use(
    every(
      jwk({
        jwks,
        algorithms: ["ES256"],
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        audience: "api://ask-ai",
      }),
      scopeHooks
    )
  );
  app.route({
    method: "POST",
    path: "/ask",
    operationId: "ask",
    request: { body: z.object({ q: z.string() }).strict() as any },
    responses: { 200: { description: "ok", body: z.object({ scopes: z.array(z.string()) }) as any } },
    handler: async (ctx) => ({
      status: 200 as const,
      body: { scopes: ((ctx.state as any).user as { scopes: string[] }).scopes },
    }),
  });
  return app;
}

function ask(app: App, token: string, body: string): Promise<Response> {
  return app.fetch(
    new Request("http://x/ask", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body,
    })
  );
}

test("jwk: a string-valued Entra scp claim is split into scopes", async () => {
  const { jwks, token } = await entraFixture();
  const app = entraApp(jwks, requireScopes(["agent.chat"]));
  const res = await ask(app, await token({ scp: "agent.chat  user_impersonation agent.chat" }), VALID.replace("name", "q"));
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { scopes: string[] }).scopes, [
    "agent.chat",
    "user_impersonation",
  ]);
});

test("jwk: a string scp without the required scope is still 403", async () => {
  const { jwks, token } = await entraFixture();
  const app = entraApp(jwks, requireScopes(["agent.chat"]));
  assert.equal((await ask(app, await token({ scp: "user_impersonation" }), '{"q":"x"}')).status, 403);
});

test("jwk: non-string scp shapes grant no scopes", async () => {
  const { jwks, token } = await entraFixture();
  const app = entraApp(jwks, requireScopes(["agent.chat"]));
  for (const scp of [42, { "agent.chat": true }, "", "   ", true, [7, null]]) {
    const res = await ask(app, await token({ scp }), '{"q":"x"}');
    assert.equal(res.status, 403, `scp ${JSON.stringify(scp)} must not grant agent.chat`);
  }
});

test("jwk: the standard scope claim still takes precedence over scp", async () => {
  const { jwks, token } = await entraFixture();
  const app = entraApp(jwks, requireScopes(["agent.chat"]));
  // `scope` is present, so `scp` is not consulted.
  const res = await ask(app, await token({ scope: "other", scp: "agent.chat" }), '{"q":"x"}');
  assert.equal(res.status, 403);
});

test("jwk + preBody any-of scopes: Entra token, wrong scope, malformed body is 403", async () => {
  const { jwks, token } = await entraFixture();
  const app = entraApp(
    jwks,
    requireScopes(["agent.chat", "agent.admin"], { phase: "preBody", match: "any" })
  );
  assert.equal((await ask(app, await token({ scp: "user_impersonation" }), MALFORMED)).status, 403);
  assert.equal((await ask(app, await token({ scp: "agent.chat" }), MALFORMED)).status, 400);
  assert.equal((await ask(app, await token({ scp: "agent.chat" }), '{"q":"x"}')).status, 200);
  // Missing or expired credentials stay 401 regardless of the body.
  const expired = await token({ scp: "agent.chat", iat: 1, exp: 2 });
  assert.equal((await ask(app, expired, MALFORMED)).status, 401);
});

// ---------------------------------------------------------------------------
// 5. requestTimeoutStatus
// ---------------------------------------------------------------------------

function slowApp(options: Record<string, unknown>): App {
  const app = new App({ env: "test", logger: false, requestTimeoutMs: 5, ...options });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async (ctx) => {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 200);
        ctx.request.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return app;
}

test("request deadline answers 408 Request Timeout by default", async () => {
  const res = await slowApp({}).request("/slow");
  assert.equal(res.status, 408);
  const problem = (await res.json()) as { type: string; title: string; status: number };
  assert.equal(problem.title, "Request Timeout");
  assert.equal(problem.type, "https://daloyjs.dev/errors/request-timeout");
});

test("requestTimeoutStatus: 504 answers Gateway Timeout with the same problem type", async () => {
  const res = await slowApp({ requestTimeoutStatus: 504 }).request("/slow");
  assert.equal(res.status, 504);
  const problem = (await res.json()) as { type: string; title: string; status: number };
  assert.equal(problem.status, 504);
  assert.equal(problem.title, "Gateway Timeout");
  assert.equal(problem.type, "https://daloyjs.dev/errors/request-timeout");
});

test("requestTimeoutStatus: 503 answers Service Unavailable", async () => {
  const res = await slowApp({ requestTimeoutStatus: 503 }).request("/slow");
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { title: string }).title, "Service Unavailable");
});

test("requestTimeoutStatus: a fast request is unaffected", async () => {
  const app = new App({ env: "test", logger: false, requestTimeoutStatus: 504 });
  app.route({
    method: "GET",
    path: "/fast",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/fast")).status, 200);
});

test("requestTimeoutStatus refuses anything but 408, 503, or 504", () => {
  for (const value of [200, 500, 502, "504", null, Number.NaN, 504.5]) {
    assert.throws(
      () => new App({ env: "test", logger: false, requestTimeoutStatus: value as never }),
      /requestTimeoutStatus \}\) must be 408, 503, or 504/
    );
  }
  for (const value of [undefined, 408, 503, 504] as const) {
    const app = new App({ env: "test", logger: false, requestTimeoutStatus: value });
    assert.equal(app.options.requestTimeoutStatus, value ?? 408);
  }
});

test("RequestTimeoutError falls back to 408 for an unsupported status", () => {
  assert.equal(new RequestTimeoutError(10).status, 408);
  assert.equal(new RequestTimeoutError(10, 504).status, 504);
  const fallback = new RequestTimeoutError(10, 200 as never);
  assert.equal(fallback.status, 408);
  assert.equal(fallback.problem.title, "Request Timeout");
});

// ---------------------------------------------------------------------------
// 6. Automatic preflight correlation id
// ---------------------------------------------------------------------------

test("a CORS-intercepted automatic preflight carries X-Request-Id", async () => {
  const app = new App({ env: "test", logger: false });
  app.use(cors({ origin: "https://app.example.com" }));
  app.route({
    method: "POST",
    path: "/p",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const allowed = await app.request("/p", {
    method: "OPTIONS",
    headers: { origin: "https://app.example.com", "access-control-request-method": "POST" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.match(allowed.headers.get("x-request-id") ?? "", /^\S{8,}$/);

  // A disallowed origin still gets no CORS policy, but is still correlatable.
  const denied = await app.request("/p", {
    method: "OPTIONS",
    headers: { origin: "https://evil.test", "access-control-request-method": "POST" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.ok(denied.headers.get("x-request-id"));
});
