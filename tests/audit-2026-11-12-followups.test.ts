/**
 * Follow-up regression tests for the 2026-11-12 audit pass: WebSocket
 * upgrades honour the spoofed-proxy-header refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { App } from "../src/index.js";
import { serve } from "../src/adapters/node.js";

async function upgradeStatus(
  options: Record<string, unknown>,
  extraHeaders: string,
): Promise<string> {
  const app = new App({ logger: false, env: "production", ...options } as never);
  app.ws("/ws", {
    public: true,
    acknowledgeUnauthenticated: true,
    allowedOrigins: "same-origin",
    message() {},
  } as never);
  const server = serve(app, { port: 0, hostname: "127.0.0.1", handleSignals: false } as never);
  if (!server.server.listening) {
    await new Promise<void>((resolve) => server.server.once("listening", () => resolve()));
  }
  try {
    return await new Promise<string>((resolve, reject) => {
      const socket = net.connect(server.port, "127.0.0.1", () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
            `Origin: http://127.0.0.1:${server.port}\r\nUser-Agent: audit\r\n${extraHeaders}\r\n`,
        );
      });
      socket.once("data", (chunk) => {
        socket.destroy();
        resolve(String(chunk).split("\r\n")[0] ?? "");
      });
      socket.once("error", reject);
    });
  } finally {
    await server.close();
  }
}

test("[unhappy] a WebSocket upgrade with a forwarded header is refused when no proxy posture is declared", async () => {
  for (const header of ["X-Forwarded-For: 6.6.6.6", "X-Real-IP: 6.6.6.6", "CF-Connecting-IP: 6.6.6.6"]) {
    const status = await upgradeStatus({ allowedHosts: ["127.0.0.1"] }, `${header}\r\n`);
    assert.match(status, /^HTTP\/1\.1 500/, header);
  }
});

test("[happy] the same upgrade succeeds without the header, or with a declared posture", async () => {
  assert.match(await upgradeStatus({ allowedHosts: ["127.0.0.1"] }, ""), /^HTTP\/1\.1 101/);
  assert.match(
    await upgradeStatus(
      { allowedHosts: ["127.0.0.1"], behindProxy: { hops: 1 } },
      "X-Forwarded-For: 203.0.113.5\r\n",
    ),
    /^HTTP\/1\.1 101/,
  );
});

// ---------------------------------------------------------------------------
// Boot guards judge the order hooks actually run in
// ---------------------------------------------------------------------------

import {
  bearerAuth,
  every,
  except,
  idempotency,
  ipRestriction,
  rateLimit,
  requireRoles,
  responseCache,
} from "../src/index.js";
import { compileCidrMatcher } from "../src/ip-match.js";
import { stripSource } from "../scripts/lib/strip-source.js";
import { findForbiddenWeakRandomCalls } from "../scripts/verify-no-weak-random.js";
import { findForbiddenBufferCalls } from "../scripts/verify-no-unsafe-buffer.js";
import { findForbiddenRemoteExecCalls } from "../scripts/verify-no-remote-exec.js";
import { findForbiddenRegistryExfilCalls } from "../scripts/verify-no-registry-exfiltration.js";
import { isLicenseAllowed } from "../scripts/verify-dep-licenses.js";
import { findForbiddenLifecycleScripts } from "../scripts/verify-no-lifecycle-scripts.js";
import { FORBIDDEN_CLASSES } from "../scripts/verify-no-invisible-unicode.js";

function replayApp(wrap: boolean): App {
  const app = new App({
    logger: false,
    env: "production",
    behindProxy: "none",
    allowedHosts: ["localhost"],
  } as never);
  const budget = every(rateLimit({ windowMs: 60_000, max: 2 }), responseCache());
  const auth = every(
    bearerAuth({ validate: (t: string) => (t === "ok" ? { sub: "u" } : false) }),
    idempotency(),
  );
  app.use(wrap ? except(["/health"], budget) : budget);
  app.use(wrap ? except(["/health"], auth) : auth);
  app.route({
    method: "POST",
    path: "/orders",
    auth: { scheme: "bearer" },
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  return app;
}

const order = (app: App) =>
  app.fetch(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: {
        authorization: "Bearer ok",
        "idempotency-key": "k1",
        "user-agent": "audit",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );

test("[unhappy] a replay bundle reordered ahead of the rate limit is refused at boot", async () => {
  const app = replayApp(true);
  assert.throws(() => app.assertSecureConfig(), /idempotency\(\) before rateLimit\(\)/);
  assert.equal((await order(app)).status, 500);
});

test("[happy] the same layers as plain every() bundles boot and enforce the limit", async () => {
  const app = replayApp(false);
  assert.doesNotThrow(() => app.assertSecureConfig());
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await order(app)).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
});

// ---------------------------------------------------------------------------
// IP rules written in IPv4-mapped form
// ---------------------------------------------------------------------------

function ipApp(options: Record<string, unknown>, ip: string): Promise<Response> {
  const app = new App({ logger: false, behindProxy: "none" } as never);
  app.use(ipRestriction({ ...options, resolveIp: () => ip } as never));
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  return app.fetch(new Request("http://localhost/", { headers: { "user-agent": "audit" } }));
}

test("[unhappy] a deny rule in IPv4-mapped form blocks the dotted client too", async () => {
  for (const rule of ["::ffff:1.2.3.4", "::ffff:1.2.3.0/120"]) {
    for (const client of ["1.2.3.4", "::ffff:1.2.3.4"]) {
      assert.equal((await ipApp({ deny: [rule] }, client)).status, 403, `${rule} vs ${client}`);
    }
  }
});

test("[happy] mapped allow rules admit both forms and nothing else", async () => {
  assert.equal((await ipApp({ allow: ["::ffff:1.2.3.4"] }, "1.2.3.4")).status, 200);
  assert.equal((await ipApp({ allow: ["::ffff:1.2.3.4"] }, "::ffff:1.2.3.4")).status, 200);
  assert.equal((await ipApp({ allow: ["::ffff:1.2.3.4"] }, "1.2.3.5")).status, 403);
  // A prefix shorter than /96 covers more than the mapped range: still IPv6.
  assert.equal(compileCidrMatcher("::ffff:0:0/64").family, 6);
  assert.equal(compileCidrMatcher("::ffff:1.2.3.0/120").family, 4);
});

// ---------------------------------------------------------------------------
// Claims are read from own properties only
// ---------------------------------------------------------------------------

async function rolesStatus(user: object): Promise<number> {
  const app = new App({ logger: false, behindProxy: "none" } as never);
  app.use({
    preBody(ctx: { state: Record<string, unknown> }) {
      ctx.state.user = user;
    },
  } as never);
  app.route({
    method: "GET",
    path: "/",
    public: true,
    hooks: requireRoles(["admin"]),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  const res = await app.fetch(new Request("http://localhost/", { headers: { "user-agent": "audit" } }));
  return res.status;
}

test("[unhappy] roles inherited through a prototype do not authorize", async () => {
  assert.equal(await rolesStatus(Object.create({ claims: { roles: ["admin"] } })), 403);
  assert.equal(await rolesStatus(Object.create({ roles: ["admin"] })), 403);
});

test("[happy] own roles and own claims still authorize", async () => {
  assert.equal(await rolesStatus({ roles: ["admin"] }), 200);
  assert.equal(await rolesStatus({ claims: { roles: ["admin"] } }), 200);
});

// ---------------------------------------------------------------------------
// WebSocket upgrade with duplicate Host; GET with a declared body
// ---------------------------------------------------------------------------

test("[unhappy] an upgrade carrying two Host headers is refused", async () => {
  const status = await upgradeStatus({ allowedHosts: ["127.0.0.1"] }, "Host: other.example\r\n");
  assert.match(status, /^HTTP\/1\.1 400/);
});

test("[unhappy] a GET that declares a body is answered and the connection closed", async () => {
  const app = new App({ logger: false, bodyLimitBytes: 1024 } as never);
  app.route({
    method: "GET",
    path: "/",
    public: true,
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  const server = serve(app, { port: 0, hostname: "127.0.0.1", handleSignals: false } as never);
  if (!server.server.listening) {
    await new Promise<void>((resolve) => server.server.once("listening", () => resolve()));
  }
  try {
    const result = await new Promise<{ head: string; closed: boolean }>((resolve, reject) => {
      let head = "";
      const socket = net.connect(server.port, "127.0.0.1", () => {
        socket.write(
          `GET / HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUser-Agent: audit\r\nTransfer-Encoding: chunked\r\n\r\n`,
        );
        socket.write("400\r\n" + "a".repeat(1024) + "\r\n");
      });
      socket.on("data", (chunk) => (head += String(chunk)));
      socket.on("close", () => resolve({ head, closed: true }));
      socket.on("error", reject);
      setTimeout(() => resolve({ head, closed: false }), 3000).unref();
    });
    assert.match(result.head, /^HTTP\/1\.1 200/);
    assert.match(result.head, /connection: close/i);
    assert.equal(result.closed, true, "the server must not keep draining the body");
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Source-scanning gates
// ---------------------------------------------------------------------------

test("[unhappy] a comment-like string no longer switches the gates off", () => {
  for (const opener of ['app.use("/*", mw);', 'if (p === "*/*") {}', "// matches /docs/*"]) {
    assert.equal(findForbiddenWeakRandomCalls("f.ts", `${opener}\nconst a = Math.random();`).length, 1, opener);
    assert.equal(findForbiddenBufferCalls("f.ts", `${opener}\nconst b = Buffer.allocUnsafe(8);`).length, 1, opener);
    assert.equal(findForbiddenRemoteExecCalls("f.ts", `${opener}\nconst c = [eval("1")];`).length, 1, opener);
    assert.equal(
      findForbiddenRegistryExfilCalls("f.ts", `${opener}\nconst d = { rejectUnauthorized: false };`).length,
      1,
      opener,
    );
  }
});

