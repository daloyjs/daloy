import { Router } from "./router.js";
import {
  WebSocketRegistry,
  normalizeWebSocketOptions,
  type WebSocketHandler,
} from "./websocket.js";
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  InternalError,
  MethodNotAllowedError,
  NotFoundError,
  PayloadTooLargeError,
  RequestTimeoutError,
  TooManyRequestsError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "./errors.js";
import { validate } from "./schema.js";
import { readBodyLimited, safeJsonParse, randomId, assertNoDuplicateSingletonHeaders, assertStrongSecret, timingSafeEqual } from "./security.js";
import { createLogger, noopLogger, type Logger } from "./logger.js";
import type {
  BaseContext,
  HttpMethod,
  Hooks,
  PathString,
  RequestSchemas,
  ResponsesMap,
  RouteDefinition,
} from "./types.js";
import {
  generateOpenAPI,
  openapiToYAML,
  type OpenAPIInfo,
  type OpenAPIOptions,
} from "./openapi.js";
import {
  docsContentSecurityPolicy,
  scalarHtml,
  swaggerUiHtml,
  type DocsContentSecurityPolicyOptions,
  type ScalarReferenceConfiguration,
} from "./docs.js";
import {
  secureHeaders as secureHeadersMiddleware,
  CORS_HOOK_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  CORS_WILDCARD_ORIGIN_MARKER,
  CSRF_HOOK_MARKER,
  REQUIRE_SCOPES_AGGREGATE_KEY,
  REQUIRE_SCOPES_HOOK_MARKER,
  SECURE_HEADERS_MARKER,
  type CorsOriginAllow,
  type SecureHeadersOptions,
} from "./middleware.js";
import {
  SESSION_HOOK_MARKER,
  SESSION_SECRETS_MARKER,
} from "./session.js";
import { loadShedding as loadSheddingMiddleware, type LoadSheddingOptions } from "./load-shedding.js";
import { securitySchemeRequiresPayloadAuth } from "./security-schemes.js";
import { assertBehindProxy, type BehindProxyConfig } from "./conn-info.js";

const AUTO_SECURE_HEADERS_MARKER: unique symbol = Symbol.for(
  "daloyjs.app.autoSecureHeaders",
);

/**
 * Module-level latch shared across every {@link App} constructed in the same
 * process. Ensures `unhandledRejection` / `uncaughtException` handlers are
 * registered at most once — installing them twice would log the same crash
 * twice (and once per listener thereafter), polluting the final exit signal.
 */
let crashHandlersInstalled = false;
let activeCrashLogger: Logger | undefined;
function setActiveCrashLogger(log: Logger): void {
  activeCrashLogger = log;
}
/** @internal Test-only helper to reset the latch between tests. */
export function _resetCrashHandlersForTests(): void {
  crashHandlersInstalled = false;
  activeCrashLogger = undefined;
}

/**
 * Wave 8 — once-per-process latch for the `secureDefaults: false` warning
 * log. Multiple `new App({ secureDefaults: false })` instances in the same
 * process share one log entry instead of flooding the access log with
 * duplicate warnings on every construction.
 */
let insecureDefaultsLoggedThisProcess = false;
/** @internal Test-only helper to reset the latch between tests. */
export function _resetInsecureDefaultsLogForTests(): void {
  insecureDefaultsLoggedThisProcess = false;
}

/**
 * Wave 8 — list of secure-by-default surfaces disabled when
 * `secureDefaults: false` is set. Surfaced through the once-per-process
 * `error` log so the operator sees exactly which guards are off.
 */
const DISABLED_BY_INSECURE_DEFAULTS: readonly string[] = Object.freeze([
  "secureHeaders auto-install",
  "cross-origin guard for state-changing requests",
  "crash-on-unhandled-rejection (production)",
  "first-request X-Forwarded-* / trustProxy guard",
  "session() + state-changing route requires csrf() boot guard",
  "weak session secret refuse-to-boot",
  "cors({ origin: '*' }) refuse-to-boot",
  "anonymous stateful plugin refuse-to-boot",
]);

/**
 * Configuration accepted by {@link App}'s constructor. Every field is
 * optional; sensible production defaults are applied.
 *
 * @since 0.1.0
 */
export interface AppOptions {
  /** OpenAPI document metadata */
  title?: string;
  version?: string;
  description?: string;

  /** Validate handler responses against declared response schemas. Default: true. */
  validateResponses?: boolean;

  /** Hard cap on request body size in bytes. Default: 1 MiB. */
  bodyLimitBytes?: number;

  /** Reject requests whose Content-Type isn't in this allowlist (when a body schema is declared). */
  allowedContentTypes?: string[];

  /** Per-request timeout in ms (handler + hooks). Default: 30000. Set 0 to disable. */
  requestTimeoutMs?: number;

  /**
   * Per-request limits applied when parsing `multipart/form-data` bodies.
   * These run in addition to `bodyLimitBytes`. Use them to cap the size of
   * any single uploaded file, the total number of fields, and the total
   * number of file uploads accepted in one request.
   */
  multipart?: {
    /** Reject any single file whose `size` exceeds this many bytes. */
    maxFileBytes?: number;
    /** Reject the request if it carries more than this many fields total. */
    maxFields?: number;
    /** Reject the request if it carries more than this many file uploads. */
    maxFiles?: number;
  };

  /** Production mode hides 5xx detail in error responses. Default: NODE_ENV === "production". */
  production?: boolean;

  /**
   * Explicit runtime environment. Takes precedence over `NODE_ENV` and
   * {@link AppOptions.production}. When set, a one-time `warn` is logged if
   * the value disagrees with `process.env.NODE_ENV` so deploy mismatches
   * surface loudly instead of silently shipping a misconfigured production
   * build. Accepted values mirror the canonical Node ecosystem strings.
   *
   * @since 0.15.0
   */
  env?: "development" | "production" | "test";

  /**
   * Strip the `Server` and `X-Powered-By` response headers from every
   * response (including those produced by user middleware). Defaults to
   * `true` — fingerprinting parity with the rest of the secure-by-default
   * surface. Set `false` only when you need the headers for downstream
   * observability tooling.
   *
   * @since 0.15.0
   */
  stripServerHeaders?: boolean;

  /**
   * Master switch for the secure-by-default Wave 2 surface (auto-applied
   * {@link secureHeaders}, cross-origin guard for state-changing requests
    * when no {@link cors} hook allows the request origin). Defaults to `true`
    * in `@daloyjs/core@0.16.0` and later. Per-feature opt-outs
   * (`secureHeaders: false`, `corsCrossOriginGuard: false`) remain available
   * when this is left on. Pass `false` to restore the pre-0.16 behavior
   * wholesale.
   *
   * @since 0.16.0
   */
  secureDefaults?: boolean;

  /**
   * Wave 8 master-flag escape hatch acknowledgement. Required when
   * {@link AppOptions.secureDefaults} is `false` AND the resolved
   * environment is production. Setting this to `true` confirms that the
   * caller understands every Wave 1–7 default is being disabled wholesale
   * and accepts the resulting attack surface — refusing-to-construct in
   * production by default prevents the "developer flipped `secureDefaults`
   * off while debugging and shipped to production" class of accidents.
   * Whenever `secureDefaults: false` is set (in any environment), the
   * framework logs a once-per-process `error` naming every default that
   * the flag turned off.
   *
   * @since 0.26.0
   */
  acknowledgeInsecureDefaults?: boolean;

  /**
   * Auto-install {@link secureHeaders} as a global hook so every response
   * carries hardened defaults (HSTS, X-Frame-Options, nosniff, strict
   * referrer, COOP/CORP, default CSP, etc.). Active when
   * {@link AppOptions.secureDefaults} is not `false`. Pass `false` to skip
   * the auto-install (you may still register your own `secureHeaders()` via
   * `app.use(...)`). Pass an options object to override the defaults of the
   * auto-installed instance.
   *
   * @since 0.16.0
   */
  secureHeaders?: SecureHeadersOptions | false;

  /**
   * Reject state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) that
    * carry a cross-origin `Origin` header when no {@link cors} hook in the
    * matched route's hook chain allows that origin. Active when
    * {@link AppOptions.secureDefaults} is not `false`. Returns
    * `403 application/problem+json` so the rejection is loud at the network
    * boundary instead of silently allowing a CSRF / SSRF surface. Set to
    * `false` if you intentionally serve a cross-origin API without `cors()`
    * (rare; almost always a misconfiguration).
   *
   * @since 0.16.0
   */
  corsCrossOriginGuard?: boolean;

  /**
   * Declare whether the application sits behind a trusted reverse proxy
   * that populates `X-Forwarded-*` headers (load balancer, CDN, Vercel,
   * Cloudflare, AWS ALB, etc.). The value is opt-in tri-state for the
   * Wave 3 first-request guard:
   *
   * - `undefined` (default) — *unconfigured*. The framework returns
   *   `500 problem+json` on the first request that carries an
   *   `X-Forwarded-*` header so a misconfigured proxy chain cannot silently
   *   leak spoofed client IPs to the rate limiter, audit logs, or
   *   request-id propagation. Disabled when {@link AppOptions.secureDefaults}
   *   is `false`.
   * - `true` — *trust*. The framework reads `X-Forwarded-*` without
   *   suspicion. Use only when every request passes through a proxy chain
   *   you control.
   * - `false` — *explicitly do not trust*. The framework ignores
   *   `X-Forwarded-*` even when present and silences the unconfigured-proxy
   *   guard. Use when the application is exposed directly to the public
   *   internet on purpose.
   *
   * @since 0.17.0
   */
  trustProxy?: boolean;

  /**
   * Declarative reverse-proxy posture (Wave 6 — `0.24.0`). Supersedes the
   * boolean {@link AppOptions.trustProxy} with a structured value that
   * simultaneously configures rate-limit keying, TLS enforcement, request-IP
   * resolution, and the `X-Forwarded-*` accept policy from a single source
   * of truth.
   *
   * - `"none"` — refuse `X-Forwarded-*` entirely.
   * - `"loopback"` — trust only when the immediate peer is `127.0.0.1` / `::1`.
   * - `{ hops: N }` — trust the proxy chain when exactly N hops sit between
   *   Daloy and the public internet; reads the (N+1)-from-rightmost IP.
   * - `{ cidrs: [...] }` — trust only when the immediate peer's address
   *   falls inside one of the supplied CIDR ranges.
   *
   * When supplied, the legacy {@link AppOptions.trustProxy} guard is
   * considered satisfied (the framework knows what to do with forwarded
   * headers without further input).
   *
   * @since 0.24.0
   */
  behindProxy?: BehindProxyConfig;

  /**
   * Opt-out for the Wave 3 boot guard that refuses to start an App which
   * registers {@link session} and any state-changing route without a
   * matching {@link csrf} hook. Set to `"off"` to acknowledge that you
   * intentionally accept cookie-authenticated POST / PUT / PATCH / DELETE
   * requests without CSRF protection (SPA + bearer-token apps, internal
   * services on a private network, etc.). Leave unset (the default) for
   * any browser-facing API: the boot error includes one-line copy-paste
   * remediation. Disabled when {@link AppOptions.secureDefaults} is `false`.
   *
   * @since 0.17.0
   */
  csrf?: "off";

  /**
   * Install Node-process-level crash handlers for `unhandledRejection` and
   * `uncaughtException` that log the error through the pluggable logger at
   * `fatal` and exit with code `1`. Idempotent across multiple `new App()`
   * calls in the same process — handlers are installed once per process via
   * a module-level latch and re-use the most recently constructed App's
   * logger. Default: `true` in production when
   * {@link AppOptions.secureDefaults} is not `false`. Pass `false` to opt
   * out (long-running CLI processes / test harnesses that intentionally
   * swallow rejections may want this). No-op on runtimes without
   * `process.on` (Cloudflare Workers / Vercel Edge / Fastly).
   *
   * @since 0.18.0
   */
  crashOnUnhandledRejection?: boolean;

  /**
   * HTTP status code used in access logs when a request handler completes
   * but the client has already disconnected (`request.signal.aborted`).
   * Defaults to `499` (nginx convention: "Client Closed Request"). Must be
   * an integer in the inclusive range `[400, 499]`; values outside that
   * range cause the constructor to throw. Set to disable the rewrite by
   * keeping the handler's original status: pass `0`.
   *
   * The client receives no response (the connection is gone); this option
   * only controls how the access log line classifies the request so
   * disconnect storms do not look like 5xx errors in dashboards.
   *
   * @since 0.20.0
   */
  disconnectStatusCode?: number;

  /**
   * Install the {@link loadShedding} pressure monitor as a global hook.
   * `true` uses the defaults (event-loop delay at most 1 s, event-loop
   * utilization at most 0.98, sample interval 1 s). Pass an options object to
   * override individual thresholds.
   *
   * Active when {@link AppOptions.secureDefaults} is not `false`.
   *
   * @since 0.20.0
   */
  loadShedding?: boolean | LoadSheddingOptions;

