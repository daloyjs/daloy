import type { StandardSchemaV1 } from "./schema.js";

/**
 * Set of HTTP methods recognized by DaloyJS' router and OpenAPI generator.
 * `HEAD` is automatically served from the matching `GET` route when no
 * explicit `HEAD` handler is registered.
 *
 * @since 0.1.0
 */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * A route path. Must start with `"/"`. Path parameters are written with a
 * leading colon and are inferred into `ctx.params` at the type level.
 *
 * @example
 * ```ts
 * const path: PathString = "/books/:id";
 * // ParamsOf<"/books/:id"> => "id"
 * ```
 *
 * @since 0.1.0
 */
export type PathString = `/${string}`;

/**
 * Extracts the union of path-parameter names from a route path at the
 * type level. Used to derive `ctx.params` when no explicit `params` schema
 * is supplied.
 *
 * @example
 * ```ts
 * type P = ParamsOf<"/orgs/:org/repos/:repo">; // "org" | "repo"
 * ```
 *
 * @since 0.1.0
 */
export type ParamsOf<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParamsOf<`/${Rest}`>
    : P extends `${string}:${infer Param}`
    ? Param
    : never;

/**
 * Record of raw (string) path parameters keyed by their name in the path.
 * The shape is computed from {@link ParamsOf}.
 *
 * @since 0.1.0
 */
export type PathParams<P extends string> = {
  [K in ParamsOf<P>]: string;
};

// ---------- Request schema bag ----------

/**
 * Bundle of validators for the four request inputs DaloyJS validates before
 * calling your handler. Every field is optional — omitted parts pass through
 * untyped (raw `Record<string, string>` for `query`/`headers`, `unknown` for
 * `body`, and {@link PathParams} for `params`).
 *
 * Schemas may come from any Standard-Schema-compatible validator
 * (Zod, Valibot, ArkType, TypeBox via adapter, ...).
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const request = {
 *   params: z.object({ id: z.uuid() }),
 *   body: z.object({ title: z.string().min(1) }),
 * } satisfies RequestSchemas;
 * ```
 *
 * @since 0.1.0
 */
export interface RequestSchemas {
  /** Validator for path parameters. Without it, `ctx.params` is raw {@link PathParams} strings. */
  params?: StandardSchemaV1;
  /** Validator for the parsed query string. Without it, `ctx.query` is a raw string record. */
  query?: StandardSchemaV1;
  /** Validator for request headers. Without it, `ctx.headers` is a raw string record. */
  headers?: StandardSchemaV1;
  /** Validator for the parsed request body. Without it, `ctx.body` is `unknown`. Prefer `.strict()` object schemas so unexpected keys are rejected. */
  body?: StandardSchemaV1;
}

/** Infer the validated output of a Standard Schema validator, or `undefined` when no schema is present. */
export type InferOut<S> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : undefined;

/**
 * Computed type that infers the four pieces of validated request data from
 * the route's `request` schemas. When a part has no schema, a permissive
 * fallback is used:
 *
 * - `params`  — `PathParams<P>` (all string)
 * - `query`   — `Record<string, string | string[] | undefined>`
 * - `headers` — `Record<string, string | undefined>`
 * - `body`    — `unknown`
 *
 * @since 0.1.0
 */
