/**
 * Built-in security & operational middleware.
 *
 * All middlewares return `Hooks` objects so they compose with `app.use(...)`,
 * groups, and per-route hooks identically.
 */

import type { Hooks, BaseContext } from "./types.js";
import { TooManyRequestsError, ForbiddenError } from "./errors.js";
import { randomId, timingSafeEqual } from "./security.js";

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

// ---------- CORS ----------

export interface CorsOptions {
  origin: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAgeSeconds?: number;
}

export function cors(opts: CorsOptions): Hooks {
  const allow = (origin: string | null): string | null => {
    if (!origin) return null;
    if (typeof opts.origin === "string") return opts.origin === "*" || opts.origin === origin ? opts.origin : null;
    if (Array.isArray(opts.origin)) return opts.origin.includes(origin) ? origin : null;
    return opts.origin(origin) ? origin : null;
  };
  const methods = (opts.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).join(", ");
  const allowedHeaders = (opts.allowedHeaders ?? ["content-type", "authorization"]).join(", ");
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
    ((ctx: BaseContext<any, any>) =>
      ctx.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      ctx.request.headers.get("x-real-ip") ||
      "global");

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

export { timingSafeEqual };
