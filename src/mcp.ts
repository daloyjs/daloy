import type { PathString, RouteDefinition } from "./types.js";
import type { StandardSchemaV1 } from "./schema.js";

/**
 * Latest MCP protocol version DaloyJS negotiates by default.
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25
 * @since 1.0.0
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

/**
 * Protocol revisions accepted by {@link createMcpHandler} unless the caller
 * provides an explicit `protocolVersions` list.
 *
 * @since 1.0.0
 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

/**
 * Default maximum accepted JSON-RPC request body for a DaloyJS MCP endpoint.
 * The cap is intentionally small because MCP calls should carry parameters,
 * not bulk uploads. Raise it per endpoint when a real tool needs larger input.
 *
 * @since 1.0.0
 */
export const MCP_DEFAULT_MAX_BODY_BYTES = 1 << 18;

/**
 * Protocol revision assumed when an HTTP request carries no
 * `MCP-Protocol-Version` header, as required by the Streamable HTTP spec for
 * backwards compatibility with pre-2025-06-18 clients.
 */
const LEGACY_ASSUMED_PROTOCOL_VERSION = "2025-03-26";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/**
 * JSON Schema for the JSON-RPC 2.0 envelope every MCP response uses. Exposed
 * through `toJSONSchema()` so the generated OpenAPI document describes the
 * `/mcp` route honestly instead of leaving it an undocumented blind spot.
 */
