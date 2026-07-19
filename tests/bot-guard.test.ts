import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  botGuard,
  GOOGLEBOT,
  BINGBOT,
  WELL_KNOWN_BOTS,
  type BotResolver,
  type BotGuardEvent,
} from "../src/index.js";
import { _createDefaultBotResolver } from "../src/bot-guard.js";

// ---------- helpers ----------

/**
 * App with a `botGuard()` guard plus a single `/` route returning 200. The UA
 * (and optionally x-forwarded-for) headers are supplied per request.
 */
function appWith(opts: Parameters<typeof botGuard>[0]): App {
  const app = new App({ env: "development" });
  app.use(botGuard(opts));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function req(ua: string | null, ip?: string): Request {
  const headers: Record<string, string> = {};
  if (ua !== null) headers["user-agent"] = ua;
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request("http://x/", { headers });
}

/** Static DNS fixture: ip → PTR hostnames, hostname → forward IPs. */
function fixtureResolver(
  ptr: Record<string, string[]>,
  fwd: Record<string, string[]>,
): BotResolver {
  return {
    async reverse(ip) {
      return ptr[ip] ?? [];
    },
    async forward(hostname) {
      return fwd[hostname] ?? [];
    },
  };
}

// ---------- construction validation (unhappy) ----------

test("botGuard() rejects an invalid mode", () => {
  // @ts-expect-error intentionally invalid
  assert.throws(() => botGuard({ mode: "warn" }), /mode must be/);
});

test("botGuard() requires an IP source when verifiedBots is set", () => {
  assert.throws(
    () => botGuard({ verifiedBots: WELL_KNOWN_BOTS }),
    /requires a client-IP source/,
  );
});

test("botGuard() accepts verifiedBots with trustProxyHeaders", () => {
  assert.doesNotThrow(() =>
    botGuard({ verifiedBots: WELL_KNOWN_BOTS, trustProxyHeaders: true }),
  );
});

// ---------- empty / blocked user agents ----------

test("botGuard() blocks an empty User-Agent by default", async () => {
  const app = appWith({});
  assert.equal((await app.fetch(req(""))).status, 403);
  assert.equal((await app.fetch(req(null))).status, 403);
});

test("botGuard() allows empty User-Agent when blockEmptyUserAgent is false", async () => {
  const app = appWith({ blockEmptyUserAgent: false });
  assert.equal((await app.fetch(req(""))).status, 200);
});

test("botGuard() blocks known-abusive User-Agent strings and regexes", async () => {
  const app = appWith({ blockedUserAgents: ["masscan", /sqlmap/i] });
  assert.equal((await app.fetch(req("masscan/1.0"))).status, 403);
  assert.equal((await app.fetch(req("sqlMap/1.7"))).status, 403);
  assert.equal((await app.fetch(req("Mozilla/5.0"))).status, 200);
});

test("botGuard() allowlist bypasses every other rule", async () => {
  const app = appWith({
    blockEmptyUserAgent: true,
    blockedUserAgents: ["curl"],
    allowUserAgents: ["curl/8"],
  });
  // The blocked substring also appears, but the allowlist wins.
  assert.equal((await app.fetch(req("curl/8.6.0"))).status, 200);
});

// ---------- declared-crawler verification ----------

const GOOGLE_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

test("botGuard() lets a genuine Googlebot through (reverse + forward confirm)", async () => {
  const resolver = fixtureResolver(
    { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"] },
    { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
  );
  const app = appWith({
    trustProxyHeaders: true,
    verifiedBots: [GOOGLEBOT],
    resolver,
  });
  assert.equal((await app.fetch(req(GOOGLE_UA, "66.249.66.1"))).status, 200);
});

test("botGuard() blocks a spoofed Googlebot whose PTR is not on an allowed domain", async () => {
  const resolver = fixtureResolver(
    { "1.2.3.4": ["host.evil.example"] },
    { "host.evil.example": ["1.2.3.4"] },
  );
  const app = appWith({
    trustProxyHeaders: true,
    verifiedBots: [GOOGLEBOT],
    resolver,
  });
  assert.equal((await app.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 403);
});

test("botGuard() blocks a spoofed Googlebot that fails forward-confirm", async () => {
  const resolver = fixtureResolver(
    { "1.2.3.4": ["crawl.googlebot.com"] },
    { "crawl.googlebot.com": ["9.9.9.9"] }, // forward IP differs
  );
  const app = appWith({
    trustProxyHeaders: true,
    verifiedBots: [GOOGLEBOT],
    resolver,
  });
  assert.equal((await app.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 403);
});

test("botGuard() blocks an unverifiable crawler with no client IP", async () => {
  const app = appWith({
    resolveIp: () => undefined,
    verifiedBots: [GOOGLEBOT],
  });
  assert.equal((await app.fetch(req(GOOGLE_UA))).status, 403);
});

test("botGuard() can fail open for unverifiable crawlers", async () => {
  const app = appWith({
    resolveIp: () => undefined,
    verifiedBots: [GOOGLEBOT],
    blockUnverifiableBots: false,
  });
  assert.equal((await app.fetch(req(GOOGLE_UA))).status, 200);
});

test("botGuard() treats a DNS lookup failure as unverifiable", async () => {
  const resolver: BotResolver = {
    async reverse() {
      throw new Error("ENOTFOUND");
    },
    async forward() {
      return [];
    },
  };
  const blocked = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await blocked.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 403);

  const open = appWith({
    trustProxyHeaders: true,
    verifiedBots: [GOOGLEBOT],
    blockUnverifiableBots: false,
    resolver,
  });
  assert.equal((await open.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 200);
});

test("botGuard() caches verification results per IP", async () => {
  let reverseCalls = 0;
  const resolver: BotResolver = {
    async reverse(ip) {
      reverseCalls++;
      return ip === "66.249.66.1" ? ["crawl.googlebot.com"] : [];
    },
    async forward() {
      return ["66.249.66.1"];
    },
  };
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.fetch(req(GOOGLE_UA, "66.249.66.1"))).status, 200);
  }
  assert.equal(reverseCalls, 1);
});

test("botGuard() ignores non-crawler UAs (no DNS, always allowed)", async () => {
  let calls = 0;
  const resolver: BotResolver = {
    async reverse() {
      calls++;
      return [];
    },
    async forward() {
      return [];
    },
  };
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req("Mozilla/5.0", "1.2.3.4"))).status, 200);
  assert.equal(calls, 0);
});

