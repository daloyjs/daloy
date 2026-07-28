/**
 * Regression tests for the spoof-resistant forwarded-header client-IP
 * resolution (the live red-team findings fixed in 1.0.0-rc.7):
 *
 *  - Finding 1 (high): `autoBan` strikes never accumulated when an attacker
 *    rotated a spoofed leftmost `X-Forwarded-For` entry — unlimited brute
 *    force (cure53 EXP-23-005 class).
 *  - Finding 2 (medium): an attacker could get an arbitrary victim IP banned
 *    by spoofing it in the leftmost entry (cure53 P11-02-005 class).
 *
 * Root cause: every `trustProxyHeaders` resolver read the LEFTMOST XFF entry
 * (`split(",")[0]`) — the most attacker-controllable slot in the header. The
 * fix reads a declared number of trusted hops from the RIGHT (the slots the
 * operator's own proxy chain appended) via `resolveForwardedClientIp`, across
 * `autoBan`, `rateLimit`, `loginThrottle`, `concurrencyLimit`, `geoBlock`,
 * `ipRestriction`, `ipReputation`, `botGuard`, and `resolveClientIp`
 * (`behindProxy: "loopback"`).
 *
 * Test model: an append-mode proxy deployment, where the attacker's direct
 * input occupies the LEFT of the header and the proxy's appended (real)
 * client IP is the rightmost entry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  autoBan,
  _resetAutoBanStoresForTests,
  botGuard,
  concurrencyLimit,
  geoBlock,
  ipRestriction,
  ipReputation,
  loginThrottle,
  rateLimit,
  _resetSharedRateLimitStoresForTests,
  resolveClientIp,
  resolveForwardedClientIp,
  setConnInfo,
  assertTrustedHops,
  UnauthorizedError,
} from "../src/index.js";

// ---------- unit: resolveForwardedClientIp / assertTrustedHops ----------

test("resolveForwardedClientIp reads the rightmost entry by default", () => {
  const req = new Request("http://t/", {
    headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" },
  });
  assert.equal(resolveForwardedClientIp(req), "203.0.113.7");
});

test("resolveForwardedClientIp walks N trusted hops from the right", () => {
  const req = new Request("http://t/", {
    headers: { "x-forwarded-for": "spoofed, client, cdn, lb" },
  });
  assert.equal(resolveForwardedClientIp(req, 1), "lb");
  assert.equal(resolveForwardedClientIp(req, 2), "cdn");
  assert.equal(resolveForwardedClientIp(req, 3), "client");
  // Chain shorter than the declared hops: never honor attacker-side entries;
  // X-Real-IP is the (equally proxy-trust-gated) fallback.
  assert.equal(resolveForwardedClientIp(req, 9), undefined);
  const withRealIp = new Request("http://t/", {
    headers: { "x-forwarded-for": "a, b", "x-real-ip": "10.9.9.9" },
  });
  assert.equal(resolveForwardedClientIp(withRealIp, 5), "10.9.9.9");
});

test("assertTrustedHops validates the [1, 64] integer range", () => {
  assert.throws(() => assertTrustedHops("x()", 0), /trustedHops must be an integer in \[1, 64\]/);
  assert.throws(() => assertTrustedHops("x()", 65), /trustedHops/);
  assert.throws(() => assertTrustedHops("x()", 1.5), /trustedHops/);
  assert.doesNotThrow(() => assertTrustedHops("x()", undefined));
  assert.doesNotThrow(() => assertTrustedHops("x()", 1));
  assert.doesNotThrow(() => assertTrustedHops("x()", 64));
});

test('resolveClientIp "loopback" reads the proxy-appended rightmost slot, not a spoofed leftmost one', () => {
  const req = new Request("http://t/", {
    headers: { "x-forwarded-for": "203.0.113.66, 198.51.100.2" },
  });
  setConnInfo(req, { remoteAddress: "127.0.0.1" });
  // Attacker claimed 203.0.113.66; the same-host proxy observed 198.51.100.2.
  assert.equal(resolveClientIp(req, "loopback"), "198.51.100.2");
});

// ---------- helpers ----------

function banApp(opts: Parameters<typeof autoBan>[0]): App {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "development" });
  app.use(autoBan(opts));
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });
  app.route({
    method: "GET",
    path: "/ok",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

/** Simulate an append-mode proxy: attacker input on the left, observed client IP appended right. */
function viaProxy(path: string, attackerInput: string, observedClientIp: string): Request {
  return new Request(`http://x${path}`, {
    headers: { "x-forwarded-for": `${attackerInput}, ${observedClientIp}` },
  });
}

// ---------- Finding 1 regression: strike evasion by rotating spoofed XFF ----------

