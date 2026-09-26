import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fetchGuard, SsrfBlockedError } from "../src/index.js";

// Helper: make a stub fetch that records call URLs and returns a 200.
function recordingFetch(
  responses?: Array<{ status: number; headers?: Record<string, string>; body?: string }>
) {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (input: Request | string | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = responses?.[i++] ?? { status: 200 };
    return new Response(r.body ?? "ok", { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const allowAllResolver = (addr: string) => async () => [addr];

test("fetchGuard classifies malformed URLs before dispatch", async () => {
  const guarded = fetchGuard();
  await assert.rejects(guarded("not a URL"), (error: unknown) =>
    error instanceof SsrfBlockedError && error.reason === "invalid-url");
});

test("fetchGuard reports redirect userinfo with a typed redacted error", async () => {
  const stub = recordingFetch([{ status: 302, headers: { location: "https://sample:fixture@example.com/next" } }]);
  const guarded = fetchGuard({ fetch: stub.fn, resolve: allowAllResolver("93.184.216.34") });
  await assert.rejects(guarded("https://example.com/start"), (error: unknown) =>
    error instanceof SsrfBlockedError && error.reason === "credentials-in-url" &&
    error.url === "https://example.com/next");
  assert.equal(stub.calls.length, 1);
});

test("fetchGuard: blocks AWS/Azure metadata 169.254.169.254 (link-local literal)", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://169.254.169.254/latest/meta-data/iam/security-credentials/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed"
  );
});

test("fetchGuard: rejects a credentialed URL with a typed SsrfBlockedError (not a raw TypeError)", async () => {
  // Regression: `http://user@host/` is a classic SSRF obfuscation. undici's
  // Request constructor throws a raw TypeError for userinfo URLs *before* our
  // host validation runs, which escaped the SsrfBlockedError contract and made
  // callers misclassify the block as a generic upstream failure.
  const guarded = fetchGuard();
  for (const url of ["http://foo@127.0.0.1/", "http://user:pass@169.254.169.254/latest/"]) {
    let thrown: unknown;
    try {
      await guarded(url);
      assert.fail(`expected guarded(${JSON.stringify(url)}) to throw`);
    } catch (e) {
      thrown = e;
    }
    assert.ok(
      thrown instanceof SsrfBlockedError,
      `expected SsrfBlockedError, got ${(thrown as Error)?.constructor?.name}`
    );
    assert.equal((thrown as SsrfBlockedError).reason, "credentials-in-url");
    assert.ok(!(thrown instanceof TypeError));
    // Credentials must be stripped from the URL recorded on the error so a
    // caller-supplied secret never leaks into logs.
    assert.ok(!(thrown as SsrfBlockedError).url.includes("foo"));
    assert.ok(!(thrown as SsrfBlockedError).url.includes("pass"));
  }
});

test("fetchGuard: blocks Alibaba metadata 100.100.100.200 (always-deny CGNAT)", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://100.100.100.200/latest/meta-data/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed"
  );
});

test("fetchGuard: blocks Oracle Cloud metadata 192.0.0.192 (always-deny)", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://192.0.0.192/opc/v2/instance/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed"
  );
});

test("fetchGuard: blocks loopback IPv4 by default", async () => {
  const guarded = fetchGuard();
  await assert.rejects(() => guarded("http://127.0.0.1:8080/admin"), SsrfBlockedError);
});

test("fetchGuard: blocks loopback IPv6 ::1 by default", async () => {
  const guarded = fetchGuard();
  await assert.rejects(() => guarded("http://[::1]/admin"), (e: unknown) => e instanceof SsrfBlockedError && e.reason === "address-not-allowed");
});

test("fetchGuard: blocks RFC1918 ranges by default (10/8, 172.16/12, 192.168/16)", async () => {
  const guarded = fetchGuard();
  for (const u of [
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.254/",
    "http://192.168.1.1/",
  ]) {
    await assert.rejects(() => guarded(u), SsrfBlockedError);
  }
});

test("fetchGuard: blocks IPv4-mapped IPv6 against the underlying v4 address", async () => {
  const guarded = fetchGuard();
  await assert.rejects(() => guarded("http://[::ffff:169.254.169.254]/"), (e: unknown) => e instanceof SsrfBlockedError && e.reason === "address-not-allowed");
});

test("fetchGuard: blocks IPv6 link-local fe80::/10", async () => {
  const guarded = fetchGuard();
  await assert.rejects(() => guarded("http://[fe80::1]/"), (e: unknown) => e instanceof SsrfBlockedError && e.reason === "address-not-allowed");
});

