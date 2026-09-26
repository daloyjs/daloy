import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  clientCertAuth,
  idempotency,
  MemoryIdempotencyStore,
  _resetSharedIdempotencyStoresForTests,
  type IdempotencyOptions,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "../src/index.js";

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * Build an app with `idempotency()` mounted ahead of a single `POST /pay`
 * route. The handler increments `calls` so tests can assert it ran (or was
 * skipped via replay), and echoes the request body back.
 */
function makeApp(opts: IdempotencyOptions = {}) {
  const app = new App({ logger: false });
  const state = { calls: 0, fail: false, gate: null as Promise<void> | null };
  app.use(idempotency(opts));
  app.route({
    method: "POST",
    path: "/pay",
    operationId: "pay",
    request: { body: z.object({ amount: z.number() }).optional() as any },
    responses: {
      201: {
        description: "created",
        body: z.object({ id: z.number(), amount: z.number() }) as any,
      },
    },
    handler: async ({ body }) => {
      state.calls++;
      if (state.gate) await state.gate;
      if (state.fail) throw new Error("boom");
      const amount = (body as { amount?: number } | undefined)?.amount ?? 0;
      return { status: 201 as const, body: { id: state.calls, amount } };
    },
  });
  app.route({
    method: "GET",
    path: "/pay",
    operationId: "payStatus",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      state.calls++;
      return { status: 200 as const, body: { calls: state.calls } };
    },
  });
  return { app, state };
}

function payInit(key: string | undefined, amount = 10): RequestInit {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (key !== undefined) headers["idempotency-key"] = key;
  return { method: "POST", headers, body: JSON.stringify({ amount }) };
}

// ---------- Happy paths ----------

test("first request runs the handler and persists the response", async () => {
  const { app, state } = makeApp();
  const res = await app.request("/pay", payInit("key-1"));
  assert.equal(res.status, 201);
  assert.equal(state.calls, 1);
  assert.equal(res.headers.get("idempotency-replayed"), null);
  const body = await res.json();
  assert.deepEqual(body, { id: 1, amount: 10 });
});

test("identical retry replays the stored response without re-running the handler", async () => {
  const { app, state } = makeApp();
  const first = await app.request("/pay", payInit("key-2"));
  const firstBody = await first.json();

  const second = await app.request("/pay", payInit("key-2"));
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("idempotency-replayed"), "true");
  assert.equal(state.calls, 1, "handler must run exactly once across retries");
  const secondBody = await second.json();
  assert.deepEqual(secondBody, firstBody);
});

test("requests without a key pass through and always run the handler", async () => {
  const { app, state } = makeApp();
  await app.request("/pay", payInit(undefined));
  await app.request("/pay", payInit(undefined));
  assert.equal(state.calls, 2);
});

test("non-applicable methods pass through even with a key", async () => {
  const { app, state } = makeApp();
  await app.request("/pay", { method: "GET", headers: { "idempotency-key": "g1" } });
  await app.request("/pay", { method: "GET", headers: { "idempotency-key": "g1" } });
  assert.equal(state.calls, 2);
});

test("a custom header name is honored", async () => {
  const { app, state } = makeApp({ headerName: "X-Idempotency-Token" });
  const init = payInit(undefined);
  (init.headers as Record<string, string>)["x-idempotency-token"] = "tok-1";
  await app.request("/pay", init);
  await app.request("/pay", init);
  assert.equal(state.calls, 1);
});

test("the same groupId shares a store across separate mounts", async () => {
  _resetSharedIdempotencyStoresForTests();
  const a = makeApp({ groupId: "payments" });
  const b = makeApp({ groupId: "payments" });
  const first = await a.app.request("/pay", payInit("shared-key"));
  assert.equal(first.status, 201);
  const replay = await b.app.request("/pay", payInit("shared-key"));
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(b.state.calls, 0, "second mount must replay, not re-run");
});

// ---------- Unhappy paths ----------

test("a key reused with a different body returns 422", async () => {
  const { app, state } = makeApp();
  const ok = await app.request("/pay", payInit("key-3", 10));
  assert.equal(ok.status, 201);
  const conflict = await app.request("/pay", payInit("key-3", 999));
  assert.equal(conflict.status, 422);
  assert.equal(conflict.headers.get("cache-control"), "no-store");
  assert.equal(state.calls, 1, "the second, mismatched request must not run");
});