const MCP_JSONRPC_ENVELOPE_JSON_SCHEMA = {
  type: "object",
  description: "JSON-RPC 2.0 envelope produced by the MCP Streamable HTTP endpoint.",
  properties: {
    jsonrpc: { type: "string", const: "2.0" },
    id: { oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
    result: { description: "Method result. Present on success; shape varies by MCP method." },
    error: {
      type: "object",
      properties: {
        code: { type: "integer" },
        message: { type: "string" },
        data: {},
      },
      required: ["code", "message"],
      additionalProperties: false,
    },
  },
  required: ["jsonrpc"],
} as const;

const MCP_JSON_RESPONSE_SCHEMA: StandardSchemaV1 & {
  toJSONSchema(): typeof MCP_JSONRPC_ENVELOPE_JSON_SCHEMA;
} = {
  "~standard": {
    version: 1,
    vendor: "daloyjs",
    // Pass-through: the MCP handler fully controls the envelope it builds, so
    // re-validating (or field-stripping) it here would only burn cycles.
    validate: (value) => ({ value }),
  },
  toJSONSchema: () => MCP_JSONRPC_ENVELOPE_JSON_SCHEMA,
};

/**
 * JSON value accepted in MCP schemas, structured results, and metadata.
 *
 * @since 1.0.0
 */
export type McpJsonValue =
  null | boolean | number | string | McpJsonValue[] | { [key: string]: McpJsonValue };

/**
 * JSON object used for MCP tool arguments and structured payloads.
 *
 * @since 1.0.0
 */
export type McpJsonObject = { [key: string]: McpJsonValue };

/**
 * JSON Schema fragment advertised to MCP clients for a tool or prompt
 * argument object. DaloyJS does not bundle a schema validator here, so the
 * schema is documentation and client-side guidance. Validate sensitive inputs
 * inside your handler before touching databases, files, or remote services.
 *
 * @since 1.0.0
 */
export type McpJsonSchema = McpJsonObject;

/**
 * JSON-RPC id type accepted by MCP requests.
 *
 * @since 1.0.0
 */
export type McpJsonRpcId = string | number | null;

/**
 * Icon metadata clients may render next to a server, tool, resource, or
 * prompt (MCP 2025-11-25, SEP-973).
 *
 * @since 1.0.0
 */
export interface McpIcon {
  /** Icon URL. Prefer `https:` or `data:` URIs that clients can fetch safely. */
  src: string;
  /** Optional icon media type, e.g. `"image/png"`. */
  mimeType?: string;
  /** Optional pixel sizes the icon is available in, e.g. `["48x48"]`. */
  sizes?: string[];
  /** Optional theme the icon is designed for. */
  theme?: "light" | "dark";
}

/**
 * Identity block returned from the MCP `initialize` handshake.
 *
 * @since 1.0.0
 */
export interface McpServerInfo {
  /** Stable machine-readable server name, for example `"acme-inventory-mcp"`. */
  name: string;
  /** Optional human-readable display title for MCP clients. */
  title?: string;
  /** Server version surfaced to clients for debugging and compatibility. */
  version: string;
  /** Optional human-readable server description (MCP 2025-11-25). */
  description?: string;
  /** Optional homepage URL for this server (MCP 2025-11-25). */
  websiteUrl?: string;
  /** Optional icons clients may display for this server (MCP 2025-11-25). */
  icons?: McpIcon[];
}

/**
 * Per-request context passed to tool, resource, and prompt handlers.
 *
 * @since 1.0.0
 */
export interface McpRequestContext {
  /** The original HTTP request received by the DaloyJS route. */
  request: Request;
  /**
   * Protocol version selected for this call. `initialize` negotiates it from
   * `params.protocolVersion`; other calls take the `MCP-Protocol-Version`
   * header, falling back to `2025-03-26` (the spec's assumption for
   * headerless requests) when supported, otherwise the preferred version.
   */
  protocolVersion: string;
  /** JSON-RPC id for request/response correlation. */
  id: McpJsonRpcId;
  /** Raw MCP method name, such as `"tools/call"` or `"resources/read"`. */
  method: string;
}

/**
 * Text content block returned from an MCP tool, resource, or prompt.
 *
 * @since 1.0.0
 */
export interface McpTextContent {
  /** Discriminator literal identifying this block as text. */
  type: "text";
  /** The plain-text payload of the block. */
  text: string;
}

/**
 * Image content block returned from an MCP tool.
 *
 * `data` is base64-encoded image bytes. Keep images small; for large assets,
 * return a resource link or URL-bearing text instead.
 *
 * @since 1.0.0
 */
export interface McpImageContent {
  /** Discriminator literal identifying this block as an image. */
  type: "image";
  /** Base64-encoded image bytes. */
  data: string;
  /** Image media type, e.g. `"image/png"`. */
  mimeType: string;
}

/**
 * Embedded resource content block returned from an MCP tool.
 *
 * @since 1.0.0
 */
export interface McpEmbeddedResourceContent {
  /** Discriminator literal identifying this block as an embedded resource. */
  type: "resource";
  /** The embedded resource contents (uri plus text or base64 blob). */
  resource: McpResourceContents;
}

/**
 * Content block supported by the dependency-free MCP helper.
 *
 * @since 1.0.0
 */
export type McpContent = McpTextContent | McpImageContent | McpEmbeddedResourceContent;

/**
 * Result returned by an MCP tool handler.
 *
 * `isError` marks caller-correctable tool failures, such as invalid input or a
 * domain error. Unexpected thrown errors become JSON-RPC internal errors and
 * are redacted in production.
 *
 * @since 1.0.0
 */
export interface McpToolResult {
  /**
   * Human or model-readable content blocks returned to the MCP client. When
   * omitted, {@link createMcpHandler} backfills a text block serializing
   * `structuredContent` so pre-2025-06-18 clients still receive output.
   */
  content?: McpContent[];
  /** Optional structured payload for clients that can consume typed output. */
  structuredContent?: McpJsonObject;
  /** Set to `true` for domain/tool errors the model may recover from. */
  isError?: boolean;
}

/**
 * Behavioral hints a tool can advertise to MCP clients. Hints are untrusted
 * metadata for UX decisions (confirmation prompts, badges); clients must not
 * rely on them for security decisions.
 *
 * @since 1.0.0
 */
export interface McpToolAnnotations {
  /** Human-readable title for the tool. */
  title?: string;
  /** Hint that the tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** Hint that the tool may perform destructive updates. */
  destructiveHint?: boolean;
  /** Hint that repeated calls with the same arguments have no extra effect. */
  idempotentHint?: boolean;
  /** Hint that the tool interacts with external entities. */
  openWorldHint?: boolean;
}

/**
 * Handler for a single MCP tool.
 *
 * @typeParam TArgs - Type expected in `params.arguments` for this tool.
 * @param args - Tool arguments supplied by the MCP client. They are typed for
 *   developer experience but are still untrusted JSON at runtime.
 * @param ctx - Request metadata and the original HTTP request.
 * @returns Text shorthand or a full {@link McpToolResult}.
 * @throws {McpToolError} for caller-correctable failures that should be
 *   returned as an MCP tool error result.
 *
 * @since 1.0.0
 */
export type McpToolHandler<TArgs extends Record<string, unknown> = Record<string, unknown>> = (
  args: TArgs,
  ctx: McpRequestContext
) => string | McpToolResult | Promise<string | McpToolResult>;

/**
 * Definition of a callable MCP tool.
 *
 * Tools are model-controlled in MCP: clients may let the language model decide
 * when to call them. Treat every tool as a public API operation and enforce
 * authentication, authorization, rate limits, and validation before side
 * effects.
 *
 * @typeParam TArgs - Type expected by this tool's handler.
 * @since 1.0.0
 */
export interface McpTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique tool name within this MCP server. Prefer namespaced verbs. */
  name: string;
  /** Optional human-readable title displayed by clients. */
  title?: string;
  /** Clear description of when the model should use this tool. */
  description: string;
  /** JSON Schema for `params.arguments`. */
  inputSchema: McpJsonSchema;
  /**
   * Optional JSON Schema describing `structuredContent` in tool results
   * (MCP 2025-06-18). When set, handlers should return `structuredContent`
   * matching it.
   */
  outputSchema?: McpJsonSchema;
  /** Optional behavioral hints for clients. */
  annotations?: McpToolAnnotations;
  /** Optional icons clients may display for this tool (MCP 2025-11-25). */
  icons?: McpIcon[];
  /** Execute the tool with untrusted JSON arguments. */
  handler: McpToolHandler<TArgs>;
}