  /** Pluggable logger. Default: structured JSON logger at "info" (or noop in test). */
  logger?:
    | Logger
    | { level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" }
    | false;

  /**
   * Mock mode: instead of running handlers, return the first declared response example
   * (or an empty body matching the schema). Useful for frontend teams.
   */
  mockMode?: boolean;

  /** Global hooks applied to every route. */
  hooks?: Hooks;

  /**
   * OpenAPI 3.1 document metadata used by the built-in auto-mounted
   * `/openapi.json` route and any other consumer that calls
   * `generateOpenAPI(app)` without its own options. When `info.title` /
   * `info.version` are omitted they fall back to the top-level
   * {@link AppOptions.title} / {@link AppOptions.version} fields, then to
   * `"DaloyJS API"` / `"0.0.0"`.
   *
   * @since 0.3.0
   */
  openapi?: AppOpenAPIOptions;

  /**
   * Enable the built-in API documentation surface — a `/openapi.json` route
   * that serves the live OpenAPI 3.1 spec and a `/docs` route that serves a
   * Scalar (default) or Swagger UI HTML page that loads it. This is the
   * one-line equivalent of FastAPI's automatic `/docs` UI.
   *
   * - `false` (default) — never mount. Write your own with `generateOpenAPI`
   *   + `swaggerUiHtml` / `scalarHtml` for full control.
   * - `true` — always mount on `/openapi.json` and `/docs`.
   * - `"auto"` — mount when `NODE_ENV !== "production"`; otherwise skip. This
   *   is a "secure by default" choice: production deployments should opt in
   *   explicitly so internal APIs do not accidentally publish a browsable
   *   schema.
    * - object — full configuration (custom paths, UI choice, title, Scalar UI
    *   config, CSP overrides). The `enabled` field on the object can override the
   *   auto/prod rule.
   *
   * The default is `false` so adding a new `App({ ... })` to an existing app
   * never silently changes its public surface; scaffolded projects from
   * `create-daloy` set `docs: true` for the auto-mount experience.
   *
   * @since 0.3.0
   */
  docs?: boolean | "auto" | DocsRouteOptions;
}

/**
 * Subset of {@link OpenAPIOptions} accepted by `new App({ openapi })`. All
 * fields are optional; `info.title` / `info.version` fall back to the
 * top-level {@link AppOptions.title} / {@link AppOptions.version}.
 *
 * @since 0.3.0
 */
export interface AppOpenAPIOptions {
  info?: Partial<OpenAPIInfo>;
  servers?: OpenAPIOptions["servers"];
  securitySchemes?: OpenAPIOptions["securitySchemes"];
  webhooks?: OpenAPIOptions["webhooks"];
}

/**
 * Configuration for the auto-mounted docs surface. Pass to
 * `new App({ docs: { ... } })` to override defaults; omit to take all
 * defaults.
 *
 * @since 0.3.0
 */
export interface DocsRouteOptions {
  /** Path the docs UI is served from. Default `"/docs"`. */
  path?: PathString;
  /** Path the OpenAPI 3.1 JSON spec is served from. Default `"/openapi.json"`. */
  openapiPath?: PathString;
  /**
   * Path the OpenAPI 3.1 YAML spec is served from. Default `"/openapi.yaml"`.
   * Set to `false` to disable the YAML route.
   *
   * @since 0.13.1
   */
  openapiYamlPath?: PathString | false;
  /** Which built-in UI to render. Default `"scalar"` (smaller payload, modern UI). */
  ui?: "scalar" | "swagger";
  /** Scalar API reference UI configuration. Ignored when `ui: "swagger"`. */
  scalar?: ScalarReferenceConfiguration;
  /** Page `<title>`. Defaults to the resolved OpenAPI `info.title`. */
  title?: string;
  /**
   * Force the docs to mount regardless of `NODE_ENV`. When `"auto"` (default
   * for the object form), behaves like the top-level `docs: "auto"` setting.
   */
  enabled?: boolean | "auto";
  /**
   * Tags attached to the auto-mounted operations in the generated spec.
   * Default: `["Docs"]`. Pass an empty array to omit tags entirely.
   */
  tags?: string[];
  /**
   * Override the Content-Security-Policy applied to the docs HTML response.
   * Forwarded to {@link docsContentSecurityPolicy}.
   */
  csp?: DocsContentSecurityPolicyOptions;
}

/** Information passed to {@link App.onPluginInstalled} listeners. */
export interface PluginInstalledEvent {
  /** Name of the plugin (only set when registered with `{ name, register }`). */
  name?: string;
  /** Effective mount prefix after parent/group prefixes are applied. */
  prefix: string;
}

/**
 * Lifecycle-hook contribution declared by a plugin (Wave 6 item 10).
 * Combined with `before` / `after` ordering hints so security middleware
 * order is deterministic regardless of plugin-registration order.
 *
 * @since 0.24.0
 */
export interface PluginExtension {
  /** Unique extension name. Referenced by `before` / `after` on siblings. */
  name: string;
  /** Lifecycle event the handler attaches to. */
  event: "onRequest" | "beforeHandle" | "afterHandle" | "onSend" | "onError";
  /** Hook handler. The shape mirrors the matching {@link Hooks} entry. */
  handler: (...args: any[]) => any;
  /** Extension names this one must run before. */
  before?: readonly string[];
  /** Extension names this one must run after. */
  after?: readonly string[];
}

/** Information passed to {@link App.onShutdown} listeners. */
export interface ShutdownEvent {
  /** Optional human-readable reason supplied to `app.shutdown(_, reason)`. */
  reason?: string;
  /** Drain timeout (ms) the shutdown will use after listeners finish. */
  timeoutMs: number;
}

/**
 * Configuration accepted by {@link App.healthcheck} and
 * {@link App.readinesscheck}. All fields are optional.
 *
 * @since 0.18.0
 */
export interface HealthRouteOptions {
  /** Override the default path (`/healthz` or `/readyz`). */
  path?: PathString;
  /**
   * Require `Authorization: Bearer <token>` on the probe request. Compared
   * via {@link timingSafeEqual}. When set in production with
   * `secureDefaults: true`, no further opt-in is required.
   */
  token?: string;
  /**
   * Per-IP fixed-window rate limit. Defaults to `{ limit: 60, windowMs:
   * 60_000 }` (in-memory, per-process). Pass `false` to disable.
   */
  rateLimit?: { limit?: number; windowMs?: number } | false;
  /**
   * Acknowledge that the probe is intentionally reachable without
   * credentials in production. Required when `secureDefaults` is on and
   * `token` is omitted; otherwise registration throws.
   */
  acknowledgeUnauthenticated?: boolean;
}

/**
 * Configuration accepted by {@link App.cspReportRoute}. Every field is
 * optional.
 *
 * @since 0.20.0
 */
export interface CspReportRouteOptions {
  /** Override the default path (`"/__csp-report"`). */
  path?: PathString;
  /**
   * Per-IP fixed-window rate limit. Defaults to
   * `{ limit: 60, windowMs: 60_000 }` (in-memory, per-process). Pass
   * `false` to disable.
   */
  rateLimit?: { limit?: number; windowMs?: number } | false;
  /**
   * Maximum accepted request body size, in bytes. Default `8192`. Larger
   * bodies are rejected with `413`. Hard upper bound is 65536 bytes
   * (Wave 11) — CSP / Reporting API reports are small; a cap above 64 KiB
   * is rejected at construction time as a DoS-via-report-flood defense.
   */
  maxBodyBytes?: number;
  /**
   * Custom sink for parsed reports. Receives the parsed JSON body plus the
   * source IP (or `null` when unknown). Defaults to logging at `warn`
   * through the pluggable logger so violations show up in standard
   * dashboards without extra wiring.
   */
  onReport?: (
    report: unknown,
    ctx: { ip: string | null; userAgent: string | null },
  ) => void | Promise<void>;
  /**
   * Wave 11 — when `false` (the default in production), the default logger
   * sink omits the parsed report body and logs only `{ ip, userAgent }`.
   * CSP reports include the URL that violated CSP, which may contain PII
   * (e.g. a session-id query parameter on a navigation that triggered the
   * report). Opt in only when the operator has reviewed their logging
   * pipeline. Ignored when `onReport` is supplied — custom sinks own their
   * own redaction policy.
   *
   * @since 0.30.0
   */
  logCspReportBodies?: boolean;
}

/**
 * Lightweight introspection record produced by {@link App.introspect}. Useful
 * for tooling (dead-route checks, custom dashboards) that needs to enumerate
 * the registered surface without parsing the OpenAPI document.
 *
 * @since 0.1.0
 */
export interface IntrospectedRoute {
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
  /**
   * Optional AI-friendly metadata declared via `route({ meta: ... })`.
   * Same shape published in OpenAPI as `x-daloy-*` and consumed by
   * `daloy inspect --ai`.
   *
   * @since 0.14.0
   */
  meta?: import("./types.js").RouteMeta;
}

interface CompiledRoute {
  def: RouteDefinition<any, any, any, any>;
  hooks: Hooks;
  /** CORS origin allowlist predicates captured from group and route-level hooks. */
  corsOriginAllows: CorsOriginAllow[];
}

interface RouteSecurityMarkers {
  method: HttpMethod;
  path: string;
  hasSession: boolean;
  hasCsrf: boolean;
}

interface Wave3BootGuardCache {
  checked: boolean;
  error?: Error;
}

const DEFAULTS = {
  bodyLimitBytes: 1024 * 1024,
  requestTimeoutMs: 30_000,
  validateResponses: true,
};

/**
 * Contract-first HTTP application.
 *
 * `App` is the top-level entry point: register {@link RouteDefinition routes}
 * with {@link App.route}, layer cross-cutting behavior with
 * {@link App.use}/{@link App.register}, then expose the application to a
 * runtime via {@link App.fetch} (Web standard) or one of the adapter subpaths
 * such as `@daloyjs/core/node`, `@daloyjs/core/cloudflare`, or
 * `@daloyjs/core/lambda`.
 *
 * The same `App` instance powers:
 *
 *  - request routing (`Router` under the hood)
 *  - request/response validation against Standard-Schema validators
 *  - OpenAPI 3.1 generation (`generateOpenAPI(app)`)
 *  - typed in-process client (`createClient(app)`) and generated SDK
 *  - graceful shutdown and lifecycle observability
 *
 * `App` is **runtime-agnostic**: the same instance runs on Node, Bun, Deno,
 * Cloudflare Workers, Vercel Edge, AWS Lambda, and Fastly Compute via the
 * dedicated adapters.
 *
 * @example
 * ```ts
 * import { App, secureHeaders } from "@daloyjs/core";
 * import { z } from "zod";
 *
 * const app = new App({ title: "Books API", version: "1.0.0" });
 *
 * app.use(secureHeaders());
 *
 * app.route({
 *   method: "GET",
 *   path: "/books/:id",
 *   operationId: "getBook",
 *   request: { params: z.object({ id: z.uuid() }) },
 *   responses: {
 *     200: { description: "OK", body: z.object({ id: z.string(), title: z.string() }) },
 *   },
 *   handler: ({ params }) => ({ status: 200, body: { id: params.id, title: "Dune" } }),
 * });
 *
 * // Node:
 * import { serve } from "@daloyjs/core/node";
 * serve(app, { port: 3000 });
 * ```
 *
 * @since 0.1.0
 */
export class App {
  readonly options: Required<
    Pick<
      AppOptions,
      "validateResponses" | "bodyLimitBytes" | "requestTimeoutMs"
    >
  > &
    AppOptions;
  readonly log: Logger;
  /** Public registry: enables OpenAPI gen, typed-client gen, dead-route detection. */
  readonly routes: RouteDefinition<any, any, any, any>[] = [];

  private router = new Router<CompiledRoute>();
  /** WebSocket route registry. Adapters look up handlers via `app.webSocketRoutes.find()`. */
  readonly webSocketRoutes: WebSocketRegistry = new WebSocketRegistry();
  private prefix = "";
  private groupHooks: Hooks[] = [];
  private groupTags: string[] = [];
  private groupAuth?: RouteDefinition["auth"];
  /** Effective security markers for each registered route hook chain. */
  private routeSecurityMarkers: RouteSecurityMarkers[] = [];
  /** Decorator bag merged into ctx.state on every request. */
  private decorations: Record<string, unknown> = {};
  private installedPlugins = new Set<string>();
  private closeHooks: Array<() => void | Promise<void>> = [];
  private closeHooksRun = false;
  /** Wave 4 idle-connection close hooks (adapter-registered, sync). */
  private idleConnectionCloseHooks: Array<() => void> = [];
  private pluginInstalledListeners: Array<
    (info: PluginInstalledEvent) => void | Promise<void>
  > = [];
  private shutdownListeners: Array<
    (info: ShutdownEvent) => void | Promise<void>
  > = [];
  private shutdownListenersRun = false;
  private pendingPlugins = new Set<Promise<unknown>>();
  private pluginBootError: { failed: boolean; error: unknown } = {
    failed: false,
    error: undefined,
  };
  /** In-flight request count for graceful shutdown. */
  private inflight = 0;
  private draining = false;
  /**
    * CORS origin allowlist predicates from the currently active group-level
    * hooks. Used for unmatched routes; matched routes use the snapshot stored
    * on their compiled route so later `app.use(cors(...))` calls do not
    * retroactively loosen earlier routes.
   */
    private corsOriginAllows: CorsOriginAllow[] = [];

