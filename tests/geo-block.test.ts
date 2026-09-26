import { test } from "node:test";
import assert from "node:assert/strict";
import { App, geoBlock, setConnInfo, type GeoBlockDecision } from "../src/index.js";

// ---------- helpers ----------

/** App with a `geoBlock()` guard plus a single `/` route returning 200. */
function appWith(
  hooks: ReturnType<typeof geoBlock>,
  onState?: (state: Record<string, unknown>) => void
): App {
  const app = new App({ env: "development" });
  app.use(hooks);
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => {
      onState?.(ctx.state as Record<string, unknown>);
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return app;
}

function req(ip?: string, country?: string): Request {
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = ip;
  if (country) headers["cf-ipcountry"] = country;
  return new Request("http://x/", { headers });
}

// ---------- construction validation (unhappy) ----------

test("geoBlock() requires at least one of allow or deny", () => {
  assert.throws(() => geoBlock({ lookupCountry: () => "US" }), /at least one of/);
});

test("geoBlock() requires exactly one resolution strategy (neither)", () => {
  assert.throws(() => geoBlock({ deny: ["KP"] }), /exactly one of/);
});

test("geoBlock() requires exactly one resolution strategy (both)", () => {
  assert.throws(
    () =>
      geoBlock({
        deny: ["KP"],
        lookupCountry: () => "US",
        resolveCountry: () => "US",
      }),
    /exactly one of/
  );
});

test("geoBlock() rejects an invalid mode", () => {
  assert.throws(
    () =>
      geoBlock({
        deny: ["KP"],
        lookupCountry: () => "US",
        // @ts-expect-error intentionally invalid
        mode: "warn",
      }),
    /invalid mode/
  );
});

test("geoBlock() rejects a malformed country code", () => {
  assert.throws(
    () => geoBlock({ allow: ["USA"], resolveCountry: () => "US" }),
    /invalid country code/
  );
});

// ---------- deny list (happy + unhappy) ----------

test("deny list blocks a listed country and allows others", async () => {
  const app = appWith(
    geoBlock({ deny: ["KP", "IR"], resolveCountry: (c) => c.request.headers.get("cf-ipcountry") })
  );

  const blocked = await app.fetch(req(undefined, "KP"));
  assert.equal(blocked.status, 403);

  const allowed = await app.fetch(req(undefined, "US"));
  assert.equal(allowed.status, 200);
});

test("deny match is case-insensitive", async () => {
  const app = appWith(geoBlock({ deny: ["kp"], resolveCountry: () => "Kp" }));
  const res = await app.fetch(req());
  assert.equal(res.status, 403);
});

// ---------- allow list (happy + unhappy) ----------

test("allow list permits only listed countries", async () => {
  const app = appWith(
    geoBlock({
      allow: ["US", "CA", "GB"],
      resolveCountry: (c) => c.request.headers.get("cf-ipcountry"),
    })
  );

  assert.equal((await app.fetch(req(undefined, "US"))).status, 200);
  assert.equal((await app.fetch(req(undefined, "FR"))).status, 403);
});

test("deny wins over allow on conflict", async () => {
  const app = appWith(geoBlock({ allow: ["US"], deny: ["US"], resolveCountry: () => "US" }));
  assert.equal((await app.fetch(req())).status, 403);
});

// ---------- unknown country handling ----------

test("allow list fails closed on an unknown country", async () => {
  const app = appWith(geoBlock({ allow: ["US"], resolveCountry: () => undefined }));
  assert.equal((await app.fetch(req())).status, 403);
});

test("deny-only fails open on an unknown country", async () => {
  const app = appWith(geoBlock({ deny: ["KP"], resolveCountry: () => undefined }));
  assert.equal((await app.fetch(req())).status, 200);
});

test("allowUnknownCountry override lets unknowns through an allow list", async () => {
  const app = appWith(
    geoBlock({
      allow: ["US"],
      allowUnknownCountry: true,
      resolveCountry: () => "",
    })
  );
  assert.equal((await app.fetch(req())).status, 200);
});

test("allowUnknownCountry:false blocks unknowns on a deny-only list", async () => {
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      allowUnknownCountry: false,
      resolveCountry: () => null,
    })
  );
  assert.equal((await app.fetch(req())).status, 403);
});