/**
 * Resource metadata returned from `resources/list`.
 *
 * @since 1.0.0
 */
export interface McpResource {
  /** Unique resource URI, for example `"daloy://schema/inventory"`. */
  uri: string;
  /** Stable resource name. */
  name: string;
  /** Optional human-readable title. */
  title?: string;
  /** Optional description shown by clients. */
  description?: string;
  /** MIME type returned by `resources/read`, such as `"application/json"`. */
  mimeType?: string;
  /** Optional icons clients may display for this resource (MCP 2025-11-25). */
  icons?: McpIcon[];
}

/**
 * Resource payload returned from `resources/read`.
 *
 * Use either `text` for UTF-8 content or `blob` for base64-encoded binary
 * content. Set `mimeType` so clients know how to present the resource.
 *
 * @since 1.0.0
 */
export interface McpResourceContents {
  /** URI of the resource being returned. */
  uri: string;
  /** MIME type of the returned content. */
  mimeType?: string;
  /** UTF-8 text content. */
  text?: string;
  /** Base64-encoded binary content. */
  blob?: string;
}

/**
 * Definition of a readable MCP resource.
 *
 * Resources are application-controlled context. They are a good fit for
 * schemas, read-only records, catalogs, runbooks, and other context a client
 * can choose to include before a tool call.
 *
 * @since 1.0.0
 */
export interface McpResourceDefinition extends McpResource {
  /**
   * Read the resource contents for `resources/read`.
   *
   * @param ctx - Request metadata and the original HTTP request.
   * @returns One or more content entries for this resource.
   */
  read: (
    ctx: McpRequestContext
  ) =>
    | McpResourceContents
    | McpResourceContents[]
    | Promise<McpResourceContents | McpResourceContents[]>;
}

/**
 * Resource template metadata returned from `resources/templates/list`.
 *
 * @since 1.0.0
 */
export interface McpResourceTemplate {
  /**
   * URI template for this resource family, e.g. `"daloy://records/{id}"`.
   * DaloyJS supports simple `{name}` variables (RFC 6570 level 1); each
   * variable matches one URI segment (no `/`).
   */
  uriTemplate: string;
  /** Stable template name. */
  name: string;
  /** Optional human-readable title. */
  title?: string;
  /** Optional description shown by clients. */
  description?: string;
  /** MIME type of resources produced by this template. */
  mimeType?: string;
  /** Optional icons clients may display for this template (MCP 2025-11-25). */
  icons?: McpIcon[];
}

/**
 * Definition of a parameterized MCP resource template.
 *
 * Templates answer `resources/read` for URIs that match `uriTemplate` but are
 * not listed as concrete resources. Template variables arrive as raw URI
 * segment strings; validate them before touching databases or files.
 *
 * @since 1.0.0
 */
export interface McpResourceTemplateDefinition extends McpResourceTemplate {
  /**
   * Read a resource instantiated from this template for `resources/read`.
   *
   * @param uri - The full resource URI requested by the client.
   * @param variables - Template variable values extracted from `uri`.
   * @param ctx - Request metadata and the original HTTP request.
   * @returns One or more content entries for this resource.
   * @throws {McpToolError} for caller-correctable failures such as an unknown
   *   record id; these become JSON-RPC invalid-params errors.
   */
  read: (
    uri: string,
    variables: Record<string, string>,
    ctx: McpRequestContext
  ) =>
    | McpResourceContents
    | McpResourceContents[]
    | Promise<McpResourceContents | McpResourceContents[]>;
}

/**
 * Argument metadata for an MCP prompt.
 *
 * @since 1.0.0
 */
export interface McpPromptArgument {
  /** Argument name accepted by the prompt. */
  name: string;
  /** Optional description displayed by clients. */
  description?: string;
  /** Whether the argument is required. */
  required?: boolean;
}

/**
 * Prompt metadata returned from `prompts/list`.
 *
 * @since 1.0.0
 */
export interface McpPrompt {
  /** Unique prompt name within this MCP server. */
  name: string;
  /** Optional human-readable title. */
  title?: string;
  /** Optional prompt description. */
  description?: string;
  /**
   * Prompt arguments clients may supply to `prompts/get`. Arguments marked
   * `required: true` are enforced by {@link createMcpHandler}: a `prompts/get`
   * call missing one fails with a JSON-RPC invalid-params error.
   */
  arguments?: McpPromptArgument[];
  /** Optional icons clients may display for this prompt (MCP 2025-11-25). */
  icons?: McpIcon[];
}

/**
 * Message returned from `prompts/get`.
 *
 * @since 1.0.0
 */
export interface McpPromptMessage {
  /** Role that should receive the prompt content. */
  role: "user" | "assistant";
  /** Prompt content block. */
  content: McpTextContent | McpImageContent | McpEmbeddedResourceContent;
}