  /**
   * Whether the Wave 3 once-only boot guard has run (session + CSRF +
   * state-changing-route check). The check is deferred to first request
   * because route registration and `app.use(csrf(...))` can happen in any
   * order after construction; doing it on first `fetch()` is the latest
   * point we still get a 500 before any handler ever runs.
   */
  private wave3BootGuard: Wave3BootGuardCache = { checked: false };

  /**
   * Latched marker stamped after the framework has reported the first
   * unconfigured-proxy request. Logged once at `warn` level so production
   * dashboards see the misconfiguration without flooding on every retry.
   */
  private trustProxyWarned = false;

  constructor(options: AppOptions = {}) {
    this.options = {
      validateResponses:
        options.validateResponses ?? DEFAULTS.validateResponses,
      bodyLimitBytes: options.bodyLimitBytes ?? DEFAULTS.bodyLimitBytes,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      ...options,
    };
    this.log =
      options.logger === false
        ? noopLogger
        : options.logger &&
            typeof (options.logger as Logger).info === "function"
          ? (options.logger as Logger)
          : createLogger({ level: (options.logger as any)?.level ?? "info" });

    this.warnOnEnvMismatch();
    this.assertDisconnectStatusCode();
    assertBehindProxy(this.options.behindProxy);
    if (this.options.hooks) this.assertSecureHookConfig(this.options.hooks);
    this.assertInsecureDefaultsAcknowledged();
    this.installSecureDefaults();
    this.maybeInstallCrashHandlers();
    this.maybeMountDocs();
  }

  /**
   * Wave 4 leftover: validate {@link AppOptions.disconnectStatusCode}.
   * Refuses anything outside `[400, 499]` (except `0`, which disables the
   * rewrite). Throws at construction time so the misconfiguration cannot
   * survive past boot.
   */
  private assertDisconnectStatusCode(): void {
    const v = this.options.disconnectStatusCode;
    if (v === undefined || v === 0) return;
    if (!Number.isInteger(v) || v < 400 || v > 499) {
      throw new Error(
        `disconnectStatusCode must be an integer in [400, 499] or 0; got ${String(v)}.`,
      );
    }
  }

  /**
   * Wave 8 — master-flag escape-hatch enforcement. When
   * `secureDefaults: false` is set, the framework:
   *  - refuses-to-construct in production unless
   *    `acknowledgeInsecureDefaults: true` is also set; closes the
   *    "developer flipped the flag off while debugging and shipped to
   *    production" footgun.
   *  - emits a once-per-process `error` log naming every default the flag
   *    disables, so operators see the blast radius even if the option was
   *    set deep in shared configuration.
   */
  private assertInsecureDefaultsAcknowledged(): void {
    if (this.options.secureDefaults !== false) return;
    const inProduction = this.isProduction();
    if (inProduction && this.options.acknowledgeInsecureDefaults !== true) {
      throw new Error(
        "app({ secureDefaults: false }) is refused in production. " +
          "secureDefaults turns off the entire Wave 1–7 secure-by-default " +
          "surface (auto secureHeaders, cross-origin guard, crash-on-unhandled-rejection, " +
          "trustProxy guard, csrf/session boot guard, weak-secret refuse-to-boot, " +
          "cors({ origin: '*' }) refuse-to-boot, anonymous-stateful-plugin refuse-to-boot). " +
          "If you really need this in production, also pass " +
          "acknowledgeInsecureDefaults: true to confirm. Prefer per-feature opt-outs " +
          "(secureHeaders: false, corsCrossOriginGuard: false, crashOnUnhandledRejection: false, " +
          "trustProxy: false, csrf: \"off\") instead.",
      );
    }
    if (!insecureDefaultsLoggedThisProcess) {
      insecureDefaultsLoggedThisProcess = true;
      this.log.error(
        {
          event: "secure_defaults.disabled",
          production: inProduction,
          acknowledged: this.options.acknowledgeInsecureDefaults === true,
          disabled: DISABLED_BY_INSECURE_DEFAULTS,
        },
        `app({ secureDefaults: false }) disables: ${DISABLED_BY_INSECURE_DEFAULTS.join(", ")}.`,
      );
    }
  }

  /**
   * Install the Wave 2 secure-by-default global hooks. Currently:
   *  - {@link secureHeaders} as a group-level hook so every response carries
   *    the hardened baseline (HSTS, X-Frame-Options, nosniff, default CSP).
   *
   * Called once during construction — the CORS cross-origin guard lives
   * inside {@link App.fetch} because it needs the live request to decide.
   * The auto-installed `secureHeaders` instance only sets headers when the
   * response does not already carry them, so user-supplied
   * `app.use(secureHeaders({...}))` still wins per-header.
   */
  private installSecureDefaults(): void {
    if (this.options.secureDefaults === false) return;
    if (this.options.secureHeaders !== false) {
      const opts =
        this.options.secureHeaders &&
        typeof this.options.secureHeaders === "object"
          ? this.options.secureHeaders
          : {};
      const auto = secureHeadersMiddleware(opts);
      (auto as Record<PropertyKey, unknown>)[AUTO_SECURE_HEADERS_MARKER] = true;
      this.groupHooks.push(auto);
    }
    // Wave 4 leftover: opt-in load-shedding pressure monitor.
    if (this.options.loadShedding) {
      const lsOpts =
        typeof this.options.loadShedding === "object"
          ? this.options.loadShedding
          : {};
      this.groupHooks.push(loadSheddingMiddleware(lsOpts));
    }
  }

  /**
   * Wave 4 crash-on-unrecoverable-error guard. Installs Node-process-level
   * listeners for `unhandledRejection` and `uncaughtException` that log
   * through the pluggable logger and call `process.exit(1)`. Idempotent via
   * a module-level latch so multiple `new App()` instantiations in the same
   * process do not double-register; the most recently constructed App's
   * logger is used. No-op on runtimes without `process.on` (Workers / Edge
   * / Fastly), in non-production by default, and when
   * `crashOnUnhandledRejection: false` or `secureDefaults: false`.
   */
  private maybeInstallCrashHandlers(): void {
    if (this.options.crashOnUnhandledRejection === false) return;
    if (
      this.options.crashOnUnhandledRejection === undefined &&
      (this.options.secureDefaults === false || !this.isProduction())
    ) {
      return;
    }
    if (typeof process === "undefined" || typeof process.on !== "function") {
      return;
    }
    setActiveCrashLogger(this.log);
    if (crashHandlersInstalled) return;
    crashHandlersInstalled = true;
    process.on("unhandledRejection", (reason: unknown) => {
      const log = activeCrashLogger ?? this.log;
      try {
        log.fatal(
          { event: "process.unhandledRejection", err: serializeErr(reason) },
          "Unhandled promise rejection — exiting (crashOnUnhandledRejection)",
        );
      } catch {
        /* swallow logger failure so we still exit */
      }
      process.exit(1);
    });
    process.on("uncaughtException", (err: unknown) => {
      const log = activeCrashLogger ?? this.log;
      try {
        log.fatal(
          { event: "process.uncaughtException", err: serializeErr(err) },
          "Uncaught exception — exiting (crashOnUnhandledRejection)",
        );
      } catch {
        /* swallow logger failure so we still exit */
      }
      process.exit(1);
    });
  }

  /**
   * Emit a one-time `warn` when the explicit {@link AppOptions.env} option
   * disagrees with `process.env.NODE_ENV`. Silent when either signal is
   * missing — surfacing only real misconfiguration.
   */
  private warnOnEnvMismatch(): void {
    const env = this.options.env;
    if (env === undefined) return;
    const nodeEnv =
      typeof process !== "undefined" && typeof process.env !== "undefined"
        ? process.env.NODE_ENV
        : undefined;
    if (nodeEnv && nodeEnv !== env) {
      this.log.warn(
        { event: "env.mismatch", env, nodeEnv },
        `app({ env: "${env}" }) disagrees with NODE_ENV="${nodeEnv}"`,
      );
    }
  }

  /**
   * Resolve whether the app is running in production. Honours the explicit
   * {@link AppOptions.env} option first, then {@link AppOptions.production},
   * then falls back to `NODE_ENV === "production"`. Used by the docs
   * auto-mount and error response detail stripping.
   */
  private isProduction(): boolean {
    if (this.options.env !== undefined) return this.options.env === "production";
    if (this.options.production !== undefined) return this.options.production;
    return (
      typeof process !== "undefined" &&
      typeof process.env !== "undefined" &&
      process.env.NODE_ENV === "production"
    );
  }

  /**
   * Wave 2 cross-origin guard. Rejects state-changing requests (`POST` /
   * `PUT` / `PATCH` / `DELETE`) that carry an `Origin` header pointing at a
   * different origin than the request URL when no {@link cors} hook is
   * registered (neither at the app level nor on the matched route). Throws
   * a {@link ForbiddenError} that surfaces as `403 application/problem+json`
   * so the rejection is loud rather than silently allowing the unintended
   * cross-origin write.
   *
   * Disabled when {@link AppOptions.secureDefaults} is `false` or
   * {@link AppOptions.corsCrossOriginGuard} is `false`. Same-origin
   * requests, GET / HEAD / OPTIONS, requests with no `Origin` header, and
   * routes whose hook chain includes a `cors()` policy allowing the origin
   * are unaffected.
   */
  private assertCrossOriginAllowed(
    request: Request,
    url: URL,
    method: HttpMethod,
    corsOriginAllows: CorsOriginAllow[],
  ): void {
    if (this.options.secureDefaults === false) return;
    if (this.options.corsCrossOriginGuard === false) return;
    if (
      method !== "POST" &&
      method !== "PUT" &&
      method !== "PATCH" &&
      method !== "DELETE"
    ) {
      return;
    }
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return;
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      // Malformed Origin header — refuse loudly.
      throw new ForbiddenError(
        "Cross-origin state-changing request rejected: malformed Origin header.",
      );
    }
    if (originUrl.origin === url.origin) return;
    if (corsOriginAllows.some((allows) => allows(origin))) return;
    throw new ForbiddenError(
      `Cross-origin ${method} from "${originUrl.origin}" rejected: no registered cors() policy allows that origin. ` +
        `Register cors({ origin: [...] }) via app.use(...) to allow it, or pass ` +
        `app({ corsCrossOriginGuard: false }) / app({ secureDefaults: false }) to disable this guard.`,
    );
  }

  /**
   * Wave 3 sync boot guard. Inspects a hook layer being installed via
   * {@link App.use} and refuses-to-boot when:
   *
   *  - `cors({ origin: "*" })` is registered while resolved environment is
   *    `production`;
   *  - `session({ secret })` is registered while resolved environment is
   *    `production` and any secret fails {@link assertStrongSecret}.
   *
   * Disabled when `secureDefaults: false`. Thrown errors propagate out of
   * `app.use(...)` so the process exits during startup rather than serving
   * a misconfigured surface.
   */
  private assertSecureHookConfig(hooks: Hooks): void {
    if (this.options.secureDefaults === false) return;
    if (!this.isProduction()) return;
    const record = hooks as Record<PropertyKey, unknown>;
    if (record[CORS_WILDCARD_ORIGIN_MARKER] === true) {
      throw new Error(
        'cors({ origin: "*" }) refused in production: a wildcard CORS origin exposes every state-changing route cross-origin. ' +
          "Replace the wildcard with an explicit allowlist (string[] or predicate), or pass " +
          "app({ secureDefaults: false }) to disable this guard.",
      );
    }
    if (record[SESSION_HOOK_MARKER] === true) {
      const secrets = record[SESSION_SECRETS_MARKER];
      if (Array.isArray(secrets)) {
        for (const s of secrets) {
          assertStrongSecret(s, "session");
        }
      }
    }
  }

  private assertRouteAuthPayloadConfig(
    route: RouteDefinition<any, any, any, any>,
  ): void {
    const auth = route.auth;
    if (!auth || auth.payload !== false) return;
    const scheme = this.options.openapi?.securitySchemes?.[auth.scheme];
    if (!securitySchemeRequiresPayloadAuth(scheme)) return;
    throw new Error(
      `Route ${route.method} ${route.path} declares auth.payload: false, ` +
        `but security scheme "${auth.scheme}" requires payload authentication. ` +
        `Remove the route-level opt-out or use a scheme without requirePayloadAuth: true.`,
    );
  }

  private resetWave3BootGuardCache(): void {
    this.wave3BootGuard.checked = false;
    this.wave3BootGuard.error = undefined;
  }

