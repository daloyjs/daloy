import { createMcpHandler } from "mcp-handler";
import {
  getAllDocPages,
  getAllTranslatedDocPages,
  getDocPage,
  getTranslatedDocPage,
  type TranslatedDocPage,
} from "@/lib/docs-content";
import { englishSearchQuery, glossaryMatches } from "@/lib/docs-glossary";
import { rankDocPages, tokenize } from "@/lib/docs-ranking";
import { isNonEnglishSearch, queryScript, recordNonEnglishSearch } from "@/lib/search-metrics";
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
import { readBodyLimited } from "@/lib/read-body-limited";
import { renderPathMarkdown } from "@/lib/render-page-markdown";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import {
  rateLimitHeaders,
  type RateLimitSnapshot,
} from "@/lib/site-rate-limit";

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
 * - `get_doc` - read one page by route or slug, as the same Markdown the
 *   page's `.md` sibling serves.
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

/**
 * Origin of the inbound request, or the canonical site origin when the
 * transport did not expose the request or its URL does not parse.
 *
 * @param url - The inbound request URL, when available.
 * @returns An origin string such as `https://daloyjs.dev`.
 */
function originOf(url: string | undefined): string {
  if (!url) return SITE_URL;
  try {
    return new URL(url).origin;
  } catch {
    return SITE_URL;
  }
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
 * Chinese and Spanish technical terms are mapped to English keywords first
 * (lib/docs-glossary.ts), and non-English searches are counted in aggregate
 * with no query text (lib/search-metrics.ts).
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
      "`query` must contain at least one alphanumeric term (letters or digits, in any script)."
    );
  }

  const pages = await getAllDocPages();
  // Cross-language glossary: "限流" or "pruebas" also searches the English
  // docs for "rate limit" / "testing" (lib/docs-glossary.ts).
  const matches = glossaryMatches(trimmed);
  const ranked = rankDocPages(pages, englishSearchQuery(trimmed, matches), limit);

  // Translated pages (es, zh) join the results only when the query looks
  // like it is in another language or nothing English matched, so English
  // queries keep their English-only result list.
  const wantTranslations = NON_ASCII.test(trimmed) || ranked.length === 0;
  const translated = wantTranslations
    ? rankDocPages(await getAllTranslatedDocPages(), trimmed, limit)
    : [];

  if (isNonEnglishSearch(trimmed, matches)) {
    recordNonEnglishSearch({
      script: queryScript(trimmed),
      englishResults: ranked.length > 0 ? "some" : "none",
      englishResultsWithoutGlossary:
        matches.length === 0
          ? ranked.length > 0 ? "some" : "none"
          : rankDocPages(pages, trimmed, 1).length > 0 ? "some" : "none",
      translatedResults: translated.length > 0 ? "some" : "none",
      glossaryTerms: matches.length,
    });
  }

  if (ranked.length === 0 && translated.length === 0) {
    return textResult(
      `No documentation pages matched "${trimmed}". Try broader keywords or use list_docs. ${ENGLISH_HINT}`
    );
  }

  const sections: string[] = [];
  if (matches.length > 0 && ranked.length > 0) {
    sections.push(
      `Searched the English docs for: ${[...new Set(matches.map((m) => m.english))].join(", ")} (from ${matches.map((m) => m.source).join(", ")}).`
    );
  }
  if (ranked.length > 0) {
    const lines = ranked.map(
      (entry, index) =>
        `${index + 1}. ${entry.page.title} (${entry.page.href})\n   ${entry.page.description}\n   ${absoluteUrl(entry.page.href)}`
    );
    sections.push(`Found ${ranked.length} result(s) for "${trimmed}":\n\n${lines.join("\n\n")}`);
  }
  if (translated.length > 0) {
    const lines = translated.map((entry, index) => `${index + 1}. ${translatedLine(entry.page)}`);
    sections.push(
      `${ranked.length === 0 ? `No English pages matched "${trimmed}". ` : ""}Translated pages (${translated.length}):\n\n${lines.join("\n\n")}` +
        (ranked.length === 0 ? `\n\n${ENGLISH_HINT}` : "")
    );
  }
  return textResult(sections.join("\n\n"));
}

/** Detects queries written in a language other than plain-ASCII English. */
const NON_ASCII = /[^\x00-\x7f]/;

/** Steer agents back to the complete English corpus. */
const ENGLISH_HINT =
  "The English docs are the complete reference; only getting started, installation, and the bookstore tutorial are translated (Spanish /es/docs, Simplified Chinese /zh/docs, French /fr/docs). Search again with English keywords for everything else.";

/**
 * One translated search or list row: title, route, language, the English
 * page it translates, description and URL.
 */
function translatedLine(page: TranslatedDocPage): string {
  return `${page.title} (${page.href}, ${page.lang} translation of ${page.translates})\n   ${page.description}\n   ${absoluteUrl(page.href)}`;
}

