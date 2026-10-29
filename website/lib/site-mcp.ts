import { z } from "zod";

import { SITE_URL } from "@/lib/seo";

/**
 * Single source of truth for the docs MCP server's public surface: identity,
 * instructions, and the tool catalog. Both the live `/mcp` endpoint
 * (`app/mcp/route.ts`) and the MCP Server Card
 * (`/.well-known/mcp/server-card.json`) read from here, so the card cannot
 * advertise a tool, schema, or version the server does not actually serve.
 */

/** Identity reported to clients (handshake `serverInfo` / modern `_meta`). */
export const SITE_MCP_SERVER_INFO = {
  name: "daloyjs-docs",
  version: "1.0.0",
} as const;

/** Human-friendly title used in the Server Card. */
export const SITE_MCP_TITLE = "DaloyJS Documentation";

/** Newest MCP revision the endpoint serves (stateless era, via `_meta`). */
export const SITE_MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Free-text guidance returned to clients in the `initialize` / discover result
 * and the Server Card. Most MCP clients put this text in the model's system
 * prompt, so it doubles as a primer for models that have no training-time
 * knowledge of DaloyJS: what it is, how to start a project, the core route
 * idiom, the mistakes models carry over from Express / Hono, and which pages
 * to read first. Every `/docs/...` route named here must exist (enforced by
 * `tests/mcp/primer.test.ts`); keep it short, since clients send it on
 * every turn.
 */
export const SITE_MCP_INSTRUCTIONS = [
  "Read-only access to the DaloyJS documentation at https://daloyjs.dev/docs. " +
    "Use `search_docs` to find relevant pages by keyword, `get_doc` to read the " +
    'full Markdown of a page by its route or slug (for example "routing" or ' +
    '"/docs/security"), and `list_docs` to browse every available page. When you ' +
    "answer from these docs, cite the page URL you used.",
  "Translations: getting started, installation, and the bookstore tutorial also exist in Castilian Spanish " +
    "(/es/docs/getting-started), Simplified Chinese (/zh/docs/getting-started), French (/fr/docs/getting-started), " +
    "Brazilian Portuguese (/pt/docs/getting-started), Modern Standard Arabic (/ar/docs/getting-started), " +
    "and Russian (/ru/docs/getting-started). " +
    "`search_docs` accepts queries in those languages, `get_doc` reads those routes, and `list_docs` lists them. " +
    "Everything else is English, and the English pages are authoritative.",
  "",
  "DaloyJS primer (your training data may not cover DaloyJS; prefer these docs over guesses from other frameworks):",
  "- What it is: `@daloyjs/core`, a contract-first TypeScript web framework for JSON/HTTP APIs. The route definition (Zod or other Standard Schema validators) is the single source of truth for validation, handler types, OpenAPI 3.1, and a generated typed client. One app runs on Node, Bun, Deno, Cloudflare Workers, Vercel, AWS Lambda, and more through adapters.",
  "- New project: `pnpm create daloy@latest my-api` (or `npm create daloy@latest my-api`). Scaffolds ship an AGENTS.md and a best-practices skill; read them in the project. Existing project: `pnpm add @daloyjs/core zod`.",
  "- Core idiom:",
  "```ts",
  'import { z } from "zod";',
  'import { App, requestId, rateLimit } from "@daloyjs/core";',
  'import { serve } from "@daloyjs/core/node";',
  "",
  "const app = new App({ bodyLimitBytes: 64 * 1024, requestTimeoutMs: 5_000 })",
  "  .use(requestId())",
  "  .use(rateLimit({ windowMs: 60_000, max: 120 }))",
  "  .get(",
  '    "/greet/:name",',
  "    {",
  "      request: { params: z.object({ name: z.string().min(1) }).strict() },",
  '      responses: { 200: { description: "Greeting", body: z.object({ msg: z.string() }) } },',
  "    },",
  "    async ({ params }) => ({ status: 200, body: { msg: `Hello, ${params.name}!` } }),",
  "  );",
  "",
  "serve(app, { port: 3000 });",
  "```",
  "- Common mistakes to avoid:",
  "  - Handlers return `{ status, body, headers? }`; there is no `res.json()`, `c.json()`, or `next()`. The status must be declared in `responses`.",
  "  - Declare inputs under `request: { params, query, body, headers }`; they are validated before the handler runs (failures become problem+json errors automatically). Query and path values arrive as strings, so use `z.coerce` for numbers.",
  "  - Use `.strict()` on request object schemas, and keep response body schemas tight (never `z.any()`).",
  "  - Throw typed errors such as `NotFoundError` or `BadRequestError` from `@daloyjs/core` instead of hand-building error responses.",
  "  - Import `serve` from the runtime adapter subpath (`@daloyjs/core/node`, `/bun`, `/deno`, `/cloudflare`, `/vercel`, `/lambda`); the core package never opens a port.",
  "  - Keep the secure defaults (`secureHeaders` is automatic, plus `requestId`, `rateLimit`, `bodyLimitBytes`, `requestTimeoutMs`). If a guard rejects a request, satisfy it rather than removing it.",
  "- Start reading: /docs/getting-started, /docs/routing, /docs/validation, /docs/errors, /docs/testing, /docs/typed-client, /docs/adapters, /docs/security. Coming from Express: /docs/migrating/express.",
].join("\n");

