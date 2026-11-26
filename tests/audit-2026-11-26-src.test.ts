/**
 * Audit 2026-11-26: three framework findings.
 *
 * 1. A guard that "rejects" with a value that is not a `Response`
 *    (`{ status: 401 }`, `false`) was refused with a 500 when registered
 *    directly, but still passed when it sat in `every()` behind a wrapper
 *    (`except()`, `some()`, `markAuthHook()`), or was the `preBody` of a
 *    two-phase `some()` branch.
 * 2. WebSocket `beforeUpgrade` accepted the upgrade for any decision that
 *    was not a `Response`, including `false` and `{ status: 401 }`.
 * 3. `fileField()` accepted a colon in a file name, so `D:evil.png` (a
 *    drive-relative path on Windows) and `a.php::$DATA` passed, as did
 *    device names spelled `CON .txt`, `CONIN$` or `COM0`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import net, { type AddressInfo } from "node:net";
import path from "node:path";

import {
  App,
  UnauthorizedError,
  every,
  except,
  fileField,
  markAuthHook,
  markWebSocketAuth,
  multipartObject,
  some,
  type Hooks,
} from "../src/index.ts";
import { serve } from "../src/adapters/node.ts";
import { isRefusedUpgradeDecision } from "../src/websocket.ts";

const MARKER = "HANDLER-REACHED";

/** A guard that signals rejection in the wrong shape unless `x-key: good` is sent. */
const wrongShapeGuard = (phase: "preBody" | "beforeHandle", value: unknown): Hooks =>
  ({
    [phase]: (ctx: { request: Request }) =>
      ctx.request.headers.get("x-key") === "good" ? undefined : value,
  }) as unknown as Hooks;

const noop: Hooks = { beforeHandle: () => undefined };
const thrower: Hooks = {
  beforeHandle: () => {
    throw new UnauthorizedError();
  },
};

/** Status and whether the handler ran, without and with the key. */
async function probe(
  hooks: Hooks,
  opts: { level?: "app" | "route"; auth?: boolean; production?: boolean } = {},
): Promise<{ noKey: number; noKeyReached: boolean; withKey: number }> {
  const app = new App({
    logger: false,
    ...(opts.production ? { production: true, behindProxy: "none" as const } : {}),
  });
  if (opts.level !== "route") app.use(hooks);
  app.route({
    method: "GET",
    path: "/secret",
    operationId: "secret",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: () => new Response(MARKER),
    ...(opts.level === "route" ? { hooks } : {}),
    ...(opts.auth ? { auth: { scheme: "bearer" } } : {}),
  } as never);
  const call = async (headers: Record<string, string>) => {
    const res = await app.fetch(
      new Request("http://localhost/secret", { headers: { "user-agent": "audit", ...headers } }),
    );
    return { status: res.status, body: await res.text() };
  };
  const a = await call({});
  const b = await call({ "x-key": "good" });
  return { noKey: a.status, noKeyReached: a.body.includes(MARKER), withKey: b.status };
}

const obj = { status: 401, body: { error: "no" } };

for (const [label, build] of [
  ["except(every(guard, noop))", () => except("/health", every(wrongShapeGuard("beforeHandle", obj), noop))],
  ["except(every(guard returning false, noop))", () => except("/health", every(wrongShapeGuard("beforeHandle", false), noop))],
  ["single-layer except(every(guard))", () => except("/health", every(wrongShapeGuard("beforeHandle", obj)))],
  ["some(every(guard, noop), thrower)", () => some(every(wrongShapeGuard("beforeHandle", obj), noop), thrower)],
  ["every(except(every(guard, noop)), noop)", () => every(except("/x", every(wrongShapeGuard("beforeHandle", obj), noop)), noop)],
  ["two-phase some({ preBody: guard, beforeHandle: pass })", () => some({ ...wrongShapeGuard("preBody", obj), beforeHandle: () => undefined })],
] as const) {
  test(`a rejection-shaped guard result never passes: ${label}`, async () => {
    const r = await probe(build());
    assert.equal(r.noKeyReached, false, "the handler must not run without the key");
    assert.notEqual(r.noKey, 200);
    assert.ok(r.noKey === 500 || r.noKey === 401, `refused, got ${r.noKey}`);
    assert.equal(r.withKey, 200, "a request the guard accepts still passes");
  });
}

