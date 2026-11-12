/**
 * Regression tests for the 2026-11-12 audit pass: hook-composition bypasses,
 * runtime-adapter request-target and client-address gaps, the Node WebSocket
 * close path, the scriptable-image probe, and two CI gates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  App,
  bearerAuth,
  clientCertAuth,
  every,
  fileField,
  httpSignatureAuth,
  markAuthHook,
  requireRoles,
  responseCache,
  some,
  UnauthorizedError,
} from "../src/index.js";
import { serve } from "../src/adapters/node.js";
import { toLambdaHandler } from "../src/adapters/lambda.js";
import { toAzureHandler } from "../src/adapters/azure.js";
import { toFastlyHandler } from "../src/adapters/fastly.js";
import { pickForwardedForByHops, resolveClientIp } from "../src/conn-info.js";
import {
  badRequestTargetResponse,
  canonicalWebRequest,
} from "../src/internal-request-target.js";
import { decodeClosePayload, WebSocketProtocolError } from "../src/websocket.js";
import { findUnpinnedActions } from "../scripts/verify-actions-pinned.js";
import { findForbiddenRuntimeDependencies } from "../scripts/verify-no-runtime-deps.js";

const ok = { 200: { description: "OK" } };
const get = (app: App, path: string, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request(`http://localhost${path}`, { headers: { "user-agent": "audit", ...headers } }),
  );

// ---------------------------------------------------------------------------
// Header-mode clientCertAuth registered inside a group or plugin
// ---------------------------------------------------------------------------

const structuredAuth = () =>
  clientCertAuth({
    header: { format: "structured", subjectDN: "x-ssl-client-s-dn", verify: "x-ssl-client-verify" },
    allowSubjectCNs: ["svc-a"],
  } as never);
const forgedCert = { "x-ssl-client-s-dn": "CN=svc-a", "x-ssl-client-verify": "SUCCESS" };

function certRoute(app: App, path = "/"): void {
  app.route({
    method: "GET",
    path,
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
}

const childMounts: Array<[string, (app: App) => void, string]> = [
  [
    "group callback use()",
    (app) =>
      app.group("/svc", {}, (g) => {
        g.use(structuredAuth());
        certRoute(g);
      }),
    "/svc",
  ],
  [
    "plugin use()",
    (app) => {
      void app.register((p: App) => {
        p.use(structuredAuth());
        certRoute(p, "/plug");
      });
    },
    "/plug",
  ],
  [
    "every() inside a group",
    (app) =>
      app.group("/e", {}, (g) => {
        g.use(every(structuredAuth()));
        certRoute(g);
      }),
    "/e",
  ],
];

for (const [name, mount, path] of childMounts) {
  test(`[unhappy] header-mode mTLS in a ${name} is refused without a proxy posture`, async () => {
    const app = new App({ env: "production", logger: false } as never);
    mount(app);
    assert.throws(() => app.assertSecureConfig(), /clientCertAuth\(\{ header/);
    const res = await get(app, path, forgedCert);
    assert.equal(res.status, 500);
  });

  test(`[unhappy] header-mode mTLS in a ${name} is refused under behindProxy: "none"`, async () => {
    const app = new App({ env: "production", logger: false, behindProxy: "none" } as never);
    mount(app);
    assert.throws(() => app.assertSecureConfig(), /clientCertAuth\(\{ header/);
  });

  test(`[happy] header-mode mTLS in a ${name} boots behind a declared proxy`, async () => {
    const app = new App({
      env: "production",
      logger: false,
      behindProxy: { hops: 1 },
    } as never);
    mount(app);
    assert.doesNotThrow(() => app.assertSecureConfig());
    const res = await get(app, path, { ...forgedCert, "x-forwarded-for": "203.0.113.5" });
    assert.equal(res.status, 200);
  });
}

// ---------------------------------------------------------------------------
// some(): optional branch behind an earlier auth hook
// ---------------------------------------------------------------------------

function someBehindOuterAuth(): App {
  const app = new App({ logger: false, env: "production", behindProxy: "none" } as never);
  app.use(
    markAuthHook({
      preBody(ctx: { request: Request }) {
        if (ctx.request.headers.get("x-api-key") !== "tenant-key") throw new UnauthorizedError();
      },
    } as never),
  );
  app.route({
    method: "GET",
    path: "/admin",
    auth: { scheme: "bearer" },
    hooks: some(
      httpSignatureAuth({
        optional: true,
        algorithms: ["hmac-sha256"],
        resolveKey: () => undefined,
      } as never),
      bearerAuth({ validate: (t: string) => (t === "admin-token" ? { sub: "admin" } : false) }),
    ),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: { state: { user?: unknown } }) => ({
      status: 200 as const,
      body: { user: ctx.state.user ?? null },
    }),
  } as never);
  return app;
}

test("[unhappy] some(optional, strict) still requires the strict branch behind an outer auth hook", async () => {
  const app = someBehindOuterAuth();
  const none = await get(app, "/admin", { "x-api-key": "tenant-key" });
  assert.equal(none.status, 401);
  const wrong = await get(app, "/admin", {
    "x-api-key": "tenant-key",
    authorization: "Bearer wrong",
  });
  assert.notEqual(wrong.status, 200);
});

test("[happy] some(optional, strict) admits a valid strict credential behind an outer auth hook", async () => {
  const res = await get(someBehindOuterAuth(), "/admin", {
    "x-api-key": "tenant-key",
    authorization: "Bearer admin-token",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: { sub: "admin" } });
});

// ---------------------------------------------------------------------------
// some(requireRoles, beforeHandle gate) behind a stored-response replay
// ---------------------------------------------------------------------------

function rolesBehindCache(): { app: App; setRoles: (r: string[]) => void; calls: () => number } {
  const app = new App({ logger: false, behindProxy: "none" } as never);
  let roles: string[] = ["admin"];
  let calls = 0;
  app.use({
    preBody(ctx: { state: Record<string, unknown> }) {
      ctx.state.user = { sub: "same-user", roles };
    },
  } as never);
  app.use(responseCache({ principal: () => "same-user" } as never));
  app.route({
    method: "GET",
    path: "/protected",
    public: true,
    hooks: some(requireRoles(["admin"]), {
      beforeHandle(ctx: { request: Request }) {
        if (ctx.request.headers.get("x-break-glass") !== "yes") throw new UnauthorizedError();
      },
    } as never),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => {
      calls++;
      return { status: 200 as const, body: { secret: "role-gated" } };
    },
  } as never);
  return { app, setRoles: (r) => (roles = r), calls: () => calls };
}

test("[unhappy] a revoked role is not served the cached response through a demoted some()", async () => {
  const { app, setRoles } = rolesBehindCache();
  assert.equal((await get(app, "/protected")).status, 200);
  setRoles([]);
  const after = await get(app, "/protected");
  assert.notEqual(after.status, 200);
  assert.ok(!(await after.text()).includes("role-gated"));
});

test("[happy] an authorized retry still replays from the cache", async () => {
  const { app, calls } = rolesBehindCache();
  assert.equal((await get(app, "/protected")).status, 200);
  assert.equal((await get(app, "/protected")).status, 200);
  assert.equal(calls(), 1);
});

// ---------------------------------------------------------------------------
// Request-target canonicalization for web-standard adapters (Deno)
// ---------------------------------------------------------------------------

/** A Request-like whose `url` is the raw, unparsed string a runtime may hand over. */
function rawRequest(url: string): Request {
  const req = new Request("http://placeholder/");
  Object.defineProperty(req, "url", { value: url });
  return req;
}