/**
 * Result returned by an MCP prompt handler.
 *
 * @since 1.0.0
 */
export interface McpPromptResult {
  /** Optional description of the rendered prompt. */
  description?: string;
  /** Messages the client can inject into the model conversation. */
  messages: McpPromptMessage[];
}

/**
 * Definition of a reusable MCP prompt.
 *
 * @since 1.0.0
 */
export interface McpPromptDefinition extends McpPrompt {
  /**
   * Render the prompt for `prompts/get`.
   *
   * @param args - Prompt arguments supplied by the MCP client.
   * @param ctx - Request metadata and the original HTTP request.
   * @returns Prompt messages.
   */
  get: (
    args: Record<string, unknown>,
    ctx: McpRequestContext
  ) => McpPromptResult | Promise<McpPromptResult>;
}

/**
 * Caller-correctable MCP tool/resource/prompt error.
 *
 * Throw this when the model supplied bad arguments, referenced a missing
 * domain object, or otherwise made a recoverable call. Tool errors become
 * `{ isError: true }` tool results; resource and prompt errors become
 * JSON-RPC invalid-params errors. Unexpected errors are treated as internal
 * server failures and are redacted in production.
 *
 * @since 1.0.0
 */
export class McpToolError extends Error {
  /**
   * Create a recoverable MCP handler error.
   *
   * @param message - Safe, caller-visible explanation.
   */
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

/**
 * Options for {@link createMcpHandler}.
 *
 * @since 1.0.0
 */
export interface McpHandlerOptions {
  /** Server identity returned from the `initialize` handshake. */
  serverInfo: McpServerInfo;
  /** Optional guidance returned from `initialize`. */
  instructions?: string;
  /** Callable tools exposed through `tools/list` and `tools/call`. */
  tools?: readonly McpTool[];
  /** Readable resources exposed through `resources/list` and `resources/read`. */
  resources?: readonly McpResourceDefinition[];
  /**
   * Parameterized resource templates exposed through
   * `resources/templates/list` and matched by `resources/read` when a URI is
   * not a listed concrete resource.
   */
  resourceTemplates?: readonly McpResourceTemplateDefinition[];
  /** Reusable prompts exposed through `prompts/list` and `prompts/get`. */
  prompts?: readonly McpPromptDefinition[];
  /**
   * Extra `Origin` header values allowed on MCP requests, e.g.
   * `"https://app.example.com"` (or the literal `"null"` for opaque origins).
   *
   * The MCP Streamable HTTP spec requires servers to validate `Origin` to
   * prevent DNS rebinding attacks. DaloyJS always allows requests without an
   * `Origin` header (non-browser MCP clients), same-origin requests, and
   * loopback origins (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`); every
   * other origin is rejected with `403` unless listed here.
   */
  allowedOrigins?: readonly string[];
  /** Accepted MCP protocol versions. Defaults to {@link MCP_PROTOCOL_VERSIONS}. */
  protocolVersions?: readonly string[];
  /**
   * Protocol version returned when the client asks for an unsupported version.
   * Defaults to {@link MCP_PROTOCOL_VERSION}.
   */
  preferredProtocolVersion?: string;
  /** Maximum accepted JSON-RPC body size in bytes. Defaults to 256 KiB. */
  maxBodyBytes?: number;
  /**
   * Extra headers added to every JSON response. Use this for endpoint-local
   * cache, CORS, or deployment metadata. Authentication should usually live in
   * DaloyJS middleware before the MCP route.
   */
  headers?: Record<string, string>;
  /**
   * Include development error details in JSON-RPC internal errors. Defaults to
   * `process.env.NODE_ENV !== "production"` when `process` exists.
   */
  exposeInternalErrors?: boolean;
}

/**
 * Fetch-compatible handler returned by {@link createMcpHandler}.
 *
 * @param request - Incoming HTTP request for the MCP endpoint.
 * @returns A standard `Response` containing a JSON-RPC response, `202` for
 *   accepted notifications, or `405` for unsupported HTTP methods.
 *
 * @since 1.0.0
 */
export type McpHandler = (request: Request) => Promise<Response>;

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

function isJsonRpcId(value: unknown): value is McpJsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function rpcResult(
  id: McpJsonRpcId,
  result: unknown,
  extraHeaders?: Record<string, string>
): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result }, 200, extraHeaders);
}

function rpcError(
  id: McpJsonRpcId,
  code: number,
  message: string,
  data: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return jsonResponse({ jsonrpc: "2.0", id, error }, status, extraHeaders);
}

