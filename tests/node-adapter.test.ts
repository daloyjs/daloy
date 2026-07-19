import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { z } from "zod";
import { App } from "../src/index.js";
import { getConnInfo } from "../src/conn-info.js";
import { serve as serveNode } from "../src/adapters/node.js";

async function startServer(app: App, opts: Parameters<typeof serveNode>[1] = {}) {
  const handle = serveNode(app, { port: 0, handleSignals: false, ...opts });
  await once(handle.server, "listening");
  const port = handle.port;
  return { handle, port };
}

function buildEchoApp(): App {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/hello",
    operationId: "hello",
    responses: { 200: { description: "ok", body: z.object({ msg: z.string() }) as any } },
    handler: async () => ({ status: 200 as const, body: { msg: "hi" } }),
  });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echoPost",
    request: { body: z.object({ value: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ value: z.string() }) as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as { value: string } }),
  });
  app.route({
    method: "GET",
    path: "/url",
    operationId: "url",
    responses: { 200: { description: "ok", body: z.object({ url: z.string() }) as any } },
    handler: async ({ request }) => ({ status: 200 as const, body: { url: request.url } }),
  });
  app.route({
    method: "GET",
    path: "/multi",
    operationId: "multi",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ request }) => ({
      status: 200 as const,
      body: { ok: request.headers.get("x-multi")?.includes(",") ?? false },
    }),
  });
  return app;
}

test("node adapter: GET request flows through toWebRequest and sendWebResponse", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/hello`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { msg: "hi" });
  } finally {
    await handle.close();
  }
});

test("node adapter: handle.port exposes the OS-assigned ephemeral port after listening", async () => {
  const handle = serveNode(buildEchoApp(), { port: 0, handleSignals: false });
  try {
    await once(handle.server, "listening");
    const address = handle.server.address() as AddressInfo;
    assert.notEqual(address.port, 0);
    assert.equal(handle.port, address.port);
  } finally {
    await handle.close();
  }
});

test("node adapter: POST forwards request body via Readable.toWeb", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "payload" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { value: "payload" });
  } finally {
    await handle.close();
  }
});

test("node adapter: trustProxy honors x-forwarded-host and x-forwarded-proto", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { trustProxy: true });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/url`, {
      headers: { "x-forwarded-host": "proxied.example, real.example", "x-forwarded-proto": "https" },
    });
    const body = (await res.json()) as { url: string };
    assert.match(body.url, /^https:\/\/proxied\.example\/url$/);
  } finally {
    await handle.close();
  }
});

test("node adapter: trustProxy off ignores x-forwarded-* headers", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { trustProxy: false });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/url`, {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });
    const body = (await res.json()) as { url: string };
    assert.match(body.url, /^http:\/\/127\.0\.0\.1/);
  } finally {
    await handle.close();
  }
});

test("node adapter: 404 fall-through and array-valued request headers", async () => {
  const { handle, port } = await startServer(buildEchoApp());
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
    const res = await fetch(`http://127.0.0.1:${port}/multi`, {
      headers: { "x-multi": "first, second" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await handle.close();
  }
});

test("node adapter: adapter error path returns 500 problem+json", async () => {
  const app = new App({
    logger: false,
    hooks: {
      onSend: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream boom"));
            },
          }),
        ),
    },
  });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/boom`);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("content-type"), "application/problem+json");
    const body = (await res.json()) as { title: string };
    assert.equal(body.title, "Internal Server Error");
  } finally {
    await handle.close();
  }
});

test("node adapter: rejects invalid maxHeaderBytes", () => {
  assert.throws(
    () => serveNode(new App({ logger: false }), { maxHeaderBytes: -1, handleSignals: false }),
    /maxHeaderSize|range|out of range/i,
  );
});

test("node adapter: maxConnections forwards to server.maxConnections", async () => {
  const { handle, port } = await startServer(buildEchoApp(), { maxConnections: 5 });
  try {
    assert.equal(handle.server.maxConnections, 5);
    // Admitted requests still succeed normally under the cap.
    const res = await fetch(`http://127.0.0.1:${port}/hello`);
    assert.equal(res.status, 200);
  } finally {
    await handle.close();
  }
});

