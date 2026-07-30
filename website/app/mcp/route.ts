import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getAllDocPages, getDocPage } from "@/lib/docs-content";
import { rankDocPages, tokenize } from "@/lib/docs-ranking";
import { SITE_URL } from "@/lib/seo";

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

/** Identity reported to clients (handshake `serverInfo` / modern `_meta`). */
const SERVER_INFO = {
  name: "daloyjs-docs",
  version: "1.0.0",
} as const;

/** Free-text guidance returned to clients. */
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
    server.registerTool(
      "search_docs",
      {
        title: "Search DaloyJS docs",
        description:
          "Search the DaloyJS documentation by keyword and return the best-matching " +
          "pages with their title, route, description, and absolute URL.",
        inputSchema: z.strictObject({
          query: z
            .string()
            .min(1)
            .max(MAX_QUERY_LENGTH)
            .describe(
              "Keywords to search for, e.g. 'rate limit' or 'openapi client'."
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_SEARCH_LIMIT)
            .optional()
            .describe(
              `Maximum number of results (1-${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`
            ),
        }),
      },
      async ({ query, limit }) =>
        runSearchDocs(query, limit ?? DEFAULT_SEARCH_LIMIT)
    );

    server.registerTool(
      "get_doc",
      {
        title: "Read a DaloyJS doc page",
        description:
          "Return the full plain-text content of a single documentation page, " +
          'identified by its route or slug (for example "routing", "security", or ' +
          '"/docs/typed-client").',
        inputSchema: z.strictObject({
          path: z
            .string()
            .min(1)
            .describe('Page route or slug, e.g. "routing" or "/docs/security".'),
        }),
      },
      async ({ path }) => runGetDoc(path)
    );

    server.registerTool(
      "list_docs",
      {
        title: "List DaloyJS doc pages",
        description:
          "List every available DaloyJS documentation page with its title, route, " +
          "and description so you can pick one to read with get_doc.",
        inputSchema: z.strictObject({}),
      },
      async () => runListDocs()
    );
  },
  {
    serverInfo: { ...SERVER_INFO },
    instructions: INSTRUCTIONS,
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
      name: "DaloyJS Documentation",
      transport: "streamable-http",
      endpoint: `${SITE_URL}/mcp`,
      tools: ["search_docs", "get_doc", "list_docs"],
      hint:
        "Send JSON-RPC 2.0 over HTTP POST to this URL; call server/discover for " +
        "capabilities. See https://daloyjs.dev/#mcp for setup.",
    }),
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        allow: "POST, OPTIONS",
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