test("fetchGuard: rejects non-http(s) protocols", async () => {
  const guarded = fetchGuard();
  for (const u of [
    "file:///etc/passwd",
    "ftp://example.com/",
    "gopher://example.com/",
    "data:text/plain;base64,QQ==",
  ]) {
    await assert.rejects(
      () => guarded(u),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "protocol-not-allowed"
    );
  }
});

test("fetchGuard: blocks DNS names that resolve to a metadata IP", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: allowAllResolver("169.254.169.254"),
  });
  await assert.rejects(
    () => guarded("http://attacker.example/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed"
  );
  assert.equal(r.calls.length, 0, "no network call should have been issued");
});

test("fetchGuard: blocks if ANY resolved address is internal (multi-record DNS rebind)", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["198.51.100.42", "127.0.0.1"],
  });
  await assert.rejects(() => guarded("http://hybrid.example/"), SsrfBlockedError);
});

test("fetchGuard: allows public IPs through", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  const res = await guarded("https://dns.google/");
  assert.equal(res.status, 200);
  assert.equal(r.calls.length, 1);
});

test("fetchGuard: re-validates redirects (302 -> metadata is blocked)", async () => {
  const r = recordingFetch([{ status: 302, headers: { location: "http://169.254.169.254/" } }]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  await assert.rejects(
    () => guarded("https://example.com/redirect"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed"
  );
});

test("fetchGuard: follows safe redirects up to maxRedirects", async () => {
  const r = recordingFetch([
    { status: 302, headers: { location: "https://example.com/step2" } },
    { status: 200, body: "final" },
  ]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  const res = await guarded("https://example.com/start");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "final");
  assert.equal(r.calls.length, 2);
});

for (const status of [301, 302, 303, 307, 308]) {
  for (const destination of [
    "https://other.example/destination",
    "https://source.example:8443/destination",
    "http://source.example/destination",
    "https://source.example/destination",
    "https://SOURCE.example:443/destination",
  ]) {
    test(`fetchGuard: ${status} redirect credentials are origin-bound (${destination})`, async () => {
      const requests: Request[] = [];
      const guarded = fetchGuard({
        resolve: async () => ["8.8.8.8"],
        fetch: async (input) => {
          requests.push(new Request(input));
          return requests.length === 1
            ? new Response(null, { status, headers: { location: destination } })
            : new Response("ok");
        },
      });
      const headers = {
        Authorization: "Bearer test-only",
        Cookie: "session=test-only",
        "Proxy-Authorization": "Basic test-only",
        Host: "source.example",
        Accept: "application/json",
        "Content-Type": "text/plain",
      };
      const sendsBody = status !== 307 && status !== 308;
      const response = await guarded("https://source.example/start", {
        method: sendsBody ? "POST" : "GET",
        headers,
        ...(sendsBody ? { body: "test-body" } : {}),
      });
      assert.equal(response.status, 200);
      assert.equal(requests.length, 2);
      const sameOrigin = new URL(destination).origin === "https://source.example";
      for (const name of ["Authorization", "Cookie", "Proxy-Authorization", "Host"] as const) {
        assert.equal(requests[0]!.headers.get(name), headers[name]);
        assert.equal(requests[1]!.headers.get(name), sameOrigin ? headers[name] : null);
      }
      assert.equal(requests[1]!.headers.get("accept"), "application/json");
      assert.equal(requests[1]!.method, "GET");
      assert.equal(requests[1]!.headers.get("content-type"), sendsBody ? null : "text/plain");
      assert.equal(await requests[1]!.text(), "");
    });
  }
}

test("fetchGuard: a redirect back to the original origin does not restore credentials", async () => {
  const requests: Request[] = [];
  const destinations = ["https://other.example/", "https://source.example/return"];
  const guarded = fetchGuard({
    resolve: async () => ["8.8.8.8"],
    fetch: async (input) => {
      requests.push(new Request(input));
      const destination = destinations[requests.length - 1];
      return destination
        ? new Response(null, { status: 307, headers: { location: destination } })
        : new Response("ok");
    },
  });
  await guarded("https://source.example/start", {
    headers: { authorization: "Bearer test-only", cookie: "session=test-only" },
  });
  assert.equal(requests.length, 3);
  for (const request of requests.slice(1)) {
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("cookie"), null);
  }
});

for (const pinDns of [false, true]) {
  test(`fetchGuard: cross-origin credentials never reach the second socket (pinDns=${pinDns})`, async (context) => {
    const destinationServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.headers));
    });
    context.after(() => {
      destinationServer.closeAllConnections();
      destinationServer.close();
    });
    destinationServer.listen(0, "127.0.0.1");
    await once(destinationServer, "listening");
    const destinationPort = (destinationServer.address() as { port: number }).port;
    const hostname = pinDns ? "redirect-test.invalid" : "127.0.0.1";
    let sourceAuthorization: string | undefined;
    const sourceServer = createServer((request, response) => {
      sourceAuthorization = request.headers.authorization;
      response.writeHead(302, { location: `http://${hostname}:${destinationPort}/` });
      response.end();
    });
    context.after(() => {
      sourceServer.closeAllConnections();
      sourceServer.close();
    });
    sourceServer.listen(0, "127.0.0.1");
    await once(sourceServer, "listening");
    const sourcePort = (sourceServer.address() as { port: number }).port;
    const guard = fetchGuard({
      pinDns,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    const response = await guard(`http://${hostname}:${sourcePort}/`, {
      headers: {
        authorization: "Bearer test-only",
        cookie: "session=test-only",
        "proxy-authorization": "Basic test-only",
      },
    });
    assert.equal(response.status, 200);
    const received = (await response.json()) as Record<string, string>;
    assert.equal(sourceAuthorization, "Bearer test-only");
    assert.equal(received.authorization, undefined);
    assert.equal(received.cookie, undefined);
    assert.equal(received["proxy-authorization"], undefined);
    assert.equal(received.host, `${hostname}:${destinationPort}`);
  });
}

