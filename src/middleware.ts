/**
 * Built-in security & operational middleware.
 *
 * All middlewares return `Hooks` objects so they compose with `app.use(...)`,
 * groups, and per-route hooks identically.
 */

import type { Hooks, BaseContext } from "./types.js";
import { TooManyRequestsError, ForbiddenError } from "./errors.js";
import { randomId, sanitizeHeaderName, timingSafeEqual } from "./security.js";

// ---------- Request ID ----------

export interface RequestIdOptions {
  header?: string;
  /** Trust an incoming header value (e.g. from a proxy). Default: false. */
  trustIncoming?: boolean;
  generator?: () => string;
}

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
    onResponse(res) {
      // Defence in depth: also stamp on responses produced by error paths.
      // (No-op if already set.)
      void res;
    },
  };
}

// ---------- Secure headers (Helmet-equivalent defaults) ----------

export interface SecureHeadersOptions {
  contentSecurityPolicy?: string | false;
  hsts?: { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean } | false;
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  referrerPolicy?: string | false;
  permissionsPolicy?: string | false;
  crossOriginOpenerPolicy?: string | false;
  crossOriginResourcePolicy?: string | false;
  noSniff?: boolean;
  xssProtection?: boolean;
}

export function secureHeaders(opts: SecureHeadersOptions = {}): Hooks {
  const headers: Record<string, string> = {};
  const csp = opts.contentSecurityPolicy ?? "default-src 'self'; frame-ancestors 'none'";
  if (csp !== false) headers["content-security-policy"] = csp;

  const hsts = opts.hsts ?? { maxAgeSeconds: 31536000, includeSubDomains: true };
  if (hsts !== false) {
    let v = `max-age=${hsts.maxAgeSeconds}`;
    if (hsts.includeSubDomains) v += "; includeSubDomains";
    if (hsts.preload) v += "; preload";
    headers["strict-transport-security"] = v;
  }

  const frame = opts.frameOptions ?? "DENY";
  if (frame !== false) headers["x-frame-options"] = frame;

  const ref = opts.referrerPolicy ?? "no-referrer";
  if (ref !== false) headers["referrer-policy"] = ref;

  const perm = opts.permissionsPolicy ?? "camera=(), microphone=(), geolocation=()";
  if (perm !== false) headers["permissions-policy"] = perm;

  const coop = opts.crossOriginOpenerPolicy ?? "same-origin";
  if (coop !== false) headers["cross-origin-opener-policy"] = coop;

  const corp = opts.crossOriginResourcePolicy ?? "same-origin";
  if (corp !== false) headers["cross-origin-resource-policy"] = corp;

  if (opts.noSniff !== false) headers["x-content-type-options"] = "nosniff";
  if (opts.xssProtection ?? false) headers["x-xss-protection"] = "0"; // modern guidance

  return {
    onResponse(res) {
      for (const [k, v] of Object.entries(headers)) {
        if (!res.headers.has(k)) res.headers.set(k, v);
      }
    },
  };
}

const DEFAULT_CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_CORS_ALLOWED_HEADERS = ["content-type", "authorization"];
export interface CorsOptions {
  origin: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAgeSeconds?: number;
}

export function cors(opts: CorsOptions): Hooks {
  // Reject the classic CORS footgun up front. Browsers will refuse to attach
  // credentials to a wildcard origin (the spec literally forbids
  // `Access-Control-Allow-Origin: *` together with
  // `Access-Control-Allow-Credentials: true`), so silently configuring it
  // produces broken-but-not-obviously-broken behavior in production. Fail
  // closed at construction time instead.
  if (opts.credentials) {
    const includesWildcard =
      opts.origin === "*" ||
      (Array.isArray(opts.origin) && opts.origin.includes("*"));
    if (includesWildcard) {
      throw new Error(
        "cors(): origin: \"*\" cannot be combined with credentials: true. " +
          "Pass an explicit origin string, an array of allowed origins, or a predicate function instead.",
      );
    }
  }
  const allow = (origin: string | null): string | null => {
    if (!origin) return null;
    if (typeof opts.origin === "string") return opts.origin === "*" || opts.origin === origin ? opts.origin : null;
    if (Array.isArray(opts.origin)) return opts.origin.includes(origin) ? origin : null;
    return opts.origin(origin) ? origin : null;
  };
  const methods = (opts.methods ?? DEFAULT_CORS_METHODS).join(", ");
  const allowedHeaders = (opts.allowedHeaders ?? DEFAULT_CORS_ALLOWED_HEADERS).join(", ");
  const exposed = opts.exposedHeaders?.join(", ");
  const maxAge = String(opts.maxAgeSeconds ?? 600);

  return {
    beforeHandle(ctx) {
      const origin = ctx.request.headers.get("origin");
      const allowed = allow(origin);
      if (allowed) {
        ctx.set.headers.set("access-control-allow-origin", allowed);
        ctx.set.headers.set("vary", "Origin");
        if (opts.credentials) ctx.set.headers.set("access-control-allow-credentials", "true");
        if (exposed) ctx.set.headers.set("access-control-expose-headers", exposed);
      }
      if (ctx.request.method === "OPTIONS") {
        const h = new Headers();
        if (allowed) {
          h.set("access-control-allow-origin", allowed);
          h.set("vary", "Origin");
          if (opts.credentials) h.set("access-control-allow-credentials", "true");
        }
        h.set("access-control-allow-methods", methods);
        h.set("access-control-allow-headers", allowedHeaders);
        h.set("access-control-max-age", maxAge);
        return new Response(null, { status: 204, headers: h });
      }
      return undefined;
    },
    onResponse(res) {
      // Mirror set headers onto the final response.
      // (No-op if already present.)
      void res;
    },
  };
}