test("node adapter: maxConnections sheds overflow sockets while admitted ones stay served", async () => {
  // Cap at a single concurrent connection, then hold it open with a slow
  // handler. A second connection must be refused at accept time (ECONNRESET /
  // ECONNREFUSED) instead of being queued — that is the graceful-degradation
  // contract: overflow is rejected fast rather than inflating tail latency.
  const app = new App({ logger: false });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => { await gate; return { status: 200 as const, body: { ok: true } }; },
  });
  const { handle, port } = await startServer(app, { maxConnections: 1 });
  try {
    // First connection occupies the only allowed socket (kept open by `gate`).
    const slow = fetch(`http://127.0.0.1:${port}/slow`, {
      headers: { connection: "keep-alive" },
    });
    // Give the first socket time to be accepted before opening the second.
    await new Promise((r) => setTimeout(r, 50));
    // Second connection should be rejected at the socket layer.
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/slow`, { headers: { connection: "close" } }),
      /fetch failed|ECONNRESET|ECONNREFUSED|socket/i,
    );
    // The admitted request still completes successfully once released.
    release();
    const res = await slow;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    release();
    await handle.close();
  }
});

test("node adapter: handleSignals registers SIGTERM/SIGINT listeners", async () => {
  const app = new App({ logger: false });
  const beforeT = process.listenerCount("SIGTERM");
  const beforeI = process.listenerCount("SIGINT");
  const { handle } = await startServer(app, { handleSignals: true });
  try {
    assert.ok(process.listenerCount("SIGTERM") > beforeT);
    assert.ok(process.listenerCount("SIGINT") > beforeI);
  } finally {
    await handle.close();
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }
});

test("node adapter: SIGTERM handler triggers close and exit", async () => {
  // Save originals
  const origExit = process.exit;
  const origTermListeners = process.listeners("SIGTERM");
  const origIntListeners = process.listeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  let exitCode: number | undefined;
  (process as { exit: (c?: number) => void }).exit = ((c?: number) => {
    exitCode = c;
  }) as never;
  try {
    const app = new App({ logger: false });
    const { handle } = await startServer(app, { handleSignals: true });
    const termListener = process.listeners("SIGTERM").slice(-1)[0] as () => void;
    const intListener = process.listeners("SIGINT").slice(-1)[0] as () => void;
    termListener();
    // Wait for close().then(exit) microtasks
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(exitCode, 0);
    // Calling SIGINT after close is also safe (close is idempotent)
    exitCode = undefined;
    intListener();
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(exitCode, 0);
    void handle; // already closed
  } finally {
    (process as { exit: typeof origExit }).exit = origExit;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    for (const l of origTermListeners) process.on("SIGTERM", l as () => void);
    for (const l of origIntListeners) process.on("SIGINT", l as () => void);
  }
});

test("node adapter: double close() is a no-op", async () => {
  const app = new App({ logger: false });
  const { handle } = await startServer(app);
  await handle.close();
  await handle.close();
});

/**
 * Open a raw socket, send partial request headers that never terminate, and
 * report how long until the server reaps the stalled connection. `trickle`
 * keeps dribbling header bytes (the evasive slowloris variant); otherwise the
 * socket goes idle after the partial preamble.
 */
function slowlorisReapMs(port: number, opts: { trickle: boolean; deadlineMs: number }): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    const t0 = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const finish = (reaped: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(reaped ? Date.now() - t0 : null);
    };
    sock.on("connect", () => {
      sock.write("GET /hello HTTP/1.1\r\nHost: t\r\n"); // never sends the terminating blank line
      if (opts.trickle) {
        let i = 0;
        timer = setInterval(() => {
          try {
            sock.write(`X-Drip-${i++}: keep\r\n`);
          } catch {
            /* socket gone */
          }
        }, 200);
      }
    });
    // The server hanging up on us (close/end) or replying 408 = reaped.
    sock.on("close", () => finish(true));
    sock.on("end", () => finish(true));
    sock.on("data", () => finish(true));
    sock.on("error", () => finish(true));
    setTimeout(() => finish(false), opts.deadlineMs);
  });
}

test("node adapter: a stalled (idle) slowloris connection is reaped near the configured timeout", async () => {
  const app = buildEchoApp();
  // Short timeout → the adapter must tune connectionsCheckingInterval so the
  // timeout is actually enforced. Without that fix, Node's default 30s checker
  // leaves the socket open for ~30s and this assertion times out.
  const { handle, port } = await startServer(app, { connectionTimeoutMs: 800 });
  try {
    const ms = await slowlorisReapMs(port, { trickle: false, deadlineMs: 25_000 });
    assert.ok(ms !== null, "the idle stalled connection must be reaped, not held open");
    assert.ok(ms! < 25_000, `reaped in ${ms}ms — before the default 30s checker interval`);
  } finally {
    await handle.close();
  }
});

test("node adapter: connectionTimeoutMs: 0 disables the request/header timeouts", async () => {
  const app = buildEchoApp();
  const { handle } = await startServer(app, { connectionTimeoutMs: 0 });
  try {
    assert.equal(handle.server.requestTimeout, 0, "requestTimeout disabled");
    assert.equal(handle.server.headersTimeout, 0, "headersTimeout disabled");
  } finally {
    await handle.close();
  }
});

test("node adapter: an active-trickle slowloris (bytes dribbled forever) is still reaped", async () => {
  const app = buildEchoApp();
  const { handle, port } = await startServer(app, { connectionTimeoutMs: 800 });
  try {
    const ms = await slowlorisReapMs(port, { trickle: true, deadlineMs: 25_000 });
    assert.ok(ms !== null, "trickling bytes must not let the connection evade the header timeout");
    assert.ok(ms! < 25_000, `trickle slowloris reaped in ${ms}ms`);
  } finally {
    await handle.close();
  }
});

/**
 * Send a complete raw HTTP/1.1 request over a socket and resolve the full
 * response text. Required for methods that `fetch`/undici refuse to send
 * (`TRACE`/`TRACK` are Fetch-forbidden), which is exactly the path under test.
 */
function rawHttp(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    let buf = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(buf);
    };
    sock.on("connect", () => sock.write(raw));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
    });
    sock.on("close", finish);
    sock.on("end", finish);
    sock.on("error", (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
    setTimeout(finish, 3000);
  });
}

test("node adapter: Fetch-forbidden methods (TRACE/TRACK) are refused with 501, never a 500", async () => {
  // Regression: `new Request(url, { method: "TRACE" })` throws a TypeError
  // ("'TRACE' HTTP method is unsupported"), which previously surfaced as a
  // generic 500. The adapter now refuses these methods with a clean 501 before
  // constructing a Request. TRACE/TRACK cannot be sent via fetch (undici
  // forbids them too), so this drives the server over a raw socket.
  const app = buildEchoApp();
  const { handle, port } = await startServer(app);
  try {
    // TRACE is a recognized HTTP method (in Node's http.METHODS), so Node
    // parses it and routes it to the request listener, where `new Request`
    // would throw. The adapter must turn that into a clean 501.
    const trace = await rawHttp(
      port,
      "TRACE /hello HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
    );
    const traceStatus = trace.split("\r\n")[0] ?? "";
    assert.match(
      traceStatus,
      /^HTTP\/1\.1 501\b/,
      `TRACE must be refused with 501 Not Implemented, got: ${traceStatus}`,
    );
    assert.doesNotMatch(traceStatus, /\b500\b/, "TRACE must not surface as a 500");
    assert.match(trace, /application\/problem\+json/, "TRACE refusal should be problem+json");

    // TRACK is not in Node's http.METHODS, so Node's parser rejects it with a
    // 400 before it ever reaches the listener. Either way it must be a clean
    // refusal, never a 500 (the adapter's forbidden-method set covers it for
    // any runtime that does surface it as a normal request).
    const track = await rawHttp(
      port,
      "TRACK /hello HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
    );
    const trackStatus = track.split("\r\n")[0] ?? "";
    assert.match(
      trackStatus,
      /^HTTP\/1\.1 (400|501)\b/,
      `TRACK must be a clean refusal (400 or 501), got: ${trackStatus}`,
    );
    assert.doesNotMatch(trackStatus, /\b500\b/, "TRACK must not surface as a 500");
  } finally {
    await handle.close();
  }
});

test("node adapter: absolute-form request targets are routed by path and never 500", async () => {
  // Regression from a live red-team probe: absolute-form request targets were
  // concatenated as `http://localhttp://remote/path`, which reached the app as
  // a malformed path and surfaced as a 500. Origin servers must tolerate
  // absolute-form targets, but routing should still use only the path/query.
  const app = buildEchoApp();
  const { handle, port } = await startServer(app);
  try {
    const ok = await rawHttp(
      port,
      `GET http://169.254.169.254/hello?x=1 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
    );
    const okStatus = ok.split("\r\n")[0] ?? "";
    assert.match(okStatus, /^HTTP\/1\.1 200\b/, `absolute-form /hello should route, got: ${okStatus}`);
    assert.match(ok, /"msg":"hi"/);

    const missing = await rawHttp(
      port,
      `GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
    );
    const missingStatus = missing.split("\r\n")[0] ?? "";
    assert.match(
      missingStatus,
      /^HTTP\/1\.1 404\b/,
      `absolute-form unknown path should be a normal 404, got: ${missingStatus}`,
    );
    assert.doesNotMatch(missingStatus, /\b500\b/, "absolute-form targets must not surface as 500");
  } finally {
    await handle.close();
  }
});

