import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference: App & routing",
  description:
    "DaloyJS App class reference: constructor options, route registration, hooks, context types, hook dispatch order, HttpError classes, and Standard Schema validation helpers.",
  path: "/docs/api-reference/app",
  keywords: [
    "DaloyJS App API",
    "DaloyJS routing reference",
    "DaloyJS hooks reference",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference: App &amp; routing</h1>
      <p>
        The <code>App</code> class, route registration, hook and context types,
        the per-request dispatch order, error classes, and the Standard Schema
        validation helpers. Everything on this page is exported from the root{" "}
        <code>@daloyjs/core</code> barrel. For the module map and a runnable
        starter snippet, see the{" "}
        <Link href="/docs/api-reference">API reference overview</Link>.
      </p>

      <FlowDiagram
        title="Per-request dispatch order"
        numbered
        steps={[
          { eyebrow: "hook", label: "onRequest", detail: "(req)" },
          { eyebrow: "router", label: "Route match" },
          { eyebrow: "hook", label: "preBody", detail: "(ctx) raw, no body" },
          {
            eyebrow: "validate",
            label: "Parse & validate",
            detail: "params / query / headers / body",
          },
          { eyebrow: "hook", label: "beforeHandle", detail: "(ctx)" },
          {
            eyebrow: "route",
            label: "handler",
            detail: "(ctx)",
            tone: "accent",
          },
          { eyebrow: "hook", label: "afterHandle", detail: "(ctx, result)" },
          { eyebrow: "hook", label: "onSend / onResponse", detail: "(res)" },
        ]}
        caption="Header-only auth runs in preBody before the body is ever read; body-aware guards (WAF, idempotency) run in beforeHandle with the parsed body."
      />

      <h2 id="class-app">
        <code>class App</code>
      </h2>
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
  allowedContentTypes?: string[];      // default: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"]
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
defineRoute(def: RouteDefinition): RouteDefinition  // literal-preserving identity helper
app.registerRoutes(defs: readonly RouteDefinition[]): App
app.get(path, contract, handler): App                // also post/put/patch/delete/head
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
app.healthcheck    (opts?: HealthRouteOptions): App     // GET /healthz by default (opts.path to override)
app.readinesscheck (opts?: HealthRouteOptions): App     // GET /readyz   by default (opts.path to override)
app.cspReportRoute (opts?: CspReportRouteOptions): App

// Dispatch + introspection
app.ready(): Promise<void>
app.fetch(req: Request): Promise<Response>
app.request(input: string | URL | Request, init?: RequestInit): Promise<Response>
app.introspect(): IntrospectedRoute[]
app.shutdown(timeoutMs?: number, reason?: string): Promise<void>`}
      />

      <h2 id="route-hooks-and-context-types">
        Route, hooks &amp; context types
      </h2>
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
  description?: string; // default: HTTP <status> response
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

interface PreBodyContext<P extends string = string> {
  request: Request;
  params: PathParams<P>; // raw router values
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | undefined>;
  body: undefined;
  state: AppState & Record<string, unknown>;
  set: { status?: number; headers: Headers };
}

// HandlerReturn<R> is a discriminated union by status code - TS enforces
// that every returned response is declared in the route's responses map.
type HandlerReturn<R extends ResponsesMap> = ...;

interface Hooks {
  onRequest?:    (req: Request) => void | Promise<void>;
  preBody?:       (ctx: PreBodyContext) => void | Response | Promise<void | Response>;
  beforeHandle?: (ctx) => void | Response | Promise<void | Response>;
  afterHandle?:  (ctx, result) => void | unknown | Promise<void | unknown>;
  onError?:      (err, ctx?) => void | Response | Promise<void | Response>;
  onSend?:       (res: Response, ctx?) => void | Response | Promise<void | Response>;
  onResponse?:   (res: Response, ctx?) => void;
}

// A successful raw Response from preBody/beforeHandle bypasses response-body
// validation and therefore requires acknowledgeNoResponseBodySchema: true on
// the route. Error/denial Responses (4xx/5xx) do not require an opt-out.

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

      <h2 id="hook-dispatch-order-and-when-the-body-is-read">
        Hook dispatch order &amp; when the body is read
      </h2>
      <p>
        Per matched request, hooks fire in this order:{" "}
        <code>onRequest(req)</code> &rarr; <em>route match</em> &rarr;{" "}
        <code>preBody(ctx)</code> &rarr; validate <code>params</code>/
        <code>query</code>/<code>headers</code>{" "}
        <strong>and read &amp; parse the request body</strong> when the route
        declares a <code>request.body</code> schema &rarr;{" "}
        <code>beforeHandle(ctx)</code> &rarr; <code>handler(ctx)</code> &rarr;{" "}
        <code>afterHandle(ctx, result)</code> &rarr; <code>onSend(res)</code>{" "}
        &rarr; <code>onResponse(res)</code>.
      </p>
      <p>
        Header-only authentication runs in <code>preBody</code>
        {", "}where route params, query values, and headers are raw and{" "}
        <code>ctx.body</code> is always <code>undefined</code>
        {". "}Built-in bearer, basic, JWK, and mTLS helpers can reject an
        unauthenticated upload without consuming it.
      </p>
      <p>
        The body is then read and validated before <code>beforeHandle</code>
        {". "}
        Body-aware guards still need the parsed <code>ctx.body</code>;{" "}
        <code>waf()</code> inspects it for NoSQL-operator injection and other
        inbound attack signatures, and <code>idempotency()</code> derives its
        dedup key from it. Deferring the read would silently turn those into
        no-ops.
      </p>
      <p>
        Custom cheap guards can use <code>preBody</code>
        {". "}Keep rate limits that depend on validated identity, WAF,
        idempotency, dependencies, and other parsed-input logic in{" "}
        <code>beforeHandle</code>.
      </p>

      <h2 id="errors">Errors</h2>
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
class ConflictError              extends HttpError {} // 409 - sets cache-control: no-store
class PayloadTooLargeError       extends HttpError {} // 413
class UnsupportedMediaTypeError  extends HttpError {} // 415
class ValidationError            extends HttpError {} // 422 - carries StandardSchema issues
class TooManyRequestsError       extends HttpError {} // 429 - sets Retry-After
class RequestHeaderFieldsTooLargeError extends HttpError {} // 431 - maxHeaderCount guard
class InternalError              extends HttpError {} // 500 - detail redacted in production

// Defensive guard: throws MessageLeakError when a custom error response
// would set a header outside the safe allowlist.
const SAFE_CUSTOM_ERROR_RESPONSE_HEADERS: ReadonlySet<string>;
class MessageLeakError extends Error {}
function checkCustomErrorResponseHeaders(headers: Headers | Record<string, string>): void;

function httpError(opts: HttpErrorOptions): HttpError;  // typed factory`}
      />

      <h2 id="schema-validation">Schema validation</h2>
      <CodeBlock
        code={`interface StandardSchemaV1<Input = unknown, Output = Input> { ... }  // Standard Schema spec
function isStandardSchema(value: unknown): value is StandardSchemaV1;
function validate<S extends StandardSchemaV1>(schema: S, input: unknown):
  | { ok: true;  value: StandardSchemaV1.InferOutput<S> }
  | { ok: false; issues: ReadonlyArray<StandardSchemaV1.Issue> };`}
      />

      <p>
        Next up:{" "}
        <Link href={"/docs/api-reference/middleware" as Route}>
          middleware, composition &amp; app helpers</Link>
        {"."}
      </p>
    </>
  );
}
