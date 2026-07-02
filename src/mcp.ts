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

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const MCP_JSON_RESPONSE_SCHEMA: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "daloyjs",
    validate: (value) => ({ value }),
  },
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
   * Protocol version selected for this call. Before `initialize`, this is the
   * version from the `MCP-Protocol-Version` header when present, otherwise the
   * handler's preferred protocol version.
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
  /** Human or model-readable content blocks returned to the MCP client. */
  content: McpContent[];
  /** Optional structured payload for clients that can consume typed output. */
  structuredContent?: McpJsonObject;
  /** Set to `true` for domain/tool errors the model may recover from. */
  isError?: boolean;
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
  /** Prompt arguments clients may supply to `prompts/get`. */
  arguments?: McpPromptArgument[];
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
  /** Reusable prompts exposed through `prompts/list` and `prompts/get`. */
  prompts?: readonly McpPromptDefinition[];
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

function normalizeToolResult(value: string | McpToolResult): McpToolResult {
  return typeof value === "string" ? { content: [{ type: "text", text: value }] } : value;
}

function selectedProtocolVersion(
  requested: string,
  supported: ReadonlySet<string>,
  preferred: string
): string {
  return supported.has(requested) ? requested : preferred;
}

/**
 * Create a dependency-free MCP Streamable HTTP endpoint handler.
 *
 * The handler implements the server side of MCP over one HTTP endpoint:
 * `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`,
 * `resources/read`, `prompts/list`, and `prompts/get`. It accepts JSON-RPC
 * requests over `POST`, acknowledges notifications with `202`, validates the
 * `MCP-Protocol-Version` header, bounds request bodies, and returns JSON-RPC
 * errors for malformed input.
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
  const prompts = options.prompts ?? [];
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const resourceMap = new Map(resources.map((resource) => [resource.uri, resource]));
  const promptMap = new Map(prompts.map((prompt) => [prompt.name, prompt]));

  if (toolMap.size !== tools.length) throw new TypeError("MCP tool names must be unique.");
  if (resourceMap.size !== resources.length)
    throw new TypeError("MCP resource URIs must be unique.");
  if (promptMap.size !== prompts.length) throw new TypeError("MCP prompt names must be unique.");

  const exposeInternalErrors =
    options.exposeInternalErrors ??
    (typeof process === "object" && process.env?.NODE_ENV !== "production");
  const headers = options.headers;

  async function handleRpcRequest(message: JsonRpcMessage, request: Request): Promise<Response> {
    const id = (message.id ?? null) as McpJsonRpcId;
    const method = message.method as string;
    const params = asRecord(message.params);
    const protocolVersion = selectedProtocolVersion(
      typeof params.protocolVersion === "string"
        ? params.protocolVersion
        : (request.headers.get("mcp-protocol-version") ?? ""),
      supported,
      preferred
    );
    const ctx: McpRequestContext = { request, protocolVersion, id, method };

    switch (method) {
      case "initialize":
        return rpcResult(
          id,
          {
            protocolVersion,
            capabilities: {
              ...(tools.length > 0 ? { tools: {} } : {}),
              ...(resources.length > 0 ? { resources: {} } : {}),
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
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        const resource = resourceMap.get(uri);
        if (!resource) {
          return rpcError(
            id,
            INVALID_PARAMS,
            `Unknown resource: ${uri || "<missing>"}`,
            undefined,
            200,
            headers
          );
        }
        try {
          const read = await resource.read(ctx);
          return rpcResult(id, { contents: Array.isArray(read) ? read : [read] }, headers);
        } catch (error) {
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
        }
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
        try {
          return rpcResult(id, await prompt.get(asRecord(params.arguments), ctx), headers);
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
