import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  ipReputation,
  setConnInfo,
  urlFeed,
  type IpReputationFeed,
  type IpReputationMatch,
} from "../src/index.js";

// ---------- helpers ----------

/** Feed that yields a fixed list, recording how many times it was fetched. */
function staticFeed(
  name: string,
  entries: readonly string[]
): IpReputationFeed & {
  calls: number;
} {
  return {
    name,
    calls: 0,
    async fetch() {
      this.calls++;
      return entries;
    },
  };
}

/** App with an `ipReputation()` guard plus a single `/` route returning 200. */
function appWith(controller: ReturnType<typeof ipReputation>): App {
  const app = new App({ env: "development" });
  app.use(controller.hooks);
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function req(ip?: string): Request {
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request("http://x/", { headers });
}

// ---------- construction validation (unhappy) ----------

test("ipReputation() requires at least one feed", () => {
  assert.throws(() => ipReputation({ feeds: [] }), /at least one feed/);
});

test("ipReputation() rejects an invalid mode", () => {
  assert.throws(
    // @ts-expect-error intentionally invalid
    () => ipReputation({ feeds: [staticFeed("f", [])], mode: "warn" }),
    /mode must be/
  );
});

test("ipReputation() rejects a negative refreshIntervalMs", () => {
  assert.throws(
    () => ipReputation({ feeds: [staticFeed("f", [])], refreshIntervalMs: -1 }),
    /refreshIntervalMs/
  );
});

test("ipReputation() rejects a non-positive fetchTimeoutMs", () => {
  assert.throws(
    () => ipReputation({ feeds: [staticFeed("f", [])], fetchTimeoutMs: 0 }),
    /fetchTimeoutMs/
  );
});

// ---------- blocking (happy + unhappy) ----------

test("blocks a listed IP and allows an unlisted one", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["10.0.0.0/8", "203.0.113.7"])],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  const app = appWith(ctrl);

  const blocked = await app.fetch(req("10.1.2.3"));
  assert.equal(blocked.status, 403);

  const exact = await app.fetch(req("203.0.113.7"));
  assert.equal(exact.status, 403);

  const allowed = await app.fetch(req("198.51.100.4"));
  assert.equal(allowed.status, 200);
  ctrl.stop();
});

test("fail-open when the client IP cannot be resolved", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["10.0.0.0/8"])],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  const app = appWith(ctrl);
  const res = await app.fetch(req()); // no x-forwarded-for
  assert.equal(res.status, 200);
  ctrl.stop();
});

test("log mode records matches without blocking", async () => {
  const matches: IpReputationMatch[] = [];
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["10.0.0.0/8"])],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
    mode: "log",
    onMatch: (m) => matches.push(m),
  });
  await ctrl.ready;
  const app = appWith(ctrl);
  const res = await app.fetch(req("10.9.9.9"));
  assert.equal(res.status, 200);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.ip, "10.9.9.9");
  assert.deepEqual(matches[0]!.feeds, ["deny"]);
  ctrl.stop();
});

// ---------- fail-open on feed errors ----------

test("fail-open: initial load failure leaves an empty (permissive) denylist", async () => {
  const errors: string[] = [];
  const ctrl = ipReputation({
    feeds: [
      {
        name: "broken",
        async fetch() {
          throw new Error("feed down");
        },
      },
    ],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
    onError: (_e, name) => errors.push(name),
  });
  await ctrl.ready;
  assert.equal(ctrl.size, 0);
  assert.deepEqual(errors, ["broken"]);
  const app = appWith(ctrl);
  const res = await app.fetch(req("10.0.0.1"));
  assert.equal(res.status, 200); // fail-open
  ctrl.stop();
});