// ---------- Rate limit ----------

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (ctx: BaseContext<any, any>) => string;
  store?: RateLimitStore;
  /**
   * Trust x-forwarded-for / x-real-ip when deriving the default key.
   * Off by default because those headers are client-spoofable unless your
   * reverse proxy strips and rewrites them.
   */
  trustProxyHeaders?: boolean;
  /** When true, set Retry-After header on 429. Default: true. */
  retryAfter?: boolean;
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

export function rateLimit(opts: RateLimitOptions): Hooks {
  const store = opts.store ?? new MemoryStore();
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
      const key = keyOf(ctx);
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

// ---------- Timing ----------

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

export function bearerAuth(opts: {
  validate: (token: string) => boolean | Promise<boolean>;
  realm?: string;
}): Hooks {
  return {
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
              "www-authenticate": `Bearer realm="${opts.realm ?? "api"}"`,
            },
          }
        );
      }
      const ok = await opts.validate(m[1]!);
      if (!ok) throw new ForbiddenError("Invalid token");
      return undefined;
    },
  };
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

export interface CsrfOptions {
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
const CSRF_COOKIE_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function generateCsrfToken(): string {
  const cryptoApi: Crypto | undefined = (globalThis as any).crypto;
  if (cryptoApi?.getRandomValues) {
    const buf = new Uint8Array(32);
    cryptoApi.getRandomValues(buf);
    return Array.from(buf, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, "");
  throw new Error("csrf(): WebCrypto is required for the default token generator. Pass a custom generator to csrf({ generator }).");
}

function validateCookieSegment(kind: "path" | "domain", value: string): void {
  if (/[;\r\n\0]/.test(value)) throw new Error(`csrf(): cookieOptions.${kind} contains an invalid character.`);
}

function validateCsrfCookieOptions(cookieName: string, opts: Required<CsrfCookieOptions>): void {
  if (!CSRF_COOKIE_NAME_RE.test(cookieName)) throw new Error("csrf(): cookieName is not a valid cookie name.");
  if (opts.sameSite !== "Strict" && opts.sameSite !== "Lax" && opts.sameSite !== "None") {
    throw new Error('csrf(): cookieOptions.sameSite must be "Strict", "Lax", or "None".');
  }
  if (!opts.path.startsWith("/")) throw new Error('csrf(): cookieOptions.path must start with "/".');
  validateCookieSegment("path", opts.path);
  if (opts.domain) validateCookieSegment("domain", opts.domain);
  if (!Number.isInteger(opts.maxAgeSeconds) || opts.maxAgeSeconds < 0) {
    throw new Error("csrf(): cookieOptions.maxAgeSeconds must be a non-negative integer.");
  }
  if (cookieName.startsWith("__Host-")) {
    if (!opts.secure || opts.path !== "/" || opts.domain) {
      throw new Error(
        'csrf(): "__Host-" cookie names require secure: true, path: "/", and no domain. ' +
          "Pass an explicit cookieName or relax cookieOptions to use a non-prefixed cookie.",
      );
    }
  }
  if (opts.sameSite === "None" && !opts.secure) {
    throw new Error('csrf(): cookieOptions.sameSite: "None" requires secure: true.');
  }
}

function parseCookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

function buildCsrfSetCookie(name: string, value: string, opts: Required<CsrfCookieOptions>): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${opts.path}`;
  s += `; SameSite=${opts.sameSite}`;
  if (opts.secure) s += "; Secure";
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.maxAgeSeconds > 0) s += `; Max-Age=${opts.maxAgeSeconds}`;
  if (opts.partitioned) s += "; Partitioned";
  return s;
}

/**
 * Double-submit-cookie CSRF protection.
 *
 * On safe methods (default GET/HEAD/OPTIONS), ensures the client has a CSRF
 * cookie; if missing, issues a fresh token and sets it via `Set-Cookie` on
 * the response. The token is also exposed on `ctx.state.csrfToken` so handlers
 * can render it into HTML.
 *
 * On mutating methods, requires that an `x-csrf-token` request header (name
 * configurable) matches the cookie value via timing-safe comparison. A missing
 * or mismatched token rejects the request with `403 Forbidden`.
 */
export function csrf(opts: CsrfOptions = {}): Hooks {
  const cookieName = opts.cookieName ?? "__Host-daloy.csrf";
  const headerName = sanitizeHeaderName(opts.headerName ?? "x-csrf-token").toLowerCase();
  const ignore = new Set((opts.ignoreMethods ?? ["GET", "HEAD", "OPTIONS"]).map((m) => m.toUpperCase()));
  const generator = opts.generator ?? generateCsrfToken;

  const cookieOverrides = opts.cookieOptions ?? {};
  const cookieOpts: Required<CsrfCookieOptions> = {
    sameSite: cookieOverrides.sameSite ?? "Lax",
    secure: cookieOverrides.secure ?? true,
    path: cookieOverrides.path ?? "/",
    domain: cookieOverrides.domain ?? "",
    maxAgeSeconds: cookieOverrides.maxAgeSeconds ?? 0,
    partitioned: cookieOverrides.partitioned ?? false,
  };
  validateCsrfCookieOptions(cookieName, cookieOpts);

  return {
    beforeHandle(ctx) {
      const existing = parseCookieValue(ctx.request.headers.get("cookie"), cookieName);
      const method = ctx.request.method.toUpperCase();

      if (ignore.has(method)) {
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
      if (!ctx) return undefined;
      const issued = (ctx.state as Record<string, unknown>)[CSRF_STATE_ISSUED] as string | undefined;
      if (!issued) return undefined;
      res.headers.append("set-cookie", buildCsrfSetCookie(cookieName, issued, cookieOpts));
      return undefined;
    },
  };
}

export { timingSafeEqual };
