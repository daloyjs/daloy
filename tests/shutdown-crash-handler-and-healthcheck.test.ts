import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  _resetCrashHandlersForTests,
} from "../src/index.js";

// ---------- Wave 4: connection-draining shutdown ----------

test("fetch() returns 503 with Retry-After + Connection: close once draining", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  void app.shutdown(0);
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "5");
  assert.equal(res.headers.get("connection"), "close");
  assert.equal(res.headers.get("content-type"), "application/problem+json");
});

test("in-flight responses gain Connection: close when shutdown starts mid-request", async () => {
  const app = new App({ env: "development" });
  let release: (() => void) | undefined;
  const waiter = new Promise<void>((r) => {
    release = r;
  });
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await waiter;
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const pending = app.fetch(new Request("http://x/slow"));
  // Start shutdown while request is still in-flight.
  const shutdownPromise = app.shutdown(5000);
  release!();
  const res = await pending;
  await shutdownPromise;
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("connection"), "close");
});

test("app.close() is an alias for app.shutdown()", async () => {
  const app = new App({ env: "development" });
  await app.close(0);
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
});

test("idle-connection close hooks fire when shutdown begins", async () => {
  const app = new App({ env: "development" });
  let called = 0;
  app._registerIdleConnectionCloseHook(() => {
    called++;
  });
  await app.shutdown(0);
  assert.equal(called, 1);
});

test("failing idle-connection close hooks are logged but do not throw", async () => {
  const errs: unknown[] = [];
  const app = new App({
    env: "development",
    logger: {
      level: "trace",
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error(o: object) {
        errs.push(o);
      },
      fatal() {},
      child() {
        return this as never;
      },
    } as never,
  });
  app._registerIdleConnectionCloseHook(() => {
    throw new Error("boom");
  });
  await app.shutdown(0);
  assert.equal(errs.length, 1);
});

// ---------- Wave 4: crash handlers ----------

test("crashOnUnhandledRejection: false skips installation even in production", () => {
  _resetCrashHandlersForTests();
  const beforeListeners = process.listenerCount("unhandledRejection");
  new App({ env: "production", crashOnUnhandledRejection: false });
  assert.equal(process.listenerCount("unhandledRejection"), beforeListeners);
});

test("crashOnUnhandledRejection installs unhandledRejection + uncaughtException listeners exactly once per process in production", () => {
  _resetCrashHandlersForTests();
  const beforeRej = process.listenerCount("unhandledRejection");
  const beforeExc = process.listenerCount("uncaughtException");
  new App({ env: "production" });
  const afterRej = process.listenerCount("unhandledRejection");
  const afterExc = process.listenerCount("uncaughtException");
  assert.equal(afterRej, beforeRej + 1);
  assert.equal(afterExc, beforeExc + 1);
  // Second App in the same process is a no-op on the latch.
  new App({ env: "production" });
  assert.equal(process.listenerCount("unhandledRejection"), afterRej);
  assert.equal(process.listenerCount("uncaughtException"), afterExc);
  // Cleanup: remove the listeners we added so the test runner is not affected.
  const rejListeners = process.listeners("unhandledRejection");
  process.removeListener("unhandledRejection", rejListeners[rejListeners.length - 1]!);
  const excListeners = process.listeners("uncaughtException");
  process.removeListener("uncaughtException", excListeners[excListeners.length - 1]!);
  _resetCrashHandlersForTests();
});

test("crashOnUnhandledRejection does NOT install in non-production by default", () => {
  _resetCrashHandlersForTests();
  const before = process.listenerCount("unhandledRejection");
  new App({ env: "development" });
  assert.equal(process.listenerCount("unhandledRejection"), before);
});

test("secureDefaults: false skips crash-handler install in production", () => {
  _resetCrashHandlersForTests();
  const before = process.listenerCount("unhandledRejection");
  new App({ env: "production", secureDefaults: false, acknowledgeInsecureDefaults: true });
  assert.equal(process.listenerCount("unhandledRejection"), before);
});