  /**
   * Wave 3 first-request boot guard. Verifies that the assembled hook
   * chain + route table is internally consistent before any user handler
   * runs. Currently checks: when `session()` is installed and any route
   * accepts a state-changing method (`POST` / `PUT` / `PATCH` / `DELETE`),
   * a `csrf()` hook (or third-party equivalent stamped with
   * {@link CSRF_HOOK_MARKER}) must also be present in that route's effective
   * hook chain. Opt out with `app({ csrf: "off" })` or
   * `app({ secureDefaults: false })`. Runs once per App between registration
   * changes; the result is cached so the fast path is a single boolean check.
   */
  private assertWave3BootGuards(): void {
    if (this.wave3BootGuard.checked) {
      if (this.wave3BootGuard.error) throw this.wave3BootGuard.error;
      return;
    }
    this.wave3BootGuard.checked = true;
    if (this.options.secureDefaults === false) return;
    if (this.options.csrf === "off") return;
    // Per the risk register: boot guards only fire in production so CI /
    // staging surfaces that ship sample secrets / no CSRF token while
    // iterating do not pay the refuse-to-boot cost.
    if (!this.isProduction()) return;

    const stateChanging = this.routeSecurityMarkers.find(
      (r) =>
        isStateChangingMethod(r.method) && r.hasSession && !r.hasCsrf,
    );
    if (!stateChanging) return;

    const err = new Error(
      `session() is registered in the hook chain for a state-changing route ` +
        `(${stateChanging.method} ${stateChanging.path}) but no csrf() hook is installed. ` +
        `Register csrf() via app.use(csrf({ strategy: "fetch-metadata", allowedOrigins: [...] })), ` +
        `or pass app({ csrf: "off" }) to acknowledge that this app is not browser-facing.`,
    );
    this.wave3BootGuard.error = err;
    throw err;
  }

  /**
   * Wave 3 per-request guard for spoofed proxy headers. When the App was
   * constructed without an explicit {@link AppOptions.trustProxy} value
   * and a request arrives carrying an `X-Forwarded-*` header, refuse to
   * dispatch it: the rate limiter, audit log, and request-id propagation
   * would otherwise honour the attacker-supplied IP. Returns a structured
   * `500 problem+json` so the failure is loud at the network boundary.
   * Disabled when `secureDefaults: false` or when `trustProxy` is set to
   * `true` or `false` explicitly.
   */
  private assertTrustProxyConfigured(request: Request): void {
    if (this.options.secureDefaults === false) return;
    if (this.options.trustProxy !== undefined) return;
    // Wave 6: `behindProxy` is the declarative successor — when supplied,
    // the framework already knows how to interpret forwarded headers and
    // the legacy unconfigured-proxy guard is satisfied.
    if (this.options.behindProxy !== undefined) return;
    // Same risk-register clause as the session/CSRF guard: only enforce
    // in production. Dev/CI surfaces routinely test forwarded headers
    // without configuring a reverse-proxy posture.
    if (!this.isProduction()) return;
    const headers = request.headers;
    let found: string | undefined;
    for (const name of [
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-forwarded-port",
      "x-real-ip",
    ]) {
      if (headers.has(name)) {
        found = name;
        break;
      }
    }
    if (!found) return;
    if (!this.trustProxyWarned) {
      this.trustProxyWarned = true;
      this.log.warn(
        { event: "trust-proxy.unconfigured", header: found },
        `Request carried ${found} but app({ trustProxy }) is unset; refusing to honour spoofable proxy headers.`,
      );
    }
    throw new InternalError(
      `Refusing to dispatch request: ${found} header is present but app({ trustProxy }) is unconfigured. ` +
        `Pass app({ trustProxy: true }) when running behind a trusted reverse proxy, ` +
        `or app({ trustProxy: false }) to ignore forwarded headers, ` +
        `or app({ secureDefaults: false }) to disable this guard.`,
    );
  }

  /**
   * Resolve the {@link AppOptions.docs} option and, when enabled, register
   * the `/openapi.json` + `/docs` routes. Called once during construction so
   * the routes appear in `app.routes` for introspection and so the spec
   * served at runtime includes every route registered afterwards (the spec
   * is generated lazily inside the request handler).
   */
  private maybeMountDocs(): void {
    const raw = this.options.docs;
    if (raw === undefined || raw === false) return;

    let resolvedOpts: DocsRouteOptions;
    if (raw === true) {
      resolvedOpts = {};
    } else if (raw === "auto") {
      if (this.isProduction()) return;
      resolvedOpts = {};
    } else {
      // object form
      const enabled = raw.enabled ?? true;
      if (enabled === false) return;
      if (enabled === "auto" && this.isProduction()) return;
      resolvedOpts = raw;
    }

    this.mountDocs(resolvedOpts);
  }

