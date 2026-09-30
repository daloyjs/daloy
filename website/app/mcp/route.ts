import { createMcpHandler } from "mcp-handler";
import { getAllDocPages, getDocPage } from "@/lib/docs-content";
import { rankDocPages, tokenize } from "@/lib/docs-ranking";
import { SITE_URL } from "@/lib/seo";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_QUERY_LENGTH,
  SITE_MCP_INPUT_SCHEMAS,
  SITE_MCP_INSTRUCTIONS,
  SITE_MCP_SERVER_INFO,
  SITE_MCP_TOOLS,
  type SiteMcpToolName,
} from "@/lib/site-mcp";
import {
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC,
  SITE_API_VERSION,
} from "@/lib/site-api";

/**
 * Public Model Context Protocol (MCP) endpoint for the DaloyJS documentation.
 *
 * Built on Vercel's `mcp-handler` (2.x) and the MCP TypeScript SDK v2
 * (`@modelcontextprotocol/server`), which serve the stateless `2026-07-28`
 * protocol revision natively and fall back to 2025-era Streamable HTTP for
 * older clients — both from this one route, with no session storage.
 *
 * The endpoint is read-only and unauthenticated by design: every byte it
 * exposes is already public on https://daloyjs.dev/docs. It advertises a
 * single capability, `tools`, with three tools:
 * - `search_docs` - keyword search across every docs page.
 * - `get_doc` - read the full plain-text body of one page by route or slug.
 * - `list_docs` - enumerate every available docs page.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */

/** Hard cap on the accepted request body (256 KiB). */
const MAX_BODY_BYTES = 1 << 18;
/**
 * Cap on the body text returned by `get_doc`. Sized to serve the longest docs
 * pages in full, including the deliberately exhaustive Express migration guide
 * (the security compliance and API reference pages are the next largest), while
 * still bounding any single response. Pages longer than this are truncated with
 * a pointer to the full page URL. Raise this if a page legitimately grows past
 * it rather than letting agents receive a half-page answer.
 */
const MAX_DOC_BODY_CHARS = 64_000;

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
 * Absolute, canonical URL for a docs route.
 *
 * @param href - A `/docs/...` route.
 * @returns The fully-qualified URL on the canonical site origin.
 */
function absoluteUrl(href: string): string {
  return `${SITE_URL}${href}`;
}

/** Shape of an MCP `tools/call` text result. */
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wrap text as a successful MCP tool result. */
function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wrap text as an MCP tool error result (visible to the model for self-correction). */
function toolErrorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Execute `search_docs`.
 *
 * @param query - Search keywords (already schema-validated).
 * @param limit - Maximum number of hits (already schema-validated).
 * @returns The MCP tool result: a ranked result list, or an `isError` result
 *   when the query contains no searchable term.
 */
async function runSearchDocs(query: string, limit: number): Promise<ToolResult> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length === 0 || tokenize(trimmed).length === 0) {
    return toolErrorResult(
      "`query` must contain at least one alphanumeric term."
    );
  }

  const pages = await getAllDocPages();
  const ranked = rankDocPages(pages, trimmed, limit);

  if (ranked.length === 0) {
    return textResult(
      `No documentation pages matched "${trimmed}". Try broader keywords or use list_docs.`
    );
  }

  const lines = ranked.map(
    (entry, index) =>
      `${index + 1}. ${entry.page.title} (${entry.page.href})\n   ${entry.page.description}\n   ${absoluteUrl(entry.page.href)}`
  );
  return textResult(
    `Found ${ranked.length} result(s) for "${trimmed}":\n\n${lines.join("\n\n")}`
  );
}

/**
 * Execute `get_doc`.
 *
 * @param path - Page route or slug (already schema-validated).
 * @returns The MCP tool result: the page title, route, URL, and full (bounded)
 *   body text, or an `isError` result when no page matches.
 */
async function runGetDoc(path: string): Promise<ToolResult> {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return toolErrorResult(
      '`path` is required, e.g. "routing" or "/docs/security".'
    );
  }

  const page = await getDocPage(trimmed);
  if (!page) {
    return toolErrorResult(
      `No documentation page found for "${trimmed}". Use list_docs or search_docs to find valid routes.`
    );
  }

  const body =
    page.body.length > MAX_DOC_BODY_CHARS
      ? `${page.body.slice(0, MAX_DOC_BODY_CHARS)}\n\n[truncated; read the full page at ${absoluteUrl(page.href)}]`
      : page.body;

  return textResult(
    `# ${page.title}\n\nRoute: ${page.href}\nURL: ${absoluteUrl(page.href)}\n\n${body}`
  );
}

/**
 * Execute `list_docs`.
 *
 * @returns The MCP tool result: a bulleted list of every documentation page.
 */
