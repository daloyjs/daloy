/**
 * Bot / User-Agent management middleware. Mirrors the bot-rule layer that
 * Nginx, Cloudflare, and other WAFs run at the edge, but inside the app where
 * the framework already owns request parsing and client-IP resolution.
 *
 * {@link botGuard} does three opt-in jobs:
 *
 * 1. **Block empty / missing `User-Agent`** — a common signature of crude
 *    scrapers and vulnerability scanners (on by default).
 * 2. **Block known-abusive `User-Agent` strings** — caller-supplied substrings
 *    or `RegExp`s.
 * 3. **Verify declared crawlers** — when a request *claims* to be Googlebot or
 *    Bingbot, confirm it via reverse-DNS + forward-confirm (the method Google
 *    and Bing themselves document) so a spoofed `User-Agent` can't impersonate a
 *    trusted crawler. Verification results are cached per IP to keep DNS off the
 *    hot path.
 *
 * The middleware is dependency-free and runtime-portable. The default DNS
 * resolver is lazily imported from `node:dns/promises`; supply a custom
 * {@link BotResolver} on non-Node runtimes or in tests.
 *
 * @example
 * ```ts
 * import { botGuard, WELL_KNOWN_BOTS } from "@daloyjs/core";
 *
 * app.use(
 *   botGuard({
 *     trustProxyHeaders: true,
 *     blockedUserAgents: [/sqlmap/i, /nikto/i, "masscan"],
 *     verifiedBots: WELL_KNOWN_BOTS, // spoofed Googlebot/Bingbot → 403
 *   }),
 * );
 * ```
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError } from "./errors.js";

/**
 * Pluggable DNS resolver used to verify declared crawlers. The default
 * implementation lazily imports `node:dns/promises`; provide your own on
 * runtimes without it (Workers, Deno without `--allow-net`) or in tests.
 *
 * @since 0.37.0
 */
export interface BotResolver {
  /**
   * Reverse-resolve an IP address to its PTR hostname(s).
   *
   * @param ip - The client IP address.
   * @returns The PTR hostnames (may be empty).
   */
  reverse(ip: string): Promise<readonly string[]>;
  /**
   * Forward-resolve a hostname to its IP address(es).
   *
   * @param hostname - The hostname returned by {@link BotResolver.reverse}.
   * @returns The resolved IP addresses (may be empty).
   */
  forward(hostname: string): Promise<readonly string[]>;
}

/**
 * A declared-crawler verification rule. When the request `User-Agent` matches
 * {@link VerifiedBotRule.userAgent}, the client's reverse-DNS hostname must end
 * with one of {@link VerifiedBotRule.domains} and forward-resolve back to the
 * same IP — otherwise the request is treated as a spoofed crawler.
 *
 * @since 0.37.0
 */
export interface VerifiedBotRule {
  /** Human-readable bot name, surfaced in {@link BotGuardEvent.botName}. */
  name: string;
  /** Pattern that identifies a request claiming to be this crawler. */
  userAgent: RegExp;
  /**
   * Allowed reverse-DNS domain suffixes (e.g. `.googlebot.com`). A leading dot
   * is recommended so `evilgooglebot.com` cannot match `googlebot.com`.
   */
  domains: readonly string[];
}

/**
 * Why a request was flagged by {@link botGuard}. Passed to
 * {@link BotGuardOptions.onBlock} and used to build the rejection.
 *
 * @since 0.37.0
 */
export interface BotGuardEvent {
  /** The specific rule that fired. */
  reason: "empty-user-agent" | "blocked-user-agent" | "spoofed-bot" | "unverifiable-bot";
  /** The request `User-Agent` (empty string when missing). */
  userAgent: string;
  /** The resolved client IP, when available. */
  ip?: string;
  /** The declared bot name, for `spoofed-bot` / `unverifiable-bot`. */
  botName?: string;
}

/**
 * Configuration for {@link botGuard}.
 *
 * @since 0.37.0
 */