// ---------- log mode + callbacks ----------

test("botGuard() log mode never blocks but reports events", async () => {
  const events: BotGuardEvent[] = [];
  const app = appWith({
    mode: "log",
    blockedUserAgents: ["nikto"],
    onBlock: (e) => events.push(e),
  });
  assert.equal((await app.fetch(req("nikto/2.5"))).status, 200);
  assert.equal((await app.fetch(req(""))).status, 200);
  assert.deepEqual(
    events.map((e) => e.reason),
    ["blocked-user-agent", "empty-user-agent"],
  );
});

test("botGuard() reports a spoofed-bot event with bot name and ip", async () => {
  const events: BotGuardEvent[] = [];
  const resolver = fixtureResolver({ "1.2.3.4": ["host.evil.example"] }, {});
  const app = appWith({
    trustProxyHeaders: true,
    verifiedBots: [BINGBOT],
    resolver,
    onBlock: (e) => events.push(e),
  });
  const bingUa = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
  assert.equal((await app.fetch(req(bingUa, "1.2.3.4"))).status, 403);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, "spoofed-bot");
  assert.equal(events[0]!.botName, "Bingbot");
  assert.equal(events[0]!.ip, "1.2.3.4");
});

// ---------- subdomain-boundary safety ----------

test("botGuard() does not let evilgooglebot.com satisfy .googlebot.com", async () => {
  const resolver = fixtureResolver(
    { "1.2.3.4": ["host.evilgooglebot.com"] },
    { "host.evilgooglebot.com": ["1.2.3.4"] },
  );
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 403);
});

// ---------- default node:dns resolver ----------

test("default BotResolver forward-resolves loopback via node:dns", async () => {
  const resolver = _createDefaultBotResolver();
  // localhost reliably forward-resolves to a loopback address via the hosts file.
  const addrs = await resolver.forward("localhost");
  assert.ok(
    addrs.some((a) => a === "127.0.0.1" || a === "::1"),
    `expected a loopback address, got ${JSON.stringify(addrs)}`,
  );
  // reverse() should run without throwing for a loopback IP; the PTR value is
  // environment-dependent, so we only assert it returns an array.
  const ptr = await resolver.reverse("127.0.0.1").catch(() => []);
  assert.ok(Array.isArray(ptr));
});

test("botGuard blockedUserAgents with /g regex is consistent across requests", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(botGuard({ blockedUserAgents: [/sqlmap/gi] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  for (let i = 0; i < 5; i++) {
    const res = await app.fetch(
      new Request("http://x/", { headers: { "user-agent": "sqlmap/1.0" } }),
    );
    assert.equal(res.status, 403, `request ${i + 1} must stay blocked`);
  }
});
