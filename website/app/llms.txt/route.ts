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
 * Serve an llms.txt index (https://llmstxt.org) of the site.
 *
 * Lists the project's non-docs entry points (hosted MCP server, packages,
 * repository), then every docs page with its title and description grouped by
 * the same sections as the sidebar, then the blog under the spec's `Optional`
 * heading so agents can drop it when they need a shorter context. The heavy
 * lifting (page discovery and metadata extraction) is cached via
 * `getDocsSearchSections`.
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
    "Every docs page is also available as markdown: append `.md` to its URL (the links below point at the markdown versions; drop the `.md` suffix for the canonical HTML). Blog posts are HTML only.",
    "",
    `Agents can also query these docs over the Model Context Protocol instead of fetching pages: \`${SITE_URL}/mcp\` is a read-only MCP server with \`search_docs\`, \`get_doc\`, and \`list_docs\` tools.`,
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
        `- [${item.title}](${SITE_URL}${item.href}.md): ${item.description}`
      );
    }

    lines.push("");
  }

  // Per the llms.txt spec, `Optional` must be the final section: its links can
  // be skipped when a shorter context is needed. The blog is background
  // reading, so it belongs here rather than alongside the docs.
  lines.push("## Optional", "");

  for (const post of BLOG_POSTS) {
    lines.push(
      `- [${post.title}](${SITE_URL}/blog/${post.slug}): ${post.description} (${post.date})`
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