test("[unhappy] an authority with userinfo, a backslash or an escape is refused", () => {
  for (const url of [
    "http://good.example:80@evil.example/who",
    "http://good.example@evil.example/",
    "http://h\\x/path",
    "http://h%2fx/path",
    "/relative-only",
  ]) {
    assert.equal(canonicalWebRequest(rawRequest(url)), undefined, url);
  }
  assert.equal(badRequestTargetResponse().status, 400);
});

test("[unhappy] a path WHATWG parsing would rewrite is canonicalized before dispatch", () => {
  const cases: Array<[string, string]> = [
    ["http://h/api/users/..\\health", "/api/health"],
    ["http://h/api/users/%2e%2e/health", "/api/health"],
    ["http://h/api/./users/1", "/api/users/1"],
  ];
  for (const [raw, pathname] of cases) {
    const out = canonicalWebRequest(rawRequest(raw));
    assert.ok(out, raw);
    assert.equal(new URL(out.url).pathname, pathname);
    assert.equal(out.url, new URL(out.url).href);
  }
});

test("[happy] an ordinary request is passed through untouched", () => {
  const req = rawRequest("https://api.example:8443/v1/items?q=a.b");
  assert.equal(canonicalWebRequest(req), req);
  const v6 = rawRequest("http://[::1]:3000/x");
  assert.equal(canonicalWebRequest(v6), v6);
});

