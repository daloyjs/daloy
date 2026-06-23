/**
 * First-party `safeRedirect()` helper that refuses open-redirect inputs.
 *
 * Open redirects (Aikido "Top 10 app security problems" #10, OWASP
 * "Unvalidated Redirects and Forwards") happen when an app blindly trusts
 * a `?next=...` / `?returnTo=...` query parameter and emits a `Location`
 * header pointing wherever the attacker wants. The fix the industry has
 * settled on is the same one Daloy enforces here: validate every
 * candidate URL against an explicit allowlist of internal paths and
 * external origins **before** building the redirect response.
 *
 * Defaults are deliberately strict:
 *
 * - Same-origin paths must start with `/` and must not start with `//`
 *   or `/\` (which browsers interpret as protocol-relative URLs that
 *   escape your origin).
 * - Backslashes, encoded backslashes, control characters, and `CR`/`LF`
 *   are rejected to stop response-splitting and homograph tricks.
 *   Percent-encoded protocol-relative path prefixes such as `/%2f%2f`
 *   are also refused so downstream decoders cannot turn a same-origin
 *   `Location` into an origin-escaping redirect.
 * - Absolute URLs are only allowed when their `origin` exactly matches
 *   one of the entries in `allowedOrigins`.
 * - `javascript:`, `data:`, `vbscript:`, and `file:` schemes are always
 *   refused, even if the caller wrote a bug into the allowlist.
 * - The default status is `303 See Other`, which is the
 *   POST-redirect-GET-safe choice. Override with `status` when you
 *   genuinely need `301`/`302`/`307`/`308`.
 *
 * @example
 * ```ts
 * import { safeRedirect } from "@daloyjs/core";
 *
 * app.get("/login/callback", (ctx) => {
 *   const next = new URL(ctx.request.url).searchParams.get("next") ?? "/";
 *   return safeRedirect(next, {
 *     allowedPaths: ["/", "/dashboard", "/account"],
 *     allowedOrigins: ["https://app.example.com"],
 *     fallback: "/",
 *   });
 * });
 * ```
 *
 * @since 0.35.0
 */

/** Reason an open-redirect candidate was refused. */
export type SafeRedirectBlockReason =
  | "empty-target"
  | "invalid-control-characters"
  | "protocol-relative"
  | "backslash-path"
  | "path-not-allowed"
  | "origin-not-allowed"
  | "scheme-not-allowed"
  | "parse-failed";

/** Thrown when {@link safeRedirect} refuses a candidate URL and no `fallback` is configured. */
export class OpenRedirectBlockedError extends Error {
  readonly reason: SafeRedirectBlockReason;
  readonly target: string;
  constructor(reason: SafeRedirectBlockReason, target: string) {
    super(`safeRedirect: refused redirect (${reason})`);
    this.name = "OpenRedirectBlockedError";
    this.reason = reason;
    this.target = target;
  }
}

/** HTTP redirect status codes accepted by {@link safeRedirect}. */
export type SafeRedirectStatus = 301 | 302 | 303 | 307 | 308;

/** Options for {@link safeRedirect}. */
export interface SafeRedirectOptions {
  /**
   * Internal paths that may be used as redirect targets. Each entry MUST
   * begin with `/`. Matching is exact on `pathname` — query strings and
   * fragments on the candidate are preserved but ignored for matching.
   *
   * Use `"/*"` as a wildcard only when you really mean "any same-origin
   * path is fine" — it disables path-level allowlisting.
   */
  allowedPaths?: readonly string[];
  /**
   * External origins (scheme + host + optional port, e.g.
   * `https://app.example.com`) that may be used as redirect targets.
   * Compared with strict equality against `new URL(target).origin`.
   */
  allowedOrigins?: readonly string[];
  /**
   * Path to redirect to when the candidate is rejected. MUST begin with
   * `/`. When omitted, rejected candidates throw
   * {@link OpenRedirectBlockedError} instead.
   */
  fallback?: string;
  /** HTTP status code. Defaults to `303` (See Other). */
  status?: SafeRedirectStatus;
  /** Extra response headers to merge in. `Location` is always overwritten. */
  headers?: HeadersInit;
}

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:"]);

const ALLOWED_REDIRECT_STATUSES = new Set<number>([301, 302, 303, 307, 308]);

// Reject NUL, CR, LF, and other C0/C1 control characters; they enable
// response-splitting via the `Location` header.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

function buildResponse(location: string, status: number, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  merged.set("Location", location);
  // Belt and suspenders: cache directives so browsers and shared caches
  // never reuse a redirect that was scoped to a single request.
  if (!merged.has("Cache-Control")) merged.set("Cache-Control", "no-store");
  return new Response(null, { status, headers: merged });
}

