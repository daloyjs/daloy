/**
 * Red-team attack suite — Wave 19 (live local DaloyJS server + cross-module
 * protocol & state-machine attacks).
 *
 * Each test below fails against the pre-fix code; most run over a live Node
 * HTTP server (`serve()`) and raw TCP sockets (`node:net`):
 *
 *   1. Envoy `X-Forwarded-Client-Cert` (XFCC) escaped-quote SAN smuggling: a
 *      Subject like `"CN=\"evil;DNS=allowed.internal;O=x\""` leaked a forged
 *      top-level DNS SAN when quote state toggled on every `"`.
 *   2. `requestDecompression()` inflating before auth / on 404 paths,
 *      raw-body readers (`request.text()`, `clone()`) seeing compressed bytes,
 *      post-inflation `bodyLimitBytes` on schema-less routes, and
 *      `Expect: 100-continue` answered before auth on small bodies.
 *   3. Stored-response replay (`responseCache()` / `idempotency()`) answering
 *      before a later `beforeHandle` auth hook, both via `app.use()` and inside
 *      `every()`, without hoisting unrelated hooks ahead of the replay.
 *   4. Cross-tenant `idempotency()` replay and the idempotency-before-tenancy
 *      boot guard; a throwing `onSend` hook whose error response was stored and
 *      replayed for the whole TTL; and an evicted `MemoryIdempotencyStore`
 *      reservation completing over a newer one.
 *   5. `jwk()` refetching on every request during an IdP outage, and the
 *      JWKS body cap.
 *   6. `MemorySessionStore` capacity bound and expired `touch()` revival, and
 *      `MemoryResponseCacheStore` header-byte accounting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import {
  App,
  ForbiddenError,
  MemoryIdempotencyStore,
  MemoryResponseCacheStore,
  MemorySessionStore,
  UnauthorizedError,
  bearerAuth,
  clientCertAuth,
  createJwtSigner,
  every,
  idempotency,
  jwk,
  markAuthHook,
  parseForwardedClientCert,
  requestDecompression,
  responseCache,
  some,
  tenancy,
  tenantFromHeader,
  type Hooks,
} from "../src/index.js";
import {
  serve,
  type NodeServerHandle,
  type NodeServerOptions,
} from "../src/adapters/node.js";

async function startLiveServer(
  app: App,
  opts: NodeServerOptions = {},
): Promise<{ handle: NodeServerHandle; port: number; baseUrl: string }> {
  const handle = serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    handleSignals: false,
    ...opts,
  });
  await new Promise<void>((resolve) =>
    handle.server.once("listening", () => resolve()),
  );
  const addr = handle.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { handle, port, baseUrl: `http://127.0.0.1:${port}` };
}

function collectRawStatusLines(
  port: number,
  rawRequest: string,
  timeoutMs = 1500,
): Promise<number[]> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    let buf = "";
    const finish = () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(
        [...buf.matchAll(/HTTP\/\d\.\d (\d{3})/g)].map((m) => Number(m[1])),
      );
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => sock.write(rawRequest));
    sock.on("data", (d) => {
      buf += d.toString("latin1");
    });
    sock.on("timeout", finish);
    sock.on("close", finish);
    sock.on("error", finish);
  });
}

function strictExpectSocket(
  port: number,
  head: string,
  body: Buffer,
  waitMs = 1500,
): Promise<number[]> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1", () => sock.write(head));
    let buf = "";
    let sent = false;
    const done = () => {
      sock.destroy();
      resolve(
        [...buf.matchAll(/HTTP\/\d\.\d (\d{3})/g)].map((m) => Number(m[1])),
      );
    };
    const timer = setTimeout(done, waitMs);
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      if (!sent && buf.startsWith("HTTP/1.1 100")) {
        sent = true;
        sock.write(body);
      }
      if (/HTTP\/1\.1 [2-5]\d\d[\s\S]*\r\n\r\n/.test(buf)) {
        clearTimeout(timer);
        setTimeout(done, 30);
      }
    });
    sock.on("error", () => undefined);
  });
}

// ===========================================================================
// 1. Envoy XFCC escaped-quote SAN / CN smuggling
// ===========================================================================

test("Wave 19.1 [live]: XFCC escaped-quote SAN smuggling is rejected while valid escaped DNs pass", async () => {
  const app = new App({ logger: false });
  app.use(
    clientCertAuth({
      header: { format: "xfcc" },
      allowSANs: ["DNS:allowed.internal"],
    }),
  );
  app.route({
    method: "GET",
    path: "/mesh-secret",
    operationId: "meshSecret",
    responses: {
      200: {
        description: "ok",
        body: z.object({
          cn: z.string().nullable(),
          sans: z.array(z.string()),
        }) as any,
      },
    },
    handler: async ({ state }) => {
      const cert = (state as Record<string, any>).clientCertificate;
      return {
        status: 200 as const,
        body: { cn: cert.subjectCN, sans: cert.subjectAltNames },
      };
    },
  });

  const { handle, baseUrl } = await startLiveServer(app);
  try {
    // Unhappy 1: a Subject whose escaped quotes leave `;DNS=allowed.internal;`
    // between them. A parser that toggles quote state on every `"` sees that
    // span as unquoted and lifts a forged top-level DNS SAN out of the Subject.
    const smuggled = await fetch(`${baseUrl}/mesh-secret`, {
      headers: {
        "x-forwarded-client-cert":
          'By=spiffe://mesh/gw;Hash=abc;Subject="CN=\\"evil;DNS=allowed.internal;O=x\\"";URI=spiffe://mesh/attacker',
      },
    });
    assert.ok(
      smuggled.status === 401 || smuggled.status === 403,
      `escaped quote inside Subject must not split out a forged DNS SAN (got ${smuggled.status})`,
    );

    // Unhappy 2: unbalanced quote in XFCC element fails closed.
    const unbalanced = await fetch(`${baseUrl}/mesh-secret`, {
      headers: {
        "x-forwarded-client-cert":
          'Hash=abc;Subject="CN=allowed.internal;DNS=allowed.internal',
      },
    });
    assert.equal(
      unbalanced.status,
      401,
      "unbalanced quotes in XFCC header must fail closed",
    );

    // The same payload, parsed directly: the DNS name stays inside the Subject.
    const parsed = parseForwardedClientCert(
      'Hash=abc;Subject="CN=\\"evil;DNS=allowed.internal;O=x\\"";URI=spiffe://mesh/attacker',
    );
    assert.deepEqual(parsed?.subjectAltNames, ["URI:spiffe://mesh/attacker"]);
    assert.equal(parsed?.subjectCN, "evil;DNS=allowed.internal;O=x");

    // Unhappy 3: unescaped internal quote in DN attribute fails closed.
    assert.equal(
      parseForwardedClientCert(
        'Hash=abc;Subject="CN=evil"injected";DNS=allowed.internal',
      ),
      undefined,
    );

    // Happy: legitimate escaped quotes in Subject + genuine DNS=allowed.internal SAN.
    const legit = await fetch(`${baseUrl}/mesh-secret`, {
      headers: {
        "x-forwarded-client-cert":
          'By=spiffe://mesh/gw;Hash=abc;Subject="CN=\\"Ops, Inc.\\",O=Acme";DNS=allowed.internal',
      },
    });
    assert.equal(legit.status, 200);
    const body = (await legit.json()) as { cn: string | null; sans: string[] };
    assert.equal(body.cn, "Ops, Inc.");
    assert.deepEqual(body.sans, ["DNS:allowed.internal"]);
  } finally {
    await handle.close();
  }
});

// ===========================================================================
// 2. Pre-auth decompression, raw-body reader parity, and Expect: 100-continue
// ===========================================================================

test("Wave 19.2 [live]: requestDecompression runs after preBody auth/404 and installs decompressed Request readers", async () => {
  let bombCallbackFired = false;
  const app = new App({ logger: false, bodyLimitBytes: 512 });
  app.use(
    requestDecompression({
      maxDecompressedBytes: 2048,
      maxRatio: 20,
      onBomb: () => {
        bombCallbackFired = true;
      },
    }),
  );
  app.use(
    bearerAuth({
      validate: (token) => token === "valid-secret-token",
    }),
  );

  app.route({
    method: "POST",
    path: "/raw-echo",
    operationId: "rawEcho",
    responses: {
      200: {
        description: "ok",
        body: z.object({
          text: z.string(),
          clonedText: z.string(),
        }) as any,
      },
    },
    handler: async ({ request }) => {
      const cloned = request.clone();
      const [text, clonedText] = await Promise.all([
        request.text(),
        cloned.text(),
      ]);
      return { status: 200 as const, body: { text, clonedText } };
    },
  });

  const { handle, port, baseUrl } = await startLiveServer(app);
  try {
    const bombPayload = gzipSync(Buffer.alloc(10_000, 0x41));

    // Unhappy 1: unauthenticated request carrying a gzip bomb is rejected 401
    // BEFORE requestDecompression inflates anything.
    const unauthBomb = await fetch(`${baseUrl}/raw-echo`, {
      method: "POST",
      headers: {
        "content-encoding": "gzip",
        "content-type": "text/plain",
      },
      body: bombPayload,
    });
    assert.equal(unauthBomb.status, 401);
    assert.equal(
      bombCallbackFired,
      false,
      "gzip bomb must never be inflated for unauthenticated callers",
    );

    // Unhappy 2: 404 route carrying a gzip bomb is rejected 404 without inflating.
    const notFoundBomb = await fetch(`${baseUrl}/does-not-exist`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-secret-token",
        "content-encoding": "gzip",
        "content-type": "text/plain",
      },
      body: bombPayload,
    });
    assert.equal(notFoundBomb.status, 404);
    assert.equal(
      bombCallbackFired,
      false,
      "gzip bomb must never be inflated on a 404 route",
    );

    // Unhappy 3: raw TCP `Expect: 100-continue` with small Content-Length and NO auth
    // is rejected 401 immediately without soliciting the body (`[401]`, never `[100, 401]`).
    const unauthExpectStatuses = await collectRawStatusLines(
      port,
      "POST /raw-echo HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Content-Length: 32\r\n" +
        "Expect: 100-continue\r\n" +
        "Connection: close\r\n\r\n",
    );
    assert.deepEqual(
      unauthExpectStatuses,
      [401],
      "unauthenticated Expect: 100-continue must not emit 100 Continue",
    );

    // Happy 1: authenticated `Expect: 100-continue` with small Content-Length gets
    // `[100, 200]` and the raw-body handler reads the decompressed gzip payload.
    const compressedHello = gzipSync(
      Buffer.from("hello from compressed stream"),
    );
    const authExpectStatuses = await strictExpectSocket(
      port,
      "POST /raw-echo HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Authorization: Bearer valid-secret-token\r\n" +
        "Content-Type: text/plain\r\n" +
        "Content-Encoding: gzip\r\n" +
        `Content-Length: ${compressedHello.length}\r\n` +
        "Expect: 100-continue\r\n" +
        "Connection: close\r\n\r\n",
      compressedHello,
    );
    assert.deepEqual(authExpectStatuses, [100, 200]);

    // Happy 2: standard fetch with Content-Encoding: gzip on a raw-body route
    // returns the decompressed text on both `request.text()` and `request.clone().text()`.
    const okRes = await fetch(`${baseUrl}/raw-echo`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-secret-token",
        "content-encoding": "gzip",
        "content-type": "text/plain",
      },
      body: compressedHello,
    });
    assert.equal(okRes.status, 200);
    assert.deepEqual(await okRes.json(), {
      text: "hello from compressed stream",
      clonedText: "hello from compressed stream",
    });

    // Unhappy 4: an 800-byte hex payload gzips to roughly half its size, so it
    // stays under bodyLimitBytes (512) compressed and far below maxRatio (20),
    // yet inflates past bodyLimitBytes. The 413 must come from the post-inflation
    // body-limit re-check on this schema-less route, not from the bomb guard.
    const overAppLimit = gzipSync(
      Buffer.from(randomBytes(400).toString("hex")),
    );
    assert.ok(
      overAppLimit.byteLength < 512,
      `compressed fixture is ${overAppLimit.byteLength}B`,
    );
    const overLimitRes = await fetch(`${baseUrl}/raw-echo`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid-secret-token",
        "content-encoding": "gzip",
        "content-type": "text/plain",
      },
      body: overAppLimit,
    });
    assert.equal(
      overLimitRes.status,
      413,
      "inflated body exceeding app bodyLimitBytes must be refused 413",
    );
    assert.equal(
      bombCallbackFired,
      false,
      "the 413 must not come from the decompression-bomb guard",
    );
  } finally {
    await handle.close();
  }
});

// ===========================================================================
// 3. Stored-response replay cannot bypass `beforeHandle` auth hooks
// ===========================================================================

test("Wave 19.3 [live]: responseCache and idempotency never preempt a later beforeHandle auth hook", async () => {
  let activeValidToken = "token-v1";
  const customBeforeHandleAuth: Hooks = markAuthHook({
    beforeHandle(ctx) {
      const hdr = ctx.request.headers.get("x-custom-auth");
      if (hdr !== activeValidToken) {
        throw new UnauthorizedError("Invalid or revoked X-Custom-Auth token");
      }
      (ctx.state as Record<string, unknown>).user = { sub: "user-1" };
    },
  });

  const app = new App({ logger: false });
  // Intentionally register responseCache and idempotency BEFORE the custom
  // `beforeHandle` auth hook (and also compose via `some()`).
  app.use(
    responseCache({
      ttlSeconds: 60,
      store: new MemoryResponseCacheStore(),
      cacheAuthenticatedRequests: true,
    }),
  );
  app.use(
    idempotency({
      ttlSeconds: 60,
      store: new MemoryIdempotencyStore(),
      allowUnscopedCallers: true,
    }),
  );
  app.use(some(customBeforeHandleAuth));

  let runs = 0;
  app.route({
    method: "GET",
    path: "/cached-report",
    operationId: "cachedReport",
    responses: {
      200: { description: "ok", body: z.object({ runs: z.number() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { runs: ++runs } }),
  });

  app.route({
    method: "POST",
    path: "/idempotent-transfer",
    operationId: "idempotentTransfer",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: {
      200: {
        description: "ok",
        body: z.object({ runs: z.number(), amount: z.number() }) as any,
      },
    },
    handler: async ({ body }) => ({
      status: 200 as const,
      body: { runs: ++runs, amount: (body as { amount: number }).amount },
    }),
  });

  const { handle, baseUrl } = await startLiveServer(app);
  try {
    // 1. Seed the response cache with a valid token.
    const r1 = await fetch(`${baseUrl}/cached-report`, {
      headers: { "x-custom-auth": "token-v1" },
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("x-cache"), "MISS");

    // 2. Unauthenticated caller requests the cached URL -> MUST get 401, not a cached 200 HIT!
    const unauthCache = await fetch(`${baseUrl}/cached-report`);
    assert.equal(
      unauthCache.status,
      401,
      "unauthenticated caller must not receive a cached 200 HIT",
    );

    // 3. Seed the idempotency store with a valid token.
    const p1 = await fetch(`${baseUrl}/idempotent-transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom-auth": "token-v1",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ amount: 50 }),
    });
    assert.equal(p1.status, 200);

    // 4. Revoke token-v1 -> retrying with the same Idempotency-Key and revoked token MUST get 401!
    activeValidToken = "token-v2";
    const revokedReplay = await fetch(`${baseUrl}/idempotent-transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom-auth": "token-v1",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ amount: 50 }),
    });
    assert.equal(
      revokedReplay.status,
      401,
      "revoked caller must not replay stored idempotent response",
    );

    // 5. With the new valid token, the replay succeeds.
    const validReplay = await fetch(`${baseUrl}/idempotent-transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom-auth": "token-v2",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ amount: 50 }),
    });
    assert.equal(validReplay.status, 200);
    assert.equal(validReplay.headers.get("idempotency-replayed"), "true");
  } finally {
    await handle.close();
  }
});

test("Wave 19.3b: every() keeps a responseCache() replay behind a later beforeHandle auth hook", async () => {
  // Regression: every() must recognise responseCache()'s real marker
  // ("daloyjs.response-cache.hook"); with a misspelt key the cache ran first.
  const app = new App({ logger: false });
  app.use(
    every(
      responseCache({
        ttlSeconds: 60,
        store: new MemoryResponseCacheStore(),
        cacheAuthenticatedRequests: true,
      }),
      markAuthHook({
        beforeHandle(ctx) {
          if (ctx.request.headers.get("x-custom-auth") !== "ok") {
            throw new UnauthorizedError("missing X-Custom-Auth");
          }
        },
      }),
    ),
  );
  let runs = 0;
  app.route({
    method: "GET",
    path: "/report",
    operationId: "everyReport",
    responses: {
      200: { description: "ok", body: z.object({ runs: z.number() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { runs: ++runs } }),
  });

  const seeded = await app.fetch(
    new Request("http://x/report", { headers: { "x-custom-auth": "ok" } }),
  );
  assert.equal(seeded.status, 200);
  const hit = await app.fetch(
    new Request("http://x/report", { headers: { "x-custom-auth": "ok" } }),
  );
  assert.equal(hit.headers.get("x-cache"), "HIT");

  const unauth = await app.fetch(new Request("http://x/report"));
  assert.equal(
    unauth.status,
    401,
    "every(responseCache(), auth) must not serve a cached HIT to an anonymous caller",
  );
});

test("Wave 19.3c: only hooks up to the last auth hook move ahead of a replay; later hooks still run after it", async () => {
  const calls: string[] = [];
  const app = new App({ logger: false });
  app.use({
    beforeHandle() {
      calls.push("before-cache");
    },
  });
  app.use(
    responseCache({
      ttlSeconds: 60,
      store: new MemoryResponseCacheStore(),
      cacheAuthenticatedRequests: true,
    }),
  );
  app.use(
    markAuthHook({
      beforeHandle(ctx) {
        calls.push("auth");
        if (ctx.request.headers.get("x-custom-auth") !== "ok") {
          throw new UnauthorizedError("missing X-Custom-Auth");
        }
      },
    }),
  );
  app.use({
    beforeHandle() {
      calls.push("after-auth");
    },
  });
  app.route({
    method: "GET",
    path: "/ordered",
    operationId: "orderedReport",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const miss = await app.fetch(
    new Request("http://x/ordered", { headers: { "x-custom-auth": "ok" } }),
  );
  assert.equal(miss.headers.get("x-cache"), "MISS");
  assert.deepEqual(calls, ["before-cache", "auth", "after-auth"]);

  calls.length = 0;
  const hit = await app.fetch(
    new Request("http://x/ordered", { headers: { "x-custom-auth": "ok" } }),
  );
  assert.equal(hit.headers.get("x-cache"), "HIT");
  // A HIT short-circuits before "after-auth": that hook was registered after
  // the cache and the last auth hook, so it is not hoisted ahead of the replay.
  assert.deepEqual(calls, ["before-cache", "auth"]);

  calls.length = 0;
  const anon = await app.fetch(new Request("http://x/ordered"));
  assert.equal(anon.status, 401);
  assert.deepEqual(calls, ["before-cache", "auth"]);
});

// ===========================================================================
// 4. Cross-tenant idempotency isolation, finalizer release, and eviction race
// ===========================================================================

test("Wave 19.4 [live]: idempotency partitions by tenancy() and releases on a throwing onSend", async () => {
  // 4a. Boot guard refuses idempotency() mounted before tenancy() in production.
  const misordered = new App({ env: "production", logger: false });
  misordered.use(
    idempotency({ ttlSeconds: 60, store: new MemoryIdempotencyStore() }),
  );
  misordered.use(
    tenancy({ resolve: tenantFromHeader("x-tenant-id"), require: false }),
  );
  misordered.route({
    method: "POST",
    path: "/orders",
    operationId: "misorderedOrders",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.throws(() => misordered.assertSecureConfig(), /tenancy/);

  // 4b. Live server: tenancy() + idempotency() + throwing onSend recovery.
  let throwInDownstreamOnSend = false;
  const app = new App({ logger: false });
  // onSend hooks run in registration order, so this one runs (and throws)
  // before idempotency()'s own onSend can complete or release the key.
  app.use({
    onSend(res) {
      if (throwInDownstreamOnSend) {
        throwInDownstreamOnSend = false;
        throw new ForbiddenError("onSend failure before idempotency.onSend");
      }
      return res;
    },
  });
  app.use(
    tenancy({
      resolve: tenantFromHeader("x-tenant-id"),
      allow: ["acme", "globex"],
    }),
  );
  app.use(
    idempotency({
      ttlSeconds: 60,
      store: new MemoryIdempotencyStore(),
      allowUnscopedCallers: true,
    }),
  );

  let seq = 0;
  app.route({
    method: "POST",
    path: "/payments",
    operationId: "createPayment",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: {
      200: {
        description: "ok",
        body: z.object({
          tenant: z.string(),
          seq: z.number(),
          amount: z.number(),
        }) as any,
      },
    },
    handler: async ({ state, body }) => ({
      status: 200 as const,
      body: {
        tenant: String((state as Record<string, unknown>).tenant),
        seq: ++seq,
        amount: (body as { amount: number }).amount,
      },
    }),
  });

  const { handle, baseUrl } = await startLiveServer(app);
  try {
    // Tenant "acme" sends Idempotency-Key: shared-key
    const acmeRes = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "acme",
        "idempotency-key": "shared-key",
      },
      body: JSON.stringify({ amount: 100 }),
    });
    assert.equal(acmeRes.status, 200);
    const acmeBody = (await acmeRes.json()) as { tenant: string; seq: number };
    assert.equal(acmeBody.tenant, "acme");

    // Tenant "globex" sends the SAME Idempotency-Key and SAME payload ->
    // MUST NOT replay acme's response!
    const globexRes = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "globex",
        "idempotency-key": "shared-key",
      },
      body: JSON.stringify({ amount: 100 }),
    });
    assert.equal(globexRes.status, 200);
    assert.equal(globexRes.headers.get("idempotency-replayed"), null);
    const globexBody = (await globexRes.json()) as {
      tenant: string;
      seq: number;
    };
    assert.equal(globexBody.tenant, "globex");
    assert.notEqual(globexBody.seq, acmeBody.seq);

    // A throwing `onSend` hook that runs before idempotency()'s own onSend: the
    // reservation is released by the request finalizer, so the retry runs fresh
    // instead of replaying the hook's error response for the whole TTL.
    throwInDownstreamOnSend = true;
    const failedAttempt = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "acme",
        "idempotency-key": "recover-key",
      },
      body: JSON.stringify({ amount: 250 }),
    });
    assert.equal(failedAttempt.status, 403);

    const retryAttempt = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "acme",
        "idempotency-key": "recover-key",
      },
      body: JSON.stringify({ amount: 250 }),
    });
    assert.equal(
      retryAttempt.status,
      200,
      "retry after an aborted onSend pipeline must run fresh, not replay the hook's error",
    );
    assert.equal(
      retryAttempt.headers.get("idempotency-replayed"),
      null,
      "the retry must run fresh",
    );
  } finally {
    await handle.close();
  }
});

test("Wave 19.4b: a reservation evicted mid-flight cannot overwrite a newer in-flight reservation", async () => {
  // maxEntries: 1 lets an unrelated key evict a slow request's reservation.
  const app = new App({ logger: false });
  app.use(
    idempotency({
      ttlSeconds: 60,
      store: new MemoryIdempotencyStore(1),
      allowUnscopedCallers: true,
    }),
  );
  const gates = new Map<string, () => void>();
  let seq = 0;
  app.route({
    method: "POST",
    path: "/slow",
    operationId: "slowCharge",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: {
      200: { description: "ok", body: z.object({ seq: z.number() }) as any },
    },
    handler: async ({ request }) => {
      const run = ++seq;
      const gate = request.headers.get("x-gate");
      if (gate) await new Promise<void>((resolve) => gates.set(gate, resolve));
      return { status: 200 as const, body: { seq: run } };
    },
  });
  const post = (key: string, gate?: string) =>
    app.fetch(
      new Request("http://x/slow", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          ...(gate ? { "x-gate": gate } : {}),
        },
        body: JSON.stringify({ amount: 1 }),
      }),
    );
  const waitForGate = async (gate: string) => {
    while (!gates.has(gate)) await new Promise((r) => setTimeout(r, 1));
  };

  const first = post("K", "a"); // reserves K, then blocks
  await waitForGate("a");
  assert.equal((await post("J")).status, 200); // evicts K
  const second = post("K", "b"); // K is free again: a newer reservation
  await waitForGate("b");

  gates.get("a")!();
  assert.equal((await first).status, 200);

  // The stale first request must not complete over the newer reservation:
  // K is still in flight, so a retry conflicts instead of replaying it.
  const retry = await post("K");
  assert.equal(retry.status, 409);

  gates.get("b")!();
  const secondRes = await second;
  assert.equal(secondRes.status, 200);
  const replay = await post("K");
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(await replay.json(), await secondRes.json());
});

// ===========================================================================
// 5. JWKS outage stampede backoff & size cap, MemorySessionStore bounds, and
//    MemoryResponseCacheStore header byte accounting
// ===========================================================================

test("Wave 19.5 [live]: jwk() backs off during IdP outage and caps oversized JWKS responses", async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pubJwk = {
    ...(await crypto.subtle.exportKey("jwk", publicKey)),
    kid: "live-k1",
    alg: "ES256",
    use: "sig",
  };
  const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
  const signer = createJwtSigner({
    alg: "ES256",
    key: privJwk,
    maxLifetimeSeconds: 3600,
    header: { kid: "live-k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({
    sub: "user-live",
    exp: now + 600,
    iat: now,
  });

  let jwksFetches = 0;
  let idpMode: "healthy" | "outage" | "oversized" = "healthy";
  const fakeFetch: typeof fetch = async () => {
    jwksFetches++;
    if (idpMode === "healthy") {
      return new Response(JSON.stringify({ keys: [pubJwk] }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (idpMode === "outage") {
      return new Response("IdP down", { status: 503 });
    }
    // 2 MiB payload (> 1 MiB cap)
    const huge = `{"keys":[${JSON.stringify(pubJwk)}],"pad":"${"A".repeat(2 * 1024 * 1024)}"}`;
    return new Response(huge, {
      headers: { "content-type": "application/json" },
    });
  };

  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks: "https://idp.example.com/.well-known/jwks.json",
      algorithms: ["ES256"],
      fetch: fakeFetch,
      fetchTtlSeconds: 1,
      maxStaleSeconds: 60,
    }),
  );
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protectedJwk",
    responses: {
      200: { description: "ok", body: z.object({ sub: z.string() }) as any },
    },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: {
        sub: String(
          ((state as Record<string, any>).user as { sub: string }).sub,
        ),
      },
    }),
  });

  const { handle, baseUrl } = await startLiveServer(app);
  try {
    // 1. Seed the JWKS cache.
    const r1 = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(r1.status, 200);
    assert.equal(jwksFetches, 1);

    // Wait for the 1s TTL to expire, then flip the IdP to outage.
    await new Promise((r) => setTimeout(r, 1100));
    idpMode = "outage";

    // Fire 10 sequential requests during the outage: stale-while-error serves
    // the cached key AND retryCooldownMs prevents a stampede (only 1 refresh
    // attempt fires across all 10 requests!).
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/protected`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
    }
    assert.equal(
      jwksFetches,
      2,
      "failed JWKS refresh must enter cooldown rather than stampeding the IdP on every request",
    );

    // Oversized JWKS (> 1 MiB) on cold boot with maxStaleSeconds: 0 fails closed with 401.
    idpMode = "oversized";
    const coldApp = new App({ logger: false });
    coldApp.use(
      jwk({
        jwks: "https://idp.example.com/.well-known/jwks.json",
        algorithms: ["ES256"],
        fetch: fakeFetch,
        fetchTtlSeconds: 60,
        maxStaleSeconds: 0,
      }),
    );
    coldApp.route({
      method: "GET",
      path: "/protected",
      operationId: "protectedCold",
      responses: {
        200: { description: "ok", body: z.object({ ok: z.boolean() }) as any },
      },
      handler: async () => ({ status: 200 as const, body: { ok: true } }),
    });
    const oversizedRes = await coldApp.request("/protected", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(
      oversizedRes.status,
      401,
      "oversized JWKS response must be refused",
    );
  } finally {
    await handle.close();
  }
});

test("Wave 19.6: MemorySessionStore bounds capacity and touch() refuses expired records; MemoryResponseCacheStore counts header bytes", () => {
  const sessionStore = new MemorySessionStore(25);
  const future = Date.now() + 60_000;
  for (let i = 0; i < 100; i++) {
    sessionStore.set(`sid-${i}`, { data: { i }, expiresAt: future });
  }
  assert.equal(
    sessionStore.size(),
    25,
    "MemorySessionStore must evict oldest entries at maxEntries",
  );
  assert.equal(sessionStore.get("sid-0"), null);
  assert.notEqual(sessionStore.get("sid-99"), null);

  // An expired session cannot be revived by touch().
  sessionStore.set("expired-sid", {
    data: { user: "alice" },
    expiresAt: Date.now() - 10,
  });
  sessionStore.touch("expired-sid", Date.now() + 60_000);
  assert.equal(
    sessionStore.get("expired-sid"),
    null,
    "touch() must not revive an expired session",
  );

  // MemoryResponseCacheStore counts header bytes toward maxBytes even when body is empty.
  const cacheStore = new MemoryResponseCacheStore({
    maxEntries: 1000,
    maxBytes: 2000,
  });
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    cacheStore.set(
      `hdr-${i}`,
      {
        status: 204,
        headers: [["x-large-meta", "V".repeat(500)]],
        body: "",
        storedAt: now,
        freshUntil: now + 60_000,
        staleUntil: now + 60_000,
      },
      60_000,
    );
  }
  assert.ok(
    cacheStore.size() <= 4,
    `expected header footprint to bound MemoryResponseCacheStore to <= 4 entries, got ${cacheStore.size()}`,
  );
});
