/**
 * Red-team round 14: configuration gaps reported in review.
 *
 * 1. With no environment signal (edge runtimes have no NODE_ENV) the
 *    production refusals were skipped, most of them without a warning.
 *    Every would-be refusal is now logged once.
 * 2. Ordinary routes had no Host allowlist, so a DNS-rebinding page (whose
 *    Origin and Host are both the attacker's name) passed the cross-origin
 *    check. `allowedHosts` closes it; `serve()` defaults to loopback names and
 *    IP literals in development.
 * 3. Any route you did not mark stayed public. `requireAuth: true` refuses,
 *    at registration, a route with no auth hook unless it is `public: true`.
 * 4. The boot guards ran on the first request, so a serverless deploy
 *    answered 500 to live traffic. `assertSecureConfig()` runs them on demand
 *    and the adapters call it at startup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import {
  App,
  a2aRoutes,
  bearerAuth,
  createA2aHandler,
  createMcpHandler,
  mcpRoutes,
} from "../src/index.js";
import { runCli, type CliIO } from "../src/cli.js";
import { serve } from "../src/adapters/node.js";
import { toFetchHandler as toCloudflare } from "../src/adapters/cloudflare.js";
import { toFetchHandler as toVercel } from "../src/adapters/vercel.js";

const ok = { 200: { description: "ok" } } as const;
const auth = () => bearerAuth({ validate: (t) => t === "good" });

function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
}

function capture() {
  const warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const logger = {
    info: () => {},
    warn: (obj: Record<string, unknown>, msg: string) => warns.push({ obj, msg }),
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return { logger: logger as never, warns };
}

/** App with a shadow-auth route: declares auth, installs none. */
function shadowAuthApp(opts: Record<string, unknown>) {
  const app = new App({ ...opts } as never);
  app.route({
    method: "GET",
    path: "/admin",
    auth: { scheme: "bearerAuth" },
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  return app;
}

// ---------- 1. indeterminate environment ----------

test("[env] indeterminate environment logs each would-be refusal once", async () => {
  const { logger, warns } = capture();
  const app = withNodeEnv(undefined, () => shadowAuthApp({ logger }));
  await withNodeEnv(undefined, async () => {
    assert.equal((await app.fetch(new Request("http://x/admin"))).status, 200);
    assert.equal((await app.fetch(new Request("http://x/admin"))).status, 200);
  });
  const guard = warns.filter((w) => w.obj.event === "secure_defaults.env_indeterminate" && w.obj.guard);
  assert.equal(guard.length, 1);
  assert.equal(guard[0]!.obj.guard, "shadow-auth");
  assert.match(guard[0]!.msg, /not enforced/);
});

test("[env] explicit development stays quiet, production still refuses", async () => {
  const { logger, warns } = capture();
  const dev = shadowAuthApp({ logger, env: "development" });
  assert.equal((await dev.fetch(new Request("http://x/admin"))).status, 200);
  assert.equal(warns.filter((w) => w.obj.guard).length, 0);
  const prod = shadowAuthApp({ logger: false, env: "production", behindProxy: "none" });
  assert.equal((await prod.fetch(new Request("http://x/admin"))).status, 500);
});

// ---------- 2. allowedHosts ----------

function hostApp(allowedHosts?: readonly string[]) {
  const app = new App({ logger: false, ...(allowedHosts ? { allowedHosts } : {}) });
  app.route({
    method: "POST",
    path: "/reset",
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  return app;
}
const post = (app: App, host: string, origin = `http://${host}`) =>
  app.fetch(new Request(`http://${host}/reset`, { method: "POST", headers: { origin } }));

test("[hosts] DNS rebinding passes without an allowlist and is refused with one", async () => {
  assert.equal((await post(hostApp(), "evil.test:8080")).status, 200);
  assert.equal((await post(hostApp(["api.example.com"]), "evil.test:8080")).status, 400);
});

test("[hosts] exact and dotted entries, port and case ignored", async () => {
  const app = hostApp(["api.example.com", ".corp.test", "10.0.0.5"]);
  for (const host of ["api.example.com", "API.EXAMPLE.COM:8443", "corp.test", "a.b.corp.test", "10.0.0.5:3000"]) {
    assert.equal((await post(app, host)).status, 200, host);
  }
  for (const host of ["example.com", "evil-corp.test", "corp.test.evil", "10.0.0.6", "localhost"]) {
    assert.equal((await post(app, host)).status, 400, host);
  }
});

test("[hosts] alternating hosts never reuse another host's verdict", async () => {
  const app = hostApp(["api.example.com"]);
  const sequence = ["api.example.com", "evil.test", "evil.test", "api.example.com", "API.example.com", "evil.test:1"];
  const statuses: number[] = [];
  for (const host of sequence) statuses.push((await post(app, host)).status);
  assert.deepEqual(statuses, [200, 400, 400, 200, 200, 400]);
});

test("[hosts] malformed allowlists are refused at construction", () => {
  for (const bad of [[], ["*"], ["https://api.example.com"], ["api.example.com:443"], ["exa mple.com"], [42]]) {
    assert.throws(() => new App({ logger: false, allowedHosts: bad as never }), /allowedHosts/, JSON.stringify(bad));
  }
});

function rawRequest(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    let buf = "";
    s.setEncoding("latin1");
    s.on("data", (d) => (buf += d));
    s.on("end", () => resolve(Number(buf.slice(9, 12)) || 0));
    s.on("error", reject);
    s.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  });
}

async function servedStatuses(opts: Record<string, unknown>, hosts: string[]) {
  const app = new App({ logger: false, ...opts } as never);
  app.route({ method: "GET", path: "/", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  const handle = serve(app, { port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((r) => (handle.server.listening ? r() : handle.server.once("listening", () => r())));
  const port = (handle.server.address() as net.AddressInfo).port;
  try {
    const out: number[] = [];
    for (const host of hosts) out.push(await rawRequest(port, host));
    return out;
  } finally {
    await handle.close();
  }
}

test("[hosts] serve() in development accepts only loopback names and IP literals", async () => {
  assert.deepEqual(
    await servedStatuses({ env: "development" }, ["localhost:3000", "app.localhost", "127.0.0.1", "[::1]:3000", "evil.test"]),
    [200, 200, 200, 200, 400],
  );
});

test("[hosts] serve() outside development and explicit allowedHosts are not overridden", async () => {
  assert.deepEqual(await servedStatuses({ env: "test" }, ["evil.test"]), [200]);
  assert.deepEqual(
    await servedStatuses({ env: "development", allowedHosts: ["myapp.test"] }, ["myapp.test", "localhost"]),
    [200, 400],
  );
});

// ---------- 3. requireAuth ----------

test("[requireAuth] an unauthenticated route is refused at registration", () => {
  const app = new App({ logger: false, requireAuth: true });
  assert.throws(
    () => app.route({ method: "GET", path: "/orders", responses: ok, handler: () => ({ status: 200 as const, body: {} }) }),
    /requireAuth: true \}\) refused route GET \/orders/,
  );
});

test("[requireAuth] auth registered after the route does not count", () => {
  const app = new App({ logger: false, requireAuth: true });
  assert.throws(() =>
    app.route({ method: "GET", path: "/early", responses: ok, handler: () => ({ status: 200 as const, body: {} }) }),
  );
  app.use(auth());
  app.route({ method: "GET", path: "/late", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
});

test("[requireAuth] authenticated, public, and framework routes are accepted", async () => {
  const app = new App({ logger: false, requireAuth: true, env: "development", docs: true });
  app.route({
    method: "GET",
    path: "/status",
    public: true,
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  app.route({
    method: "GET",
    path: "/me",
    hooks: auth(),
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  app.healthcheck();
  app.readinesscheck();
  assert.equal((await app.fetch(new Request("http://x/status"))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/me"))).status, 401);
});

test("[requireAuth] MCP and A2A helper routes carry the right public flags", () => {
  const mcp = createMcpHandler({ serverInfo: { name: "m", version: "1.0.0" }, tools: [] });
  const guarded = new App({ logger: false, requireAuth: true });
  guarded.use(auth());
  for (const route of mcpRoutes("/mcp", mcp)) guarded.route(route);

  const open = new App({ logger: false, requireAuth: true });
  for (const route of mcpRoutes("/mcp", mcp, { public: true })) open.route(route);

  const mcpFlags = mcpRoutes("/x", mcp).map((r) => [r.method, r.public === true]);
  assert.deepEqual(Object.fromEntries(mcpFlags), { POST: false, GET: true, OPTIONS: true });

  const agent = createA2aHandler({
    card: {
      name: "a",
      description: "d",
      version: "1.0.0",
      url: "https://a.test/a2a",
      skills: [{ id: "s", name: "S", description: "d", tags: ["t"] }],
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
      securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    },
    onMessage: () => "hi",
  });
  const a2aFlags = a2aRoutes("/a2a", agent, { public: true }).map((r) => r.public === true);
  assert.ok(a2aFlags.every(Boolean));
  const guardedA2a = a2aRoutes("/a2a", agent, { hooks: auth() });
  assert.equal(guardedA2a.find((r) => r.method === "POST")!.public, undefined);
});

// ---------- 4. assertSecureConfig ----------

test("[assertSecureConfig] reports issues outside production and throws in production", () => {
  const dev = shadowAuthApp({ logger: false, env: "development" });
  const issues = dev.assertSecureConfig();
  assert.deepEqual(issues.map((i) => [i.code, i.route]), [["shadow-auth", "GET /admin"]]);
  assert.throws(() => dev.assertSecureConfig({ production: true }), /Insecure configuration refused \(1 issue\)/);
  assert.deepEqual(shadowAuthApp({ logger: false, env: "production", secureDefaults: false, acknowledgeInsecureDefaults: true }).assertSecureConfig(), []);
  const clean = new App({ logger: false, env: "production" });
  assert.deepEqual(clean.assertSecureConfig(), []);
});

test("[assertSecureConfig] adapters refuse a production misconfiguration at startup", () => {
  const prod = () => shadowAuthApp({ logger: false, env: "production", behindProxy: { hops: 1 } });
  assert.throws(() => serve(prod(), { port: 0 }), /shadow|auth requirement/);
  assert.throws(() => toCloudflare(prod()), /auth requirement/);
  assert.throws(() => toVercel(prod()), /auth requirement/);
  // A clean production app still starts.
  toCloudflare(new App({ logger: false, env: "production" }));
});

test("[doctor] boot-guard violations and a missing allowedHosts are reported", async () => {
  const app = shadowAuthApp({ logger: false, env: "production", behindProxy: { hops: 1 } });
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0-test",
  };
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 1);
  const codes = (JSON.parse(out.join("")) as { findings: Array<{ code: string }> }).findings.map((f) => f.code);
  assert.ok(codes.includes("bootGuard.shadow-auth"), codes.join(","));
  assert.ok(codes.includes("allowedHosts.unset"), codes.join(","));
});