test("a concurrent retry while the original is in flight returns 409", async () => {
  const { app, state } = makeApp();
  let release!: () => void;
  state.gate = new Promise<void>((r) => (release = r));

  const p1 = app.request("/pay", payInit("key-4"));
  // Give the first request time to reserve the key before the second arrives.
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await app.request("/pay", payInit("key-4"));
  assert.equal(r2.status, 409);
  assert.equal(r2.headers.get("cache-control"), "no-store");

  release();
  const r1 = await p1;
  assert.equal(r1.status, 201);
  assert.equal(state.calls, 1, "the in-flight conflict must not start a second handler run");
});

test("requireKey rejects applicable requests that omit the header", async () => {
  const { app, state } = makeApp({ requireKey: true });
  const res = await app.request("/pay", payInit(undefined));
  assert.equal(res.status, 400);
  assert.equal(state.calls, 0);
});

test("an empty or whitespace key is treated as missing", async () => {
  const { app, state } = makeApp({ requireKey: true });
  const res = await app.request("/pay", payInit("   "));
  assert.equal(res.status, 400);
  assert.equal(state.calls, 0);
});

test("keys with control characters are rejected with 400", async () => {
  const { app, state } = makeApp();
  const res = await app.request("/pay", payInit("bad\tkey"));
  assert.equal(res.status, 400);
  assert.equal(state.calls, 0);
});

test("keys longer than maxKeyLength are rejected with 400", async () => {
  const { app, state } = makeApp({ maxKeyLength: 8 });
  const res = await app.request("/pay", payInit("123456789"));
  assert.equal(res.status, 400);
  assert.equal(state.calls, 0);
});

test("server-error responses are not cached and can be retried", async () => {
  const { app, state } = makeApp();
  state.fail = true;
  const first = await app.request("/pay", payInit("key-5"));
  assert.equal(first.status, 500);
  // A retry must re-run the handler because the 5xx was not stored.
  const second = await app.request("/pay", payInit("key-5"));
  assert.equal(second.status, 500);
  assert.equal(second.headers.get("idempotency-replayed"), null);
  assert.equal(state.calls, 2);
});

test("responses larger than maxResponseBytes are not cached", async () => {
  const { app, state } = makeApp({ maxResponseBytes: 4 });
  const first = await app.request("/pay", payInit("key-6"));
  assert.equal(first.status, 201);
  const second = await app.request("/pay", payInit("key-6"));
  assert.equal(second.headers.get("idempotency-replayed"), null);
  assert.equal(state.calls, 2, "an oversized body must not be replayed");
});

// ---------- Custom store + options validation ----------

test("a custom IdempotencyStore is used for reserve/complete", async () => {
  const reserved: string[] = [];
  const completed: string[] = [];
  const inner = new MemoryIdempotencyStore();
  const store: IdempotencyStore = {
    reserve(key, record, ttlMs) {
      reserved.push(key);
      return inner.reserve(key, record, ttlMs);
    },
    complete(key, record, ttlMs) {
      completed.push(key);
      return inner.complete(key, record, ttlMs);
    },
    release(key) {
      return inner.release(key);
    },
  };
  const { app } = makeApp({ store });
  await app.request("/pay", payInit("custom-1"));
  assert.deepEqual(reserved, ["custom-1"]);
  assert.deepEqual(completed, ["custom-1"]);
});

test("a custom store may be async", async () => {
  const inner = new MemoryIdempotencyStore();
  const store: IdempotencyStore = {
    async reserve(key, record, ttlMs) {
      await Promise.resolve();
      return inner.reserve(key, record, ttlMs);
    },
    async complete(key, record, ttlMs) {
      await Promise.resolve();
      inner.complete(key, record, ttlMs);
    },
    async release(key) {
      await Promise.resolve();
      inner.release(key);
    },
  };
  const { app, state } = makeApp({ store });
  await app.request("/pay", payInit("async-1"));
  const replay = await app.request("/pay", payInit("async-1"));
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(state.calls, 1);
});

test("invalid option values throw at construction time", () => {
  assert.throws(() => idempotency({ ttlSeconds: 0 }), /ttlSeconds/);
  assert.throws(() => idempotency({ ttlSeconds: 1.5 }), /ttlSeconds/);
  assert.throws(() => idempotency({ maxKeyLength: 0 }), /maxKeyLength/);
  assert.throws(() => idempotency({ maxResponseBytes: -1 }), /maxResponseBytes/);
});

// ---------- MemoryIdempotencyStore unit behavior ----------

