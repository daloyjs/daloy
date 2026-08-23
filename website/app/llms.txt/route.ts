import { BLOG_POSTS } from "@/lib/blog-posts";
import { getDocsSearchSections } from "@/lib/docs-search";
import { CORE_PACKAGE_VERSION, SITE_URL } from "@/lib/seo";

/**
 * Entry points that are not docs pages but that an agent reading `llms.txt`
 * should know about: the hosted docs MCP server, the published packages, and
 * the source repository.
 */
const PROJECT_LINKS: ReadonlyArray<{
  title: string;
  url: string;
  description: string;
}> = [
  {
    title: "DaloyJS homepage",
    url: SITE_URL,
    description:
      "Project overview, feature tour, benchmarks, and runtime support matrix.",
  },
  {
    title: "About DaloyJS",
    url: `${SITE_URL}/about`,
    description:
      "Who maintains the project, how it is licensed, and how to verify the GitHub/npm/JSR profiles.",
  },
  {
    title: "Contact DaloyJS",
    url: `${SITE_URL}/contact`,
    description:
      "Email, GitHub issues, and private security reporting for the maintainers.",
  },
  {
    title: "DaloyJS privacy policy",
    url: `${SITE_URL}/privacy`,
    description:
      "What daloyjs.dev collects (hosting, Vercel Analytics, Google Analytics) and how to ask questions.",
  },
  {
    title: "Docs MCP server",
    url: `${SITE_URL}/mcp`,
    description:
      "Read-only Model Context Protocol endpoint (Streamable HTTP, JSON-RPC 2.0) over these same docs, exposing the search_docs, get_doc, and list_docs tools. Prefer this over crawling pages.",
  },
  {
    title: "GitHub repository",
    url: "https://github.com/daloyjs/daloy",
    description:
      "Source, issues, CHANGELOG, SECURITY.md, and the hardened release workflows for @daloyjs/core and create-daloy.",
  },
  {
    title: "npm package @daloyjs/core",
    url: "https://www.npmjs.com/package/@daloyjs/core",
    description:
      "The framework on npm, published with provenance and zero runtime dependencies.",
  },
  {
    title: "JSR package @daloyjs/daloy",
    url: "https://jsr.io/@daloyjs/daloy",
    description:
      "The same source published to JSR as TypeScript, for Deno and JSR-native consumers.",
  },
  {
    title: "create-daloy scaffolder",
    url: "https://www.npmjs.com/package/create-daloy",
    description:
      "Scaffold a production-ready project with `pnpm create daloy@latest`; templates for Node.js, Bun, Deno, and Cloudflare Workers.",
  },
  {
    title: 'Why the name "Daloy"?',
    url: `${SITE_URL}/about-the-name`,
    description: "Origin of the project name and how to pronounce it.",
  },
];

/**
 * Serve the site-wide llms.txt index (https://llmstxt.org, v2).
 *
 * Lists the project's non-docs entry points (hosted MCP server, packages,
 * repository), then every docs page with its title and description grouped by
 * the same sections as the sidebar, then the blog under `Optional`. The heavy
 * lifting (page discovery and metadata extraction) is cached via
 * `getDocsSearchSections`.
 *
 * This is the least specific of the site's llms.txt files: under v2 a file
 * covers the pages beneath its own path, so agents working inside `/docs/`
 * should prefer `/docs/llms.txt`, which is what the `rel="describedby"`
 * relation on those pages points at.
 *
 * @returns A `text/plain; charset=utf-8` markdown response.
 */
