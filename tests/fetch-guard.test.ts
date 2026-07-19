import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  fetchGuard,
  SsrfBlockedError,
} from "../src/index.js";

// Helper: make a stub fetch that records call URLs and returns a 200.
function recordingFetch(responses?: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (input: Request | string | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push(url);
    const r = responses?.[i++] ?? { status: 200 };
    return new Response(r.body ?? "ok", { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const allowAllResolver = (addr: string) => async () => [addr];

test("fetchGuard: blocks AWS/Azure metadata 169.254.169.254 (link-local literal)", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://169.254.169.254/latest/meta-data/iam/security-credentials/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
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
      `expected SsrfBlockedError, got ${(thrown as Error)?.constructor?.name}`,
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
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
  );
});

test("fetchGuard: blocks Oracle Cloud metadata 192.0.0.192 (always-deny)", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://192.0.0.192/opc/v2/instance/"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
  );
});

test("fetchGuard: blocks loopback IPv4 by default", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://127.0.0.1:8080/admin"),
    SsrfBlockedError,
  );
});

test("fetchGuard: blocks loopback IPv6 ::1 by default", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://[::1]/admin"),
    SsrfBlockedError,
  );
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
  await assert.rejects(
    () => guarded("http://[::ffff:169.254.169.254]/"),
    SsrfBlockedError,
  );
});

test("fetchGuard: blocks IPv6 link-local fe80::/10", async () => {
  const guarded = fetchGuard();
  await assert.rejects(
    () => guarded("http://[fe80::1]/"),
    SsrfBlockedError,
  );
});

test("fetchGuard: rejects non-http(s) protocols", async () => {
  const guarded = fetchGuard();
  for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "data:text/plain;base64,QQ=="]) {
    await assert.rejects(
      () => guarded(u),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "protocol-not-allowed",
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
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
  );
  assert.equal(r.calls.length, 0, "no network call should have been issued");
});

test("fetchGuard: blocks if ANY resolved address is internal (multi-record DNS rebind)", async () => {
  const r = recordingFetch();
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["198.51.100.42", "127.0.0.1"],
  });
  await assert.rejects(
    () => guarded("http://hybrid.example/"),
    SsrfBlockedError,
  );
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
  const r = recordingFetch([
    { status: 302, headers: { location: "http://169.254.169.254/" } },
  ]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  await assert.rejects(
    () => guarded("https://example.com/redirect"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "address-not-allowed",
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
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "too-many-redirects",
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
      e.address === "10.6.6.6",
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
        e instanceof SsrfBlockedError &&
        e.reason === "address-not-allowed" &&
        e.address === ip,
      `expected cloud metadata IP ${ip} to remain blocked`,
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
  const r = recordingFetch([
    { status: 302, headers: { location: "http://169.254.169.254/" } },
  ]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  const res = await guarded("https://example.com/", { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(r.calls.length, 1);
});

test("fetchGuard: redirect: 'error' throws on 3xx", async () => {
  const r = recordingFetch([
    { status: 302, headers: { location: "https://example.com/next" } },
  ]);
  const guarded = fetchGuard({
    fetch: r.fn,
    resolve: async () => ["8.8.8.8"],
  });
  await assert.rejects(
    () => guarded("https://example.com/", { redirect: "error" }),
    TypeError,
  );
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
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "dns-resolution-failed",
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
      `re-encoded internal IP must be blocked: ${u}`,
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
      received.push({ host: req.headers.host, method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
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
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    // `internal.svc.invalid` does not resolve in real DNS; success means the
    // socket used the validated IP, i.e. the rebinding window is closed.
    const res = await guard(`http://internal.svc.invalid:${port}/data`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; host: string };
    assert.equal(json.ok, true);
    assert.equal(json.host, `internal.svc.invalid:${port}`, "Host header carries the original authority, not the raw IP");
    assert.equal(received[0]?.url, "/data");
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): the deny check is never weakened — a host resolving to metadata is still blocked", async () => {
  const guard = fetchGuard({ pinDns: true, resolve: async () => ["169.254.169.254"] });
  await assert.rejects(
    () => guard("http://rebind.invalid/"),
    (e: unknown) => e instanceof SsrfBlockedError && e.reason === "address-not-allowed",
  );
});

test("fetchGuard({ pinDns }): POST method + body are forwarded over the pinned socket", async () => {
  const { server, port, received } = await startEchoServer();
  try {
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
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
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
    const res = await guard(`http://site.invalid:${port}/redir`);
    assert.equal(res.status, 200);
    assert.deepEqual(received.map((r) => r.url), ["/redir", "/landing"]);
  } finally {
    server.close();
  }
});

test("fetchGuard({ pinDns }): a HEAD request yields a null-body response", async () => {
  const { server, port } = await startEchoServer();
  try {
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
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
  assert.equal(calls.length, 1, "the https path falls through to options.fetch, not the node:http pin");
});

test("fetchGuard({ pinDns }): a 204 yields a null body, and multi-valued response headers survive", async () => {
  const { server, port } = await startEchoServer();
  try {
    const guard = fetchGuard({ pinDns: true, allowLoopback: true, resolve: async () => ["127.0.0.1"] });
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
