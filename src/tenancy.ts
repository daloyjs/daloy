/**
 * Multitenancy primitive.
 *
 * `tenancy(opts)` returns a `Hooks` bundle that resolves the calling tenant
 * once per request, validates and normalizes it, and exposes it on
 * `ctx.state.tenant` for handlers and downstream middleware. It is the
 * single source of truth for "who is this request for" so the per-tenant
 * isolation knobs on the rest of the framework (`rateLimit` /
 * `responseCache` `keyGenerator`, `concurrencyLimit` / `idempotency` `scope`)
 * can all key off the same resolved value via {@link tenantScope}.
 *
 * Secure-by-default posture:
 *
 * - **Refuse-unresolved.** With the default `require: true`, a request whose
 *   tenant cannot be resolved is rejected (`400`) rather than silently served
 *   as some ambient "default" tenant — the failure mode that leaks one
 *   tenant's data to another.
 * - **Format-validated ids.** Resolved ids are normalized to a conservative
 *   `[a-z0-9_-]` charset before they are stored or used as a key. A tenant id
 *   pulled from a spoofable header can otherwise smuggle newlines, `:`, `/`,
 *   or `*` into rate-limit keys, cache keys, and log lines (key/log injection,
 *   cache poisoning). Anything that fails the pattern is treated as an unknown
 *   tenant.
 * - **No enumeration.** An id that resolves but is not in your `allow`
 *   list/validator is rejected as `404 Not Found` by default, so probing for
 *   valid tenant names cannot be distinguished from hitting a missing route.
 * - **Host-spoof safe.** {@link tenantFromSubdomain} treats a `Host` that is
 *   not under the declared `baseDomain` as unresolved instead of trusting it.
 *
 * Ordering: `tenancy()` resolves in `beforeHandle`, and so do the isolation
 * primitives that consume the result. Register `tenancy()` **before** them
 * (as the first group hook, or in `AppOptions.hooks`) so `ctx.state.tenant`
 * is populated by the time their `keyGenerator` / `scope` callbacks run.
 *
 * ```ts
 * import { App, tenancy, tenantFromSubdomain, tenantScope, rateLimit } from "@daloyjs/core";
 *
 * const app = new App({
 *   hooks: tenancy({
 *     resolve: tenantFromSubdomain({ baseDomain: "example.com" }),
 *     allow: ["acme", "globex"],
 *   }),
 * });
 *
 * // Per-tenant rate-limit buckets keyed off the resolved tenant.
 * app.use(rateLimit({ windowMs: 60_000, max: 100, keyGenerator: tenantScope() }));
 * ```
 *
 * @since 0.42.0
 */

import type { BaseContext, Hooks } from "./types.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "./errors.js";
import { subdomains } from "./subdomains.js";

/**
 * Resolves a raw (un-normalized) tenant id from a request, or a nullish value
 * when this strategy cannot determine one. Resolvers are tried in order and
 * the first non-empty result wins.
 *
 * @since 0.42.0
 */
export type TenantResolver = (
  ctx: BaseContext<any, any>,
) => string | null | undefined | Promise<string | null | undefined>;

/**
 * Conservative default tenant-id grammar: a DNS-label-like token, lowercase
 * `a-z0-9` with internal `-`/`_`, 1–63 chars, no leading/trailing separator.
 * Deliberately strict so a resolved id is always safe to embed in a key or a
 * log line.
 */
const DEFAULT_TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

/**
 * Default normalizer: trim, lowercase, and accept only ids matching
 * {@link DEFAULT_TENANT_PATTERN}. Returns `undefined` for anything else, which
 * the middleware treats as an unknown tenant.
 *
 * @param raw - The raw value produced by a {@link TenantResolver}.
 * @returns The normalized id, or `undefined` when it is not a valid tenant id.
 * @since 0.42.0
 */
export function defaultTenantNormalize(raw: string): string | undefined {
  const id = raw.trim().toLowerCase();
  return DEFAULT_TENANT_PATTERN.test(id) ? id : undefined;
}