test("a rejection-shaped guard in every() behind except() is refused as route-level hooks too", async () => {
  const r = await probe(except("/health", every(wrongShapeGuard("beforeHandle", obj), noop)), { level: "route" });
  assert.equal(r.noKeyReached, false);
  assert.equal(r.noKey, 500);
  assert.equal(r.withKey, 200);
});

for (const production of [false, true]) {
  test(`markAuthHook() over a swallowing bundle does not authenticate an auth: route (production=${production})`, async () => {
    const viaEvery = await probe(markAuthHook(every(wrongShapeGuard("beforeHandle", obj), noop)), { auth: true, production });
    assert.equal(viaEvery.noKeyReached, false);
    assert.notEqual(viaEvery.noKey, 200);
    assert.equal(viaEvery.withKey, 200, "a real pass still authenticates the route");

    const viaSome = await probe(
      markAuthHook(some({ ...wrongShapeGuard("preBody", obj), beforeHandle: () => undefined })),
      { auth: true, production },
    );
    assert.equal(viaSome.noKeyReached, false);
    assert.notEqual(viaSome.noKey, 200);
    assert.equal(viaSome.withKey, 200);
  });
}

test("correctly written guards behave as before inside the same compositions", async () => {
  const good: Hooks = {
    beforeHandle: (ctx) => {
      if (ctx.request.headers.get("x-key") !== "good") throw new UnauthorizedError();
      return undefined;
    },
  };
  const responder: Hooks = {
    beforeHandle: (ctx) =>
      ctx.request.headers.get("x-key") === "good" ? undefined : new Response(null, { status: 403 }),
  };
  const a = await probe(except("/health", every(good, noop)));
  assert.deepEqual([a.noKey, a.noKeyReached, a.withKey], [401, false, 200]);
  const b = await probe(except("/health", every(responder, noop)));
  assert.deepEqual([b.noKey, b.noKeyReached, b.withKey], [403, false, 200]);
  // A hook that returns null is "nothing", as on the direct path.
  const c = await probe(except("/health", every({ beforeHandle: () => null } as unknown as Hooks, noop)));
  assert.equal(c.noKey, 200);
});

// ---------- WebSocket beforeUpgrade ----------

/** Send a raw RFC 6455 handshake and return what the server wrote. */
function handshake(port: number, pathname: string, extra = ""): Promise<string> {
  // Built at run time: a literal sample key trips the secret scanner.
  const key = randomBytes(16).toString("base64");
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let out = "";
    socket.on("data", (d) => (out += d.toString("latin1")));
    socket.on("error", () => resolve(out));
    socket.on("close", () => resolve(out));
    socket.write(
      `GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nUser-Agent: audit\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`,
    );
    setTimeout(() => {
      socket.destroy();
      resolve(out);
    }, 400);
  });
}

