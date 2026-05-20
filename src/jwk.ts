/**
 * Wave 5 leftover: first-party `jwk()` Bearer-token middleware that refuses
 * symmetric algorithms outright and verifies tokens against a JWKS source
 * (static object or `https://` URL).
 *
 * Security defaults that cannot be silenced:
 *
 * - Asymmetric-only allowlist (`RS*` / `PS*` / `ES*` / `EdDSA`). Symmetric
 *   `HS*` algorithms are refused at construction — JWK / JWKS keys are
 *   public, and accepting `HS256` signed with the RSA public key is the
 *   classic JWKS confused-deputy attack.
 * - `kid` header REQUIRED on every token. Matching JWK is selected from the
 *   JWKS by `kid`. A token without `kid`, or with a `kid` not present in
 *   the JWKS, is rejected with `401`.
 * - JWT-header `alg` MUST be in the allowlist. When the JWK declares its own
 *   `alg`, the two MUST agree (RFC 7517 §4.4 cross-check).
 * - `exp` / `nbf` / `iat` validated on every verify (Wave 5 leftover plan).
 * - JWKS URLs MUST be `https://` (refused at construction otherwise).
 * - Optional `verify(payload, ctx)` revalidation hook (Wave 5 leftover) for
 *   revocation lists, token-version counters, etc.
 *
 * The middleware extracts the Bearer token, runs verification, stamps the
 * decoded payload on `ctx.state.user` (with the standard `sub` / `scope`
 * surface that `requireScopes()` already understands), and rejects with
 * RFC-6750-compliant `WWW-Authenticate: Bearer error="invalid_token"` on
 * failure.
 *
 * @since 0.22.0
 */
import { ForbiddenError } from "./errors.js";
import {
  createJwtVerifier,
  JwtError,
  type JwtAlgorithm,
  type JwtKeyMaterial,
  type JwtVerified,
} from "./jwt.js";
import type { BaseContext, Hooks } from "./types.js";

/** Asymmetric algorithms accepted by {@link jwk}. */
export type JwkAlgorithm = Exclude<JwtAlgorithm, "HS256" | "HS384" | "HS512">;

const ALLOWED_JWK_ALGS: ReadonlySet<JwkAlgorithm> = new Set([
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512",
  "EdDSA",
]);

/** Minimal JWKS document shape (RFC 7517 §5). */
export interface JwkSet {
  keys: JsonWebKey[];
}

/**
 * Source for the verifier's public keys. Either an in-memory JWKS, a
 * `https://` URL (fetched with TTL caching), or a custom async resolver.
 */
export type JwkSource =
  | JwkSet
  | string
  | (() => JwkSet | Promise<JwkSet>);

/** Per-request payload-revalidation hook (Wave 5 leftover). */
export type JwkVerifyHook = (
  payload: Record<string, unknown>,
  ctx: BaseContext<any, any>,
) => boolean | void | Promise<boolean | void>;

/** Options for {@link jwk}. */
export interface JwkOptions {
  /** JWKS source (object, URL, or resolver). */
  jwks: JwkSource;
  /**
   * Explicit asymmetric algorithm allowlist. Required and non-empty.
   * Symmetric `HS*` algorithms are refused at construction time.
   */
  algorithms: JwkAlgorithm[];
  /** Optional expected issuer (string or allowlist). */
  issuer?: string | string[];
  /** Optional expected audience (string or allowlist). */
  audience?: string | string[];
  /** Clock skew tolerance applied to `exp` / `nbf` / `iat`. Default `0`. */
  clockSkewSeconds?: number;
  /** `WWW-Authenticate` realm. Default: `"api"`. */
  realm?: string;
  /**
   * TTL for fetched JWKS responses (seconds). Default `300` (5m). Ignored
   * when `jwks` is not a URL.
   */
  fetchTtlSeconds?: number;
  /**
   * Optional `fetch` implementation override (mainly for tests). Defaults
   * to global `fetch`.
   */
  fetch?: typeof fetch;
  /**
  * Optional per-request revalidation hook. Returning `false` rejects the
  * request with `403`; returning `true` or `undefined` accepts. Use for
  * revocation lists / token-version counters / "user changed password since
  * this JWT was issued".
   *
   * @since 0.22.0
   */
  verify?: JwkVerifyHook;
}