test("fetchGuard: refuses excessive redirect chains", async () => {
  // Loop: each response redirects to itself (different path).
  let count = 0;
  const fn = (async () => {
    count++;
    return new Response("", {
      status: 302,
      headers: { location: `https://example.com/loop${count}` },
    });
  }) as unknown as typeof fetch;
  const guarded = fetchGuard({
    fetch: fn,
    resolve: async () => ["8.8.8.8"],
    maxRedirects: 2,
  });
  await assert.rejects(
    () => guarded("https://example.com/start"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "too-many-redirects"
  );
});

test("fetchGuard: allowLoopback bypasses the loopback block", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    allowLoopback: true,
  });
  const res = await guarded("http://127.0.0.1/health");
  assert.equal(res.status, 200);
});

test("fetchGuard: allowAddresses (CIDR) overrides default deny", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    allowAddresses: ["10.0.0.0/8"],
  });
  const res = await guarded("http://10.1.2.3/");
  assert.equal(res.status, 200);
});

test("fetchGuard: denyAddresses beats overlapping allowAddresses", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    allowAddresses: ["10.0.0.0/8"],
    denyAddresses: ["10.6.6.0/24"],
    resolve: async () => ["10.6.6.6"],
  });
  // Non-overlapping address in the allow range is still permitted.
  const okRes = await guarded("http://10.1.2.3/");
  assert.equal(okRes.status, 200);
  // Overlapping address is denied — operator-pinned `denyAddresses` is a
  // hard floor that no allow knob can lift. Regression for the prior
  // ordering where `allowAddresses` short-circuited the deny check.
  await assert.rejects(
    () => guarded("http://blocked.example.com/"),
    (e: unknown) =>
      e instanceof SsrfBlockedError &&
      e.reason === "address-not-allowed" &&
      e.address === "10.6.6.6"
  );
});

test("fetchGuard: allowAddresses cannot lift the cloud-metadata floor", async () => {
  // An operator who *thinks* they're carving out a trusted internal
  // range should never accidentally re-expose AWS/Azure/DigitalOcean
  // (169.254.169.254), Alibaba (100.100.100.200), or Oracle Cloud
  // (192.0.0.192) metadata IPs.
  const metadataIps: Array<[string, string]> = [
    ["169.254.169.254", "169.254.0.0/16"], // AWS / Azure / DigitalOcean
    ["100.100.100.200", "100.64.0.0/10"], // Alibaba
    ["192.0.0.192", "192.0.0.0/24"], // Oracle Cloud
  ];
  for (const [ip, cidr] of metadataIps) {
    const r = recordingFetch();
    const guarded = fetchGuard({
      fetch: r.fn,
      // Deliberately try to allow the metadata range.
      allowAddresses: [cidr],
      // And also flip the soft-deny class that would normally cover it.
      allowLinkLocal: true,
      allowPrivate: true,
      resolve: async () => [ip],
    });
    await assert.rejects(
      () => guarded(`http://target-${ip}.example.com/`),
      (e: unknown) =>
        e instanceof SsrfBlockedError && e.reason === "address-not-allowed" && e.address === ip,
      `expected cloud metadata IP ${ip} to remain blocked`
    );
  }
});