test("beforeUpgrade: a decision that is not a Response, a string or nothing refuses the upgrade", async () => {
  const opened: string[] = [];
  const app = new App({ logger: false });
  const ok = (req: Request) => req.headers.get("x-key") === "good";
  const shapes: Record<string, (r: Request) => unknown> = {
    "/response": (r) => (ok(r) ? undefined : new Response(null, { status: 401 })),
    "/false": (r) => (ok(r) ? undefined : false),
    "/bool": (r) => ok(r),
    "/object": (r) => (ok(r) ? undefined : { status: 401 }),
    "/number": (r) => (ok(r) ? undefined : 401),
    "/null": () => null,
  };
  for (const [p, fn] of Object.entries(shapes)) {
    app.ws(p as `/${string}`, {
      allowedOrigins: "same-origin",
      beforeUpgrade: markWebSocketAuth(fn as never),
      open(conn: { send(data: string): void }) {
        opened.push(p);
        conn.send("MARKER");
      },
    } as never);
  }
  const handle = serve(app, { port: 0, hostname: "127.0.0.1" });
  const server = (handle as unknown as { server: net.Server }).server;
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const statusLine = (s: string) => s.split("\r\n")[0];
    // Unhappy paths: no credential, wrong-shaped rejection.
    for (const p of ["/false", "/bool", "/object", "/number"]) {
      const out = await handshake(port, p);
      assert.match(statusLine(out) ?? "", /^HTTP\/1\.1 500 /, `${p} must be refused`);
      assert.equal(opened.includes(p), false, `${p} must not open`);
    }
    // `true` for a valid caller is refused too, so the mistake shows on first use.
    assert.match(statusLine(await handshake(port, "/bool", "x-key: good\r\n")) ?? "", /^HTTP\/1\.1 500 /);
    // Controls: a Response still rejects with its own status.
    assert.match(statusLine(await handshake(port, "/response")) ?? "", /^HTTP\/1\.1 401 /);
    // Happy paths: undefined and null accept.
    assert.match(statusLine(await handshake(port, "/response", "x-key: good\r\n")) ?? "", /^HTTP\/1\.1 101 /);
    assert.match(statusLine(await handshake(port, "/false", "x-key: good\r\n")) ?? "", /^HTTP\/1\.1 101 /);
    assert.match(statusLine(await handshake(port, "/null")) ?? "", /^HTTP\/1\.1 101 /);
    assert.ok(opened.includes("/response") && opened.includes("/null"));
  } finally {
    await handle.close();
  }
});

test("isRefusedUpgradeDecision (shared by the Node and Bun adapters)", () => {
  for (const v of [undefined, null]) assert.equal(isRefusedUpgradeDecision(v), false);
  for (const v of [false, true, 0, 401, {}, { status: 401 }, []]) assert.equal(isRefusedUpgradeDecision(v), true);
});

// ---------- fileField() file names ----------

const validate = async (schema: ReturnType<typeof fileField>, name: string) => {
  const res = await schema["~standard"].validate(new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" }));
  return "issues" in res && res.issues ? "refused" : "accepted";
};

test("fileField() refuses a colon and every spelling of a Windows device name", async () => {
  for (const name of [
    "D:evil.png",
    "C:..",
    "shell.php::$DATA",
    "shell.php:.jpg",
    "CON:",
    "COM1:.png",
    "NUL:x.png",
    "CON .png",
    "aux  .jpg",
    "CONIN$",
    "conout$.png",
    "COM0",
    "LPT0.txt",
    "COM\u00b9.png",
    "LPT\u00b2",
    // Already refused before this change.
    "CON.txt",
    "a.php.",
    "../x.png",
  ]) {
    assert.equal(await validate(fileField(), name), "refused", JSON.stringify(name));
  }
});

test("fileField() still accepts ordinary names, and allowUnsafeFilenames still opts out", async () => {
  for (const name of [
    "photo.png",
    "Screenshot 2026-11-26 at 10.30.15.png",
    "report (final) v2.pdf",
    "console.log.txt",
    "con-artist.png",
    "common.png",
    "lpt.txt",
    "What is this?.png",
    "",
  ]) {
    assert.equal(await validate(fileField(), name), "accepted", JSON.stringify(name));
  }
  assert.equal(await validate(fileField({ allowUnsafeFilenames: true }), "D:evil.png"), "accepted");
});

test("a drive-relative upload name is answered with 422 and never reaches the handler", async () => {
  let seen: string | undefined;
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/up",
    operationId: "up",
    request: { body: multipartObject({ file: fileField({ accept: ["image/png"] }) }) },
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: (ctx: { body: { file: File } }) => {
      seen = ctx.body.file.name;
      return new Response("stored");
    },
  } as never);
  const upload = async (name: string) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], name, { type: "image/png" }));
    return app.fetch(new Request("http://localhost/up", { method: "POST", body: form, headers: { "user-agent": "audit" } }));
  };
  const bad = await upload("D:evil.png");
  assert.equal(bad.status, 422);
  assert.equal(seen, undefined);
  // Why it matters: on Windows this name resolves onto another drive.
  assert.equal(path.win32.resolve("C:\\app\\uploads", "D:evil.png").startsWith("C:\\app\\uploads"), false);

  const good = await upload("photo.png");
  assert.equal(good.status, 200);
  assert.equal(seen, "photo.png");
});
