/**
 * Shared constants for the HTTP APIs hosted on daloyjs.dev.
 *
 * These are the machine APIs of the project site (discovery, MCP, OAuth
 * metadata), not the APIs a DaloyJS application generates for itself.
 */

import { SITE_URL } from "@/lib/seo";

/** Current URL-path major for website HTTP APIs. */
export const SITE_API_VERSION = "1";

/** Canonical versioned catalog path. */
export const SITE_API_V1_PATH = "/api/v1";

/**
 * The only OAuth scope this origin issues. It covers read-only access to
 * already-public documentation surfaces (MCP, OpenAPI, llms.txt, Markdown).
 * Resources remain reachable without a token; the scope exists so agents can
 * request least privilege instead of inventing roles from prose.
 */
export const DOCS_READ_SCOPE = "docs:read";

/** Default token lifetime in seconds. */
export const ACCESS_TOKEN_TTL_SEC = 3600;

/** Requests allowed per client key per window. */
export const SITE_API_RATE_LIMIT = 120;

/** Rate-limit window length in seconds. */
export const SITE_API_RATE_WINDOW_SEC = 60;

/** Issuer identifier for RFC 8414 (no path, no trailing slash). */
export const OAUTH_ISSUER = SITE_URL;

export const OAUTH_AUTHORIZATION_ENDPOINT = `${SITE_URL}/oauth/authorize`;
export const OAUTH_TOKEN_ENDPOINT = `${SITE_URL}/oauth/token`;
export const OAUTH_INTROSPECTION_ENDPOINT = `${SITE_URL}/oauth/introspect`;
export const OAUTH_AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const OAUTH_OIDC_DISCOVERY_PATH = "/.well-known/openid-configuration";
export const OAUTH_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource";

/**
 * Minimum notice, in days, between announcing a retirement (Deprecation +
 * Sunset headers) and actually removing a surface.
 */
export const SITE_API_SUNSET_NOTICE_DAYS = 180;

/**
 * Request header agents may send to pin the URL-path major they were built
 * against. Echoed on every API response. An unsupported value is a 400
 * `unsupported_api_version` problem rather than a silent behavior change.
 */
export const SITE_API_VERSION_HEADER = "API-Version";

/**
 * Values accepted in the {@link SITE_API_VERSION_HEADER} request header for
 * the current major. Matching is case-insensitive.
 */
export const SITE_API_VERSION_ALIASES = ["1", "v1", "1.0", "1.0.0"] as const;

/** Absolute URL of the page documenting the versioning + deprecation policy. */
export const SITE_API_LIFECYCLE_DOC_URL = `${SITE_URL}/docs/api-lifecycle`;

/**
 * Human-readable versioning and deprecation policy. Published in the OpenAPI
 * `info.description` and on `GET /api/v1` so agents do not have to infer it.
 */
export const SITE_API_VERSIONING_POLICY = [
  `Website HTTP APIs are versioned in the URL path (${SITE_API_V1_PATH}) and echoed on the API-Version response header.`,
  "The unversioned /api alias redirects to the current major.",
  "Breaking changes ship as a new path major (/api/v2). The previous major keeps serving until it is retired.",
  'Retirement is signaled at least 180 days in advance with Deprecation (RFC 9745) and Sunset (RFC 8594) response headers plus a rel="sunset" Link. v1 has no announced sunset.',
  "MCP uses MCP-Protocol-Version on /mcp, not this path scheme.",
].join(" ");
