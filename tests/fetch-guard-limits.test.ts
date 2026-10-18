import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createTcpServer } from "node:net";
import { createServer } from "node:http";
import { once } from "node:events";
import { fetchGuard, SsrfBlockedError } from "../src/index.js";

function stubFetch(
  respond: (req: Request) => Response = () => new Response("ok", { status: 200 })
) {
  const calls: Request[] = [];
  const fn = (async (input: Request) => {
    calls.push(input);
    return respond(input);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const publicIp = async () => ["93.184.216.34"];
const isBlocked = (reason: string) => (e: unknown) =>
  e instanceof SsrfBlockedError && e.reason === reason;

test("fetchGuard refuses Fetch Standard bad ports on the pinned and unpinned paths", async () => {
  const { fn, calls } = stubFetch();
  const unpinned = fetchGuard({ fetch: fn, resolve: publicIp });
  for (const port of [25, 6000, 6667]) {
    await assert.rejects(() => unpinned(`http://mail.example:${port}/`), isBlocked("port-not-allowed"));
  }
  const pinned = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
  await assert.rejects(() => pinned("http://x11.invalid:6000/"), isBlocked("port-not-allowed"));
  assert.equal(calls.length, 0);
  // Ordinary ports still work.
  assert.equal((await unpinned("http://ok.example:8080/")).status, 200);
});

test("fetchGuard allowPorts restricts destinations to the listed ports", async () => {
  const { fn, calls } = stubFetch();
  const guard = fetchGuard({ fetch: fn, resolve: publicIp, allowPorts: [443] });
  assert.equal((await guard("https://img.example/a.png")).status, 200);
  await assert.rejects(() => guard("http://img.example/a.png"), isBlocked("port-not-allowed"));
  await assert.rejects(() => guard("https://img.example:8443/"), isBlocked("port-not-allowed"));
  assert.equal(calls.length, 1);
});

test("fetchGuard allowHosts entries with a port trust only that port", async () => {
  const { fn } = stubFetch();
  const guard = fetchGuard({
    fetch: fn,
    allowHosts: ["billing.internal:8443"],
    resolve: async () => ["10.0.0.5"],
  });
  assert.equal((await guard("https://billing.internal:8443/charge")).status, 200);
  // Another port on the same name gets the full DNS / address checks.
  await assert.rejects(
    () => guard("http://billing.internal:9000/"),
    isBlocked("address-not-allowed")
  );
  // A bare hostname still trusts every port (documented, not recommended).
  const bare = fetchGuard({ fetch: fn, allowHosts: ["svc.internal"], resolve: async () => ["10.0.0.5"] });
  assert.equal((await bare("http://svc.internal:9000/")).status, 200);
});

test("fetchGuard timeoutMs bounds a stalled upstream, including the body read", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write("partial");
    // never ends
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"], timeoutMs: 150 });
    const res = await guard(`http://slow.invalid:${port}/`);
    const t0 = Date.now();
    await assert.rejects(() => res.text(), (e: unknown) => e instanceof Error && e.name === "TimeoutError");
    assert.ok(Date.now() - t0 < 2000, "deadline fired promptly");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("fetchGuard validates timeoutMs and maxResponseBytes", () => {
  assert.throws(() => fetchGuard({ timeoutMs: -1 }), RangeError);
  assert.throws(() => fetchGuard({ timeoutMs: Number.POSITIVE_INFINITY }), RangeError);
  assert.throws(() => fetchGuard({ maxResponseBytes: Number.NaN }), RangeError);
  assert.throws(() => fetchGuard({ maxResponseBytes: -1 }), RangeError);
  assert.doesNotThrow(() => fetchGuard({ timeoutMs: 0, maxResponseBytes: Number.POSITIVE_INFINITY }));
});

test("fetchGuard maxResponseBytes refuses an oversized declared Content-Length", async () => {
  const { fn } = stubFetch(
    () => new Response("x".repeat(64), { headers: { "content-length": "64" } })
  );
  const guard = fetchGuard({ fetch: fn, resolve: publicIp, maxResponseBytes: 32 });
  await assert.rejects(() => guard("https://big.example/"), isBlocked("response-too-large"));
});

test("fetchGuard maxResponseBytes errors a streamed body that grows past the cap", async () => {
  const { fn } = stubFetch(() => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(16));
        c.close();
      },
    });
    return new Response(stream);
  });
  const guard = fetchGuard({ fetch: fn, resolve: publicIp, maxResponseBytes: 40 });
  const res = await guard("https://stream.example/");
  assert.equal(res.url, "https://stream.example/");
  await assert.rejects(() => res.arrayBuffer(), isBlocked("response-too-large"));

  // Under the cap the body arrives intact; Infinity leaves the response untouched.
  const roomy = fetchGuard({ fetch: fn, resolve: publicIp, maxResponseBytes: 64 });
  assert.equal((await (await roomy("https://stream.example/")).arrayBuffer()).byteLength, 64);
  const uncapped = fetchGuard({ fetch: fn, resolve: publicIp, maxResponseBytes: Infinity });
  assert.equal((await (await uncapped("https://stream.example/")).arrayBuffer()).byteLength, 64);
});

test("fetchGuard sensitiveHeaders are stripped on a cross-origin redirect only", async () => {
  let hop = 0;
  const { fn, calls } = stubFetch(() =>
    hop++ === 0
      ? new Response(null, { status: 302, headers: { location: "https://other.example/next" } })
      : new Response("ok")
  );
  const guard = fetchGuard({ fetch: fn, resolve: publicIp, sensitiveHeaders: ["X-Api-Key"] });
  await guard("https://api.example/start", { headers: { "x-api-key": "k1", "x-trace": "t" } });
  assert.equal(calls[0]!.headers.get("x-api-key"), "k1");
  assert.equal(calls[1]!.headers.get("x-api-key"), null, "custom credential dropped cross-origin");
  assert.equal(calls[1]!.headers.get("x-trace"), "t", "other headers kept");

  hop = 0;
  calls.length = 0;
  const same = stubFetch(() =>
    hop++ === 0
      ? new Response(null, { status: 302, headers: { location: "/next" } })
      : new Response("ok")
  );
  const sameGuard = fetchGuard({ fetch: same.fn, resolve: publicIp, sensitiveHeaders: ["x-api-key"] });
  await sameGuard("https://api.example/start", { headers: { "x-api-key": "k1" } });
  assert.equal(same.calls[1]!.headers.get("x-api-key"), "k1", "same-origin redirect keeps it");
});

test("fetchGuard pins https to the validated IP and sends the hostname as TLS SNI", async () => {
  let clientHello: Buffer = Buffer.alloc(0);
  const server = createTcpServer((socket) => {
    socket.once("data", (chunk: Buffer) => {
      clientHello = chunk;
      socket.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    await assert.rejects(() => guard(`https://pinned-sni.invalid:${port}/`));
    assert.ok(clientHello.length > 0, "the TLS dial reached the validated address");
    assert.ok(clientHello.includes(Buffer.from("pinned-sni.invalid")), "SNI carries the hostname, not the IP");
  } finally {
    server.close();
  }
});
