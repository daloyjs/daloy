import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference: Security & auth",
  description:
    "DaloyJS security helper reference: security primitives, fetchGuard SSRF protection, safeRedirect, cookies, JWT signer/verifier, JWK/JWKS middleware, sessions, and password hashing.",
  path: "/docs/api-reference/security",
  keywords: [
    "DaloyJS security API",
    "DaloyJS JWT reference",
    "DaloyJS fetchGuard reference",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference: Security &amp; auth</h1>
      <p>
        The security helper surface: hardening primitives, the SSRF and
        open-redirect guards, cookie helpers, JWT/JWK verification, temporal
        claim assertions, security-scheme builders, sessions, and password
        hashing. Unless noted, these are exported from the root{" "}
        <code>@daloyjs/core</code> barrel (sessions and hashing also ship as
        their own subpaths). See the{" "}
        <Link href="/docs/api-reference">API reference overview</Link> for the
        module map.
      </p>

      <BranchDiagram
        title="Three families of helpers"
        source={{
          eyebrow: "security surface",
          label: "@daloyjs/core security helpers",
          detail: "hardening, outbound guards, credentials",
        }}
        branches={[
          {
            eyebrow: "inbound",
            label: "Hardening primitives",
            detail: "safeJsonParse, header guards, HMAC",
          },
          {
            eyebrow: "outbound",
            label: "Egress guards",
            detail: "fetchGuard(), safeRedirect()",
          },
          {
            eyebrow: "identity",
            label: "Credentials",
            detail: "JWT / JWK, session(), passwordHash",
          },
        ]}
        caption="Inbound primitives sanitize what arrives, egress guards constrain where your app can send users and requests, and the credential helpers verify who is calling."
      />

      <h2 id="security-primitives">Security primitives</h2>
      <CodeBlock
        code={`// Body & parser hardening
readBodyLimited(req: Request, limit: number): Promise<Uint8Array>;
safeJsonParse(text: string | Uint8Array): unknown;          // refuses __proto__, constructor, prototype keys
isForbiddenObjectKey(key: string): boolean;
hasMongoOperatorKeys(value: unknown): boolean;
assertNoMongoOperators(value: unknown, where?: string): void; // refuses $-prefixed keys on user input

// Headers
sanitizeHeaderName(name: string): string;
sanitizeHeaderValue(value: string): string;
assertNoDuplicateSingletonHeaders(headers: Headers): void;
assertNoReservedInternalHeaders(headers: Headers): void;
const RESERVED_INBOUND_HEADER_PREFIXES: readonly string[];
const SMUGGLING_SINGLETON_HEADERS: readonly string[];

// Comparisons & tokens
timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean;
randomId(): string;

// Secrets
assertStrongSecret(value: string | Uint8Array, where: string): void;
const MIN_PROD_SECRET_BYTES = 32;
const WEAK_SECRET_STRINGS: ReadonlyArray<string>;

// Webhook HMAC
type WebhookHmacAlgorithm = "sha256" | "sha384" | "sha512";
const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;
signWebhookPayload(opts: { secret; payload; algorithm?; timestamp?; }): Promise<string>;
verifyWebhookSignature(opts: {
  secret; payload; signature; algorithm?;
  timestamp?: string | number;
  toleranceSeconds?: number;
  now?: () => number;
}): Promise<boolean>;

// Filesystem
sanitizeFilename(name: string): string;
assertSafeRelativePath(p: string, where?: string): void;    // refuses .. escape, absolute, NUL`}
      />

      <h2 id="ssrf-guard">SSRF guard</h2>
      <CodeBlock
        code={`fetchGuard(opts?: FetchGuardOptions): typeof fetch;
  // returns a fetch-compatible wrapper that refuses loopback / RFC1918 /
  // link-local / cloud-metadata addresses unless explicitly allowed.

interface FetchGuardOptions {
  fetch?: typeof fetch;
  allowLoopback?: boolean;
  allowPrivate?: boolean;
  allowLinkLocal?: boolean;
  allowUniqueLocal?: boolean;
  allowAddresses?: readonly string[];   // CIDR or single IP
  denyAddresses?:  readonly string[];   // wins over allow + class flags
  allowHosts?:     readonly string[];
  allowProtocols?: readonly string[];   // default: ["http:", "https:"]
  maxRedirects?:   number;              // default: 5; each hop re-validated
  resolve?: (host: string) => Promise<string[]>;
}

type SsrfBlockReason =
  | "protocol-not-allowed" | "host-not-allowed" | "dns-resolution-failed"
  | "address-not-allowed"  | "too-many-redirects" | "credentials-in-url"
  | "invalid-url";

class SsrfBlockedError extends Error { readonly url; readonly reason: SsrfBlockReason; readonly address?: string }`}
      />

      <h2 id="open-redirect-guard">Open-redirect guard</h2>
      <CodeBlock
        code={`safeRedirect(target: string, opts: SafeRedirectOptions): Response;

interface SafeRedirectOptions {
  allowedPaths?: readonly string[];     // exact-match same-origin paths
  allowedOrigins?: readonly string[];   // strict origin equality
  fallback?: string;                    // returned instead of throwing on rejection
  status?: 301 | 302 | 303 | 307 | 308; // default: 303
  headers?: HeadersInit;
}

type SafeRedirectBlockReason =
  | "empty-target" | "invalid-control-characters" | "non-latin1-target"
  | "protocol-relative" | "backslash-path" | "path-not-allowed"
  | "origin-not-allowed" | "scheme-not-allowed" | "parse-failed";

class OpenRedirectBlockedError extends Error { readonly reason; readonly target }`}
      />

      <h2 id="cookies">Cookies</h2>
      <CodeBlock
        code={`type CookieSameSite = "Strict" | "Lax" | "None";
interface CookieAttributes {
  sameSite?: CookieSameSite;   // default: "Strict"
  secure?: boolean;            // default: true (required for __Secure-/__Host-)
  httpOnly?: boolean;          // default: true (set false for client-readable tokens)
  path?: string;               // default: "/" (must be "/" for __Host-)
  domain?: string;             // forbidden with __Host-
  maxAgeSeconds?: number;      // Max-Age= seconds; 0 omits it on writes
  partitioned?: boolean;       // Partitioned (CHIPS); default: false
}

serializeCookie(name: string, value: string, attrs?: CookieAttributes): string;  // URI-encodes value
serializeClearCookie(name: string, attrs?: CookieAttributes): string;            // Max-Age=0
readRequestCookie(header: string | null | undefined, name: string): string | null;
  // null if absent OR the name appears more than once (cookie-tossing defense)
assertCookieAttributes(opts: {
  scope: string; name: string; attributes: CookieAttributes; isProduction?: boolean;
}): void;`}
      />

      <h2 id="jwt-signer-and-verifier">JWT signer &amp; verifier</h2>
      <CodeBlock
        code={`type JwtAlgorithm =
  | "HS256" | "HS384" | "HS512"
  | "RS256" | "RS384" | "RS512"
  | "PS256" | "PS384" | "PS512"
  | "ES256" | "ES384" | "ES512"
  | "EdDSA";                            // "none" deliberately absent

type JwtKeyMaterial = CryptoKey | Uint8Array | JsonWebKey;

createJwtSigner(opts: JwtSignerOptions): {
  sign(payload: Record<string, unknown>, opts?): Promise<string>;
};

createJwtVerifier(opts: JwtVerifierOptions): {
  verify(token: string, opts?): Promise<JwtVerified>;
};

interface JwtVerified { readonly header: Record<string, unknown>; readonly payload: Record<string, unknown> }
class JwtError extends Error { readonly code: string }

const DEFAULT_JWT_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;  // 30d`}
      />

      <h2 id="jwk-jwks-verification">JWK / JWKS verification</h2>
      <CodeBlock
        code={`jwk(opts: JwkOptions): Hooks;
  // refuses HS* (confused-deputy), caches JWKS by TTL, honors kid, enforces
  // issuer/audience + clock skew, then stamps ctx.state.user = { sub, scopes, claims }.

type JwkAlgorithm = Exclude<JwtAlgorithm, "HS256" | "HS384" | "HS512">;
type JwkSource = JwkSet | string | (() => JwkSet | Promise<JwkSet>);  // object | https URL | resolver
interface JwkSet { keys: JsonWebKey[] }
type JwkVerifyHook = (payload: Record<string, unknown>, ctx) =>
  boolean | void | Promise<boolean | void>;   // return false to reject (403)

interface JwkOptions {
  jwks: JwkSource;                       // object, https:// URL, or resolver (http:// refused)
  algorithms: JwkAlgorithm[];            // required, non-empty; HS* refused at construction
  issuer?: string | string[];
  audience?: string | string[];
  clockSkewSeconds?: number;             // default: 0
  realm?: string;                        // WWW-Authenticate realm; default: "api"
  fetchTtlSeconds?: number;              // default: 300; URL sources only
  maxStaleSeconds?: number;              // default: 3600; 0 disables; URL sources only
  fetch?: typeof fetch;                  // pair with fetchGuard()
  verify?: JwkVerifyHook;
}`}
      />

      <h2 id="temporal-claim-assertions">Temporal claim assertions</h2>
      <CodeBlock
        code={`interface TemporalClaims { iat?: number; nbf?: number; exp?: number }
type TemporalClaimErrorCode =
  | "missing-exp" | "expired" | "not-before" | "issued-in-future"
  | "invalid-exp" | "invalid-nbf" | "invalid-iat"
  | "lifetime-too-long";

assertTemporalClaims(claims: TemporalClaims, opts?: AssertTemporalClaimsOptions): void;
class TemporalClaimError extends Error { readonly code: TemporalClaimErrorCode }`}
      />

      <h2 id="security-scheme-builders-openapi-3-1">
        Security-scheme builders (OpenAPI 3.1)
      </h2>
      <CodeBlock
        code={`// Re-exported from @daloyjs/core for convenience (also live in /openapi).
httpBearerScheme(opts?:   HttpBearerSchemeOptions):   HttpBearerScheme;
httpBasicScheme(opts?:    HttpBasicSchemeOptions):    HttpBasicScheme;
apiKeyScheme(opts:        ApiKeySchemeOptions):       ApiKeyScheme;
oauth2Scheme(opts:        OAuth2SchemeOptions):       OAuth2Scheme;
openIdConnectScheme(opts: OpenIdConnectSchemeOptions): OpenIdConnectScheme;

type ApiKeyLocation = "header" | "query" | "cookie";
interface OAuth2Flows {
  authorizationCode?: OAuth2AuthorizationCodeFlow;
  clientCredentials?: OAuth2ClientCredentialsFlow;
  implicit?:          OAuth2ImplicitFlow;
  password?:          OAuth2PasswordFlow;
}

type SecurityScheme = HttpBearerScheme | HttpBasicScheme | ApiKeyScheme | OAuth2Scheme | OpenIdConnectScheme;
const REQUIRE_PAYLOAD_AUTH_EXTENSION = "x-daloy-require-payload-auth";
securitySchemeRequiresPayloadAuth(scheme: SecurityScheme): boolean;
toOpenAPISecurityScheme(scheme: SecurityScheme): unknown;`}
      />

      <h2 id="daloyjs-core-session">
        <code>@daloyjs/core/session</code>
      </h2>
      <CodeBlock
        code={`session(opts: SessionOptions): Hooks;
rotateSession(opts?: RotateSessionOptions): Hooks;   // refresh ID on login/privilege change
signValue        (value: string, secret: string | Uint8Array): Promise<string>;
verifySignedValue(value: string, secret: string | Uint8Array): Promise<string | null>;

class MemorySessionStore implements SessionStore {}

interface SessionStore {
  get   (id: string): Promise<SessionRecord | undefined>;
  set   (id: string, record: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  touch?(id: string, expiresAt: number): Promise<void>;
}`}
      />

      <h2 id="daloyjs-core-hashing">
        <code>@daloyjs/core/hashing</code>
      </h2>
      <CodeBlock
        code={`passwordHash(password: string): Promise<string>;
  // scrypt with random salt + per-hash params; returns a self-describing PHC string.
  // Throws TypeError on empty input or passwords over 4096 UTF-8 bytes
  // (the cap blocks scrypt CPU-amplification abuse).

passwordVerify(password: string, hash: string): Promise<boolean>;
  // timing-safe comparison; refuses to verify when scrypt parameters are below
  // the secure floor (forces a rehash via your application logic).
  // Returns false (never throws) for empty or over-4096-byte passwords.`}
      />

      <p>
        Next up:{" "}
        <Link href={"/docs/api-reference/modules" as Route}>
          feature modules</Link>
        {"."}
      </p>
    </>
  );
}