export type InferRequest<R extends RequestSchemas | undefined, P extends string> = {
  params: R extends { params: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["params"]>
    : PathParams<P>;
  query: R extends { query: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["query"]>
    : Record<string, string | string[] | undefined>;
  headers: R extends { headers: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["headers"]>
    : Record<string, string | undefined>;
  body: R extends { body: StandardSchemaV1 } ? InferOut<R["body"]> : unknown;
};

// ---------- Responses ----------

/**
 * Describes a single HTTP response variant declared by a route.
 *
 * - `description` — surfaces in OpenAPI documentation. Required.
 * - `body`        — Standard-Schema validator for the response body; when
 *   present, DaloyJS validates the handler's return value against it
 *   (controlled by `AppOptions.validateResponses`).
 * - `headers`     — Documented response headers (also typed in OpenAPI).
 * - `examples`    — Example payloads emitted into the OpenAPI document and
 *   served by the framework when `AppOptions.mockMode` is enabled.
 *
 * @since 0.1.0
 */
export interface ResponseSpec {
  /** Human-readable description emitted into the OpenAPI response object. Required. */
  description: string;
  /** Response-body validator; handler return values are checked against it when `AppOptions.validateResponses` is on. */
  body?: StandardSchemaV1;
  /** Documented response headers keyed by header name; surfaced in the OpenAPI document. */
  headers?: Record<string, { description?: string; schema?: StandardSchemaV1 }>;
  /** Named example payloads emitted into OpenAPI and served when `AppOptions.mockMode` is enabled. */
  examples?: Record<string, unknown>;
}

/**
 * Map of HTTP status code → {@link ResponseSpec}. The keys drive the
 * `responses` section of the generated OpenAPI document and the discriminated
 * union returned by your handler.
 *
 * @example
 * ```ts
 * const responses = {
 *   200: { description: "OK", body: z.object({ id: z.string() }) },
 *   404: { description: "Not Found" },
 * } satisfies ResponsesMap;
 * ```
 *
 * @since 0.1.0
 */
export type ResponsesMap = {
  [Status in number]?: ResponseSpec;
};

/** Union of declared status-code literals in a {@link ResponsesMap}. */
export type StatusOf<R extends ResponsesMap> = Extract<keyof R, number>;

/**
 * Discriminated union of legal return values for a handler. The status code
 * is a literal type so TypeScript enforces that every returned response is
 * declared in the route's `responses` map.
 *
 * @since 0.1.0
 */
export type HandlerReturn<R extends ResponsesMap> = {
  [S in StatusOf<R>]: {
    status: S;
    body: R[S] extends { body: StandardSchemaV1 }
      ? StandardSchemaV1.InferInput<NonNullable<R[S]>["body"] & StandardSchemaV1>
      : unknown;
    headers?: Record<string, string>;
  };
}[StatusOf<R>];

// ---------- Auth ----------

/**
 * Declarative authentication requirement for a route. The `scheme` name must
 * appear in `generateOpenAPI(app, { securitySchemes: { ... } })` so the
 * generated spec resolves the security requirement correctly.
 *
 * @example
 * ```ts
 * auth: { scheme: "bearerAuth", scopes: ["orders:read"] }
 * ```
 *
 * @since 0.1.0
 */
export interface AuthSpec {
  /** Name referenced in OpenAPI components.securitySchemes */
  scheme: string;
  /** Optional scopes/permissions, surfaces in OpenAPI security requirement */
  scopes?: string[];
  /**
   * Route-level payload/body-auth participation. Defaults to `true` when
   * omitted. Setting `false` opts the route out of payload authentication;
   * Daloy refuses that opt-out at route registration time when the referenced
   * security scheme declares `requirePayloadAuth: true` (or the OpenAPI-safe
   * `x-daloy-require-payload-auth: true` extension).
   *
   * @since 0.23.0
   */
  payload?: boolean;
}

// ---------- Context ----------

/**
 * **Module-augmentation hook** for typing plugin-provided state.
 *
 * DaloyJS plugins (sessions, tracing, auth, ...) merge values into
 * `ctx.state`. Augment this interface from your application code so those
 * values become strongly typed everywhere `ctx.state` is used.
 *
 * @example
 * ```ts
 * // Put this in a regular module the compiler always checks (e.g. the
 * // plugin file that calls `app.decorate(...)`). Avoid a separate .d.ts:
 * // `skipLibCheck` skips declaration files, so a broken import there
 * // silently types the state value as `any`.
 * declare module "@daloyjs/core" {
 *   interface AppState {
 *     user: { id: string; roles: string[] };
 *   }
 * }
 *
 * // Now ctx.state.user is typed in every handler.
 * ```
 *
 * @since 0.1.0
 */
export interface AppState {}

/**
 * Scheme-aware auth contract. Every shipped first-party
 * auth helper writes through to `ctx.state.auth` with a discriminated
 * `scheme` tag so audit logs, revocation hooks, and per-scheme
 * `verify(credentials, ctx)` callbacks know which scheme issued the
 * credential. Prevents the "session-cookie revocation list applied to a
 * bearer-token request" class of cross-scheme confusion.
 *
 * @since 0.24.0
 */
export type AuthScheme =
  | "bearer"
  | "basic"
  | "jwt"
  | "jwk"
  | "webhook"
  | "session"
  | "apiKey";

/**
 * Verified-identity envelope written to `ctx.state.auth` by the first-party
 * auth helpers. The `scheme` discriminant keeps per-scheme logic (revocation
 * lists, audit logs) from being applied to credentials issued by a different
 * scheme (see {@link AuthScheme}).
 *
 * @since 0.24.0
 */
export interface AuthContext<TCredentials = unknown> {
  /** Discriminant naming the auth helper that verified the request (e.g. `"jwt"`, `"session"`). */
  readonly scheme: AuthScheme;
  /** The verified credential payload (decoded JWT claims, session record, ...); shape depends on the scheme. */
  readonly credentials: TCredentials;
}

/**
 * The context object passed to every route handler and hook.
 *
 * Contains the original `Request`, the four pieces of validated request data
 * (`params`, `query`, `headers`, `body`), a mutable `state` bag for
 * cross-cutting plugins, and a `set` helper for adjusting outgoing
 * status/headers without bypassing schema validation.
 *
 * The shape is computed from the route's path and `request` schemas so all
 * inputs are strongly typed inside the handler with zero extra boilerplate.
 *
 * @since 0.1.0
 */
export interface BaseContext<P extends string, R extends RequestSchemas | undefined> {
  /** The original web-standard `Request`. Its body stream may already be consumed when a `body` schema triggered parsing. */
  request: Request;
  /** Validated request data (or raw fallbacks if no schema). */
  params: InferRequest<R, P>["params"];
  /** Validated query params; raw `Record<string, string | string[] | undefined>` without a schema. */
  query: InferRequest<R, P>["query"];
  /** Validated request headers; raw `Record<string, string | undefined>` without a schema. */
  headers: InferRequest<R, P>["headers"];
  /** Validated request body; `unknown` without a schema. Parsed prototype-pollution-safe (forbidden keys rejected). */
  body: InferRequest<R, P>["body"];
  /** Mutable per-request state. Plugin-augmented context lives here. */
  state: AppState & Record<string, unknown>;
  /** Convenience response helpers (do not bypass schema validation). */
  set: {
    status?: number;
    headers: Headers;
  };
}

// ---------- Hooks ----------

/**
 * Lifecycle hooks fired around request handling. Hooks compose pipeline-style
 * — the global hooks (`AppOptions.hooks`) run first, then group hooks added
 * with `app.use()`, then per-route hooks. Returning a `Response` from
 * `beforeHandle` or `onSend` short-circuits/replaces the response.
 *
 * Ordering for a successful request:
 *   1. `onRequest`     — before any context is built (raw `Request`).
 *   2. `beforeHandle`  — with the built context; may short-circuit.
 *   3. *handler runs*
 *   4. `afterHandle`   — may transform the handler return value.
 *   5. *response is serialized + validated*
 *   6. `onSend`        — may mutate or replace the outgoing `Response`.
 *   7. `onResponse`    — fire-and-forget observer (cannot change anything).
 *
 * `onError` runs on the error path before serialization.
 *
 * @since 0.1.0
 */
export interface Hooks {
  /** Runs first, before validation or context building. Receives the raw web-standard `Request`. */
  onRequest?: (req: Request) => void | Promise<void>;
  /** Runs with the validated {@link BaseContext} before the handler. Returning a `Response` short-circuits the handler entirely (useful for auth guards). */
  beforeHandle?: (ctx: BaseContext<any, any>) => void | Response | Promise<void | Response>;
  /** Runs after the handler with its raw return value. Return a non-`undefined` value to replace the result before serialization and response-schema validation. */
  afterHandle?: (
    ctx: BaseContext<any, any>,
    result: unknown
  ) => void | unknown | Promise<void | unknown>;
  /** Runs on the error path before serialization. `ctx` is `undefined` if the error occurred before context was built. Return a `Response` to replace the default RFC 9457 problem+json error response. */
  onError?: (err: unknown, ctx: BaseContext<any, any> | undefined) => void | Response | Promise<void | Response>;
  /**
   * Symmetric to `beforeHandle`, but for outgoing responses. Runs after the Response
   * is built (success, error, and OPTIONS preflight paths) and after request-scoped
   * headers are merged, but before `onResponse`. Mutate `res.headers` in place, or
   * return a brand-new `Response` to replace it. Returning `void`/`undefined` keeps
   * the existing response. Multiple `onSend` hooks compose pipeline-style.
   */
  onSend?: (
    res: Response,
    ctx: BaseContext<any, any> | undefined
  ) => void | Response | Promise<void | Response>;
  /** Fire-and-forget observer of the final outgoing `Response` (logging, metrics). Runs last; cannot alter the response. */
  onResponse?: (res: Response) => void | Promise<void>;
}

// ---------- Route definition ----------

/**
 * Declarative description of one HTTP endpoint. The single source of truth
 * for routing, request validation, response validation, OpenAPI generation,
 * and the typed client SDK.
 *
 * Pass instances to {@link App.route} to register them. Generic parameters
 * are usually inferred and rarely need to be specified explicitly.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 *
 * app.route({
 *   method: "GET",
 *   path: "/books/:id",
 *   operationId: "getBook",
 *   summary: "Fetch a book by id",
 *   request: { params: z.object({ id: z.uuid() }) },
 *   responses: {
 *     200: { description: "OK", body: z.object({ id: z.string(), title: z.string() }) },
 *     404: { description: "Not Found" },
 *   },
 *   handler: ({ params }) => ({ status: 200, body: { id: params.id, title: "Dune" } }),
 * });
 * ```
 *
 * @since 0.1.0
 */
export interface RouteDefinition<
  P extends PathString = PathString,
  M extends HttpMethod = HttpMethod,
  Req extends RequestSchemas | undefined = undefined,
  Res extends ResponsesMap = ResponsesMap
> {
  /** HTTP method to match (uppercase, e.g. `"GET"`). See {@link HttpMethod}. */
  method: M;
  /** URL path pattern starting with `/`; `:name` segments become typed path params (e.g. `"/books/:id"`). */
  path: P;

  // OpenAPI / introspection metadata
  /** Stable unique operation id for OpenAPI and the generated client (drives SDK method names). Omitted from the spec when unset. */
  operationId?: string;
  /** One-line summary shown in OpenAPI docs UIs. */
  summary?: string;
  /** Longer free-form description for the OpenAPI operation (CommonMark allowed). */
  description?: string;
  /** OpenAPI tags used to group the operation in docs UIs; merged with {@link RouteMeta.tags}. */
  tags?: string[];
  /** Emits `deprecated: true` on the OpenAPI operation. Set implicitly when {@link RouteDefinition.sunset} is present. */
  deprecated?: boolean;
  /** Optional per-route API version label. Informational metadata only; not emitted into the OpenAPI document. */
  version?: string;

  /**
   * Acknowledge that this route's `2xx` responses intentionally carry no
   * response body schema — an opaque, framework-controlled, or non-JSON body
   * (a raw `Response`, an HTML page, a spec document, a proxied payload).
   *
   * Setting this suppresses the `security.response.bodySchemaMissing` boot
   * warning and the `audit.response.bodySchema` `daloy doctor` finding for
   * this route only. It documents intent; it does not add protection —
   * response field-level stripping (OWASP API3) still does not run for a
   * `2xx` response without a body schema, so never set this on a route whose
   * handler builds JSON from domain objects.
   */
  acknowledgeNoResponseBodySchema?: boolean;

  /**
   * Mark the endpoint as scheduled for removal at a specific date (RFC 8594
   * "The Sunset HTTP Header Field"). Accepts an ISO-8601 string, any string
   * parseable by `new Date(...)`, or a `Date`. When set, the framework:
   *
   * - implicitly treats the route as {@link RouteDefinition.deprecated}
   *   (the OpenAPI operation is emitted with `deprecated: true`);
   * - emits a `Deprecation: true` response header on every response from the
   *   route; and
   * - emits a `Sunset: <IMF-fixdate>` response header normalized to an HTTP
   *   date so clients and gateways can schedule migration.
   *
   * The OpenAPI document also surfaces the normalized value as an
   * `x-sunset` vendor extension on the operation.
   *
   * Invalid (unparseable) values are rejected at `app.route(...)`
   * registration time, never per-request.
   *
   * @example
   * ```ts
   * app.route({
   *   method: "GET",
   *   path: "/v1/legacy",
   *   deprecated: true,
   *   sunset: "2026-12-31T00:00:00Z",
   *   responses: { 200: { description: "OK" } },
   *   handler: () => ({ status: 200, body: { ok: true } }),
   * });
   * ```
   *
   * @since 0.37.0
   */
  sunset?: string | Date;

  /** Standard Schemas ({@link RequestSchemas}) validating `params`/`query`/`headers`/`body`. Parts without a schema arrive untyped; validation failures return 400/422 before the handler runs. */
  request?: Req;
  /** Map of status code to {@link ResponseSpec}. Drives response-body validation, the handler's allowed return types, OpenAPI responses, and the typed client. */
  responses: Res;

  /** Declarative auth requirement ({@link AuthSpec}); surfaces as the OpenAPI `security` requirement for this operation. */
  auth?: AuthSpec;

  /**
   * Per-route Content-Type allowlist. When the route declares a `body`
   * schema, the framework compares the inbound `Content-Type` against this
   * list (substring match) before parsing. Overrides the global
   * `app({ allowedContentTypes })` value. Use it to opt a single route in
   * to `application/x-www-form-urlencoded`, `text/xml`, or any other media
   * type that the secure-by-default global allowlist excludes, without
   * loosening the policy for the rest of the API.
   *
   * @example
   * ```ts
   * app.route({
   *   method: "POST",
   *   path: "/legacy-form",
   *   accepts: ["application/x-www-form-urlencoded"],
   *   request: { body: legacyFormSchema },
   *   responses: { 200: { description: "OK" } },
   *   handler: ({ body }) => ({ status: 200, body: { ok: true, body } }),
   * });
   * ```
   *
   * @since 0.16.0
   */
  accepts?: string[];

  /**
   * Mark a route as internal. Requests reaching the route via the public
   * `app.fetch(...)` entry point (i.e. any deployed adapter) receive a
   * `404 Not Found` so existence cannot be probed, while in-process callers
   * that go through `app.inject(...)` execute the handler normally. Pair
   * with admin/cron endpoints, debugging shims, or platform-specific
   * health probes that should never be reachable from the network.
   *
   * @example
   * ```ts
   * app.route({
   *   method: "POST",
   *   path: "/__admin/reindex",
   *   internal: true,
   *   responses: { 204: { description: "Started" } },
   *   handler: () => ({ status: 204 }),
   * });
   *
   * await app.inject(new Request("http://app/__admin/reindex", { method: "POST" }));
   * ```
   *
   * @since 0.19.0
   */
  internal?: boolean;

  /**
   * Optional OpenAPI 3.1 callbacks (out-of-band requests this operation may
   * trigger on the consumer). Each callback name maps to one or more runtime
   * expressions (e.g. `"{$request.body#/callbackUrl}"`); each expression maps
   * to one or more operations keyed by HTTP method.
   *
   * Spec reference: https://spec.openapis.org/oas/v3.1.0#callback-object
   */
  callbacks?: CallbackMap;

  /**
   * Optional AI-friendly metadata. Surfaces into OpenAPI as `examples`
   * (request body + per response) and `x-daloy-*` vendor extensions; also
   * dumped by `daloy inspect --ai` for LLM/codegen consumption.
   *
   * @since 0.14.0
   */
  meta?: RouteMeta;

  /** Per-route lifecycle {@link Hooks}. Run after global and group hooks in the pipeline. */
  hooks?: Hooks;

  /**
   * The route handler. Receives the typed, validated {@link BaseContext} and
   * returns either:
   *
   * - a structured result `{ status, body, headers? }` whose `body` is
   *   validated against the route's response schema and typed end-to-end into
   *   the OpenAPI document and generated client (the common case), or
   * - a raw web-standard {@link Response} as an escape hatch for streaming,
   *   proxying, or pre-built bodies (for example an AI SDK
   *   `result.toUIMessageStreamResponse()`, or an upstream `fetch()` response
   *   forwarded verbatim).
   *
   * A returned `Response` **bypasses response-schema validation and the
   * typed-client body type by design** — there is no schema that can describe
   * an opaque stream. It is still finalized exactly like every other response,
   * so no security control is skipped: headers set via `ctx.set` (including
   * `secureHeaders()` and CORS) are copied onto it, `x-request-id` is added
   * when absent, any `onSend` / `onResponse` hooks run, server-fingerprint
   * headers (`server`, `x-powered-by`) are stripped, and a `HEAD` request still
   * yields an empty body. This mirrors the existing `beforeHandle` `Response`
   * passthrough. Prefer the structured result whenever a schema can describe
   * the payload; reach for `Response` only when it genuinely cannot.
   *
   * @since 0.1.0
   */
  handler: (
    ctx: BaseContext<P, Req>
  ) => HandlerReturn<Res> | Response | Promise<HandlerReturn<Res> | Response>;
}

// ---------- Callbacks ----------

/**
 * One operation inside an OpenAPI Callback Object. Mirrors a route minus
 * `path` (the URL is supplied at runtime via the expression key) and
 * `handler` (no execution path on the producer side).
 */
export interface CallbackOperation {
  /** HTTP method the producer uses when invoking the callback URL. */
  method: HttpMethod;
  /** Stable unique operation id for the callback operation in the OpenAPI document. */
  operationId?: string;
  /** One-line summary shown in OpenAPI docs UIs. */
  summary?: string;
  /** Longer free-form description for the callback operation. */
  description?: string;
  /** OpenAPI tags grouping the callback operation in docs UIs. */
  tags?: string[];
  /** Emits `deprecated: true` on the callback operation. */
  deprecated?: boolean;
  /** Schemas describing the outgoing callback request (documentation only; never executed by the framework). */
  request?: RequestSchemas;
  /** Responses the producer expects back from the consumer, keyed by status code. */
  responses: ResponsesMap;
  /** Auth requirement the callback request is documented to carry ({@link AuthSpec}). */
  auth?: AuthSpec;
}

/**
 * A Callback Object: maps runtime expressions to one or more operations.
 *
 * @example
 * {
 *   "{$request.body#/callbackUrl}": {
 *     method: "POST",
 *     responses: { 200: { description: "ok" } },
 *   },
 * }
 */
export type CallbackDefinition = Record<
  string,
  CallbackOperation | CallbackOperation[]
>;

/** A named map of OpenAPI Callback Objects. */
export interface CallbackMap {
  [name: string]: CallbackDefinition;
}

// ---------- AI-friendly route metadata ----------

/**
 * One machine-readable usage example for a route. Both halves are optional;
 * a request-only example documents how to call the endpoint, a response-only
 * example documents a representative payload, and a complete pair lets
 * codegen tools and LLM SDK builders produce realistic fixtures.
 *
 * Example payloads (`request.body`, `response.body`) are validated against
 * the route's declared Standard Schemas by `runContractTests()`; mismatches
 * surface as errors so the OpenAPI document never publishes a sample that
 * does not match the schema.
 *
 * @since 0.14.0
 */
export interface RouteExample {
  /** One-line label for the example, surfaced as the OpenAPI example `summary`. */
  summary?: string;
  /** Longer explanation of what the example demonstrates. */
  description?: string;
  /** Sample inbound request. `body` is validated against the route's request body schema by `runContractTests()`. */
  request?: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /** Sample response. `status` must be declared in the route's `responses`; `body` is validated against that status's schema. */
  response?: {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  };
}

/**
 * Optional AI-friendly route metadata. Surfaces into the generated OpenAPI
 * document as `examples` (per request body and per response) and as
 * `x-daloy-*` vendor extensions; the same payload is dumped by
 * `daloy inspect --ai` for LLM and codegen consumption.
 *
 * - `summary` / `description` / `tags` — augment the route-level fields of
 *   the same name. Route-level values win when both are set.
 * - `examples` — named request/response example pairs, validated at build
 *   time against the route's declared Standard Schemas.
 * - `extensions` — free-form key/value bag emitted as `x-<key>` properties
 *   on the OpenAPI Operation Object. Keys without an `x-` prefix are
 *   prefixed automatically for OpenAPI compliance.
 *
 * @since 0.14.0
 */
export interface RouteMeta {
  /** Fallback operation summary; the route-level `summary` wins when both are set. */
  summary?: string;
  /** Fallback operation description; the route-level `description` wins when both are set. */
  description?: string;
  /** Extra OpenAPI tags, merged (deduplicated) with the route-level `tags`. */
  tags?: string[];
  /** Named request/response examples ({@link RouteExample}); validated against the route's schemas by `runContractTests()`. */
  examples?: Record<string, RouteExample>;
  /** Free-form vendor extensions emitted as `x-<key>` on the OpenAPI operation; keys are auto-prefixed with `x-` when missing. */
  extensions?: Record<string, unknown>;
}
