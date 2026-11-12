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
import {
  problemResponse,
  tooManyRequestsProblem,
  unsupportedApiVersionProblem,
} from "@/lib/problem-json";
import {
  SITE_API_VERSION,
  SITE_API_VERSION_ALIASES,
  SITE_API_VERSION_HEADER,
} from "@/lib/site-api";

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

  return {
    limited: true,
    snapshot,
    response: rateLimitedResponse(request, snapshot),
  };
}

/**
 * Build the 429 problem+json for a caller whose quota is exhausted, with
 * Retry-After and RateLimit headers.
 *
 * @param request - Incoming request (its path becomes the problem `instance`).
 * @param snapshot - The exhausted quota snapshot.
 * @returns The 429 response.
 */
export function rateLimitedResponse(
  request: Request,
  snapshot: RateLimitSnapshot,
): Response {
  const headers = siteApiHeaders(snapshot, {
    "Retry-After": String(snapshot.resetSec),
    // A 429 is per-caller and momentary. Never let a shared cache replay it.
    "cache-control": "no-store",
  });
  return problemResponse(
    tooManyRequestsProblem(new URL(request.url).pathname, snapshot.resetSec),
    headers,
  );
}

/**
 * Charge extra quota for work one request fans out into (for example the
 * additional messages of a JSON-RPC batch), so a single HTTP request cannot
 * buy many operations for one token.
 *
 * @param request - Incoming request (identifies the caller's bucket).
 * @param extra - Additional takes to charge; zero or less is a no-op.
 * @returns The snapshot after the last take, or `null` when nothing was charged.
 */
export function chargeSiteApiQuota(
  request: Request,
  extra: number,
): RateLimitSnapshot | null {
  let snapshot: RateLimitSnapshot | null = null;
  const key = rateLimitKey(request);
  for (let i = 0; i < extra; i++) {
    snapshot = siteApiRateLimiter.take(key);
  }
  return snapshot;
}

/**
 * Honor the optional `API-Version` request header.
 *
 * Absent header means "whatever this path serves", which is the documented
 * default. A header pinning the current major is accepted; anything else is a
 * 400 `unsupported_api_version` problem so an agent built against a future
 * major fails loudly instead of parsing the wrong shape.
 *
 * @param request - Incoming request.
 * @param headers - Headers to attach to the error response (RateLimit, CORS).
 * @returns `null` when the request may proceed, otherwise the 400 response.
 */
export function checkRequestedApiVersion(
  request: Request,
  headers: Record<string, string>,
): Response | null {
  const requested = request.headers.get(SITE_API_VERSION_HEADER)?.trim();
  if (!requested) {
    return null;
  }

  const normalized = requested.toLowerCase();
  if (
    SITE_API_VERSION_ALIASES.some((alias) => alias.toLowerCase() === normalized)
  ) {
    return null;
  }

  return problemResponse(
    unsupportedApiVersionProblem(new URL(request.url).pathname, requested, [
      SITE_API_VERSION,
    ]),
    headers,
  );
}
