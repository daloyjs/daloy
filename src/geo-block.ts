/**
 * Country-level access control for {@link Hooks}. The {@link geoBlock}
 * middleware enforces ISO 3166-1 alpha-2 country allow- and deny-lists by
 * mapping the client IP to a country **using an operator-supplied lookup** —
 * Daloy bundles no GeoIP database and adds no runtime dependency, keeping the
 * `@daloyjs/core` zero-dependency floor intact.
 *
 * Two resolution strategies are supported, exactly one of which must be wired:
 *
 * - `lookupCountry(ip)` — you own the IP → country mapping (e.g. a MaxMind
 *   GeoLite2 reader, an `ip2location` reader, or your own table). Daloy
 *   resolves the client IP (reusing the same `X-Forwarded-For` / `X-Real-IP`
 *   handling as {@link "./ip-restriction.js".ipRestriction}) and hands you the
 *   string.
 * - `resolveCountry(ctx)` — the country is already attached to the request by
 *   an upstream edge (e.g. Cloudflare's `CF-IPCountry`, AWS CloudFront's
 *   `CloudFront-Viewer-Country`, Vercel's `x-vercel-ip-country`); you read it
 *   straight off the context.
 *
 * Like the other network guards this fails **closed for allow-lists** (an
 * unknown country is rejected when an allow-list is configured) and **open for
 * deny-only** configurations, so a missing lookup cannot silently widen access.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError } from "./errors.js";

/**
 * Why a request was (or would have been) blocked by {@link geoBlock}.
 *
 * - `"denied_country"` — the resolved country is on the `deny` list.
 * - `"not_in_allowlist"` — an `allow` list is configured and the resolved
 *   country is not on it.
 * - `"unknown_country"` — the country could not be resolved and
 *   `allowUnknownCountry` was `false`.
 *
 * @since 0.37.0
 */
export type GeoBlockReason = "denied_country" | "not_in_allowlist" | "unknown_country";

/**
 * The decision {@link geoBlock} reached for a request, passed to `onBlock` and
 * stamped (for allowed requests) on `ctx.state[stateKey]`.
 *
 * @since 0.37.0
 */
export interface GeoBlockDecision {
  /** Resolved client IP, when the `lookupCountry` strategy was used. */
  readonly ip?: string;
  /** Resolved ISO 3166-1 alpha-2 country code (upper-cased), if known. */
  readonly country?: string;
  /** Why the request was blocked. */
  readonly reason: GeoBlockReason;
}

/**
 * Country code resolved from the client context (e.g. an edge-injected
 * header). Return `undefined`/`null`/`""` when the country is unknown.
 *
 * @since 0.37.0
 */
export type CountryFromContext = (
  ctx: BaseContext<any, any>
) => string | undefined | null | Promise<string | undefined | null>;

/**
 * Operator-supplied IP → country lookup (e.g. a MaxMind reader). Return
 * `undefined`/`null`/`""` when the IP cannot be mapped to a country.
 *
 * @since 0.37.0
 */
export type CountryFromIp = (
  ip: string
) => string | undefined | null | Promise<string | undefined | null>;

/**
 * What to record on `ctx.state[stateKey]` for an allowed request.
 *
 * @since 0.37.0
 */
export interface GeoState {
  /** Resolved ISO 3166-1 alpha-2 country code (upper-cased), if known. */
  readonly country?: string;
}

/**
 * Options for {@link geoBlock}. At least one of `allow` or `deny` must be a
 * non-empty list, and exactly one of `lookupCountry` or `resolveCountry` must
 * be provided.
 *
 * @since 0.37.0
 */
export interface GeoBlockOptions {
  /**
   * ISO 3166-1 alpha-2 country codes (case-insensitive) that are allowed.
   * When non-empty, any request whose resolved country is not on this list is
   * rejected. An unknown country is rejected too unless
   * `allowUnknownCountry` is set.
   */
  allow?: readonly string[];
  /**
   * ISO 3166-1 alpha-2 country codes (case-insensitive) that are always
   * rejected. A `deny` match wins over an `allow` match (least privilege).
   */
  deny?: readonly string[];
  /**
   * Operator-supplied IP → country mapping. Mutually exclusive with
   * `resolveCountry`. Daloy resolves the client IP first (see `resolveIp` /
   * `trustProxyHeaders`) and passes it to this function.
   */
  lookupCountry?: CountryFromIp;
  /**
   * Read the country straight off the request context (e.g. an edge header
   * such as `CF-IPCountry`). Mutually exclusive with `lookupCountry`.
   */
  resolveCountry?: CountryFromContext;
  /**
   * Override the source of the client IP for the `lookupCountry` strategy. By
   * default Daloy fails closed because Web-standard `Request` objects do not
   * expose the peer address. Ignored when `resolveCountry` is used.
   */
  resolveIp?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Read `X-Forwarded-For` / `X-Real-IP` in the default IP resolver. Defaults
   * to `false` because those headers are client-spoofable unless every
   * request reaches Daloy through a proxy chain you control. Ignored when
   * `resolveCountry` is used or a custom `resolveIp` is supplied.
   */
  trustProxyHeaders?: boolean;
  /**
   * What to do when the country cannot be resolved. Defaults to `false` when
   * an `allow` list is configured (fail closed — an unknown country is not on
   * the allow-list) and `true` for deny-only configurations (fail open). Set
   * explicitly to override.
   */
  allowUnknownCountry?: boolean;
  /**
   * `"block"` (default) rejects with HTTP `403`; `"log"` lets the request
   * through after invoking `onBlock`, for safe rollout / monitoring.
   */
  mode?: "block" | "log";
  /**
   * Response message when a request is rejected. Defaults to
   * `"Access from your region is not permitted"`. Avoid echoing the country
   * or IP — doing so can leak topology to attackers.
   */
  message?: string;
  /**
   * Observability hook invoked for every blocked (or, in `"log"` mode,
   * would-be-blocked) request. Never receives allowed requests.
   */
  onBlock?: (decision: GeoBlockDecision) => void;
  /**
   * `ctx.state` key under which the resolved {@link GeoState} is stamped for
   * allowed requests. Defaults to `"geo"`.
   */
  stateKey?: string;
}