test("[unhappy] calls inside a template expression are scanned", () => {
  assert.equal(findForbiddenWeakRandomCalls("f.ts", "const id = `req-${Math.random()}`;").length, 1);
  assert.equal(findForbiddenBufferCalls("f.ts", "const s = `${Buffer.allocUnsafe(8)}`;").length, 1);
});

test("[unhappy] aliases, computed access and bare statements are caught", () => {
  for (const code of ["const rnd = Math.random;", "const { random } = Math;", 'Math["random"]();', "Math.random?.();"]) {
    assert.equal(findForbiddenWeakRandomCalls("f.ts", code).length, 1, code);
  }
  for (const code of ["const alloc = Buffer.allocUnsafe;", "const { allocUnsafe } = Buffer;", 'Buffer["allocUnsafe"](8);', "new SlowBuffer(8);"]) {
    assert.equal(findForbiddenBufferCalls("f.ts", code).length, 1, code);
  }
  for (const code of ["eval(payload);", "(0, eval)(x);", "globalThis.eval(x);", 'Function("return this")();', "Bun.spawn([cmd]);", 'new Deno.Command("sh");']) {
    assert.equal(findForbiddenRemoteExecCalls("f.ts", code).length, 1, code);
  }
});

test("[happy] documentation, strings and look-alike members are still ignored", () => {
  assert.equal(findForbiddenWeakRandomCalls("f.ts", '/* Math.random() */ const s = "Math.random()"; // Math.random()').length, 0);
  assert.equal(findForbiddenBufferCalls("f.ts", 'const s = "Buffer.allocUnsafe(8)";').length, 0);
  for (const code of ["client.eval(script);", "  eval(args) { return 1; }", "  eval(args): string;"]) {
    assert.equal(findForbiddenRemoteExecCalls("f.ts", code).length, 0, code);
  }
  const views = stripSource('const u = "https://x.test"; f(); // tail\nconst t = `a ${g()} b`;');
  assert.deepEqual([...views.code], ['const u = ""; f(); ', "const t = `${g()}`;"]);
});