test("node adapter: malformed Host port suffix returns 400 while a trailing-dot hostname remains valid", async () => {
  // Regression from a live red-team probe: a Host header like
  // `127.0.0.1:3000.` produced an invalid WHATWG URL inside the framework,
  // which surfaced as an unhandled 500. The adapter must validate the
  // constructed request URL at the boundary and reject it as a client error,
  // without confusing that malformed port with a valid trailing-dot DNS name.
  const app = buildEchoApp();
  const { handle, port } = await startServer(app);
  try {
    const malformed = await rawHttp(
      port,
      `GET /hello HTTP/1.1\r\nHost: 127.0.0.1:${port}.\r\nConnection: close\r\n\r\n`,
    );
    const statusLine = malformed.split("\r\n")[0] ?? "";
    assert.match(
      statusLine,
      /^HTTP\/1\.1 400\b/,
      `malformed Host must be rejected with 400 Bad Request, got: ${statusLine}`,
    );
    assert.doesNotMatch(statusLine, /\b500\b/, "malformed Host must not surface as a 500");
    assert.match(
      malformed,
      /application\/problem\+json/,
      "malformed Host refusal should be problem+json",
    );

    const validTrailingDot = await rawHttp(
      port,
      `GET /hello HTTP/1.1\r\nHost: example.test.:${port}\r\nConnection: close\r\n\r\n`,
    );
    const validStatusLine = validTrailingDot.split("\r\n")[0] ?? "";
    assert.match(
      validStatusLine,
      /^HTTP\/1\.1 200\b/,
      `a valid trailing-dot hostname must remain accepted, got: ${validStatusLine}`,
    );
  } finally {
    await handle.close();
  }
});

