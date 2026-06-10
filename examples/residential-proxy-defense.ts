/**
 * Residential-proxy / botnet abuse defense example.
 *
 * Context: criminal "residential proxy" networks (e.g. the Asocks / PROXYLIB
 * botnet of ~17M infected phones, IoT devices, and PCs dismantled by Dutch
 * authorities — https://thehackernews.com/2026/05/dutch-authorities-dismantle-botnet.html)
 * exist to launder malicious traffic through millions of real, residential IPs.
 * Attackers buy access to these compromised devices specifically to *defeat*
 * naive IP defenses: every request arrives from a different, legitimate-looking
 * home IP, so a single static denylist or a per-IP rate limit alone is useless.
 *
 * DaloyJS sits on the *receiving* end of that traffic. It cannot clean up the
 * victims' infected devices, but it already ships the composable guards needed
 * to make your service an unattractive target for proxied abuse. This example
 * wires them together; none of it requires a runtime dependency.
 *
 * Layers (defense-in-depth — order matters, cheapest/most-decisive first):
 *
 *   1. `ipReputation()` — periodically-refreshed abuse feeds (Tor exit nodes,
 *      Spamhaus DROP, and *your own* residential-proxy / proxyware range feed).
 *      Plug a commercial or community "known proxy / VPN / hosting" list in via
 *      `urlFeed(url, { headers })` to knock out the ranges that are catalogued.
 *      Fail-open by design, so a feed outage never takes the app down.
 *   2. `botGuard()` — drop empty/abusive User-Agents and verify declared
 *      crawlers by reverse-DNS so a spoofed "Googlebot" coming out of a proxy
 *      can't claim crawler trust.
 *   3. `geoBlock()` — optional region allow/deny when your users are regional;
 *      shrinks the pool of usable proxy exit countries.
 *   4. `rateLimit()` — per-identity (not just per-IP) budget. Keying on the
 *      authenticated principal means rotating residential IPs spend the *same*
 *      bucket, so IP rotation buys the attacker nothing.
 *   5. `autoBan()` — fail2ban-style escalating, decaying bans: any identity that
 *      racks up 401/403/429s gets locked out for exponentially longer, while a
 *      one-off burst from a real user is forgiven.
 *
 * Run:
 *   pnpm exec tsx examples/residential-proxy-defense.ts
 *
 * Then:
 *   curl -H 'User-Agent: ' http://localhost:3002/health      # 403 (empty UA)
 *   curl http://localhost:3002/health                         # 200
 *
 * IMPORTANT: every `trustProxyHeaders: true` below assumes a *trusted* reverse
 * proxy that strips and rewrites `X-Forwarded-For`. Behind such a proxy this is
 * required to see the real client IP; with no trusted proxy, leave it off (the
 * defaults fail closed) or the IP is client-spoofable.
 */

import { z } from "zod";
import {
  App,
  ipReputation,
  urlFeed,
  botGuard,
  WELL_KNOWN_BOTS,
  geoBlock,
  rateLimit,
  autoBan,
  type BaseContext,
} from "../src/index.ts";
import { serve } from "../src/adapters/node.ts";

const app = new App({
  production: process.env.NODE_ENV === "production",
});

// --- 1. Reputation feeds (knock out catalogued proxy / abuse ranges) ---------
//
// Mix public abuse feeds with your own residential-proxy / proxyware range
// list. A commercial "proxy & VPN detection" provider typically exposes a
// newline/CIDR endpoint that `urlFeed` consumes directly; pass its token via
// `headers`. Everything is fail-open: a feed that 500s keeps the last-known-good
// list instead of blocking real users.
const reputation = ipReputation({
  trustProxyHeaders: true,
  refreshIntervalMs: 60 * 60_000, // hourly
  feeds: [
    urlFeed("https://check.torproject.org/torbulkexitlist", {
      name: "tor-exit",
    }),
    urlFeed("https://www.spamhaus.org/drop/drop.txt", {
      name: "spamhaus-drop",
    }),
    // Your residential-proxy / proxyware range feed (commercial or in-house):
    // urlFeed("https://feeds.example.com/residential-proxies.txt", {
    //   name: "residential-proxies",
    //   headers: { authorization: `Bearer ${process.env.PROXY_FEED_TOKEN}` },
    // }),
  ],
  onMatch: (m) => {
    // eslint-disable-next-line no-console
    console.warn(`[ip-reputation] blocked ${m.ip} (feeds: ${m.feeds.join(", ")})`);
  },
});
app.use(reputation.hooks);

// --- 2. Bot / spoofed-crawler guard ------------------------------------------
app.use(
  botGuard({
    trustProxyHeaders: true,
    blockEmptyUserAgent: true,
    blockedUserAgents: [/sqlmap/i, /nikto/i, /masscan/i, /zgrab/i],
    // A request claiming to be Googlebot/Bingbot from a residential proxy fails
    // reverse-DNS forward-confirm → treated as spoofed → 403.
    verifiedBots: WELL_KNOWN_BOTS,
  }),
);

// --- 3. Optional region scoping ----------------------------------------------
// Uncomment and supply a country source (edge header or IP→country lookup) when
// your audience is regional. Shrinks the set of proxy exit countries that work.
//
// app.use(
//   geoBlock({
//     // Read the country straight off a trusted edge header.
//     resolveCountry: (ctx) => ctx.request.headers.get("cf-ipcountry") ?? undefined,
//     allow: ["PH", "SG", "US"],
//   }),
// );
void geoBlock; // referenced so the import is illustrative, not dead

// --- 4. Per-identity rate limit (rotating IPs spend one bucket) ---------------
//
// Keying on the authenticated principal (here: a bearer/API-key subject) is the
// decisive move against residential proxies: a thousand different exit IPs that
// all present the same stolen credential share a single budget. Fall back to IP
// only for unauthenticated traffic.
function identityKey(ctx: BaseContext<any, any>): string {
  const auth = ctx.request.headers.get("authorization");
  if (auth) return `sub:${auth}`;
  const fwd = ctx.request.headers.get("x-forwarded-for");
  return `ip:${fwd?.split(",")[0]?.trim() ?? "unknown"}`;
}

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    trustProxyHeaders: true,
    keyGenerator: identityKey,
  }),
);

// --- 5. Escalating auto-ban for repeat offenders -----------------------------
app.use(
  autoBan({
    trustProxyHeaders: true,
    keyGenerator: identityKey,
    windowMs: 60_000,
    banMs: 5 * 60_000, // first ban: 5 min, escalates exponentially
    maxBanMs: 24 * 60 * 60_000, // cap at 24h
    onBan: (e) => {
      // eslint-disable-next-line no-console
      console.warn(`[auto-ban] banned ${e.key} until ${new Date(e.bannedUntilMs).toISOString()}`);
    },
  }),
);

// --- Business route ----------------------------------------------------------
app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  tags: ["Ops"],
  responses: {
    200: { description: "OK", body: z.object({ ok: z.literal(true) }) },
  },
  handler: async () => ({ status: 200 as const, body: { ok: true as const } }),
});

const port = Number(process.env.PORT ?? 3002);
serve(app, { port });
// eslint-disable-next-line no-console
console.log(`residential-proxy-defense example listening on http://localhost:${port}`);

// On shutdown, release the reputation refresh timer:
process.on("SIGTERM", () => reputation.stop());
process.on("SIGINT", () => reputation.stop());