export interface BotGuardOptions {
  /**
   * Block requests whose `User-Agent` is missing or empty. Default `true`.
   */
  blockEmptyUserAgent?: boolean;
  /**
   * Known-abusive `User-Agent` patterns. A plain string matches
   * case-insensitively as a substring; a `RegExp` is tested as-is.
   */
  blockedUserAgents?: readonly (string | RegExp)[];
  /**
   * Allowlist that bypasses **all** checks (including empty-UA and verified-bot
   * verification). A plain string matches case-insensitively as a substring; a
   * `RegExp` is tested as-is. Checked first.
   */
  allowUserAgents?: readonly (string | RegExp)[];
  /**
   * Declared-crawler verification rules. When provided, an IP source is
   * required (`resolveIp` or `trustProxyHeaders`), otherwise construction
   * throws.
   */
  verifiedBots?: readonly VerifiedBotRule[];
  /**
   * Block a declared crawler that cannot be verified (no client IP, or a DNS
   * lookup failure). Default `true` — the secure-by-default posture, since an
   * unverifiable "Googlebot" might be an impersonator. Set `false` to fail open
   * and let unverifiable crawlers through.
   */
  blockUnverifiableBots?: boolean;
  /**
   * Trust `X-Forwarded-For` / `X-Real-IP` in the default IP resolver. Only
   * enable behind a trusted proxy that overwrites these headers.
   */
  trustProxyHeaders?: boolean;
  /**
   * Custom client-IP resolver. Overrides {@link BotGuardOptions.trustProxyHeaders}.
   */
  resolveIp?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Custom DNS resolver for crawler verification. Defaults to a lazy
   * `node:dns/promises`-backed resolver.
   */
  resolver?: BotResolver;
  /**
   * `"block"` (default) throws a {@link ForbiddenError}; `"log"` only invokes
   * {@link BotGuardOptions.onBlock} and lets the request continue (monitor mode).
   */
  mode?: "block" | "log";
  /** Detail string for the `403` problem+json. Default `"Bot access denied"`. */
  message?: string;
  /**
   * TTL for cached crawler-verification results, in ms. Default 1 hour.
   */
  cacheTtlMs?: number;
  /** Max cached IPs before opportunistic pruning. Default `10_000`. */
  cacheMaxEntries?: number;
  /** Called whenever a request is flagged (in both `block` and `log` modes). */
  onBlock?: (event: BotGuardEvent) => void;
}

const DEFAULT_MESSAGE = "Bot access denied";
const DEFAULT_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_CACHE_MAX = 10_000;

/**
 * Built-in {@link VerifiedBotRule} for Googlebot (and other Google crawlers),
 * verified against Google's documented `*.googlebot.com` / `*.google.com`
 * reverse-DNS domains.
 *
 * @since 0.37.0
 */
export const GOOGLEBOT: VerifiedBotRule = {
  name: "Googlebot",
  userAgent: /googlebot|google-inspectiontool|storebot-google|googleother|google-extended/i,
  domains: [".googlebot.com", ".google.com"],
};

/**
 * Built-in {@link VerifiedBotRule} for Bingbot, verified against Microsoft's
 * documented `*.search.msn.com` reverse-DNS domain.
 *
 * @since 0.37.0
 */
export const BINGBOT: VerifiedBotRule = {
  name: "Bingbot",
  userAgent: /bingbot|bingpreview|adidxbot|msnbot/i,
  domains: [".search.msn.com"],
};

/**
 * Convenience bundle of the built-in verified-crawler rules
 * ({@link GOOGLEBOT}, {@link BINGBOT}).
 *
 * @since 0.37.0
 */
export const WELL_KNOWN_BOTS: readonly VerifiedBotRule[] = [GOOGLEBOT, BINGBOT];

function matchesUserAgent(
  ua: string,
  patterns: readonly (string | RegExp)[],
): boolean {
  const lower = ua.toLowerCase();
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      if (pattern && lower.includes(pattern.toLowerCase())) return true;
    } else {
      // Reset lastIndex so caller-supplied /g or /y regexes cannot flip-flop
      // between match and miss across requests (intermittent allowlist bypass).
      pattern.lastIndex = 0;
      const hit = pattern.test(ua);
      pattern.lastIndex = 0;
      if (hit) return true;
    }
  }
  return false;
}

