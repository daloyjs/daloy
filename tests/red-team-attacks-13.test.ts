/**
 * Red-team round 13: credential and echo hardening.
 *
 * 1. `bearerAuth()` / `jwk()` refuse a token containing whitespace or a comma.
 *    `Headers` comma-joins duplicate `Authorization` headers, so a loose
 *    `/^Bearer\s+(.+)$/` read `Bearer a, Bearer b` as the single token
 *    `"a, Bearer b"` and handed it to user `validate()` code. Every other
 *    token shape still passes through verbatim (no charset allowlist).
 * 2. `fileField()` validation messages no longer echo control, bidi or
 *    invisible characters from a client-supplied filename (log / UI spoofing).
 * 4. Proxy guidance. The unconfigured-proxy refusal used to suggest
 *    `trustProxy: true|false` or `secureDefaults: false`; on an edge platform
 *    (no TCP peer) every one of those collapses `rateLimit()` into one shared
 *    bucket. It now leads with `behindProxy: { hops: 1 }`, and production logs
 *    once when a guard falls back to the shared bucket.
 * 3. 5xx problem `detail` (the thrown error's message) is redacted unless the
 *    environment is positively development / test. An unset `NODE_ENV` used
 *    to count as development, so edge deploys and scaffolded apps with
 *    `production: process.env.NODE_ENV === "production"` sent exception
 *    messages (e.g. database errors) to clients.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, InternalError, bearerAuth, fileField, jwk, rateLimit } from "../src/index.js";
import { validate } from "../src/schema.js";

function bearerApp(seen: string[]) {
  const app = new App({ env: "development" });
  app.use(
    bearerAuth({
      validate: (token) => {
        seen.push(token);
        return token === "good-token";
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/me",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const req = (authorization: string) =>
  new Request("http://x/me", { headers: { authorization } });

test("[bearer] any token shape without separators passes through verbatim", async () => {
  const seen: string[] = [];
  const app = bearerApp(seen);
  assert.equal((await app.fetch(req("Bearer good-token"))).status, 200);
  assert.equal((await app.fetch(req("bearer good-token"))).status, 200);
  assert.equal((await app.fetch(req("Bearer  good-token "))).status, 200);
  // No charset allowlist: future vendor formats must keep working.
  for (const token of ["aZ09-._~+/abc==", "ghs_1_eyJ.eyJ.sig", 'q"uoted', "pad=ding=x", "k:v;w"]) {
    await app.fetch(req(`Bearer ${token}`));
    assert.equal(seen.at(-1), token);
  }
});

test("[bearer] comma-joined duplicates and embedded whitespace never reach validate()", async () => {
  const seen: string[] = [];
  const app = bearerApp(seen);
  for (const value of [
    "Bearer good-token, Bearer other",
    "Bearer good-token,other",
    "Bearer ,good-token",
    "Bearer good token",
    "Bearer good\ttoken",
    "Bearer ",
    "Basic Z29vZDp0b2tlbg==",
  ]) {
    assert.equal((await app.fetch(req(value))).status, 401, value);
  }
  assert.deepEqual(seen, []);
});

test("[jwk] comma-joined duplicate Authorization is a 401 before verification", async () => {
  const app = new App({ env: "development" });
  app.use(jwk({ jwks: { keys: [] }, algorithms: ["RS256"] }));
  app.route({
    method: "GET",
    path: "/me",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(req("Bearer a.b.c, Bearer d.e.f"));
  assert.equal(res.status, 401);
});

test("[fileField] filename echo strips control, bidi and invisible characters", async () => {
  const f = fileField({ filename: () => false });
  const name = "invoice‮fdp.exe​\u0000\n.pdf";
  const r = await validate(f, new File(["x"], name, { type: "application/pdf" }));
  const message = r.issues![0]!.message;
  assert.equal(message, 'File name "invoicefdp.exe.pdf" rejected by filename matcher');
});

test("[fileField] long filenames are truncated in the echo, ordinary names kept", async () => {
  const f = fileField({ filename: () => false });
  const long = await validate(f, new File(["x"], "a".repeat(500) + ".txt"));
  assert.match(long.issues![0]!.message, /^File name "a{128}\.\.\." rejected/);
  const plain = await validate(f, new File(["x"], "r\u00e9sum\u00e9 2026.pdf"));
  assert.equal(plain.issues![0]!.message, 'File name "r\u00e9sum\u00e9 2026.pdf" rejected by filename matcher');
});

const LEAK = 'relation "users" violates constraint (postgres://app:pw@db:5432/prod)';

async function detailFor(opts: Record<string, unknown>, nodeEnv: string | undefined) {
  const saved = process.env.NODE_ENV;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  try {
    const app = new App({ logger: false, ...opts } as never);
    app.route({
      method: "GET",
      path: "/boom",
      responses: { 200: { description: "ok" } },
      handler: () => {
        throw new Error(LEAK);
      },
    });
    const res = await app.fetch(new Request("http://x/boom"));
    assert.equal(res.status, 500);
    return ((await res.json()) as { detail?: string }).detail;
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
}

test("[5xx detail] redacted whenever the environment is not positively dev/test", async () => {
  for (const [opts, nodeEnv] of [
    [{}, undefined],
    [{}, ""],
    [{}, "staging"],
    [{}, "production"],
    [{ production: false }, undefined],
    [{ production: false }, "staging"],
    [{ production: true }, "development"],
    [{ env: "production" }, "development"],
  ] as const) {
    assert.equal(await detailFor(opts, nodeEnv), undefined, `${JSON.stringify(opts)} NODE_ENV=${nodeEnv}`);
  }
});

test("[5xx detail] shown on a positive development or test signal", async () => {
  for (const [opts, nodeEnv] of [
    [{}, "development"],
    [{}, "test"],
    [{ production: false }, "development"],
    [{ env: "development" }, undefined],
    [{ env: "test" }, "production"],
  ] as const) {
    assert.equal(await detailFor(opts, nodeEnv), LEAK, `${JSON.stringify(opts)} NODE_ENV=${nodeEnv}`);
  }
});

test("[5xx detail] HttpError.toResponse() without options fails closed too", async () => {
  const saved = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    const hidden = (await new InternalError(LEAK).toResponse().json()) as { detail?: string };
    assert.equal(hidden.detail, undefined);
    process.env.NODE_ENV = "development";
    const shown = (await new InternalError(LEAK).toResponse().json()) as { detail?: string };
    assert.equal(shown.detail, LEAK);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

test("[env] an unreadable NODE_ENV (Deno --allow-env) never crashes and fails closed", async () => {
  const realEnv = process.env;
  const throwing = new Proxy(realEnv, {
    get(target, key) {
      if (key === "NODE_ENV") throw new Error("NotCapable: Requires env access to \"NODE_ENV\"");
      return Reflect.get(target, key);
    },
  });
  Object.defineProperty(process, "env", { value: throwing, configurable: true, writable: true });
  try {
    const { readNodeEnv } = await import("../src/internal-env.js");
    assert.equal(readNodeEnv(), undefined);
    // `env` set: warnOnEnvMismatch reads NODE_ENV at construction.
    const dev = new App({ logger: false, env: "development" });
    dev.route({
      method: "GET",
      path: "/boom",
      responses: { 200: { description: "ok" } },
      handler: () => {
        throw new Error(LEAK);
      },
    });
    assert.equal(((await (await dev.fetch(new Request("http://x/boom"))).json()) as { detail?: string }).detail, LEAK);
    // No `env`: the unreadable value is treated as unset, so detail is redacted.
    const plain = new App({ logger: false });
    plain.route({
      method: "GET",
      path: "/boom",
      responses: { 200: { description: "ok" } },
      handler: () => {
        throw new Error(LEAK);
      },
    });
    assert.equal(((await (await plain.fetch(new Request("http://x/boom"))).json()) as { detail?: string }).detail, undefined);
  } finally {
    Object.defineProperty(process, "env", { value: realEnv, configurable: true, writable: true });
  }
});

function capturingApp(opts: Record<string, unknown>) {
  const warns: Array<{ obj: unknown; msg: string }> = [];
  const app: App = new App({
    ...opts,
    logger: {
      info: () => {},
      warn: (obj: unknown, msg: string) => warns.push({ obj, msg }),
      error: () => {},
      debug: () => {},
      child: () => app.log,
    } as never,
  } as never);
  app.use(rateLimit({ windowMs: 60_000, max: 100 }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  return { app, warns };
}

const xff = (ip: string) => new Request("http://x/", { headers: { "x-forwarded-for": ip } });

test("[proxy] refusal names behindProxy hops and never suggests disabling the guard", async () => {
  const { app, warns } = capturingApp({ env: "production" });
  assert.equal((await app.fetch(xff("1.1.1.1"))).status, 500);
  const msg = warns.map((w) => w.msg).join("\n");
  assert.match(msg, /behindProxy: \{ hops: 1 \}/);
  assert.match(msg, /Vercel, Cloudflare/);
  assert.doesNotMatch(msg, /secureDefaults: false/);
  assert.doesNotMatch(msg, /trustProxy: true/);
});

test("[proxy] production warns once when rateLimit falls back to one shared bucket", async () => {
  const { app, warns } = capturingApp({ env: "production", behindProxy: "none" });
  for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) await app.fetch(xff(ip));
  const shared = warns.filter((w) => (w.obj as { event?: string }).event === "rate-limit.shared-bucket");
  assert.equal(shared.length, 1);
  assert.match(shared[0]!.msg, /behindProxy: \{ hops: 1 \}/);
});

test("[proxy] no shared-bucket warning with hops configured or outside production", async () => {
  for (const opts of [
    { env: "production", behindProxy: { hops: 1 } },
    { env: "development", behindProxy: "none" },
  ]) {
    const { app, warns } = capturingApp(opts);
    for (const ip of ["1.1.1.1", "2.2.2.2"]) await app.fetch(xff(ip));
    const shared = warns.filter((w) => (w.obj as { event?: string }).event === "rate-limit.shared-bucket");
    assert.equal(shared.length, 0, JSON.stringify(opts));
  }
});
