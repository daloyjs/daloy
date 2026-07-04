import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  ipReputation,
  urlFeed,
  type IpReputationFeed,
  type IpReputationMatch,
} from "../src/index.js";

// ---------- helpers ----------

/** Feed that yields a fixed list, recording how many times it was fetched. */
function staticFeed(name: string, entries: readonly string[]): IpReputationFeed & {
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
    /mode must be/,
  );
});

test("ipReputation() rejects a negative refreshIntervalMs", () => {
  assert.throws(
    () => ipReputation({ feeds: [staticFeed("f", [])], refreshIntervalMs: -1 }),
    /refreshIntervalMs/,
  );
});

test("ipReputation() rejects a non-positive fetchTimeoutMs", () => {
  assert.throws(
    () => ipReputation({ feeds: [staticFeed("f", [])], fetchTimeoutMs: 0 }),
    /fetchTimeoutMs/,
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
  // Default resolver ignores proxy headers, so even a listed IP passes.
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
  const fetchImpl = (async () =>
    new Response(body, { status: 200 })) as unknown as typeof fetch;
  const feed = urlFeed("https://example.test/drop.txt", {
    name: "drop",
    fetchImpl,
  });
  const entries = await feed.fetch();
  assert.deepEqual(entries, ["203.0.113.0/24", "198.51.100.0/24", "10.0.0.0/8"]);
  assert.equal(feed.name, "drop");
});

test("urlFeed throws on a non-OK response", async () => {
  const fetchImpl = (async () =>
    new Response("nope", { status: 503 })) as unknown as typeof fetch;
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