async function runListDocs(): Promise<ToolResult> {
  const pages = await getAllDocPages();
  const lines = pages.map(
    (page) => `- ${page.title} (${page.href}): ${page.description}`
  );
  return textResult(
    `DaloyJS has ${pages.length} documentation pages:\n\n${lines.join("\n")}`
  );
}

/**
 * The MCP request handler. `mcp-handler` owns the wire protocol (JSON-RPC
 * envelopes, protocol-revision negotiation, `_meta` validation, standard-header
 * enforcement); this callback only registers the tool catalog. The SDK
 * validates every `tools/call` against the zod schemas before a handler runs,
 * so handlers receive well-typed arguments.
 */
const handler = createMcpHandler(
  (server) => {
    // Tool metadata and input schemas come from lib/site-mcp.ts, the same
    // source the MCP Server Card is built from, so the two cannot disagree.
    const meta = Object.fromEntries(SITE_MCP_TOOLS.map((tool) => [tool.name, tool])) as Record<
      SiteMcpToolName,
      (typeof SITE_MCP_TOOLS)[number]
    >;

    server.registerTool(
      "search_docs",
      { ...meta.search_docs, inputSchema: SITE_MCP_INPUT_SCHEMAS.search_docs },
      async ({ query, limit }) => runSearchDocs(query, limit ?? DEFAULT_SEARCH_LIMIT)
    );

    server.registerTool(
      "get_doc",
      { ...meta.get_doc, inputSchema: SITE_MCP_INPUT_SCHEMAS.get_doc },
      async ({ path }) => runGetDoc(path)
    );

    server.registerTool(
      "list_docs",
      { ...meta.list_docs, inputSchema: SITE_MCP_INPUT_SCHEMAS.list_docs },
      async () => runListDocs()
    );
  },
  {
    serverInfo: { ...SITE_MCP_SERVER_INFO },
    instructions: SITE_MCP_INSTRUCTIONS,
  }
);

/**
 * Clone a handler response with the permissive CORS headers attached, so
 * browser-based MCP clients can read it.
 *
 * @param response - The response produced by `mcp-handler`.
 * @returns The same response with CORS headers merged in.
 */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * MCP Streamable HTTP `POST` handler. Enforces the body-size cap, then
 * delegates the wire protocol to `mcp-handler`.
 *
 * @param request - The inbound HTTP request.
 * @returns The MCP response with CORS headers attached.
 */
export async function POST(request: Request): Promise<Response> {
  // Body-size guard (header hint first, then the actual payload) — kept in
  // front of the library so an oversized payload is refused before parsing.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  const tooLarge = (): Response =>
    withCors(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Request body too large." },
          type: `${SITE_URL}/errors/payload-too-large`,
          title: "Payload Too Large",
          status: 413,
          detail: "Request body too large.",
          code: "payload_too_large",
          hint: `Send a JSON-RPC body smaller than ${MAX_BODY_BYTES} bytes. See ${SITE_URL}/docs/mcp and GET ${SITE_URL}/openapi.json.`,
        }),
        {
          status: 413,
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      )
    );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return tooLarge();
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return tooLarge();
  }

  return withCors(
    await handler(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      })
    )
  );
}

/**
 * MCP Streamable HTTP `GET` handler. This server does not offer a
 * server-initiated SSE stream, so per the spec it answers GET with `405`. The
 * JSON body is a convenience for humans and agents that open the URL directly.
 *
 * @returns An HTTP 405 response describing how to use the endpoint.
 */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      type: `${SITE_URL}/errors/method-not-allowed`,
      title: "Method Not Allowed",
      status: 405,
      detail:
        "The DaloyJS MCP server accepts JSON-RPC 2.0 over HTTP POST, not GET.",
      code: "method_not_allowed",
      hint:
        "POST JSON-RPC 2.0 to this URL; call server/discover for capabilities. See " +
        `${SITE_URL}/docs/mcp and GET ${SITE_URL}/openapi.json.`,
      name: "DaloyJS Documentation",
      transport: "streamable-http",
      endpoint: `${SITE_URL}/mcp`,
      tools: ["search_docs", "get_doc", "list_docs"],
    }),
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        allow: "POST, OPTIONS",
        "API-Version": SITE_API_VERSION,
        RateLimit: `"default";r=${SITE_API_RATE_LIMIT};t=${SITE_API_RATE_WINDOW_SEC}`,
        "RateLimit-Policy": `"default";q=${SITE_API_RATE_LIMIT};w=${SITE_API_RATE_WINDOW_SEC}`,
        "RateLimit-Limit": String(SITE_API_RATE_LIMIT),
        "RateLimit-Remaining": String(SITE_API_RATE_LIMIT),
        "RateLimit-Reset": String(SITE_API_RATE_WINDOW_SEC),
        ...CORS_HEADERS,
      },
    }
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
