import { CodeBlock } from "../../../components/code-block";

import { buildMetadata, CORE_PACKAGE_VERSION } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference",
  description:
    "Complete API reference for DaloyJS: App, routing, middleware, plugins, errors, security helpers, JWT/JWK, sessions, streaming, websockets, and runtime adapters, with TypeScript signatures.",
  path: "/docs/api-reference",
  keywords: [
    "DaloyJS API reference",
    "DaloyJS docs",
    "TypeScript framework API",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference</h1>
      <p>{`The complete public surface of DaloyJS v${CORE_PACKAGE_VERSION}, organized by import path. Every signature on this page is generated from the same TypeScript types your editor reads on hover, open the source files for fuller TSDoc, examples, and security rationale.`}</p>

      <p>Quick map of subpath modules exposed by the package:</p>
      <CodeBlock
        code={`@daloyjs/core             // App, routing types, errors, middleware, security, JWT/JWK, ...
@daloyjs/core/openapi     // OpenAPI 3.1 document generation + security-scheme builders
@daloyjs/core/client      // Typed in-process client + Hey API SDK glue
@daloyjs/core/contract    // Contract-tests harness (assert OpenAPI parity)
@daloyjs/core/docs        // Scalar / Swagger UI / Redoc HTML + CSP helper
@daloyjs/core/streaming   // SSE + NDJSON helpers
@daloyjs/core/multipart   // File-field + multipart object schema helpers
@daloyjs/core/session     // Cookie sessions + signed-value helpers
@daloyjs/core/websocket   // WebSocket route helper + frame primitives
@daloyjs/core/tracing     // OpenTelemetry tracing hook (interface-typed; no runtime dep)
@daloyjs/core/hashing     // passwordHash / passwordVerify (scrypt)
@daloyjs/core/rate-limit-redis  // Distributed rate-limit store
@daloyjs/core/banner      // Pretty startup banner
@daloyjs/core/cli         // CLI internals (used by bin/daloy.mjs)

// Runtime adapters
@daloyjs/core/node        // Node.js (http) - serve(app, opts)
@daloyjs/core/bun         // Bun.serve adapter
@daloyjs/core/deno        // Deno.serve adapter
@daloyjs/core/cloudflare  // Cloudflare Workers + generic { fetch } default export
@daloyjs/core/vercel      // Vercel Functions / Edge / Next.js App Router
@daloyjs/core/fastly      // Fastly Compute@Edge
@daloyjs/core/lambda      // AWS Lambda (API Gateway v1 + v2 / Function URLs)`}
      />

      <p>
        You can import any feature two ways: from the root{" "}
        <code>@daloyjs/core</code> barrel (convenient and tree-shakeable), or from
        its own subpath (for example <code>@daloyjs/core/jwt</code>) for the
        smallest possible bundle without relying on a bundler&apos;s
        tree-shaking. Both resolve to the same code. Runtime{" "}
        <strong>adapters</strong> are the one exception: they are available{" "}
        <em>only</em> as subpaths (for example <code>@daloyjs/core/node</code>),
        so runtime-specific code such as <code>node:http</code> never leaks into
        an edge or Worker bundle.
      </p>

      <h2>
        <code>@daloyjs/core</code> (root)
      </h2>

      <h3>
        <code>class App</code>
      </h3>
      <CodeBlock
        code={`new App(options?: AppOptions)
createApp(options?: AppOptions): App  // identical to \`new App(...)\`, point-free factory

interface AppOptions {
  // OpenAPI document metadata
  title?: string;
  version?: string;
  description?: string;

  // Secure-by-default master switches
  secureDefaults?: boolean;            // default: true
  acknowledgeInsecureDefaults?: boolean; // required when disabling defaults in production
  preset?: "internal-service";         // service-to-service preset (browser guards off)

  // Request limits
  bodyLimitBytes?: number;             // default: 1 MiB
  allowedContentTypes?: string[];      // default: ["application/json"]
  requestTimeoutMs?: number;           // default: 30_000; 0 disables
  maxHeaderCount?: number;             // default: 100; 0 disables (header-count flood / HTTP/2-Bomb guard)
  multipart?: { maxFileBytes?: number; maxFields?: number; maxFiles?: number };

  // Environment & logging
  production?: boolean;                // defaults from NODE_ENV
  env?: "development" | "production" | "test";
  logger?: Logger | { level?: LogLevel } | false;
  stripServerHeaders?: boolean;        // default: true

  // Header / cross-origin guards (secure-by-default)
  secureHeaders?: SecureHeadersOptions | false;
  corsCrossOriginGuard?: boolean;      // default: true
  csrf?: "off";                        // opt-out for the session+CSRF boot guard
  trustProxy?: boolean;                // legacy tri-state guard (undefined refuses X-Forwarded-*)
  behindProxy?: BehindProxyConfig;     // "none" | "loopback" | { hops: N } | { cidrs: [...] }

  // Operational
  disconnectStatusCode?: number;       // default: 499 (client-disconnect log code)
  crashOnUnhandledRejection?: boolean; // default: true in production
  loadShedding?: boolean | LoadSheddingOptions;

  // Validation, hooks, mock mode
  validateResponses?: boolean;         // default: true
  mockMode?: boolean;
  hooks?: Hooks;

  // OpenAPI / docs auto-mount
  openapi?: AppOpenAPIOptions;
  docs?: boolean | "auto" | DocsRouteOptions;  // default: false (create-daloy templates set true)
}

// Routing
app.route<P, Req, Res>(def: RouteDefinition<P, Req, Res>): App
app.ws<P, TData>(path: P, handler: WebSocketHandler<P, AppState, TData>): App
app.group(prefix, { tags?, hooks?, auth? }, register: (child: App) => void): App
app.use(hooks: Hooks): App
app.decorate<K, V>(key: K, value: V, { override? }?): App

// Plugins / lifecycle
app.register(plugin: { name?, seed?, stateful?, dependencies?, extensions?, register? }
                    | ((app: App) => void | Promise<void>),
             { prefix?, tags?, hooks?, auth? }?): App
app.onPluginInstalled(listener: (info: PluginInstalledEvent) => void | Promise<void>): App
app.onShutdown        (listener: (info: ShutdownEvent)        => void | Promise<void>): App
app.onClose           (cleanup:  () => void | Promise<void>): App

// Built-in routes
app.healthcheck    (opts?: HealthRouteOptions): App
app.readinesscheck (opts?: HealthRouteOptions): App
app.cspReportRoute (opts?: CspReportRouteOptions): App

// Dispatch + introspection
app.ready(): Promise<void>
app.fetch(req: Request): Promise<Response>
app.request(input: string | URL | Request, init?: RequestInit): Promise<Response>
app.introspect(): IntrospectedRoute[]
app.shutdown(timeoutMs?: number, reason?: string): Promise<void>`}
      />

      <h3>Route, hooks &amp; context types</h3>
      <CodeBlock
        code={`type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type PathString = \`/\${string}\`;
type ParamsOf<P>   // infers ":id" → "id" | ...
type PathParams<P> // { [K in ParamsOf<P>]: string }

interface RequestSchemas {
  params?:  StandardSchemaV1;
  query?:   StandardSchemaV1;
  headers?: StandardSchemaV1;
  body?:    StandardSchemaV1;
}

interface ResponseSpec {
  description: string;
  body?:    StandardSchemaV1;
  headers?: Record<string, { description?: string; schema?: StandardSchemaV1 }>;
  examples?: Record<string, unknown>;
}
type ResponsesMap = { [status: number]?: ResponseSpec };

interface AuthSpec {
  scheme: string;        // refs components.securitySchemes
  scopes?: string[];
  payload?: boolean;     // default true; refuse to opt out when scheme requires payload auth
}

// Plugin-extensible - augment via "declare module"
interface AppState {}

type AuthScheme = "bearer" | "basic" | "jwt" | "jwk" | "webhook" | "session" | "apiKey";
interface AuthContext<TCredentials = unknown> {
  readonly scheme: AuthScheme;
  readonly credentials: TCredentials;
}

interface BaseContext<P extends string, R extends RequestSchemas | undefined> {
  request: Request;
  params:  InferRequest<R, P>["params"];
  query:   InferRequest<R, P>["query"];
  headers: InferRequest<R, P>["headers"];
  body:    InferRequest<R, P>["body"];
  state:   AppState & Record<string, unknown>;
  set:     { status?: number; headers: Headers };
}

// HandlerReturn<R> is a discriminated union by status code - TS enforces
// that every returned response is declared in the route's responses map.
type HandlerReturn<R extends ResponsesMap> = ...;

interface Hooks {
  onRequest?:    (req: Request) => void | Promise<void>;
  beforeHandle?: (ctx) => void | Response | Promise<void | Response>;
  afterHandle?:  (ctx, result) => void | unknown | Promise<void | unknown>;
  onError?:      (err, ctx?) => void | Response | Promise<void | Response>;
  onSend?:       (res: Response, ctx?) => void | Response | Promise<void | Response>;
  onResponse?:   (res: Response, ctx?) => void;
}

interface RouteDefinition<P, Req, Res, S> {
  method: HttpMethod;
  path: P;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  request?: Req;
  responses: Res;
  auth?: AuthSpec;
  hooks?: Hooks;
  meta?: RouteMeta;        // AI-friendly metadata (surfaces as x-daloy-* in OpenAPI)
  examples?: RouteExample[];
  callbacks?: CallbackMap;
  handler: (ctx) => HandlerReturn<Res> | Promise<HandlerReturn<Res>>;
}

interface IntrospectedRoute {
  method: HttpMethod;
  path: string;
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  hasBody: boolean;
  hasQuery: boolean;
  hasParams: boolean;
  hasHeaders: boolean;
  responses: number[];
  auth?: { scheme: string; scopes?: string[] };
  meta?: RouteMeta;
}`}
      />

      <h3>Errors</h3>
      <CodeBlock
        code={`// All errors extend HttpError and serialize to RFC 9457 application/problem+json.
class HttpError extends Error {
  status: number; title: string;
  type?: string; detail?: string; instance?: string;
  headers?: Record<string, string>;
}
interface ProblemDetails { type?: string; title: string; status: number; detail?: string; instance?: string; [ext: string]: unknown }

class BadRequestError            extends HttpError {} // 400
class UnauthorizedError          extends HttpError {} // 401 - sets WWW-Authenticate
class ForbiddenError             extends HttpError {} // 403
class NotFoundError              extends HttpError {} // 404
class MethodNotAllowedError      extends HttpError {} // 405 - sets Allow
class RequestTimeoutError        extends HttpError {} // 408
class PayloadTooLargeError       extends HttpError {} // 413
class UnsupportedMediaTypeError  extends HttpError {} // 415
class ValidationError            extends HttpError {} // 422 - carries StandardSchema issues
class TooManyRequestsError       extends HttpError {} // 429 - sets Retry-After
class InternalError              extends HttpError {} // 500 - detail redacted in production

// Defensive guard: throws MessageLeakError when a custom error response
// would set a header outside the safe allowlist.
const SAFE_CUSTOM_ERROR_RESPONSE_HEADERS: ReadonlySet<string>;
class MessageLeakError extends Error {}
function checkCustomErrorResponseHeaders(headers: Headers | Record<string, string>): void;

function httpError(opts: HttpErrorOptions): HttpError;  // typed factory`}
      />

      <h3>Schema validation</h3>
      <CodeBlock
        code={`interface StandardSchemaV1<Input = unknown, Output = Input> { ... }  // Standard Schema spec
function isStandardSchema(value: unknown): value is StandardSchemaV1;
function validate<S extends StandardSchemaV1>(schema: S, input: unknown):
  | { ok: true;  value: StandardSchemaV1.InferOutput<S> }
  | { ok: false; issues: ReadonlyArray<StandardSchemaV1.Issue> };`}
      />

      <h3>Security primitives</h3>
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
signWebhookPayload(opts: { secret; body; algorithm?; timestamp?; }): Promise<string>;
verifyWebhookSignature(opts: {
  secret; body; signature; algorithm?;
  timestamp?: string | number;
  toleranceSeconds?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }>;

// Filesystem
sanitizeFilename(name: string): string;
assertSafeRelativePath(p: string, where?: string): void;    // refuses .. escape, absolute, NUL`}
      />

      <h3>Built-in middleware</h3>
      <CodeBlock
        code={`requestId(opts?: RequestIdOptions): Hooks
secureHeaders(opts?: SecureHeadersOptions): Hooks
cors(opts: CorsOptions): Hooks
rateLimit(opts: RateLimitOptions): Hooks
loginThrottle(opts?: LoginThrottleOptions): Hooks
timing(headerName?: string): Hooks
compression(opts?: CompressionOptions): Hooks
bearerAuth(opts: BearerAuthOptions): Hooks
basicAuth(opts: BasicAuthOptions): Hooks
csrf(opts?: CsrfOptions): Hooks
fetchMetadata(opts?: FetchMetadataOptions): Hooks   // Sec-Fetch-Site/Mode/Dest enforcement
requireScopes(scopes: string | string[]
            | { all?: string[]; any?: string[] }): Hooks
ipRestriction(opts: IpRestrictionOptions): Hooks    // CIDR allow/deny
loadShedding(opts?: LoadSheddingOptions): Hooks
etag(opts?: ETagOptions): Hooks                      // 304 + Set-Cookie / Cache-Control skip

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (ctx) => string;
  store?: RateLimitStore;          // default in-memory; use redisRateLimitStore for clusters
  trustProxyHeaders?: boolean;
  retryAfter?: boolean;
  groupId?: string;
}

interface BearerAuthOptions {
  validate: BearerAuthVerifyHook;   // (token, ctx) => boolean | AuthContext | Promise<...>
  realm?: string;
}`}
      />

      <h3>Composition primitives</h3>
      <CodeBlock
        code={`every(...layers: Hooks[]): Hooks      // run every layer in order, pipeline-style
some (...layers: Hooks[]): Hooks      // pass on first non-throwing beforeHandle (auth fallback chains)
except(when: ExceptPredicate, hooks: Hooks): Hooks  // exempt paths/methods from a check

type ExceptPredicate =
  | string                            // exact path
  | RegExp
  | { method?: HttpMethod | HttpMethod[]; path?: string | RegExp }
  | ((req: Request) => boolean);`}
      />

      <h3>Dependencies (typed DI chain)</h3>
      <CodeBlock
        code={`defineDependency<TName, TValue, TStateKey>(opts: {
  name: TName;
  dependsOn?: readonly string[];      // refuses cycles at registration
  stateKey?: TStateKey;
  resolve: (ctx) => TValue | Promise<TValue>;
}): DependencyHooks   // per-request cached; runs once per dependency per request`}
      />

      <h3>Connection info &amp; proxy posture</h3>
      <CodeBlock
        code={`type BehindProxyConfig = "none" | "loopback" | { hops: number } | { cidrs: readonly string[] };
interface ConnInfo { remoteAddress?: string; remotePort?: number; tls?: boolean }

getConnInfo(req: Request): ConnInfo | undefined;
setConnInfo(req: Request, info: ConnInfo): void;   // adapter helper
assertBehindProxy(cfg: BehindProxyConfig | undefined): void;
resolveClientIp(ctx, cfg?: BehindProxyConfig): string | undefined;
readRemoteAddress(ctx): string | undefined;
readRemotePort(ctx): number | undefined;
pickForwardedForByHops(header: string, hops: number): string | undefined;`}
      />

      <h3>Subdomains (Public-Suffix-aware)</h3>
      <CodeBlock
        code={`subdomains(hostname: string, opts?: SubdomainsOptions): SubdomainsResult;

interface SubdomainsResult {
  subdomain: string | undefined;       // e.g. "api" for "api.example.co.uk"
  registrableDomain: string | undefined;
  publicSuffix: string | undefined;
}

const PSL_SNAPSHOT_DATE: string;       // ISO date of the bundled PSL snapshot
const MAX_SNAPSHOT_AGE_DAYS: number;   // refuses to use a stale snapshot
const PSL_PUBLIC_SUFFIXES: ReadonlySet<string>;`}
      />

      <h3>SSRF guard</h3>
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
  | "address-not-allowed"  | "too-many-redirects" | "invalid-url";

class SsrfBlockedError extends Error { readonly url; readonly reason: SsrfBlockReason; readonly address?: string }`}
      />

      <h3>Open-redirect guard</h3>
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
  | "empty-target" | "invalid-control-characters" | "protocol-relative"
  | "backslash-path" | "path-not-allowed" | "origin-not-allowed"
  | "scheme-not-allowed" | "parse-failed";

class OpenRedirectBlockedError extends Error { readonly reason; readonly target }`}
      />

      <h3>Cookies</h3>
      <CodeBlock
        code={`type CookieSameSite = "Strict" | "Lax" | "None";
interface CookieAttributes {
  domain?: string; path?: string; maxAge?: number; expires?: Date;
  httpOnly?: boolean; secure?: boolean; sameSite?: CookieSameSite;
  partitioned?: boolean;
}

serializeCookie(name: string, value: string, attrs?: CookieAttributes): string;
serializeClearCookie(name: string, attrs?: CookieAttributes): string;
readRequestCookie(req: Request, name: string): string | undefined;
assertCookieAttributes(attrs: CookieAttributes, where: string): void;`}
      />

      <h3>JWT signer &amp; verifier</h3>
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

      <h3>JWK / JWKS verification</h3>
      <CodeBlock
        code={`jwk(opts: JwkOptions): Hooks;
  // verify hook: refuses HS* (confused-deputy), caches JWKS, honors kid,
  // enforces issuer/audience and clock skew, then writes ctx.state.auth.

type JwkAlgorithm = Exclude<JwtAlgorithm, "HS256" | "HS384" | "HS512">;
type JwkSource = { url: string; cacheMaxAgeMs?: number } | { keys: JwkSet["keys"] };
interface JwkSet { keys: readonly JsonWebKey[] }
type JwkVerifyHook = (ctx, verified: JwtVerified) => void | Promise<void>;

interface JwkOptions {
  source: JwkSource;
  algorithms: readonly JwkAlgorithm[];   // required allowlist
  issuer?: string | readonly string[];
  audience?: string | readonly string[];
  clockToleranceSeconds?: number;
  fetch?: typeof fetch;                   // pair with fetchGuard()
  verify?: JwkVerifyHook;
}`}
      />

      <h3>Temporal claim assertions</h3>
      <CodeBlock
        code={`interface TemporalClaims { iat?: number; nbf?: number; exp?: number }
type TemporalClaimErrorCode =
  | "missing-exp" | "expired" | "not-before" | "issued-in-future"
  | "invalid-exp" | "invalid-nbf" | "invalid-iat"
  | "lifetime-too-long";

assertTemporalClaims(claims: TemporalClaims, opts?: AssertTemporalClaimsOptions): void;
class TemporalClaimError extends Error { readonly code: TemporalClaimErrorCode }`}
      />

      <h3>Configuration</h3>
      <CodeBlock
        code={`defineConfig<S extends StandardSchemaV1>(opts: {
  schema: S;
  sources?: readonly ConfigSource[];   // process.env by default
}): StandardSchemaV1.InferOutput<S>;
  // Validates once at startup; refuses-to-boot on missing/invalid values.

class ConfigValidationError extends Error {}`}
      />

      <h3>Logging</h3>
      <CodeBlock
        code={`type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

createLogger(opts?: ConsoleLoggerOptions): Logger;
const noopLogger: Logger;
const DEFAULT_REDACT_KEYS: ReadonlyArray<string>;  // password, token, secret, authorization, ...

interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  write?: (line: string) => void;
  redact?: LoggerRedactionOptions;     // { keys?, replacer? }
}

interface Logger {
  trace(obj?, msg?): void;
  debug(obj?, msg?): void;
  info (obj?, msg?): void;
  warn (obj?, msg?): void;
  error(obj?, msg?): void;
  fatal(obj?, msg?): void;
  child(bindings: Record<string, unknown>): Logger;
}`}
      />

      <h3>Startup banner</h3>
      <CodeBlock
        code={`interface StartupBannerLink { label: string; url: string }
interface StartupBannerOptions {
  name?: string;        // default: "DaloyJS"
  version?: string;
  url: string;
  runtime?: string;     // e.g. "Node.js", "Bun"
  links?: StartupBannerLink[];
  color?: boolean;
  ascii?: boolean;
}

formatStartupBanner(opts: StartupBannerOptions): string;
printStartupBanner(opts: StartupBannerOptions): void;`}
      />

      <h3>Security-scheme builders (OpenAPI 3.1)</h3>
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

      <h3>Discriminated unions (OpenAPI)</h3>
      <CodeBlock
        code={`discriminator(opts: DiscriminatorObject): unknown;            // { propertyName, mapping? }
discriminatedUnion(prop: string, branches: StandardSchemaV1[],
                   opts?: DiscriminatedUnionOptions): StandardSchemaV1;`}
      />

      <h2>
        <code>@daloyjs/core/openapi</code>
      </h2>
      <CodeBlock
        code={`generateOpenAPI(app: App, opts: OpenAPIOptions): Record<string, unknown>;
openapiToYAML(doc: Record<string, unknown>): string;

interface OpenAPIOptions {
  info: OpenAPIInfo;
  servers?: { url: string; description?: string }[];
  securitySchemes?: SecuritySchemeMap;
  webhooks?: Record<string, WebhookDefinition | WebhookDefinition[]>;
}

interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; identifier?: string; url?: string };
  summary?: string;
}

// OpenAPI 3.1 top-level webhooks. Mirrors RouteDefinition minus path + handler.
interface WebhookDefinition {
  method: HttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  request?: RequestSchemas;
  responses: ResponsesMap;
  auth?: AuthSpec;
}`}
      />

      <h2>
        <code>@daloyjs/core/client</code>
      </h2>
      <CodeBlock
        code={`createClient<A extends App>(app: A, opts: ClientOptions): ClientFor<A>;

interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

// ClientFor<A> is keyed by operationId; each method takes
// { params?, query?, headers?, body? } and returns a discriminated union
// keyed by status: { status, body, headers }.
type ClientFor<A extends App>  = { /* generated from A["routes"] */ };
type RoutesOf<A extends App>   = A["routes"][number];`}
      />

      <h2>
        <code>@daloyjs/core/contract</code>
      </h2>
      <CodeBlock
        code={`runContractTests(app: App, opts?: ContractTestOptions): Promise<ContractReport>;

interface ContractTestOptions {
  requireOperationId?: boolean;     // default: true
  allowBodyOnSafeMethods?: boolean; // default: false
}

interface ContractReport { ok: boolean; checked: number; issues: ContractIssue[] }
interface ContractIssue  { route: string; method: HttpMethod; code: string; message: string }`}
      />

      <h2>
        <code>@daloyjs/core/docs</code>
      </h2>
      <CodeBlock
        code={`scalarHtml(opts: ScalarHtmlOptions): string;
swaggerUiHtml(opts: DocsOptions): string;
redocHtml(opts: RedocHtmlOptions): string;
docsContentSecurityPolicy(opts?: DocsContentSecurityPolicyOptions): string;
htmlResponse(html: string, opts?: HtmlResponseOptions): Response;

interface DocsOptions { specUrl: string; title?: string; assets?: DocsAssetOptions; scriptNonce?: string }
interface ScalarHtmlOptions extends DocsOptions { configuration?: ScalarReferenceConfiguration }
interface RedocHtmlOptions  extends DocsOptions { configuration?: RedocConfiguration }

interface DocsAssetOptions {
  // version-pinned URL + matching SRI hash per asset (see /docs/docs-asset-integrity)
  scalarScriptUrl?: string;       scalarScriptIntegrity?: string;
  swaggerUiCssUrl?: string;       swaggerUiCssIntegrity?: string;
  swaggerUiBundleUrl?: string;    swaggerUiBundleIntegrity?: string;
  redocScriptUrl?: string;        redocScriptIntegrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";  // default: "anonymous"
}

// RedocConfiguration is an index-signature bag of JSON-serializable Redoc
// standalone options (disableSearch, hideDownloadButtons, sortPropsAlphabetically,
// theme, ...), forwarded verbatim to Redoc.init(specUrl, configuration, element).

interface DocsContentSecurityPolicyOptions {
  assetOrigins?: readonly string[];
  scriptNonce?: string;
  allowInlineStyles?: boolean;
  allowBlobWorkers?: boolean;     // append worker-src 'self' blob: (Redoc needs it)
}

interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  contentSecurityPolicy?: string;
}`}
      />

      <h2>
        <code>@daloyjs/core/streaming</code>
      </h2>
      <CodeBlock
        code={`interface SSEMessage { data: unknown; event?: string; id?: string; retry?: number; comment?: string }

sseStream  (source, opts?: SSEStreamOptions):   ReadableStream<Uint8Array>;
sseResponse(source, opts?: SSEResponseOptions): Response;
ndjsonStream  (source, opts?: StreamOptions):       ReadableStream<Uint8Array>;
ndjsonResponse(source, opts?: NDJSONResponseOptions): Response;

interface StreamOptions       { signal?: AbortSignal }
interface SSEStreamOptions    extends StreamOptions { keepAliveMs?: number }
interface SSEResponseOptions  extends SSEStreamOptions { status?: number; headers?: HeadersInit }
interface NDJSONResponseOptions extends StreamOptions { status?: number; headers?: HeadersInit }`}
      />

      <h2>
        <code>@daloyjs/core/multipart</code>
      </h2>
      <CodeBlock
        code={`fileField(opts?: FileFieldOptions): FileFieldSchema<UploadedFile>;
multipartObject<S>(shape: S, opts?: MultipartObjectOptions): StandardSchemaV1;
isFileFieldSchema(value: unknown): boolean;
isMultipartObjectSchema(value: unknown): boolean;

type UploadedFile = Blob & { readonly name?: string };

interface FileFieldOptions {
  maxBytes?: number;
  accept?: string | readonly string[];      // MIME or extension allowlist
  filename?: { maxLength?: number; pattern?: RegExp };
  magicBytes?: FileMagicBytesOption;        // refuses content-type spoofing
  optional?: boolean;
  format?: string;
}

interface MultipartObjectOptions { strict?: boolean }  // refuses unknown fields by default`}
      />

      <h2>
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

      <h2>
        <code>@daloyjs/core/websocket</code>
      </h2>
      <CodeBlock
        code={`defineWebSocket<P, S, TData>(handler: WebSocketHandler<P, S, TData>): WebSocketHandler<P, S, TData>;

interface WebSocketHandler<P, S = AppState, TData = unknown> {
  beforeUpgrade?: (ctx: WebSocketContext<P, S>) => void | Response | Promise<void | Response>;
  open?:    (conn: WebSocketConnection<TData>, ctx) => void | Promise<void>;
  message?: (conn, msg: MessageEvent, ctx) => void | Promise<void>;
  close?:   (conn, code: number, reason: string, ctx) => void | Promise<void>;
  error?:   (conn, err: Error, ctx) => void | Promise<void>;
  // limits
  maxPayloadLength?:       number;   // default: 1 MiB
  backpressureLimit?:      number;   // default: 1 MiB
  idleTimeoutSeconds?:     number;   // default: 120
  allowedSubprotocols?:    readonly string[];
  origin?:                 string | readonly string[] | ((origin) => boolean);
}

wsRateLimit(opts: { windowMs; max; groupId?; keyGenerator?; store? }): WebSocketBeforeUpgrade;
normalizeWebSocketOptions(handler, ctx): NormalizedWebSocketOptions;

// Constants
WS_GUID; WS_READY_STATE; WS_OPCODE; WS_CLOSE_CODE; WS_MAX_CONTROL_PAYLOAD;
DEFAULT_WS_BACKPRESSURE_LIMIT;      // 1 MiB
DEFAULT_WS_MAX_PAYLOAD_LENGTH;      // 1 MiB
DEFAULT_WS_IDLE_TIMEOUT_SECONDS;    // 120

// Frame primitives (for custom adapters)
parseSubprotocols(header: string | null | undefined): string[];
validateSelectedSubprotocol(selected, allowed): boolean;
checkWebSocketOrigin(origin, allowed): boolean;
parseFrame(buf: Uint8Array, opts?): ParsedFrame | typeof FRAME_INCOMPLETE;
encodeFrame(opts): Uint8Array;
encodeClosePayload(code: number, reason?: string): Uint8Array;
decodeClosePayload(payload: Uint8Array): { code: number; reason: string };
encodeSendPayload(data: string | ArrayBufferLike | ArrayBufferView): Uint8Array;
computeAcceptKey(secWebSocketKey: string): string;

class WebSocketRegistry {}
class WebSocketProtocolError extends Error {}
class WebSocketPayloadTooLargeError extends WebSocketProtocolError {}
class FrameSink { /* event emitter over an async byte stream */ }`}
      />

      <h2>
        <code>@daloyjs/core/tracing</code>
      </h2>
      <CodeBlock
        code={`otelTracing(opts: OtelTracingOptions): Hooks;   // BYO @opentelemetry/api tracer

interface OtelTracingOptions {
  tracer: TracingTracer;
  serviceName?: string;
  includeRequestHeaders?: readonly string[];
  includeResponseHeaders?: readonly string[];
  recordExceptions?: boolean;
}

const TRACING_SPAN_KIND_SERVER:   number;
const TRACING_SPAN_STATUS_UNSET:  number;
const TRACING_SPAN_STATUS_OK:     number;
const TRACING_SPAN_STATUS_ERROR:  number;`}
      />

      <h2>
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

      <h2>
        <code>@daloyjs/core/rate-limit-redis</code>
      </h2>
      <CodeBlock
        code={`redisRateLimitStore(opts: RedisRateLimitStoreOptions): RateLimitStore;
ioredisAdapter (client: IoredisLike):  RedisCommands;
nodeRedisAdapter(client: NodeRedisLike): RedisCommands;

interface RedisRateLimitStoreOptions {
  client:  RedisCommands;
  prefix?: string;             // default: "daloy:rl:"
  scriptCacheKey?: string;
}
interface RedisCommands {
  evalsha?: (...) => Promise<unknown>;
  eval?:    (...) => Promise<unknown>;
  // ... narrow subset; adapters provided for ioredis + node-redis.
}`}
      />

      <h2>
        <code>@daloyjs/core/banner</code>
      </h2>
      <CodeBlock
        code={`formatStartupBanner(opts: StartupBannerOptions): string;
printStartupBanner (opts: StartupBannerOptions): void;`}
      />

      <h2>
        <code>@daloyjs/core/cli</code>
      </h2>
      <CodeBlock
        code={`// Internals used by bin/daloy.mjs. Most users will not import this directly,
// but the surface is public-typed so wrappers can compose it.
type DevRuntime = "node" | "bun" | "deno";
detectRuntime(): DevRuntime;
buildDevCommand(runtime: DevRuntime, entry: string): { command: string; args: string[] };
parseArgs(argv: readonly string[]): { command: string; opts: CliOptions };
buildAiDump(app: App, opts: CliOptions): Record<string, unknown>;
assertSafeEntryPath(entry: string, context: string): void;
normalizeEntryArg(entry: string): string;`}
      />

      <h2>Runtime adapters</h2>

      <h3>
        <code>@daloyjs/core/node</code>
      </h3>
      <CodeBlock
        code={`serve(app: App, opts?: NodeServerOptions): NodeServerHandle;

interface NodeServerOptions {
  port?:                 number;   // default: 3000
  hostname?:             string;   // default: "0.0.0.0"
  connectionTimeoutMs?:  number;   // default: 30_000
  shutdownTimeoutMs?:    number;   // default: 10_000
  handleSignals?:        boolean;  // default: true (SIGINT/SIGTERM)
  maxHeaderBytes?:       number;   // default: 16 KiB
  trustProxy?:           boolean;  // honor x-forwarded-proto/host (only behind a trusted LB)
  maxConnections?:       number;   // cap concurrent sockets (admission control); default: unset (unbounded)
  bufferedBodyMaxBytes?: number;   // default: 256 KiB (pre-buffer threshold for POST hot path)
}
interface NodeServerHandle { server: Server; port: number; close(): Promise<void> }`}
      />

      <h3>
        <code>@daloyjs/core/bun</code>
      </h3>
      <CodeBlock
        code={`serve(app: App, opts?: BunServeOptions): BunServerHandle;

interface BunServeOptions {
  port?:               number;
  hostname?:           string;
  maxRequestBodySize?: number;  // default: 16 MiB
  idleTimeout?:        number;
  development?:        boolean;
  unix?:               string;
  tls?:                BunTLSOptions;
}
interface BunServerHandle { port: number; url: URL | undefined; stop(): Promise<void> }`}
      />

      <h3>
        <code>@daloyjs/core/deno</code>
      </h3>
      <CodeBlock
        code={`serve(app: App, opts?: DenoServeOptions): DenoServerHandle;

interface DenoServeOptions {
  port?: number; hostname?: string;
  signal?: AbortSignal;
  cert?: string; key?: string;                   // HTTPS pair
  onListen?: (info: { hostname: string; port: number }) => void;
  onError?:  (err: unknown) => Response | Promise<Response>;
  handleSignals?: boolean;                       // default: true
  shutdownTimeoutMs?: number;                    // default: 10_000
}
interface DenoServerHandle { shutdown(): Promise<void> }`}
      />

      <h3>
        <code>@daloyjs/core/cloudflare</code>
      </h3>
      <CodeBlock
        code={`toFetchHandler<Env = unknown>(app: App): ExportedFetchHandler<Env>;
  // export default toFetchHandler(app);

interface ExportedFetchHandler<Env = unknown> {
  fetch: (request: Request, env?: Env, ctx?: { waitUntil?; passThroughOnException? }) => Promise<Response>;
}`}
      />

      <h3>
        <code>@daloyjs/core/vercel</code>
      </h3>
      <CodeBlock
        code={`type WebHandler = (req: Request) => Promise<Response>;
interface FetchHandler { fetch: WebHandler }
type RouteHandlers = Record<"GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"OPTIONS"|"HEAD", WebHandler>;

toWebHandler   (app: App): WebHandler;        // bare function (Edge, middleware)
toFetchHandler (app: App): FetchHandler;      // default export for Node Functions
toRouteHandlers(app: App): RouteHandlers;     // Next.js App Router route.ts
const toEdgeHandler = toWebHandler;           // backwards-compat alias`}
      />

      <h3>
        <code>@daloyjs/core/fastly</code>
      </h3>
      <CodeBlock
        code={`toFastlyHandler(app: App): (req: Request) => Promise<Response>;
installFastlyListener(app: App): void;   // wires addEventListener("fetch", ...)`}
      />

      <h3>
        <code>@daloyjs/core/lambda</code>
      </h3>
      <CodeBlock
        code={`toLambdaHandler(app: App): LambdaHandler;

type LambdaHandler  = (event: LambdaEvent) => Promise<LambdaResponse>;
type LambdaEvent    = LambdaEventV1   | LambdaEventV2;     // API Gateway REST + HTTP/Function URLs
type LambdaResponse = LambdaResponseV1 | LambdaResponseV2;`}
      />

      <h2>Test-only / internal helpers</h2>
      <p>
        These are exported for internal tests and tooling. They are public-typed
        but underscore-prefixed; they may change without a semver bump. Most
        application code will never need them.
      </p>
      <CodeBlock
        code={`_resetPackageJsonCacheForTests();
_resetCrashHandlersForTests();
_resetInsecureDefaultsLogForTests();
_resetCompressionRuntimeProbeForTests();
_resetSharedRateLimitStoresForTests();`}
      />
    </>
  );
}