function classify(
  target: string,
  allowedPaths: readonly string[],
  allowedOrigins: readonly string[]
): { ok: true; location: string } | { ok: false; reason: SafeRedirectBlockReason } {
  if (typeof target !== "string" || target.length === 0) {
    return { ok: false, reason: "empty-target" };
  }
  if (CONTROL_CHAR_RE.test(target)) {
    return { ok: false, reason: "invalid-control-characters" };
  }
  // Protocol-relative (`//evil.com`) is the classic open-redirect bypass.
  if (target.startsWith("//")) return { ok: false, reason: "protocol-relative" };
  // `/\evil.com` is interpreted by some browsers as protocol-relative too.
  if (target.startsWith("/\\")) return { ok: false, reason: "backslash-path" };
  if (hasEncodedBackslash(target)) return { ok: false, reason: "backslash-path" };
  if (hasEncodedProtocolRelativePrefix(target)) {
    return { ok: false, reason: "protocol-relative" };
  }

  if (target.startsWith("/")) {
    // Same-origin path. Backslashes anywhere in the path can confuse
    // user agents and proxies — refuse them outright.
    if (target.includes("\\")) return { ok: false, reason: "backslash-path" };
    if (allowedPaths.length === 0) {
      return { ok: false, reason: "path-not-allowed" };
    }
    if (allowedPaths.includes("/*")) return { ok: true, location: target };
    // Match on pathname only; preserve any user-provided query/fragment.
    const qIdx = target.search(/[?#]/);
    const pathname = qIdx === -1 ? target : target.slice(0, qIdx);
    if (!allowedPaths.includes(pathname)) {
      return { ok: false, reason: "path-not-allowed" };
    }
    return { ok: true, location: target };
  }

  // Absolute URL path. Parse and compare origin.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, reason: "parse-failed" };
  }
  if (FORBIDDEN_SCHEMES.has(parsed.protocol.toLowerCase())) {
    return { ok: false, reason: "scheme-not-allowed" };
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    return { ok: false, reason: "origin-not-allowed" };
  }
  return { ok: true, location: parsed.toString() };
}

function hasEncodedBackslash(value: string): boolean {
  return /%5c/i.test(value);
}

function hasEncodedProtocolRelativePrefix(value: string): boolean {
  let raw = value;
  for (let i = 0; i < 3; i++) {
    if (/^\/%2f/i.test(raw)) return true;
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded === raw) return false;
      raw = decoded;
    } catch {
      return false;
    }
  }
  return raw.startsWith("//");
}

/**
 * Build a redirect `Response` after validating the target against an
 * explicit allowlist. Throws {@link OpenRedirectBlockedError} when the
 * candidate fails validation and no `fallback` is configured.
 *
 * @param target - User-supplied URL candidate (path or absolute URL).
 * @param options - Allowlist + response configuration.
 *
 * @since 0.35.0
 */
export function safeRedirect(target: string, options: SafeRedirectOptions = {}): Response {
  const allowedPaths = options.allowedPaths ?? [];
  const allowedOrigins = options.allowedOrigins ?? [];
  const status = options.status ?? 303;
  if (!ALLOWED_REDIRECT_STATUSES.has(status)) {
    throw new TypeError(
      `safeRedirect: status ${String(status)} is not a redirect status (allowed: 301, 302, 303, 307, 308)`
    );
  }

  for (const p of allowedPaths) {
    if (typeof p !== "string" || (p !== "/*" && !p.startsWith("/"))) {
      throw new TypeError(
        `safeRedirect: allowedPaths entries must start with "/" (got ${JSON.stringify(p)})`
      );
    }
  }
  for (const o of allowedOrigins) {
    if (typeof o !== "string" || o.length === 0) {
      throw new TypeError("safeRedirect: allowedOrigins entries must be non-empty strings");
    }
    let parsed: URL;
    try {
      parsed = new URL(o);
    } catch {
      throw new TypeError(`safeRedirect: allowedOrigins entry is not a valid URL: ${o}`);
    }
    if (parsed.origin !== o) {
      throw new TypeError(
        `safeRedirect: allowedOrigins entry must be a bare origin (scheme + host [+ port]); got ${o}`
      );
    }
  }

  const result = classify(target, allowedPaths, allowedOrigins);
  if (result.ok) return buildResponse(result.location, status, options.headers);

  if (options.fallback !== undefined) {
    if (!options.fallback.startsWith("/") || options.fallback.startsWith("//")) {
      throw new TypeError(
        `safeRedirect: fallback must be a same-origin path starting with "/"; got ${options.fallback}`
      );
    }
    return buildResponse(options.fallback, status, options.headers);
  }

  throw new OpenRedirectBlockedError(result.reason, target);
}
