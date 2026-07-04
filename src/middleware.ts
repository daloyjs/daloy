/**
 * Built-in security & operational middleware.
 *
 * All middlewares return `Hooks` objects so they compose with `app.use(...)`,
 * groups, and per-route hooks identically.
 */

import type { Hooks, BaseContext } from "./types.js";
import { assertCookieAttributes, readRequestCookie, serializeCookie } from "./cookie.js";
import { TooManyRequestsError, ForbiddenError } from "./errors.js";
import { randomId, sanitizeHeaderName, timingSafeEqual } from "./security.js";

// ---------- Request ID ----------

/** Options for {@link requestId}. */
export interface RequestIdOptions {
  /** Header name to read/write. Default: `"x-request-id"`. */
  header?: string;
  /** Trust an incoming header value (e.g. from a proxy). Default: false. */
  trustIncoming?: boolean;
  /** Override the random id generator. Default: 16-byte URL-safe base64. */
  generator?: () => string;
}

/**
 * Generate or accept a stable `X-Request-ID` for every request. The id is
 * stamped on `ctx.state.requestId`, mirrored on outgoing response headers,
 * and available to handlers/middleware for log correlation.
 *
 * Pass `trustIncoming: true` only when the upstream proxy is trusted to
 * sanitize/replace the header — otherwise a client could pollute your logs
 * with arbitrary ids. Untrusted incoming values are also validated against
 * `^[A-Za-z0-9._-]{1,200}$` before being accepted.
 *
 * @example
 * ```ts
 * import { requestId } from "@daloyjs/core";
 * app.use(requestId({ trustIncoming: false }));
 * ```
 *
 * @param opts - Header name, trust flag, and custom id generator.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
export function requestId(opts: RequestIdOptions = {}): Hooks {
  const header = (opts.header ?? "x-request-id").toLowerCase();
  const gen = opts.generator ?? randomId;
  return {
    beforeHandle(ctx) {
      const incoming = opts.trustIncoming ? ctx.request.headers.get(header) : null;
      const id = incoming && /^[A-Za-z0-9._-]{1,200}$/.test(incoming) ? incoming : gen();
      (ctx.state as Record<string, unknown>).requestId = id;
      ctx.set.headers.set(header, id);
    },
  };
}

// ---------- Secure headers (Helmet-equivalent defaults) ----------

/**
 * Object form of the `contentSecurityPolicy` option that enables per-request
 * nonces and Trusted Types. When this form is used the CSP header is built
 * fresh for every request so the nonce value can be injected into
 * `script-src` / `style-src`, and `ctx.state.cspNonce` is exposed for
 * handlers that render inline `<script nonce="...">` / `<style nonce="...">`.
 *
 * @since 0.12.0
 */
export interface CspDirectivesOptions {
  /**
   * CSP directive map. Keys are directive names (`default-src`,
   * `script-src`, ...); values are source lists. Strings are split on
   * whitespace. Empty arrays are skipped.
   */
  directives: Record<string, string | string[]>;
  /**
   * When true, generate a 128-bit base64url nonce per request, stash it
   * on `ctx.state.cspNonce`, and append `'nonce-<value>'` to the
   * `script-src` and `style-src` directives (only when those directives
   * are already declared).
   */
  nonce?: boolean;
  /**
   * Emit `require-trusted-types-for 'script'`. Pass an object with
   * `policies` to also emit a `trusted-types <policy-names...>` directive.
   */
  trustedTypes?: boolean | { policies?: string[] };
  /**
   * When set, append `report-to <group>` to the generated CSP header so
   * browsers POST violation reports to the named Reporting API endpoint.
   * Pair with {@link SecureHeadersOptions.reportingEndpoints} (or
   * {@link App.cspReportRoute}) to register the receiver.
   *
   * @since 0.20.0
   */
  reportTo?: string;
}

/** Options for {@link secureHeaders}. Every field can be disabled with `false`. */
export interface SecureHeadersOptions {
  /**
   * `Content-Security-Policy` value: a raw header string, a
   * {@link CspDirectivesOptions} object (enables nonces / Trusted Types),
   * or `false` to omit. Defaults to
   * `"default-src 'self'; frame-ancestors 'none'"`.
   */
  contentSecurityPolicy?: string | false | CspDirectivesOptions;
  /**
   * `Strict-Transport-Security` settings (`maxAgeSeconds` in seconds).
   * Defaults to `{ maxAgeSeconds: 31536000, includeSubDomains: true }`.
   */
  hsts?: { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean } | false;
  /**
   * `X-Frame-Options` value. Defaults to `"DENY"`. Disabling it with
   * `false` while the CSP also lacks `frame-ancestors` throws at
   * construction time (clickjacking guard).
   */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  /** `Referrer-Policy` value. Defaults to `"no-referrer"`. */
  referrerPolicy?: string | false;
  /**
   * `Permissions-Policy` value. Defaults to
   * `"camera=(), microphone=(), geolocation=(), clipboard-write=()"`.
   */
  permissionsPolicy?: string | false;
  /** `Cross-Origin-Opener-Policy` value. Defaults to `"same-origin"`. */
  crossOriginOpenerPolicy?: string | false;
  /** `Cross-Origin-Resource-Policy` value. Defaults to `"same-origin"`. */
  crossOriginResourcePolicy?: string | false;
  /**
   * `Cross-Origin-Embedder-Policy` (COEP). Off by default because
   * `require-corp` breaks any cross-origin embed that has not opted in via
   * CORP or CORS — opt in explicitly when you want a
   * `crossOriginIsolated` document (enables `SharedArrayBuffer`,
   * high-resolution timers, and closes additional XS-Leaks side
   * channels). Recommended values: `"require-corp"` or
   * `"credentialless"`. See https://xsleaks.dev/docs/defenses/isolation-policies/coep/.
   *
   * @since 0.37.0
   */
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless" | "unsafe-none" | false;
  /** Emit `X-Content-Type-Options: nosniff`. Defaults to `true`. */
  noSniff?: boolean;
  /**
   * Emit `X-XSS-Protection: 0` (disables the legacy XSS auditor, per
   * modern guidance). Defaults to `false` (header omitted).
   */
  xssProtection?: boolean;
  /**
   * Reporting API endpoint declarations rendered as the
   * `Reporting-Endpoints` response header (modern browsers) plus a
   * legacy `Report-To` JSON header for older Chromium versions. Keys are
   * group names; values are absolute URLs that accept POSTed reports.
   * Pair with {@link CspDirectivesOptions.reportTo} (or pass
   * `reportTo: "csp-endpoint"` here as a shortcut) to direct CSP
   * violation reports there.
   *
   * @since 0.20.0
   */
  reportingEndpoints?: Record<string, string>;
  /**
   * Shortcut: when set and {@link SecureHeadersOptions.contentSecurityPolicy}
   * is a directives object, append `report-to <reportTo>` to the CSP
   * header so violation reports land at the matching
   * `reportingEndpoints` URL.
   *
   * @since 0.20.0
   */
  reportTo?: string;
}

const CSP_NONCE_STATE = "cspNonce";

function generateCspNonce(): string {
  const cryptoApi: Crypto | undefined = (globalThis as any).crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error(
      "secureHeaders(): WebCrypto is required to generate a CSP nonce. " +
        "Run on Node 20+, Bun, Deno, Cloudflare Workers, or Vercel."
    );
  }
  const nonceBytes = new Uint8Array(16);
  cryptoApi.getRandomValues(nonceBytes);
  let binary = "";
  for (let index = 0; index < nonceBytes.length; index++) {
    binary += String.fromCharCode(nonceBytes[index]!);
  }
  // base64url
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildCspHeader(opt: CspDirectivesOptions, nonce: string | undefined): string {
  const entries: Record<string, string[]> = {};
  for (const [directiveName, directiveValue] of Object.entries(opt.directives)) {
    const list = Array.isArray(directiveValue)
      ? directiveValue.slice()
      : directiveValue.split(/\s+/).filter(Boolean);
    if (list.length > 0) entries[directiveName] = list;
  }
  if (opt.nonce && nonce) {
    const nonceSrc = `'nonce-${nonce}'`;
    for (const directiveName of ["script-src", "script-src-elem", "style-src", "style-src-elem"]) {
      if (entries[directiveName]) entries[directiveName]!.push(nonceSrc);
    }
  }
  if (opt.trustedTypes) {
    entries["require-trusted-types-for"] = ["'script'"];
    const trustedTypes = opt.trustedTypes;
    if (typeof trustedTypes === "object" && trustedTypes.policies?.length) {
      entries["trusted-types"] = trustedTypes.policies.slice();
    }
  }
  if (opt.reportTo) {
    entries["report-to"] = [opt.reportTo];
  }
  const parts: string[] = [];
  for (const [directiveName, sources] of Object.entries(entries)) {
    parts.push(`${directiveName} ${sources.join(" ")}`);
  }
  return parts.join("; ");
}

