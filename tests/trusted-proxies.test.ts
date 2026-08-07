/**
 * Regression tests for `trustedProxies` — peer-verified forwarded-header
 * trust (the wave-5 live red-team findings: victim-IP framing and ban/limit
 * evasion via spoofed `X-Forwarded-For` when the origin is directly
 * reachable).
 *
 * Root cause: `trustProxyHeaders` / `trustedHops` answer "how many proxies
 * are in front of me" but never "is the socket talking to me one of MY
 * proxies". A direct-to-origin attacker could therefore claim any forwarded
 * identity. The fix verifies the immediate TCP peer — the one property a
 * remote client cannot spoof — against a declared CIDR allowlist before any
 * forwarded header is read, across `autoBan`, `rateLimit`, `loginThrottle`,
 * `concurrencyLimit`, `geoBlock`, `ipRestriction`, `ipReputation`,
 * `botGuard`, and the app-level `behindProxy: { cidrs }` resolver.
 *
 * Test model: requests are tagged with `setConnInfo` to simulate the peer
 * the adapter observed. "Attacker" peers sit OUTSIDE the declared proxy
 * CIDRs (direct-to-origin); "proxy" peers sit inside.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  autoBan,
  _resetAutoBanStoresForTests,
  geoBlock,
  rateLimit,
  _resetSharedRateLimitStoresForTests,
  resolveClientIp,
  resolveForwardedClientIp,
  setConnInfo,
  UnauthorizedError,
} from "../src/index.js";
// Internal: the trust-policy resolvers are deliberately not part of the
// public barrel, so they are imported from their module.
import {
  assertBehindProxy,
  resolveForwardedTrust,
  resolveTrustedProxyMatchers,
} from "../src/conn-info.js";

// ---------- unit: option resolution ----------

test("resolveForwardedTrust: trustedProxies alone implies one trusted hop", () => {
  assert.equal(resolveForwardedTrust("x()", { trustedProxies: ["10.0.0.0/8"] }), 1);
  assert.equal(resolveForwardedTrust("x()", { trustedProxies: ["10.0.0.0/8"], trustedHops: 3 }), 3);
});

test("[unhappy] resolveForwardedTrust rejects trustProxyHeaders: false alongside trustedProxies", () => {
  assert.throws(
    () =>
      resolveForwardedTrust("x()", { trustProxyHeaders: false, trustedProxies: ["10.0.0.0/8"] }),
    /trustProxyHeaders: false contradicts trustedProxies/
  );
});

test("resolveTrustedProxyMatchers compiles a valid allowlist", () => {
  assert.equal(resolveTrustedProxyMatchers("x()", {}), undefined);
  const matchers = resolveTrustedProxyMatchers("x()", {
    trustedProxies: ["10.0.0.0/8", "203.0.113.10", "::1"],
  });
  assert.equal(matchers?.length, 3);
});

test("[unhappy] resolveTrustedProxyMatchers refuses empty and malformed lists at construction", () => {
  assert.throws(() => resolveTrustedProxyMatchers("x()", { trustedProxies: [] }), /non-empty/);
  assert.throws(
    () => resolveTrustedProxyMatchers("x()", { trustedProxies: [""] }),
    /non-empty strings/
  );
  assert.throws(
    () => resolveTrustedProxyMatchers("autoBan()", { trustedProxies: ["999.1.1.1"] }),
    /autoBan\(\): trustedProxies — invalid IP\/CIDR entry "999\.1\.1\.1"/
  );
  assert.throws(
    () => resolveTrustedProxyMatchers("x()", { trustedProxies: ["10.0.0.0/33"] }),
    /invalid IP\/CIDR/
  );
});

// ---------- unit: resolveForwardedClientIp peer verification ----------

const PROXIES = resolveTrustedProxyMatchers("test()", { trustedProxies: ["10.0.0.0/8"] })!;

function tagged(url: string, peer: string | undefined, xff?: string): Request {
  const req = new Request(url, xff ? { headers: { "x-forwarded-for": xff } } : undefined);
  if (peer !== undefined) setConnInfo(req, { remoteAddress: peer });
  return req;
}

test("trusted peer: the forwarded identity is honoured", () => {
  const req = tagged("http://t/", "10.0.0.7", "198.51.100.9, 203.0.113.7");
  assert.equal(resolveForwardedClientIp(req, 1, PROXIES), "203.0.113.7");
});

test("[unhappy] untrusted peer: a spoofed XFF claims nothing — resolution returns no identity", () => {
  // Direct-to-origin attacker (peer 203.0.113.9, outside 10.0.0.0/8) claiming
  // a victim's address. This is the framing/evasion root cause: before peer
  // verification, the header was believed.
  const req = tagged("http://t/", "203.0.113.9", "198.51.100.23");
  assert.equal(resolveForwardedClientIp(req, 1, PROXIES), undefined);
});

test("[unhappy] peer verification fails closed with no conn metadata or an unparseable peer", () => {
  // Edge runtimes attach no peer socket: the safe answer is "no identity".
  assert.equal(
    resolveForwardedClientIp(tagged("http://t/", undefined, "1.2.3.4"), 1, PROXIES),
    undefined
  );
  assert.equal(
    resolveForwardedClientIp(tagged("http://t/", "not-an-ip", "1.2.3.4"), 1, PROXIES),
    undefined
  );
});

test("trustedProxies honours IPv6 proxy peers", () => {
  const v6 = resolveTrustedProxyMatchers("test()", { trustedProxies: ["2001:db8::/32"] })!;
  const trusted = tagged("http://t/", "2001:db8::1", "198.51.100.9");
  assert.equal(resolveForwardedClientIp(trusted, 1, v6), "198.51.100.9");
  const untrusted = tagged("http://t/", "2001:db9::1", "198.51.100.9");
  assert.equal(resolveForwardedClientIp(untrusted, 1, v6), undefined);
});

test("trustedProxies honours IPv4-mapped IPv6 peers against an IPv4 CIDR", () => {
  // Node dual-stack sockets often report remoteAddress as ::ffff:a.b.c.d.
  // Without family normalization the allowlist would fail closed forever.
  const req = tagged("http://t/", "::ffff:10.0.0.5", "198.51.100.9");
  assert.equal(resolveForwardedClientIp(req, 1, PROXIES), "198.51.100.9");
  const outsider = tagged("http://t/", "::ffff:203.0.113.9", "198.51.100.9");
  assert.equal(resolveForwardedClientIp(outsider, 1, PROXIES), undefined);
  // Same posture on the app-level behindProxy { cidrs } path.
  const cfg = { cidrs: ["10.0.0.0/8"] } as const;
  assertBehindProxy(cfg);
  assert.equal(resolveClientIp(req, cfg), "198.51.100.9");
  assert.equal(resolveClientIp(outsider, cfg), "::ffff:203.0.113.9");
});

test("[unhappy] resolveClientIp { cidrs } fails closed on unvalidated invalid CIDRs", () => {
  // App construction refuses this via assertBehindProxy; the exported
  // resolver must still never honour XFF when compilation fails.
  const cfg = { cidrs: ["not-a-cidr"] } as const;
  const req = tagged("http://t/", "10.0.0.1", "198.51.100.9");
  assert.equal(resolveClientIp(req, cfg), "10.0.0.1");
});

// ---------- unit: behindProxy { cidrs } (the previously stubbed branch) ----------

test("resolveClientIp { cidrs }: a verified proxy peer's XFF is honoured; a direct caller's is ignored", () => {
  const cfg = { cidrs: ["10.0.0.0/8"] } as const;
  assertBehindProxy(cfg);
  const viaProxy = tagged("http://t/", "10.0.0.7", "203.0.113.99, 198.51.100.2");
  assert.equal(resolveClientIp(viaProxy, cfg), "198.51.100.2");
  const direct = tagged("http://t/", "203.0.113.9", "198.51.100.23");
  // Spoofed XFF ignored — the attacker gets their REAL peer identity.
  assert.equal(resolveClientIp(direct, cfg), "203.0.113.9");
  const directNoXff = tagged("http://t/", "203.0.113.9");
  assert.equal(resolveClientIp(directNoXff, cfg), "203.0.113.9");
});

test("[unhappy] assertBehindProxy refuses to boot on an invalid CIDR", () => {
  assert.throws(() => assertBehindProxy({ cidrs: ["not-a-cidr"] }), /invalid IP\/CIDR entry/);
  assert.throws(() => assertBehindProxy({ cidrs: [] }), /non-empty string array/);
});

// ---------- integration: autoBan framing + evasion defeated ----------

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
    path: "/public",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: "ok" }),
  });
  return app;
}

test("autoBan + trustedProxies: spoofed victim XFF frames NOBODY — strikes land on the attacker's real peer", async () => {
  const app = banApp({
    groupId: "tp-framing",
    trustedProxies: ["10.0.0.0/8"],
    windowMs: 60_000,
    maxStrikes: 3,
    banMs: 10_000,
    watchStatuses: [401],
  });
  const asAttacker = (path: string, xff: string) =>
    app.request(tagged(`http://t${path}`, "203.0.113.9", xff));
  // Attacker (direct peer, untrusted) racks up strikes while claiming the
  // victim's IP in XFF.
  for (let i = 0; i < 3; i++) await asAttacker("/fail", "198.51.100.23");
  // The victim's claimed identity is NOT banned: another direct caller
  // forwarding the same victim XFF walks straight in.
  const victim = await app.request(tagged("http://t/public", "203.0.113.10", "198.51.100.23"));
  assert.equal(victim.status, 200);
  // The strikes were attributed to the attacker's UNSPOOFABLE peer instead:
  // the attacker banned themselves.
  const attacker = await asAttacker("/public", "198.51.100.23");
  assert.equal(attacker.status, 429);
});

test("autoBan + trustedProxies: rotating spoofed XFF cannot evade strike accumulation", async () => {
  const app = banApp({
    groupId: "tp-evasion",
    trustedProxies: ["10.0.0.0/8"],
    windowMs: 60_000,
    maxStrikes: 3,
    banMs: 10_000,
    watchStatuses: [401],
  });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await app.request(tagged("http://t/fail", "203.0.113.9", `10.9.9.${i}`));
    codes.push(res.status);
  }
  // Every rotated identity collapses onto the one real peer — the fourth
  // attempt is banned, not served.
  assert.deepEqual(codes, [401, 401, 401, 429]);
});

test("autoBan + trustedProxies: a verified proxy's forwarded identity still works (no false-deny)", async () => {
  const app = banApp({
    groupId: "tp-honest",
    trustedProxies: ["10.0.0.0/8"],
    windowMs: 60_000,
    maxStrikes: 3,
    banMs: 10_000,
    watchStatuses: [401],
  });
  for (let i = 0; i < 3; i++) {
    await app.request(tagged("http://t/fail", "10.0.0.1", "198.51.100.23"));
  }
  // The banned client identity follows it across proxy instances.
  const banned = await app.request(tagged("http://t/public", "10.0.0.2", "198.51.100.23"));
  assert.equal(banned.status, 429);
  const innocent = await app.request(tagged("http://t/public", "10.0.0.2", "198.51.100.24"));
  assert.equal(innocent.status, 200);
});

test("[unhappy] autoBan construction rejects an empty or malformed trustedProxies list", () => {
  assert.throws(
    () => autoBan({ trustedProxies: [] }),
    /autoBan\(\): trustedProxies must be a non-empty/
  );
  assert.throws(
    () => autoBan({ trustedProxies: ["bogus"] }),
    /autoBan\(\): trustedProxies — invalid IP\/CIDR/
  );
});

// ---------- integration: rateLimit key derivation ----------

test("rateLimit + trustedProxies: rotating spoofed XFF shares the attacker's peer bucket — evasion defeated", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.use(
    rateLimit({ windowMs: 60_000, max: 2, groupId: "tp-rl", trustedProxies: ["10.0.0.0/8"] })
  );
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: "ok" }),
  });
  const codes: number[] = [];
  for (let i = 0; i < 3; i++) {
    codes.push((await app.request(tagged("http://t/x", "203.0.113.9", `10.9.9.${i}`))).status);
  }
  assert.deepEqual(codes, [200, 200, 429]);
  // A different real peer gets its own bucket — the attacker's spend cannot
  // 429 the world (the global-bucket lockout class).
  assert.equal((await app.request(tagged("http://t/x", "203.0.113.10", "10.9.9.9"))).status, 200);
  // And a verified proxy's forwarded identity keys honestly.
  assert.equal((await app.request(tagged("http://t/x", "10.0.0.1", "198.51.100.9"))).status, 200);
  assert.equal((await app.request(tagged("http://t/x", "10.0.0.1", "198.51.100.9"))).status, 200);
  assert.equal((await app.request(tagged("http://t/x", "10.0.0.1", "198.51.100.9"))).status, 429);
});

test("rateLimit + trustProxyHeaders: missing XFF keys per peer — no global lockout", async () => {
  // The half-fixed residual: with only trustProxyHeaders (no trustedProxies),
  // a request that carries no XFF must not share one "global" bucket with
  // every other such request.
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.use(rateLimit({ windowMs: 60_000, max: 1, groupId: "tp-noxff", trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/y",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: "ok" }),
  });
  const peerA = tagged("http://t/y", "203.0.113.9"); // no XFF
  const peerB = tagged("http://t/y", "203.0.113.10");
  assert.equal((await app.request(peerA)).status, 200);
  assert.equal((await app.request(peerA)).status, 429); // same peer exhausted
  assert.equal((await app.request(peerB)).status, 200); // different peer independent
});

// ---------- integration: geoBlock ----------

test("geoBlock + trustedProxies: a spoofed allowed-country XFF from an untrusted peer convinces nobody", async () => {
  const app = new App({ env: "development" });
  app.use(
    geoBlock({
      deny: ["ZZ"],
      trustedProxies: ["10.0.0.0/8"],
      lookupCountry: (ip) => ({ "198.51.100.23": "ZZ" })[ip],
    })
  );
  app.route({
    method: "GET",
    path: "/g",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: "ok" }),
  });
  // Trusted proxy forwarding a denied-country client: blocked.
  assert.equal((await app.request(tagged("http://t/g", "10.0.0.1", "198.51.100.23"))).status, 403);
  // Untrusted direct caller claiming the same denied IP: the spoofed header
  // is ignored, the country is unknown, and a deny-only list fails open.
  assert.equal(
    (await app.request(tagged("http://t/g", "203.0.113.9", "198.51.100.23"))).status,
    200
  );
});
