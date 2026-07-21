import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference: Feature modules",
  description:
    "DaloyJS subpath module reference: OpenAPI generation, typed clients, contract tests, MCP, docs UIs, streaming, multipart, WebSocket, tracing, Redis rate limiting, and the CLI surface.",
  path: "/docs/api-reference/modules",
  keywords: [
    "DaloyJS modules API",
    "DaloyJS OpenAPI reference",
    "DaloyJS MCP reference",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference: Feature modules</h1>
      <p>
        The per-feature subpath modules: OpenAPI generation, the typed client,
        contract tests, MCP, docs UIs, streaming, multipart, WebSocket
        primitives, tracing, metrics stores, and the CLI internals. Each module
        also re-exports from the root barrel unless noted. See the{" "}
        <Link href="/docs/api-reference">API reference overview</Link> for the
        complete module map.
      </p>

      <BranchDiagram
        title="One contract, many outputs"
        source={{
          eyebrow: "single source of truth",
          label: "App route contracts",
          detail: "method + path + request + responses",
        }}
        branches={[
          {
            eyebrow: "/openapi",
            label: "OpenAPI 3.1 document",
            detail: "generateOpenAPI(app, opts)",
          },
          {
            eyebrow: "/client · /contract",
            label: "Typed client & contract tests",
            detail: "createClient(app), runContractTests(app)",
          },
          {
            eyebrow: "/docs · /mcp",
            label: "Docs UIs & MCP tools",
            detail: "scalarHtml(), createMcpHandler()",
          },
        ]}
        caption="Every module below reads the same route contracts your handlers are typed against, so the spec, client, docs, and MCP surface can never drift from the code."
      />

      <h2 id="daloyjs-core-openapi">
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

      <h3 id="discriminated-unions-openapi">Discriminated unions (OpenAPI)</h3>
      <CodeBlock
        code={`discriminator(opts: DiscriminatorObject): unknown;            // { propertyName, mapping? }
discriminatedUnion(prop: string, branches: StandardSchemaV1[],
                   opts?: DiscriminatedUnionOptions): StandardSchemaV1;`}
      />

      <h2 id="daloyjs-core-client">
        <code>@daloyjs/core/client</code>
      </h2>
      <CodeBlock
        code={`createClient<A extends App>(app: A, opts: ClientOptions): ClientFor<A>;
createInProcessClient<A extends App>(app: A, opts?: InProcessClientOptions): ClientFor<A>;

interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

interface InProcessClientOptions {
  baseUrl?: string; // default: http://daloy.local
  headers?: Record<string, string>;
}

// ClientFor<A> is keyed by operationId; each method takes
// { params?, query?, headers?, body? } and returns a discriminated union
// keyed by status: { status, body, headers }.
type ClientFor<A extends App>  = { /* generated from A["routes"] */ };
type RoutesOf<A extends App>   = A["routes"][number];`}
      />

      <h2 id="daloyjs-core-contract">
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

      <h2 id="daloyjs-core-mcp">
        <code>@daloyjs/core/mcp</code>
      </h2>
      <CodeBlock
        code={`const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_PROTOCOL_VERSIONS: readonly string[];
const MCP_DEFAULT_MAX_BODY_BYTES = 262144;

createMcpHandler(options: McpHandlerOptions): McpHandler;
mcpRoutes(path: PathString, handler: McpHandler, options?: McpRoutesOptions):
  RouteDefinition<PathString, "GET" | "POST" | "OPTIONS">[];
validateMcpInput(schema: McpJsonSchema, value: unknown): string[];
class McpToolError extends Error {}

type McpHandler = (request: Request) => Promise<Response>;
type McpJsonValue = null | boolean | number | string | McpJsonValue[] | { [key: string]: McpJsonValue };
type McpJsonObject = { [key: string]: McpJsonValue };
type McpJsonSchema = McpJsonObject;
type McpJsonRpcId = string | number | null;

interface McpRoutesOptions {
  public?: boolean;  // default false; opt out of the production auth boot guard
}

interface McpHandlerOptions {
  serverInfo: McpServerInfo;
  instructions?: string;
  tools?: readonly McpTool[];
  resources?: readonly McpResourceDefinition[];
  resourceTemplates?: readonly McpResourceTemplateDefinition[];
  prompts?: readonly McpPromptDefinition[];
  allowedOrigins?: readonly string[];       // bare origins, plus optional "null"
  protocolVersions?: readonly string[];     // default MCP_PROTOCOL_VERSIONS
  preferredProtocolVersion?: string;        // default MCP_PROTOCOL_VERSION
  maxBodyBytes?: number;                    // default MCP_DEFAULT_MAX_BODY_BYTES
  headers?: Record<string, string>;
  exposeInternalErrors?: boolean;           // default NODE_ENV !== "production"
}

interface McpServerInfo {
  name: string;
  version: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  icons?: McpIcon[];
}

interface McpTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  title?: string;
  inputSchema: McpJsonSchema;
  outputSchema?: McpJsonSchema;
  annotations?: McpToolAnnotations;
  icons?: McpIcon[];
  handler: McpToolHandler<TArgs>;
}

type McpToolHandler<TArgs extends Record<string, unknown> = Record<string, unknown>> =
  (args: TArgs, ctx: McpRequestContext) =>
    string | McpToolResult | Promise<string | McpToolResult>;

interface McpToolResult {
  content?: McpContent[];
  structuredContent?: McpJsonObject;
  isError?: boolean;
}

interface McpRequestContext {
  request: Request;
  protocolVersion: string;
  id: McpJsonRpcId;
  method: string;
}

// tools/call arguments are validated against inputSchema before the handler runs.
// Schema violations return JSON-RPC -32602. Unsupported keywords such as
// pattern, format, $ref, anyOf, oneOf, and allOf are advertised but not enforced.
// In production secureDefaults apps, mcpRoutes() must be covered by an auth hook
// unless mounted with mcpRoutes(path, handler, { public: true }).`}
      />

      <h2 id="daloyjs-core-docs">
        <code>@daloyjs/core/docs</code>
      </h2>
      <CodeBlock
        code={`scalarHtml(opts: ScalarHtmlOptions): string;
swaggerUiHtml(opts: SwaggerUiHtmlOptions): string;
redocHtml(opts: RedocHtmlOptions): string;
docsContentSecurityPolicy(opts?: DocsContentSecurityPolicyOptions): string;
htmlResponse(html: string, opts?: HtmlResponseOptions): Response;

interface DocsOptions { specUrl: string; title?: string; assets?: DocsAssetOptions; scriptNonce?: string }
interface ScalarHtmlOptions extends DocsOptions { configuration?: ScalarReferenceConfiguration }
interface SwaggerUiHtmlOptions extends DocsOptions { configuration?: SwaggerUiConfiguration }
interface RedocHtmlOptions  extends DocsOptions { configuration?: RedocConfiguration }

interface DocsAssetOptions {
  // version-pinned URL + matching SRI hash per asset (see /docs/docs-asset-integrity)
  scalarScriptUrl?: string;       scalarScriptIntegrity?: string;
  swaggerUiCssUrl?: string;       swaggerUiCssIntegrity?: string;
  swaggerUiBundleUrl?: string;    swaggerUiBundleIntegrity?: string;
  redocScriptUrl?: string;        redocScriptIntegrity?: string;
  asyncapiScriptUrl?: string;     asyncapiScriptIntegrity?: string;
  asyncapiStyleUrl?: string;      asyncapiStyleIntegrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";  // default: "anonymous"
}

// RedocConfiguration is an index-signature bag of JSON-serializable Redoc
// standalone options (disableSearch, hideDownloadButtons, sortPropsAlphabetically,
// theme, ...), forwarded verbatim to Redoc.init(specUrl, configuration, element).

interface DocsContentSecurityPolicyOptions {
  assetOrigins?: readonly string[];
  connectOrigins?: readonly string[];
  scriptNonce?: string;
  allowInlineStyles?: boolean;
  allowBlobWorkers?: boolean;     // append worker-src 'self' blob: (Redoc needs it)
}

interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  contentSecurityPolicy?: string;
}`}
      />

      <h2 id="daloyjs-core-streaming">
        <code>@daloyjs/core/streaming</code>
      </h2>
      <CodeBlock
        code={`interface SSEMessage { data?: unknown; event?: string; id?: string; retry?: number; comment?: string }

sseStream  (source, opts?: SSEStreamOptions):   ReadableStream<Uint8Array>;
sseResponse(source, opts?: SSEResponseOptions): Response;
ndjsonStream  (source, opts?: StreamOptions):       ReadableStream<Uint8Array>;
ndjsonResponse(source, opts?: NDJSONResponseOptions): Response;

interface StreamOptions       { signal?: AbortSignal }
interface SSEStreamOptions    extends StreamOptions { keepAliveMs?: number }
interface SSEResponseOptions  extends SSEStreamOptions { status?: number; headers?: HeadersInit }
interface NDJSONResponseOptions extends StreamOptions { status?: number; headers?: HeadersInit }`}
      />

      <h2 id="daloyjs-core-multipart">
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

      <h2 id="daloyjs-core-websocket">
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

      <h2 id="daloyjs-core-tracing">
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

      <h2 id="daloyjs-core-rate-limit-redis">
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

      <h2 id="daloyjs-core-banner">
        <code>@daloyjs/core/banner</code>
      </h2>
      <CodeBlock
        code={`formatStartupBanner(opts: StartupBannerOptions): string;
printStartupBanner (opts: StartupBannerOptions): void;`}
      />

      <h2 id="daloyjs-core-cli">
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

      <p>
        Next up:{" "}
        <Link href={"/docs/api-reference/adapters" as Route}>
          runtime adapters</Link>
        {"."}
      </p>
    </>
  );
}
