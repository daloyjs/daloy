import { getAllDocPages, getDocPage } from "@/lib/docs-content";
import { rankDocPages, tokenize } from "@/lib/docs-ranking";
import { SITE_URL } from "@/lib/seo";

/**
 * Public Model Context Protocol (MCP) endpoint for the DaloyJS documentation.
 *
 * This is a zero-dependency, spec-compliant implementation of the MCP
 * **Streamable HTTP** transport (single `POST`/`GET` endpoint speaking
 * JSON-RPC 2.0). It is read-only and unauthenticated by design: every byte it
 * exposes is already public on https://daloyjs.dev/docs. Keeping it
 * dependency-free matches the framework's supply-chain posture (no
 * `@modelcontextprotocol/sdk`, no `zod` pulled into the marketing site).
 *
 * It advertises a single capability, `tools`, with three tools:
 * - `search_docs` - keyword search across every docs page.
 * - `get_doc` - read the full plain-text body of one page by route or slug.
 * - `list_docs` - enumerate every available docs page.
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 */

/** Protocol version this server negotiates against when it has a free choice. */
const PREFERRED_PROTOCOL_VERSION = "2025-11-25";

/**
 * MCP protocol revisions this endpoint understands. An incoming
 * `MCP-Protocol-Version` header outside this set is rejected with HTTP 400 as
 * required by the spec; extend this set when adopting a newer revision.
 */
const KNOWN_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

/** Identity reported in the `initialize` handshake. */
const SERVER_INFO = {
  name: "daloyjs-docs",
  title: "DaloyJS Documentation",
  version: "1.0.0",
} as const;

/** Free-text guidance returned to clients during `initialize`. */
const INSTRUCTIONS =
  "Read-only access to the DaloyJS documentation at https://daloyjs.dev/docs. " +
  "Use `search_docs` to find relevant pages by keyword, `get_doc` to read the " +
  'full text of a page by its route or slug (for example "routing" or ' +
  '"/docs/security"), and `list_docs` to browse every available page. When you ' +
  "answer from these docs, cite the page URL you used.";

/** Hard cap on the accepted request body (256 KiB). */
const MAX_BODY_BYTES = 1 << 18;
/** Hard cap on a search query string. */
const MAX_QUERY_LENGTH = 256;
/** Default number of search hits returned when the caller does not specify. */
const DEFAULT_SEARCH_LIMIT = 8;
/** Upper bound on search hits a caller may request. */
const MAX_SEARCH_LIMIT = 25;
/**
 * Cap on the body text returned by `get_doc`. Sized to serve the longest docs
 * pages in full, including the deliberately exhaustive Express migration guide
 * (the security compliance and API reference pages are the next largest), while
 * still bounding any single response. Pages longer than this are truncated with
 * a pointer to the full page URL. Raise this if a page legitimately grows past
 * it rather than letting agents receive a half-page answer.
 */
const MAX_DOC_BODY_CHARS = 64_000;

// JSON-RPC 2.0 error codes (https://www.jsonrpc.org/specification#error_object).
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/** A JSON-RPC id is a string, number, or null. */
type JsonRpcId = string | number | null;

/** Minimal shape of an inbound JSON-RPC message before validation. */
type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

/**
 * Permissive CORS headers. The endpoint serves only public documentation and
 * holds no cookies, credentials, or per-user state, so any origin (including
 * browser-based agents) may read it.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "access-control-max-age": "86400",
};

/**
 * Build a JSON HTTP response with consistent security and CORS headers.
 *
 * @param body - Value to serialize as the JSON body.
 * @param init - Optional status code and extra headers.
 * @returns The composed {@link Response}.
 */
function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Serialize a successful JSON-RPC result.
 *
 * @param id - The originating request id.
 * @param result - The method result payload.
 * @returns An HTTP 200 JSON-RPC response.
 */
function rpcResult(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

/**
 * Serialize a JSON-RPC error.
 *
 * @param id - The originating request id, or `null` for transport-level errors.
 * @param code - JSON-RPC error code.
 * @param message - Human-readable error message.
 * @param data - Optional structured error detail.
 * @param status - HTTP status code (defaults to 200 for protocol-level errors).
 * @returns The composed JSON-RPC error response.
 */
function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  status = 200
): Response {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) {
    error.data = data;
  }
  return jsonResponse({ jsonrpc: "2.0", id, error }, { status });
}

/**
 * Redact internal error detail in production, surface it in development. Mirrors
 * the framework's prod-mode error redaction posture.
 *
 * @param error - The thrown value.
 * @returns A small data object in dev, or `undefined` in production.
 */
function devErrorData(error: unknown): unknown {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }
  return { detail: error instanceof Error ? error.message : String(error) };
}

