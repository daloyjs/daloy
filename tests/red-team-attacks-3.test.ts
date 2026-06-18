/**
 * RED-TEAM ATTACK SUITE — WAVE 3 (access-control modules)
 * =======================================================
 *
 * Adversarial tests for the network/identity access-control layer:
 * botGuard (spoofed crawlers), geoBlock (country gating), ipReputation
 * (denylist feeds), and autoBan (fail2ban-style strike banning).
 *
 * All tests are hermetic — DNS, GeoIP, and feed sources are stubbed, so no
 * real network or database lookups happen. The SECURE outcome is the PASSING
 * outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  botGuard,
  GOOGLEBOT,
  geoBlock,
  ipReputation,
  autoBan,
  _resetAutoBanStoresForTests,
  UnauthorizedError,
} from "../src/index.js";
import type { BotResolver, IpReputationFeed } from "../src/index.js";

function devApp() {
  return new App({ env: "development", logger: false });
}
function okRoute(app: App, method: "GET" | "POST" = "GET", path: `/${string}` = "/") {
  app.route({
    method,
    path,
    operationId: `op_${method}_${path.replace(/\W/g, "_")}`,
    responses: { 200: { description: "ok", body: undefined as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
}

// ===========================================================================
// 1. botGuard — spoofed verified crawler
// ===========================================================================

test("[bot-guard] a spoofed Googlebot (Google UA from a non-Google IP) is blocked (403)", async () => {
  // Hermetic reverse/forward DNS: only 66.249.66.1 round-trips to a Google domain.
  const resolver: BotResolver = {
    async reverse(ip) {
      if (ip === "66.249.66.1") return ["crawl-66-249-66-1.googlebot.com"];
      if (ip === "1.2.3.4") return ["evil.attacker.example"];
      return [];
    },
    async forward(host) {
      if (host === "crawl-66-249-66-1.googlebot.com") return ["66.249.66.1"];
      if (host === "evil.attacker.example") return ["1.2.3.4"];
      return [];
    },
  };
  const app = devApp();
  app.use(botGuard({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver }));
  okRoute(app);

  const spoofed = await app.request("/", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "x-forwarded-for": "1.2.3.4" },
  });
  assert.equal(spoofed.status, 403, "Googlebot UA from a non-Google IP must be blocked");

  const genuine = await app.request("/", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "x-forwarded-for": "66.249.66.1" },
  });
  assert.equal(genuine.status, 200, "a reverse+forward-verified Googlebot IP is allowed");
});

test("[bot-guard] explicitly blocked user-agents are rejected; ordinary clients pass", async () => {
  const app = devApp();
  app.use(botGuard({ blockedUserAgents: [/evil-scraper/i] }));
  okRoute(app);
  assert.equal((await app.request("/", { headers: { "user-agent": "evil-scraper/1.0" } })).status, 403);
  assert.equal((await app.request("/", { headers: { "user-agent": "Mozilla/5.0" } })).status, 200);
});

// ===========================================================================
// 2. geoBlock — country gating (stubbed GeoIP)
// ===========================================================================

const COUNTRY: Record<string, string> = {
  "203.0.113.7": "KP", // North Korea
  "8.8.8.8": "US",
};

test("[geo-block] allowlist mode blocks a country not on the list (403)", async () => {
  const app = devApp();
  app.use(geoBlock({ allow: ["US", "CA", "GB"], trustProxyHeaders: true, lookupCountry: (ip) => COUNTRY[ip] }));
  okRoute(app);
  assert.equal((await app.request("/", { headers: { "x-forwarded-for": "203.0.113.7" } })).status, 403);
  assert.equal((await app.request("/", { headers: { "x-forwarded-for": "8.8.8.8" } })).status, 200);
});

test("[geo-block] denylist mode blocks a listed country, passes everything else (403)", async () => {
  const app = devApp();
  app.use(geoBlock({ deny: ["KP", "IR"], trustProxyHeaders: true, lookupCountry: (ip) => COUNTRY[ip] }));
  okRoute(app);
  assert.equal((await app.request("/", { headers: { "x-forwarded-for": "203.0.113.7" } })).status, 403);
  assert.equal((await app.request("/", { headers: { "x-forwarded-for": "8.8.8.8" } })).status, 200);
});

// ===========================================================================
// 3. ipReputation — denylist feed (in-memory, no HTTP)
// ===========================================================================

test("[ip-reputation] an IP on the denylist feed is blocked; exact + CIDR; clean IP passes", async () => {
  const feed: IpReputationFeed = {
    name: "test-denylist",
    async fetch() {
      return ["6.6.6.6", "10.0.0.0/8"];
    },
  };
  const ctrl = ipReputation({
    feeds: [feed],
    trustProxyHeaders: true,
    refreshIntervalMs: 0, // no background timer in tests
    loadOnStart: true,
  });
  await ctrl.ready;
  try {
    const app = devApp();
    app.use(ctrl.hooks);
    okRoute(app);
    assert.equal((await app.request("/", { headers: { "x-forwarded-for": "6.6.6.6" } })).status, 403);
    assert.equal((await app.request("/", { headers: { "x-forwarded-for": "10.5.5.5" } })).status, 403, "CIDR match");
    assert.equal((await app.request("/", { headers: { "x-forwarded-for": "198.51.100.4" } })).status, 200);
  } finally {
    ctrl.stop();
  }
});

// ===========================================================================
// 4. autoBan — strike accumulation → ban
// ===========================================================================

test("[auto-ban] repeated 401s from one IP trigger a ban; other IPs unaffected", async () => {
  _resetAutoBanStoresForTests();
  const app = devApp();
  app.use(
    autoBan({
      trustProxyHeaders: true,
      windowMs: 60_000,
      maxStrikes: 3,
      banMs: 10_000,
      watchStatuses: [401, 403, 429],
      banStatus: 429,
    }),
  );
  app.route({
    method: "GET",
    path: "/login",
    operationId: "login",
    responses: { 200: { description: "ok", body: undefined as any } },
    handler: async () => {
      throw new UnauthorizedError("bad credentials");
    },
  });
  okRoute(app, "GET", "/public");

  const attacker = { "x-forwarded-for": "1.2.3.4" };
  // Three failed logins = three strikes; the third trips the ban.
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.request("/login", { headers: attacker })).status, 401);
  }
  // The attacker is now banned even on a perfectly valid route.
  const banned = await app.request("/public", { headers: attacker });
  assert.equal(banned.status, 429, "the offending IP is banned after maxStrikes");
  assert.ok(banned.headers.get("retry-after"));
  assert.equal(banned.headers.get("cache-control"), "no-store");

  // A different client is not collateral damage.
  const innocent = await app.request("/public", { headers: { "x-forwarded-for": "9.9.9.9" } });
  assert.equal(innocent.status, 200);
});

test("[auto-ban] refuses to construct without a way to identify clients", () => {
  // No keyGenerator and no trustProxyHeaders → every caller shares one bucket,
  // so one offender could ban everyone. The framework refuses this footgun.
  assert.throws(() => autoBan({}));
});
