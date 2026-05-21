/**
 * Single source of truth for cookie serialization and attribute validation
 * (single-source-of-truth cookie helpers).
 *
 * Every first-party subsystem that writes a `Set-Cookie` header — `session()`,
 * `csrf()`, future ban / rate-limit-cooldown cookies — MUST route through
 * {@link serializeCookie} and {@link assertCookieAttributes} so the framework
 * has exactly one implementation of:
 *
 *  - the RFC 6265 attribute serialization rules,
 *  - the `__Host-` / `__Secure-` cookie-prefix rules (RFC 6265bis §4.1.3),
 *  - the production refuse-to-boot guard for `__Secure-` / `__Host-` without
 *    TLS (a cookie the browser will silently drop is worse than a missing
 *    cookie — fail loud at boot instead).
 *
 * The helper is intentionally tiny and dependency-free so it can be reused
 * from every runtime adapter (Node / Bun / Deno / Workers / Edge / Lambda).
 *
 * @since 0.27.0
 */

const COOKIE_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * `SameSite` attribute values per RFC 6265bis. `"None"` mandates the
 * `Secure` attribute on a strictly-conforming user agent.
 */
export type CookieSameSite = "Strict" | "Lax" | "None";

/**
 * Fully-resolved cookie attributes. All optional fields default to the
 * safest interpretation when omitted:
 *
 *  - `secure: true`
 *  - `httpOnly: true`
 *  - `sameSite: "Strict"`
 *  - `path: "/"`
 *
 * @since 0.27.0
 */
export interface CookieAttributes {
  /** Default `"Strict"`. */
  sameSite?: CookieSameSite;
  /** Default `true`. Required for `__Secure-` / `__Host-` prefixes. */
  secure?: boolean;
  /** Default `true`. Set explicitly to `false` for client-readable tokens (CSRF mirror). */
  httpOnly?: boolean;
  /** Default `"/"`. Required to equal `"/"` for `__Host-` prefix. */
  path?: string;
  /** Cookie `Domain=` attribute. Forbidden with `__Host-` prefix. */
  domain?: string;
  /** Cookie `Max-Age=` seconds. `0` omits it for set-cookie writes. */
  maxAgeSeconds?: number;
  /** `Partitioned` attribute (CHIPS). Default `false`. */
  partitioned?: boolean;
}

const FRAMEWORK_PREFIX = "daloy.cookie";

function validatePathOrDomain(scope: string, kind: "path" | "domain", value: string): void {
  if (/[;\r\n\0]/.test(value)) {
    throw new Error(`${scope}: cookie ${kind} contains an invalid character.`);
  }
}

/**
 * Validate every cookie attribute against RFC 6265bis and the framework's
 * secure-by-default posture. Throws on the first violation — designed to
 * run at construction time so misconfiguration fails the boot rather than
 * shipping a cookie the browser silently drops.
 *
 * In production (`isProduction: true`), refuses `__Secure-` / `__Host-`
 * prefixes without `secure: true`. Outside production the same combination
 * still throws because a `__Secure-` cookie sent over plaintext HTTP is a
 * developer mistake at any environment.
 *
 * @param input.scope - Caller-supplied label for error messages (e.g.
 *   `"session()"`, `"csrf()"`).
 * @param input.name - Cookie name (must match the RFC token grammar).
 * @param input.attributes - Resolved attribute bag.
 * @param input.isProduction - Whether the App's resolved environment is
 *   `production`. Used to scope the strictest refusals.
 * @since 0.27.0
 */
export function assertCookieAttributes(input: {
  readonly scope: string;
  readonly name: string;
  readonly attributes: CookieAttributes;
  readonly isProduction?: boolean;
}): void {
  const { scope, name, attributes: a, isProduction = false } = input;
  if (typeof name !== "string" || !COOKIE_NAME_RE.test(name)) {
    throw new Error(
      `${scope}: cookieName (cookie name) "${String(name)}" is not a valid cookie name (RFC 6265 token).`,
    );
  }
  const sameSite = a.sameSite ?? "Strict";
  if (sameSite !== "Strict" && sameSite !== "Lax" && sameSite !== "None") {
    throw new Error(`${scope}: cookieOptions.sameSite must be "Strict", "Lax", or "None".`);
  }
  const secure = a.secure ?? true;
  const path = a.path ?? "/";
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`${scope}: cookieOptions.path must start with "/".`);
  }
  validatePathOrDomain(scope, "path", path);
  if (a.domain !== undefined) {
    if (typeof a.domain !== "string" || a.domain.length === 0) {
      throw new Error(`${scope}: cookieOptions.domain must be a non-empty string when set.`);
    }
    validatePathOrDomain(scope, "domain", a.domain);
  }
  if (a.maxAgeSeconds !== undefined) {
    if (!Number.isInteger(a.maxAgeSeconds) || a.maxAgeSeconds < 0) {
      throw new Error(`${scope}: cookieOptions.maxAgeSeconds must be a non-negative integer.`);
    }
  }
  if (sameSite === "None" && !secure) {
    throw new Error(`${scope}: cookieOptions.sameSite: "None" requires secure: true.`);
  }
  if (name.startsWith("__Host-")) {
    if (!secure || path !== "/" || a.domain) {
      throw new Error(
        `${scope}: "__Host-" cookie names require secure: true, path: "/", and no domain.`,
      );
    }
  }
  if (name.startsWith("__Secure-")) {
    if (!secure) {
      throw new Error(
        `${scope}: "__Secure-" cookie names require secure: true. ` +
          (isProduction
            ? "Production refuse-to-boot: a browser will silently drop this cookie over HTTP."
            : "Drop the prefix or pass secure: true."),
      );
    }
  }
}