/** @internal Validate + normalise a configured country code, or throw. */
function normalizeConfiguredCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(code)) {
    throw new Error(
      `geoBlock(): invalid country code ${JSON.stringify(input)}; expected a ` +
        "2-character ISO 3166-1 alpha-2 code."
    );
  }
  return code;
}

/** @internal Default resolver: deliberately yields nothing (fail closed). */
function noIpResolver(_ctx: BaseContext<any, any>): string | undefined {
  return undefined;
}

/** @internal Read the leading `X-Forwarded-For` / `X-Real-IP` hop. */
function forwardedIpResolver(ctx: BaseContext<any, any>): string | undefined {
  const headers = ctx.request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return ctx.request.headers.get("x-real-ip") ?? undefined;
}

/**
 * Block or allow requests by client country. Daloy ships no GeoIP database;
 * supply either an IP → country `lookupCountry` (e.g. a MaxMind reader) or a
 * `resolveCountry` that reads an edge-injected country header.
 *
 * @example MaxMind-style IP lookup behind a trusted proxy
 * ```ts
 * import maxmind from "maxmind"; // operator dependency, not a Daloy one
 * const reader = await maxmind.open<{ country?: { iso_code?: string } }>("GeoLite2-Country.mmdb");
 * app.use(geoBlock({
 *   deny: ["KP", "IR"],
 *   trustProxyHeaders: true,
 *   lookupCountry: (ip) => reader.get(ip)?.country?.iso_code,
 * }));
 * ```
 *
 * @example Cloudflare edge header (no IP lookup needed)
 * ```ts
 * app.use(geoBlock({
 *   allow: ["US", "CA", "GB"],
 *   resolveCountry: (ctx) => ctx.request.headers.get("cf-ipcountry"),
 * }));
 * ```
 *
 * On reject the middleware throws a {@link ForbiddenError}, which Daloy renders
 * as RFC 9457 `application/problem+json` with `Cache-Control: no-store`.
 *
 * @param opts - Geo-blocking configuration.
 * @returns {@link Hooks} to register via `app.use(...)`.
 * @throws Error when neither `allow` nor `deny` is provided, when both or
 *   neither of `lookupCountry` / `resolveCountry` are provided, when a country
 *   code is malformed, or when `mode` is invalid.
 * @since 0.37.0
 */
export function geoBlock(opts: GeoBlockOptions): Hooks {
  if (!opts.allow?.length && !opts.deny?.length) {
    throw new Error('geoBlock(): at least one of "allow" or "deny" must be provided.');
  }
  const hasLookup = typeof opts.lookupCountry === "function";
  const hasResolve = typeof opts.resolveCountry === "function";
  if (hasLookup === hasResolve) {
    throw new Error(
      'geoBlock(): exactly one of "lookupCountry" or "resolveCountry" must ' + "be provided."
    );
  }
  if (opts.mode !== undefined && opts.mode !== "block" && opts.mode !== "log") {
    throw new Error(
      `geoBlock(): invalid mode ${JSON.stringify(opts.mode)}; expected ` + '"block" or "log".'
    );
  }

  const allow = new Set((opts.allow ?? []).map(normalizeConfiguredCode));
  const deny = new Set((opts.deny ?? []).map(normalizeConfiguredCode));
  // Allow-lists fail closed on an unknown country; deny-only fails open.
  const allowUnknown = opts.allowUnknownCountry ?? allow.size === 0;
  const mode = opts.mode ?? "block";
  const message = opts.message ?? "Access from your region is not permitted";
  const stateKey = opts.stateKey ?? "geo";
  const onBlock = opts.onBlock;
  const lookupCountry = opts.lookupCountry;
  const resolveCountry = opts.resolveCountry;
  const resolveIp = opts.resolveIp ?? (opts.trustProxyHeaders ? forwardedIpResolver : noIpResolver);

  return {
    async beforeHandle(ctx) {
      let ip: string | undefined;
      let rawCountry: string | undefined | null;
      if (resolveCountry) {
        rawCountry = await resolveCountry(ctx);
      } else {
        ip = resolveIp(ctx) ?? undefined;
        rawCountry = ip ? await lookupCountry!(ip) : undefined;
      }

      const country = rawCountry && rawCountry.trim() ? rawCountry.trim().toUpperCase() : undefined;

      let reason: GeoBlockReason | undefined;
      if (!country) {
        if (!allowUnknown) reason = "unknown_country";
      } else if (deny.has(country)) {
        reason = "denied_country";
      } else if (allow.size > 0 && !allow.has(country)) {
        reason = "not_in_allowlist";
      }

      if (reason) {
        const decision: GeoBlockDecision = {
          ...(ip ? { ip } : {}),
          ...(country ? { country } : {}),
          reason,
        };
        onBlock?.(decision);
        if (mode === "block") throw new ForbiddenError(message);
        return;
      }

      // Allowed: expose the resolved country to downstream handlers.
      const state: GeoState = country ? { country } : {};
      (ctx.state as Record<string, unknown>)[stateKey] = state;
    },
  };
}
