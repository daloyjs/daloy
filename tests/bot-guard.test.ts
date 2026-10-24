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
  fwd: Record<string, string[]>
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
  assert.throws(() => botGuard({ verifiedBots: WELL_KNOWN_BOTS }), /requires a client-IP source/);
});

test("botGuard() accepts verifiedBots with trustProxyHeaders", () => {
  assert.doesNotThrow(() => botGuard({ verifiedBots: WELL_KNOWN_BOTS, trustProxyHeaders: true }));
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

const GOOGLE_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

test("botGuard() lets a genuine Googlebot through (reverse + forward confirm)", async () => {
  const resolver = fixtureResolver(
    { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"] },
    { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] }
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
    { "host.evil.example": ["1.2.3.4"] }
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
    { "crawl.googlebot.com": ["9.9.9.9"] } // forward IP differs
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

test("botGuard() coalesces concurrent verifications of the same claim onto one DNS lookup", async () => {
  let reverseCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const resolver: BotResolver = {
    async reverse(ip) {
      reverseCalls++;
      await gate;
      return ip === "66.249.66.1" ? ["crawl.googlebot.com"] : [];
    },
    async forward() {
      return ["66.249.66.1"];
    },
  };
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  const burst = Array.from({ length: 25 }, () => app.fetch(req(GOOGLE_UA, "66.249.66.1")));
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const statuses = (await Promise.all(burst)).map((r) => r.status);
  assert.deepEqual(statuses, new Array(25).fill(200));
  assert.equal(reverseCalls, 1, "a burst of identical claims shares one in-flight lookup");
});

test("botGuard() does not let a verdict for one rule vouch for a same-named rule with other domains", async () => {
  const resolver = fixtureResolver(
    { "66.249.66.1": ["crawl.googlebot.com"] },
    { "crawl.googlebot.com": ["66.249.66.1"] }
  );
  const app = appWith({
    trustProxyHeaders: true,
    resolver,
    verifiedBots: [
      { name: "crawler", userAgent: /Googlebot/, domains: [".googlebot.com"] },
      { name: "crawler", userAgent: /Bingbot/, domains: [".search.msn.com"] },
    ],
  });
  // First rule verifies the IP for Googlebot ...
  assert.equal((await app.fetch(req(GOOGLE_UA, "66.249.66.1"))).status, 200);
  // ... which must not be reused when the same IP claims to be Bingbot.
  assert.equal((await app.fetch(req("Mozilla/5.0 (compatible; Bingbot/2.0)", "66.249.66.1"))).status, 403);
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
    ["blocked-user-agent", "empty-user-agent"]
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
    { "host.evilgooglebot.com": ["1.2.3.4"] }
  );
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req(GOOGLE_UA, "1.2.3.4"))).status, 403);
});

// ---------- PTR hostname syntax (CVE-2026-105482 class) ----------

/**
 * Resolver whose forward step mimics an unpatched `dns.resolve*()` / DoH
 * client: the hostname is truncated at the first NUL before lookup, so
 * `attacker.example\0.googlebot.com` resolves `attacker.example`.
 */
function nulTruncatingResolver(ptr: Record<string, string[]>, fwd: Record<string, string[]>) {
  const forwarded: string[] = [];
  const resolver: BotResolver = {
    async reverse(ip) {
      return ptr[ip] ?? [];
    },
    async forward(hostname) {
      forwarded.push(hostname);
      const nul = hostname.indexOf("\0");
      return fwd[nul === -1 ? hostname : hostname.slice(0, nul)] ?? [];
    },
  };
  return { resolver, forwarded };
}

test("botGuard() rejects a PTR with an embedded NUL even when the resolver truncates at it", async () => {
  const { resolver, forwarded } = nulTruncatingResolver(
    { "6.6.6.6": ["attacker.example\0.googlebot.com"] },
    { "attacker.example": ["6.6.6.6"] }
  );
  const events: BotGuardEvent[] = [];
  const app = appWith({
    trustProxyHeaders: true,
    verifiedBots: [GOOGLEBOT],
    resolver,
    onBlock: (e) => events.push(e),
  });
  assert.equal((await app.fetch(req(GOOGLE_UA, "6.6.6.6"))).status, 403);
  assert.equal(events[0]!.reason, "spoofed-bot");
  assert.deepEqual(forwarded, [], "a malformed PTR must never reach the forward resolver");
});

test("botGuard() rejects non-LDH PTR hostnames before the suffix check", async () => {
  const bad = [
    "crawl\\000.googlebot.com", // c-ares escape of a NUL
    "crawl .googlebot.com", // whitespace
    "crawl_1.googlebot.com", // underscore
    "-crawl.googlebot.com", // leading hyphen
    "crawl..googlebot.com", // empty label
    `${"a".repeat(64)}.googlebot.com`, // label > 63
    `${"a.".repeat(130)}googlebot.com`, // name > 253
    "", // empty
  ];
  for (const hostname of bad) {
    let forwardCalls = 0;
    const resolver: BotResolver = {
      async reverse() {
        return [hostname];
      },
      async forward() {
        forwardCalls++;
        return ["1.2.3.4"];
      },
    };
    const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
    assert.equal(
      (await app.fetch(req(GOOGLE_UA, "1.2.3.4"))).status,
      403,
      `PTR ${JSON.stringify(hostname)} must be rejected`
    );
    assert.equal(forwardCalls, 0, `PTR ${JSON.stringify(hostname)} must not be forwarded`);
  }
});

test("botGuard() still verifies a well-formed PTR with a trailing dot (FQDN form)", async () => {
  const resolver = fixtureResolver(
    { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com."] },
    { "crawl-66-249-66-1.googlebot.com.": ["66.249.66.1"] }
  );
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req(GOOGLE_UA, "66.249.66.1"))).status, 200);
});