test("[unhappy] allowedHosts fails closed on an authority carrying userinfo", async () => {
  const app = new App({ logger: false, allowedHosts: ["good.example"] } as never);
  certRoute(app, "/who");
  const res = await app.fetch(rawRequest("http://good.example:80@evil.example/who"));
  assert.equal(res.status, 400);
  const fine = await app.fetch(new Request("http://good.example/who"));
  assert.equal(fine.status, 200);
});

// ---------------------------------------------------------------------------
// Lambda event paths, forwarded `ip:port`, Fastly client address
// ---------------------------------------------------------------------------

function ipApp(behindProxy: unknown): App {
  const app = new App({ env: "production", behindProxy, logger: false } as never);
  for (const path of ["/admin", "/files/:name"]) {
    app.route({
      method: "GET",
      path,
      public: true,
      responses: ok,
      acknowledgeNoResponseBodySchema: true,
      handler: () => ({ status: 200 as const, body: { route: path } }),
    } as never);
  }
  app.route({
    method: "GET",
    path: "/ip",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: { request: Request }) => ({
      status: 200 as const,
      body: { ip: resolveClientIp(ctx.request, behindProxy as never) ?? null },
    }),
  } as never);
  return app;
}

const lambdaEvent = (rawPath: string) => ({
  version: "2.0",
  rawPath,
  rawQueryString: "",
  headers: { host: "api.example" },
  requestContext: { http: { method: "GET", path: rawPath, sourceIp: "203.0.113.9" } },
});

test("[unhappy] Lambda refuses event paths the URL parser would silently rewrite", async () => {
  const handler = toLambdaHandler(ipApp("none"));
  for (const path of ["/public/.\t./admin", "/ad\tmin", "/ad\nmin", "/ad\rmin", "/admin ", "/admin\u007f"]) {
    const res = (await handler(lambdaEvent(path) as never)) as { statusCode: number };
    assert.equal(res.statusCode, 400, JSON.stringify(path));
  }
});

test("[happy] Lambda still routes ordinary and percent-encoded paths", async () => {
  const handler = toLambdaHandler(ipApp("none"));
  for (const path of ["/admin", "/files/a%20b"]) {
    const res = (await handler(lambdaEvent(path) as never)) as { statusCode: number };
    assert.equal(res.statusCode, 200, path);
  }
});

test("[happy] a trusted forwarded slot may carry a port", () => {
  assert.equal(pickForwardedForByHops("1.1.1.1, 203.0.113.7:51234", 1), "203.0.113.7");
  assert.equal(pickForwardedForByHops("[2001:db8::1]:51234", 1), "2001:db8::1");
  assert.equal(pickForwardedForByHops("[2001:db8::1]", 1), "2001:db8::1");
  assert.equal(pickForwardedForByHops("2001:db8::1", 1), "2001:db8::1");
  assert.equal(pickForwardedForByHops("203.0.113.7", 1), "203.0.113.7");
});

test("[unhappy] a malformed forwarded slot still yields no client address", () => {
  for (const value of ["evil:1:2", "203.0.113.7:abc", "203.0.113.7:", "[2001:db8::1]x", "[oops", "host:80"]) {
    assert.equal(pickForwardedForByHops(value, 1), undefined, value);
  }
});

