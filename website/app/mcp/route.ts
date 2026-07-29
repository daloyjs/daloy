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
 * It serves both MCP protocol eras on the one endpoint, mirroring
 * `createMcpHandler()` in `@daloyjs/core`: the stateless `2026-07-28` revision
 * (per-request `_meta`, `server/discover`, `resultType` results, caching hints)
 * and the older handshake-based revisions, so existing clients keep working.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */

/**
 * Newest revision a legacy `initialize` handshake may be answered with.
 *
 * A handshake must never be answered with a modern revision: the client would
 * then be expected to send per-request `_meta` it knows nothing about. Modern
 * clients never reach `initialize` — they use `server/discover` or just send a
 * request.
 */
const LEGACY_FALLBACK_PROTOCOL_VERSION = "2025-11-25";

/**
 * First revision of the stateless ("modern") MCP era. Revisions are
 * `YYYY-MM-DD`, so a lexicographic compare classifies every past and future one.
 */
const MODERN_ERA_MIN_VERSION = "2026-07-28";

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
  "2026-07-28",
]);

/** Reserved `_meta` keys carrying per-request protocol metadata (2026-07-28). */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/**
 * Client caching hints returned on cacheable modern results.
 *
 * `"public"` is correct *here* specifically: this endpoint is unauthenticated
 * and read-only, so every caller sees an identical tool list and there is no
 * per-credential variation for a shared cache to leak. An authenticated MCP
 * server must not copy this value — `@daloyjs/core` defaults to `"private"` for
 * exactly that reason.
 */
const CACHE_TTL_MS = 300_000;
const CACHE_SCOPE = "public";

/** Protocol revisions that use per-request metadata instead of a handshake. */
function isModernProtocolVersion(version: string): boolean {
  return version >= MODERN_ERA_MIN_VERSION;
}

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
// Codes the MCP specification defines in its reserved -32020..-32099 sub-range.
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** Protocol era a request was served under. */
type ProtocolEra = "modern" | "legacy";

const HEADER_BASE64_PREFIX = "=?base64?";
const HEADER_BASE64_SUFFIX = "?=";

/**
 * Decode a header value that may use the `2026-07-28` Base64 sentinel form
 * `=?base64?<payload>?=`, which clients must use when a tool name or resource
 * URI cannot be represented as a plain ASCII header value.
 *
 * @param raw - The raw HTTP header value.
 * @returns The decoded value, or `undefined` when the sentinel wrapper is
 *   present but its payload is not valid Base64-encoded UTF-8.
 */
function decodeMcpHeaderValue(raw: string): string | undefined {
  if (
    !raw.startsWith(HEADER_BASE64_PREFIX) ||
    !raw.endsWith(HEADER_BASE64_SUFFIX)
  ) {
    return raw;
  }
  const encoded = raw.slice(
    HEADER_BASE64_PREFIX.length,
    raw.length - HEADER_BASE64_SUFFIX.length
  );
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Keys that let a JSON payload reach `Object.prototype`. Stripped from every
 * nested object while parsing, matching `safeJsonParse()` in `@daloyjs/core`.
 */
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Structural caps on an inbound payload, mirroring the `safeJsonParseLimited()`
 * defaults in `@daloyjs/core`. The body cap alone does not bound *shape*: 256
 * KiB is ample room for pathological nesting or key counts.
 */
const MAX_JSON_DEPTH = 50;
const MAX_JSON_KEYS = 10_000;

/** Raised when a payload is structurally abusive rather than merely malformed. */
class JsonStructureError extends Error {}

/**
 * Reject wide or deeply nested JSON before handing it to `JSON.parse`.
 *
 * Scans the raw text rather than the parsed value, so an abusive payload is
 * refused without ever being materialized. String contents are skipped so
 * braces and colons inside string literals never count.
 *
 * @param text - The raw request body.
 * @throws {JsonStructureError} When nesting or key count exceeds the caps.
 */
function assertJsonStructure(text: string): void {
  let depth = 0;
  let keys = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new JsonStructureError(
          "JSON nesting exceeds the permitted depth."
        );
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
    } else if (char === ":") {
      keys += 1;
      if (keys > MAX_JSON_KEYS) {
        throw new JsonStructureError("JSON payload has too many keys.");
      }
    }
  }
}

/**
 * Parse an untrusted JSON body with the same posture as the framework's own
 * body parsers: structural caps first, then prototype-pollution keys stripped
 * from every nested object.
 *
 * @param text - The raw request body.
 * @returns The parsed value with `__proto__` / `constructor` / `prototype` removed.
 * @throws {JsonStructureError} When the payload is structurally abusive.
 * @throws {SyntaxError} When the payload is not valid JSON.
 */
