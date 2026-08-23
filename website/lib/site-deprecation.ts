/**
 * Machine-readable lifecycle for the HTTP surfaces hosted on daloyjs.dev.
 *
 * Agents will not integrate against a surface that can change without warning,
 * so the versioning and retirement policy is published three ways that cannot
 * drift apart: the response headers emitted here, the `versioning` block on
 * `GET /api/v1`, and the OpenAPI document. All three read this module.
 *
 * Signals follow the published specs exactly:
 * - `Deprecation` is an RFC 9745 structured-field Date (`@<unix seconds>`).
 * - `Sunset` is an RFC 8594 IMF-fixdate.
 * - Link relations are IANA-registered: `deprecation` (RFC 9745), `sunset`
 *   (RFC 8594), `successor-version` and `latest-version` (RFC 5829).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9745
 * @see https://www.rfc-editor.org/rfc/rfc8594
 * @see https://www.rfc-editor.org/rfc/rfc5829
 */

import {
  SITE_API_LIFECYCLE_DOC_URL,
  SITE_API_SUNSET_NOTICE_DAYS,
  SITE_API_V1_PATH,
  SITE_API_VERSION,
  SITE_API_VERSION_HEADER,
} from "@/lib/site-api";
import { SITE_URL } from "@/lib/seo";

/** Whether a surface is the one to build against, or one on the way out. */
export type SurfaceStatus = "current" | "deprecated";

/** Lifecycle record for one HTTP surface on this origin. */
export type ApiSurface = {
  /** Stable identifier used in the `/api/v1` payload. */
  id: string;
  /** Path prefix this record covers. */
  path: string;
  /** What callers should expect from it. */
  status: SurfaceStatus;
  /**
   * Date the surface was announced as deprecated (`YYYY-MM-DD`, UTC), or
   * `null` while it is current.
   */
  deprecatedAt: string | null;
  /**
   * Date the surface stops answering (`YYYY-MM-DD`, UTC), or `null` when no
   * retirement has been scheduled. Never set less than
   * {@link SITE_API_SUNSET_NOTICE_DAYS} days ahead.
   */
  sunsetAt: string | null;
  /** Path callers should move to, when there is a drop-in replacement. */
  successor: string | null;
  /** One-line explanation carried into the `/api/v1` payload and OpenAPI. */
  summary: string;
};

/** Every versioned or aliased HTTP surface on daloyjs.dev. */
export const SITE_API_SURFACES: readonly ApiSurface[] = [
  {
    id: "api-v1",
    path: SITE_API_V1_PATH,
    status: "current",
    deprecatedAt: null,
    sunsetAt: null,
    successor: null,
    summary:
      "Current major of the website JSON catalog. No retirement is scheduled.",
  },
  {
    id: "docs-md",
    path: "/docs-md",
    status: "deprecated",
    deprecatedAt: "2026-08-23",
    sunsetAt: null,
    successor: "/md",
    summary:
      "Legacy Markdown handler kept for cached /docs/*.md destinations. Use /md/<path>, or Accept: text/markdown on the canonical URL. It keeps answering until a Sunset date is announced here at least 180 days ahead.",
  },
  {
    id: "md",
    path: "/md",
    status: "current",
    deprecatedAt: null,
    sunsetAt: null,
    successor: null,
    summary:
      "Markdown representation of any public page. Also selected by Accept: text/markdown on the canonical URL.",
  },
  {
    id: "api-alias",
    path: "/api",
    status: "current",
    deprecatedAt: null,
    sunsetAt: null,
    successor: SITE_API_V1_PATH,
    summary:
      "Unversioned alias. Permanently redirects to the current major so agents never pin an unversioned path.",
  },
] as const;

/**
 * Look up the lifecycle record covering a request path.
 *
 * @param pathname - Request pathname, without origin or query.
 * @returns The most specific matching surface, or `null` when the path is not
 *   a versioned or aliased API surface.
 */
export function findApiSurface(pathname: string): ApiSurface | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  let best: ApiSurface | null = null;
  for (const surface of SITE_API_SURFACES) {
    if (path !== surface.path && !path.startsWith(`${surface.path}/`)) {
      continue;
    }
    if (best === null || surface.path.length > best.path.length) {
      best = surface;
    }
  }
  return best;
}