test("crashOnUnhandledRejection: true installs even outside production", () => {
  _resetCrashHandlersForTests();
  const before = process.listenerCount("unhandledRejection");
  new App({ env: "development", crashOnUnhandledRejection: true });
  assert.equal(process.listenerCount("unhandledRejection"), before + 1);
  const rejListeners = process.listeners("unhandledRejection");
  process.removeListener("unhandledRejection", rejListeners[rejListeners.length - 1]!);
  const excListeners = process.listeners("uncaughtException");
  process.removeListener("uncaughtException", excListeners[excListeners.length - 1]!);
  _resetCrashHandlersForTests();
});

test("installed crash handlers log fatal + call process.exit(1) on unhandledRejection", () => {
  _resetCrashHandlersForTests();
  const fatals: object[] = [];
  let exitCode: number | undefined;
  const origExit = process.exit;
  (process as { exit: (c?: number) => never }).exit = ((c?: number) => {
    exitCode = c;
  }) as never;
  try {
    new App({
      env: "development",
      crashOnUnhandledRejection: true,
      logger: {
        level: "trace",
        trace() {},
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal(o: object) {
          fatals.push(o);
        },
        child() {
          return this as never;
        },
      } as never,
    });
    const rejListeners = process.listeners("unhandledRejection");
    const rejHandler = rejListeners[rejListeners.length - 1]! as (
      reason: unknown,
    ) => void;
    rejHandler(new Error("boom-rejection"));
    assert.equal(exitCode, 1);
    assert.equal(fatals.length, 1);

    const excListeners = process.listeners("uncaughtException");
    const excHandler = excListeners[excListeners.length - 1]! as (
      err: unknown,
    ) => void;
    exitCode = undefined;
    excHandler(new Error("boom-uncaught"));
    assert.equal(exitCode, 1);
    assert.equal(fatals.length, 2);

    process.removeListener("unhandledRejection", rejHandler);
    process.removeListener("uncaughtException", excHandler);
  } finally {
    (process as { exit: typeof origExit }).exit = origExit;
    _resetCrashHandlersForTests();
  }
});

test("crash handlers still exit when the logger throws", () => {
  _resetCrashHandlersForTests();
  let exitCode: number | undefined;
  const origExit = process.exit;
  (process as { exit: (c?: number) => never }).exit = ((c?: number) => {
    exitCode = c;
  }) as never;
  try {
    new App({
      env: "development",
      crashOnUnhandledRejection: true,
      logger: {
        level: "trace",
        trace() {},
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal() {
          throw new Error("logger exploded");
        },
        child() {
          return this as never;
        },
      } as never,
    });
    const rejListeners = process.listeners("unhandledRejection");
    const rejHandler = rejListeners[rejListeners.length - 1]! as (
      reason: unknown,
    ) => void;
    rejHandler(new Error("boom"));
    assert.equal(exitCode, 1);
    const excListeners = process.listeners("uncaughtException");
    const excHandler = excListeners[excListeners.length - 1]! as (
      err: unknown,
    ) => void;
    exitCode = undefined;
    excHandler(new Error("boom"));
    assert.equal(exitCode, 1);
    process.removeListener("unhandledRejection", rejHandler);
    process.removeListener("uncaughtException", excHandler);
  } finally {
    (process as { exit: typeof origExit }).exit = origExit;
    _resetCrashHandlersForTests();
  }
});

// ---------- Wave 4: health / readiness primitives ----------

test("app.healthcheck() registers GET /healthz returning 200 in development", async () => {
  const app = new App({ env: "development" });
  app.healthcheck();
  const res = await app.fetch(new Request("http://x/healthz"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, "ok");
});

test("app.readinesscheck() returns 200 when no pending plugins and not draining", async () => {
  const app = new App({ env: "development" });
  app.readinesscheck();
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, "ready");
});

test("app.readinesscheck() returns 503 while draining", async () => {
  const app = new App({ env: "development" });
  app.readinesscheck();
  void app.shutdown(0);
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 503);
});

test("app.readinesscheck() returns 503 while a plugin is still pending", async () => {
  const app = new App({ env: "development" });
  app.readinesscheck();
  let release: (() => void) | undefined;
  const waiter = new Promise<void>((r) => {
    release = r;
  });
  app.register(async () => {
    await waiter;
  });
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { status: string; "retry-after"?: string };
  assert.equal(body.status, "not-ready");
  assert.equal(res.headers.get("retry-after"), "5");
  release!();
  await app.ready();
});