// ---------- LightRequest / LightResponse (lazy undici construction) ----------
//
// The Node adapter hands dispatch a lazily-materializing Request shim (and
// gets back a lazily-materializing Response on the serializeResult hot
// path). These tests pin the WHATWG semantics that the shims must preserve:
// instanceof, direct body reads, single-read enforcement, clone(), and the
// body-limit rejection on the pre-buffered path.

function buildLightApp(): App {
  const app = new App({ logger: false, secureHeaders: false });
  app.route({
    method: "POST",
    path: "/raw-json",
    operationId: "rawJson",
    responses: { 200: { description: "ok" } },
    // Schema-less: reads the body straight off the WHATWG surface, like the
    // daloy-bare bench server — exercises LightRequest.json() directly.
    handler: async ({ request }) => ({
      status: 200 as const,
      body: { echoed: await request.json(), isRequest: request instanceof Request },
    }),
  });
  app.route({
    method: "POST",
    path: "/double-read",
    operationId: "doubleRead",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      await request.text();
      const usedAfterFirst = request.bodyUsed;
      let secondReadRejected = false;
      try {
        await request.text();
      } catch (e) {
        secondReadRejected = e instanceof TypeError;
      }
      let cloneAfterReadThrew = false;
      try {
        request.clone();
      } catch (e) {
        cloneAfterReadThrew = e instanceof TypeError;
      }
      return {
        status: 200 as const,
        body: { usedAfterFirst, secondReadRejected, cloneAfterReadThrew },
      };
    },
  });
  app.route({
    method: "POST",
    path: "/clone-first",
    operationId: "cloneFirst",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      // clone() BEFORE reading must return a real, readable Request.
      const clone = request.clone();
      const fromClone = await clone.text();
      const fromOriginal = await request.text();
      return { status: 200 as const, body: { fromClone, fromOriginal } };
    },
  });
  return app;
}