  private mountDocs(opts: DocsRouteOptions): void {
    const openapiPath = (opts.openapiPath ?? "/openapi.json") as PathString;
    const openapiYamlPath =
      opts.openapiYamlPath === false
        ? null
        : ((opts.openapiYamlPath ?? "/openapi.yaml") as PathString);
    const docsPath = (opts.path ?? "/docs") as PathString;
    const ui = opts.ui ?? "scalar";
    const tags = opts.tags ?? ["Docs"];

    // Best-effort lazy read of the host project's package.json so that
    // `new App({ docs: true })` with no explicit `openapi.info` still produces
    // a spec titled after the user's package (`name` → title,
    // `version` → version, `description` → description). Silently skipped on
    // edge runtimes that lack `node:fs`.
    const resolveInfo = async (): Promise<OpenAPIInfo> => {
      const fromOpenapi = this.options.openapi?.info ?? {};
      const fromPkg = await readHostPackageJsonInfo();
      const title =
        fromOpenapi.title ?? this.options.title ?? fromPkg.title ?? "DaloyJS API";
      const version =
        fromOpenapi.version ?? this.options.version ?? fromPkg.version ?? "0.0.0";
      const description =
        fromOpenapi.description ?? this.options.description ?? fromPkg.description;
      return description ? { title, version, description } : { title, version };
    };

    const generate = async (): Promise<Record<string, unknown>> =>
      generateOpenAPI(this, {
        info: await resolveInfo(),
        ...(this.options.openapi?.servers
          ? { servers: this.options.openapi.servers }
          : {}),
        ...(this.options.openapi?.securitySchemes
          ? { securitySchemes: this.options.openapi.securitySchemes }
          : {}),
        ...(this.options.openapi?.webhooks
          ? { webhooks: this.options.openapi.webhooks }
          : {}),
      });

    this.route({
      method: "GET",
      path: openapiPath,
      operationId: "getOpenAPIDocument",
      ...(tags.length ? { tags } : {}),
      summary: "OpenAPI 3.1 document",
      responses: {
        200: { description: "OpenAPI 3.1 document for this application." },
      },
      handler: async () => ({
        status: 200 as const,
        body: await generate(),
      }),
    });

    if (openapiYamlPath) {
      this.route({
        method: "GET",
        path: openapiYamlPath,
        operationId: "getOpenAPIDocumentYaml",
        ...(tags.length ? { tags } : {}),
        summary: "OpenAPI 3.1 document (YAML)",
        responses: {
          200: { description: "OpenAPI 3.1 document for this application, in YAML." },
        },
        handler: async () => ({
          status: 200 as const,
          body: openapiToYAML(await generate()),
          headers: {
            // text/yaml + inline disposition so browsers render it in the
            // viewport instead of triggering a file download (the behaviour
            // of application/yaml in Chrome / Firefox / Safari).
            "content-type": "text/yaml; charset=utf-8",
            "content-disposition": "inline",
            "x-content-type-options": "nosniff",
          },
        }),
      });
    }

    this.route({
      method: "GET",
      path: docsPath,
      operationId: "getDocsUI",
      ...(tags.length ? { tags } : {}),
      summary: "Interactive API reference",
      responses: {
        200: { description: "Interactive API documentation UI." },
      },
      handler: async () => {
        const title = opts.title ?? (await resolveInfo()).title;
        const html =
          ui === "swagger"
            ? swaggerUiHtml({ specUrl: openapiPath, title })
            : scalarHtml({
                specUrl: openapiPath,
                title,
                configuration: opts.scalar,
              });
        return {
          status: 200 as const,
          body: html,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": docsContentSecurityPolicy(opts.csp),
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          },
        };
      },
    });
  }

  // ---------- registration ----------

  /**
   * Register a single route on the application.
   *
   * The supplied {@link RouteDefinition} is the **single source of truth**
   * for that endpoint — routing, request/response validation, OpenAPI
   * documentation, and the typed client SDK all derive from this one call.
   * Generic parameters are inferred from `path`, `method`, `request`, and
   * `responses`; you should rarely need to specify them explicitly.
   *
   * @example
   * ```ts
   * app.route({
   *   method: "POST",
   *   path: "/books",
   *   operationId: "createBook",
   *   request: { body: z.object({ title: z.string().min(1) }) },
   *   responses: { 201: { description: "Created" } },
   *   handler: ({ body }) => ({ status: 201, body: { id: "1", title: body.title } }),
   * });
   * ```
   *
   * @param def - The route definition.
   * @returns This `App` instance for chaining.
   */
  route<
    P extends PathString,
    M extends HttpMethod,
    Req extends RequestSchemas | undefined,
    Res extends ResponsesMap,
  >(def: RouteDefinition<P, M, Req, Res>): this {
    if (def.hooks) this.assertSecureHookConfig(def.hooks);
    const fullPath = joinPath(this.prefix, def.path) as PathString;
    const merged: RouteDefinition<any, any, any, any> = {
      ...def,
      path: fullPath,
      tags: [...(this.groupTags ?? []), ...(def.tags ?? [])],
      auth: def.auth ?? this.groupAuth,
    };
    this.assertRouteAuthPayloadConfig(merged);
    const sources: Hooks[] = [...this.groupHooks, def.hooks ?? {}];
    const hooks = mergeHooks(sources);
    const corsOriginAllows = corsOriginAllowsFromHooks(sources);
    const securityMarkers = securityMarkersFromHooks([
      this.options.hooks ?? {},
      ...sources,
    ]);
    this.router.add(
      def.method,
      fullPath,
      { def: merged, hooks, corsOriginAllows },
      def.operationId,
    );
    this.routes.push(merged);
    this.routeSecurityMarkers.push({
      method: merged.method,
      path: merged.path,
      ...securityMarkers,
    });
    this.resetWave3BootGuardCache();
    return this;
  }

  /**
   * Register a WebSocket route. The handler runs when an HTTP client sends an
   * `Upgrade: websocket` request to `path`; the adapter performs the RFC 6455
   * handshake and invokes the lifecycle callbacks. Path params (`/chat/:room`)
   * land on `ctx.params`. The handler shape matches Bun's WebSocket API.
   * @example `app.ws("/echo", { message(c, d) { c.send(d); } });`
   */
  ws<P extends PathString, TData = unknown>(
    path: P,
    handler: WebSocketHandler<P, any, TData>,
  ): this {
    const fullPath = joinPath(this.prefix, path) as PathString;
    const options = normalizeWebSocketOptions(handler, {
      production: this.isProduction(),
      secureDefaults: this.options.secureDefaults !== false,
    });
    this.webSocketRoutes.add(
      fullPath,
      handler as WebSocketHandler<any, any, any>,
      () => ({ ...this.decorations }),
      options,
    );
    return this;
  }

  /**
   * Register a liveness probe route. Returns `200 {"status":"ok"}` while
   * the process is alive, regardless of plugin readiness. Use this for
   * container orchestrator `livenessProbe` configuration — a failing
   * liveness probe restarts the container.
   *
   * Defaults (Wave 4 secure-by-default):
   *  - path: `/healthz`
   *  - rate-limit: 60 req/min per remote IP, in-memory (per-process)
   *  - auth: opt-in via `token`. In production with `secureDefaults: true`,
   *    registration refuses to add the route without a `token` unless
   *    `acknowledgeUnauthenticated: true` is set, so an unguarded
   *    healthcheck cannot ship to production by accident.
   *
   * @example
   * ```ts
   * app.healthcheck({ token: process.env.HEALTH_TOKEN! });
   * ```
   *
   * @since 0.18.0
   */
  healthcheck(opts: HealthRouteOptions = {}): this {
    this.registerHealthRoute("healthcheck", opts, () => ({
      status: 200 as const,
      body: { status: "ok" as const },
    }));
    return this;
  }

  /**
   * Register a readiness probe route. Returns `200 {"status":"ready"}`
   * once every async plugin has resolved AND the app is not draining.
   * Returns `503` otherwise. Use this for container orchestrator
   * `readinessProbe` configuration — a failing readiness probe removes
   * the pod from load-balancer rotation without restarting it.
   *
   * Defaults match {@link App.healthcheck} (path defaults to `/readyz`).
   *
   * @since 0.18.0
   */
  readinesscheck(opts: HealthRouteOptions = {}): this {
    this.registerHealthRoute("readinesscheck", opts, () => {
      if (
        this.draining ||
        this.pendingPlugins.size > 0 ||
        this.pluginBootError.failed
      ) {
        return {
          status: 503 as const,
          body: { status: "not-ready" as const },
          headers: { "retry-after": "5" },
        };
      }
      return {
        status: 200 as const,
        body: { status: "ready" as const },
      };
    });
    return this;
  }

  private registerHealthRoute(
    kind: "healthcheck" | "readinesscheck",
    opts: HealthRouteOptions,
    handler: () => {
      status: 200 | 503;
      body: { status: string };
      headers?: Record<string, string>;
    },
  ): void {
    const isHealth = kind === "healthcheck";
    const defaultPath = (isHealth ? "/healthz" : "/readyz") as PathString;
    const path = (opts.path ?? defaultPath) as PathString;
    const rateLimitConfig =
      opts.rateLimit === false
        ? null
        : { limit: 60, windowMs: 60_000, ...(opts.rateLimit ?? {}) };
    const token = opts.token;

    // Wave 4 refuse-to-boot: unauthenticated health/ready probes in
    // production are a documented info-disclosure surface (process uptime,
    // plugin-ready transitions, internal hostnames in some shops). Force
    // an explicit acknowledgement.
    if (
      this.options.secureDefaults !== false &&
      this.isProduction() &&
      token === undefined &&
      opts.acknowledgeUnauthenticated !== true
    ) {
      throw new Error(
        `app.${kind}() refused in production: provide opts.token to require ` +
          `Authorization: Bearer <token>, or pass acknowledgeUnauthenticated: true ` +
          `to acknowledge that this probe is reachable without credentials.`,
      );
    }

    const buckets = rateLimitConfig
      ? new Map<string, { count: number; resetMs: number }>()
      : null;

    this.route({
      method: "GET",
      path,
      operationId: isHealth ? "healthcheck" : "readinesscheck",
      tags: ["Health"],
      summary: isHealth ? "Liveness probe" : "Readiness probe",
      handler: async ({ request }: BaseContext<any, any>) => {
        if (buckets && rateLimitConfig) {
          const key = healthRouteKey(request);
          const now = Date.now();
          const entry = buckets.get(key);
          if (!entry || entry.resetMs <= now) {
            buckets.set(key, { count: 1, resetMs: now + rateLimitConfig.windowMs });
          } else {
            entry.count++;
            if (entry.count > rateLimitConfig.limit) {
              throw new TooManyRequestsError(
                Math.ceil((entry.resetMs - now) / 1000),
              );
            }
          }
        }
        if (token !== undefined) {
          const h = request.headers.get("authorization") ?? "";
          const m = /^Bearer\s+(.+)$/i.exec(h);
          if (!m) {
            throw new HttpError(
              401,
              {
                type: "https://daloyjs.dev/errors/unauthorized",
                title: "Unauthorized",
                detail: "Health probe requires a bearer token.",
              },
              { "www-authenticate": 'Bearer realm="health"' },
            );
          }
          if (!timingSafeEqual(m[1]!, token)) {
            throw new ForbiddenError("Invalid health probe token.");
          }
        }
        return handler();
      },
      responses: {
        200: {
          description: isHealth ? "Service is alive." : "Service is ready.",
        },
        503: {
          description: "Service is not ready.",
        },
      },
    });
  }

  /**
   * Wave 4 leftover: register a built-in receiver for CSP / Reporting API
   * violation reports. Accepts `application/csp-report` and
   * `application/reports+json` payloads, rate-limits per IP (defaults: 60
   * req/min), caps body size (default 8 KiB), and forwards parsed reports
   * to {@link CspReportRouteOptions.onReport} (or the structured logger
   * when omitted). Returns `204 No Content` so browsers stop retrying.
   *
   * Combine with `secureHeaders({ reportingEndpoints, reportTo })` to wire
  * the browser to this endpoint. The route is registered as publicly
  * reachable; that is required for the browser
   * Reporting API to send to it.
   *
   */
  cspReportRoute(opts: CspReportRouteOptions = {}): this {
    const path = (opts.path ?? "/__csp-report") as PathString;
    const maxBytes = opts.maxBodyBytes ?? 8192;
    // Wave 11 — refuse a configured cap above 64 KiB so a misconfigured
    // policy cannot turn the receiver into a DoS-via-report-flood amplifier.
    const HARD_MAX = 65536;
    if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > HARD_MAX) {
      throw new Error(
        `cspReportRoute(): maxBodyBytes must be a positive integer <= ${HARD_MAX}.`,
      );
    }
    const rateLimitConfig =
      opts.rateLimit === false
        ? null
        : { limit: 60, windowMs: 60_000, ...(opts.rateLimit ?? {}) };
    const buckets = rateLimitConfig
      ? new Map<string, { count: number; resetMs: number }>()
      : null;
    const log = this.log;
    // Wave 11 — only log report bodies when explicitly enabled. In
    // production this is opt-in; in development the body is included by
    // default so violations are debuggable.
    const includeReportBody =
      opts.logCspReportBodies ?? !this.isProduction();

    this.route({
      method: "POST",
      path,
      operationId: "cspReport",
      tags: ["Reporting"],
      summary: "CSP / Reporting API violation receiver",
      handler: async ({ request }: BaseContext<any, any>) => {
        if (buckets && rateLimitConfig) {
          const key = healthRouteKey(request);
          const now = Date.now();
          const entry = buckets.get(key);
          if (!entry || entry.resetMs <= now) {
            buckets.set(key, { count: 1, resetMs: now + rateLimitConfig.windowMs });
          } else {
            entry.count++;
            if (entry.count > rateLimitConfig.limit) {
              throw new TooManyRequestsError(
                Math.ceil((entry.resetMs - now) / 1000),
              );
            }
          }
        }
        const contentType = (request.headers.get("content-type") ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (
          contentType !== "application/csp-report" &&
          contentType !== "application/reports+json"
        ) {
          throw new UnsupportedMediaTypeError(contentType || "<none>", [
            "application/csp-report",
            "application/reports+json",
          ]);
        }
        const rawBytes = await readBodyLimited(request, maxBytes);
        const rawText = new TextDecoder().decode(rawBytes);
        let parsed: unknown;
        try {
          parsed = safeJsonParse(rawText);
        } catch {
          throw new BadRequestError("Invalid JSON report body");
        }
        if (parsed === undefined) {
          throw new BadRequestError("Invalid JSON report body");
        }
        const ip = healthRouteKey(request);
        const userAgent = request.headers.get("user-agent");
        try {
          if (opts.onReport) {
            await opts.onReport(parsed, {
              ip: ip === "global" ? null : ip,
              userAgent,
            });
          } else {
            log.warn(
              includeReportBody
                ? { event: "csp.report", ip, userAgent, report: parsed }
                : { event: "csp.report", ip, userAgent },
              "CSP violation report received",
            );
          }
        } catch (err) {
          log.error(
            { err: serializeErr(err), event: "csp.report.sinkFailed" },
            "cspReportRoute onReport sink failed",
          );
        }
        return { status: 204 as const, body: undefined };
      },
      responses: {
        204: { description: "Report accepted." },
        413: { description: "Report body too large." },
        415: { description: "Unsupported content-type." },
        429: { description: "Rate limit exceeded." },
      },
    });
    return this;
  }

  /**
   * Mount a group of routes under a shared prefix with shared tags, hooks,
   * and authentication. The `register` callback receives an encapsulated
   * child `App` whose `route()` calls inherit the prefix and group config.
   * Hooks and tags are merged with any further `app.use(...)` / route-level
   * entries.
   *
   * @example
   * ```ts
   * app.group("/admin", { tags: ["admin"] }, (admin) => {
   *   admin.route({
   *     method: "GET",
   *     path: "/users",
   *     responses: { 200: { description: "OK" } },
   *     handler: () => ({ status: 200, body: [] }),
   *   });
   * });
   * ```
   *
   * @param prefix - Path prefix prepended to every route registered in `register`.
   * @param config - Shared metadata: tags, hooks, and auth requirement.
   * @param register - Callback that registers the grouped routes on the child app.
   * @returns This `App` instance for chaining.
   */
  group(
    prefix: PathString,
    config: { tags?: string[]; hooks?: Hooks; auth?: RouteDefinition["auth"] },
    register: (app: App) => void,
  ): this {
    if (config.hooks) this.assertSecureHookConfig(config.hooks);
    // Child apps share the parent's router/routes/etc. Disable docs auto-mount
    // on the child so it does not re-register the parent's `/openapi.json` and
    // `/docs` routes (which would throw "Duplicate route").
    const child = new App({ ...this.options, docs: false });
    (child as any).router = this.router;
    (child as any).routes = this.routes;
    (child as any).webSocketRoutes = this.webSocketRoutes;
    (child as any).routeSecurityMarkers = this.routeSecurityMarkers;
    (child as any).wave3BootGuard = this.wave3BootGuard;
    (child as any).log = this.log;
    (child as any).prefix = joinPath(this.prefix, prefix);
    (child as any).groupHooks = [
      ...this.groupHooks,
      ...(config.hooks ? [config.hooks] : []),
    ];
    (child as any).corsOriginAllows = corsOriginAllowsFromHooks(
      (child as any).groupHooks,
    );
    (child as any).groupTags = [...this.groupTags, ...(config.tags ?? [])];
    (child as any).groupAuth = config.auth ?? this.groupAuth;
    (child as any).decorations = this.decorations;
    (child as any).installedPlugins = this.installedPlugins;
    (child as any).closeHooks = this.closeHooks;
    (child as any).idleConnectionCloseHooks = this.idleConnectionCloseHooks;
    (child as any).pluginInstalledListeners = this.pluginInstalledListeners;
    (child as any).shutdownListeners = this.shutdownListeners;
    (child as any).pendingPlugins = this.pendingPlugins;
    (child as any).pluginBootError = this.pluginBootError;
    register(child);
    return this;
  }

  /**
   * Attach a hook layer that applies to every route registered **afterwards**.
   *
   * Use this for cross-cutting middleware (CORS, secure headers, auth
   * bouncers). Hooks compose pipeline-style — see {@link Hooks} for ordering.
   *
   * @example
   * ```ts
   * import { secureHeaders, cors } from "@daloyjs/core";
   *
   * app.use(secureHeaders());
   * app.use(cors({ origin: "https://app.example.com", credentials: true }));
   * ```
   *
   * @param hooks - Hook bundle applied to subsequent routes.
   * @returns This `App` instance for chaining.
   */
  use(hooks: Hooks): this {
    // Wave 3 boot guards: refuse to start when the new hook layer is a
    // known-misconfigured security primitive in production. These checks
    // run synchronously at registration time so the developer sees the
    // failure during boot, not on first request.
    this.assertSecureHookConfig(hooks);

    // If the developer installs their own secureHeaders(), drop the
    // Wave 2 auto-installed instance so the user's overrides win instead of
    // being shadowed (the auto one runs first and the per-header
    // "set only if absent" semantics mean the second installation would be
    // a silent no-op).
    if (
      (hooks as Record<PropertyKey, unknown>)[SECURE_HEADERS_MARKER] === true
    ) {
      const autoIdx = this.groupHooks.findIndex(
        (h) =>
          (h as Record<PropertyKey, unknown>)[AUTO_SECURE_HEADERS_MARKER] ===
          true,
      );
      if (autoIdx >= 0) this.groupHooks.splice(autoIdx, 1);
    }
    this.groupHooks.push(hooks);
    if ((hooks as Record<PropertyKey, unknown>)[CORS_HOOK_MARKER] === true) {
      this.corsOriginAllows = corsOriginAllowsFromHooks(this.groupHooks);
    }
    this.resetWave3BootGuardCache();
    return this;
  }

  /**
   * Decorate `ctx.state` with a value available inside every handler and hook.
   *
   * Augment the {@link AppState} interface to type the decoration globally:
   *
   * ```ts
   * declare module "@daloyjs/core" {
   *   interface AppState { db: Database }
   * }
   *
   * app.decorate("db", db);
   *
   * app.route({
   *   method: "GET",
   *   path: "/health",
   *   responses: { 200: { description: "OK" } },
   *   handler: ({ state }) => ({ status: 200, body: state.db.ping() }),
   * });
   * ```
   *
   * @param key - Property name on `ctx.state`.
   * @param value - Value bound to that property on every request.
   * @returns This `App` instance for chaining.
   */
  /**
   * Apply an ordered list of plugin extensions (Wave 6 item 10) to the
   * group-level hook chain. Each extension's `handler` is wrapped into a
   * single-event {@link Hooks} bundle so subsequent route registrations
   * pick it up via the normal hook composition path.
   * @internal
   */
  private applyExtensions(ordered: PluginExtension[]): void {
    for (const ext of ordered) {
      const hooks: Hooks = { [ext.event]: ext.handler } as unknown as Hooks;
      this.groupHooks.push(hooks);
    }
  }

  decorate<K extends string, V>(
    key: K,
    value: V,
    opts: { override?: boolean } = {},
  ): this {
    if (
      Object.prototype.hasOwnProperty.call(this.decorations, key) &&
      opts.override !== true
    ) {
      // Wave 6 item 9: namespace-protected decorators. Refuse to silently
      // shadow an existing decoration; emit a once-per-process warn naming
      // both decorators on the explicit-override path.
      throw new Error(
        `decorate(): key "${key}" is already decorated. ` +
          `Pass { override: true } to replace, or rename to avoid the collision.`,
      );
    }
    if (opts.override === true && Object.prototype.hasOwnProperty.call(this.decorations, key)) {
      this.log.warn(
        { event: "decorate.override", key },
        `decorate("${key}") replaced an existing decoration.`,
      );
    }
    this.decorations[key] = value;
    return this;
  }

  /**
   * Register a callback to run once during graceful shutdown, **after** all
   * in-flight requests have drained. Use this to close database pools, flush
   * metrics, or release any other long-lived resources.
   *
   * For listeners that need to fire **before** draining starts (e.g. to tell
   * a load balancer the instance is going away), use {@link App.onShutdown}.
   *
   * @param hook - Async or sync cleanup function. Errors are swallowed and logged.
   * @returns This `App` instance for chaining.
   */
  onClose(hook: () => void | Promise<void>): this {
    this.closeHooks.push(hook);
    return this;
  }

  /**
   * Subscribe to plugin install events. The listener fires once per registered
   * plugin, after `register()` (or its returned promise) completes. Useful
   * for observability plugins that want to enumerate everything else that
   * was installed without polluting the route registry.
   */
  onPluginInstalled(
    listener: (info: PluginInstalledEvent) => void | Promise<void>,
  ): this {
    this.pluginInstalledListeners.push(listener);
    return this;
  }

  /**
   * Subscribe to the start of graceful shutdown. Listeners run before
   * in-flight requests drain so observability plugins can flush metrics or
   * publish a "draining" signal to load balancers. Use `onClose()` for
   * post-drain cleanup such as closing pools.
   */
  onShutdown(listener: (info: ShutdownEvent) => void | Promise<void>): this {
    this.shutdownListeners.push(listener);
    return this;
  }

  /**
   * Encapsulated plugin registration (Fastify-style). Receives a child App;
   * routes/hooks declared on the child are scoped to the plugin by default
   * (Wave 6 item 15 \u2014 encapsulation default `local`).
   *
   * Wave 6 (`0.24.0`) additions on the plugin descriptor object:
   *
   * - `dependencies: string[]` \u2014 prerequisite plugin names; the framework
   *   refuses-to-boot at registration time when any declared dependency has
   *   not been installed first (item 8).
   * - `seed: string` \u2014 differentiator for parameterized instances of the
   *   same plugin (item 16). Dedup key becomes `${name}#${seed}`.
   * - `stateful: boolean` \u2014 when `true` AND `name` is absent AND the app is
   *   in production with `secureDefaults` on, registration refuses-to-boot
   *   so silent double-installs of global-state-mutating plugins are caught
   *   loud (item 16).
   * - `extensions: [{ event, handler, before?, after? }]` \u2014 declarative
   *   lifecycle-hook ordering with topological-sort + cycle detection
   *   (item 10). Refuses-at-registration on cycles.
   */
  register(
    plugin:
      | {
          name?: string;
          seed?: string;
          stateful?: boolean;
          dependencies?: readonly string[];
          extensions?: ReadonlyArray<PluginExtension>;
          register?: (app: App) => void | Promise<void>;
        }
      | ((app: App) => void | Promise<void>),
    config: {
      prefix?: PathString;
      tags?: string[];
      hooks?: Hooks;
      auth?: RouteDefinition["auth"];
    } = {},
  ): this {
    const fn = typeof plugin === "function" ? plugin : (plugin.register ?? (() => {}));
    const descriptor = typeof plugin === "function" ? undefined : plugin;
    const name = descriptor?.name;
    const seed = descriptor?.seed;
    const dedupKey = name ? (seed ? `${name}#${seed}` : name) : undefined;
    const dependencies = descriptor?.dependencies ?? [];
    const stateful = descriptor?.stateful ?? false;

    if (stateful && !name && this.isProduction() && this.options.secureDefaults !== false) {
      throw new Error(
        "register(): anonymous stateful plugin refused in production. " +
          "Declare { name } (and optional { seed }) so the plugin can be deduplicated.",
      );
    }
    for (const dep of dependencies) {
      if (!this.installedPlugins.has(dep)) {
        throw new Error(
          `register(): plugin ${JSON.stringify(name ?? "<anonymous>")} declares ` +
            `dependency on "${dep}" but no plugin with that name has been registered yet.`,
        );
      }
    }
    if (dedupKey) {
      if (this.installedPlugins.has(dedupKey)) {
        throw new Error(`Plugin "${dedupKey}" already registered`);
      }
      this.installedPlugins.add(dedupKey);
    }
    if (descriptor?.extensions && descriptor.extensions.length > 0) {
      // Wave 6 item 10: topological sort with cycle detection.
      const ordered = topoSortExtensions(descriptor.extensions);
      this.applyExtensions(ordered);
    }
    const prefix = config.prefix ?? ("/" as PathString);
    const event: PluginInstalledEvent = {
      name,
      prefix: joinPath(this.prefix, prefix),
    };
    this.group(prefix, config, (child) => {
      const r = fn(child);
      if (r && typeof (r as Promise<unknown>).then === "function") {
        // Plugin is async - caller should await app.ready().
        this.trackPendingPlugin(
          (r as Promise<unknown>).then(() => this.firePluginInstalled(event)),
        );
      } else {
        // Sync plugin: fire listeners immediately. Any returned promise from a
        // listener is collected so `app.ready()` can await observers too.
        const pending = this.firePluginInstalled(event);
        if (pending) {
          this.trackPendingPlugin(pending);
        }
      }
    });
    return this;
  }

  private trackPendingPlugin(promise: Promise<unknown>): void {
    const tracked = promise.catch((err) => {
      this.pluginBootError.failed = true;
      this.pluginBootError.error = err;
      throw err;
    });
    this.pendingPlugins.add(tracked);
    void tracked.finally(() => this.pendingPlugins.delete(tracked)).catch(() => {});
  }

  private firePluginInstalled(
    event: PluginInstalledEvent,
  ): Promise<void> | undefined {
    if (this.pluginInstalledListeners.length === 0) return undefined;
    const promises: Array<Promise<unknown>> = [];
    for (const listener of this.pluginInstalledListeners) {
      try {
        const r = listener(event);
        if (r && typeof (r as Promise<unknown>).then === "function") {
          promises.push(
            (r as Promise<unknown>).catch((err) => {
              this.log.error(
                { err, plugin: event.name },
                "onPluginInstalled listener failed",
              );
            }),
          );
        }
      } catch (err) {
        this.log.error(
          { err, plugin: event.name },
          "onPluginInstalled listener failed",
        );
      }
    }
    return promises.length > 0
      ? Promise.all(promises).then(() => undefined)
      : undefined;
  }

  /**
   * Wait until every async plugin registered with {@link App.register} has
   * finished initializing. Call this after `register()` returns and **before**
   * starting the server when any plugin's `register()` returns a `Promise`.
   *
   * Sync plugins also push observer promises here so `await app.ready()` is
   * always safe to call.
   *
   * @example
   * ```ts
   * app.register(metricsPlugin); // async
   * await app.ready();
   * serve(app, { port: 3000 });
   * ```
   *
   * @returns Promise that resolves once all pending plugins have settled.
   */
  ready(): Promise<void> {
    if (this.pluginBootError.failed) {
      return Promise.reject(this.pluginBootError.error);
    }
    if (this.pendingPlugins.size === 0) return Promise.resolve();
    const pending = Array.from(this.pendingPlugins);
    return Promise.all(pending).then(() => undefined);
  }
  /**
   * Web-standard request handler. Accepts a `Request` and returns a `Response`.
   * This is the universal entry point used by every runtime adapter; you may
   * also call it directly from tests, Cloudflare Workers, or any other
   * environment that speaks the Fetch API.
   *
   * During graceful shutdown this rejects new requests with `503` and a
   * `Retry-After: 5` header.
   *
   * @example
   * ```ts
   * // Cloudflare Worker
   * export default { fetch: (req) => app.fetch(req) };
   * ```
   *
   * @param request - A standard `Request` object.
   * @returns A standard `Response`. Errors thrown inside handlers are mapped
   *   to RFC 9457 `application/problem+json` automatically.
   */
  fetch = async (request: Request): Promise<Response> => {
    const response = await this.dispatch(request);
    // In-flight responses that finish during draining advertise
    // `Connection: close` so HTTP/1.1 load balancers stop re-using the
    // socket for new requests. Wave 4 connection-draining.
    if (this.draining && !response.headers.has("connection")) {
      response.headers.set("connection", "close");
    }
    return response;
  };

  /**
   * In-process entry point that bypasses the public `404` shield for
   * routes declared with `internal: true`. Use it for cron jobs, admin
   * scripts, and integration tests that need to exercise privileged
   * handlers without exposing them to the network. All other security
   * middleware (CORS, CSRF, rate limit, etc.) still runs normally.
   *
   * @since 0.19.0
   */
  inject = async (request: Request): Promise<Response> => {
    return this.dispatch(request, { allowInternal: true });
  };

  private dispatch = async (
    request: Request,
    opts: { allowInternal?: boolean } = {},
  ): Promise<Response> => {
    if (this.draining) {
      return new Response(
        JSON.stringify({
          type: "https://daloyjs.dev/errors/shutting-down",
          title: "Service Unavailable",
          status: 503,
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "5",
            // Tell HTTP/1.1 load balancers to close the keep-alive socket
            // immediately so the next request lands on a healthy instance
            // rather than coming back to a dying one. Wave 4.
            connection: "close",
          },
        },
      );
    }
    this.inflight++;
    const requestId = randomId();
    const log = this.log.child({
      requestId,
      method: request.method,
      url: request.url,
    });
    const stripFingerprint = this.options.stripServerHeaders !== false;
    let ctx: BaseContext<any, any> | undefined;
    const globalHooks = mergeHooks([this.options.hooks ?? {}]);
    let activeErrorHook = globalHooks.onError;
    let activeResponseHook = globalHooks.onResponse;
    let activeSendHook = globalHooks.onSend;

    try {
      assertNoDuplicateSingletonHeaders(request.headers);
      this.assertTrustProxyConfigured(request);
      this.assertWave3BootGuards();
      await globalHooks.onRequest?.(request);

      const url = new URL(request.url);
      const method = request.method as HttpMethod;
      const headFallback = method === "HEAD";
      const match =
        this.router.find(method, url.pathname) ??
        (headFallback ? this.router.find("GET", url.pathname) : undefined);

      // Hide internal routes from the public adapter surface. The router
      // still finds them so app.inject() can dispatch normally, but
      // app.fetch() responds 404 to avoid leaking existence.
      const internalHidden =
        match?.handler.def.internal === true && opts.allowInternal !== true;

      this.assertCrossOriginAllowed(
        request,
        url,
        method,
        [
          ...corsOriginAllowsFromHooks([this.options.hooks ?? {}]),
          ...(match && !internalHidden ? match.handler.corsOriginAllows : this.corsOriginAllows),
        ],
      );

      if (!match || internalHidden) {
        if (internalHidden) {
          // Don't leak existence via 405/Allow header. Always 404.
          throw new NotFoundError(
            `No route for ${request.method} ${url.pathname}`,
          );
        }
        const rawAllowed = this.router.allowedMethods(url.pathname);
        // Filter out methods whose route definitions are marked
        // `internal: true` unless the caller explicitly opted in via
        // app.inject(). This prevents 405/Allow from leaking the
        // existence of hidden admin/cron endpoints.
        const allowed = opts.allowInternal
          ? rawAllowed
          : rawAllowed.filter((m) => {
              const candidate = this.router.find(m, url.pathname);
              return candidate?.handler.def.internal !== true;
            });
        ctx = {
          request,
          params: {},
          query: Object.fromEntries(url.searchParams.entries()),
          headers: headersToObject(request.headers),
          body: undefined,
          state: { ...this.decorations, requestId, log },
          set: { headers: new Headers() },
        };
        ctx.set.headers.set("x-request-id", requestId);
        if (allowed.length > 0) {
          if (method === "OPTIONS") {
            // Synthesize a preflight: let global hooks (e.g. CORS) intercept;
            // otherwise return 204 with Allow header.
            const synthCtx: BaseContext<any, any> = {
              request,
              params: {},
              query: {},
              headers: headersToObject(request.headers),
              body: undefined,
              state: { ...this.decorations, requestId, log },
              set: { headers: new Headers() },
            };
            const preflightHooks = mergeHooks([
              this.options.hooks ?? {},
              ...this.groupHooks,
            ]);
            const intercepted = await preflightHooks.beforeHandle?.(synthCtx);
            if (intercepted instanceof Response) {
              copyContextHeaders(synthCtx, intercepted);
              return await finalizeResponse(
                intercepted,
                synthCtx,
                preflightHooks,
                stripFingerprint,
              );
            }
            const res = new Response(null, {
              status: 204,
              headers: { allow: allowed.join(", ") },
            });
            copyContextHeaders(synthCtx, res);
            res.headers.set("x-request-id", requestId);
            return await finalizeResponse(res, synthCtx, preflightHooks, stripFingerprint);
          }
          throw new MethodNotAllowedError(allowed);
        }
        throw new NotFoundError(
          `No route for ${request.method} ${url.pathname}`,
        );
      }

      const { def, hooks } = match.handler;
      const allHooks = mergeHooks([globalHooks, hooks]);
      activeErrorHook = allHooks.onError;
      activeResponseHook = allHooks.onResponse;
      activeSendHook = allHooks.onSend;

      await hooks.onRequest?.(request);

      ctx = await buildContext(request, url, match.params, def, this.options);
      Object.assign(ctx.state, this.decorations, { requestId, log });
      ctx.set.headers.set("x-request-id", requestId);

      const before = await allHooks.beforeHandle?.(ctx);
      if (before instanceof Response) {
        copyContextHeaders(ctx, before);
        return await finalizeResponse(before, ctx, allHooks, stripFingerprint);
      }

      let result: any = this.options.mockMode
        ? mockResponseFor(def)
        : await runHandler(def, ctx, this.options.requestTimeoutMs);
      const afterReturn = await allHooks.afterHandle?.(ctx, result);
      if (afterReturn !== undefined) result = afterReturn;

      let response = await serializeResult(
        result,
        def,
        this.options.validateResponses ?? true,
      );
      copyContextHeaders(ctx, response);
      const finalized = await finalizeResponse(response, ctx, allHooks, stripFingerprint);
      if (method === "HEAD") {
        return new Response(null, {
          status: finalized.status,
          statusText: finalized.statusText,
          headers: finalized.headers,
        });
      }
      return finalized;
    } catch (err) {
      const handled = await activeErrorHook?.(err, ctx);
      if (handled instanceof Response) {
        if (ctx) copyContextHeaders(ctx, handled);
        if (!handled.headers.has("x-request-id"))
          handled.headers.set("x-request-id", requestId);
        return finalizeResponse(handled, ctx, {
          onSend: activeSendHook,
          onResponse: activeResponseHook,
        }, stripFingerprint);
      }
      // Wave 4 leftover: when the client has already disconnected, classify
      // the request at `disconnectStatusCode` (default 499) instead of
      // letting an AbortError bubble up as a generic 5xx. Logged at `info`
      // so disconnect storms do not look like service incidents.
      const disconnectCode = this.options.disconnectStatusCode ?? 499;
      if (
        disconnectCode > 0 &&
        request.signal?.aborted === true &&
        !(err instanceof HttpError)
      ) {
        log.info(
          { event: "request.disconnected", status: disconnectCode },
          "Client disconnected before response was sent",
        );
        const res = new Response(null, {
          status: disconnectCode,
          headers: {
            "content-type": "application/problem+json",
            "x-request-id": requestId,
          },
        });
        if (ctx) copyContextHeaders(ctx, res);
        return finalizeResponse(res, ctx, {
          onSend: activeSendHook,
          onResponse: activeResponseHook,
        }, stripFingerprint);
      }
      const httpErr: HttpError =
        err instanceof HttpError
          ? err
          : new InternalError(
              err instanceof Error ? err.message : "Unexpected error",
            );
      if (httpErr.status >= 500)
        log.error({ err: serializeErr(err) }, httpErr.problem.title);
      if (httpErr.status < 500)
        log.warn({ status: httpErr.status }, httpErr.problem.title);
      const res = httpErr.toResponse({
        production: this.isProduction(),
        requestId,
      });
      if (ctx) copyContextHeaders(ctx, res);
      if (!res.headers.has("x-request-id"))
        res.headers.set("x-request-id", requestId);
      return finalizeResponse(res, ctx, {
        onSend: activeSendHook,
        onResponse: activeResponseHook,
      }, stripFingerprint);
    } finally {
      this.inflight--;
    }
  };

  /**
   * In-process test client. Accepts the same arguments as the global `fetch`
   * but routes them through `this.fetch` without a network hop. Relative URLs
   * (starting with `/`) are resolved against `http://test.local`.
   *
   * @example
   * ```ts
   * const res = await app.request("/books/123");
   * assert.equal(res.status, 200);
   * const json = await res.json();
   * ```
   *
   * @param input - URL, path, or `Request` to dispatch.
   * @param init - Standard `RequestInit` (ignored if `input` is a `Request`).
   * @returns Fulfills with the `Response` produced by the matching handler.
   */
  request(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string" && input.startsWith("/")
        ? `http://test.local${input}`
        : input;
    const req = url instanceof Request ? url : new Request(url as any, init);
    return this.fetch(req);
  }

  /**
   * Return a JSON-serializable summary of every registered route. Useful for
   * dead-route detection, dashboards, and tests that want to assert against
   * the route table without parsing the OpenAPI document.
   *
   * @returns Array of one {@link IntrospectedRoute} per registered route.
   */
  introspect(): IntrospectedRoute[] {
    return this.routes.map((r) => {
      const route: IntrospectedRoute = {
        method: r.method,
        path: r.path,
        hasBody: hasRequestSchema(r.request, "body"),
        hasQuery: hasRequestSchema(r.request, "query"),
        hasParams: hasRequestSchema(r.request, "params"),
        hasHeaders: hasRequestSchema(r.request, "headers"),
        responses: Object.keys(r.responses).map(Number),
      };
      if (r.operationId !== undefined) route.operationId = r.operationId;
      if (r.tags !== undefined) route.tags = r.tags;
      if (r.summary !== undefined) route.summary = r.summary;
      if (r.description !== undefined) route.description = r.description;
      if (r.deprecated !== undefined) route.deprecated = r.deprecated;
      if (r.auth !== undefined) route.auth = r.auth;
      if (r.meta !== undefined) route.meta = r.meta;
      return route;
    });
  }

  /**
   * Begin graceful shutdown.
   *
   * Subsequent calls to {@link App.fetch} immediately reply `503 Service
   * Unavailable` with `Retry-After: 5`. Listeners registered with
   * {@link App.onShutdown} fire first (so observability plugins can publish a
   * "draining" signal); then the app waits up to `timeoutMs` for in-flight
   * requests to settle; finally, {@link App.onClose} cleanups run.
   *
   * Both Node and Bun adapters call this automatically on `SIGINT` / `SIGTERM`.
   * Call it manually from custom runtimes or integration tests.
   *
   * @param timeoutMs - Maximum time (ms) to wait for inflight requests. Default: `10_000`.
   * @param reason - Optional human-readable reason forwarded to listeners.
   * @returns Resolves once draining + cleanups complete (or the timeout elapses).
   */
  async shutdown(timeoutMs = 10_000, reason?: string): Promise<void> {
    this.draining = true;
    if (!this.shutdownListenersRun) {
      this.shutdownListenersRun = true;
      const event: ShutdownEvent = { reason, timeoutMs };
      for (const listener of this.shutdownListeners) {
        try {
          await listener(event);
        } catch (err) {
          this.log.error({ err }, "onShutdown listener failed");
        }
      }
    }
    // Wave 4: kill idle keep-alive connections immediately so they cannot
    // be re-used for a new request that would race with the drain. Adapters
    // (Node) register a hook here. In-flight requests are unaffected.
    for (const hook of this.idleConnectionCloseHooks) {
      try {
        hook();
      } catch (err) {
        this.log.error({ err }, "idleConnectionCloseHook failed");
      }
    }
    const start = Date.now();
    while (this.inflight > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!this.closeHooksRun) {
      this.closeHooksRun = true;
      for (const hook of this.closeHooks) {
        await hook();
      }
    }
    this.log.info({ inflight: this.inflight }, "DaloyJS shutdown complete");
  }

  /**
   * Alias for {@link App.shutdown}. Matches the Node `Server.close()` shape
   * and reads more naturally from adapters that want a single "stop"
   * method.
   *
   * @since 0.18.0
   */
  async close(timeoutMs = 10_000, reason?: string): Promise<void> {
    return this.shutdown(timeoutMs, reason);
  }

  /**
   * Adapter-private hook to register a callback that runs synchronously
   * when {@link App.shutdown} begins draining. The Node adapter uses this
   * to invoke `server.closeIdleConnections()` so keep-alive sockets without
   * an in-flight request are killed immediately instead of being held open
   * until the OS / load balancer notices.
   *
   * Not part of the documented public API surface: subject to change.
   *
   * @internal
   */
  _registerIdleConnectionCloseHook(hook: () => void): void {
    this.idleConnectionCloseHooks.push(hook);
  }
}