function safeJsonParse(text: string): unknown {
  assertJsonStructure(text);
  return JSON.parse(text, (key, value) =>
    FORBIDDEN_JSON_KEYS.has(key) ? undefined : value
  );
}

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
  // Mcp-Method / Mcp-Name are REQUIRED on 2026-07-28 requests, so a
  // browser-based client cannot talk to us at all unless preflight allows them.
  "access-control-allow-headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
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
 * Validate the `Mcp-Method` / `Mcp-Name` headers against the request body.
 *
 * These headers exist so intermediaries can route and inspect requests without
 * parsing the body; letting one disagree with the body is what turns that
 * convenience into a confused-deputy bug.
 *
 * `require` is `true` for modern requests, where both headers are mandatory. It
 * is `false` for legacy requests, which predate them — but a legacy request that
 * *does* send them is still held to them, so declaring an old protocol version
 * is not a free bypass. This is stricter than the specification requires, and
 * matches `@daloyjs/core`.
 *
 * @param request - The inbound HTTP request.
 * @param method - The JSON-RPC method from the body.
 * @param params - The JSON-RPC params from the body.
 * @param id - The originating request id.
 * @param require - Whether the headers are mandatory.
 * @returns A JSON-RPC error response, or `undefined` when the headers agree.
 */
function validateStandardHeaders(
  request: Request,
  method: string,
  params: Record<string, unknown>,
  id: JsonRpcId,
  require: boolean
): Response | undefined {
  const mismatch = (message: string): Response =>
    rpcError(id, HEADER_MISMATCH, message, undefined, 400);

  const headerMethod = request.headers.get("mcp-method");
  if (headerMethod === null) {
    if (require) return mismatch("Missing required header: Mcp-Method");
  } else if (headerMethod !== method) {
    return mismatch(
      `Header mismatch: Mcp-Method header value '${headerMethod}' does not match body value '${method}'`
    );
  }

  // Mcp-Name mirrors params.name on tools/call (this server exposes no
  // resources or prompts, so those methods never carry a name).
  if (method === "tools/call") {
    const rawName = request.headers.get("mcp-name");
    if (rawName === null) {
      if (require) return mismatch("Missing required header: Mcp-Name");
      return undefined;
    }
    const decoded = decodeMcpHeaderValue(rawName);
    if (decoded === undefined) {
      return mismatch(
        "Header mismatch: Mcp-Name is not valid Base64-encoded UTF-8"
      );
    }
    if (typeof params.name !== "string" || decoded !== params.name) {
      return mismatch(
        "Header mismatch: Mcp-Name header value does not match the request body"
      );
    }
  }

  return undefined;
}

/**
 * Enforce the 2026-07-28 per-request contract: the required `_meta` fields and
 * the standard headers that intermediaries may route on.
 *
 * @param request - The inbound HTTP request.
 * @param method - The JSON-RPC method from the body.
 * @param params - The JSON-RPC params from the body.
 * @param id - The originating request id.
 * @returns A JSON-RPC error response, or `undefined` when the request is valid.
 */
function validateModernRequest(
  request: Request,
  method: string,
  params: Record<string, unknown>,
  id: JsonRpcId
): Response | undefined {
  const meta =
    params._meta &&
    typeof params._meta === "object" &&
    !Array.isArray(params._meta)
      ? (params._meta as Record<string, unknown>)
      : {};

  const metaVersion = meta[META_PROTOCOL_VERSION];
  if (typeof metaVersion !== "string") {
    return rpcError(
      id,
      INVALID_PARAMS,
      `Missing required _meta field "${META_PROTOCOL_VERSION}".`,
      undefined,
      400
    );
  }
  if (!KNOWN_PROTOCOL_VERSIONS.has(metaVersion)) {
    return rpcError(
      id,
      UNSUPPORTED_PROTOCOL_VERSION,
      `Unsupported protocol version: ${metaVersion}`,
      { supported: [...KNOWN_PROTOCOL_VERSIONS], requested: metaVersion },
      400
    );
  }
  const capabilities = meta[META_CLIENT_CAPABILITIES];
  if (
    capabilities === null ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  ) {
    return rpcError(
      id,
      INVALID_PARAMS,
      `Missing required _meta field "${META_CLIENT_CAPABILITIES}".`,
      undefined,
      400
    );
  }

  const headerVersion = request.headers.get("mcp-protocol-version");
  if (headerVersion === null) {
    return rpcError(
      id,
      HEADER_MISMATCH,
      "Missing required header: MCP-Protocol-Version",
      undefined,
      400
    );
  }
  if (headerVersion !== metaVersion) {
    return rpcError(
      id,
      HEADER_MISMATCH,
      `Header mismatch: MCP-Protocol-Version header value '${headerVersion}' does not match body value '${metaVersion}'`,
      undefined,
      400
    );
  }

  return validateStandardHeaders(request, method, params, id, true);
}