test("MemoryIdempotencyStore.reserve is atomic set-if-absent", () => {
  const store = new MemoryIdempotencyStore();
  const now = Date.now();
  const rec: IdempotencyRecord = {
    fingerprint: "fp",
    status: "in-flight",
    createdAt: now,
    expiresAt: now + 1000,
  };
  assert.equal(store.reserve("k", rec, 1000), null);
  const second = store.reserve("k", rec, 1000);
  assert.notEqual(second, null);
  assert.equal(second!.fingerprint, "fp");
  assert.equal(store.size(), 1);
});

test("MemoryIdempotencyStore treats expired records as missing", () => {
  const store = new MemoryIdempotencyStore();
  const past = Date.now() - 1000;
  store.complete(
    "k",
    { fingerprint: "fp", status: "completed", createdAt: past - 1000, expiresAt: past },
    1000
  );
  // The expired record is dropped on access, so the key can be reserved again.
  assert.equal(
    store.reserve(
      "k",
      {
        fingerprint: "fp2",
        status: "in-flight",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000,
      },
      1000
    ),
    null
  );
});

test("MemoryIdempotencyStore.release drops a reservation", () => {
  const store = new MemoryIdempotencyStore();
  const now = Date.now();
  store.reserve(
    "k",
    { fingerprint: "fp", status: "in-flight", createdAt: now, expiresAt: now + 1000 },
    1000
  );
  store.release("k");
  assert.equal(store.size(), 0);
  store.clear();
  assert.equal(store.size(), 0);
});

// ---------- Raw-body fingerprint (routes without a body schema) ----------

function makeRawApp(opts: IdempotencyOptions = {}) {
  const app = new App({ logger: false });
  const state = { calls: 0 };
  app.use(idempotency(opts));
  app.route({
    method: "POST",
    path: "/raw",
    operationId: "rawCharge",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: async (ctx: any) => {
      state.calls++;
      return new Response("charged " + (await ctx.request.text()));
    },
  } as any);
  const post = (key: string, body: string, contentType = "text/plain") =>
    app.request("/raw", {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": contentType, authorization: "Bearer u1" },
      body,
    });
  return { app, state, post };
}

test("[unhappy] a reused key with a different raw body is refused with 422 on a schema-less route", async () => {
  const { state, post } = makeRawApp();
  const first = await post("raw-1", "amount=10");
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "charged amount=10");
  const second = await post("raw-1", "amount=99999");
  assert.equal(second.status, 422);
  assert.equal(second.headers.get("idempotency-replayed"), null);
  assert.equal(state.calls, 1);
});

test("[unhappy] a reused key with the same bytes but a different content type is refused", async () => {
  const { post } = makeRawApp();
  assert.equal((await post("raw-ct", "a=1", "text/plain")).status, 200);
  assert.equal((await post("raw-ct", "a=1", "application/x-www-form-urlencoded")).status, 422);
});

test("an identical raw-body retry replays and the handler still reads the original body", async () => {
  const { state, post } = makeRawApp();
  const first = await post("raw-2", "amount=10");
  assert.equal(await first.text(), "charged amount=10");
  const retry = await post("raw-2", "amount=10");
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get("idempotency-replayed"), "true");
  assert.equal(await retry.text(), "charged amount=10");
  assert.equal(state.calls, 1);
});

test("[unhappy] a raw body over maxFingerprintBodyBytes is refused with 413, not fingerprinted blind", async () => {
  const { state, post } = makeRawApp({ maxFingerprintBodyBytes: 8 });
  const res = await post("raw-3", "0123456789");
  assert.equal(res.status, 413);
  assert.equal(state.calls, 0);
  assert.equal((await post("raw-4", "small")).status, 200);
});

test("maxFingerprintBodyBytes must be a positive integer", () => {
  assert.throws(() => idempotency({ maxFingerprintBodyBytes: 0 }), /maxFingerprintBodyBytes/);
});

// ---------- mTLS identity scoping ----------