test("[unhappy] autoBan: rotating a spoofed leftmost XFF entry no longer evades strike accumulation", async () => {
  const app = banApp({ trustProxyHeaders: true, maxStrikes: 3, windowMs: 60_000, banMs: 10_000 });
  // Every attempt spoofs a fresh leftmost entry; the proxy-observed IP is constant.
  for (let i = 0; i < 3; i++) {
    const r = await app.fetch(viaProxy("/fail", `198.51.100.${i}`, "203.0.113.5"));
    assert.equal(r.status, 401);
  }
  // Under the old leftmost read each attempt keyed a fresh bucket and no ban
  // ever fired. Now the rightmost (real) client accumulates the strikes.
  const banned = await app.fetch(viaProxy("/ok", "198.51.100.99", "203.0.113.5"));
  assert.equal(banned.status, 429, "the real client IP must accumulate strikes regardless of leftmost spoofing");
});

// ---------- Finding 2 regression: victim-IP banning via spoofed XFF ----------

test("[unhappy] autoBan: a spoofed victim IP at the leftmost slot gets the ATTACKER banned, not the victim", async () => {
  const app = banApp({ trustProxyHeaders: true, maxStrikes: 3, windowMs: 60_000, banMs: 10_000 });
  // Attacker (observed 198.51.100.23) frames victim 203.0.113.99 on every strike.
  for (let i = 0; i < 3; i++) {
    const r = await app.fetch(viaProxy("/fail", "203.0.113.99", "198.51.100.23"));
    assert.equal(r.status, 401);
  }
  // The victim is unaffected…
  const victim = await app.fetch(viaProxy("/ok", "10.1.2.3", "203.0.113.99"));
  assert.equal(victim.status, 200, "the framed victim IP must not be banned");
  // …and the attacker banned themselves.
  const attacker = await app.fetch(viaProxy("/ok", "203.0.113.99", "198.51.100.23"));
  assert.equal(attacker.status, 429, "strikes must land on the attacker, not the spoofed victim");
});

// ---------- trustedHops: multi-hop chains ----------

test("autoBan trustedHops picks the slot the outermost trusted proxy wrote", async () => {
  const app = banApp({ trustedHops: 2, maxStrikes: 2, windowMs: 60_000, banMs: 10_000 });
  // Chain: [attacker-junk, real-client, inner-lb] — two trusted hops.
  const chain = (path: string, junk: string, client: string) =>
    new Request(`http://x${path}`, {
      headers: { "x-forwarded-for": `${junk}, ${client}, 10.0.0.2` },
    });
  assert.equal((await app.fetch(chain("/fail", "1.1.1.1", "203.0.113.5"))).status, 401);
  assert.equal((await app.fetch(chain("/fail", "2.2.2.2", "203.0.113.5"))).status, 401);
  assert.equal(
    (await app.fetch(chain("/ok", "3.3.3.3", "203.0.113.5"))).status,
    429,
    "rotation of attacker-prepended entries must not evade the ban"
  );
});

test("autoBan trustedHops alone satisfies the identity-source requirement", () => {
  assert.doesNotThrow(() => autoBan({ trustedHops: 1 }));
});

test("trustedHops is validated at construction across all middlewares", () => {
  assert.throws(() => autoBan({ trustedHops: 0 }), /trustedHops/);
  assert.throws(() => rateLimit({ windowMs: 1000, max: 1, trustedHops: 1.5 }), /trustedHops/);
  assert.throws(() => loginThrottle({ trustedHops: 65 }), /trustedHops/);
  assert.throws(
    () => concurrencyLimit({ maxConcurrent: 1, scope: "client", trustedHops: 0 }),
    /trustedHops/
  );
  assert.throws(
    () => geoBlock({ deny: ["ZZ"], lookupCountry: () => "US", trustedHops: -1 }),
    /trustedHops/
  );
  assert.throws(() => ipRestriction({ allow: ["10.0.0.0/8"], trustedHops: 0 }), /trustedHops/);
  assert.throws(
    () => ipReputation({ feeds: [{ name: "t", fetch: async () => [] }], trustedHops: 0 }),
    /trustedHops/
  );
  assert.throws(() => botGuard({ trustedHops: 0 }), /trustedHops/);
});

// ---------- rateLimit / loginThrottle: same evasion class ----------

test("[unhappy] rateLimit: rotating a spoofed leftmost XFF entry no longer resets the bucket", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.use(rateLimit({ windowMs: 60_000, max: 2, trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(viaProxy("/x", "1.1.1.1", "203.0.113.5"))).status, 200);
  assert.equal((await app.fetch(viaProxy("/x", "2.2.2.2", "203.0.113.5"))).status, 200);
  assert.equal(
    (await app.fetch(viaProxy("/x", "3.3.3.3", "203.0.113.5"))).status,
    429,
    "the real client shares one bucket no matter how the left side rotates"
  );
});