/**
 * Route a validated JSON-RPC **request** (one carrying an id) to its handler.
 *
 * @param message - The validated JSON-RPC request.
 * @param request - The inbound HTTP request, for header validation.
 * @returns The JSON-RPC response.
 */
async function handleRpcRequest(
  message: JsonRpcMessage,
  request: Request
): Promise<Response> {
  const id = (message.id ?? null) as JsonRpcId;
  const method = message.method as string;
  const params = (message.params ?? {}) as Record<string, unknown>;

  const meta =
    params._meta &&
    typeof params._meta === "object" &&
    !Array.isArray(params._meta)
      ? (params._meta as Record<string, unknown>)
      : {};
  const metaVersion = meta[META_PROTOCOL_VERSION];
  const headerVersion = request.headers.get("mcp-protocol-version");
  const era: ProtocolEra =
    (typeof metaVersion === "string" && isModernProtocolVersion(metaVersion)) ||
    (headerVersion !== null && isModernProtocolVersion(headerVersion))
      ? "modern"
      : "legacy";

  if (era === "modern") {
    const invalid = validateModernRequest(request, method, params, id);
    if (invalid) return invalid;
  } else {
    // Legacy revisions predate the standard headers, so they are optional here,
    // but any that are sent must still agree with the body.
    const invalid = validateStandardHeaders(request, method, params, id, false);
    if (invalid) return invalid;
  }

  /**
   * Finalize a successful result: modern results carry the required
   * `resultType`, the server identity in `_meta`, and — on cacheable methods —
   * the client-caching hints. Legacy results are returned untouched.
   */
  const ok = (result: Record<string, unknown>, cacheable = false): Response =>
    rpcResult(
      id,
      era === "modern"
        ? {
            resultType: "complete",
            ...result,
            ...(cacheable
              ? { ttlMs: CACHE_TTL_MS, cacheScope: CACHE_SCOPE }
              : {}),
            _meta: { [META_SERVER_INFO]: SERVER_INFO },
          }
        : result
    );

  // `initialize` and `ping` were removed in 2026-07-28; `server/discover` exists
  // only there. Answering either in the wrong era would let a client infer a
  // handshake this endpoint does not have. Modern unknown methods use HTTP 404
  // so a client can tell a modern server from a legacy one.
  if (era === "modern" && (method === "initialize" || method === "ping")) {
    return rpcError(
      id,
      METHOD_NOT_FOUND,
      `Method not found: ${method}`,
      { supported: [...KNOWN_PROTOCOL_VERSIONS] },
      404
    );
  }
  if (era === "legacy" && method === "server/discover") {
    return rpcError(id, METHOD_NOT_FOUND, "Method not found: server/discover", {
      supported: [...KNOWN_PROTOCOL_VERSIONS],
    });
  }

  switch (method) {
    case "server/discover":
      return ok(
        {
          supportedVersions: [...KNOWN_PROTOCOL_VERSIONS],
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
        },
        true
      );
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : "";
      const protocolVersion =
        KNOWN_PROTOCOL_VERSIONS.has(requested) &&
        !isModernProtocolVersion(requested)
          ? requested
          : LEGACY_FALLBACK_PROTOCOL_VERSION;
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
      return ok({ tools: TOOLS }, true);
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
        return ok({ ...(await callTool(name, args)) });
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
      return ok({ resources: [] }, true);
    case "prompts/list":
      return ok({ prompts: [] }, true);
    default:
      return rpcError(
        id,
        METHOD_NOT_FOUND,
        `Method not found: ${method}`,
        undefined,
        era === "modern" ? 404 : 200
      );
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
    // 2026-07-28 requires an UnsupportedProtocolVersionError naming the
    // versions we do implement, so the client can retry on a mutual one.
    return rpcError(
      null,
      UNSUPPORTED_PROTOCOL_VERSION,
      `Unsupported protocol version: ${protocolHeader}`,
      { supported: [...KNOWN_PROTOCOL_VERSIONS], requested: protocolHeader },
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
    message = safeJsonParse(raw) as JsonRpcMessage;
  } catch (error) {
    return rpcError(
      null,
      error instanceof JsonStructureError ? INVALID_REQUEST : PARSE_ERROR,
      error instanceof JsonStructureError
        ? error.message
        : "Invalid JSON in request body.",
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
    return await handleRpcRequest(message, request);
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
      hint:
        "Send JSON-RPC 2.0 over HTTP POST to this URL; call server/discover for " +
        "capabilities. See https://daloyjs.dev/#mcp for setup.",
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