/**
 * Execute `get_doc`.
 *
 * The body is the same Markdown the page's `.md` sibling serves (rendered by
 * {@link renderPathMarkdown}), so code samples, tables, and headings arrive
 * intact. If that render fails, the tool falls back to the page's extracted
 * plain text rather than erroring, and says so in the result.
 *
 * @param path - Page route or slug (already schema-validated).
 * @param origin - Origin of the inbound MCP request. Only used as the
 *   self-fetch target outside production; {@link renderPathMarkdown} pins
 *   every other origin to the canonical site, so a forged `Host` cannot steer
 *   the fetch (SSRF).
 * @returns The MCP tool result: the page title, route, URL, and full (bounded)
 *   Markdown body, or an `isError` result when no page matches.
 */
async function runGetDoc(path: string, origin: string): Promise<ToolResult> {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return toolErrorResult(
      '`path` is required, e.g. "routing" or "/docs/security".'
    );
  }

  const translatedPage = await getTranslatedDocPage(trimmed);
  if (translatedPage) {
    return runGetTranslatedDoc(translatedPage, origin);
  }

  const page = await getDocPage(trimmed);
  if (!page) {
    return toolErrorResult(
      `No documentation page found for "${trimmed}". Use list_docs or search_docs to find valid routes.`
    );
  }

  const rendered = await renderPathMarkdown(origin, page.href).catch(() => null);
  const content =
    rendered && rendered.status === 200
      ? // The Markdown opens with the page H1; the header below already has it.
        rendered.markdown.replace(/^# [^\n]*\n+/, "").trim()
      : `${page.body}\n\n[Markdown rendering unavailable; this is a plain-text fallback. Code samples may be incomplete, so read ${absoluteUrl(page.href)}.md for the exact source.]`;

  const body =
    content.length > MAX_DOC_BODY_CHARS
      ? `${content.slice(0, MAX_DOC_BODY_CHARS)}\n\n[truncated; read the full page at ${absoluteUrl(page.href)}.md]`
      : content;

  return textResult(
    `# ${page.title}\n\nRoute: ${page.href}\nURL: ${absoluteUrl(page.href)}\nMarkdown: ${absoluteUrl(page.href)}.md\n\n${body}`
  );
}

/**
 * `get_doc` for a translated page: the same Markdown its `.md` sibling
 * serves, headed with its language and the English page it translates (which
 * stays authoritative).
 *
 * @param page - The resolved translated page.
 * @param origin - Inbound origin, pinned by {@link renderPathMarkdown}.
 * @returns The MCP tool result.
 */
async function runGetTranslatedDoc(page: TranslatedDocPage, origin: string): Promise<ToolResult> {
  const rendered = await renderPathMarkdown(origin, page.href).catch(() => null);
  const content =
    rendered && rendered.status === 200
      ? rendered.markdown.replace(/^# [^\n]*\n+/m, "").trim()
      : `${page.body}\n\n[Markdown rendering unavailable; this is a plain-text fallback. Read ${absoluteUrl(page.href)}.md for the exact source.]`;
  const body =
    content.length > MAX_DOC_BODY_CHARS
      ? `${content.slice(0, MAX_DOC_BODY_CHARS)}\n\n[truncated; read the full page at ${absoluteUrl(page.href)}.md]`
      : content;

  return textResult(
    `# ${page.title}\n\nRoute: ${page.href}\nLanguage: ${page.lang} (translation of ${page.translates}; the English page is authoritative: ${absoluteUrl(page.translates)})\nURL: ${absoluteUrl(page.href)}\nMarkdown: ${absoluteUrl(page.href)}.md\n\n${body}`
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
  const translated = await getAllTranslatedDocPages();
  const translatedLines = translated.map(
    (page) => `- ${page.title} (${page.href}, ${page.lang} translation of ${page.translates}): ${page.description}`
  );
  return textResult(
    `DaloyJS has ${pages.length} documentation pages:\n\n${lines.join("\n")}` +
      (translated.length > 0
        ? `\n\nTranslated pages (${translated.length}; the English pages above are authoritative):\n\n${translatedLines.join("\n")}`
        : "")
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
      async ({ path }, ctx) =>
        runGetDoc(path, originOf(ctx.http?.req?.url))
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
 * Clone a handler response with the permissive CORS headers and optional
 * RateLimit headers attached, so browser-based MCP clients can read it and
 * self-throttle against the advertised quota.
 *
 * @param response - The response produced by `mcp-handler` or an early guard.
 * @param snapshot - Optional rate-limit snapshot for this request.
 * @returns The same response with CORS and RateLimit headers merged in.
 */
function withCors(
  response: Response,
  snapshot?: RateLimitSnapshot
): Response {
  const headers = new Headers(response.headers);
  if (snapshot) {
    headers.set("API-Version", SITE_API_VERSION);
    for (const [key, value] of Object.entries(rateLimitHeaders(snapshot))) {
      headers.set(key, value);
    }
  }
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
 * MCP Streamable HTTP `POST` handler. Enforces the shared site API rate limit
 * and body-size cap, then delegates the wire protocol to `mcp-handler`.
 *
 * @param request - The inbound HTTP request.
 * @returns The MCP response with CORS and RateLimit headers attached.
 */
export async function POST(request: Request): Promise<Response> {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return withCors(quota.response, quota.snapshot);
  }

  // Body-size guard (header hint first, then the actual payload) — kept in
  // front of the library so an oversized payload is refused before parsing.
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
      ),
      quota.snapshot
    );
  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return tooLarge();
  }

  return withCors(
    await handler(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: body.bytes,
      })
    ),
    quota.snapshot
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