/**
 * Seconds since the Unix epoch for a `YYYY-MM-DD` UTC date.
 *
 * @param isoDate - Calendar date in `YYYY-MM-DD` form.
 * @returns Whole seconds at midnight UTC, or `null` when the date is invalid.
 */
export function epochSeconds(isoDate: string): number | null {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * IMF-fixdate rendering of a `YYYY-MM-DD` UTC date, as RFC 8594 requires for
 * `Sunset`.
 *
 * @param isoDate - Calendar date in `YYYY-MM-DD` form.
 * @returns e.g. `Wed, 11 Nov 2026 00:00:00 GMT`, or `null` when invalid.
 */
export function httpDate(isoDate: string): string | null {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toUTCString();
}

/**
 * `Deprecation` and `Sunset` headers for a surface.
 *
 * Current surfaces get an empty object: emitting a deprecation signal for a
 * surface that is not deprecated would make the signal worthless.
 *
 * @param surface - Lifecycle record, typically from {@link findApiSurface}.
 * @returns Header name/value pairs to spread onto a response.
 */
export function deprecationHeaders(
  surface: ApiSurface,
): Record<string, string> {
  if (surface.status !== "deprecated" || surface.deprecatedAt === null) {
    return {};
  }

  const headers: Record<string, string> = {};
  const since = epochSeconds(surface.deprecatedAt);
  if (since !== null) {
    headers.Deprecation = `@${since}`;
  }
  if (surface.sunsetAt !== null) {
    const sunset = httpDate(surface.sunsetAt);
    if (sunset !== null) {
      headers.Sunset = sunset;
    }
  }
  return headers;
}

/**
 * RFC 8288 `Link` field values describing a surface's lifecycle.
 *
 * Emitted for current surfaces too: `latest-version` and `successor-version`
 * let an agent confirm it is on the right path without parsing prose.
 *
 * @param surface - Lifecycle record, typically from {@link findApiSurface}.
 * @returns Serialized `Link` values, ready to join with `", "`.
 */
export function surfaceLinkRelations(surface: ApiSurface): string[] {
  const relations: string[] = [];

  if (surface.status === "deprecated") {
    relations.push(
      `<${SITE_API_LIFECYCLE_DOC_URL}>; rel="deprecation"; type="text/html"`,
    );
    if (surface.sunsetAt !== null) {
      relations.push(
        `<${SITE_API_LIFECYCLE_DOC_URL}>; rel="sunset"; type="text/html"`,
      );
    }
  }

  if (surface.successor !== null) {
    relations.push(`<${surface.successor}>; rel="successor-version"`);
  }

  relations.push(`<${SITE_API_V1_PATH}>; rel="latest-version"`);
  return relations;
}

/**
 * The whole versioning + deprecation policy as data, for `GET /api/v1` and the
 * OpenAPI document.
 *
 * @returns A JSON-serializable policy object.
 */
export function apiLifecycleSummary(): Record<string, unknown> {
  return {
    current: SITE_API_VERSION,
    path: SITE_API_V1_PATH,
    header: SITE_API_VERSION_HEADER,
    documentation: SITE_API_LIFECYCLE_DOC_URL,
    sunsetNoticeDays: SITE_API_SUNSET_NOTICE_DAYS,
    signals: {
      deprecationHeader: "Deprecation",
      deprecationHeaderFormat:
        "RFC 9745 structured-field Date, e.g. @1756944000",
      sunsetHeader: "Sunset",
      sunsetHeaderFormat:
        "RFC 8594 IMF-fixdate, e.g. Wed, 11 Nov 2026 00:00:00 GMT",
      linkRelations: [
        "deprecation",
        "sunset",
        "successor-version",
        "latest-version",
      ],
    },
    surfaces: SITE_API_SURFACES.map((surface) => ({
      id: surface.id,
      path: surface.path,
      url: `${SITE_URL}${surface.path}`,
      status: surface.status,
      deprecatedAt: surface.deprecatedAt,
      sunsetAt: surface.sunsetAt,
      successor: surface.successor,
      summary: surface.summary,
    })),
  };
}