// ---------- helpers ----------

function joinPath(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b.startsWith("/") ? b : `/${b}`;
  const joined = `${left}${right}`;
  return joined === "" ? "/" : joined;
}

function healthRouteKey(request: Request): string {
  // The probe rate limit deliberately does NOT honour `X-Forwarded-For` —
  // health probes typically arrive directly from a sidecar / orchestrator,
  // so even apps that trust forwarded headers should not let an attacker
  // bypass the per-IP cap by spoofing the header. Fall back to a constant
  // key when no proxy header is available (single shared bucket).
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("fly-client-ip") ??
    "global"
  );
}

function corsOriginAllowsFromHooks(layers: Hooks[]): CorsOriginAllow[] {
  const allows: CorsOriginAllow[] = [];
  for (const hooks of layers) {
    const record = hooks as Record<PropertyKey, unknown>;
    const allow = record[CORS_ORIGIN_ALLOW_MARKER];
    if (typeof allow === "function") {
      allows.push(allow as CorsOriginAllow);
    } else if (record[CORS_HOOK_MARKER] === true) {
      // Third-party CORS helpers can still opt out of the guard with the
      // original marker. The first-party cors() stamps a stricter predicate
      // above, so disallowed origins are rejected before the handler runs.
      allows.push(() => true);
    }
  }
  return allows;
}