test("app.readinesscheck() returns 200 after a pending plugin settles even before ready() is called", async () => {
  const app = new App({ env: "development" });
  app.readinesscheck();
  let release: (() => void) | undefined;
  const waiter = new Promise<void>((r) => {
    release = r;
  });
  app.register(async () => {
    await waiter;
  });
  release!();
  await new Promise((r) => setTimeout(r, 0));
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 200);
});

test("app.readinesscheck() returns 503 after an async plugin fails", async () => {
  const app = new App({ env: "development" });
  app.readinesscheck();
  app.register(async () => {
    throw new Error("plugin failed");
  });
  await assert.rejects(() => app.ready(), /plugin failed/);
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 503);
});

test("custom path is honoured", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ path: "/__alive" });
  const res = await app.fetch(new Request("http://x/__alive"));
  assert.equal(res.status, 200);
});

test("token-required probe rejects missing Authorization with 401", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ token: "supersecret" });
  const res = await app.fetch(new Request("http://x/healthz"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="health"');
});

test("token-required probe rejects wrong token with 403", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ token: "supersecret" });
  const res = await app.fetch(
    new Request("http://x/healthz", {
      headers: { authorization: "Bearer wrong" },
    }),
  );
  assert.equal(res.status, 403);
});

test("token-required probe accepts matching token", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ token: "supersecret" });
  const res = await app.fetch(
    new Request("http://x/healthz", {
      headers: { authorization: "Bearer supersecret" },
    }),
  );
  assert.equal(res.status, 200);
});

test("rate limit returns 429 after exceeding the per-IP cap", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ rateLimit: { limit: 2, windowMs: 60_000 } });
  const headers = { "x-real-ip": "10.0.0.1" };
  const a = await app.fetch(new Request("http://x/healthz", { headers }));
  const b = await app.fetch(new Request("http://x/healthz", { headers }));
  const c = await app.fetch(new Request("http://x/healthz", { headers }));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 429);
});

test("rate limit window resets after the configured time has passed", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ rateLimit: { limit: 1, windowMs: 1 } });
  const a = await app.fetch(new Request("http://x/healthz"));
  await new Promise((r) => setTimeout(r, 5));
  const b = await app.fetch(new Request("http://x/healthz"));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test("rateLimit: false disables the limiter entirely", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ rateLimit: false });
  for (let i = 0; i < 200; i++) {
    const res = await app.fetch(new Request("http://x/healthz"));
    assert.equal(res.status, 200);
  }
});

test("token-required probe rate-limits missing Authorization attempts", async () => {
  const app = new App({ env: "development" });
  app.healthcheck({ token: "supersecret", rateLimit: { limit: 1, windowMs: 60_000 } });
  const a = await app.fetch(new Request("http://x/healthz"));
  const b = await app.fetch(new Request("http://x/healthz"));
  assert.equal(a.status, 401);
  assert.equal(b.status, 429);
});

test("production without token refuses to register (unauthenticated probe)", () => {
  const app = new App({ env: "production", crashOnUnhandledRejection: false });
  assert.throws(
    () => app.healthcheck(),
    /healthcheck\(\) refused in production/,
  );
  assert.throws(
    () => app.readinesscheck(),
    /readinesscheck\(\) refused in production/,
  );
});

test("production with acknowledgeUnauthenticated: true allows registration", () => {
  const app = new App({ env: "production", crashOnUnhandledRejection: false });
  assert.doesNotThrow(() =>
    app.healthcheck({ acknowledgeUnauthenticated: true }),
  );
});

test("production with secureDefaults: false also allows unauthenticated registration", () => {
  const app = new App({
    env: "production",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
    crashOnUnhandledRejection: false,
  });
  assert.doesNotThrow(() => app.healthcheck());
  assert.doesNotThrow(() => app.readinesscheck());
});

test("production with a token registers without complaint", () => {
  const app = new App({ env: "production", crashOnUnhandledRejection: false });
  assert.doesNotThrow(() => app.healthcheck({ token: "x".repeat(32) }));
});
