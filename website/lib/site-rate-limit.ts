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
 * Create a sliding-window-per-key counter. Exported so tests can use a tiny
 * limit without mutating the production singleton.
 *
 * @param limit - Maximum takes per window.
 * @param windowMs - Window length in milliseconds.
 */
export function createMemoryRateLimiter(
  limit: number,
  windowMs: number,
): { take: (key: string, now?: number) => RateLimitSnapshot } {
  const buckets = new Map<string, Bucket>();
  const windowSec = Math.max(1, Math.round(windowMs / 1000));

  return {
    take(key: string, now = Date.now()): RateLimitSnapshot {
      const existing = buckets.get(key);
      if (!existing || now - existing.windowStart >= windowMs) {
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

/**
 * Client identity for rate limiting. Uses the first forwarded hop when present
 * (Vercel sets X-Forwarded-For) and falls back to a shared "local" key.
 *
 * @param request - Incoming request.
 */
export function rateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
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