test("node adapter: LightRequest serves json() from buffered bytes and passes instanceof", async () => {
  const { handle, port } = await startServer(buildLightApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/raw-json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { echoed: { a: 1 }, isRequest: true });
  } finally {
    await handle.close();
  }
});

test("node adapter: LightRequest enforces single-read body semantics", async () => {
  const { handle, port } = await startServer(buildLightApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/double-read`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      usedAfterFirst: true,
      secondReadRejected: true,
      cloneAfterReadThrew: true,
    });
  } finally {
    await handle.close();
  }
});

test("node adapter: LightRequest clone() before read yields an independent readable body", async () => {
  const { handle, port } = await startServer(buildLightApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/clone-first`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "payload",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fromClone: "payload", fromOriginal: "payload" });
  } finally {
    await handle.close();
  }
});

test("node adapter: pre-buffered body over bodyLimitBytes is rejected 413", async () => {
  // Unhappy path for readBodyBytesFast: the adapter buffers the bytes (they
  // fit its 256 KiB pre-buffer), but the app-level bodyLimitBytes is
  // smaller — the framework's limit re-check must still reject.
  const app = new App({ logger: false, secureHeaders: false, bodyLimitBytes: 8 });
  app.route({
    method: "POST",
    path: "/tiny",
    operationId: "tinyLimit",
    request: { body: z.object({ x: z.string() }) as any },
    responses: { 200: { description: "ok" } },
    handler: ({ body }) => ({ status: 200 as const, body }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/tiny`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: "way-over-eight-bytes" }),
    });
    assert.equal(res.status, 413);
  } finally {
    await handle.close();
  }
});

test("node adapter: onSend hook can read a LightResponse body via clone()", async () => {
  // LightResponse must survive hooks that inspect the outgoing body — the
  // delegation path materializes a real Response on demand.
  let hookSaw: string | undefined;
  const app = new App({
    logger: false,
    secureHeaders: false,
    hooks: {
      onSend: async (res) => {
        hookSaw = await res.clone().text();
        return undefined;
      },
    },
  });
  app.route({
    method: "GET",
    path: "/inspect",
    operationId: "inspectLight",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/inspect`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(hookSaw, JSON.stringify({ ok: true }));
  } finally {
    await handle.close();
  }
});

test("node adapter: multiple Set-Cookie headers all reach the client", async () => {
  // Regression: `Headers.forEach` yields each Set-Cookie separately and
  // `ServerResponse.setHeader` overwrites repeated keys, so a response that
  // set a session cookie AND a csrf cookie used to deliver only the last one.
  const app = new App({
    logger: false,
    secureHeaders: false,
    hooks: {
      onSend: async (res) => {
        res.headers.append("set-cookie", "a=1; Path=/");
        res.headers.append("set-cookie", "b=2; Path=/; HttpOnly");
        return undefined;
      },
    },
  });
  app.route({
    method: "GET",
    path: "/cookies",
    operationId: "cookies",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/cookies`);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.deepEqual(
      [...cookies].sort(),
      ["a=1; Path=/", "b=2; Path=/; HttpOnly"],
    );
  } finally {
    await handle.close();
  }
});

test("node adapter: single Set-Cookie header is delivered unchanged", async () => {
  const app = new App({
    logger: false,
    secureHeaders: false,
    hooks: {
      onSend: async (res) => {
        res.headers.append("set-cookie", "only=1; Path=/");
        return undefined;
      },
    },
  });
  app.route({
    method: "GET",
    path: "/one-cookie",
    operationId: "oneCookie",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/one-cookie`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.headers.getSetCookie(), ["only=1; Path=/"]);
  } finally {
    await handle.close();
  }
});

test("node adapter: attaches conn-info with the immediate TCP peer", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/conn",
    operationId: "conn",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      const info = getConnInfo(request);
      return {
        status: 200 as const,
        body: {
          addr: info?.remoteAddress ?? null,
          hasPort: typeof info?.remotePort === "number",
          tls: info?.tls ?? null,
        },
      };
    },
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/conn`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { addr: string | null; hasPort: boolean; tls: boolean | null };
    assert.match(body.addr ?? "", /^(::ffff:)?127\.0\.0\.1$|^::1$/);
    assert.equal(body.hasPort, true);
    assert.equal(body.tls, false);
  } finally {
    await handle.close();
  }
});

test("node adapter: malformed Host on WebSocket upgrade returns 400 and does not crash the process", async () => {
  // Regression: `new URL("http://exa mple/ws")` throws, and the upgrade
  // promise was discarded with `void`, so a single malformed upgrade request
  // became an unhandled rejection (fatal under the production
  // crash-on-unhandledRejection posture).
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/alive",
    operationId: "alive",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.ws("/ws", {
    allowedOrigins: ["https://app.example.com"],
    open() {},
  });
  const { handle, port } = await startServer(app);
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        port,
        path: "/ws",
        method: "GET",
        headers: {
          host: "exa mple",
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      req.on("response", (res) => {
        const code = res.statusCode ?? 0;
        res.on("data", () => {});
        res.on("end", () => resolve(code));
        res.on("close", () => resolve(code));
      });
      req.on("upgrade", (res) => resolve(res.statusCode ?? 101));
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 400);
    // The process survived: a plain request on the same server still works.
    const res = await fetch(`http://127.0.0.1:${port}/alive`);
    assert.equal(res.status, 200);
  } finally {
    await handle.close();
  }
});

