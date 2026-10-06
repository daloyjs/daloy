/**
 * `decorate()` ordering. Each route captures its scope's decorations when it
 * is registered, and a scope with no decorations captures nothing. So the
 * first `decorate()` on a scope after routes were registered on it could never
 * reach them: handlers read `undefined` with no error. That call now throws.
 * The classic way to hit it is decorating inside a Worker or Lambda wrapper on
 * every request.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/index.js";

const ok = { 200: { description: "ok" } } as const;

function readsState(app: App, key: string, path = "/x") {
  app.route({
    method: "GET",
    path,
    acknowledgeNoResponseBodySchema: true,
    responses: ok,
    handler: (ctx: { state: Record<string, unknown> }) => ({
      status: 200 as const,
      body: { value: ctx.state[key] ?? null },
    }),
  } as never);
}

const value = async (app: App, path = "/x") =>
  ((await (await app.fetch(new Request(`http://x${path}`))).json()) as { value: unknown }).value;

test("[decorate] a decoration made before the routes reaches them", async () => {
  const app = new App({ logger: false });
  app.decorate("db", "pg");
  readsState(app, "db");
  assert.equal(await value(app), "pg");
});

test("[decorate] the first decoration after a route was registered throws", () => {
  const app = new App({ logger: false });
  readsState(app, "db");
  assert.throws(() => app.decorate("db", "pg"), /first decoration on this app scope/);
});

test("[decorate] decorating inside a per-request wrapper fails loudly, not silently", async () => {
  const app = new App({ logger: false });
  readsState(app, "env");
  const worker = { fetch: (req: Request) => (app.decorate("env", { DB: 1 }), app.fetch(req)) };
  assert.throws(() => worker.fetch(new Request("http://x/x")), /before registering routes/);
});

test("[decorate] adding a key to a scope that already had one still reaches existing routes", async () => {
  const app = new App({ logger: false });
  app.decorate("a", 1);
  readsState(app, "b");
  app.decorate("b", 2);
  assert.equal(await value(app), 2);
});

test("[decorate] framework-owned routes do not trigger the refusal", async () => {
  const app = new App({ logger: false, docs: true });
  app.healthcheck();
  app.readinesscheck();
  app.decorate("db", "pg");
  readsState(app, "db");
  assert.equal(await value(app), "pg");
});

test("[decorate] the check is per scope: a plugin's own late decoration throws, the root's is fine", async () => {
  const app = new App({ logger: false });
  let late: unknown;
  app.register((child) => {
    readsState(child, "db", "/p");
    try {
      child.decorate("db", "pg");
    } catch (err) {
      late = err;
    }
  });
  assert.match(String(late), /first decoration on this app scope/);

  const root = new App({ logger: false });
  root.register((child) => readsState(child, "db", "/p"));
  root.decorate("db", "pg");
  readsState(root, "db");
  assert.equal(await value(root), "pg");
  assert.equal(await value(root, "/p"), null, "the plugin snapshotted the root bag before db existed");
});