test("botGuard() skips a malformed PTR but still verifies a valid sibling PTR", async () => {
  const resolver = fixtureResolver(
    { "66.249.66.1": ["bogus\0.googlebot.com", "crawl-66-249-66-1.googlebot.com"] },
    { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] }
  );
  const app = appWith({ trustProxyHeaders: true, verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req(GOOGLE_UA, "66.249.66.1"))).status, 200);
});

test("botGuard() treats a non-IP resolveIp result as unverifiable and never calls the resolver", async () => {
  let reverseCalls = 0;
  const resolver: BotResolver = {
    async reverse() {
      reverseCalls++;
      return ["crawl.googlebot.com"];
    },
    async forward() {
      return ["crawl.googlebot.com"];
    },
  };
  const events: BotGuardEvent[] = [];
  const blocked = appWith({
    resolveIp: () => "crawl.googlebot.com",
    verifiedBots: [GOOGLEBOT],
    resolver,
    onBlock: (e) => events.push(e),
  });
  assert.equal((await blocked.fetch(req(GOOGLE_UA))).status, 403);
  assert.equal(events[0]!.reason, "unverifiable-bot");
  assert.equal(events[0]!.ip, "crawl.googlebot.com");
  assert.equal(reverseCalls, 0);

  const open = appWith({
    resolveIp: () => "not-an-ip",
    verifiedBots: [GOOGLEBOT],
    resolver,
    blockUnverifiableBots: false,
  });
  assert.equal((await open.fetch(req(GOOGLE_UA))).status, 200);
  assert.equal(reverseCalls, 0);
});

test("botGuard() accepts IPv6 client IPs from resolveIp", async () => {
  const resolver = fixtureResolver(
    { "2001:db8::1": ["crawl.googlebot.com"] },
    { "crawl.googlebot.com": ["2001:db8::1"] }
  );
  const app = appWith({ resolveIp: () => "2001:db8::1", verifiedBots: [GOOGLEBOT], resolver });
  assert.equal((await app.fetch(req(GOOGLE_UA))).status, 200);
});

// ---------- default node:dns resolver ----------

test("default BotResolver forward-resolves loopback via node:dns", async () => {
  const resolver = _createDefaultBotResolver();
  // localhost reliably forward-resolves to a loopback address via the hosts file.
  const addrs = await resolver.forward("localhost");
  assert.ok(
    addrs.some((a) => a === "127.0.0.1" || a === "::1"),
    `expected a loopback address, got ${JSON.stringify(addrs)}`
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
      new Request("http://x/", { headers: { "user-agent": "sqlmap/1.0" } })
    );
    assert.equal(res.status, 403, `request ${i + 1} must stay blocked`);
  }
});