function cspSourceListHasValues(directiveValue: string | string[]): boolean {
  return Array.isArray(directiveValue)
    ? directiveValue.some((source) => source.trim().length > 0)
    : directiveValue.split(/\s+/).some((source) => source.length > 0);
}

function cspStringHasFrameAncestors(csp: string): boolean {
  return csp.split(";").some((directivePart) => {
    const tokens = directivePart.trim().split(/\s+/).filter(Boolean);
    const directiveName = tokens[0];
    return directiveName?.toLowerCase() === "frame-ancestors" && tokens.length > 1;
  });
}

function cspOptionsHaveFrameAncestors(csp: CspDirectivesOptions): boolean {
  for (const [directiveName, directiveValue] of Object.entries(csp.directives)) {
    if (
      directiveName.toLowerCase() === "frame-ancestors" &&
      cspSourceListHasValues(directiveValue)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Apply a Helmet-equivalent baseline of secure response headers:
 * `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
 * `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
 * `Cross-Origin-Resource-Policy`, and `X-Content-Type-Options: nosniff`.
 *
 * Every header has a hardened default and can be overridden — pass `false`
 * to disable an individual header entirely. Headers are only set if the
 * handler did not already set them, so per-route overrides win.
 *
 * @example
 * ```ts
 * import { secureHeaders } from "@daloyjs/core";
 *
 * app.use(secureHeaders({
 *   contentSecurityPolicy: "default-src 'self'; img-src 'self' data:",
 *   hsts: { maxAgeSeconds: 31536000, includeSubDomains: true, preload: true },
 * }));
 * ```
 *
 * @param opts - Per-header overrides. Pass `false` to disable a header.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
/**
 * Marker stamped on the `Hooks` object returned by {@link secureHeaders} so
 * the framework can detect that a developer has installed their own
 * `secureHeaders()` and remove the auto-installed default instance to avoid
 * shadowing the user's overrides. Exported so wrapper helpers can stamp
 * their own returned hooks (`(hooks as any)[SECURE_HEADERS_MARKER] = true`)
 * and get the same replace-not-stack behavior.
 *
 * @since 0.16.0
 */
export const SECURE_HEADERS_MARKER: unique symbol = Symbol.for("daloyjs.middleware.secureHeaders");

/**
 * Apply a Helmet-equivalent baseline of secure response headers (see
 * {@link SecureHeadersOptions} for the full list). Pass `false` for any
 * field to disable that header; handler-set headers always win.
 *
 * @param opts - Per-header overrides. Pass `false` to disable a header.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`, stamped with
 * {@link SECURE_HEADERS_MARKER}.
 * @throws {Error} When `frameOptions: false` is combined with a CSP that has
 * no `frame-ancestors` directive (would disable every clickjacking defense).
 * @since 0.1.0
 */
export function secureHeaders(opts: SecureHeadersOptions = {}): Hooks {
  const headers: Record<string, string> = {};
  let cspOpt = opts.contentSecurityPolicy ?? "default-src 'self'; frame-ancestors 'none'";
  // Refuse to construct when the developer disabled BOTH framing
  // defenses simultaneously (no X-Frame-Options AND no frame-ancestors
  // directive in CSP). A response with neither defense can be embedded in
  // an `<iframe>` from any origin, which re-opens the clickjacking surface
  // the helper is meant to close. The dual-knob "I disabled both" case is
  // the documented footgun this guard catches.
  const frameOptionExplicitlyDisabled = opts.frameOptions === false;
  if (frameOptionExplicitlyDisabled) {
    let cspProvidesFrameAncestors = false;
    if (typeof cspOpt === "string") {
      cspProvidesFrameAncestors = cspStringHasFrameAncestors(cspOpt);
    } else if (cspOpt !== false && typeof cspOpt === "object") {
      cspProvidesFrameAncestors = cspOptionsHaveFrameAncestors(cspOpt);
    }
    if (!cspProvidesFrameAncestors) {
      throw new Error(
        "secureHeaders(): refusing to construct with both frameOptions: false " +
          "AND no CSP frame-ancestors directive — that disables every clickjacking " +
          "defense the helper provides. Set frameOptions: 'DENY' / 'SAMEORIGIN', " +
          "or add a `frame-ancestors` directive to contentSecurityPolicy."
      );
    }
  }
  // If `reportTo` is provided at the top level but CSP is still a string,
  // promote it into a directives object so we can append `report-to <group>`.
  if (opts.reportTo && typeof cspOpt === "string") {
    const directives: Record<string, string> = {};
    for (const part of cspOpt.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const spaceIndex = trimmed.indexOf(" ");
      if (spaceIndex === -1) {
        directives[trimmed] = "";
      } else {
        directives[trimmed.slice(0, spaceIndex)] = trimmed.slice(spaceIndex + 1);
      }
    }
    cspOpt = { directives, reportTo: opts.reportTo } as CspDirectivesOptions;
  } else if (opts.reportTo && cspOpt !== false && typeof cspOpt === "object" && !cspOpt.reportTo) {
    cspOpt = { ...cspOpt, reportTo: opts.reportTo };
  }
  const cspIsDynamic = cspOpt !== false && typeof cspOpt === "object";
  if (cspOpt !== false && typeof cspOpt === "string") {
    headers["content-security-policy"] = cspOpt;
  }

  const hsts = opts.hsts ?? { maxAgeSeconds: 31536000, includeSubDomains: true };
  if (hsts !== false) {
    const hstsParts = [`max-age=${hsts.maxAgeSeconds}`];
    if (hsts.includeSubDomains) hstsParts.push("includeSubDomains");
    if (hsts.preload) hstsParts.push("preload");
    headers["strict-transport-security"] = hstsParts.join("; ");
  }

  const frame = opts.frameOptions ?? "DENY";
  if (frame !== false) headers["x-frame-options"] = frame;

  const ref = opts.referrerPolicy ?? "no-referrer";
  if (ref !== false) headers["referrer-policy"] = ref;

  const perm =
    opts.permissionsPolicy ?? "camera=(), microphone=(), geolocation=(), clipboard-write=()";
  if (perm !== false) headers["permissions-policy"] = perm;

  const coop = opts.crossOriginOpenerPolicy ?? "same-origin";
  if (coop !== false) headers["cross-origin-opener-policy"] = coop;

  const corp = opts.crossOriginResourcePolicy ?? "same-origin";
  if (corp !== false) headers["cross-origin-resource-policy"] = corp;

  // COEP is opt-in: `require-corp` would block any cross-origin embed that
  // has not opted in via CORP / CORS, which is too aggressive as a default.
  const coep = opts.crossOriginEmbedderPolicy;
  if (coep) headers["cross-origin-embedder-policy"] = coep;

  if (opts.noSniff !== false) headers["x-content-type-options"] = "nosniff";
  if (opts.xssProtection ?? false) headers["x-xss-protection"] = "0"; // modern guidance

  // Reporting API endpoints.
  if (opts.reportingEndpoints) {
    const entries = Object.entries(opts.reportingEndpoints);
    if (entries.length > 0) {
      // Modern: structured header field — quoted URL per group.
      headers["reporting-endpoints"] = entries
        .map(([group, url]) => `${group}="${url}"`)
        .join(", ");
      // Legacy: Report-To JSON for older Chromium versions.
      headers["report-to"] = entries
        .map(([group, url]) =>
          JSON.stringify({
            group,
            max_age: 10886400,
            endpoints: [{ url }],
          })
        )
        .join(", ");
    }
  }

  const headerEntries = Object.entries(headers);
  const hooks: Hooks = {};
  if (cspIsDynamic) {
    hooks.beforeHandle = (ctx) => {
      if ((cspOpt as CspDirectivesOptions).nonce) {
        (ctx.state as Record<string, unknown>)[CSP_NONCE_STATE] = generateCspNonce();
      }
    };
    hooks.onSend = (res, ctx) => {
      if (!res.headers.has("content-security-policy")) {
        const nonce = ctx
          ? ((ctx.state as Record<string, unknown>)[CSP_NONCE_STATE] as string | undefined)
          : undefined;
        const header = buildCspHeader(cspOpt as CspDirectivesOptions, nonce);
        if (header) res.headers.set("content-security-policy", header);
      }
      return undefined;
    };
  }
  if (headerEntries.length > 0) {
    hooks.onResponse = (res) => {
      for (const [k, v] of headerEntries) {
        if (!res.headers.has(k)) res.headers.set(k, v);
      }
    };
  }
  (hooks as Record<PropertyKey, unknown>)[SECURE_HEADERS_MARKER] = true;
  return hooks;
}

// ---------- Fetch Metadata Resource Isolation Policy (XS-Leaks defense) ----------

/** Options for {@link fetchMetadata}. */
export interface FetchMetadataOptions {
  /**
   * `Sec-Fetch-Dest` values that are always allowed even from cross-site
   * contexts. Defaults to the destinations a browser uses for top-level
   * navigation and embeds you typically *want* to be cross-site loadable
   * (`document`, `embed`, `object`, `audio`, `video`, `font`, `style`,
   * `image`). Override to tighten (e.g. `["document"]`) or extend.
   */
  allowedDestinations?: readonly string[];
  /**
   * Request methods that are always allowed when `Sec-Fetch-Mode` is
   * `navigate` (so users can submit forms cross-site to your endpoints
   * when you want that). Defaults to `["GET", "HEAD"]` — state-changing
   * top-level navigations are still rejected, matching the
   * Resource Isolation Policy from
   * https://xsleaks.dev/docs/defenses/isolation-policies/resource-isolation/.
   */
  allowedNavigationMethods?: readonly string[];
  /**
   * Origins permitted as cross-site callers (full origin strings like
   * `https://trusted.example`). Compared against the request `Origin`
   * header. Empty by default.
   */
  allowedOrigins?: readonly string[];
  /**
   * Custom predicate run before any built-in check. Return `true` to allow
   * the request unconditionally (e.g. for a public CDN-style endpoint).
   */
  allow?: (req: Request) => boolean;
}

const FETCH_METADATA_DEFAULT_DESTS = Object.freeze([
  // Embed-only destinations that browsers use for legitimate cross-site
  // resource loads (`<img>`, `<audio>`, `<video>`, `<link rel=stylesheet>`,
  // `<embed>`, `<object>`, `@font-face`). `document` is intentionally
  // excluded — that destination is for top-level navigation, which is
  // handled separately via `Sec-Fetch-Mode: navigate` + safe method.
  "embed",
  "object",
  "audio",
  "video",
  "font",
  "style",
  "image",
]);

const FETCH_METADATA_DEFAULT_NAV_METHODS = Object.freeze(["GET", "HEAD"]);

/**
 * Resource Isolation Policy middleware that uses the browser-set
 * `Sec-Fetch-Site` / `Sec-Fetch-Mode` / `Sec-Fetch-Dest` request headers
 * to reject cross-site requests that have no legitimate reason to reach
 * your origin. This is the modern, tokenless defense against the
 * XS-Leaks class of attacks documented at https://xsleaks.dev/ and
 * complements {@link secureHeaders} (which sets COOP / CORP / CSP
 * response-side) and {@link csrf} (which protects state-changing
 * endpoints from forged submissions).
 *
 * Default policy (matches https://web.dev/articles/fetch-metadata):
 *  - Allow when `Sec-Fetch-Site` is missing (non-browser client / legacy
 *    browser — covered by other defenses) or one of `same-origin`,
 *    `same-site`, `none`.
 *  - Allow cross-site top-level navigations (`Sec-Fetch-Mode: navigate`)
 *    using a safe method (`GET` / `HEAD`).
 *  - Allow cross-site requests whose `Sec-Fetch-Dest` is in a small
 *    allowlist of embed-friendly destinations.
 *  - Reject everything else with `403 problem+json`.
 *
 * Browsers send `Sec-Fetch-*` since Chrome 76 / Firefox 90 / Safari 16.4,
 * so for modern user agents this guard blocks the typical XS-Leak
 * vectors (`<img>`, `<script>`, `<iframe>`, `fetch` no-cors, ...).
 *
 * @example
 * ```ts
 * import { fetchMetadata } from "@daloyjs/core";
 * app.use(fetchMetadata());
 * ```
 *
 * @param opts - Policy overrides.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.37.0
 */
export function fetchMetadata(opts: FetchMetadataOptions = {}): Hooks {
  const allowedDests = new Set(opts.allowedDestinations ?? FETCH_METADATA_DEFAULT_DESTS);
  const allowedNavMethods = new Set(
    (opts.allowedNavigationMethods ?? FETCH_METADATA_DEFAULT_NAV_METHODS).map((m) =>
      m.toUpperCase()
    )
  );
  const allowedOrigins = new Set(opts.allowedOrigins ?? []);
  const customAllow = opts.allow;
  return {
    beforeHandle(ctx) {
      const req = ctx.request;
      if (customAllow && customAllow(req)) return;
      const site = req.headers.get("sec-fetch-site");
      // Browser did not send Sec-Fetch-* (legacy UA, server-to-server,
      // curl, ...). Other layers (CORS, CSRF, auth) cover those callers.
      if (!site) return;
      if (site === "same-origin" || site === "same-site" || site === "none") return;
      // Cross-site from here on (`cross-site` or any future value).
      const origin = req.headers.get("origin");
      if (origin && allowedOrigins.has(origin)) return;
      const mode = req.headers.get("sec-fetch-mode");
      const method = req.method.toUpperCase();
      if (mode === "navigate" && allowedNavMethods.has(method)) return;
      const dest = req.headers.get("sec-fetch-dest");
      if (dest && allowedDests.has(dest)) return;
      throw new ForbiddenError(
        "Cross-site request rejected by fetch-metadata Resource Isolation Policy."
      );
    },
  };
}

// `cors()` default `allowMethods` narrowed to the read-only set.
// State-changing methods (PUT / PATCH / DELETE) require explicit opt-in.
// POST stays because it remains a non-CORS-preflighted "simple method" with
// form-submittable content types (already covered by CSRF). OPTIONS is the
// preflight method itself and is always accepted, no need to advertise it.
const DEFAULT_CORS_METHODS = ["GET", "HEAD", "POST"];
const DEFAULT_CORS_ALLOWED_HEADERS = ["content-type", "authorization"];

/**
 * Append `token` to an existing `Vary` header (or create one) without
 * clobbering values written by other middleware (e.g. `Vary:
 * Accept-Encoding` from `compression()`). `Vary: *` short-circuits to a
 * no-op because the spec treats `*` as "varies on everything".
 *
 * @internal
 */
function appendVary(headers: Headers, token: string): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", token);
    return;
  }
  const lowerToken = token.toLowerCase();
  for (const raw of existing.split(",")) {
    const trimmed = raw.trim();
    if (trimmed === "*") return;
    if (trimmed.toLowerCase() === lowerToken) return;
  }
  headers.set("vary", `${existing}, ${token}`);
}

/**
 * Marker stamped on the `Hooks` object returned by {@link cors} so the
 * framework can detect that a CORS policy has been installed. Used by the
 * Secure-defaults cross-origin guard: if `App` is constructed with
 * `secureDefaults: true` (the 0.16+ default) and no route hook chain carries
 * a CORS policy that allows the request origin, state-changing requests with
 * a cross-origin `Origin` header are rejected with `403`. Exported so
 * third-party CORS helpers can opt out of the guard by stamping their own
 * returned hooks (`(hooks as any)[CORS_HOOK_MARKER] = true`); stamp
 * {@link CORS_ORIGIN_ALLOW_MARKER} as well when the helper has a real
 * allowlist predicate.
 *
 * @since 0.16.0
 */
export const CORS_HOOK_MARKER: unique symbol = Symbol.for("daloyjs.middleware.cors");

/**
 * Marker stamped on the `Hooks` object returned by {@link cors} with the
 * origin predicate used by the cross-origin guard. Third-party CORS
 * wrappers can stamp the same function so Daloy can reject state-changing
 * requests whose `Origin` header is outside the registered allowlist.
 *
 * @since 0.16.0
 */
export const CORS_ORIGIN_ALLOW_MARKER: unique symbol = Symbol.for(
  "daloyjs.middleware.cors.originAllow"
);

/**
 * Marker stamped on the `Hooks` object returned by {@link cors} when the
 * configured `origin` permits the wildcard `"*"`. Used by the
 * boot-time refuse-to-boot guard: a wildcard CORS origin in production is
 * almost always a misconfiguration, so `App` constructed with
 * `secureDefaults: true` (the 0.16+ default) and resolved to
 * `production` throws at `app.use(cors({ origin: "*" }))` time rather than
 * silently exposing every state-changing endpoint cross-origin.
 *
 * @since 0.17.0
 */
export const CORS_WILDCARD_ORIGIN_MARKER: unique symbol = Symbol.for(
  "daloyjs.middleware.cors.wildcardOrigin"
);

/**
 * Marker stamped on the `Hooks` object returned by {@link csrf}. Used by
 * the boot-time refuse-to-boot guard: when `session()` is registered
 * on a `secureDefaults: true` App that also exposes any state-changing
 * route, the framework requires a matching `csrf()` hook somewhere in the
 * hook chain so an attacker cannot forge a cross-site request that mutates
 * the authenticated session. Third-party CSRF helpers can opt into the
 * guard by stamping the same marker on their returned hooks.
 *
 * @since 0.17.0
 */
export const CSRF_HOOK_MARKER: unique symbol = Symbol.for("daloyjs.middleware.csrf");

/**
 * Marker stamped on a {@link Hooks} bundle that authenticates the request —
 * i.e. rejects callers without valid credentials. Built-in auth middlewares
 * (`bearerAuth`, `basicAuth`, `jwk`, `httpSignatureAuth`, `clientCertAuth`)
 * stamp it so the framework's route-auth boot guard can confirm that any route
 * declaring an `auth:` requirement is actually enforced by a hook rather than
 * being silently public (a `security` entry in the OpenAPI doc with no runtime
 * check). Wrap a custom authentication hook with {@link markAuthHook} to opt it
 * into the same guard.
 *
 * @since 1.0.0
 */
export const AUTH_HOOK_MARKER: unique symbol = Symbol.for("daloyjs.auth.hook");

/**
 * Mark a custom {@link Hooks} bundle as performing request authentication.
 *
 * Use this when you authenticate with your own hook (not one of the built-in
 * auth middlewares) but still declare `auth:` on the protected routes: it
 * stamps {@link AUTH_HOOK_MARKER} so the production route-auth boot guard treats
 * those routes as enforced. It is also the correct escape hatch when
 * authentication is performed by an upstream gateway/mesh and the in-app hook
 * is intentionally a pass-through.
 *
 * @param hooks - The hook bundle to mark (mutated in place and returned).
 * @returns The same `hooks` object, now stamped as an auth hook.
 *
 * @example
 * ```ts
 * app.use(markAuthHook({
 *   async beforeHandle(ctx) {
 *     if (!(await myVerify(ctx.request))) throw new UnauthorizedError();
 *   },
 * }));
 * ```
 *
 * @since 1.0.0
 */
export function markAuthHook(hooks: Hooks): Hooks {
  (hooks as Record<PropertyKey, unknown>)[AUTH_HOOK_MARKER] = true;
  return hooks;
}

/** Predicate stamped on a CORS `Hooks` object that returns `true` for allowed origins. */
export type CorsOriginAllow = (origin: string) => boolean;

/** Options for {@link cors}. */
export interface CorsOptions {
  /**
   * Allowed cross-origin caller(s): a single origin string, an array of
   * origins, or a predicate. `"*"` is rejected with `credentials: true`
   * and refused at boot on production `secureDefaults` apps.
   */
  origin: string | string[] | ((origin: string) => boolean);
  /**
   * Verbs advertised on preflight (`Access-Control-Allow-Methods`).
   * Defaults to `["GET", "HEAD", "POST"]`. `"*"` is rejected.
   */
  methods?: string[];
  /**
   * Request headers advertised on preflight (`Access-Control-Allow-Headers`).
   * Defaults to `["content-type", "authorization"]`.
   */
  allowedHeaders?: string[];
  /** Response headers exposed to browser JS (`Access-Control-Expose-Headers`). None by default. */
  exposedHeaders?: string[];
  /**
   * Emit `Access-Control-Allow-Credentials: true`. Defaults to `false`.
   * Cannot be combined with a wildcard `origin`.
   */
  credentials?: boolean;
  /** Preflight cache lifetime in seconds (`Access-Control-Max-Age`). Defaults to `600`. */
  maxAgeSeconds?: number;
}

/**
 * Cross-Origin Resource Sharing (CORS) middleware. Handles both preflight
 * (`OPTIONS`) and actual requests, attaching the correct
 * `Access-Control-*` headers and `Vary: Origin`.
 *
 * `origin` may be a single allowed origin, an array, or a predicate. When
 * `credentials: true`, the framework rejects the dangerous combination of a
 * wildcard origin + credentials at construction time — browsers always
 * forbid that combination silently in production.
 *
 * @example
 * ```ts
 * import { cors } from "@daloyjs/core";
 *
 * app.use(cors({
 *   origin: ["https://app.example.com", "https://admin.example.com"],
 *   credentials: true,
 *   exposedHeaders: ["x-request-id"],
 * }));
 * ```
 *
 * @param opts - CORS configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @throws {Error} When `credentials: true` is combined with `origin: "*"`.
 * @since 0.1.0
 */
export function cors(opts: CorsOptions): Hooks {
  // Reject the classic CORS footgun up front. Browsers will refuse to attach
  // credentials to a wildcard origin (the spec literally forbids
  // `Access-Control-Allow-Origin: *` together with
  // `Access-Control-Allow-Credentials: true`), so silently configuring it
  // produces broken-but-not-obviously-broken behavior in production. Fail
  // closed at construction time instead.
  if (opts.credentials) {
    const includesWildcard =
      opts.origin === "*" || (Array.isArray(opts.origin) && opts.origin.includes("*"));
    if (includesWildcard) {
      throw new Error(
        'cors(): origin: "*" cannot be combined with credentials: true. ' +
          "Pass an explicit origin string, an array of allowed origins, or a predicate function instead."
      );
    }
  }
  // Refuse wildcard `methods` at construction. CORS `allowMethods`
  // takes an explicit token list per the Fetch standard; `"*"` is a special
  // value only in the response header, never in the developer-facing API.
  // Shipping it as a configured allowlist would cross-origin-expose every
  // HTTP verb (including TRACE/CONNECT on runtimes that route them) with no
  // safe way to roll it back.
  if (opts.methods?.some((m) => m === "*" || m.trim() === "*")) {
    throw new Error(
      'cors(): methods cannot include "*". Declare each verb explicitly ' +
        '(e.g. ["GET", "HEAD", "POST"]).'
    );
  }
  const allow = (origin: string | null): string | null => {
    if (!origin) return null;
    if (typeof opts.origin === "string")
      return opts.origin === "*" || opts.origin === origin ? opts.origin : null;
    if (Array.isArray(opts.origin)) return opts.origin.includes(origin) ? origin : null;
    return opts.origin(origin) ? origin : null;
  };
  const methods = (opts.methods ?? DEFAULT_CORS_METHODS).join(", ");
  const allowedHeaders = (opts.allowedHeaders ?? DEFAULT_CORS_ALLOWED_HEADERS).join(", ");
  const exposed = opts.exposedHeaders?.join(", ");
  const maxAge = String(opts.maxAgeSeconds ?? 600);

  const hooks: Hooks = {
    beforeHandle(ctx) {
      const origin = ctx.request.headers.get("origin");
      const allowed = allow(origin);
      // Always advertise that the response depends on `Origin` when the
      // request carried one, even if we decided not to allow it. Otherwise
      // an HTTP cache (CDN, reverse proxy) that fronts the API can serve a
      // response generated for an allowed origin to a different,
      // disallowed origin — the classic CORS cache-poisoning footgun
      // called out in Aikido's "CORS Security: Beyond Basic Configuration"
      // (section 6: Vary: Origin on cached preflight responses).
      if (origin !== null) appendVary(ctx.set.headers, "Origin");
      if (allowed) {
        ctx.set.headers.set("access-control-allow-origin", allowed);
        if (opts.credentials) ctx.set.headers.set("access-control-allow-credentials", "true");
        if (exposed) ctx.set.headers.set("access-control-expose-headers", exposed);
      }
      if (ctx.request.method === "OPTIONS") {
        const h = new Headers();
        // Preflights are themselves cacheable by both browsers and shared
        // caches; vary on Origin and on the preflight-specific request
        // headers so a cache cannot serve one origin's preflight result
        // to another. (See `Vary` discussion in MDN's CORS guide.)
        appendVary(h, "Origin");
        appendVary(h, "Access-Control-Request-Method");
        appendVary(h, "Access-Control-Request-Headers");
        if (allowed) {
          h.set("access-control-allow-origin", allowed);
          if (opts.credentials) h.set("access-control-allow-credentials", "true");
          // Only advertise the configured method/header allowlist to
          // origins we actually trust. Echoing the policy back to a
          // disallowed origin leaks our CORS configuration to anyone who
          // can send an OPTIONS request and lets attackers map the API's
          // accepted surface area without ever being approved.
          h.set("access-control-allow-methods", methods);
          h.set("access-control-allow-headers", allowedHeaders);
          h.set("access-control-max-age", maxAge);
        }
        return new Response(null, { status: 204, headers: h });
      }
      return undefined;
    },
  };
  (hooks as Record<PropertyKey, unknown>)[CORS_HOOK_MARKER] = true;
  (hooks as Record<PropertyKey, unknown>)[CORS_ORIGIN_ALLOW_MARKER] = (origin: string) =>
    allow(origin) !== null;
  const hasWildcard =
    opts.origin === "*" || (Array.isArray(opts.origin) && opts.origin.includes("*"));
  if (hasWildcard) {
    (hooks as Record<PropertyKey, unknown>)[CORS_WILDCARD_ORIGIN_MARKER] = true;
  }
  return hooks;
}

// ---------- Rate limit ----------

/**
 * Pluggable backend for {@link rateLimit}. Implementations must increment
 * `key`'s counter inside the current `windowMs` window and return the new
 * `{ count, resetMs }`. Built-in stores: in-memory (default) and Redis
 * (`@daloyjs/core/rate-limit-redis`).
 */
export interface RateLimitStore {
  /**
   * Record one request for `key` in the window of `windowMs` milliseconds
   * and return the updated `count` plus the window's absolute reset time
   * (`resetMs`, epoch milliseconds).
   */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

/** Options for {@link rateLimit}. */
export interface RateLimitOptions {
  /** Rolling-window width in milliseconds (e.g. `60_000` for one minute). */
  windowMs: number;
  /** Maximum allowed requests per `windowMs` per key. */
  max: number;
  /** Derive the bucket key from `ctx`. Default returns `"global"`. */
  keyGenerator?: (ctx: BaseContext<any, any>) => string;
  /** Custom backend (default: shared in-memory store). */
  store?: RateLimitStore;
  /**
   * Trust x-forwarded-for / x-real-ip when deriving the default key.
   * Off by default because those headers are client-spoofable unless your
   * reverse proxy strips and rewrites them.
   */
  trustProxyHeaders?: boolean;
  /** When true, set Retry-After header on 429. Default: true. */
  retryAfter?: boolean;
  /**
   * Share a single bucket across every `rateLimit()` call that declares the
   * same `groupId`. Use this to enforce one combined limit across related
   * routes (e.g. `/login`, `/login/otp`, and `/password-reset` all spend
   * from the same per-IP "auth" bucket). Without `groupId`, each
   * `rateLimit()` call gets its own independent in-memory store.
   *
   * Cooperation is only meaningful for the default in-memory store; when
   * an explicit `store` is supplied the developer is responsible for
   * keying it. The framework prepends the `groupId` to the derived key so
   * two groups never collide in a shared store either.
   *
   * @since 0.19.0
   */
  groupId?: string;
}

/**
 * Shared in-memory store registry for {@link RateLimitOptions.groupId}. Two
 * `rateLimit({ groupId: "auth" })` calls receive the same bucket map so the
 * limit is enforced across every route the same `groupId` is mounted on.
 *
 * Exposed only for tests; not part of the documented public API.
 *
 * @internal
 */
const SHARED_RATE_LIMIT_STORES = new Map<string, MemoryStore>();
const SHARED_LOGIN_THROTTLE_BUCKETS = new Map<
  string,
  Map<string, { count: number; resetMs: number }>
>();

/**
 * Test-only helper that clears the process-wide shared buckets used by
 * `rateLimit({ groupId })` and {@link loginThrottle}. Not for production use.
 * @internal
 */
export function _resetSharedRateLimitStoresForTests(): void {
  SHARED_RATE_LIMIT_STORES.clear();
  SHARED_LOGIN_THROTTLE_BUCKETS.clear();
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetMs: number }>();
  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetMs <= now) {
      const fresh = { count: 1, resetMs: now + windowMs };
      this.buckets.set(key, fresh);
      // Opportunistic cleanup so the map can't grow without bound.
      if (this.buckets.size > 10_000) {
        for (const [k, v] of this.buckets) if (v.resetMs <= now) this.buckets.delete(k);
      }
      return fresh;
    }
    b.count++;
    return b;
  }
}

