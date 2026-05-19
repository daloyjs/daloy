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
  params?: StandardSchemaV1;
  query?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  body?: StandardSchemaV1;
}

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
  description: string;
  body?: StandardSchemaV1;
  headers?: Record<string, { description?: string; schema?: StandardSchemaV1 }>;
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
 * // src/types.d.ts
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
  request: Request;
  /** Validated request data (or raw fallbacks if no schema). */
  params: InferRequest<R, P>["params"];
  query: InferRequest<R, P>["query"];
  headers: InferRequest<R, P>["headers"];
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
  onRequest?: (req: Request) => void | Promise<void>;
  beforeHandle?: (ctx: BaseContext<any, any>) => void | Response | Promise<void | Response>;
  afterHandle?: (
    ctx: BaseContext<any, any>,
    result: unknown
  ) => void | unknown | Promise<void | unknown>;
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
  method: M;
  path: P;

  // OpenAPI / introspection metadata
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  version?: string;

  request?: Req;
  responses: Res;

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

  hooks?: Hooks;

  handler: (
    ctx: BaseContext<P, Req>
  ) => HandlerReturn<Res> | Promise<HandlerReturn<Res>>;
}

// ---------- Callbacks ----------

/**
 * One operation inside an OpenAPI Callback Object. Mirrors a route minus
 * `path` (the URL is supplied at runtime via the expression key) and
 * `handler` (no execution path on the producer side).
 */
export interface CallbackOperation {
  method: HttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  request?: RequestSchemas;
  responses: ResponsesMap;
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
  summary?: string;
  description?: string;
  request?: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
  };
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
  summary?: string;
  description?: string;
  tags?: string[];
  examples?: Record<string, RouteExample>;
  extensions?: Record<string, unknown>;
}