test("[unhappy] mTLS callers without Authorization get separate namespaces for the same key", async () => {
  const app = new App({ logger: false });
  let calls = 0;
  app.use(
    clientCertAuth({
      resolve: (ctx) => {
        const svc = ctx.request.headers.get("x-test-peer");
        return svc
          ? { subjectDN: `CN=${svc}`, subjectAltNames: [`URI:spiffe://acme/${svc}`], verified: true }
          : undefined;
      },
    })
  );
  app.use(idempotency());
  app.route({
    method: "POST",
    path: "/transfer",
    operationId: "mtlsTransfer",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: { 200: { description: "ok", body: z.object({ owner: z.string() }) as any } },
    handler: async (ctx: any) => {
      calls++;
      return { status: 200 as const, body: { owner: ctx.state.clientCertificate.subjectDN } };
    },
  });
  const post = (svc: string) =>
    app.request("/transfer", {
      method: "POST",
      headers: { ...JSON_HEADERS, "idempotency-key": "shared", "x-test-peer": svc },
      body: JSON.stringify({ amount: 1 }),
    });
  assert.deepEqual(await (await post("svc-a")).json(), { owner: "CN=svc-a" });
  const b = await post("svc-b");
  assert.equal(b.headers.get("idempotency-replayed"), null);
  assert.deepEqual(await b.json(), { owner: "CN=svc-b" });
  // Same peer retrying still replays.
  const retry = await post("svc-a");
  assert.equal(retry.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(await retry.json(), { owner: "CN=svc-a" });
  assert.equal(calls, 2);
});

test("[unhappy] the raw-body fingerprint cap is lowered to the app bodyLimitBytes when reported", async () => {
  const { state, post } = makeRawApp();
  // Simulate App reporting bodyLimitBytes: 1 KiB to the hook (APP_BODY_LIMIT_HOOK).
  const limited = new App({ logger: false });
  const idem = idempotency();
  (idem as any)[Symbol.for("daloyjs.hooks.appBodyLimit")](1024);
  (idem as any)[Symbol.for("daloyjs.hooks.appBodyLimit")](10_000_000); // never raised
  (idem as any)[Symbol.for("daloyjs.hooks.appBodyLimit")](-1); // ignored
  limited.use(idem);
  let calls = 0;
  limited.route({
    method: "POST",
    path: "/raw",
    operationId: "rawLimited",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: async (ctx: any) => {
      calls++;
      return new Response("ok " + (await ctx.request.text()).length);
    },
  } as any);
  const send = (key: string, size: number) =>
    limited.request("/raw", {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": "text/plain", authorization: "Bearer u1" },
      body: "x".repeat(size),
    });
  assert.equal((await send("big", 900_000)).status, 413);
  assert.equal(calls, 0);
  assert.equal((await send("small", 1024)).status, 200);
  assert.equal(calls, 1);
  // Unrelated default instance keeps its 1 MiB cap.
  assert.equal((await post("default-cap", "x".repeat(900_000))).status, 200);
  assert.equal(state.calls, 1);
});

test("[unhappy] a raw body consumed by an earlier hook fails closed instead of fingerprinting as empty", async () => {
  const app = new App({ logger: false });
  let calls = 0;
  app.use({
    async beforeHandle(ctx) {
      await ctx.request.text();
    },
  });
  app.use(idempotency());
  app.route({
    method: "POST",
    path: "/raw",
    operationId: "rawConsumed",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: async () => {
      calls++;
      return new Response("ok");
    },
  } as any);
  const res = await app.request("/raw", {
    method: "POST",
    headers: { "idempotency-key": "consumed", "content-type": "text/plain", authorization: "Bearer u1" },
    body: "amount=10",
  });
  assert.equal(res.status, 500);
  assert.equal(calls, 0);
  // Happy path: without a key the same app passes through untouched.
  const noKey = await app.request("/raw", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "amount=10",
  });
  assert.equal(noKey.status, 200);
});

test("a bodiless keyed POST without Content-Length still fingerprints as empty (no false 500)", async () => {
  const app = new App({ logger: false });
  app.use(idempotency());
  let calls = 0;
  app.route({
    method: "POST",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    handler: () => ({ status: 200 as const, body: { n: ++calls } }),
  });
  const first = await app.request("/ping", { method: "POST", headers: { "idempotency-key": "k-bodiless-1" } });
  assert.equal(first.status, 200);
  const replay = await app.request("/ping", { method: "POST", headers: { "idempotency-key": "k-bodiless-1" } });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(calls, 1);
});

test("[unhappy] App wiring lowers the raw-body fingerprint cap to bodyLimitBytes end-to-end", async () => {
  const app = new App({ logger: false, bodyLimitBytes: 1024 });
  app.use(idempotency());
  let calls = 0;
  app.route({
    method: "POST",
    path: "/raw",
    operationId: "rawCap",
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    handler: () => ({ status: 200 as const, body: { n: ++calls } }),
  });
  const big = await app.request("/raw", {
    method: "POST",
    headers: { "idempotency-key": "k-cap-1", "content-type": "text/plain" },
    body: "x".repeat(4096),
  });
  assert.equal(big.status, 413);
  assert.equal(calls, 0);
  const small = await app.request("/raw", {
    method: "POST",
    headers: { "idempotency-key": "k-cap-2", "content-type": "text/plain" },
    body: "x".repeat(512),
  });
  assert.equal(small.status, 200);
});