// ---------- lookupCountry (IP-based) ----------

test("lookupCountry maps the forwarded IP to a country", async () => {
  const table: Record<string, string> = { "203.0.113.7": "KP", "8.8.8.8": "US" };
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      trustProxyHeaders: true,
      lookupCountry: (ip) => table[ip],
    })
  );
  assert.equal((await app.fetch(req("203.0.113.7"))).status, 403);
  assert.equal((await app.fetch(req("8.8.8.8"))).status, 200);
});

test("lookupCountry fails closed when no IP can be resolved (default resolver)", async () => {
  // No trustProxyHeaders + no custom resolveIp => IP is undefined => unknown.
  const app = appWith(geoBlock({ allow: ["US"], lookupCountry: () => "US" }));
  // allow-list + unknown country (no IP) => blocked.
  assert.equal((await app.fetch(req("8.8.8.8"))).status, 403);
});

test("custom resolveIp overrides the default IP source", async () => {
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      resolveIp: () => "203.0.113.7",
      lookupCountry: (ip) => (ip === "203.0.113.7" ? "KP" : "US"),
    })
  );
  assert.equal((await app.fetch(req())).status, 403);
});

test("async lookupCountry is awaited", async () => {
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      trustProxyHeaders: true,
      lookupCountry: async (ip) => (ip === "203.0.113.7" ? "KP" : "US"),
    })
  );
  assert.equal((await app.fetch(req("203.0.113.7"))).status, 403);
});

// ---------- log mode + onBlock ----------

test('mode "log" lets blocked requests through but reports them', async () => {
  const seen: GeoBlockDecision[] = [];
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      mode: "log",
      resolveCountry: () => "KP",
      onBlock: (d) => seen.push(d),
    })
  );
  const res = await app.fetch(req());
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.reason, "denied_country");
  assert.equal(seen[0]!.country, "KP");
});

test("onBlock reports not_in_allowlist with the resolved country", async () => {
  const seen: GeoBlockDecision[] = [];
  const app = appWith(
    geoBlock({
      allow: ["US"],
      mode: "log",
      resolveCountry: () => "FR",
      onBlock: (d) => seen.push(d),
    })
  );
  await app.fetch(req());
  assert.equal(seen[0]!.reason, "not_in_allowlist");
  assert.equal(seen[0]!.country, "FR");
});

test("onBlock reports unknown_country and the resolved IP", async () => {
  const seen: GeoBlockDecision[] = [];
  const app = appWith(
    geoBlock({
      allow: ["US"],
      mode: "log",
      trustProxyHeaders: true,
      lookupCountry: () => undefined,
      onBlock: (d) => seen.push(d),
    })
  );
  await app.fetch(req("203.0.113.7"));
  assert.equal(seen[0]!.reason, "unknown_country");
  assert.equal(seen[0]!.ip, "203.0.113.7");
  assert.equal(seen[0]!.country, undefined);
});

// ---------- state stamping ----------

test("allowed requests expose the resolved country on ctx.state.geo", async () => {
  let captured: Record<string, unknown> | undefined;
  const app = appWith(geoBlock({ deny: ["KP"], resolveCountry: () => "us" }), (state) => {
    captured = state;
  });
  await app.fetch(req());
  assert.deepEqual(captured!.geo, { country: "US" });
});

test("a custom stateKey is honored", async () => {
  let captured: Record<string, unknown> | undefined;
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      stateKey: "region",
      resolveCountry: () => "CA",
    }),
    (state) => {
      captured = state;
    }
  );
  await app.fetch(req());
  assert.deepEqual(captured!.region, { country: "CA" });
});

test("x-real-ip is used as a fallback when x-forwarded-for is absent", async () => {
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      trustProxyHeaders: true,
      lookupCountry: (ip) => (ip === "203.0.113.9" ? "KP" : "US"),
    })
  );
  const r = new Request("http://x/", {
    headers: { "x-real-ip": "203.0.113.9" },
  });
  assert.equal((await app.fetch(r)).status, 403);
});