/** Static JSON-Schema tool catalog advertised via `tools/list`. */
const TOOLS = [
  {
    name: "search_docs",
    title: "Search DaloyJS docs",
    description:
      "Search the DaloyJS documentation by keyword and return the best-matching " +
      "pages with their title, route, description, and absolute URL.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords to search for, e.g. 'rate limit' or 'openapi client'.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: `Maximum number of results (1-${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_doc",
    title: "Read a DaloyJS doc page",
    description:
      "Return the full plain-text content of a single documentation page, " +
      'identified by its route or slug (for example "routing", "security", or ' +
      '"/docs/typed-client").',
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Page route or slug, e.g. "routing" or "/docs/security".',
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_docs",
    title: "List DaloyJS doc pages",
    description:
      "List every available DaloyJS documentation page with its title, route, " +
      "and description so you can pick one to read with get_doc.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

/** Fast membership check for protocol-level tool-name validation. */
const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((tool) => tool.name));

/** Thrown by a tool to signal a caller-correctable error (bad/missing input). */
class ToolError extends Error {}

/**
 * Absolute, canonical URL for a docs route.
 *
 * @param href - A `/docs/...` route.
 * @returns The fully-qualified URL on the canonical site origin.
 */
function absoluteUrl(href: string): string {
  return `${SITE_URL}${href}`;
}

/** Read a string argument from an MCP tool's `arguments` object. */
function readStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

/** Check whether a decoded JSON value is a valid JSON-RPC id. */
function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null || typeof value === "string" || typeof value === "number"
  );
}

/**
 * Execute `search_docs`.
 *
 * @param args - Tool arguments (`query`, optional `limit`).
 * @returns A human/LLM-readable ranked result list.
 * @throws {ToolError} When `query` is missing, empty, or `limit` is invalid.
 */
async function runSearchDocs(args: Record<string, unknown>): Promise<string> {
  const query = readStringArg(args, "query").trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length === 0) {
    throw new ToolError("`query` is required and must be a non-empty string.");
  }

  let limit = DEFAULT_SEARCH_LIMIT;
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isFinite(args.limit)) {
      throw new ToolError("`limit` must be a number.");
    }
    limit = Math.min(Math.max(Math.trunc(args.limit), 1), MAX_SEARCH_LIMIT);
  }

  if (tokenize(query).length === 0) {
    throw new ToolError("`query` must contain at least one alphanumeric term.");
  }

  const pages = await getAllDocPages();
  const ranked = rankDocPages(pages, query, limit);

  if (ranked.length === 0) {
    return `No documentation pages matched "${query}". Try broader keywords or use list_docs.`;
  }

  const lines = ranked.map(
    (entry, index) =>
      `${index + 1}. ${entry.page.title} (${entry.page.href})\n   ${entry.page.description}\n   ${absoluteUrl(entry.page.href)}`
  );
  return `Found ${ranked.length} result(s) for "${query}":\n\n${lines.join("\n\n")}`;
}

/**
 * Execute `get_doc`.
 *
 * @param args - Tool arguments (`path`).
 * @returns The page title, route, URL, and full (bounded) body text.
 * @throws {ToolError} When `path` is missing or matches no page.
 */
async function runGetDoc(args: Record<string, unknown>): Promise<string> {
  const pathArg = readStringArg(args, "path").trim();
  if (pathArg.length === 0) {
    throw new ToolError(
      '`path` is required, e.g. "routing" or "/docs/security".'
    );
  }

  const page = await getDocPage(pathArg);
  if (!page) {
    throw new ToolError(
      `No documentation page found for "${pathArg}". Use list_docs or search_docs to find valid routes.`
    );
  }

  const body =
    page.body.length > MAX_DOC_BODY_CHARS
      ? `${page.body.slice(0, MAX_DOC_BODY_CHARS)}\n\n[truncated; read the full page at ${absoluteUrl(page.href)}]`
      : page.body;

  return `# ${page.title}\n\nRoute: ${page.href}\nURL: ${absoluteUrl(page.href)}\n\n${body}`;
}

/**
 * Execute `list_docs`.
 *
 * @returns A bulleted list of every documentation page.
 */
async function runListDocs(): Promise<string> {
  const pages = await getAllDocPages();
  const lines = pages.map(
    (page) => `- ${page.title} (${page.href}): ${page.description}`
  );
  return `DaloyJS has ${pages.length} documentation pages:\n\n${lines.join("\n")}`;
}

/** Shape of an MCP `tools/call` result. */
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wrap text as an MCP tool error result (visible to the model for self-correction). */
function toolErrorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Dispatch and execute a single tool by name.
 *
 * Caller-correctable failures ({@link ToolError}) are returned as `isError`
 * tool results so the model can see and recover; unexpected failures propagate
 * to become a JSON-RPC internal error.
 *
 * @param name - Tool name.
 * @param args - Tool arguments object.
 * @returns The MCP tool result.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let text: string;
    switch (name) {
      case "search_docs":
        text = await runSearchDocs(args);
        break;
      case "get_doc":
        text = await runGetDoc(args);
        break;
      case "list_docs":
        text = await runListDocs();
        break;
      default:
        throw new Error(`Unknown tool passed validation: ${name}`);
    }
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (error instanceof ToolError) {
      return toolErrorResult(error.message);
    }
    throw error;
  }
}