/**
 * Fixed-window rate limiter. Throws {@link TooManyRequestsError} (mapped to
 * `429`) when a key exceeds `max` requests inside `windowMs`. Adds
 * `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
 * headers on every response, plus `Retry-After` on `429` responses (unless
 * disabled).
 *
 * The default `store` is an in-memory map that **only** survives within a
 * single process. For multi-instance deployments pass a shared store — the
 * package ships `redisRateLimitStore` from `@daloyjs/core/rate-limit-redis`
 * as a Redis backend.
 *
 * The default key derivation returns `"global"`, which means every caller
 * shares one bucket. Pass `trustProxyHeaders: true` to derive from
 * `X-Forwarded-For` / `X-Real-IP` when behind a trusted proxy, or supply a
 * custom `keyGenerator` (e.g. derive from the authenticated user id).
 *
 * @example
 * ```ts
 * import { rateLimit } from "@daloyjs/core";
 *
 * app.use(rateLimit({
 *   windowMs: 60_000,
 *   max: 100,
 *   keyGenerator: (ctx) => (ctx.state.user as { id: string })?.id ?? "anonymous",
 * }));
 * ```
 *
 * @param opts - Rate-limit configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
export function rateLimit(opts: RateLimitOptions): Hooks {
  let store: RateLimitStore;
  if (opts.store) {
    store = opts.store;
  } else if (opts.groupId) {
    let shared = SHARED_RATE_LIMIT_STORES.get(opts.groupId);
    if (!shared) {
      shared = new MemoryStore();
      SHARED_RATE_LIMIT_STORES.set(opts.groupId, shared);
    }
    store = shared;
  } else {
    store = new MemoryStore();
  }
  const groupPrefix = opts.groupId ? `${opts.groupId}:` : "";
  const keyOf =
    opts.keyGenerator ??
    ((ctx: BaseContext<any, any>) => {
      if (opts.trustProxyHeaders) {
        const xff = ctx.request.headers.get("x-forwarded-for");
        const first = xff ? xff.split(",")[0]!.trim() : "";
        return first || ctx.request.headers.get("x-real-ip") || "global";
      }
      return "global";
    });

  return {
    async beforeHandle(ctx) {
      const key = `${groupPrefix}${keyOf(ctx)}`;
      const { count, resetMs } = await store.hit(key, opts.windowMs);
      const remaining = Math.max(0, opts.max - count);
      ctx.set.headers.set("x-ratelimit-limit", String(opts.max));
      ctx.set.headers.set("x-ratelimit-remaining", String(remaining));
      ctx.set.headers.set("x-ratelimit-reset", String(Math.ceil(resetMs / 1000)));
      if (count > opts.max) {
        const retry = Math.ceil((resetMs - Date.now()) / 1000);
        throw new TooManyRequestsError(opts.retryAfter !== false ? retry : undefined);
      }
      return undefined;
    },
  };
}

// ---------- Login throttle ----------

/** Options for {@link loginThrottle}. All fields are optional with safe defaults. */
export interface LoginThrottleOptions {
  /** Fixed-window length in ms. Default: 15 minutes. */
  windowMs?: number;
  /** Maximum attempts before returning 429. Default: 5. */
  max?: number;
  /** Shared bucket id. Default: `"login"`. */
  groupId?: string;
  /** Derive the caller key. Defaults to trusted proxy headers only when enabled. */
  keyGenerator?: (ctx: BaseContext<any, any>) => string;
  /** Shared store for the hard limit. Uses rateLimit()'s in-memory group bucket by default. */
  store?: RateLimitStore;
  /** Trust x-forwarded-for / x-real-ip when deriving the default key. Default: false. */
  trustProxyHeaders?: boolean;
  /** When true, set Retry-After header on 429. Default: true. */
  retryAfter?: boolean;
  /** Start slowing responses after this many attempts in the same window. Default: 2. */
  delayAfter?: number;
  /** Added delay per attempt beyond delayAfter, in ms. Default: 250. */
  delayMs?: number;
  /** Maximum slowdown delay in ms. Default: 2000. */
  maxDelayMs?: number;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`loginThrottle(): ${name} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`loginThrottle(): ${name} must be a positive integer.`);
  }
}

function defaultLoginThrottleKey(
  trustProxyHeaders: boolean | undefined
): (ctx: BaseContext<any, any>) => string {
  return (ctx) => {
    if (trustProxyHeaders) {
      const forwardedFor = ctx.request.headers.get("x-forwarded-for");
      const firstForwarded = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "";
      return firstForwarded || ctx.request.headers.get("x-real-ip") || "global";
    }
    return "global";
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Login throttle preset for `/login`, `/login/otp`, password reset, and
 * adjacent credential-entry routes. It combines a shared `rateLimit({ groupId })`
 * bucket with a small progressive slowdown before the hard 429 kicks in.
 *
 * Mount the same `loginThrottle()` instance (or multiple instances with the
 * same `groupId`) across related routes so an attacker cannot bypass the limit
 * by rotating between password, OTP, and reset endpoints.
 *
 * @param opts - Throttle tuning (see {@link LoginThrottleOptions}); every field has a safe default.
 * @returns A {@link Hooks} bundle ready for `app.use(...)` or per-route `hooks`.
 * @throws {Error} When `windowMs`/`max` are not positive integers or the delay options are negative.
 * @since 0.23.0
 */
export function loginThrottle(opts: LoginThrottleOptions = {}): Hooks {
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const max = opts.max ?? 5;
  const delayAfter = opts.delayAfter ?? 2;
  const delayMs = opts.delayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 2_000;

  assertPositiveInteger("windowMs", windowMs);
  assertPositiveInteger("max", max);
  assertNonNegativeInteger("delayAfter", delayAfter);
  assertNonNegativeInteger("delayMs", delayMs);
  assertNonNegativeInteger("maxDelayMs", maxDelayMs);

  const groupId = opts.groupId ?? "login";
  const keyGenerator = opts.keyGenerator ?? defaultLoginThrottleKey(opts.trustProxyHeaders);
  const limiter = rateLimit({
    windowMs,
    max,
    groupId,
    keyGenerator,
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.trustProxyHeaders !== undefined ? { trustProxyHeaders: opts.trustProxyHeaders } : {}),
    ...(opts.retryAfter !== undefined ? { retryAfter: opts.retryAfter } : {}),
  });
  let slowdownBuckets = SHARED_LOGIN_THROTTLE_BUCKETS.get(groupId);
  if (!slowdownBuckets) {
    slowdownBuckets = new Map<string, { count: number; resetMs: number }>();
    SHARED_LOGIN_THROTTLE_BUCKETS.set(groupId, slowdownBuckets);
  }

  return {
    async beforeHandle(ctx) {
      const now = Date.now();
      const key = `${groupId}:${keyGenerator(ctx)}`;
      let bucket = slowdownBuckets.get(key);
      if (!bucket || bucket.resetMs <= now) {
        bucket = { count: 0, resetMs: now + windowMs };
        slowdownBuckets.set(key, bucket);
      }
      bucket.count += 1;
      if (slowdownBuckets.size > 10_000) {
        for (const [bucketKey, value] of slowdownBuckets) {
          if (value.resetMs <= now) slowdownBuckets.delete(bucketKey);
        }
      }
      if (bucket.count > delayAfter && delayMs > 0 && maxDelayMs > 0) {
        const delay = Math.min(maxDelayMs, (bucket.count - delayAfter) * delayMs);
        if (delay > 0) await wait(delay);
      }
      return limiter.beforeHandle?.(ctx);
    },
  };
}

// ---------- Timing ----------

/**
 * Stamp a `Server-Timing` header (or your chosen header) on every response
 * with the handler's wall-clock duration in milliseconds. Browsers display
 * the value in the Network panel under the **Timing** column.
 *
 * @example
 * ```ts
 * import { timing } from "@daloyjs/core";
 * app.use(timing()); // Server-Timing: app;dur=12.34
 * ```
 *
 * @param headerName - Override the response header name. Default: `"server-timing"`.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
export function timing(headerName = "server-timing"): Hooks {
  const now = (): number =>
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  return {
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).__start = now();
    },
    afterHandle(ctx, value) {
      const start = (ctx.state as Record<string, unknown>).__start as number | undefined;
      if (typeof start === "number") {
        ctx.set.headers.set(headerName, `app;dur=${(now() - start).toFixed(2)}`);
      }
      return value;
    },
  };
}

// ---------- Bearer auth helper ----------

/**
 * Minimal Bearer-token authentication middleware. Rejects requests with no
 * `Authorization: Bearer ...` header with `401` (and a `WWW-Authenticate`
 * challenge), and requests whose token fails `validate(token)` with `403`.
 *
 * The `validate` callback is the integration point with whatever JWT
 * verifier, opaque-token introspector, or in-memory test stub you use.
 *
 * @example
 * ```ts
 * import { bearerAuth } from "@daloyjs/core";
 * import { jwtVerify } from "jose";
 *
 * app.use(bearerAuth({
 *   realm: "books-api",
 *   validate: async (token) => {
 *     try { await jwtVerify(token, jwks); return true; } catch { return false; }
 *   },
 * }));
 * ```
 *
 * @param opts - Token validator and optional `WWW-Authenticate` realm.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
/**
 * Per-request revalidation hook for {@link bearerAuth}. Runs after `validate`
 * has accepted the raw token, and is the integration point for
 * **revocation lists**, **token-version counters** ("user changed password
 * since this token was issued"), and "this token was issued before the
 * tenant was disabled" checks. Returning `false` rejects the request with
 * `403`; returning `true` or `undefined` accepts.
 *
 * @since 0.22.0
 */
export type BearerAuthVerifyHook<TCredentials = string> = (
  credentials: TCredentials,
  ctx: BaseContext<any, any>
) => boolean | void | Promise<boolean | void>;

/** Options for {@link bearerAuth}. */
export interface BearerAuthOptions {
  /** Cheap, stateless token check (signature / format). */
  validate: (token: string) => boolean | Promise<boolean>;
  /** WWW-Authenticate realm. Default: `"api"`. */
  realm?: string;
  /**
   * Optional per-request revalidation hook. Called after `validate`
   * accepts the token. Returning `false` rejects the request with `403`;
   * returning `true` or `undefined` accepts. Use for revocation lists,
   * token-version counters, etc.
   *
   * @since 0.22.0
   */
  verify?: BearerAuthVerifyHook<string>;
}

/**
 * Minimal Bearer-token authentication middleware. Rejects requests with no
 * `Authorization: Bearer ...` header with `401` (and a `WWW-Authenticate`
 * challenge), and requests whose token fails `validate(token)` (or the
 * optional per-request `verify(token, ctx)` revalidation hook) with `403`.
 *
 * The `validate` callback is the integration point with whatever JWT
 * verifier, opaque-token introspector, or in-memory test stub you use. The
 * optional `verify` hook is the integration point for revocation
 * lists, token-version counters, and other per-request invalidation checks
 * that `validate` cannot answer statelessly.
 *
 * @example
 * ```ts
 * import { bearerAuth } from "@daloyjs/core";
 * import { jwtVerify } from "jose";
 *
 * app.use(bearerAuth({
 *   realm: "books-api",
 *   validate: async (token) => {
 *     try { await jwtVerify(token, jwks); return true; } catch { return false; }
 *   },
 *   verify: async (token, _ctx) => !(await revoked.has(hash(token))),
 * }));
 * ```
 *
 * @param opts - Token validator, optional revalidation hook, and realm.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.1.0
 */
export function bearerAuth(opts: BearerAuthOptions): Hooks {
  const options = opts as BearerAuthOptions | undefined;
  if (!options || typeof options.validate !== "function") {
    throw new Error("bearerAuth(): validate must be a function.");
  }
  const realm = options.realm ?? "api";
  if (/["\r\n\0]/.test(realm)) {
    throw new Error("bearerAuth(): realm must not contain quotes, CR, LF, or NUL bytes.");
  }
  return markAuthHook({
    async beforeHandle(ctx) {
      const h = ctx.request.headers.get("authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(h);
      if (!m) {
        return new Response(
          JSON.stringify({
            type: "https://daloyjs.dev/errors/unauthorized",
            title: "Unauthorized",
            status: 401,
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/problem+json",
              "www-authenticate": `Bearer realm="${realm}"`,
              "cache-control": "no-store",
            },
          }
        );
      }
      const ok = await options.validate(m[1]!);
      if (!ok) throw new ForbiddenError("Invalid token");
      if (options.verify) {
        const verified = await options.verify(m[1]!, ctx);
        if (verified === false) throw new ForbiddenError("Token revoked");
      }
      return undefined;
    },
  });
}

// ---------- CSRF (double-submit cookie) ----------

/**
 * Cookie attributes for the CSRF token cookie. The token cookie must be
 * **readable by client-side JavaScript** (so the SPA can mirror it into a
 * request header), so `HttpOnly` is intentionally not configurable.
 */
export interface CsrfCookieOptions {
  /** `Strict` | `Lax` | `None`. Default: `"Lax"`. */
  sameSite?: "Strict" | "Lax" | "None";
  /** Default: `true`. Required when `sameSite` is `"None"`. */
  secure?: boolean;
  /** Default: `"/"`. */
  path?: string;
  /** Optional `Domain=` attribute. Cannot be combined with a `__Host-` cookie name. */
  domain?: string;
  /** Optional `Max-Age=` (seconds). When omitted the cookie is a session cookie. */
  maxAgeSeconds?: number;
  /** Emit `Partitioned` (CHIPS) for cross-site contexts. Default: `false`. */
  partitioned?: boolean;
}

/** Options for {@link csrf}. See {@link CsrfOptions.strategy} for mode details. */
export interface CsrfOptions {
  /**
   * Validation strategy.
   *
   * - `"double-submit"` (default): classic stateless double-submit cookie. A
   *   random token is set in a cookie and must be echoed back in a request
   *   header (default `x-csrf-token`). Compared via timing-safe equality.
   * - `"fetch-metadata"`: tokenless protection that relies on `Sec-Fetch-Site`
   *   (and `Origin` / `Referer` as backstops). Modern browsers always send
   *   `Sec-Fetch-Site`; cross-origin requests are rejected with `403`
   *   regardless of any cookie state. No cookie is issued in this mode.
   * - `"both"`: require BOTH the fetch-metadata check AND the double-submit
   *   cookie to succeed. Use this if you want defense-in-depth.
   *
   * @default "double-submit"
   * @since 0.12.0
   */
  strategy?: "double-submit" | "fetch-metadata" | "both";
  /**
   * Allowlist of origins permitted when `Sec-Fetch-Site` is missing
   * (legacy browsers) or `cross-site`/`same-site`. Used by
   * `"fetch-metadata"` and `"both"`. May be an array of full origins
   * (`"https://app.example.com"`) or a predicate.
   */
  allowedOrigins?: string[] | ((origin: string) => boolean);
  /**
   * Cookie name carrying the CSRF token. Default: `"__Host-daloy.csrf"`.
   * `__Host-` prefixed names require `secure: true`, `path: "/"`, and no `domain`.
   * The middleware enforces those constraints at construction time.
   */
  cookieName?: string;
  /** Request header that must echo the cookie value. Default: `"x-csrf-token"`. */
  headerName?: string;
  /** Methods that skip token validation but still receive a cookie. Default: GET/HEAD/OPTIONS. */
  ignoreMethods?: string[];
  /** Cookie attributes (see {@link CsrfCookieOptions}). */
  cookieOptions?: CsrfCookieOptions;
  /** Override the random token generator (32 bytes URL-safe by default). */
  generator?: () => string;
}

const CSRF_STATE_TOKEN = "csrfToken";
const CSRF_STATE_ISSUED = "__csrfIssued";

function generateCsrfToken(): string {
  const cryptoApi: Crypto | undefined = (globalThis as any).crypto;
  if (cryptoApi?.getRandomValues) {
    const buf = new Uint8Array(32);
    cryptoApi.getRandomValues(buf);
    return Array.from(buf, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, "");
  throw new Error(
    "csrf(): WebCrypto is required for the default token generator. Pass a custom generator to csrf({ generator })."
  );
}

function csrfCookieAttributes(
  opts: Required<CsrfCookieOptions>
): CsrfCookieOptions & { httpOnly: false } {
  return {
    sameSite: opts.sameSite,
    secure: opts.secure,
    path: opts.path,
    domain: opts.domain || undefined,
    maxAgeSeconds: opts.maxAgeSeconds,
    partitioned: opts.partitioned,
    httpOnly: false,
  };
}

/**
 * CSRF protection middleware.
 *
 * Two strategies are supported (see {@link CsrfOptions.strategy}):
 *
 * - **`"double-submit"`** (default) — On safe methods (`GET`/`HEAD`/`OPTIONS`)
 *   ensures the client has a CSRF cookie; if missing, issues a fresh token
 *   and sets it via `Set-Cookie` on the response. The token is exposed on
 *   `ctx.state.csrfToken` so handlers can render it into HTML. On mutating
 *   methods, requires that an `x-csrf-token` request header (name
 *   configurable) matches the cookie value via timing-safe comparison. A
 *   missing or mismatched token rejects the request with `403 Forbidden`.
 *
 * - **`"fetch-metadata"`** — Tokenless. Requires `Sec-Fetch-Site` to be
 *   `same-origin` or `none` on mutating requests. Cross-origin requests with
 *   no allowlisted `Origin`/`Referer` are rejected with `403`. No cookie is
 *   issued or required. Robust on every browser shipped since 2020.
 *
 * - **`"both"`** — Requires the fetch-metadata check AND the double-submit
 *   cookie check to pass. Useful when you want defense-in-depth.
 *
 * @example Fetch-Metadata mode (recommended for new apps)
 * ```ts
 * app.use(csrf({
 *   strategy: "fetch-metadata",
 *   allowedOrigins: ["https://app.example.com"],
 * }));
 * ```
 *
 * @param opts - Strategy, cookie/header names, and cookie attributes (see {@link CsrfOptions}).
 * @returns A {@link Hooks} bundle ready for `app.use(...)`, stamped with {@link CSRF_HOOK_MARKER}.
 * @throws {Error} When `strategy` is unknown or the cookie name/attributes are invalid
 * (e.g. `__Host-` prefix without `secure: true`, `path: "/"`, and no `domain`).
 */
export function csrf(opts: CsrfOptions = {}): Hooks {
  const strategy = opts.strategy ?? "double-submit";
  if (strategy !== "double-submit" && strategy !== "fetch-metadata" && strategy !== "both") {
    throw new Error('csrf(): strategy must be "double-submit", "fetch-metadata", or "both".');
  }
  const cookieName = opts.cookieName ?? "__Host-daloy.csrf";
  const headerName = sanitizeHeaderName(opts.headerName ?? "x-csrf-token").toLowerCase();
  const ignore = new Set(
    (opts.ignoreMethods ?? ["GET", "HEAD", "OPTIONS"]).map((m) => m.toUpperCase())
  );
  const generator = opts.generator ?? generateCsrfToken;

  const originAllowed = (origin: string | null): boolean => {
    if (!origin) return false;
    if (Array.isArray(opts.allowedOrigins)) return opts.allowedOrigins.includes(origin);
    if (typeof opts.allowedOrigins === "function") return opts.allowedOrigins(origin);
    return false;
  };

  const checkFetchMetadata = (req: Request): void => {
    const site = req.headers.get("sec-fetch-site");
    if (site === "same-origin" || site === "none") return;
    if (site !== null) {
      // Browser sent Sec-Fetch-Site and it is same-site/cross-site: reject
      // unless the caller explicitly allowlisted the Origin.
      if (originAllowed(req.headers.get("origin"))) return;
      throw new ForbiddenError("CSRF: cross-origin request rejected (Sec-Fetch-Site)");
    }
    // Legacy browser without Fetch-Metadata: fall back to Origin/Referer allowlist.
    const origin = req.headers.get("origin");
    if (origin && originAllowed(origin)) return;
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (originAllowed(refOrigin)) return;
      } catch {
        /* fall through to rejection */
      }
    }
    throw new ForbiddenError("CSRF: request origin could not be verified");
  };

  const wantsDoubleSubmit = strategy === "double-submit" || strategy === "both";

  const cookieOverrides = opts.cookieOptions ?? {};
  const cookieOpts: Required<CsrfCookieOptions> = {
    sameSite: cookieOverrides.sameSite ?? "Lax",
    secure: cookieOverrides.secure ?? true,
    path: cookieOverrides.path ?? "/",
    domain: cookieOverrides.domain ?? "",
    maxAgeSeconds: cookieOverrides.maxAgeSeconds ?? 0,
    partitioned: cookieOverrides.partitioned ?? false,
  };
  if (wantsDoubleSubmit) {
    assertCookieAttributes({
      scope: "csrf()",
      name: cookieName,
      attributes: csrfCookieAttributes(cookieOpts),
    });
  }

  const hooks: Hooks = {
    beforeHandle(ctx) {
      const method = ctx.request.method.toUpperCase();
      const isSafe = ignore.has(method);

      if (!isSafe && (strategy === "fetch-metadata" || strategy === "both")) {
        checkFetchMetadata(ctx.request);
      }

      if (!wantsDoubleSubmit) return undefined;

      const existing = readRequestCookie(ctx.request.headers.get("cookie"), cookieName);

      if (isSafe) {
        if (existing) {
          (ctx.state as Record<string, unknown>)[CSRF_STATE_TOKEN] = existing;
        } else {
          const token = generator();
          if (!token) throw new Error("csrf(): generator returned an empty token.");
          (ctx.state as Record<string, unknown>)[CSRF_STATE_TOKEN] = token;
          (ctx.state as Record<string, unknown>)[CSRF_STATE_ISSUED] = token;
        }
        return undefined;
      }

      const provided = ctx.request.headers.get(headerName);
      if (!existing || !provided || !timingSafeEqual(existing, provided)) {
        throw new ForbiddenError("CSRF token missing or invalid");
      }
      (ctx.state as Record<string, unknown>)[CSRF_STATE_TOKEN] = existing;
      return undefined;
    },
    onSend(res, ctx) {
      if (!ctx || !wantsDoubleSubmit) return undefined;
      const issued = (ctx.state as Record<string, unknown>)[CSRF_STATE_ISSUED] as
        | string
        | undefined;
      if (!issued) return undefined;
      res.headers.append(
        "set-cookie",
        serializeCookie(cookieName, issued, csrfCookieAttributes(cookieOpts))
      );
      return undefined;
    },
  };
  (hooks as Record<PropertyKey, unknown>)[CSRF_HOOK_MARKER] = true;
  return hooks;
}

// ---------- Basic auth ----------

/** Options for {@link basicAuth}. */
export interface BasicAuthOptions {
  /**
   * Verify the supplied credentials. Must use a constant-time password
   * comparison and treat unknown usernames identically to wrong passwords
   * (to avoid username enumeration via timing). Return a falsy value to
   * reject the request with `401`.
   *
   * The resolved value (when truthy) can be either `true` or a user-shaped
   * object that will be stamped on `ctx.state.user`.
   */
  verify: (
    username: string,
    password: string
  ) => boolean | Promise<boolean> | object | Promise<object | boolean>;
  /** WWW-Authenticate realm. Default: `"api"`. */
  realm?: string;
  /**
   * Maximum length (bytes) of the `Authorization: Basic ...` value, after
   * the scheme prefix. Defaults to 1024 base64 bytes, which decodes to at
   * most 768 credential bytes. Oversize values are rejected with `401`
   * without invoking `verify`.
   */
  maxCredentialBytes?: number;
  /**
   * Typed-context callback fired after `verify` accepts the credentials and
   * after the framework has stamped `ctx.state.user`. Use this to decorate
   * `ctx.state` with extra fields (typed via `AppState`) so handlers do not
   * re-parse the `Authorization` header in every route.
   *
   * @since 0.22.0
   */
  onAuthSuccess?: (
    creds: { username: string; password: string },
    ctx: BaseContext<any, any>
  ) => void | Promise<void>;
}

const BASIC_AUTH_TOKEN_RE = /^Basic\s+([A-Za-z0-9+/=]+)$/i;

function decodeBasic(token: string): { user: string; pass: string } | null {
  let binary: string;
  try {
    binary = atob(token);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  // Reject embedded NUL: never legal in usernames/passwords.
  if (raw.indexOf("\0") !== -1) return null;
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex < 0) return null;
  return { user: raw.slice(0, separatorIndex), pass: raw.slice(separatorIndex + 1) };
}

function basicAuthChallenge(realm: string): Response {
  return new Response(
    JSON.stringify({
      type: "https://daloyjs.dev/errors/unauthorized",
      title: "Unauthorized",
      status: 401,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/problem+json",
        "www-authenticate": `Basic realm="${realm}", charset="UTF-8"`,
        "cache-control": "no-store",
      },
    }
  );
}

/**
 * HTTP Basic Authentication middleware (RFC 7617).
 *
 * The `verify` callback is the integration point with whatever credential
 * store you use. **It must use a constant-time password comparison** —
 * pair it with {@link timingSafeEqual} or a password-hash library that
 * provides timing-safe verification. Unknown usernames should be
 * indistinguishable from wrong passwords (perform the hash either way).
 *
 * @example
 * ```ts
 * import { basicAuth, timingSafeEqual } from "@daloyjs/core";
 *
 * app.use(basicAuth({
 *   realm: "books-api",
 *   verify: (user, pass) => {
 *     const okUser = timingSafeEqual(user, "admin");
 *     const okPass = timingSafeEqual(pass, process.env.ADMIN_PASSWORD ?? "");
 *     return okUser && okPass;
 *   },
 * }));
 * ```
 *
 * @param opts - Credential verifier, realm, and max credential size.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.12.0
 */
export function basicAuth(opts: BasicAuthOptions): Hooks {
  const options = opts as BasicAuthOptions | undefined;
  if (!options || typeof options.verify !== "function") {
    throw new Error("basicAuth(): verify must be a function.");
  }
  const realm = options.realm ?? "api";
  // Reject CRLF in realm at construction time so it can never reach a
  // response header.
  if (/["\r\n\0]/.test(realm)) {
    throw new Error("basicAuth(): realm must not contain quotes, CR, LF, or NUL bytes.");
  }
  const maxBytes = options.maxCredentialBytes ?? 1024;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("basicAuth(): maxCredentialBytes must be a positive integer.");
  }
  return markAuthHook({
    async beforeHandle(ctx) {
      const header = ctx.request.headers.get("authorization") ?? "";
      const match = BASIC_AUTH_TOKEN_RE.exec(header);
      if (!match || match[1]!.length > maxBytes) return basicAuthChallenge(realm);
      const creds = decodeBasic(match[1]!);
      if (!creds) return basicAuthChallenge(realm);
      const result = await options.verify(creds.user, creds.pass);
      if (!result) return basicAuthChallenge(realm);
      (ctx.state as Record<string, unknown>).user =
        typeof result === "object" ? result : { username: creds.user };
      if (options.onAuthSuccess) {
        await options.onAuthSuccess({ username: creds.user, password: creds.pass }, ctx);
      }
      return undefined;
    },
  });
}

// ---------- requireScopes ----------

/**
 * Marker stamped on the per-request `state` bag so multiple `requireScopes()`
 * hooks in the same chain aggregate their required scopes into one combined
 * `WWW-Authenticate: Bearer scope="..."` challenge instead of each emitting a
 * separate `401` with only its own scopes.
 *
 * @since 0.21.0
 */
export const REQUIRE_SCOPES_AGGREGATE_KEY = "__daloyRequiredScopes" as const;

/** Marker on the `Hooks` object returned by {@link requireScopes}, used to detect installed scope guards. */
export const REQUIRE_SCOPES_HOOK_MARKER: unique symbol = Symbol.for(
  "daloyjs.middleware.requireScopes"
);

function validateScopeList(scopes: unknown): readonly string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("requireScopes(): scopes must be a non-empty array of strings.");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scopes) {
    if (typeof s !== "string" || s.length === 0) {
      throw new Error("requireScopes(): every scope must be a non-empty string.");
    }
    // RFC 6749 §3.3: scope values must not contain double-quote, backslash, or
    // control characters; rejecting them at construction time means the
    // WWW-Authenticate challenge cannot be malformed by user input.
    if (/["\\\x00-\x1F\x7F]/.test(s)) {
      throw new Error(`requireScopes(): scope "${s}" contains an illegal character.`);
    }
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function readUserScopes(user: unknown): ReadonlySet<string> | null {
  if (!user || typeof user !== "object") return null;
  const raw = (user as { scopes?: unknown }).scopes;
  if (!Array.isArray(raw)) return null;
  const set = new Set<string>();
  for (const s of raw) if (typeof s === "string" && s.length > 0) set.add(s);
  return set;
}

/**
 * Declarative scope-check middleware for OAuth2-style bearer credentials.
 * Reads the typed `ctx.state.user.scopes` written by the upstream auth
 * helper (`bearerAuth`, `jwt`, …) and refuses the request with `401` (no
 * credentials) or `403` (valid credentials but insufficient scopes).
 *
 * Multiple `requireScopes()` hooks in the same chain aggregate their required
 * scopes into one combined `WWW-Authenticate: Bearer scope="a b c"` challenge
 * via {@link REQUIRE_SCOPES_AGGREGATE_KEY} on `ctx.state`.
 *
 * @example
 * ```ts
 * app.route({
 *   method: "POST",
 *   path: "/items",
 *   hooks: { ...bearerAuth({ validate }), ...requireScopes(["items:write"]) },
 *   responses: { 200: { description: "ok" } },
 *   handler: () => ({ status: 200 as const, body: { ok: true } }),
 * });
 * ```
 *
 * @param scopes - Required scope strings; must be non-empty and free of RFC 6749 illegal characters.
 * @returns A {@link Hooks} bundle ready for `app.use(...)` or per-route `hooks`,
 * stamped with {@link REQUIRE_SCOPES_HOOK_MARKER}.
 * @throws {Error} When `scopes` is empty or contains a non-string, empty, or illegal-character scope.
 * @since 0.21.0
 */
export function requireScopes(scopes: readonly string[]): Hooks {
  const required = validateScopeList(scopes);
  const hooks: Hooks = {
    beforeHandle(ctx) {
      const state = ctx.state as Record<string, unknown>;
      const prior = state[REQUIRE_SCOPES_AGGREGATE_KEY];
      const aggregate: string[] = Array.isArray(prior) ? [...(prior as string[])] : [];
      for (const s of required) if (!aggregate.includes(s)) aggregate.push(s);
      state[REQUIRE_SCOPES_AGGREGATE_KEY] = aggregate;

      const user = state.user;
      if (user === undefined || user === null) {
        const challenge = `Bearer scope="${aggregate.join(" ")}", error="insufficient_scope"`;
        return new Response(
          JSON.stringify({
            type: "https://daloyjs.dev/errors/unauthorized",
            title: "Unauthorized",
            status: 401,
            detail: `Missing credentials. Required scopes: ${aggregate.join(", ")}.`,
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/problem+json",
              "www-authenticate": challenge,
              "cache-control": "no-store",
            },
          }
        );
      }

      const owned = readUserScopes(user);
      const missing = owned === null ? aggregate.slice() : aggregate.filter((s) => !owned.has(s));
      if (missing.length > 0) {
        throw new ForbiddenError(`Missing required scope(s): ${missing.join(", ")}.`);
      }
      return undefined;
    },
  };
  (hooks as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER] = required;
  return hooks;
}

export { timingSafeEqual };