/** Options for {@link tenantFromSubdomain}. @since 0.42.0 */
export interface SubdomainTenantOptions {
  /**
   * Explicit registrable base domain (e.g. `"example.com"`). Strongly
   * recommended in production: a `Host` that is not under this base is treated
   * as unresolved rather than trusted, which defends against `Host`-header
   * spoofing. When omitted, the PSL snapshot is used to split the host.
   */
  baseDomain?: string;
  /**
   * Which subdomain label to use, counting from the left (`0` = leftmost).
   * For `acme.example.com` the default `0` yields `"acme"`. Default `0`.
   */
  index?: number;
  /** Forwarded to {@link subdomains}: extra public-suffix entries. */
  extraSuffixes?: readonly string[];
  /**
   * Forwarded to {@link subdomains}: enables the production staleness check on
   * the bundled Public Suffix List snapshot. Default `false`.
   */
  production?: boolean;
}

/**
 * Resolve the tenant from a request subdomain using the PSL-aware
 * {@link subdomains} helper. `acme.example.com` → `"acme"`.
 *
 * A `Host` that is not under the declared `baseDomain` resolves to `undefined`
 * (unresolved) instead of throwing, so a spoofed `Host` becomes a clean
 * rejection rather than a `500`.
 *
 * @param opts - Subdomain resolution options.
 * @returns A {@link TenantResolver}.
 * @since 0.42.0
 */
export function tenantFromSubdomain(opts: SubdomainTenantOptions = {}): TenantResolver {
  const index = opts.index ?? 0;
  const base = opts.baseDomain?.toLowerCase();
  return (ctx) => {
    let hostname: string;
    try {
      hostname = new URL(ctx.request.url).hostname.toLowerCase();
    } catch {
      return undefined;
    }
    if (!hostname) return undefined;
    if (base && hostname !== base && !hostname.endsWith(`.${base}`)) {
      // Host is not under the declared base — possible spoofing. Resolve to
      // unresolved instead of letting subdomains() throw.
      return undefined;
    }
    const { labels } = subdomains(hostname, {
      baseDomain: opts.baseDomain,
      extraSuffixes: opts.extraSuffixes,
      production: opts.production,
    });
    return labels[index];
  };
}

/**
 * Resolve the tenant from a request header (e.g. `"x-tenant-id"`).
 *
 * **Security:** request headers are client-controlled. Only use this behind a
 * trusted proxy/load balancer that *overwrites* the header on every inbound
 * request — otherwise a caller can set it to any tenant. Pair with
 * {@link TenancyOptions.allow} to bound the accepted values.
 *
 * @param headerName - Header to read (case-insensitive).
 * @returns A {@link TenantResolver}.
 * @since 0.42.0
 */
export function tenantFromHeader(headerName: string): TenantResolver {
  const name = headerName.toLowerCase();
  return (ctx) => ctx.request.headers.get(name) ?? undefined;
}

/** Options for {@link tenantFromPathPrefix}. @since 0.42.0 */
export interface PathPrefixTenantOptions {
  /**
   * Which non-empty path segment to use, counting from the left (`0` = first).
   * For `/acme/orders` the default `0` yields `"acme"`. Default `0`.
   */
  segment?: number;
}

/**
 * Resolve the tenant from a path segment. `/acme/orders` → `"acme"`.
 *
 * Note: this only reads the id; it does not rewrite the path, so your routes
 * still include the tenant segment (e.g. register `/:tenant/orders`, or read
 * `ctx.state.tenant` and ignore the segment in the handler).
 *
 * @param opts - Path-prefix resolution options.
 * @returns A {@link TenantResolver}.
 * @since 0.42.0
 */
export function tenantFromPathPrefix(opts: PathPrefixTenantOptions = {}): TenantResolver {
  const segment = opts.segment ?? 0;
  return (ctx) => {
    let pathname: string;
    try {
      pathname = new URL(ctx.request.url).pathname;
    } catch {
      return undefined;
    }
    const parts = pathname.split("/").filter(Boolean);
    return parts[segment];
  };
}

/** Options for {@link tenantFromClaim}. @since 0.42.0 */
export interface ClaimTenantOptions {
  /**
   * `ctx.state` key holding the authenticated principal. Default `"auth"`,
   * matching the first-party auth helpers which write an
   * `{ scheme, credentials }` context to `ctx.state.auth`. The claim is read
   * from `credentials[claim]` when present, otherwise from `node[claim]`.
   */
  stateKey?: string;
}