interface JwksCacheEntry {
  jwks: JwkSet;
  fetchedAt: number;
}

function unauthorized(realm: string, errorCode?: string, description?: string): Response {
  const parts = [`Bearer realm="${realm}"`];
  if (errorCode) parts.push(`error="${errorCode}"`);
  if (description) parts.push(`error_description="${sanitizeAuthParam(description)}"`);
  return new Response(
    JSON.stringify({
      type: "https://daloyjs.dev/errors/unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: description,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/problem+json",
        "www-authenticate": parts.join(", "),
        "cache-control": "no-store",
      },
    },
  );
}

function sanitizeAuthParam(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f"\\]/g, "");
}

function isJwkSet(value: unknown): value is JwkSet {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { keys?: unknown }).keys)
  );
}

function findJwkByKid(jwks: JwkSet, kid: string): JsonWebKey | undefined {
  for (const k of jwks.keys) {
    if (typeof k === "object" && k !== null && (k as { kid?: unknown }).kid === kid) {
      return k;
    }
  }
  return undefined;
}

function makeJwksLoader(
  source: JwkSource,
  fetchImpl: typeof fetch,
  ttlSeconds: number,
): () => Promise<JwkSet> {
  if (typeof source === "string") {
    if (!source.startsWith("https://")) {
      throw new Error(
        "jwk(): jwks URL must be https:// — refusing plaintext JWKS source.",
      );
    }
    let cache: JwksCacheEntry | undefined;
    let inflight: Promise<JwkSet> | undefined;
    return () => {
      const now = Date.now();
      if (cache && now - cache.fetchedAt < ttlSeconds * 1000) {
        return Promise.resolve(cache.jwks);
      }
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const res = await fetchImpl(source, {
            headers: { accept: "application/json" },
          });
          if (!res.ok) {
            throw new Error(`jwk(): JWKS fetch failed with status ${res.status}.`);
          }
          const body = (await res.json()) as unknown;
          if (!isJwkSet(body)) {
            throw new Error("jwk(): JWKS response is not a valid JWK Set (missing keys[]).");
          }
          cache = { jwks: body, fetchedAt: Date.now() };
          return body;
        } finally {
          inflight = undefined;
        }
      })();
      return inflight;
    };
  }
  if (typeof source === "function") {
    return async () => {
      const result = await source();
      if (!isJwkSet(result)) {
        throw new Error("jwk(): resolver returned a value that is not a valid JWK Set.");
      }
      return result;
    };
  }
  if (!isJwkSet(source)) {
    throw new Error("jwk(): jwks option must be a JWK Set, an https:// URL, or a resolver function.");
  }
  return () => Promise.resolve(source);
}

/**
 * Bearer-token JWT middleware backed by a JWKS source. Refuses symmetric
 * algorithms at construction time, requires every token to carry a `kid`
 * header, matches that `kid` against the JWKS, and cross-checks the JWT
 * header `alg` against the JWK's own `alg` (when present).
 *
 * @example
 * ```ts
 * import { App, jwk, requireScopes } from "@daloyjs/core";
 *
 * app.use(jwk({
 *   jwks: "https://login.example.com/.well-known/jwks.json",
 *   algorithms: ["RS256", "ES256"],
 *   issuer: "https://login.example.com/",
 *   audience: "books-api",
 * }));
 *
 * app.route({
 *   method: "POST",
 *   path: "/items",
 *   hooks: requireScopes(["items:write"]),
 *   responses: { 200: { description: "ok" } },
 *   handler: () => ({ status: 200 as const, body: { ok: true } }),
 * });
 * ```
 *
 * @since 0.22.0
 */
