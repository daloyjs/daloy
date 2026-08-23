/**
 * Shared response helpers for website HTTP APIs: rate-limit gate, API-Version,
 * and CORS. Callers still set Content-Type on the Response they build.
 */

import {
  rateLimitKey,
  siteApiHeaders,
  siteApiRateLimiter,
  type RateLimitSnapshot,
} from "@/lib/site-rate-limit";
import { tooManyRequestsProblem, problemResponse } from "@/lib/problem-json";

export type RateLimited = {
  limited: true;
  response: Response;
  snapshot: RateLimitSnapshot;
};

export type RateAllowed = {
  limited: false;
  snapshot: RateLimitSnapshot;
};

/**
 * Take one request from the site API quota. On overflow returns a 429
 * problem+json with Retry-After and RateLimit headers.
 *
 * @param request - Incoming request.
 */
export function consumeSiteApiQuota(
  request: Request,
): RateLimited | RateAllowed {
  const snapshot = siteApiRateLimiter.take(rateLimitKey(request));
  if (!snapshot.limited) {
    return { limited: false, snapshot };
  }

  const headers = siteApiHeaders(snapshot, {
    "Retry-After": String(snapshot.resetSec),
  });
  return {
    limited: true,
    snapshot,
    response: problemResponse(
      tooManyRequestsProblem(new URL(request.url).pathname, snapshot.resetSec),
      headers,
    ),
  };
}
