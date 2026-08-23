/**
 * RFC 9457 problem+json helpers for agent-readable error responses.
 *
 * HTML error pages are unusable to agents. Every HTTP error this site's APIs
 * emit is a JSON document with a stable `code`, a human `detail`, and a
 * `hint` that tells the caller what to do next (open the catalog, send a
 * different `Accept`, POST instead of GET, …).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */

import { SITE_URL } from "@/lib/seo";

/** RFC 9457 problem details plus the agent-facing `code` and `hint` fields. */
export type ProblemDetails = {
  /** URI identifying the problem type (stable, documentable). */
  type: string;
  /** Short, human-readable summary. */
  title: string;
  /** HTTP status code, matching the response. */
  status: number;
  /** Occurrence-specific explanation. */
  detail: string;
  /** Machine-readable error code (snake_case). */
  code: string;
  /** What the caller should do next. */
  hint: string;
  /** The request path this problem applies to, when known. */
  instance?: string;
};

const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/**
 * Absolute `type` URI for a site error code.
 *
 * @param code - Snake-case error code, e.g. `not_found`.
 */
export function problemType(code: string): string {
  return `${SITE_URL}/errors/${code.replaceAll("_", "-")}`;
}

/**
 * Serialize a problem-details object to JSON. Field order is stable so tests
 * and humans can read it: the RFC members first, then `code` / `hint`.
 *
 * @param problem - Problem details to serialize.
 */
export function serializeProblem(problem: ProblemDetails): string {
  return JSON.stringify({
    type: problem.type,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    instance: problem.instance,
    code: problem.code,
    hint: problem.hint,
  });
}

/**
 * Build a `Response` for a problem+json error. Always sets `Vary: Accept` so a
 * cached HTML 404 cannot be replayed to an agent that asked for JSON.
 *
 * @param problem - Problem details. `status` becomes the HTTP status.
 * @param extraHeaders - Optional extra response headers (CORS, Allow, …).
 */
export function problemResponse(
  problem: ProblemDetails,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", PROBLEM_CONTENT_TYPE);
  const vary = headers.get("vary");
  if (!vary) {
    headers.set("Vary", "Accept, Accept-Encoding");
  } else if (!vary.toLowerCase().includes("accept")) {
    headers.set("Vary", `${vary}, Accept`);
  }

  return new Response(serializeProblem(problem), {
    status: problem.status,
    headers,
  });
}

/**
 * 404 problem for a missing API resource or site path.
 *
 * @param instance - Request pathname.
 */
export function notFoundProblem(instance: string): ProblemDetails {
  return {
    type: problemType("not_found"),
    title: "Not Found",
    status: 404,
    detail: `No resource exists at ${instance}.`,
    code: "not_found",
    hint: `List available HTTP APIs at GET ${SITE_URL}/api, the OpenAPI document at GET ${SITE_URL}/openapi.json, or the agent index at GET ${SITE_URL}/llms.txt.`,
    instance,
  };
}

/**
 * 405 problem when an API is reached with the wrong method.
 *
 * @param instance - Request pathname.
 * @param allow - Allowed methods, e.g. `"GET, OPTIONS"`.
 * @param detail - What this endpoint actually expects.
 */
export function methodNotAllowedProblem(
  instance: string,
  allow: string,
  detail: string,
): ProblemDetails {
  return {
    type: problemType("method_not_allowed"),
    title: "Method Not Allowed",
    status: 405,
    detail,
    code: "method_not_allowed",
    hint: `Retry with one of: ${allow}. See GET ${SITE_URL}/openapi.json for the contract.`,
    instance,
  };
}

/**
 * 406 problem when `Accept` cannot be satisfied.
 *
 * @param instance - Request pathname.
 * @param available - Media types this URL can produce.
 */
export function notAcceptableProblem(
  instance: string,
  available: readonly string[],
): ProblemDetails {
  return {
    type: problemType("not_acceptable"),
    title: "Not Acceptable",
    status: 406,
    detail: `This URL cannot produce a representation matching the request Accept header. Available: ${available.join(", ")}.`,
    code: "not_acceptable",
    hint: `Send Accept: text/markdown for Markdown, Accept: text/html for HTML, or call the JSON APIs at ${SITE_URL}/api and ${SITE_URL}/openapi.json.`,
    instance,
  };
}

/**
 * 400 problem for a malformed API request.
 *
 * @param instance - Request pathname.
 * @param detail - What was wrong with the request.
 */
export function badRequestProblem(
  instance: string,
  detail: string,
): ProblemDetails {
  return {
    type: problemType("bad_request"),
    title: "Bad Request",
    status: 400,
    detail,
    code: "bad_request",
    hint: `Compare your request to GET ${SITE_URL}/openapi.json. JSON APIs expect Content-Type: application/json and a body that matches the documented schema.`,
    instance,
  };
}

/**
 * 429 problem when a caller has exhausted the advertised rate limit.
 *
 * @param instance - Request pathname.
 * @param retryAfterSec - Seconds the caller should wait (also sent as Retry-After).
 */
export function tooManyRequestsProblem(
  instance: string,
  retryAfterSec: number,
): ProblemDetails {
  return {
    type: problemType("rate_limited"),
    title: "Too Many Requests",
    status: 429,
    detail: `Rate limit exceeded. Wait ${retryAfterSec} seconds before retrying.`,
    code: "rate_limited",
    hint: `Honor Retry-After and the RateLimit headers, then retry. The default quota is documented in GET ${SITE_URL}/openapi.json.`,
    instance,
  };
}