export async function GET() {
  const sections = await getDocsSearchSections();

  const lines: string[] = [
    "# DaloyJS",
    "",
    "> DaloyJS is a runtime-portable, contract-first TypeScript web framework with built-in OpenAPI 3.1 generation, typed client codegen (Hey API), and security-first defaults. It runs on Node.js, Bun, Deno, and Cloudflare Workers.",
    "",
    `Current release: \`@daloyjs/core@${CORE_PACKAGE_VERSION}\` on npm, published to JSR as \`@daloyjs/daloy\` from the same source. It has zero runtime dependencies. Start a new project with \`pnpm create daloy@latest\`.`,
    "",
    "Every public page also negotiates Markdown on the same URL: send `Accept: text/markdown` (or append `.md`). Responses set `Vary: Accept`. Errors from the HTTP APIs are RFC 9457 problem+json with `code` and `hint` fields. The JSON catalog is versioned at GET /api/v1 (unversioned /api redirects there). OAuth 2.0 client_credentials at POST /oauth/token issues an optional docs:read Bearer token; metadata lives at /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource. API responses send RateLimit headers.",
    "",
    "Every docs page is also available as markdown: append `.md` to its URL (the links below point at the markdown versions; drop the `.md` suffix for the canonical HTML).",
    "",
    'Following llms.txt v2, every page advertises those siblings with standard link relations, as both HTML `<link>` elements and an HTTP `Link:` response header: `rel="alternate" type="text/markdown"` points at the markdown version of the page, and `rel="describedby"` points at the llms.txt file covering it. So an agent holding any URL on this site can find both without guessing.',
    "",
    `There is also a documentation-only index at ${SITE_URL}/docs/llms.txt, covering the pages under \`/docs/\`. Prefer it when you only need the framework reference; this file is the whole site.`,
    "",
    `Agents can also query these docs over the Model Context Protocol instead of fetching pages: \`${SITE_URL}/mcp\` is a read-only MCP server with \`search_docs\`, \`get_doc\`, and \`list_docs\` tools.`,
    "",
    "## Developer resources",
    "",
    `- [DaloyJS API docs](${SITE_URL}/docs/api-reference.md): complete public TypeScript surface (App, routing, middleware, security, adapters). Also at /docs/api and /api-docs.`,
    `- [DaloyJS OpenAPI spec](${SITE_URL}/docs/openapi.md): generate OpenAPI 3.1 from routes. Machine-readable website API catalog: ${SITE_URL}/openapi.json (v1 path ${SITE_URL}/api/v1).`,
    `- [OAuth 2.0 authorization server](${SITE_URL}/.well-known/oauth-authorization-server): RFC 8414 metadata. Token endpoint ${SITE_URL}/oauth/token (client_credentials, scope docs:read). Protected-resource metadata: ${SITE_URL}/.well-known/oauth-protected-resource.`,
    `- [DaloyJS auth docs](${SITE_URL}/docs/auth.md): bearer auth and identity providers (Cognito, Entra ID, Auth0, Okta, Clerk, LoginRadius, Better Auth).`,
    `- [DaloyJS webhooks](${SITE_URL}/docs/webhook-delivery.md): signed outbound webhook delivery. Also at /docs/webhooks.`,
    `- [DaloyJS MCP server](${SITE_URL}/mcp): live docs MCP (\`search_docs\`, \`get_doc\`, \`list_docs\`). Guide: ${SITE_URL}/docs/mcp.md.`,
    "",
    "## Project",
    "",
  ];

  for (const link of PROJECT_LINKS) {
    lines.push(`- [${link.title}](${link.url}): ${link.description}`);
  }

  lines.push("");

  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");

    for (const item of section.items) {
      lines.push(
        `- [${item.title}](${SITE_URL}${item.href}.md): ${item.description}`,
      );
    }

    lines.push("");
  }

  // `Optional` is the spec's convention for secondary links an agent can skip
  // when it needs a shorter context. Since v2 dropped the context-expansion
  // tooling, the heading no longer carries mechanical semantics, so this is a
  // hint to the reader rather than an instruction to a parser. The blog is
  // background reading, so it belongs here rather than alongside the docs.
  lines.push("## Optional", "");

  for (const post of BLOG_POSTS) {
    lines.push(
      `- [${post.title}](${SITE_URL}/blog/${post.slug}): ${post.description} (${post.date})`,
    );
  }

  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