/**
 * Route a validated JSON-RPC **request** (one carrying an id) to its handler.
 *
 * @param message - The validated JSON-RPC request.
 * @returns The JSON-RPC response.
 */
async function handleRpcRequest(message: JsonRpcMessage): Promise<Response> {
  const id = (message.id ?? null) as JsonRpcId;
  const method = message.method as string;
  const params = (message.params ?? {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : "";
      const protocolVersion = KNOWN_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : PREFERRED_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (name.length === 0) {
        return rpcError(
          id,
          INVALID_PARAMS,
          "Missing tool name in `params.name`."
        );
      }
      if (!TOOL_NAMES.has(name)) {
        return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      }
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        return rpcResult(id, await callTool(name, args));
      } catch (error) {
        return rpcError(
          id,
          INTERNAL_ERROR,
          "Tool execution failed.",
          devErrorData(error)
        );
      }
    }
    // Advertised capability set is tools-only; answer the optional list methods
    // with empty collections so probing clients do not error.
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * MCP Streamable HTTP `POST` handler: accepts one JSON-RPC request,
 * notification, or response per call.
 *
 * @param request - The inbound HTTP request.
 * @returns A JSON-RPC response (for requests), or `202 Accepted` (for
 *   notifications and responses).
 */
export async function POST(request: Request): Promise<Response> {
  // Transport-level: reject an unknown protocol-version header per the spec.
  const protocolHeader = request.headers.get("mcp-protocol-version");
  if (protocolHeader && !KNOWN_PROTOCOL_VERSIONS.has(protocolHeader)) {
    return rpcError(
      null,
      INVALID_REQUEST,
      `Unsupported MCP-Protocol-Version: ${protocolHeader}`,
      { supported: [...KNOWN_PROTOCOL_VERSIONS] },
      400
    );
  }

  // Body-size guard (header hint first, then the actual payload).
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return rpcError(
      null,
      INVALID_REQUEST,
      "Request body too large.",
      undefined,
      413
    );
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return rpcError(
      null,
      INVALID_REQUEST,
      "Request body too large.",
      undefined,
      413
    );
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
      400
    );
  }

  let message: JsonRpcMessage;
  try {
    message = JSON.parse(raw) as JsonRpcMessage;
  } catch {
    return rpcError(
      null,
      PARSE_ERROR,
      "Invalid JSON in request body.",
      undefined,
      400
    );
  }

  if (Array.isArray(message)) {
    return rpcError(
      null,
      INVALID_REQUEST,
      "JSON-RPC batch requests are not supported.",
      undefined,
      400
    );
  }

  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
    return rpcError(
      null,
      INVALID_REQUEST,
      "Request must be a JSON-RPC 2.0 message.",
      undefined,
      400
    );
  }

  if (message.id !== undefined && !isJsonRpcId(message.id)) {
    return rpcError(
      null,
      INVALID_REQUEST,
      "JSON-RPC id must be a string, number, or null.",
      undefined,
      400
    );
  }

  // A message without a method can only be a response to us. We never issue
  // server-to-client requests, so valid responses are simply acknowledged.
  if (message.method === undefined) {
    if (!("result" in message) && !("error" in message)) {
      return rpcError(
        null,
        INVALID_REQUEST,
        "JSON-RPC message is missing `method`, `result`, or `error`.",
        undefined,
        400
      );
    }
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (typeof message.method !== "string") {
    return rpcError(
      null,
      INVALID_REQUEST,
      "JSON-RPC method must be a string.",
      undefined,
      400
    );
  }

  // A message without an id is a notification (e.g. notifications/initialized).
  // Nothing to return per JSON-RPC; acknowledge with 202.
  if (message.id === undefined) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  try {
    return await handleRpcRequest(message);
  } catch (error) {
    return rpcError(
      message.id ?? null,
      INTERNAL_ERROR,
      "Internal server error.",
      devErrorData(error)
    );
  }
}

/**
 * MCP Streamable HTTP `GET` handler. This server does not offer a
 * server-initiated SSE stream, so per the spec it answers GET with `405`. The
 * JSON body is a convenience for humans and agents that open the URL directly.
 *
 * @returns An HTTP 405 response describing how to use the endpoint.
 */
export function GET(): Response {
  return jsonResponse(
    {
      name: SERVER_INFO.title,
      transport: "streamable-http",
      endpoint: `${SITE_URL}/mcp`,
      protocolVersions: [...KNOWN_PROTOCOL_VERSIONS],
      tools: TOOLS.map((tool) => tool.name),
      hint: "Send JSON-RPC 2.0 over HTTP POST to this URL. See https://daloyjs.dev/#mcp for setup.",
    },
    { status: 405, headers: { allow: "POST, OPTIONS" } }
  );
}

/**
 * CORS preflight handler for browser-based MCP clients.
 *
 * @returns An HTTP 204 response carrying the CORS headers.
 */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