export function jwk(opts: JwkOptions): Hooks {
  if (!opts || typeof opts !== "object") {
    throw new Error("jwk(): options object is required.");
  }
  if (!Array.isArray(opts.algorithms) || opts.algorithms.length === 0) {
    throw new Error("jwk(): algorithms is a required, non-empty asymmetric-only allowlist.");
  }
  for (const alg of opts.algorithms) {
    if (!ALLOWED_JWK_ALGS.has(alg)) {
      throw new Error(
        `jwk(): algorithm "${String(alg)}" is not asymmetric — symmetric (HS*) algorithms are refused by jwk() to close the JWKS confused-deputy attack.`,
      );
    }
  }
  if (opts.fetchTtlSeconds !== undefined) {
    if (
      typeof opts.fetchTtlSeconds !== "number" ||
      !Number.isFinite(opts.fetchTtlSeconds) ||
      opts.fetchTtlSeconds < 0
    ) {
      throw new Error("jwk(): fetchTtlSeconds must be a non-negative finite number.");
    }
  }
  const realm = opts.realm ?? "api";
  if (/["\r\n\0]/.test(realm)) {
    throw new Error("jwk(): realm must not contain quotes, CR, LF, or NUL bytes.");
  }
  const ttl = opts.fetchTtlSeconds ?? 300;
  const loader = makeJwksLoader(
    opts.jwks,
    opts.fetch ?? (globalThis.fetch as typeof fetch),
    ttl,
  );

  const algorithms = [...opts.algorithms] as JwtAlgorithm[];

  let cachedVerifier: { verify(token: string): Promise<JwtVerified> } | undefined;
  let cachedJwksRef: JwkSet | undefined;

  async function getVerifier(): Promise<{ verify(token: string): Promise<JwtVerified> }> {
    const jwks = await loader();
    if (cachedVerifier && cachedJwksRef === jwks) return cachedVerifier;
    cachedJwksRef = jwks;
    cachedVerifier = createJwtVerifier({
      algorithms,
      issuer: opts.issuer,
      audience: opts.audience,
      clockSkewSeconds: opts.clockSkewSeconds,
      // Resolver picks the JWK by `kid` and enforces the alg cross-check.
      key: async (header: Record<string, unknown>) => {
        const kid = header.kid;
        if (typeof kid !== "string" || kid.length === 0) {
          throw new JwtError("missing_kid", "jwk(): token header is missing kid.");
        }
        const jwkMatch = findJwkByKid(jwks, kid);
        if (!jwkMatch) {
          throw new JwtError("kid_not_found", `jwk(): kid "${kid}" is not present in the JWKS.`);
        }
        const headerAlg = header.alg;
        const jwkAlg = (jwkMatch as { alg?: unknown }).alg;
        if (typeof jwkAlg === "string" && jwkAlg !== headerAlg) {
          throw new JwtError(
            "alg_mismatch",
            `jwk(): token alg "${String(headerAlg)}" does not match JWK alg "${jwkAlg}".`,
          );
        }
        return jwkMatch as JwtKeyMaterial;
      },
    });
    return cachedVerifier;
  }

  return {
    async beforeHandle(ctx) {
      const header = ctx.request.headers.get("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) {
        return unauthorized(realm);
      }
      let verified: JwtVerified;
      try {
        const verifier = await getVerifier();
        verified = await verifier.verify(match[1]!);
      } catch (err) {
        const message = err instanceof JwtError ? err.message : "JWT verification failed";
        return unauthorized(realm, "invalid_token", message);
      }
      // Stamp a user-shaped view on ctx.state so requireScopes() and handlers
      // can read it without re-parsing the JWT.
      const payload = verified.payload;
      const scopes = extractScopes(payload);
      (ctx.state as Record<string, unknown>).user = {
        sub: payload.sub,
        scopes,
        claims: payload,
      };
      if (opts.verify) {
        const ok = await opts.verify(payload, ctx);
        if (ok === false) throw new ForbiddenError("Token revoked");
      }
      return undefined;
    },
  };
}

function extractScopes(payload: Record<string, unknown>): readonly string[] {
  // RFC 8693 / OAuth2: `scope` is a space-delimited string; some IdPs emit
  // `scp` (Azure AD) or `scopes` (custom). Accept all three for ergonomics
  // while staying strict on shape.
  const scp = Array.isArray(payload.scp)
    ? payload.scp.filter((scope): scope is string => typeof scope === "string").join(" ")
    : "";
  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.filter((scope): scope is string => typeof scope === "string").join(" ")
    : "";
  const raw = (typeof payload.scope === "string" && payload.scope) || scp || scopes || "";
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/\s+/)) {
    if (piece.length === 0) continue;
    if (seen.has(piece)) continue;
    seen.add(piece);
    out.push(piece);
  }
  return out;
}