// ---------------------------------------------------------------------------
// requestTimeoutMs must fire ctx.request.signal so handlers can unwind
// downstream I/O. Exercised over the wire (LightRequest path) because the
// in-process app.request() path carries a plain Request with no abort hook.
// ---------------------------------------------------------------------------

test("node adapter: requestTimeoutMs aborts ctx.request.signal with a TimeoutError reason", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 30 });
  let sawAbort = false;
  let abortReason: string | undefined;
  app.route({
    method: "GET",
    path: "/slow-abort",
    operationId: "slowAbort",
    responses: { 200: { description: "ok" }, 408: { description: "timeout" } },
    handler: async ({ request }) => {
      request.signal.addEventListener("abort", () => {
        sawAbort = true;
        abortReason = (request.signal.reason as { name?: string } | undefined)?.name;
      });
      // Outlasts the 30ms timeout; the handler keeps running after the 408.
      await new Promise((r) => setTimeout(r, 200));
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "GET",
    path: "/abort-probe",
    operationId: "abortProbe",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { sawAbort, abortReason } }),
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/slow-abort`);
    assert.equal(res.status, 408);
    await res.text();
    // The abort fires at ~30ms; wait past that (but under the handler's 200ms
    // sleep) before probing the flag the background handler set.
    await new Promise((r) => setTimeout(r, 120));
    const probe = (await (
      await fetch(`http://127.0.0.1:${port}/abort-probe`)
    ).json()) as { sawAbort: boolean; abortReason?: string };
    assert.equal(probe.sawAbort, true, "ctx.request.signal must fire on timeout");
    assert.equal(probe.abortReason, "TimeoutError");
  } finally {
    await handle.close();
  }
});

test("node adapter: a handler finishing before requestTimeoutMs leaves the signal un-aborted", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 200 });
  // Seeded true so a passing assertion proves the handler actively observed a
  // non-aborted signal rather than the flag simply never being written.
  let abortedWhenDone = true;
  app.route({
    method: "GET",
    path: "/fast-noabort",
    operationId: "fastNoAbort",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      const signal = request.signal; // materialize the controller
      await new Promise((r) => setTimeout(r, 5));
      abortedWhenDone = signal.aborted;
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const { handle, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/fast-noabort`);
    assert.equal(res.status, 200);
    assert.equal(abortedWhenDone, false, "signal must not fire when the handler finishes in time");
  } finally {
    await handle.close();
  }
});