function forwardedIpResolver(ctx: BaseContext<any, any>): string | undefined {
  const headers = ctx.request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return ctx.request.headers.get("x-real-ip") ?? undefined;
}

function noIpResolver(_ctx: BaseContext<any, any>): string | undefined {
  return undefined;
}

function createDefaultResolver(): BotResolver {
  let dnsPromise: Promise<{
    reverse: (ip: string) => Promise<string[]>;
    lookup: (host: string, opts: { all: true }) => Promise<Array<{ address: string }>>;
  } | null> | null = null;
  const load = async () => {
    if (!dnsPromise) {
      dnsPromise = import("node:dns/promises")
        .then((m) => ({
          reverse: m.reverse as unknown as (ip: string) => Promise<string[]>,
          lookup: m.lookup as unknown as (
            host: string,
            opts: { all: true },
          ) => Promise<Array<{ address: string }>>,
        }))
        .catch(() => null);
    }
    const dns = await dnsPromise;
    if (!dns) {
      throw new Error(
        "botGuard: no DNS resolver available on this runtime. Pass options.resolver.",
      );
    }
    return dns;
  };
  return {
    async reverse(ip) {
      const dns = await load();
      return dns.reverse(ip);
    },
    async forward(hostname) {
      const dns = await load();
      const results = await dns.lookup(hostname, { all: true });
      return results.map((r) => r.address);
    },
  };
}

/**
 * Build the default DNS resolver backed by a lazily-imported
 * `node:dns/promises`. Used internally by {@link botGuard} when no custom
 * {@link BotGuardOptions.resolver} is supplied, and exported for tests. Throws
 * on runtimes without `node:dns/promises` so callers are told to supply their
 * own resolver.
 *
 * @returns A {@link BotResolver} backed by the platform's DNS.
 * @internal
 */
export function _createDefaultBotResolver(): BotResolver {
  return createDefaultResolver();
}

/**
 * Confirm that `hostname` ends with one of the allowed `domains`. A leading dot
 * in a domain enforces a subdomain boundary so `evil-googlebot.com` cannot match
 * `.googlebot.com`; a bare domain also matches the apex exactly.
 *
 * @internal
 */