function safeInternalErrorData(error: unknown, expose: boolean): unknown {
  if (!expose) return undefined;
  return { detail: error instanceof Error ? error.message : String(error) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publicTool(tool: McpTool): Omit<McpTool, "handler"> {
  const { handler: _handler, ...rest } = tool;
  return rest;
}

function publicResource(resource: McpResourceDefinition): McpResource {
  const { read: _read, ...rest } = resource;
  return rest;
}

function publicPrompt(prompt: McpPromptDefinition): McpPrompt {
  const { get: _get, ...rest } = prompt;
  return rest;
}

function publicResourceTemplate(template: McpResourceTemplateDefinition): McpResourceTemplate {
  const { read: _read, ...rest } = template;
  return rest;
}

function normalizeToolResult(value: string | McpToolResult): McpToolResult {
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  if (value.content && value.content.length > 0) return value;
  // Backwards compatibility: clients that predate `structuredContent` only
  // read `content`, so mirror the structured payload into a text block.
  const content: McpContent[] =
    value.structuredContent !== undefined
      ? [{ type: "text", text: JSON.stringify(value.structuredContent) }]
      : [];
  return { ...value, content };
}

function selectedProtocolVersion(
  requested: string,
  supported: ReadonlySet<string>,
  preferred: string
): string {
  return supported.has(requested) ? requested : preferred;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledUriTemplate {
  template: McpResourceTemplateDefinition;
  regex: RegExp;
  variables: string[];
}

/**
 * Compile a simple RFC 6570 level-1 URI template into a matcher. Each
 * `{name}` variable matches exactly one URI segment (`[^/]+`). Operators such
 * as `{+path}` or `{?query}` are rejected so the handler never advertises a
 * template it cannot match.
 */
function compileUriTemplate(template: McpResourceTemplateDefinition): CompiledUriTemplate {
  const { uriTemplate } = template;
  const variables: string[] = [];
  let pattern = "";
  let index = 0;
  while (index < uriTemplate.length) {
    const open = uriTemplate.indexOf("{", index);
    if (open === -1) {
      pattern += escapeRegExp(uriTemplate.slice(index));
      break;
    }
    pattern += escapeRegExp(uriTemplate.slice(index, open));
    const close = uriTemplate.indexOf("}", open);
    if (close === -1) {
      throw new TypeError(`MCP resource template "${uriTemplate}" has an unterminated "{".`);
    }
    const name = uriTemplate.slice(open + 1, close);
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new TypeError(
        `MCP resource template "${uriTemplate}" uses an unsupported expression "{${name}}"; ` +
          "only simple {name} variables are supported."
      );
    }
    variables.push(name);
    pattern += "([^/]+)";
    index = close + 1;
  }
  return { template, regex: new RegExp(`^${pattern}$`), variables };
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Streamable HTTP DNS-rebinding defense: decide whether a browser `Origin`
 * may talk to this MCP endpoint. Same-origin and loopback origins are always
 * allowed; anything else must be explicitly allowlisted.
 */
function isAllowedOrigin(
  origin: string,
  request: Request,
  allowlist: ReadonlySet<string>
): boolean {
  const normalized = origin.toLowerCase();
  if (allowlist.has(normalized)) return true;
  if (normalized === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  const hostname = parsed.hostname;
  if (LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) return true;
  try {
    return parsed.host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Create a dependency-free MCP Streamable HTTP endpoint handler.
 *
 * The handler implements the server side of MCP over one HTTP endpoint:
 * `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`,
 * `resources/templates/list`, `resources/read`, `prompts/list`, and
 * `prompts/get`. It accepts JSON-RPC requests over `POST`, acknowledges
 * notifications with `202`, validates the `MCP-Protocol-Version` header,
 * bounds request bodies, enforces required prompt arguments, and returns
 * JSON-RPC errors for malformed input.
 *
 * Security: per the Streamable HTTP spec's DNS-rebinding guidance, every
 * request bearing an `Origin` header is validated. Same-origin and loopback
 * origins pass; anything else is rejected with `403` unless listed in
 * {@link McpHandlerOptions.allowedOrigins}.
 *
 * It intentionally does not spawn stdio servers, manage OAuth metadata, keep
 * durable sessions, or open server-initiated SSE streams. Use DaloyJS
 * middleware for authentication and authorization, and run this on a dedicated
 * Daloy app when your MCP server has a different trust boundary than your REST
 * API.
 *
 * @param options - Server identity, capabilities, limits, and response headers.
 * @returns A Fetch-compatible request handler suitable for {@link mcpRoutes}
 *   or for direct use in any web-standard runtime.
 * @throws {TypeError} at construction for invalid serverInfo, protocol
 *   versions, body limits, duplicate names/URIs, malformed `allowedOrigins`
 *   entries, or unsupported URI template expressions.
 *
 * @example
 * ```ts
 * const mcp = createMcpHandler({
 *   serverInfo: { name: "inventory-mcp", version: "1.0.0" },
 *   tools: [
 *     {
 *       name: "inventory_lookup",
 *       description: "Look up inventory by SKU.",
 *       inputSchema: {
 *         type: "object",
 *         properties: { sku: { type: "string" } },
 *         required: ["sku"],
 *         additionalProperties: false,
 *       },
 *       handler: async ({ sku }) => `SKU ${sku} has 42 units.`,
 *     },
 *   ],
 * });
 * ```
 *
 * @since 1.0.0
 */
export function createMcpHandler(options: McpHandlerOptions): McpHandler {
  if (options.serverInfo.name.trim().length === 0) {
    throw new TypeError("MCP serverInfo.name is required.");
  }
  if (options.serverInfo.version.trim().length === 0) {
    throw new TypeError("MCP serverInfo.version is required.");
  }

  const protocolVersions = options.protocolVersions ?? MCP_PROTOCOL_VERSIONS;
  if (protocolVersions.length === 0) {
    throw new TypeError("MCP protocolVersions must contain at least one version.");
  }
  const preferred = options.preferredProtocolVersion ?? MCP_PROTOCOL_VERSION;
  const supported = new Set(protocolVersions);
  if (!supported.has(preferred)) {
    throw new TypeError("MCP preferredProtocolVersion must be listed in protocolVersions.");
  }

  const maxBodyBytes = options.maxBodyBytes ?? MCP_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("MCP maxBodyBytes must be a positive safe integer.");
  }

  const tools = options.tools ?? [];
  const resources = options.resources ?? [];
  const resourceTemplates = options.resourceTemplates ?? [];
  const prompts = options.prompts ?? [];
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const resourceMap = new Map(resources.map((resource) => [resource.uri, resource]));
  const promptMap = new Map(prompts.map((prompt) => [prompt.name, prompt]));

  if (toolMap.size !== tools.length) throw new TypeError("MCP tool names must be unique.");
  if (resourceMap.size !== resources.length)
    throw new TypeError("MCP resource URIs must be unique.");
  if (promptMap.size !== prompts.length) throw new TypeError("MCP prompt names must be unique.");
  if (new Set(resourceTemplates.map((template) => template.uriTemplate)).size !==
    resourceTemplates.length) {
    throw new TypeError("MCP resource template URIs must be unique.");
  }
  const compiledTemplates = resourceTemplates.map(compileUriTemplate);

  const allowedOrigins = new Set<string>();
  for (const entry of options.allowedOrigins ?? []) {
    const normalized = entry.toLowerCase();
    if (normalized === "null") {
      allowedOrigins.add(normalized);
      continue;
    }
    let parsed: URL | undefined;
    try {
      parsed = new URL(normalized);
    } catch {
      parsed = undefined;
    }
    if (!parsed || parsed.origin !== normalized) {
      throw new TypeError(
        `MCP allowedOrigins entry "${entry}" must be a bare origin such as "https://app.example.com".`
      );
    }
    allowedOrigins.add(normalized);
  }

  const exposeInternalErrors =
    options.exposeInternalErrors ??
    (typeof process === "object" && process.env?.NODE_ENV !== "production");
  const headers = options.headers;

  const legacyAssumed = supported.has(LEGACY_ASSUMED_PROTOCOL_VERSION)
    ? LEGACY_ASSUMED_PROTOCOL_VERSION
    : preferred;

  async function handleRpcRequest(message: JsonRpcMessage, request: Request): Promise<Response> {
    const id = (message.id ?? null) as McpJsonRpcId;
    const method = message.method as string;
    const params = asRecord(message.params);
    const headerVersion = request.headers.get("mcp-protocol-version");
    // Per the Streamable HTTP spec, a request without the header is assumed
    // to speak 2025-03-26; `initialize` negotiates via params instead.
    const protocolVersion =
      method === "initialize"
        ? selectedProtocolVersion(
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : (headerVersion ?? ""),
            supported,
            preferred
          )
        : headerVersion !== null
          ? selectedProtocolVersion(headerVersion, supported, preferred)
          : legacyAssumed;
    const ctx: McpRequestContext = { request, protocolVersion, id, method };

    const cursor = params.cursor;
    if (
      cursor !== undefined &&
      (method === "tools/list" ||
        method === "resources/list" ||
        method === "resources/templates/list" ||
        method === "prompts/list")
    ) {
      // This handler returns complete lists and never issues cursors, so any
      // client-supplied cursor is unknown by definition.
      return rpcError(id, INVALID_PARAMS, "Unknown pagination cursor.", undefined, 200, headers);
    }

    switch (method) {
      case "initialize":
        return rpcResult(
          id,
          {
            protocolVersion,
            capabilities: {
              ...(tools.length > 0 ? { tools: {} } : {}),
              ...(resources.length > 0 || resourceTemplates.length > 0 ? { resources: {} } : {}),
              ...(prompts.length > 0 ? { prompts: {} } : {}),
            },
            serverInfo: options.serverInfo,
            ...(options.instructions ? { instructions: options.instructions } : {}),
          },
          headers
        );
      case "ping":
        return rpcResult(id, {}, headers);
      case "tools/list":
        return rpcResult(id, { tools: tools.map(publicTool) }, headers);
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const tool = toolMap.get(name);
        if (!tool) {
          return rpcError(
            id,
            INVALID_PARAMS,
            `Unknown tool: ${name || "<missing>"}`,
            undefined,
            200,
            headers
          );
        }
        try {
          const result = await tool.handler(asRecord(params.arguments), ctx);
          return rpcResult(id, normalizeToolResult(result), headers);
        } catch (error) {
          if (error instanceof McpToolError) {
            return rpcResult(
              id,
              { content: [{ type: "text", text: error.message }], isError: true },
              headers
            );
          }
          return rpcError(
            id,
            INTERNAL_ERROR,
            "Tool execution failed.",
            safeInternalErrorData(error, exposeInternalErrors),
            200,
            headers
          );
        }
      }
      case "resources/list":
        return rpcResult(id, { resources: resources.map(publicResource) }, headers);
      case "resources/templates/list":
        return rpcResult(
          id,
          { resourceTemplates: resourceTemplates.map(publicResourceTemplate) },
          headers
        );
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        const readError = (error: unknown): Response => {
          const message = error instanceof McpToolError ? error.message : "Resource read failed.";
          const data =
            error instanceof McpToolError
              ? undefined
              : safeInternalErrorData(error, exposeInternalErrors);
          return rpcError(
            id,
            error instanceof McpToolError ? INVALID_PARAMS : INTERNAL_ERROR,
            message,
            data,
            200,
            headers
          );
        };
        const resource = resourceMap.get(uri);
        if (resource) {
          try {
            const read = await resource.read(ctx);
            return rpcResult(id, { contents: Array.isArray(read) ? read : [read] }, headers);
          } catch (error) {
            return readError(error);
          }
        }
        if (uri) {
          for (const compiled of compiledTemplates) {
            const match = compiled.regex.exec(uri);
            if (!match) continue;
            const variables: Record<string, string> = {};
            compiled.variables.forEach((name, position) => {
              variables[name] = match[position + 1] ?? "";
            });
            try {
              const read = await compiled.template.read(uri, variables, ctx);
              return rpcResult(id, { contents: Array.isArray(read) ? read : [read] }, headers);
            } catch (error) {
              return readError(error);
            }
          }
        }
        return rpcError(
          id,
          INVALID_PARAMS,
          `Unknown resource: ${uri || "<missing>"}`,
          undefined,
          200,
          headers
        );
      }
      case "prompts/list":
        return rpcResult(id, { prompts: prompts.map(publicPrompt) }, headers);
      case "prompts/get": {
        const name = typeof params.name === "string" ? params.name : "";
        const prompt = promptMap.get(name);
        if (!prompt) {
          return rpcError(
            id,
            INVALID_PARAMS,
            `Unknown prompt: ${name || "<missing>"}`,
            undefined,
            200,
            headers
          );
        }
        const promptArgs = asRecord(params.arguments);
        const missing = (prompt.arguments ?? [])
          .filter((argument) => argument.required && promptArgs[argument.name] === undefined)
          .map((argument) => argument.name);
        if (missing.length > 0) {
          return rpcError(
            id,
            INVALID_PARAMS,
            `Missing required prompt arguments: ${missing.join(", ")}`,
            undefined,
            200,
            headers
          );
        }
        try {
          return rpcResult(id, await prompt.get(promptArgs, ctx), headers);
        } catch (error) {
          const message =
            error instanceof McpToolError ? error.message : "Prompt rendering failed.";
          const data =
            error instanceof McpToolError
              ? undefined
              : safeInternalErrorData(error, exposeInternalErrors);
          return rpcError(
            id,
            error instanceof McpToolError ? INVALID_PARAMS : INTERNAL_ERROR,
            message,
            data,
            200,
            headers
          );
        }
      }
      default:
        return rpcError(
          id,
          METHOD_NOT_FOUND,
          `Method not found: ${method}`,
          undefined,
          200,
          headers
        );
    }
  }

  return async function handleMcpRequest(request: Request): Promise<Response> {
    // Streamable HTTP requires Origin validation on every request to defeat
    // DNS rebinding; invalid browser origins are refused with 403.
    const origin = request.headers.get("origin");
    if (origin !== null && !isAllowedOrigin(origin, request, allowedOrigins)) {
      return rpcError(
        null,
        INVALID_REQUEST,
        "Origin is not allowed for this MCP endpoint.",
        undefined,
        403,
        headers
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { allow: "GET, POST, OPTIONS", ...(headers ?? {}) },
      });
    }

    if (request.method === "GET") {
      return jsonResponse(
        {
          transport: "streamable-http",
          protocolVersions,
          capabilities: {
            tools: tools.map((tool) => tool.name),
            resources: resources.map((resource) => resource.uri),
            resourceTemplates: resourceTemplates.map((template) => template.uriTemplate),
            prompts: prompts.map((prompt) => prompt.name),
          },
          hint: "Send JSON-RPC 2.0 over HTTP POST to this endpoint.",
        },
        405,
        { allow: "POST, OPTIONS", ...(headers ?? {}) }
      );
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "MCP Streamable HTTP endpoints accept POST requests." }, 405, {
        allow: "POST, OPTIONS",
        ...(headers ?? {}),
      });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return rpcError(
        null,
        INVALID_REQUEST,
        "MCP POST requests must use application/json.",
        undefined,
        415,
        headers
      );
    }

    const protocolHeader = request.headers.get("mcp-protocol-version");
    if (protocolHeader && !supported.has(protocolHeader)) {
      return rpcError(
        null,
        INVALID_REQUEST,
        `Unsupported MCP-Protocol-Version: ${protocolHeader}`,
        { supported: protocolVersions },
        400,
        headers
      );
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return rpcError(null, INVALID_REQUEST, "Request body too large.", undefined, 413, headers);
    }

    const body = await request.arrayBuffer();
    if (body.byteLength > maxBodyBytes) {
      return rpcError(null, INVALID_REQUEST, "Request body too large.", undefined, 413, headers);
    }

    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return rpcError(
        null,
        PARSE_ERROR,
        "Request body must be valid UTF-8.",
        undefined,
        400,
        headers
      );
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return rpcError(null, PARSE_ERROR, "Invalid JSON in request body.", undefined, 400, headers);
    }

    if (Array.isArray(message)) {
      return rpcError(
        null,
        INVALID_REQUEST,
        "JSON-RPC batch requests are not supported.",
        undefined,
        400,
        headers
      );
    }
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      return rpcError(
        null,
        INVALID_REQUEST,
        "Request must be a JSON-RPC 2.0 message.",
        undefined,
        400,
        headers
      );
    }
    if (message.id !== undefined && !isJsonRpcId(message.id)) {
      return rpcError(
        null,
        INVALID_REQUEST,
        "JSON-RPC id must be a string, number, or null.",
        undefined,
        400,
        headers
      );
    }
    if (message.method === undefined) {
      if (!("result" in message) && !("error" in message)) {
        return rpcError(
          null,
          INVALID_REQUEST,
          "JSON-RPC message is missing `method`, `result`, or `error`.",
          undefined,
          400,
          headers
        );
      }
      return new Response(null, { status: 202, headers });
    }
    if (typeof message.method !== "string") {
      return rpcError(
        null,
        INVALID_REQUEST,
        "JSON-RPC method must be a string.",
        undefined,
        400,
        headers
      );
    }
    if (message.id === undefined) {
      return new Response(null, { status: 202, headers });
    }

    try {
      return await handleRpcRequest(message, request);
    } catch (error) {
      return rpcError(
        message.id,
        INTERNAL_ERROR,
        "Internal server error.",
        safeInternalErrorData(error, exposeInternalErrors),
        200,
        headers
      );
    }
  };
}

