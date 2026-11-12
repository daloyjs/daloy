/**
 * In-process rate limiter and RFC RateLimit response headers for the website
 * HTTP APIs.
 *
 * This is per serverless isolate, not a global cluster counter. The headers
 * still tell agents the advertised quota so they can self-throttle. A 429
 * includes Retry-After.
 *
 * Header shape follows draft-ietf-httpapi-ratelimit-headers (RateLimit and
 * RateLimit-Policy) plus the older RateLimit-Limit / Remaining / Reset names
 * that many clients still read.
 */

import {
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC,
  SITE_API_VERSION,
} from "@/lib/site-api";

export type RateLimitSnapshot = {
  /** True when this take exhausted the quota. */
  limited: boolean;
  remaining: number;
  resetSec: number;
  limit: number;
  windowSec: number;
};

type Bucket = { count: number; windowStart: number };

/**
 * Upper bound on tracked client keys per isolate. Past this, expired buckets
 * are swept and, if the map is still full, the oldest are dropped. Without a
 * bound, a caller rotating source addresses grows the map for the life of the
 * isolate.
 */
export const MAX_RATE_LIMIT_KEYS = 10_000;

/**
 * Create a fixed-window-per-key counter. Exported so tests can use a tiny
 * limit without mutating the production singleton.
 *
 * Memory is bounded: at most `maxKeys` buckets are kept. Expired buckets are
 * swept first; if every bucket is still live, the oldest are evicted, which
 * can only reset a caller's count early (never lock anyone out).
 *
 * @param limit - Maximum takes per window.
 * @param windowMs - Window length in milliseconds.
 * @param maxKeys - Maximum number of client keys tracked at once.
 */
export function createMemoryRateLimiter(
  limit: number,
  windowMs: number,
  maxKeys: number = MAX_RATE_LIMIT_KEYS,
): {
  take: (key: string, now?: number) => RateLimitSnapshot;
  size: () => number;
} {
  const buckets = new Map<string, Bucket>();
  const windowSec = Math.max(1, Math.round(windowMs / 1000));

  function makeRoom(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(key);
    }
    // Map iteration is insertion order, so the first keys are the oldest.
    for (const key of buckets.keys()) {
      if (buckets.size < maxKeys) break;
      buckets.delete(key);
    }
  }

  return {
    size: () => buckets.size,
    take(key: string, now = Date.now()): RateLimitSnapshot {
      const existing = buckets.get(key);
      if (!existing || now - existing.windowStart >= windowMs) {
        // Re-insert so a renewed key moves to the young end of the map.
        buckets.delete(key);
        if (buckets.size >= maxKeys) makeRoom(now);
        buckets.set(key, { count: 1, windowStart: now });
        return {
          limited: false,
          remaining: Math.max(0, limit - 1),
          resetSec: windowSec,
          limit,
          windowSec,
        };
      }

      existing.count += 1;
      const elapsedMs = now - existing.windowStart;
      const resetSec = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
      const limited = existing.count > limit;
      return {
        limited,
        remaining: limited ? 0 : Math.max(0, limit - existing.count),
        resetSec,
        limit,
        windowSec,
      };
    },
  };
}

/** Production limiter for website HTTP APIs (120 requests / 60 seconds). */
export const siteApiRateLimiter = createMemoryRateLimiter(
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC * 1000,
);

/** Longest client-address string accepted as a rate-limit key. */
const MAX_CLIENT_KEY_LENGTH = 64;

/**
 * Collapse a client address into its rate-limit bucket. An IPv6 address is
 * keyed by its /64 prefix, because one subscriber routinely controls a whole
 * /64 and could otherwise rotate through it for a fresh quota per address.
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is keyed as the IPv4 address. Anything
 * else is lowercased and length-capped.
 *
 * @param address - Client address as received.
 * @returns The bucket key for that client.
 */
export function clientBucket(address: string): string {
  let ip = address.trim().toLowerCase().slice(0, MAX_CLIENT_KEY_LENGTH);
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end > 0) ip = ip.slice(1, end);
  }
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return ip;

  const mapped = /^(?:0{0,4}:){2,6}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1]) return mapped[1];

  // Expand "::" so the first four hextets (the /64) can be read off.
  const [head = "", tail] = ip.split("::", 2);
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : Math.max(0, 8 - headParts.length - tailParts.length);
  const hextets = [...headParts, ...Array<string>(fill).fill("0"), ...tailParts];
  const prefix = hextets
    .slice(0, 4)
    .map((part) => part.replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
}

/**
 * Client identity for rate limiting. Uses the first forwarded hop when present
 * (Vercel overwrites X-Forwarded-For with the real client address) and falls
 * back to a shared "local" key. IPv6 clients share one bucket per /64; see
 * {@link clientBucket}.
 *
 * @param request - Incoming request.
 */
export function rateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return clientBucket(first);
    }
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? clientBucket(real) : "local";
}

/**
 * RFC RateLimit headers for a snapshot. Always includes both the structured
 * `RateLimit` / `RateLimit-Policy` fields and the older Limit/Remaining/Reset
 * names. Callers add `Retry-After` themselves on 429.
 *
 * @param snapshot - Result of {@link createMemoryRateLimiter}.
 */
export function rateLimitHeaders(
  snapshot: RateLimitSnapshot,
): Record<string, string> {
  return {
    RateLimit: `"default";r=${snapshot.remaining};t=${snapshot.resetSec}`,
    "RateLimit-Policy": `"default";q=${snapshot.limit};w=${snapshot.windowSec}`,
    "RateLimit-Limit": String(snapshot.limit),
    "RateLimit-Remaining": String(snapshot.remaining),
    "RateLimit-Reset": String(snapshot.resetSec),
  };
}

const API_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Accept, Authorization",
} as const;

/**
 * Headers shared by website HTTP APIs: CORS, API-Version, and RateLimit.
 *
 * @param snapshot - Current quota snapshot for this caller.
 * @param extra - Optional extra headers (Allow, Retry-After, …).
 */
export function siteApiHeaders(
  snapshot: RateLimitSnapshot,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...API_CORS,
    "API-Version": SITE_API_VERSION,
    ...rateLimitHeaders(snapshot),
    ...extra,
  };
}