/**
 * Serialize a single `Set-Cookie` header value from a (name, value,
 * attributes) tuple. The companion of {@link assertCookieAttributes} — call
 * the assertion at construction time, then call this helper on every
 * write.
 *
 * The value is URI-encoded so binary signature bytes and base64 padding
 * round-trip safely.
 *
 * @since 0.27.0
 */
export function serializeCookie(
  name: string,
  value: string,
  attributes: CookieAttributes = {},
): string {
  assertCookieAttributes({ scope: "serializeCookie()", name, attributes });
  const sameSite = attributes.sameSite ?? "Strict";
  const secure = attributes.secure ?? true;
  const httpOnly = attributes.httpOnly ?? true;
  const path = attributes.path ?? "/";
  let out = `${name}=${encodeURIComponent(value)}`;
  out += `; Path=${path}`;
  out += `; SameSite=${sameSite}`;
  if (secure) out += "; Secure";
  if (httpOnly) out += "; HttpOnly";
  if (attributes.domain) out += `; Domain=${attributes.domain}`;
  if (attributes.maxAgeSeconds !== undefined && attributes.maxAgeSeconds > 0) {
    out += `; Max-Age=${attributes.maxAgeSeconds}`;
  }
  if (attributes.partitioned) out += "; Partitioned";
  return out;
}

/**
 * Serialize a `Set-Cookie` value that clears the named cookie. Uses
 * `Max-Age=0` per RFC 6265 §5.2.2 and preserves the original attributes so
 * intermediaries match the original cookie when deciding what to delete.
 *
 * @since 0.27.0
 */
export function serializeClearCookie(name: string, attributes: CookieAttributes = {}): string {
  assertCookieAttributes({ scope: "serializeClearCookie()", name, attributes });
  const sameSite = attributes.sameSite ?? "Strict";
  const secure = attributes.secure ?? true;
  const httpOnly = attributes.httpOnly ?? true;
  const path = attributes.path ?? "/";
  let out = `${name}=`;
  out += `; Path=${path}`;
  out += `; SameSite=${sameSite}`;
  if (secure) out += "; Secure";
  if (httpOnly) out += "; HttpOnly";
  if (attributes.domain) out += `; Domain=${attributes.domain}`;
  out += "; Max-Age=0";
  if (attributes.partitioned) out += "; Partitioned";
  return out;
}

/**
 * Parse a single cookie value from a `Cookie` request header. Returns
 * `null` when the named cookie is absent. URI-decoded on a best-effort
 * basis (malformed `%` sequences return the raw value rather than throwing).
 *
 * Centralized so every framework subsystem reads cookies the same way and
 * cannot disagree about whitespace handling between `session()` and
 * `csrf()`.
 *
 * Cookie-tossing defense (RFC 6265 §5.4 / RFC 6265bis §5.7): when the same
 * cookie name appears more than once in the `Cookie` header, this helper
 * returns `null` rather than guessing which copy is authentic. Browsers
 * order shadowed cookies by path-specificity (more specific first), which
 * means an attacker who can set a sibling cookie via a subdomain XSS or a
 * misconfigured parent-domain `Set-Cookie` would otherwise win against the
 * legitimate session cookie. Refusing both copies forces the request to
 * re-authenticate instead of impersonating the attacker.
 *
 * The `__Host-` prefix already prevents this attack at the browser level
 * (and is the Daloy default for `session()` and `csrf()`), but this
 * parser-level guard is defense-in-depth for developers who customize the
 * cookie name or read other cookies through this helper.
 *
 * @since 0.27.0
 */
export function readRequestCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  let found: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      // Cookie-tossing defense: a second copy means we cannot safely
      // distinguish the legitimate cookie from an attacker-injected
      // shadow. Reject the entire read.
      if (found !== null) return null;
      const v = part.slice(eq + 1).trim();
      try {
        found = decodeURIComponent(v);
      } catch {
        found = v;
      }
    }
  }
  return found;
}

/** @internal Re-exported for tests. */
export const __COOKIE_FRAMEWORK_PREFIX__ = FRAMEWORK_PREFIX;