test("fail-open: a failed refresh keeps the last-known-good list", async () => {
  let fail = false;
  const ctrl = ipReputation({
    feeds: [
      {
        name: "flaky",
        async fetch() {
          if (fail) throw new Error("transient");
          return ["10.0.0.0/8"];
        },
      },
    ],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  assert.equal(ctrl.has("10.1.1.1"), true);

  fail = true;
  await ctrl.refresh(); // fails, but must not clear the list
  assert.equal(ctrl.has("10.1.1.1"), true);
  assert.equal(ctrl.size, 1);
  ctrl.stop();
});

// ---------- refresh picks up new entries ----------

test("manual refresh picks up new entries", async () => {
  let entries: string[] = ["10.0.0.0/8"];
  const ctrl = ipReputation({
    feeds: [
      {
        name: "dynamic",
        async fetch() {
          return entries;
        },
      },
    ],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  assert.equal(ctrl.has("192.168.1.1"), false);

  entries = ["10.0.0.0/8", "192.168.0.0/16"];
  await ctrl.refresh();
  assert.equal(ctrl.has("192.168.1.1"), true);
  ctrl.stop();
});

test("loadOnStart: false defers the first load", async () => {
  const feed = staticFeed("deny", ["10.0.0.0/8"]);
  const ctrl = ipReputation({
    feeds: [feed],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
    loadOnStart: false,
  });
  await ctrl.ready;
  assert.equal(feed.calls, 0);
  assert.equal(ctrl.size, 0);
  await ctrl.refresh();
  assert.equal(feed.calls, 1);
  assert.equal(ctrl.size, 1);
  ctrl.stop();
});

// ---------- junk lines + IPv6 ----------

test("skips malformed entries but keeps valid ones (incl. IPv6)", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("mixed", ["not-an-ip", "2001:db8::/32", "10.0.0.0/8"])],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  assert.equal(ctrl.size, 2);
  assert.equal(ctrl.has("2001:db8::1"), true);
  assert.equal(ctrl.has("10.5.5.5"), true);
  assert.equal(ctrl.has("2001:dead::1"), false);
  ctrl.stop();
});

// ---------- custom resolveIp ----------

test("custom resolveIp overrides header parsing", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["10.0.0.0/8"])],
    resolveIp: () => "10.7.7.7",
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  const app = appWith(ctrl);
  const res = await app.fetch(req()); // no headers, resolver forces a listed IP
  assert.equal(res.status, 403);
  ctrl.stop();
});

test("default resolver fails open (no IP source configured)", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["10.0.0.0/8"])],
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  const app = appWith(ctrl);
  // Default resolver ignores proxy headers and this request carries no TCP
  // peer, so a listed X-Forwarded-For value is not believed.
  const res = await app.fetch(req("10.0.0.1"));
  assert.equal(res.status, 200);
  ctrl.stop();
});

test("stop() is idempotent", async () => {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", [])],
    refreshIntervalMs: 50,
  });
  await ctrl.ready;
  ctrl.stop();
  ctrl.stop();
  assert.ok(true);
});

// ---------- urlFeed ----------

test("urlFeed parses newline + Spamhaus-DROP-style lists, skips comments", async () => {
  const body = [
    "; Spamhaus DROP List",
    "# a comment",
    "203.0.113.0/24 ; SBL123",
    "198.51.100.0/24",
    "",
    "// trailing comment style",
    "10.0.0.0/8",
  ].join("\n");
  const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const feed = urlFeed("https://example.test/drop.txt", {
    name: "drop",
    fetchImpl,
  });
  const entries = await feed.fetch();
  assert.deepEqual(entries, ["203.0.113.0/24", "198.51.100.0/24", "10.0.0.0/8"]);
  assert.equal(feed.name, "drop");
});

test("urlFeed throws on a non-OK response", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  const feed = urlFeed("https://example.test/drop.txt", { fetchImpl });
  await assert.rejects(() => feed.fetch(), /responded 503/);
});