/**
 * Resolve the tenant from a verified auth claim already on `ctx.state`
 * (e.g. an `org` / `tenant` JWT claim). Reads `ctx.state.auth.credentials`
 * (the {@link AuthContext} shape) or, if there is no `credentials` field, the
 * state node itself.
 *
 * **Ordering:** the auth middleware that populates the claim must run *before*
 * `tenancy()`. Register your verifier first, then `tenancy()`.
 *
 * @param claim - Claim/property name carrying the tenant id.
 * @param opts - Where to read the principal from.
 * @returns A {@link TenantResolver}.
 * @since 0.42.0
 */
export function tenantFromClaim(claim: string, opts: ClaimTenantOptions = {}): TenantResolver {
  const stateKey = opts.stateKey ?? "auth";
  return (ctx) => {
    const node = (ctx.state as Record<string, unknown>)[stateKey];
    if (!node || typeof node !== "object") return undefined;
    const withCreds = node as { credentials?: unknown };
    const source =
      withCreds.credentials && typeof withCreds.credentials === "object"
        ? (withCreds.credentials as Record<string, unknown>)
        : (node as Record<string, unknown>);
    const value = source[claim];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
  };
}

/** Status codes acceptable for an unresolved-tenant rejection. @since 0.42.0 */
export type UnresolvedStatus = 400 | 401 | 403 | 404;
/** Status codes acceptable for an unknown/disallowed-tenant rejection. @since 0.42.0 */
export type InvalidStatus = 400 | 403 | 404;

/** Options for {@link tenancy}. @since 0.42.0 */
export interface TenancyOptions {
  /**
   * One resolver, or several tried in order until one returns a non-empty
   * value. Combine e.g. `[tenantFromClaim("org"), tenantFromSubdomain(...)]`
   * to prefer a verified claim and fall back to the subdomain.
   */
  resolve: TenantResolver | TenantResolver[];
  /**
   * Reject requests whose tenant cannot be resolved. Default `true`. Set to
   * `false` only when some routes are legitimately tenant-less; the request
   * then proceeds with `ctx.state.tenant` left `undefined`.
   */
  require?: boolean;
  /**
   * Bound the accepted tenant space: an array allowlist, or an (optionally
   * async) validator `(id, ctx) => boolean`. A resolved id that fails is
   * rejected with {@link invalidStatus}. Array entries are validated against
   * the normalizer at construction time (a malformed entry throws).
   */
  allow?: readonly string[] | ((tenantId: string, ctx: BaseContext<any, any>) => boolean | Promise<boolean>);
  /**
   * Normalize/validate a raw resolved id. Return `undefined` to reject it.
   * Default {@link defaultTenantNormalize} (trim + lowercase + strict charset).
   */
  normalize?: (raw: string) => string | undefined;
  /** `ctx.state` key the resolved tenant id is written to. Default `"tenant"`. */
  stateKey?: string;
  /** Status for an unresolved tenant when `require` is true. Default `400`. */
  unresolvedStatus?: UnresolvedStatus;
  /** Status for a resolved-but-disallowed tenant. Default `404` (no enumeration). */
  invalidStatus?: InvalidStatus;
}

/** Build the right `HttpError` for a configured status. */
function rejection(status: UnresolvedStatus | InvalidStatus, detail: string): Error {
  switch (status) {
    case 401:
      return new UnauthorizedError(detail);
    case 403:
      return new ForbiddenError(detail);
    case 404:
      return new NotFoundError(detail);
    default:
      return new BadRequestError(detail);
  }
}

/**
 * Multitenancy middleware. Resolves, validates, and normalizes the tenant for
 * each request and stores it on `ctx.state[stateKey]` (default `tenant`).
 * See the module overview for the secure-by-default posture and ordering
 * rules.
 *
 * @param opts - Resolution, validation, and rejection configuration.
 * @returns A `Hooks` object for `app.use(...)` or `new App({ hooks })`.
 * @throws If no resolver is supplied, or an `allow` array entry is not a valid
 *   tenant id under the configured normalizer.
 * @since 0.42.0
 */