test("[happy] Azure resolves the client from an ip:port forwarded entry", async () => {
  const handler = toAzureHandler(ipApp({ hops: 1 }));
  const res = (await handler({
    method: "GET",
    url: "https://fn.example/ip",
    headers: new Headers({ "x-forwarded-for": "203.0.113.7:51234" }),
    body: null,
  } as never)) as unknown as { body: ArrayBuffer };
  assert.match(new TextDecoder().decode(res.body), /203\.0\.113\.7"/);
});

test("[happy] Fastly attaches the platform client address as the trusted peer", async () => {
  const handler = toFastlyHandler(ipApp("none"));
  const res = await handler(
    new Request("https://svc.example/ip", { headers: { "x-forwarded-for": "6.6.6.6" } }),
    undefined,
    "198.51.100.7",
  );
  assert.deepEqual(await res.json(), { ip: "198.51.100.7" });
});

test("[unhappy] Fastly ignores a client address that is not an IP literal", async () => {
  const handler = toFastlyHandler(ipApp("none"));
  const res = await handler(new Request("https://svc.example/ip"), undefined, "not-an-ip");
  assert.deepEqual(await res.json(), { ip: null });
});

// ---------------------------------------------------------------------------
// WebSocket close handling (Node adapter)
// ---------------------------------------------------------------------------

test("[unhappy] a close reason that is not UTF-8 is a protocol error, not a TypeError", () => {
  assert.throws(
    () => decodeClosePayload(Uint8Array.of(0x03, 0xe8, 0xff, 0xfe)),
    WebSocketProtocolError,
  );
});

test("[happy] a valid multi-byte close reason still decodes", () => {
  const reason = new TextEncoder().encode("adiós");
  const payload = new Uint8Array(2 + reason.length);
  payload.set([0x03, 0xe8]);
  payload.set(reason, 2);
  assert.deepEqual(decodeClosePayload(payload), { code: 1000, reason: "adiós" });
});

/** Build one masked client frame. */
function clientFrame(opcode: number, payload: Uint8Array): Buffer {
  const mask = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] = body[i]! ^ mask[i % 4]!;
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, body]);
}

async function wsServer(onMessage: (ws: { close: (code: number) => void }, data: unknown) => void) {
  const app = new App({ logger: false } as never);
  const seen: string[] = [];
  app.ws("/ws", {
    public: true,
    acknowledgeUnauthenticated: true,
    message(ws: { close: (code: number) => void }, data: unknown) {
      seen.push(String(data));
      onMessage(ws, data);
    },
  } as never);
  certRoute(app, "/health");
  const server = serve(app, { port: 0, hostname: "127.0.0.1", handleSignals: false } as never);
  if (!server.server.listening) {
    await new Promise<void>((resolve) => server.server.once("listening", () => resolve()));
  }
  return { server, port: server.port, seen };
}

function upgrade(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
          `Origin: http://127.0.0.1:${port}\r\nUser-Agent: audit\r\n\r\n`,
      );
    });
    socket.once("data", (chunk) => {
      if (String(chunk).startsWith("HTTP/1.1 101")) resolve(socket);
      else reject(new Error(`upgrade refused: ${String(chunk).slice(0, 60)}`));
    });
    socket.once("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("[unhappy] a CLOSE frame with an invalid UTF-8 reason does not crash the server", async () => {
  const { server, port } = await wsServer(() => {});
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);
  process.on("uncaughtException", onUncaught);
  try {
    const socket = await upgrade(port);
    socket.write(clientFrame(0x8, Uint8Array.of(0x03, 0xe8, 0xff, 0xfe)));
    await sleep(150);
    socket.destroy();
    assert.deepEqual(uncaught, []);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
  } finally {
    process.off("uncaughtException", onUncaught);
    await server.close();
  }
});