test("urlFeed wired through ipReputation blocks listed IPs", async () => {
  const fetchImpl = (async () =>
    new Response("203.0.113.0/24\n", { status: 200 })) as unknown as typeof fetch;
  const ctrl = ipReputation({
    feeds: [urlFeed("https://example.test/list.txt", { fetchImpl })],
    trustProxyHeaders: true,
    refreshIntervalMs: 0,
  });
  await ctrl.ready;
  const app = appWith(ctrl);
  const res = await app.fetch(req("203.0.113.50"));
  assert.equal(res.status, 403);
  ctrl.stop();
});

test("urlFeed defaults its name to the URL", () => {
  const feed = urlFeed("https://example.test/x.txt", {
    fetchImpl: (async () => new Response("")) as unknown as typeof fetch,
  });
  assert.equal(feed.name, "https://example.test/x.txt");
});

test("urlFeed defaults to an SSRF-hardened fetch that blocks cloud metadata", async () => {
  // No fetchImpl -> must route through fetchGuard(), whose deny floor refuses
  // the AWS/GCP/Azure metadata IP before any network call.
  const feed = urlFeed("http://169.254.169.254/latest/meta-data/");
  await assert.rejects(() => feed.fetch(new AbortController().signal), /SSRF blocked/);
});

// ---------- unresolved identity falls back to the peer (audit run-2, 2026-11-05) ----------

const LISTED = "198.51.100.7";
const CLEAN = "203.0.113.9";

function peerReq(peer: string | undefined, xff?: string): Request {
  const r = new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
  if (peer) setConnInfo(r, { remoteAddress: peer });
  return r;
}

async function guarded(
  opts: Partial<Parameters<typeof ipReputation>[0]>,
  appOpts: ConstructorParameters<typeof App>[0] = {}
) {
  const ctrl = ipReputation({
    feeds: [staticFeed("deny", ["198.51.100.0/24"])],
    refreshIntervalMs: 0,
    ...opts,
  });
  await ctrl.ready;
  const app = new App({ env: "development", ...appOpts });
  app.use(ctrl.hooks);
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return { ctrl, app };
}

test("no trust options: a listed TCP peer is blocked", async () => {
  const { ctrl, app } = await guarded({});
  assert.equal((await app.fetch(peerReq(LISTED))).status, 403);
  assert.equal((await app.fetch(peerReq(CLEAN))).status, 200);
  ctrl.stop();
});

test("no trust options: a spoofed X-Forwarded-For cannot frame or launder the peer", async () => {
  const { ctrl, app } = await guarded({});
  // Clean peer claiming a listed IP is not blocked; listed peer claiming a clean IP is.
  assert.equal((await app.fetch(peerReq(CLEAN, LISTED))).status, 200);
  assert.equal((await app.fetch(peerReq(LISTED, CLEAN))).status, 403);
  ctrl.stop();
});

test("no trust options: follows app({ behindProxy: { cidrs } })", async () => {
  const { ctrl, app } = await guarded({}, { behindProxy: { cidrs: ["10.0.0.0/8"] } });
  assert.equal((await app.fetch(peerReq("10.1.1.1", LISTED))).status, 403);
  assert.equal((await app.fetch(peerReq("10.1.1.1", CLEAN))).status, 200);
  // A direct caller outside the proxy range is checked by its peer, XFF ignored.
  assert.equal((await app.fetch(peerReq(LISTED, CLEAN))).status, 403);
  ctrl.stop();
});

test("explicit trustProxyHeaders: false keeps the peer and ignores behindProxy", async () => {
  const { ctrl, app } = await guarded(
    { trustProxyHeaders: false },
    { behindProxy: { cidrs: ["10.0.0.0/8"] } }
  );
  assert.equal((await app.fetch(peerReq("10.1.1.1", LISTED))).status, 200);
  assert.equal((await app.fetch(peerReq(LISTED))).status, 403);
  ctrl.stop();
});

test("trustedProxies: a listed client going direct-to-origin is blocked by its peer", async () => {
  const { ctrl, app } = await guarded({ trustedProxies: ["10.0.0.0/8"] });
  assert.equal((await app.fetch(peerReq(LISTED, CLEAN))).status, 403);
  // Through the trusted proxy the forwarded identity still decides.
  assert.equal((await app.fetch(peerReq("10.1.1.1", LISTED))).status, 403);
  assert.equal((await app.fetch(peerReq("10.1.1.1", CLEAN))).status, 200);
  ctrl.stop();
});

