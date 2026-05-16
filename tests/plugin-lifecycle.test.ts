import { test } from "node:test";
import assert from "node:assert/strict";
import { App, type PluginInstalledEvent, type ShutdownEvent } from "../src/index.js";

test("onPluginInstalled fires for sync named plugins with prefix info", async () => {
  const app = new App({ logger: false });
  const events: PluginInstalledEvent[] = [];
  app.onPluginInstalled((info) => {
    events.push(info);
  });

  app.register(
    {
      name: "users",
      register(child) {
        child.route({
          method: "GET",
          path: "/me",
          operationId: "me",
          responses: { 200: { description: "ok" } },
          handler: async () => ({ status: 200 as const, body: { user: "alice" } }),
        });
      },
    },
    { prefix: "/users" }
  );

  await app.ready();
  assert.deepEqual(events, [{ name: "users", prefix: "/users" }]);
});

test("onPluginInstalled fires for anonymous plugins (name undefined) and uses default prefix", async () => {
  const app = new App({ logger: false });
  const events: PluginInstalledEvent[] = [];
  app.onPluginInstalled((info) => {
    events.push(info);
  });

  app.register((child) => {
    child.route({
      method: "GET",
      path: "/ping",
      operationId: "ping",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: { ok: true } }),
    });
  });

  await app.ready();
  assert.deepEqual(events, [{ name: undefined, prefix: "/" }]);
});

test("onPluginInstalled awaits async plugins and async listeners via app.ready()", async () => {
  const app = new App({ logger: false });
  const order: string[] = [];

  app.onPluginInstalled(async (info) => {
    await Promise.resolve();
    order.push(`listener:${info.name ?? "anon"}`);
  });

  app.register({
    name: "slow",
    async register(child) {
      await Promise.resolve();
      order.push("plugin:slow:registered");
      child.route({
        method: "GET",
        path: "/slow",
        operationId: "slow",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: {} }),
      });
    },
  });

  await app.ready();
  assert.deepEqual(order, ["plugin:slow:registered", "listener:slow"]);
});

test("onPluginInstalled observes nested plugin registrations with full prefix", async () => {
  const app = new App({ logger: false });
  const events: PluginInstalledEvent[] = [];
  app.onPluginInstalled((info) => {
    events.push(info);
  });

  app.register(
    {
      name: "outer",
      register(child) {
        child.register({
          name: "inner",
          register(grandchild) {
            grandchild.route({
              method: "GET",
              path: "/status",
              operationId: "nestedStatus",
              responses: { 200: { description: "ok" } },
              handler: async () => ({ status: 200 as const, body: { ok: true } }),
            });
          },
        }, { prefix: "/inner" });
      },
    },
    { prefix: "/outer" }
  );

  await app.ready();
  assert.deepEqual(events, [
    { name: "inner", prefix: "/outer/inner" },
    { name: "outer", prefix: "/outer" },
  ]);
  assert.ok(app.introspect().some((route) => route.path === "/outer/inner/status"));
});

test("async plugin routes are visible to introspection after ready", async () => {
  const app = new App({ logger: false });

  app.register({
    name: "async-routes",
    async register(child) {
      await Promise.resolve();
      child.route({
        method: "GET",
        path: "/later",
        operationId: "later",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: { ok: true } }),
      });
    },
  }, { prefix: "/plugin" });

  await app.ready();
  assert.ok(app.introspect().some((route) => route.path === "/plugin/later"));
});

test("onPluginInstalled listener errors are caught and logged but do not crash registration", async () => {
  const logs: Array<{ level: string; msg: string }> = [];
  const logger = {
    level: "error" as const,
    debug() {}, info() {}, warn() {}, fatal() {},
    error(obj: any, msg?: string) { logs.push({ level: "error", msg: msg ?? String(obj) }); },
    trace() {},
    child() { return logger; },
  };
  const app = new App({ logger: logger as any });

  app.onPluginInstalled(() => {
    throw new Error("sync boom");
  });
  app.onPluginInstalled(async () => {
    throw new Error("async boom");
  });

  app.register({ name: "p", register: () => {} });
  await app.ready();
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.msg === "onPluginInstalled listener failed"));
});

test("onShutdown listeners run before drain and onClose listeners run after", async () => {
  const app = new App({ logger: false });
  const order: string[] = [];

  let inflightAtShutdown = -1;
  app.onShutdown((event: ShutdownEvent) => {
    order.push(`shutdown:${event.reason ?? ""}:${event.timeoutMs}`);
    inflightAtShutdown = (app as any).inflight;
  });
  app.onClose(() => {
    order.push("close");
  });

  await app.shutdown(500, "SIGTERM");
  assert.deepEqual(order, ["shutdown:SIGTERM:500", "close"]);
  assert.equal(inflightAtShutdown, 0);
});

test("onShutdown listeners registered inside plugins run on root shutdown", async () => {
  const app = new App({ logger: false });
  const events: string[] = [];

  app.register({
    name: "observability",
    register(child) {
      child.onShutdown(({ reason }) => {
        events.push(`plugin:${reason ?? "unknown"}`);
      });
    },
  });

  await app.shutdown(50, "SIGTERM");
  assert.deepEqual(events, ["plugin:SIGTERM"]);
});

test("shutdown is idempotent: listeners and onClose hooks each run only once", async () => {
  const app = new App({ logger: false });
  let shutdownCount = 0;
  let closeCount = 0;
  app.onShutdown(() => {
    shutdownCount++;
  });
  app.onClose(() => {
    closeCount++;
  });

  await app.shutdown(50);
  await app.shutdown(50);
  assert.equal(shutdownCount, 1);
  assert.equal(closeCount, 1);
});

test("onShutdown listener errors are caught and logged", async () => {
  const logs: string[] = [];
  const logger = {
    level: "error" as const,
    debug() {}, info() {}, warn() {}, fatal() {}, trace() {},
    error(_: any, msg?: string) { logs.push(msg ?? ""); },
    child() { return logger; },
  };
  const app = new App({ logger: logger as any });

  app.onShutdown(() => {
    throw new Error("boom");
  });
  let closed = false;
  app.onClose(() => {
    closed = true;
  });

  await app.shutdown(50, "test");
  assert.ok(closed, "onClose should still run after a failing onShutdown listener");
  assert.ok(logs.includes("onShutdown listener failed"));
});

test("duplicate named plugins still fire onPluginInstalled exactly once before throwing", async () => {
  const app = new App({ logger: false });
  const events: PluginInstalledEvent[] = [];
  app.onPluginInstalled((info) => {
    events.push(info);
  });

  app.register({ name: "dup", register: () => {} });
  await app.ready();
  assert.equal(events.length, 1);

  assert.throws(() => app.register({ name: "dup", register: () => {} }), /already registered/);
  assert.equal(events.length, 1);
});