/**
 * Topological sort of plugin extensions (Wave 6 item 10). Refuses-at-call
 * on cyclic ordering with a structured error naming the cycle.
 * @internal
 */
export function topoSortExtensions(
  exts: ReadonlyArray<PluginExtension>,
): PluginExtension[] {
  const byName = new Map<string, PluginExtension>();
  for (const e of exts) {
    if (byName.has(e.name)) {
      throw new Error(`Duplicate plugin extension name: ${JSON.stringify(e.name)}.`);
    }
    byName.set(e.name, e);
  }
  // Build adjacency: edge from A -> B means A must run before B.
  const edges = new Map<string, Set<string>>();
  for (const e of exts) edges.set(e.name, new Set());
  for (const e of exts) {
    for (const b of e.before ?? []) {
      if (byName.has(b)) edges.get(e.name)!.add(b);
    }
    for (const a of e.after ?? []) {
      if (byName.has(a)) edges.get(a)!.add(e.name);
    }
  }
  // Kahn's algorithm.
  const indeg = new Map<string, number>();
  for (const name of edges.keys()) indeg.set(name, 0);
  for (const [, outs] of edges) {
    for (const v of outs) indeg.set(v, (indeg.get(v) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [name, d] of indeg) if (d === 0) queue.push(name);
  const out: PluginExtension[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    out.push(byName.get(name)!);
    for (const v of edges.get(name)!) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  if (out.length !== exts.length) {
    const remaining = Array.from(byName.keys()).filter(
      (n) => !out.some((e) => e.name === n),
    );
    throw new Error(
      `Plugin extension cycle detected among: ${remaining.map((n) => JSON.stringify(n)).join(", ")}.`,
    );
  }
  return out;
}

function securityMarkersFromHooks(
  layers: Hooks[],
): Pick<RouteSecurityMarkers, "hasSession" | "hasCsrf"> {
  let hasSession = false;
  let hasCsrf = false;
  for (const hooks of layers) {
    const record = hooks as Record<PropertyKey, unknown>;
    if (record[SESSION_HOOK_MARKER] === true) hasSession = true;
    if (record[CSRF_HOOK_MARKER] === true) hasCsrf = true;
  }
  return { hasSession, hasCsrf };
}

function isStateChangingMethod(method: HttpMethod): boolean {
  return (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

function mergeHooks(layers: Hooks[]): Hooks {
  const pick = <K extends keyof Hooks>(key: K): NonNullable<Hooks[K]>[] =>
    layers
      .map((h) => h[key])
      .filter((f): f is NonNullable<Hooks[K]> => typeof f === "function");
  const requiredScopes = requiredScopesFromHooks(layers);
  const beforeHandle = mergeBeforeHandle(
    firstResponse(pick("beforeHandle")),
    requiredScopes,
  );
  const hooks: Hooks = {
    onRequest: chain(pick("onRequest")),
    beforeHandle,
    afterHandle: pipeline(pick("afterHandle")),
    onError: firstResponse(pick("onError")),
    onSend: responsePipeline(pick("onSend")),
    onResponse: chain(pick("onResponse")),
  };
  stampRequiredScopes(hooks, requiredScopes);
  return hooks;
}

function requiredScopesFromHooks(layers: Hooks[]): string[] {
  const out: string[] = [];
  for (const hooks of layers) {
    const scopes = (hooks as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER];
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      if (typeof scope === "string" && !out.includes(scope)) out.push(scope);
    }
  }
  return out;
}

function stampRequiredScopes(hooks: Hooks, scopes: readonly string[]): void {
  if (scopes.length > 0) {
    (hooks as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER] = [...scopes];
  }
}

function mergeBeforeHandle(
  beforeHandle: NonNullable<Hooks["beforeHandle"]> | undefined,
  requiredScopes: readonly string[],
): NonNullable<Hooks["beforeHandle"]> | undefined {
  if (!beforeHandle && requiredScopes.length === 0) return undefined;
  return async (ctx) => {
    if (requiredScopes.length > 0) {
      const state = ctx.state as Record<string, unknown>;
      const prior = state[REQUIRE_SCOPES_AGGREGATE_KEY];
      const aggregate = Array.isArray(prior) ? [...(prior as string[])] : [];
      for (const scope of requiredScopes) {
        if (!aggregate.includes(scope)) aggregate.push(scope);
      }
      state[REQUIRE_SCOPES_AGGREGATE_KEY] = aggregate;
    }
    return beforeHandle?.(ctx);
  };
}

function responsePipeline(
  fns: NonNullable<Hooks["onSend"]>[],
): NonNullable<Hooks["onSend"]> | undefined {
  if (fns.length === 0) return undefined;
  return async (res, ctx) => {
    let current = res;
    for (const fn of fns) {
      const r = await fn(current, ctx);
      if (r instanceof Response) current = r;
    }
    return current;
  };
}

async function finalizeResponse(
  res: Response,
  ctx: BaseContext<any, any> | undefined,
  hooks: Pick<Hooks, "onSend" | "onResponse">,
  stripFingerprint: boolean = true,
): Promise<Response> {
  const sent = await hooks.onSend?.(res, ctx);
  const final = sent instanceof Response ? sent : res;
  if (stripFingerprint) {
    final.headers.delete("server");
    final.headers.delete("x-powered-by");
  }
  await hooks.onResponse?.(final);
  return final;
}

function chain<F extends (...args: any[]) => any>(fns: F[]): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (...args: any[]) => {
    for (const fn of fns) await fn(...args);
  }) as unknown as F;
}

function firstResponse<F extends (...args: any[]) => any>(
  fns: F[],
): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (...args: any[]) => {
    for (const fn of fns) {
      const r = await fn(...args);
      if (r instanceof Response) return r;
    }
    return undefined;
  }) as unknown as F;
}