// ---------- unresolved forwarded IP falls back to the peer (deepsec 2026-09-26) ----------

function peerReq(peer: string | undefined, xff?: string): Request {
  const r = new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
  if (peer) setConnInfo(r, { remoteAddress: peer });
  return r;
}

const PEER_TABLE: Record<string, string> = { "198.51.100.7": "KP", "203.0.113.9": "US" };
const peerLookup = (ip: string) => PEER_TABLE[ip];

test("deny-only + trustedProxies: direct-to-origin peer in a denied country is blocked", async () => {
  const decisions: GeoBlockDecision[] = [];
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      trustedProxies: ["10.0.0.0/8"],
      lookupCountry: peerLookup,
      onBlock: (d) => decisions.push(d),
    })
  );
  const res = await app.fetch(peerReq("198.51.100.7", "203.0.113.9"));
  assert.equal(res.status, 403);
  assert.equal(decisions[0]?.reason, "denied_country");
  assert.equal(decisions[0]?.ip, "198.51.100.7");
});

test("deny-only + trustedHops: a chain one hop short is looked up by peer and blocked", async () => {
  const app = appWith(geoBlock({ deny: ["KP"], trustedHops: 2, lookupCountry: peerLookup }));
  const res = await app.fetch(peerReq("198.51.100.7", "203.0.113.9"));
  assert.equal(res.status, 403);
});

test("deny-only peer fallback: a peer in an allowed country passes (happy path)", async () => {
  const app = appWith(
    geoBlock({ deny: ["KP"], trustedProxies: ["10.0.0.0/8"], lookupCountry: peerLookup })
  );
  const res = await app.fetch(peerReq("203.0.113.9"));
  assert.equal(res.status, 200);
});

test("trusted proxy chain still resolves the forwarded client (happy path)", async () => {
  const app = appWith(
    geoBlock({ deny: ["KP"], trustedProxies: ["10.0.0.0/8"], lookupCountry: peerLookup })
  );
  assert.equal((await app.fetch(peerReq("10.0.0.1", "203.0.113.9"))).status, 200);
  assert.equal((await app.fetch(peerReq("10.0.0.1", "198.51.100.7"))).status, 403);
});

test("allow-list: a peer-derived allowed country never widens access (stays unknown)", async () => {
  const decisions: GeoBlockDecision[] = [];
  const app = appWith(
    geoBlock({
      allow: ["US"],
      trustedHops: 2,
      lookupCountry: peerLookup,
      onBlock: (d) => decisions.push(d),
    })
  );
  // Chain one hop short; the peer (our own LB in this topology) maps to US.
  const res = await app.fetch(peerReq("203.0.113.9", "198.51.100.7"));
  assert.equal(res.status, 403);
  assert.equal(decisions[0]?.reason, "unknown_country");
});

test("onUnresolvedIp 'unknown' restores the previous deny-only fail-open", async () => {
  const lookups: string[] = [];
  const app = appWith(
    geoBlock({
      deny: ["KP"],
      trustedProxies: ["10.0.0.0/8"],
      onUnresolvedIp: "unknown",
      lookupCountry: (ip) => (lookups.push(ip), peerLookup(ip)),
    })
  );
  const res = await app.fetch(peerReq("198.51.100.7"));
  assert.equal(res.status, 200);
  assert.deepEqual(lookups, []);
});

test("peer-less platform keeps the unknown-country verdict", async () => {
  const app = appWith(geoBlock({ deny: ["KP"], trustedHops: 1, lookupCountry: peerLookup }));
  assert.equal((await app.fetch(peerReq(undefined))).status, 200);
  const strict = appWith(geoBlock({ allow: ["US"], trustedHops: 1, lookupCountry: peerLookup }));
  assert.equal((await strict.fetch(peerReq(undefined))).status, 403);
});

test("geoBlock() rejects an invalid onUnresolvedIp", () => {
  assert.throws(
    () => geoBlock({ deny: ["KP"], lookupCountry: () => "US", onUnresolvedIp: "skip" as never }),
    /onUnresolvedIp/
  );
});