test("rateLimit trustedHops: 2 derives the key from the correct slot", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.use(rateLimit({ windowMs: 60_000, max: 1, trustedHops: 2 }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const chain = (junk: string, client: string) =>
    new Request("http://x/x", { headers: { "x-forwarded-for": `${junk}, ${client}, 10.0.0.2` } });
  assert.equal((await app.fetch(chain("1.1.1.1", "203.0.113.5"))).status, 200);
  assert.equal((await app.fetch(chain("9.9.9.9", "203.0.113.5"))).status, 429);
  // A genuinely different client still gets its own bucket.
  assert.equal((await app.fetch(chain("9.9.9.9", "203.0.113.6"))).status, 200);
});

// ---------- geoBlock / ipRestriction / ipReputation: spoofed-IP bypass class ----------

test("[unhappy] geoBlock: a spoofed leftmost XFF no longer dodges a denied country", async () => {
  const app = new App({ env: "development" });
  app.use(
    geoBlock({
      deny: ["ZZ"],
      trustProxyHeaders: true,
      lookupCountry: (ip) => ({ "203.0.113.7": "ZZ", "198.51.100.7": "US" })[ip],
    })
  );
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // The denied client (ZZ) spoofs an allowed US IP at the leftmost slot.
  const spoofed = await app.fetch(viaProxy("/x", "198.51.100.7", "203.0.113.7"));
  assert.equal(spoofed.status, 403, "geo decision must use the proxy-observed IP, not the spoofed one");
  // And a genuine allowed client still passes.
  const legit = await app.fetch(viaProxy("/x", "1.2.3.4", "198.51.100.7"));
  assert.equal(legit.status, 200);
});

test("[unhappy] ipRestriction: a spoofed leftmost XFF no longer bypasses the allow-list", async () => {
  const app = new App({ env: "development" });
  app.use(ipRestriction({ allow: ["10.0.0.0/8"], trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // Outsider claims an internal 10.x address on the left; proxy observed 203.0.113.9.
  const spoofed = await app.fetch(viaProxy("/x", "10.1.2.3", "203.0.113.9"));
  assert.equal(spoofed.status, 403, "allow-list must be evaluated on the proxy-observed IP");
  const insider = await app.fetch(viaProxy("/x", "1.2.3.4", "10.1.2.3"));
  assert.equal(insider.status, 200);
});

test("[unhappy] ipReputation: the denylist matches the proxy-observed IP, not a spoofed left entry", async () => {
  const rep = ipReputation({
    feeds: [{ name: "static", fetch: async () => ["203.0.113.7"] }],
    trustProxyHeaders: true,
  });
  await rep.ready;
  const app = new App({ env: "development" });
  app.use(rep.hooks);
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // Listed IP spoofs a clean one on the left.
  const spoofed = await app.fetch(viaProxy("/x", "8.8.8.8", "203.0.113.7"));
  assert.equal(spoofed.status, 403, "denylist must match the proxy-observed IP");
  rep.stop();
});

// ---------- botGuard / concurrencyLimit: option wiring ----------

test("botGuard trustedHops resolves the proxy-observed IP for verification", async () => {
  // A resolver that records which IP it was asked about.
  const seen: string[] = [];
  const app = new App({ env: "development" });
  app.use(
    botGuard({
      trustedHops: 2,
      verifiedBots: [{ name: "TestBot", userAgent: /testbot/i, domains: [".bot.example"] }],
      resolver: {
        reverse: async (ip: string) => {
          seen.push(ip);
          return [];
        },
        forward: async () => [],
      },
    })
  );
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const req = new Request("http://x/x", {
    headers: {
      "user-agent": "TestBot/1.0",
      "x-forwarded-for": "198.51.100.9, 203.0.113.7, 10.0.0.2",
    },
  });
  await app.fetch(req);
  assert.deepEqual(seen, ["203.0.113.7"], "verification must run on the IP two trusted hops back");
});

test("concurrencyLimit scope client with trustedHops buckets on the proxy-observed IP", async () => {
  const app = new App({ env: "development" });
  app.use(
    concurrencyLimit({ maxConcurrent: 1, maxQueue: 0, scope: "client", trustedHops: 1 })
  );
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200 as const, body: { ok: true } };
    },
  });
  // Two concurrent requests with different spoofed left entries but the same
  // proxy-observed IP must contend for ONE bucket.
  const [a, b] = await Promise.all([
    app.fetch(viaProxy("/slow", "1.1.1.1", "203.0.113.5")),
    app.fetch(viaProxy("/slow", "2.2.2.2", "203.0.113.5")),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 503], "same real client → one slot, one 503");
});

test("[unhappy] concurrencyLimit scope client accepts trustedHops as the identity source", () => {
  assert.doesNotThrow(() =>
    concurrencyLimit({ maxConcurrent: 1, scope: "client", trustedHops: 1 })
  );
});

// ---------- loginThrottle ----------

test("[unhappy] loginThrottle: rotating a spoofed leftmost XFF entry no longer resets the slowdown budget", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  const throttle = loginThrottle({ max: 3, trustProxyHeaders: true });
  app.route({
    method: "GET",
    path: "/login",
    operationId: "login",
    hooks: throttle,
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(viaProxy("/login", "1.1.1.1", "203.0.113.5"))).status, 200);
  assert.equal((await app.fetch(viaProxy("/login", "2.2.2.2", "203.0.113.5"))).status, 200);
  assert.equal((await app.fetch(viaProxy("/login", "3.3.3.3", "203.0.113.5"))).status, 200);
  assert.equal(
    (await app.fetch(viaProxy("/login", "4.4.4.4", "203.0.113.5"))).status,
    429,
    "the real client must hit the hard limit despite left-side rotation"
  );
});