/** Hard cap on a search query string. */
export const MAX_QUERY_LENGTH = 256;
/** Default number of search hits returned when the caller does not specify. */
export const DEFAULT_SEARCH_LIMIT = 8;
/** Upper bound on search hits a caller may request. */
export const MAX_SEARCH_LIMIT = 25;

/** Input schemas, shared by the server (validation) and the card (advertising). */
export const SITE_MCP_INPUT_SCHEMAS = {
  search_docs: z.strictObject({
    query: z
      .string()
      .min(1)
      .max(MAX_QUERY_LENGTH)
      .describe(
        "Keywords to search for, e.g. 'rate limit' or 'openapi client'. Spanish, Chinese, French, Portuguese, Arabic, and Russian queries also match the translated pages.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_LIMIT)
      .optional()
      .describe(`Maximum number of results (1-${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`),
  }),
  get_doc: z.strictObject({
    path: z
      .string()
      .min(1)
      .describe('Page route or slug, e.g. "routing", "/docs/security", or a translated route such as "/zh/docs/installation".'),
  }),
  list_docs: z.strictObject({}),
} as const;

/** Name of a tool the docs MCP server exposes. */
export type SiteMcpToolName = keyof typeof SITE_MCP_INPUT_SCHEMAS;

/** Display metadata for each tool, in the order `tools/list` returns them. */
export const SITE_MCP_TOOLS: ReadonlyArray<{ name: SiteMcpToolName; title: string; description: string }> = [
  {
    name: "search_docs",
    title: "Search DaloyJS docs",
    description:
      "Search the DaloyJS documentation by keyword and return the best-matching " +
      "pages with their title, route, description, and absolute URL.",
  },
  {
    name: "get_doc",
    title: "Read a DaloyJS doc page",
    description:
      "Return the full content of a single documentation page as Markdown " +
      "(the same body its .md URL serves, with code samples intact), " +
      'identified by its route or slug (for example "routing", "security", or ' +
      '"/docs/typed-client").',
  },
  {
    name: "list_docs",
    title: "List DaloyJS doc pages",
    description:
      "List every available DaloyJS documentation page with its title, route, " +
      "and description so you can pick one to read with get_doc.",
  },
];

/** Path of the Server Card, per the MCP Server Cards draft (SEP-1649). */
export const SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";

/**
 * Build the MCP Server Card for the docs server.
 *
 * Follows the **draft** MCP Server Cards proposal (SEP-1649,
 * `/.well-known/mcp/server-card.json`), which is not yet part of a released
 * MCP specification. Only draft fields are emitted, and every value is derived
 * from the live server's definitions above. Tools are listed statically (the
 * catalog never changes at runtime) with the same JSON Schemas the server
 * validates against. Authentication is not required: the server is read-only
 * and serves already-public docs; an OAuth 2.0 `docs:read` token is accepted
 * but optional.
 *
 * @returns The Server Card object.
 */
export function buildServerCard(): Record<string, unknown> {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
    version: "1.0",
    protocolVersion: SITE_MCP_PROTOCOL_VERSION,
    serverInfo: { ...SITE_MCP_SERVER_INFO, title: SITE_MCP_TITLE },
    description: "Read-only search and retrieval over the DaloyJS framework documentation.",
    iconUrl: `${SITE_URL}/assets/icon-512.png`,
    documentationUrl: `${SITE_URL}/docs/mcp`,
    transport: { type: "streamable-http", endpoint: `${SITE_URL}/mcp` },
    capabilities: { tools: { listChanged: true } },
    authentication: { required: false, schemes: ["oauth2"] },
    instructions: SITE_MCP_INSTRUCTIONS,
    tools: SITE_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(SITE_MCP_INPUT_SCHEMAS[tool.name]),
    })),
    _meta: {
      "dev.daloyjs/specStatus": "draft-sep-1649",
    },
  };
}