function pipeline<F extends (ctx: any, value: any) => any>(
  fns: F[],
): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (ctx: any, value: any) => {
    let v = value;
    for (const fn of fns) {
      const r = await fn(ctx, v);
      if (r !== undefined) v = r;
    }
    return v;
  }) as unknown as F;
}

function copyContextHeaders(ctx: BaseContext<any, any>, res: Response): void {
  ctx.set.headers.forEach((v, k) => {
    if (!res.headers.has(k)) res.headers.set(k, v);
  });
}

function hasRequestSchema(
  request: RequestSchemas | undefined,
  key: keyof RequestSchemas,
): boolean {
  return !!request && !!request[key];
}

async function buildContext(
  request: Request,
  url: URL,
  rawParams: Record<string, string>,
  def: RouteDefinition<any, any, any, any>,
  opts: {
    bodyLimitBytes: number;
    allowedContentTypes?: string[];
    multipart?: AppOptions["multipart"];
  },
): Promise<BaseContext<any, any>> {
  const set = { headers: new Headers() };
  const headersObj = headersToObject(request.headers);
  const queryObj = queryToObject(url.searchParams);

  let params: any = rawParams;
  let query: any = queryObj;
  let headers: any = headersObj;
  let body: any = undefined;

  if (def.request?.params) {
    const r = await validate(def.request.params, rawParams);
    if (r.issues) throw new ValidationError("params", toIssues(r.issues));
    params = r.value;
  }
  if (def.request?.query) {
    const r = await validate(def.request.query, queryObj);
    if (r.issues) throw new ValidationError("query", toIssues(r.issues));
    query = r.value;
  }
  if (def.request?.headers) {
    const r = await validate(def.request.headers, headersObj);
    if (r.issues) throw new ValidationError("headers", toIssues(r.issues));
    headers = r.value;
  }
  if (def.request?.body) {
    const ct = (request.headers.get("content-type") ?? "").toLowerCase();
    const allowed = def.accepts ?? opts.allowedContentTypes ?? [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ];
    if (!allowed.some((a) => ct.includes(a))) {
      throw new UnsupportedMediaTypeError(ct || "(none)", allowed);
    }
    const raw = await readBody(
      request,
      ct,
      opts.bodyLimitBytes,
      opts.multipart,
    );
    const r = await validate(def.request.body, raw);
    if (r.issues) throw new ValidationError("body", toIssues(r.issues));
    body = r.value;
  }

  return { request, params, query, headers, body, state: {}, set };
}

function headersToObject(h: Headers): Record<string, string> {
  const o: Record<string, string> = {};
  h.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

function queryToObject(s: URLSearchParams): Record<string, string | string[]> {
  const o: Record<string, string | string[]> = {};
  for (const key of new Set(s.keys())) {
    const all = s.getAll(key);
    o[key] = all.length > 1 ? all : (all[0] as string);
  }
  return o;
}

function toIssues(
  issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<any> }>,
) {
  return issues.map((i) => ({
    message: i.message,
    path: (i.path ?? [])
      .map((p) =>
        typeof p === "object" && p && "key" in p ? (p as any).key : p,
      )
      .join("."),
  }));
}

async function readBody(
  req: Request,
  ct: string,
  limit: number,
  multipart?: AppOptions["multipart"],
): Promise<unknown> {
  if (ct.includes("application/json")) {
    const bytes = await readBodyLimited(req, limit);
    if (bytes.byteLength === 0) return undefined;
    return safeJsonParse(new TextDecoder().decode(bytes));
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const bytes = await readBodyLimited(req, limit);
    return Object.fromEntries(
      new URLSearchParams(new TextDecoder().decode(bytes)),
    );
  }
  if (ct.includes("multipart/form-data")) {
    // Multipart: rely on platform parser, but enforce content-length first.
    const cl = req.headers.get("content-length");
    if (cl && Number(cl) > limit) {
      throw new PayloadTooLargeError(limit);
    }
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    let fields = 0;
    let files = 0;
    (fd as any).forEach((v: unknown, k: string) => {
      fields++;
      const isFile =
        v != null &&
        typeof v === "object" &&
        typeof (v as Blob).size === "number" &&
        typeof (v as Blob).arrayBuffer === "function";
      if (isFile) {
        files++;
        if (
          multipart?.maxFileBytes !== undefined &&
          (v as Blob).size > multipart.maxFileBytes
        ) {
          throw new PayloadTooLargeError(multipart.maxFileBytes);
        }
      }
      out[k] = v;
    });
    if (multipart?.maxFields !== undefined && fields > multipart.maxFields) {
      throw new BadRequestError(
        `Too many form fields (${fields} > ${multipart.maxFields})`,
      );
    }
    if (multipart?.maxFiles !== undefined && files > multipart.maxFiles) {
      throw new BadRequestError(
        `Too many file uploads (${files} > ${multipart.maxFiles})`,
      );
    }
    return out;
  }
  const bytes = await readBodyLimited(req, limit);
  return new TextDecoder().decode(bytes);
}

async function serializeResult(
  result: { status: number; body: unknown; headers?: Record<string, string> },
  def: RouteDefinition<any, any, any, any>,
  validateResponses: boolean,
): Promise<Response> {
  const spec = def.responses[result.status];
  if (!spec) {
    throw new InternalError(
      `Handler returned status ${result.status} which is not declared in responses for ${def.method} ${def.path}`,
    );
  }
  if (validateResponses && spec.body) {
    const r = await validate(spec.body, result.body);
    if (r.issues) {
      throw new InternalError(
        `Response body for ${def.method} ${def.path} failed schema validation: ${r.issues
          .map((i) => i.message)
          .join("; ")}`,
      );
    }
  }
  const headers = new Headers(result.headers);
  const explicitCt = headers.get("content-type");
  const treatAsJson = !explicitCt || explicitCt.includes("application/json");
  if (!explicitCt) headers.set("content-type", "application/json");

  let body: BodyInit | null;
  if (result.body === undefined || result.body === null) {
    body = null;
  } else if (
    !treatAsJson &&
    (typeof result.body === "string" ||
      result.body instanceof Uint8Array ||
      result.body instanceof ArrayBuffer)
  ) {
    body = result.body as BodyInit;
  } else if (!treatAsJson && (result.body as any) instanceof ReadableStream) {
    body = result.body as BodyInit;
  } else {
    body = JSON.stringify(result.body);
  }
  return new Response(body, { status: result.status, headers });
}

function mockResponseFor(def: RouteDefinition<any, any, any, any>) {
  const statuses = Object.keys(def.responses).map(Number).sort();
  const status = statuses.find((s) => s >= 200 && s < 300) ?? statuses[0];
  if (status === undefined)
    throw new InternalError("Mock mode: no responses declared");
  const spec = def.responses[status]!;
  const example =
    spec.examples && Object.values(spec.examples)[0] !== undefined
      ? Object.values(spec.examples)[0]
      : null;
  return { status, body: example };
}

function runHandler(
  def: RouteDefinition<any, any, any, any>,
  ctx: BaseContext<any, any>,
  requestTimeoutMs: number,
): Promise<unknown> {
  const handlerPromise = Promise.resolve(def.handler(ctx));
  return requestTimeoutMs > 0
    ? withTimeout(handlerPromise, requestTimeoutMs)
    : handlerPromise;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RequestTimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/**
 * Factory alias for `new App(options)`. Lets callers who prefer a
 * functional style (or who avoid `new`) write:
 *
 * ```ts
 * import { createApp } from "@daloyjs/core";
 *
 * const app = createApp({ openapi: { info: { title: "My API", version: "1.0.0" } }, docs: true });
 * ```
 *
 * Behaviour is identical to `new App(options)` — the alias exists purely
 * for ergonomics and matches the factory pattern used by Express, Fastify,
 * and Hono adapters.
 *
 * @since 0.3.0
 */
export function createApp(options: AppOptions = {}): App {
  return new App(options);
}

const PACKAGE_JSON_CACHE: { value?: Promise<{ title?: string; version?: string; description?: string }> } = {};

/**
 * Best-effort lazy read of the host project's `package.json` so that
 * `new App({ docs: true })` with no explicit `openapi.info` still produces
 * a spec titled after the user's package. Reads `package.json` first; if
 * none is found while walking up from `process.cwd()`, falls back to
 * `deno.json` / `deno.jsonc` so Deno projects get the same DX without a
 * `package.json`. Returns an empty object on edge runtimes (Cloudflare
 * Workers, Vercel Edge) where `node:fs` is absent, on any I/O or parse
 * error, and when nothing is found.
 *
 * The result is memoized at module scope: manifests do not change
 * during a process lifetime and we never want this to add latency to
 * subsequent docs requests.
 */
function readHostPackageJsonInfo(): Promise<{ title?: string; version?: string; description?: string }> {
  if (PACKAGE_JSON_CACHE.value !== undefined) return PACKAGE_JSON_CACHE.value;
  const promise = (async () => {
    const empty = {};
    const proc = (globalThis as { process?: { cwd?: () => string } }).process;
    if (!proc || typeof proc.cwd !== "function") return empty;

    let fs: typeof import("node:fs");
    let path: typeof import("node:path");
    try {
      fs = await import("node:fs");
      path = await import("node:path");
    } catch {
      return empty;
    }

    let dir: string;
    try {
      dir = proc.cwd();
    } catch {
      return empty;
    }

    const parseManifest = (raw: string, allowComments: boolean) => {
      // deno.jsonc allows // line comments and /* block */ comments. Strip
      // them before parsing — naively, but well enough for typical manifests.
      const text = allowComments
        ? raw
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
        : raw;
      return JSON.parse(text) as {
        name?: unknown;
        version?: unknown;
        description?: unknown;
      };
    };

    const extractInfo = (json: { name?: unknown; version?: unknown; description?: unknown }) => {
      const result: { title?: string; version?: string; description?: string } = {};
      if (typeof json.name === "string" && json.name.length > 0) {
        result.title = json.name;
      }
      if (typeof json.version === "string" && json.version.length > 0) {
        result.version = json.version;
      }
      if (typeof json.description === "string" && json.description.length > 0) {
        result.description = json.description;
      }
      return result;
    };

    // Walk up to the filesystem root looking for a manifest. Cap depth so
    // a deeply-nested cwd can't cause excessive stat calls. At each level,
    // prefer package.json, then deno.json, then deno.jsonc.
    for (let i = 0; i < 12; i++) {
      const pkg = path.join(dir, "package.json");
      const denoJson = path.join(dir, "deno.json");
      const denoJsonc = path.join(dir, "deno.jsonc");
      try {
        if (fs.existsSync(pkg)) {
          return extractInfo(parseManifest(fs.readFileSync(pkg, "utf8"), false));
        }
        if (fs.existsSync(denoJson)) {
          return extractInfo(parseManifest(fs.readFileSync(denoJson, "utf8"), false));
        }
        if (fs.existsSync(denoJsonc)) {
          return extractInfo(parseManifest(fs.readFileSync(denoJsonc, "utf8"), true));
        }
      } catch {
        return empty;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return empty;
  })();
  PACKAGE_JSON_CACHE.value = promise;
  return promise;
}

/**
 * Test helper: clear the cached package.json read so each test starts
 * from a fresh lookup. Not part of the public API.
 *
 * @internal
 */
export function _resetPackageJsonCacheForTests(): void {
  PACKAGE_JSON_CACHE.value = undefined;
}