test("[unhappy] a copyleft AND-expression with parenthesised sides is refused", () => {
  assert.equal(isLicenseAllowed("(MIT OR Apache-2.0) AND (GPL-3.0-only)"), false);
  assert.equal(isLicenseAllowed("(GPL-3.0-only) AND (MIT OR ISC)"), false);
  assert.equal(isLicenseAllowed("MIT AND GPL-3.0-only"), false);
});

test("[happy] permissive expressions still pass the license gate", () => {
  assert.equal(isLicenseAllowed("(MIT OR GPL-3.0-only)"), true);
  assert.equal(isLicenseAllowed("MIT AND (ISC OR GPL-3.0-only)"), true);
  assert.equal(isLicenseAllowed("(MIT AND ISC)"), true);
});

test("[unhappy] pnpm:devPreinstall counts as an install hook", () => {
  assert.deepEqual(findForbiddenLifecycleScripts({ scripts: { "pnpm:devPreinstall": "x" } }), ["pnpm:devPreinstall"]);
  assert.deepEqual(findForbiddenLifecycleScripts({ scripts: { build: "tsc" } }), []);
});

test("[unhappy] the invisible-character gate covers variation selectors and fillers", () => {
  const flagged = (cp: number) => FORBIDDEN_CLASSES.some((cls) => cls.test(cp));
  for (const cp of [0xe0100, 0xfe00, 0x3164, 0x115f, 0x200e, 0x200f, 0x061c, 0x2062]) {
    assert.equal(flagged(cp), true, cp.toString(16));
  }
  // Emoji presentation selector and ordinary characters stay allowed.
  for (const cp of [0xfe0f, 0x41, 0x1f600]) assert.equal(flagged(cp), false, cp.toString(16));
});

test("[unhappy] the standard .npmrc token line is detected, an env reference is not", async () => {
  const { scanFileContentForCredentials } = await import("../scripts/verify-no-leaked-credentials.js");
  // Built at runtime so this file never contains a token-shaped literal.
  const token = ["//registry.npmjs.org/:_authToken", "x".repeat(36)].join("=");
  assert.equal(scanFileContentForCredentials(token).length, 1);
  assert.equal(scanFileContentForCredentials("//registry.npmjs.org/:_authToken=${NPM_TOKEN}").length, 0);
});