/**
 * Build the Daloy route definitions for a Streamable HTTP MCP endpoint.
 *
 * Register each returned route on the Daloy app that should host MCP. A
 * separate app is often the cleanest production shape: the REST API can keep
 * its public contract and auth policy, while the MCP server can use its own
 * bearer token, rate limit, network allowlist, and tool set.
 *
 * @param path - Public MCP endpoint path, usually `"/mcp"`.
 * @param handler - Handler returned by {@link createMcpHandler}.
 * @returns Route definitions for `POST`, `GET`, and `OPTIONS` on the same
 *   path. `POST` is the actual MCP transport; `GET` gives a human-readable
 *   405 hint because this helper does not open server-initiated SSE streams;
 *   `OPTIONS` supports preflight when CORS middleware is installed.
 *
 * @example
 * ```ts
 * const app = new App();
 * const mcp = createMcpHandler({ serverInfo, tools });
 *
 * for (const route of mcpRoutes("/mcp", mcp)) {
 *   app.route(route);
 * }
 * ```
 *
 * @since 1.0.0
 */
export function mcpRoutes(
  path: PathString,
  handler: McpHandler
): RouteDefinition<PathString, "GET" | "POST" | "OPTIONS">[] {
  const responses = {
    200: { description: "MCP JSON-RPC response", body: MCP_JSON_RESPONSE_SCHEMA },
    202: { description: "MCP notification accepted", body: MCP_JSON_RESPONSE_SCHEMA },
    204: { description: "CORS preflight accepted" },
    400: { description: "Invalid MCP request" },
    403: { description: "Origin not allowed" },
    405: { description: "Unsupported MCP transport method" },
    413: { description: "MCP request body too large" },
  };

  return [
    {
      method: "POST",
      path,
      operationId: "mcpPost",
      summary: "MCP Streamable HTTP endpoint",
      responses,
      handler: ({ request }) => handler(request),
    },
    {
      method: "GET",
      path,
      operationId: "mcpGet",
      summary: "MCP Streamable HTTP discovery hint",
      responses,
      handler: ({ request }) => handler(request),
    },
    {
      method: "OPTIONS",
      path,
      operationId: "mcpOptions",
      summary: "MCP Streamable HTTP preflight",
      responses,
      handler: ({ request }) => handler(request),
    },
  ];
}
