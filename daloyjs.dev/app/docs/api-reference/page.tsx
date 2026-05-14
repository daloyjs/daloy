import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "API reference" };

export default function Page() {
  return (
    <>
      <h1>API reference</h1>
      <p>The complete public surface of DaloyJS v0.1, organized by import path.</p>

      <h2><code>daloy</code> (root)</h2>
      <h3><code>class App</code></h3>
      <CodeBlock code={`new App(options?: {
  bodyLimitBytes?:        number; // default 1 MiB
  allowedContentTypes?:   string[]; // default ["application/json"]
  requestTimeoutMs?:      number; // default 30_000
  production?:            boolean; // defaults from NODE_ENV
  logger?:                Logger;
  mockMode?:              boolean;
})

app.route(def): App
app.group(opts): App                    // returns a child App with prefix/tags/hooks merged
app.use(middleware): App
app.register(plugin, opts?): App
app.decorate(key, value): App
app.ready(): Promise<void>
app.fetch(req: Request): Promise<Response>
app.request(input, init?): Promise<Response>
app.introspect(): RouteInfo[]
app.shutdown(timeoutMs?): Promise<void>`} />

      <h3>Errors</h3>
      <CodeBlock code={`HttpError                    // base — { status, title, type?, detail?, instance? }
BadRequestError              // 400
UnauthorizedError            // 401
ForbiddenError               // 403
NotFoundError                // 404
MethodNotAllowedError        // 405 — sets Allow header
RequestTimeoutError          // 408
PayloadTooLargeError         // 413
UnsupportedMediaTypeError    // 415
ValidationError              // 422
TooManyRequestsError         // 429 — sets Retry-After
InternalError                // 500 — detail redacted in production`} />

      <h3>Security primitives</h3>
      <CodeBlock code={`readBodyLimited(req, limit): Promise<Uint8Array>
safeJsonParse(text): unknown
sanitizeHeaderName(name): string
sanitizeHeaderValue(value): string
timingSafeEqual(a, b): boolean
randomId(): string`} />

      <h3>Built-in middleware</h3>
      <CodeBlock code={`requestId({ header?, trustIncoming?, generator? })
secureHeaders({ csp?, hsts?, frameOptions?, referrerPolicy?, permissionsPolicy?, coop?, corp?, noSniff?, xssProtection? })
cors({ origin, methods?, allowedHeaders?, exposedHeaders?, credentials?, maxAgeSeconds? })
rateLimit({ windowMs, max, keyGenerator?, store?, retryAfter? })
timing(headerName?)
bearerAuth({ validate, realm? })`} />

      <h3>Logger</h3>
      <CodeBlock code={`createLogger({ level?, bindings?, write? }): Logger
noopLogger: Logger

interface Logger {
  trace(obj?, msg?): void;
  debug(obj?, msg?): void;
  info (obj?, msg?): void;
  warn (obj?, msg?): void;
  error(obj?, msg?): void;
  fatal(obj?, msg?): void;
  child(bindings): Logger;
}`} />

      <h2><code>daloy/openapi</code></h2>
      <CodeBlock code={`generateOpenAPI(app, {
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  securitySchemes?: Record<string, SecurityScheme>;
}): OpenAPIDocument`} />

      <h2><code>daloy/client</code></h2>
      <CodeBlock code={`createClient<App>(app, {
  baseUrl: string;
  fetch?:  typeof fetch;
  headers?: Record<string, string>;
}): Client<App>
// returns an object keyed by operationId; each method takes
// { params?, query?, headers?, body? } and returns
// { status, body, headers } as a discriminated union by status.`} />

      <h2><code>daloy/contract</code></h2>
      <CodeBlock code={`runContractTests(app, opts?: {
  requireOperationId?:    boolean; // default true
  allowBodyOnSafeMethods?: boolean; // default false
}): Promise<{ ok: boolean; checked: number; issues: Issue[] }>`} />

      <h2><code>daloy/docs</code></h2>
      <CodeBlock code={`scalarHtml({ specUrl, title }): string
swaggerUiHtml({ specUrl, title }): string
htmlResponse(html): Response`} />

      <h2><code>daloy/node</code></h2>
      <CodeBlock code={`serve(app, opts?: {
  port?:                number; // default 3000
  hostname?:            string; // default "0.0.0.0"
  connectionTimeoutMs?: number;
  shutdownTimeoutMs?:   number;
  handleSignals?:       boolean; // default true
  maxHeaderBytes?:      number;  // default 16 KiB
}): { port: number; close(): Promise<void> }`} />

      <h2><code>daloy/bun</code> · <code>daloy/deno</code></h2>
      <p>Same shape as <code>daloy/node</code> — thin wrappers around <code>app.fetch</code>.</p>

      <h2><code>daloy/cloudflare</code> · <code>daloy/vercel</code></h2>
      <CodeBlock code={`toFetchHandler(app): (req: Request) => Promise<Response>
toEdgeHandler (app): (req: Request) => Promise<Response>`} />

      <h2>Schema utilities</h2>
      <CodeBlock code={`isStandardSchema(value): boolean
validate(schema, input): { ok: true; value } | { ok: false; issues }`} />
    </>
  );
}