export function tenancy(opts: TenancyOptions): Hooks {
  const resolvers = Array.isArray(opts.resolve) ? opts.resolve : [opts.resolve];
  if (resolvers.length === 0) {
    throw new Error("tenancy(): at least one resolver is required.");
  }
  const stateKey = opts.stateKey ?? "tenant";
  const required = opts.require ?? true;
  const normalize = opts.normalize ?? defaultTenantNormalize;
  const unresolvedStatus = opts.unresolvedStatus ?? 400;
  const invalidStatus = opts.invalidStatus ?? 404;

  // Pre-normalize an array allowlist so comparisons are apples-to-apples, and
  // fail fast on a misconfigured entry rather than silently never matching it.
  let allowSet: Set<string> | undefined;
  let allowFn: ((id: string, ctx: BaseContext<any, any>) => boolean | Promise<boolean>) | undefined;
  if (Array.isArray(opts.allow)) {
    allowSet = new Set();
    for (const entry of opts.allow) {
      const n = normalize(entry);
      if (n === undefined) {
        throw new Error(
          `tenancy(): allowlist entry ${JSON.stringify(entry)} is not a valid tenant id.`,
        );
      }
      allowSet.add(n);
    }
  } else if (typeof opts.allow === "function") {
    allowFn = opts.allow;
  }

  return {
    async beforeHandle(ctx) {
      let raw: string | null | undefined;
      for (const resolve of resolvers) {
        raw = await resolve(ctx);
        if (raw != null && raw !== "") break;
      }

      if (raw == null || raw === "") {
        if (required) {
          throw rejection(unresolvedStatus, "Could not determine the tenant for this request.");
        }
        return; // optional tenancy: proceed tenant-less
      }

      const id = normalize(raw);
      if (id === undefined) {
        // Malformed id — reject as unknown so a poisoned value never reaches a
        // key or log line, and without revealing it was a format problem.
        throw rejection(invalidStatus, "Unknown tenant.");
      }

      if (allowSet && !allowSet.has(id)) {
        throw rejection(invalidStatus, "Unknown tenant.");
      }
      if (allowFn && !(await allowFn(id, ctx))) {
        throw rejection(invalidStatus, "Unknown tenant.");
      }

      (ctx.state as Record<string, unknown>)[stateKey] = id;
    },
  };
}

/** Options for {@link tenantScope}. @since 0.42.0 */
export interface TenantScopeOptions {
  /** `ctx.state` key the tenant id was written to. Default `"tenant"`. */
  stateKey?: string;
  /**
   * Key returned when no tenant is present (only reachable with
   * `tenancy({ require: false })`). Default `"tenant:unknown"`.
   */
  fallback?: string;
}

/**
 * Build a `(ctx) => string` key function that reads the resolved tenant and
 * returns a `tenant:<id>` partition key. Drop it straight into the isolation
 * knobs so each tenant gets its own bucket/namespace and cannot see, exhaust,
 * or poison another tenant's:
 *
 * ```ts
 * const scope = tenantScope();
 * rateLimit({ windowMs: 60_000, max: 100, keyGenerator: scope });
 * concurrencyLimit({ maxConcurrent: 20, scope });
 * idempotency({ scope });    // CWE-524 cross-tenant cache defense
 * // responseCache's keyGenerator REPLACES the whole key and it takes
 * // ttlSeconds, so fold the tenant in alongside the path yourself:
 * responseCache({
 *   ttlSeconds: 30,
 *   keyGenerator: (ctx) => {
 *     const u = new URL(ctx.request.url);
 *     return `${scope(ctx)}:${ctx.request.method} ${u.pathname}${u.search}`;
 *   },
 * });
 * ```
 *
 * The `tenant:` prefix keeps these keys from colliding with other key spaces
 * (e.g. `concurrencyLimit`'s literal `"global"` bucket).
 *
 * @param opts - Where to read the tenant from and the tenant-less fallback.
 * @returns A key function suitable for `keyGenerator` / `scope`.
 * @since 0.42.0
 */
export function tenantScope(
  opts: TenantScopeOptions = {},
): (ctx: BaseContext<any, any>) => string {
  const stateKey = opts.stateKey ?? "tenant";
  const fallback = opts.fallback ?? "tenant:unknown";
  return (ctx) => {
    const value = (ctx.state as Record<string, unknown>)[stateKey];
    return typeof value === "string" && value.length > 0 ? `tenant:${value}` : fallback;
  };
}