test("fetchGuard: allowHosts skips DNS for explicitly trusted hostnames", async () => {
  const r = recordingFetch();
  let resolved = 0;
  const guarded = fetchGuard({
    fetch: r.fn,
    allowHosts: ["api.example.com"],
    resolve: async () => {
      resolved++;
      return ["8.8.8.8"];
    },
  });
  const res = await guarded("https://api.example.com/");
  assert.equal(res.status, 200);
  assert.equal(resolved, 0, "allowHosts should short-circuit before DNS");
});

test("fetchGuard: 303 downgrades to GET and strips body headers", async () => {
  const r = recordingFetch([
    { status: 303, headers: { location: "https://example.com/done" } },
    { status: 200, body: "ok" },
  ]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  const res = await guarded("https://example.com/post", {
    method: "POST",
    body: "x=1",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(res.status, 200);
});

test("fetchGuard: redirect: 'manual' returns 3xx directly without re-fetch", async () => {
  const r = recordingFetch([{ status: 302, headers: { location: "http://169.254.169.254/" } }]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  const res = await guarded("https://example.com/", { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(r.calls.length, 1);
});

test("fetchGuard: redirect: 'error' throws on 3xx", async () => {
  const r = recordingFetch([{ status: 302, headers: { location: "https://example.com/next" } }]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  await assert.rejects(() => guarded("https://example.com/", { redirect: "error" }), TypeError);
});

test("fetchGuard: SsrfBlockedError carries url + reason + address", async () => {
  const guarded = fetchGuard();
  try {
    await guarded("http://169.254.169.254/");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof SsrfBlockedError);
    assert.equal(err.reason, "address-not-allowed");
    assert.equal(err.address, "169.254.169.254");
    assert.match(err.url, /169\.254\.169\.254/);
    assert.match(err.message, /SSRF blocked/);
  }
});

test("fetchGuard: DNS failures surface as dns-resolution-failed", async () => {
  const guarded = fetchGuard({
    resolve: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  await assert.rejects(
    () => guarded("http://nonexistent.example.test/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "dns-resolution-failed"
  );
});

// Regression: alternative IPv4 literal encodings (decimal / hex / octal / short
// form) are a classic SSRF deny-list evasion. The WHATWG `URL` parser
// canonicalizes them to dotted-quad BEFORE the guard inspects `url.hostname`,
// so the literal check catches them deterministically — independent of whatever
// the DNS resolver would do. These tests pin that behavior so a future refactor
// (e.g. reading a raw host string instead of `url.hostname`) cannot silently
// reopen the bypass. The resolver here would approve anything as a public IP;
// the request must still be blocked at the literal layer, never reaching fetch.
test("fetchGuard: re-encoded internal IPs (decimal/hex/octal/short) are normalized and blocked", async () => {
  const { fn, calls } = recordingFetch();
  const guarded = fetchGuard({ fetch: fn, resolve: allowAllResolver("8.8.8.8") });
  const encodedInternal = [
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f000001/", // hex 127.0.0.1
    "http://0177.0.0.1/", // octal first octet -> 127.0.0.1
    "http://127.1/", // short form -> 127.0.0.1
    "http://0/", // 0.0.0.0
    "http://2852039166/", // decimal 169.254.169.254 (AWS IMDS)
    "http://0xa9fea9fe/", // hex 169.254.169.254
  ];
  for (const u of encodedInternal) {
    await assert.rejects(
      () => guarded(u),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
      `re-encoded internal IP must be blocked: ${u}`
    );
  }
  assert.equal(calls.length, 0, "no encoded-internal request ever reached the underlying fetch");
});

test("fetchGuard: numeric-host normalization is not over-broad — a real public host still passes", async () => {
  const { fn, calls } = recordingFetch();
  const guarded = fetchGuard({ fetch: fn, resolve: allowAllResolver("93.184.216.34") });
  const res = await guarded("http://example.com/");
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "a legitimate public host is fetched exactly once");
});

// ---------------------------------------------------------------------------
// pinDns: close the DNS-rebinding window for http: by pinning the socket to
// the validated IP. These spin up a real node:http server and use a stub
// resolver, so the hostnames below intentionally do NOT exist in real DNS —
// a successful response therefore proves the socket connected to the validated
// IP (127.0.0.1) rather than re-resolving the hostname at connect time.
//
// Default on Node (when options.fetch is omitted) is pinDns: true.
// ---------------------------------------------------------------------------

test("fetchGuard() defaults pinDns to true on Node when no custom fetch is supplied", async () => {
  const { server, port } = await startEchoServer();
  try {
    // No pinDns option and no custom fetch — Node default must pin.
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    const res = await guard(`http://pin-default-test.invalid:${port}/`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { host: string };
    assert.equal(body.host, `pin-default-test.invalid:${port}`);
  } finally {
    server.close();
  }
});

test("fetchGuard({ fetch }) does not auto-enable pinDns (custom fetch owns the socket)", async () => {
  const calls: string[] = [];
  const guard = fetchGuard({
    resolve: async () => ["93.184.216.34"],
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return new Response("ok");
    }) as typeof fetch,
  });
  await guard("http://example.com/");
  assert.equal(calls.length, 1, "custom fetch is used when pinDns is not forced on");
  assert.match(calls[0]!, /example\.com/);
});

async function startEchoServer() {
  const received: Array<{ host?: string; method?: string; url?: string; body: string }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      received.push({
        host: req.headers.host,
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url === "/redir") {
        res.writeHead(302, { location: "/landing" });
        res.end();
        return;
      }
      if (req.url === "/empty") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/cookies") {
        // Multi-valued response header — exercises the array-header copy path.
        res.writeHead(200, { "set-cookie": ["a=1", "b=2"] });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "x-marker": "head" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, host: req.headers.host }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { server, port, received };
}

test("fetchGuard({ pinDns }): http socket is pinned to the validated IP with the original Host preserved", async () => {
  const { server, port, received } = await startEchoServer();
  try {
    const guard = fetchGuard({
      pinDns: true,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    // `internal.svc.invalid` does not resolve in real DNS; success means the
    // socket used the validated IP, i.e. the rebinding window is closed.
    const res = await guard(`http://internal.svc.invalid:${port}/data`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; host: string };
    assert.equal(json.ok, true);
    assert.equal(
      json.host,
      `internal.svc.invalid:${port}`,
      "Host header carries the original authority, not the raw IP"
    );
    assert.equal(received[0]?.url, "/data");
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): the deny check is never weakened — a host resolving to metadata is still blocked", async () => {
  const guard = fetchGuard({ pinDns: true, resolve: async () => ["169.254.169.254"] });
  await assert.rejects(
    () => guard("http://rebind.invalid/"),
    (e: unknown) => e instanceof SsrfBlockedError && e.reason === "address-not-allowed"
  );
});

test("fetchGuard({ pinDns }): POST method + body are forwarded over the pinned socket", async () => {
  const { server, port, received } = await startEchoServer();
  try {
    const guard = fetchGuard({
      pinDns: true,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    const res = await guard(`http://api.invalid:${port}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });
    assert.equal(res.status, 200);
    assert.equal(received[0]?.method, "POST");
    assert.equal(received[0]?.body, '{"x":1}');
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): a pinned http redirect is followed with re-validation at each hop", async () => {
  const { server, port, received } = await startEchoServer();
  try {
    const guard = fetchGuard({
      pinDns: true,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    const res = await guard(`http://site.invalid:${port}/redir`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      received.map((r) => r.url),
      ["/redir", "/landing"]
    );
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): a HEAD request yields a null-body response", async () => {
  const { server, port } = await startEchoServer();
  try {
    const guard = fetchGuard({
      pinDns: true,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    const res = await guard(`http://h.invalid:${port}/`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-marker"), "head");
    assert.equal(await res.text(), "");
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): a literal-IP host is not pin-rewritten but is still served", async () => {
  const { server, port } = await startEchoServer();
  try {
    const guard = fetchGuard({ pinDns: true, allowLoopback: true });
    const res = await guard(`http://127.0.0.1:${port}/x`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): https is intentionally NOT pinned — it uses the provided fetch", async () => {
  const { fn, calls } = recordingFetch();
  const guard = fetchGuard({ pinDns: true, fetch: fn, resolve: async () => ["93.184.216.34"] });
  const res = await guard("https://example.com/");
  assert.equal(res.status, 200);
  assert.equal(
    calls.length,
    1,
    "the https path falls through to options.fetch, not the node:http pin"
  );
});

test("fetchGuard({ pinDns }): a 204 yields a null body, and multi-valued response headers survive", async () => {
  const { server, port } = await startEchoServer();
  try {
    const guard = fetchGuard({
      pinDns: true,
      allowLoopback: true,
      resolve: async () => ["127.0.0.1"],
    });
    const empty = await guard(`http://e.invalid:${port}/empty`);
    assert.equal(empty.status, 204);
    assert.equal(await empty.text(), "", "204 carries no body");

    const cookies = await guard(`http://c.invalid:${port}/cookies`);
    assert.equal(cookies.status, 200);
    // Both Set-Cookie values must be preserved through the pinned dispatch.
    const setCookies = cookies.headers.getSetCookie();
    assert.deepEqual(setCookies.sort(), ["a=1", "b=2"]);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// deepsec 2026-09-26 regressions
// ---------------------------------------------------------------------------

const isAddrBlock = (e: unknown) =>
  e instanceof SsrfBlockedError && e.reason === "address-not-allowed";

test("fetchGuard: IPv6 transition forms embedding a denied IPv4 are refused (DNS answers)", async () => {
  const stub = recordingFetch();
  const embedded = [
    "64:ff9b::a9fe:a9fe", // NAT64 -> 169.254.169.254
    "64:ff9b::a00:1", // NAT64 -> 10.0.0.1
    "64:ff9b::7f00:1", // NAT64 -> 127.0.0.1
    "64:ff9b:1::a00:1", // local-use NAT64
    "2002:7f00:1::", // 6to4 -> 127.0.0.1
    "2002:a9fe:a9fe::", // 6to4 -> 169.254.169.254
    "::7f00:1", // IPv4-compatible -> 127.0.0.1
    "::ffff:0:7f00:1", // SIIT -> 127.0.0.1
    "::ffff:a00:1", // IPv4-mapped -> 10.0.0.1
    "2001:0:4136:e378:8000:63bf:f5ff:fffe", // Teredo, client 10.0.0.1 (XOR)
    "2001:0:a9fe:a9fe::1", // Teredo server 169.254.169.254
  ];
  for (const addr of embedded) {
    const guard = fetchGuard({ fetch: stub.fn, resolve: async () => [addr] });
    await assert.rejects(() => guard("http://evil.attacker.example/"), isAddrBlock, addr);
  }
  assert.equal(stub.calls.length, 0, "no transition address ever reaches the network");
});

test("fetchGuard: IPv6 transition forms embedding a denied IPv4 are refused (URL literals)", async () => {
  const stub = recordingFetch();
  const guard = fetchGuard({ fetch: stub.fn });
  for (const u of [
    "http://[64:ff9b::169.254.169.254]/",
    "http://[64:ff9b::10.0.0.1]/",
    "http://[2002:a9fe:a9fe::]/",
    "http://[::127.0.0.1]/",
    "http://[::ffff:0:127.0.0.1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b:1::8.8.8.8]/", // local-use NAT64 is denied outright
  ]) {
    await assert.rejects(() => guard(u), isAddrBlock, u);
  }
  assert.equal(stub.calls.length, 0);
});

test("fetchGuard: embedded-IPv4 re-check fails closed even when the IPv6 range is allow-listed", async () => {
  const stub = recordingFetch();
  const guard = fetchGuard({
    fetch: stub.fn,
    allowAddresses: ["64:ff9b::/96", "64:ff9b:1::/48"],
    resolve: async () => ["64:ff9b::a9fe:a9fe"],
  });
  await assert.rejects(() => guard("http://evil.attacker.example/"), isAddrBlock);
  assert.equal(stub.calls.length, 0);
});

test("fetchGuard: NAT64 / 6to4 of a PUBLIC IPv4 stays reachable (DNS64 networks keep working)", async () => {
  for (const addr of ["64:ff9b::5db8:d822", "2002:5db8:d822::1"]) {
    const stub = recordingFetch();
    const guard = fetchGuard({ fetch: stub.fn, resolve: async () => [addr] });
    const res = await guard("http://example.com/");
    assert.equal(res.status, 200, addr);
    assert.equal(stub.calls.length, 1);
  }
  // Operator opt-in: allowAddresses + allowPrivate lift the local-use prefix
  // and its (private) embedded IPv4.
  const stub = recordingFetch();
  const guard = fetchGuard({
    fetch: stub.fn,
    allowAddresses: ["64:ff9b:1::/48"],
    allowPrivate: true,
    resolve: async () => ["64:ff9b:1::a00:1"],
  });
  assert.equal((await guard("http://nat64.internal.example/")).status, 200);
  // allowLoopback still re-enables ::1 (not mis-read as IPv4-compatible 0.0.0.1).
  const loop = recordingFetch();
  const lg = fetchGuard({ fetch: loop.fn, allowLoopback: true, pinDns: false });
  assert.equal((await lg("http://[::1]/")).status, 200);
});

test("fetchGuard: bracketed IPv6 literals are classified by the deny list, public literals pass", async () => {
  const resolved: string[] = [];
  const stub = recordingFetch();
  const guard = fetchGuard({
    fetch: stub.fn,
    resolve: async (h) => {
      resolved.push(h);
      return ["93.184.216.34"];
    },
  });
  for (const u of ["http://[::1]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[::ffff:127.0.0.1]/"]) {
    await assert.rejects(() => guard(u), isAddrBlock, u);
  }
  const ok = await guard("http://[2606:4700:4700::1111]/dns");
  assert.equal(ok.status, 200);
  assert.deepEqual(resolved, [], "IPv6 literals never reach the resolver");
  // allowAddresses can now lift an IPv6 literal.
  const allowed = fetchGuard({ fetch: recordingFetch().fn, allowAddresses: ["fc00::/7"] });
  assert.equal((await allowed("http://[fc00::1]/")).status, 200);
});

async function startStallServer() {
  const { createServer: createNetServer } = await import("node:net");
  const sockets: import("node:net").Socket[] = [];
  const server = createNetServer((s) => {
    sockets.push(s);
    s.on("data", () => { });
    s.on("error", () => { });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

test("fetchGuard({ pinDns }): the request AbortSignal aborts a stalled pinned http: upstream", async () => {
  const stall = await startStallServer();
  try {
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    const t0 = Date.now();
    await assert.rejects(
      () => guard(`http://slow.invalid:${stall.port}/`, { signal: AbortSignal.timeout(100) }),
      (e: unknown) => e instanceof Error && e.name === "TimeoutError"
    );
    assert.ok(Date.now() - t0 < 1000, "abort fired promptly");
    // An already-aborted signal is refused before any dispatch.
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => guard(`http://slow.invalid:${stall.port}/`, { signal: ac.signal }),
      (e: unknown) => e instanceof Error && e.name === "AbortError"
    );
  } finally {
    stall.close();
  }
});

test("fetchGuard({ pinDns }): aborting mid-body errors the pinned response stream", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("first-chunk");
    // never ends
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const ac = new AbortController();
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    const res = await guard(`http://stream.invalid:${port}/`, { signal: ac.signal });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await assert.rejects(() => reader.read(), (e: unknown) => e instanceof Error && e.name === "AbortError");
    // Happy path: an un-aborted signal does not disturb a normal pinned fetch.
  } finally {
    server.closeAllConnections();
    server.close();
  }
  const echo = await startEchoServer();
  try {
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    const res = await guard(`http://ok.invalid:${echo.port}/x`, { signal: AbortSignal.timeout(5000) });
    assert.equal(((await res.json()) as { ok: boolean }).ok, true);
  } finally {
    echo.server.close();
  }
});

async function start307Server() {
  const seen: Array<{ url?: string; method?: string; body: string; auth?: string }> = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, body: b, auth: req.headers.authorization });
      if (req.url === "/hook") {
        res.writeHead(307, { location: "/hook2" });
        res.end();
      } else if (req.url === "/perm") {
        res.writeHead(308, { location: "/hook2" });
        res.end();
      } else {
        res.writeHead(200);
        res.end("ok");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { server, port, seen };
}

for (const pinned of [true, false]) {
  test(`fetchGuard: 307/308 replays the request body on the re-validated hop (pinned=${pinned})`, async () => {
    const up = await start307Server();
    try {
      const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
      const host = pinned ? `hooks.invalid:${up.port}` : `127.0.0.1:${up.port}`;
      for (const path of ["/hook", "/perm"]) {
        const res = await guard(`http://${host}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ a: 1 }),
        });
        assert.equal(res.status, 200);
        assert.equal(await res.text(), "ok");
      }
      assert.deepEqual(
        up.seen.map((s) => `${s.method} ${s.url} ${s.body}`),
        [
          'POST /hook {"a":1}',
          'POST /hook2 {"a":1}',
          'POST /perm {"a":1}',
          'POST /hook2 {"a":1}',
        ]
      );
    } finally {
      up.server.close();
    }
  });
}

test("fetchGuard: a 307 with a body is still re-validated — a redirect to metadata is refused", async () => {
  const stub = recordingFetch([{ status: 307, headers: { location: "http://169.254.169.254/latest" } }]);
  const guard = fetchGuard({ fetch: stub.fn, resolve: allowAllResolver("93.184.216.34") });
  await assert.rejects(
    () => guard("https://example.com/hook", { method: "POST", body: "payload" }),
    isAddrBlock
  );
  assert.equal(stub.calls.length, 1);
});

test("fetchGuard: cross-origin 307 keeps the body but strips credentials", async () => {
  const bodies: string[] = [];
  const auths: Array<string | null> = [];
  let n = 0;
  const fn = (async (input: Request) => {
    bodies.push(await input.text());
    auths.push(input.headers.get("authorization"));
    return n++ === 0
      ? new Response(null, { status: 307, headers: { location: "https://other.example/in" } })
      : new Response("ok");
  }) as unknown as typeof fetch;
  const guard = fetchGuard({ fetch: fn, resolve: allowAllResolver("93.184.216.34") });
  const res = await guard("https://example.com/hook", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: "payload",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(bodies, ["payload", "payload"]);
  assert.deepEqual(auths, ["Bearer test-token", null]);
});

test("fetchGuard: 307 of a one-shot stream body is refused with a typed non-transient error", async () => {
  const stub = recordingFetch([{ status: 307, headers: { location: "/again" } }]);
  const guard = fetchGuard({ fetch: stub.fn, resolve: allowAllResolver("93.184.216.34") });
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("chunk"));
      c.close();
    },
  });
  await assert.rejects(
    () => guard("https://example.com/upload", { method: "POST", body, duplex: "half" } as RequestInit),
    (e: unknown) => e instanceof SsrfBlockedError && e.reason === "redirect-body-not-replayable"
  );
  assert.equal(stub.calls.length, 1);
});

// Review follow-up: stream bodies (init stream OR a Request input's body) are
// never buffered; only in-memory bodies up to maxReplayBodyBytes replay.
test("fetchGuard: a Request input's body is streamed, not buffered, and its 307 is refused", async () => {
  const stub = recordingFetch([{ status: 307, headers: { location: "/again" } }]);
  const guard = fetchGuard({ fetch: stub.fn, resolve: allowAllResolver("93.184.216.34") });
  const proxied = new Request("https://example.com/upload", { method: "POST", body: "from-client" });
  await assert.rejects(
    () => guard(proxied),
    (e: unknown) => e instanceof SsrfBlockedError && e.reason === "redirect-body-not-replayable"
  );
  assert.equal(stub.calls.length, 1);
});

test("fetchGuard({ pinDns }): a proxied Request stream body is piped through unbuffered", async () => {
  const { server, port, received } = await startEchoServer();
  try {
    const guard = fetchGuard({ allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    let pulls = 0;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (pulls > 3) c.close();
        else c.enqueue(enc.encode(`part${pulls};`));
      },
    });
    const incoming = new Request(`http://api.invalid:${port}/submit`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const res = await guard(incoming);
    assert.equal(res.status, 200);
    assert.equal(received[0]?.body, "part1;part2;part3;");
  } finally {
    server.close();
  }
});

test("fetchGuard: in-memory bodies above maxReplayBodyBytes are not buffered (307 refused), below replay", async () => {
  const mk = () => recordingFetch([{ status: 307, headers: { location: "/again" } }, { status: 200 }]);
  const big = mk();
  const g1 = fetchGuard({ fetch: big.fn, resolve: allowAllResolver("93.184.216.34"), maxReplayBodyBytes: 16 });
  await assert.rejects(
    () => g1("https://example.com/u", { method: "POST", body: new Uint8Array(64) }),
    (e: unknown) => e instanceof SsrfBlockedError && e.reason === "redirect-body-not-replayable"
  );
  for (const body of [new Uint8Array(8), "tiny", new Blob(["b"]), new URLSearchParams({ a: "1" })]) {
    const small = mk();
    const g2 = fetchGuard({ fetch: small.fn, resolve: allowAllResolver("93.184.216.34"), maxReplayBodyBytes: 16 });
    const res = await g2("https://example.com/u", { method: "POST", body });
    assert.equal(res.status, 200);
    assert.equal(small.calls.length, 2);
  }
  assert.throws(() => fetchGuard({ maxReplayBodyBytes: -1 }), RangeError);
});

test("fetchGuard: multipart filenames count toward the redirect replay cap", async () => {
  const responses = [{ status: 307, headers: { location: "/again" } }, { status: 200 }];
  const large = new FormData();
  large.append("file", new Blob(["x"]), "name".repeat(5_000));
  const refused = recordingFetch(responses);
  const guard = fetchGuard({ fetch: refused.fn, resolve: allowAllResolver("93.184.216.34"), maxReplayBodyBytes: 512 });
  await assert.rejects(
    () => guard("https://example.com/upload", { method: "POST", body: large }),
    (error: unknown) => error instanceof SsrfBlockedError && error.reason === "redirect-body-not-replayable"
  );
  assert.equal(refused.calls.length, 1);

  const small = new FormData();
  small.append("file", new Blob(["x"]), "a.txt");
  const replayed = recordingFetch(responses);
  const replayGuard = fetchGuard({ fetch: replayed.fn, resolve: allowAllResolver("93.184.216.34"), maxReplayBodyBytes: 512 });
  assert.equal((await replayGuard("https://example.com/upload", { method: "POST", body: small })).status, 200);
  assert.equal(replayed.calls.length, 2);
});