function hostnameMatchesDomains(
  hostname: string,
  domains: readonly string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const domain of domains) {
    const d = domain.toLowerCase();
    if (d.startsWith(".")) {
      if (host.endsWith(d)) return true;
    } else if (host === d || host.endsWith(`.${d}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Reverse-DNS + forward-confirm a client IP against a verified-bot rule, the way
 * Google and Bing document. Returns `true` only when a PTR hostname both ends in
 * an allowed domain and forward-resolves back to the same IP.
 *
 * @internal
 */
async function verifyCrawler(
  resolver: BotResolver,
  ip: string,
  rule: VerifiedBotRule,
): Promise<boolean> {
  const hostnames = await resolver.reverse(ip);
  for (const hostname of hostnames) {
    if (!hostnameMatchesDomains(hostname, rule.domains)) continue;
    const addresses = await resolver.forward(hostname);
    if (addresses.includes(ip)) return true;
  }
  return false;
}

/**
 * Bot / User-Agent management middleware. Blocks empty or known-abusive
 * `User-Agent` strings and verifies declared crawlers (Googlebot/Bingbot) via
 * reverse-DNS + forward-confirm, so a spoofed `User-Agent` cannot impersonate a
 * trusted crawler.
 *
 * All checks are opt-in and allowlist-friendly: {@link BotGuardOptions.allowUserAgents}
 * is consulted first and bypasses every other rule.
 *
 * @param opts - Bot-guard configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @throws Error when `verifiedBots` is set without an IP source
 *   (`resolveIp` or `trustProxyHeaders`), or when `mode` is invalid.
 * @since 0.37.0
 */
export function botGuard(opts: BotGuardOptions = {}): Hooks {
  const blockEmpty = opts.blockEmptyUserAgent !== false;
  const blocked = opts.blockedUserAgents ?? [];
  const allowed = opts.allowUserAgents ?? [];
  const verifiedBots = opts.verifiedBots ?? [];
  const blockUnverifiable = opts.blockUnverifiableBots !== false;
  const message = opts.message ?? DEFAULT_MESSAGE;
  const cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheMax = opts.cacheMaxEntries ?? DEFAULT_CACHE_MAX;

  const mode = opts.mode ?? "block";
  if (mode !== "block" && mode !== "log") {
    throw new Error('botGuard(): mode must be "block" or "log".');
  }

  const resolveIp =
    opts.resolveIp ?? (opts.trustProxyHeaders ? forwardedIpResolver : noIpResolver);

  if (verifiedBots.length > 0 && !opts.resolveIp && !opts.trustProxyHeaders) {
    throw new Error(
      "botGuard(): verifiedBots requires a client-IP source — provide resolveIp " +
        "or set trustProxyHeaders, otherwise declared crawlers cannot be verified.",
    );
  }
  const resolver = opts.resolver ?? createDefaultResolver();

  // Per-IP verification cache (keyed by `ip\u0000botName`) so a crawler's DNS
  // round-trip is paid once per TTL, not on every request.
  const cache = new Map<string, { verified: boolean; expiresMs: number }>();
  const readCache = (key: string): boolean | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresMs <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.verified;
  };
  const writeCache = (key: string, verified: boolean): void => {
    const now = Date.now();
    // Move this key to the newest insertion slot on every (re)write. Eviction
    // below is therefore FIFO over WRITE-recency (Map preserves insertion
    // order), not true LRU: cache *reads* on the verification path do not
    // reorder entries, so a frequently-read-but-never-rewritten key can still
    // be evicted. That is intentional — reordering on read would add a Map
    // delete+set to the hot lookup path for no security benefit.
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { verified, expiresMs: now + cacheTtlMs });
    if (cache.size > cacheMax) {
      for (const [k, v] of cache) if (v.expiresMs <= now) cache.delete(k);
    }
    // Still over the cap after pruning expired entries: evict the
    // oldest-written live keys (front of insertion order) until within cacheMax.
    while (cache.size > cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const reject = (event: BotGuardEvent): void => {
    opts.onBlock?.(event);
    if (mode === "block") throw new ForbiddenError(message);
  };

  return {
    async beforeHandle(ctx) {
      const ua = ctx.request.headers.get("user-agent") ?? "";

      // Allowlist wins over every other rule.
      if (allowed.length > 0 && matchesUserAgent(ua, allowed)) return undefined;

      if (!ua.trim()) {
        if (blockEmpty) reject({ reason: "empty-user-agent", userAgent: ua });
        return undefined;
      }

      if (blocked.length > 0 && matchesUserAgent(ua, blocked)) {
        reject({ reason: "blocked-user-agent", userAgent: ua });
        return undefined;
      }

      const rule = verifiedBots.find((r) => {
        r.userAgent.lastIndex = 0;
        const hit = r.userAgent.test(ua);
        r.userAgent.lastIndex = 0;
        return hit;
      });
      if (!rule) return undefined;

      const ip = resolveIp(ctx);
      if (!ip) {
        if (blockUnverifiable) {
          reject({ reason: "unverifiable-bot", userAgent: ua, botName: rule.name });
        }
        return undefined;
      }

      const cacheKey = `${ip}\u0000${rule.name}`;
      const cached = readCache(cacheKey);
      if (cached === true) return undefined;
      if (cached === false) {
        reject({ reason: "spoofed-bot", userAgent: ua, ip, botName: rule.name });
        return undefined;
      }

      let verified: boolean;
      try {
        verified = await verifyCrawler(resolver, ip, rule);
      } catch {
        // DNS failure — cannot confirm. Don't cache transient errors.
        if (blockUnverifiable) {
          reject({ reason: "unverifiable-bot", userAgent: ua, ip, botName: rule.name });
        }
        return undefined;
      }

      writeCache(cacheKey, verified);
      if (!verified) {
        reject({ reason: "spoofed-bot", userAgent: ua, ip, botName: rule.name });
      }
      return undefined;
    },
  };
}
