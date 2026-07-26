import { test } from "node:test";
import assert from "node:assert/strict";
import { App, geoBlock, type GeoBlockDecision } from "../src/index.js";

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
