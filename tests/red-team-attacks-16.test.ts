/**
 * Red-team round 16: guards that a configuration could satisfy without the
 * protection actually happening.
 *
 * 1. The shadow-auth / MCP / A2A / requireAuth guards checked that an auth hook
 *    was PRESENT in a route's chain, not that it RAN. `except()` (with a
 *    predicate or a path pattern) or a permissive `some()` branch kept a
 *    present hook from running, and the route served unauthenticated
 *    requests. Auth hooks now record that they ran and passed; a route that
 *    requires auth refuses (500 in production) when they did not.
 * 2. HS* JWT keys only had a length floor, so 32 zero bytes or "changeme"
 *    repeated passed. Production refuses guessable keys.
 * 3. `session()` accepted `httpOnly: false` and, in production,
 *    `secure: false`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  bearerAuth,
  createJwtSigner,
  createJwtVerifier,
  every,
  except,
  jwk,
  markAuthHook,
  session,
  some,
} from "../src/index.js";

const ok = { 200: { description: "ok" } } as const;
const auth = () => bearerAuth({ validate: (token) => token === "good" });

function capture() {
  const lines: Array<{ level: string; obj: Record<string, unknown> }> = [];
  const logger = {
    info: () => {},
    debug: () => {},
    warn: (obj: Record<string, unknown>) => lines.push({ level: "warn", obj }),
    error: (obj: Record<string, unknown>) => lines.push({ level: "error", obj }),
    child: () => logger,
  };
  return { logger: logger as never, lines };
}

function adminApp(hooks: unknown, opts: Record<string, unknown> = { env: "production", behindProxy: "none" }) {
  const { logger, lines } = capture();
  const app = new App({ logger, ...opts } as never);
  app.use(hooks as never);
  app.route({
    method: "GET",
    path: "/admin/report",
    auth: { scheme: "bearerAuth" },
    responses: ok,
    handler: () => ({ status: 200 as const, body: { secret: true } }),
  });
  return { app, lines };
}
const get = (app: App, path = "/admin/report", token?: string) =>
  app.fetch(new Request(`http://x${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

// ---------- 1. auth must actually run ----------

test("[auth-ran] except() with a predicate cannot open a route that declares auth", async () => {
  const { app, lines } = adminApp(except(() => true, auth()));
  assert.equal(app.assertSecureConfig().length, 0, "the presence check alone is satisfied");
  assert.equal((await get(app)).status, 500);
  assert.ok(lines.some((l) => l.level === "error" && l.obj.event === "auth.not_enforced"));
});

test("[auth-ran] except() with a path pattern cannot open a route that declares auth", async () => {
  const { app } = adminApp(except(["/admin/**"], auth()));
  assert.equal((await get(app)).status, 500);
});

test("[auth-ran] a permissive some() branch cannot stand in for auth", async () => {
  const { app } = adminApp(some(auth(), { beforeHandle: () => undefined }));
  assert.equal((await get(app)).status, 500, "no token: the permissive branch passed, auth did not");
  assert.equal((await get(app, "/admin/report", "good")).status, 200, "auth passed");
});

test("[auth-ran] working auth is unaffected: 200 with a token, its own 401 without", async () => {
  const { app } = adminApp(auth());
  assert.equal((await get(app, "/admin/report", "good")).status, 200);
  assert.equal((await get(app)).status, 401);
  const { app: wrapped } = adminApp(every(auth(), { beforeHandle: () => undefined }));
  assert.equal((await get(wrapped, "/admin/report", "good")).status, 200);
});

test("[auth-ran] a stored response cannot answer for a route whose auth did not run", async () => {
  const { logger } = capture();
  const app = new App({ logger, env: "production", behindProxy: "none" });
  app.use(except(() => true, auth()));
  app.route({
    method: "GET",
    path: "/admin/report",
    auth: { scheme: "bearerAuth" },
    acknowledgeNoResponseBodySchema: true,
    hooks: { beforeHandle: () => new Response("cached", { status: 200 }) },
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  } as never);
  assert.equal((await get(app)).status, 500);
});

test("[auth-ran] requireAuth and MCP routes are covered too", async () => {
  const { logger } = capture();
  const app = new App({ logger, env: "production", behindProxy: "none", requireAuth: true });
  app.use(except(["/open/**"], auth()));
  app.route({ method: "GET", path: "/open/data", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  assert.equal((await get(app, "/open/data")).status, 500);
});

test("[auth-ran] outside production it warns once per route and continues", async () => {
  const { app, lines } = adminApp(except(() => true, auth()), { env: "development" });
  assert.equal((await get(app)).status, 200);
  assert.equal((await get(app)).status, 200);
  assert.equal(lines.filter((l) => l.level === "warn" && l.obj.event === "auth.not_enforced").length, 1);
});

test("[auth-ran] secureDefaults: false turns the check off, like every other guard", async () => {
  const { app } = adminApp(except(() => true, auth()), {
    env: "production",
    behindProxy: "none",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  assert.equal((await get(app)).status, 200);
});

test("[auth-ran] a custom hook wrapped with markAuthHook() counts when it passes", async () => {
  const custom = markAuthHook({
    preBody: (ctx: { request: Request }) =>
      ctx.request.headers.get("x-key") === "k" ? undefined : new Response(null, { status: 401 }),
  } as never);
  const { app } = adminApp(custom);
  const res = await app.fetch(new Request("http://x/admin/report", { headers: { "x-key": "k" } }));
  assert.equal(res.status, 200);
  assert.equal((await get(app)).status, 401);
});

// ---------- 2. guessable HS* keys ----------

const enc = (s: string) => new TextEncoder().encode(s);
const weakKeys: Array<[string, Uint8Array]> = [
  ["zero bytes", new Uint8Array(32)],
  ["one repeated byte", new Uint8Array(48).fill(0x41)],
  ['"changeme" repeated', enc("changeme".repeat(4))],
  ["a short pattern repeated", enc("abc".repeat(11))],
  ["very low variety", enc("aabbaabbaabbaabbccddccddccddccdd")],
];

test("[hs-key] production refuses guessable HS* keys for signer and verifier", () => {
  for (const [label, key] of weakKeys) {
    assert.throws(
      () => createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 3600, env: "production" }),
      /weak_hs_secret/,
      `signer ${label}`,
    );
    assert.throws(
      () => createJwtVerifier({ algorithms: ["HS256"], key, env: "production", audience: "api" }),
      /weak_hs_secret/,
      `verifier ${label}`,
    );
  }
});

test("[hs-key] random keys pass in production and weak keys stay usable in development", () => {
  for (const key of [crypto.getRandomValues(new Uint8Array(32)), enc("correct-horse-battery-staple-2026")]) {
    createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 3600, env: "production" });
    createJwtVerifier({ algorithms: ["HS256"], key, env: "production", audience: "api" });
  }
  createJwtSigner({ alg: "HS256", key: new Uint8Array(32), maxLifetimeSeconds: 3600, env: "development" });
});

// ---------- 3. session cookie flags ----------

const SECRET = "unit-test-session-secret-0123456789"; // >= 32 chars

test("[session] httpOnly: false is refused in every environment", () => {
  assert.throws(
    () => session({ secret: SECRET, cookieName: "sid", cookieOptions: { httpOnly: false } }),
    /httpOnly: false/,
  );
});

test("[session] secure: false is refused in production, from NODE_ENV or the App env", () => {
  const insecure = () => session({ secret: SECRET, cookieName: "sid", cookieOptions: { secure: false } });
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(insecure, /secure: false in production/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  assert.throws(() => app.use(insecure()), /secure: false in production/);
});

test("[session] secure: false stays allowed in development or with allowInsecureCookie", () => {
  new App({ logger: false, env: "development" }).use(
    session({ secret: SECRET, cookieName: "sid", cookieOptions: { secure: false } }),
  );
  new App({ logger: false, env: "production", behindProxy: "none" }).use(
    session({ secret: SECRET, cookieName: "sid", cookieOptions: { secure: false }, allowInsecureCookie: true }),
  );
});

test("[combinators] every() keeps each bundle's production refusal", () => {
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  const combined = every(
    jwk({ jwks: { keys: [] }, algorithms: ["RS256"], audience: "api" }),
    session({ secret: SECRET, cookieName: "sid", cookieOptions: { secure: false } }),
  );
  assert.throws(() => app.use(combined), /secure: false in production/);
});