test("trustedHops: a chain shorter than declared falls back to the peer", async () => {
  const { ctrl, app } = await guarded({ trustedHops: 2 });
  assert.equal((await app.fetch(peerReq(LISTED))).status, 403);
  assert.equal((await app.fetch(peerReq(CLEAN))).status, 200);
  ctrl.stop();
});

test("onUnresolvedIp: 'allow' restores the unchecked pass-through", async () => {
  const { ctrl, app } = await guarded({ trustedProxies: ["10.0.0.0/8"], onUnresolvedIp: "allow" });
  assert.equal((await app.fetch(peerReq(LISTED, CLEAN))).status, 200);
  ctrl.stop();
});

test("ipReputation() rejects an invalid onUnresolvedIp", () => {
  assert.throws(
    () =>
      ipReputation({
        feeds: [staticFeed("f", [])],
        refreshIntervalMs: 0,
        onUnresolvedIp: "skip" as never,
      }),
    /onUnresolvedIp/
  );
});

test("a custom resolveIp still overrides the peer fallback", async () => {
  const { ctrl, app } = await guarded({ resolveIp: () => undefined });
  assert.equal((await app.fetch(peerReq(LISTED))).status, 200);
  ctrl.stop();
});

// ---------- urlFeed headers never follow a cross-origin redirect (audit run-2) ----------

function redirectingFetch(seen: Array<[string, string | null, string | null]>) {
  return (async (input: RequestInfo | URL) => {
    const r = input as Request;
    seen.push([r.url, r.headers.get("x-api-key"), r.headers.get("x-feed-version")]);
    if (r.url === "https://feed.example/list") {
      return new Response(null, { status: 302, headers: { location: "https://other.example/x" } });
    }
    if (r.url === "https://feed.example/same") {
      return new Response(null, { status: 302, headers: { location: "https://feed.example/list2" } });
    }
    return new Response("198.51.100.0/24\n");
  }) as typeof fetch;
}

const publicResolve = async () => ["93.184.216.34"];

test("urlFeed strips its custom headers on a cross-origin redirect", async () => {
  const seen: Array<[string, string | null, string | null]> = [];
  const feed = urlFeed("https://feed.example/list", {
    headers: { "x-api-key": "feed-token", "x-feed-version": "2" },
    guard: { fetch: redirectingFetch(seen), resolve: publicResolve, pinDns: false },
  });
  assert.deepEqual(await feed.fetch(), ["198.51.100.0/24"]);
  assert.deepEqual(seen, [
    ["https://feed.example/list", "feed-token", "2"],
    ["https://other.example/x", null, null],
  ]);
});

test("urlFeed keeps its headers on a same-origin redirect", async () => {
  const seen: Array<[string, string | null, string | null]> = [];
  const feed = urlFeed("https://feed.example/same", {
    headers: { "x-api-key": "feed-token" },
    guard: { fetch: redirectingFetch(seen), resolve: publicResolve, pinDns: false },
  });
  await feed.fetch();
  assert.deepEqual(seen[1], ["https://feed.example/list2", "feed-token", null]);
});

test("urlFeed guard options cannot drop the header strip or re-allow metadata", async () => {
  const seen: Array<[string, string | null, string | null]> = [];
  const feed = urlFeed("https://feed.example/list", {
    headers: { "x-api-key": "feed-token" },
    guard: {
      fetch: redirectingFetch(seen),
      resolve: publicResolve,
      pinDns: false,
      sensitiveHeaders: [],
    },
  });
  await feed.fetch();
  assert.equal(seen[1]![1], null);
  const meta = urlFeed("http://169.254.169.254/latest", { guard: { pinDns: false } });
  await assert.rejects(() => meta.fetch());
});