test("[unhappy] messages sent after the server closed never reach the handler", async () => {
  const { server, port, seen } = await wsServer((ws, data) => {
    if (data === "bad") ws.close(1008);
  });
  try {
    const socket = await upgrade(port);
    socket.write(clientFrame(0x1, new TextEncoder().encode("bad")));
    await sleep(100);
    socket.write(clientFrame(0x1, new TextEncoder().encode("late-1")));
    socket.write(clientFrame(0x1, new TextEncoder().encode("late-2")));
    await sleep(150);
    socket.destroy();
    assert.deepEqual(seen, ["bad"]);
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Scriptable-image probe
// ---------------------------------------------------------------------------

const WINDOW = 64 * 1024;
const svgRoot = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const imageField = fileField({ rejectScriptableImages: true, accept: ["image/*"] } as never);

async function probe(bytes: Uint8Array | string): Promise<boolean> {
  const file = new File([bytes as BlobPart], "x.png", { type: "image/png" });
  const result = await (
    imageField as unknown as {
      "~standard": { validate: (v: unknown) => Promise<{ issues?: unknown[] }> };
    }
  )["~standard"].validate(file);
  return result.issues === undefined;
}

test("[unhappy] a root element split across the probe window is refused", async () => {
  const pad = `<!--${"a".repeat(WINDOW - 4 - 3 - 3)}-->`;
  const body = `${pad}${svgRoot}`;
  assert.equal(body.indexOf("<svg"), WINDOW - 3);
  assert.equal(await probe(body), false);
});

test("[unhappy] a quoted ]> in a DOCTYPE subset cannot hide the padding behind it", async () => {
  for (const quote of ['"', "'"]) {
    const doctype = `<!DOCTYPE x [<!ENTITY a ${quote}]>${quote}>]>`;
    const body = `${doctype}<!--${"a".repeat(WINDOW)}-->${svgRoot}`;
    assert.equal(await probe(body), false, quote);
  }
});

test("[unhappy] an SVG root with a non-ASCII namespace prefix is refused", async () => {
  assert.equal(
    await probe('<é:svg xmlns:é="http://www.w3.org/2000/svg"><é:script>alert(1)</é:script></é:svg>'),
    false,
  );
});

test("[happy] binary uploads and small non-SVG XML still pass the probe", async () => {
  const png = new Uint8Array(WINDOW + 1024);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png[WINDOW - 1] = 0x3c; // a stray "<" at the window edge
  assert.equal(await probe(png), true);
  assert.equal(await probe(new Uint8Array(WINDOW + 1024)), true);
  assert.equal(await probe('<?xml version="1.0"?><note><to>a</to></note>'), true);
});

// ---------------------------------------------------------------------------
// CI gates
// ---------------------------------------------------------------------------

test("[unhappy] verify-actions-pinned reports every YAML spelling of an unpinned uses", () => {
  const forms = [
    "      - uses: actions/checkout@v4",
    "      - uses: docker://ghcr.io/evil/image:latest",
    '      - "uses": evil/action@main',
    "      - { uses: evil/action@main }",
    "      - uses:\n          evil/action@main",
    "      - ? uses\n        : evil/action@main",
  ];
  for (const form of forms) {
    assert.ok(findUnpinnedActions("wf.yml", form).length >= 1, form);
  }
});

test("[happy] verify-actions-pinned accepts pinned, local and digest-pinned references", () => {
  const sha = "a".repeat(40);
  const digest = "b".repeat(64);
  const text = [
    `      - uses: actions/checkout@${sha} # v4`,
    "      - uses: ./.github/actions/local",
    `      - uses: docker://ghcr.io/org/image@sha256:${digest}`,
    "      # uses: evil/action@main (a comment, not a step)",
    "        run: echo this step uses: nothing",
  ].join("\n");
  assert.deepEqual(findUnpinnedActions("wf.yml", text), []);
});

test("[unhappy] verify-no-runtime-deps sees every block a consumer install pulls in", () => {
  assert.equal(findForbiddenRuntimeDependencies({ dependencies: { a: "1" } }).length, 1);
  assert.equal(findForbiddenRuntimeDependencies({ optionalDependencies: { a: "1" } }).length, 1);
  assert.equal(findForbiddenRuntimeDependencies({ peerDependencies: { a: "1" } }).length, 1);
  assert.equal(findForbiddenRuntimeDependencies({ bundledDependencies: ["a"] }).length, 1);
  assert.equal(findForbiddenRuntimeDependencies({ bundleDependencies: true }).length, 1);
});

test("[happy] verify-no-runtime-deps allows dev dependencies and optional peers", () => {
  assert.deepEqual(
    findForbiddenRuntimeDependencies({
      devDependencies: { a: "1" },
      peerDependencies: { zod: "^4" },
      peerDependenciesMeta: { zod: { optional: true } },
    } as never),
    [],
  );
});
