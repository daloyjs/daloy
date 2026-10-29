import type { HomeCopy } from "./home-copy";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

// requestId() and secureHeaders() are already auto-applied by new App();
// these explicit calls only customize (and replace) the defaults.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // per client IP by default; behind a proxy, set behindProxy or keyGenerator

app.get(
  "/books/:id",
  {
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Found", body: z.object({ id: z.string(), title: z.string() }) },
      404: { description: "Not found" },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Book \${params.id}\` },
  }),
);

serve(app, { port: 3000 });`;

const MCP_SERVER_SNIPPET = `import { App, bearerAuth, createMcpHandler, mcpRoutes } from "@daloyjs/core";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [/* your tools, with validated input schemas */],
});

const app = new App();
app.use(bearerAuth({ validate: checkToken })); // no auth hook: production refuses to boot
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route); // your API is now an MCP server too
}`;

/** English landing-page copy (the source the translations follow). */
export const HOME_COPY_EN: HomeCopy = {
  locale: "en",
  links: {
    gettingStarted: "/docs/getting-started",
    docs: "/docs",
    installation: "/docs/installation",
    tutorial: "/docs/tutorials/bookstore",
    mcp: "/docs/mcp",
    openapi: "/docs/openapi",
    blog: "/blog",
  },
  languageNotice: {
    badge: "Nuevo",
    text: "DaloyJS ya está disponible en español de España.",
    cta: "Leer en español",
    href: "/es",
    lang: "es-ES",
  },
  hero: {
    title:
      "Contract-first TypeScript REST APIs with secure defaults, built for AI-assisted teams",
    subtitle:
      "DaloyJS ships secure defaults, refuses to start in production on the misconfigurations it knows about, and runs with zero runtime dependencies and a hardened, provenance-signed publish pipeline. No framework makes an app fully secure or stops every supply-chain attack, so the docs say what is on by default, what you turn on, and the risks that remain.",
    primaryCta: "Get started: Install Daloy",
    secondaryCta: "Read the docs",
    factsLabel: "Project facts",
    facts: [
      "3,000+ framework tests passing",
      "≥90% line/function and ≥92% branch coverage gates",
      "0 runtime dependencies",
      "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
      "MIT licensed",
    ],
    nameNote: (
      <>
        <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy means{" "}
        <span className="text-foreground">flow</span> in Tagalog (pronounced{" "}
        <span className="whitespace-nowrap text-foreground">da-loy</span>).
      </>
    ),
    aboutLabel: "About",
    aboutHref: "/about",
    nameLabel: "The name",
    nameHref: "/about-the-name",
    tutorialLabel: "Bookstore tutorial",
  },
  security: {
    eyebrow: "Security & Supply Chain",
    title: "Security defaults: the defense layer for AI-generated code",
    body: "When AI models generate code, developer typing speed is not the bottleneck: runtime safety and supply-chain integrity are. DaloyJS enforces guardrails at the runtime layer: request body limits, timeouts, prototype-pollution protection, 5xx detail redactions, and boot-time misconfiguration refusals, with zero transitive dependencies to exploit.",
  },
  features: {
    secureDefaults: {
      title: "Secure runtime defaults",
      body: "Unlike frameworks that leave basic protections to plugins or manual error routing, the DaloyJS core starts with guardrails on: body limits, request timeouts, prototype-pollution-safe JSON, proper 405 Method Not Allowed responses, and 5xx detail redaction that fails closed (on everywhere except an explicit development or test environment). In production it refuses to boot on the misconfigurations it knows about, such as weak session secrets or session cookies without CSRF.",
      badges: [
        "Body limits (1 MiB default)",
        "Request timeouts",
        "Prototype pollution defense",
        "RFC 9457 problem+json",
        "Strict schema validation",
        "Boot misconfiguration guards",
      ],
    },
    zeroDeps: {
      title: "Zero runtime dependencies",
      body: "Installing @daloyjs/core adds exactly zero transitive packages. No postinstall scripts to audit and no surprise CVEs from dependencies you never chose. The framework adds no dependency tree of its own; your app's other dependencies are still yours to vet.",
      stat: {
        value: "0",
        label: "transitive packages in @daloyjs/core",
      },
    },
    supplyChain: {
      title: "Supply-chain-hardened scaffolds",
      body: "Pick pnpm in create-daloy and pnpm-workspace.yaml is already hardened: ignoreScripts blocks install-script payloads (not code that runs on import), a 24-hour minimumReleaseAge waits out freshly published bad versions that get caught in time, and verifyStoreIntegrity keeps installs honest. The optional security bundle adds hardened GitHub Actions, Dependabot, CODEOWNERS, SECURITY.md, lockfile source verification, non-root + tini container templates, and a daloy doctor production-posture validator.",
      badges: [
        "ignoreScripts",
        "24h minimumReleaseAge",
        "verifyStoreIntegrity",
        "Pinned SHA Actions",
        "daloy doctor audit",
      ],
    },
    aiNative: {
      title: "AI-native scaffolding",
      body: "Every project scaffolded by create-daloy includes an AGENTS.md and context skills, and these docs are readable over MCP. Coding agents that read AGENTS.md pick up your framework's conventions, routing rules, and security primitives without a prompt-engineering ritual.",
      badges: ["AGENTS.md included", "Context skills", "Readable over MCP"],
    },
    streaming: {
      title: "Streaming & observability",
      body: "Backpressure-safe SSE and NDJSON helpers, plus an OpenTelemetry tracing hook that emits HTTP server spans with semantic-convention attributes.",
      badges: [
        "Backpressure-safe SSE",
        "NDJSON streaming",
        "OTel HTTP server spans",
      ],
    },
    portable: {
      title: "Runtime-portable",
      body: "The core only sees Request → Response. Adapters live at the edge: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute, and AWS Lambda: same app, same tests.",
      badges: [
        "Node 24+",
        "Bun",
        "Deno",
        "Cloudflare Workers",
        "Vercel",
        "AWS Lambda",
      ],
    },
    contractFirst: {
      title: "Contract-first by design",
      body: "One route definition is the source of truth for validation, types, OpenAPI 3.1, the typed client, and built-in contract tests, so drift has fewer places to hide.",
      badges: [
        "Runtime validation",
        "OpenAPI 3.1 spec",
        "Hey API typed client",
        "Built-in contract tests",
      ],
    },
    typedClients: {
      title: "Hey API typed clients",
      body: "Run pnpm gen and get a fully typed fetch SDK, for any consumer, in any TS project, generated from your real spec. Or skip codegen with the in-process typed client.",
      badges: ["pnpm gen", "Zero config", "End-to-end typed fetch SDK"],
    },
    batteries: {
      title: "Batteries included",
      body: "Edge-friendly sessions, WebSockets that spend from the same rate-limit buckets as HTTP, structured logs, and graceful shutdown: the production plumbing you usually assemble from plugins, still with zero runtime dependencies.",
      badges: [
        "Edge sessions",
        "WebSocket rate limits",
        "Structured logs",
        "Graceful shutdown",
      ],
    },
  },
  benchmarks: {
    eyebrow: "Benchmarks & Performance",
    title: "The numbers, with the asterisks attached",
    body: "When AI agents loop tools and stream high-concurrency requests, throughput and cold-start latency become critical. DaloyJS ships security checks on by default, and these benchmarks measure performance with every guard active.",
  },
  mcp: {
    eyebrow: "Machine-Native: For AI Agents and Tools",
    title: "DaloyJS is MCP-ready",
    intro: (
      <>
        The{" "}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Model Context Protocol
        </a>{" "}
        (MCP) is the open standard AI agents like Claude, Cursor, and VS Code
        use to call tools and read docs. DaloyJS supports it on both ends: your
        app can become an MCP server, and these docs already are one.
      </>
    ),
    serverTitle: "Turn your API into an MCP server",
    serverBody: (
      <>
        DaloyJS builds MCP servers from <code>@daloyjs/core</code> alone, no
        SDK required: Streamable HTTP transport, input-schema validation, and a
        production boot guard that refuses to start when an MCP endpoint has no
        auth hook in its chain. It checks that the hook is there and, in
        production, that it ran on each request, not that it rejects anyone, so
        test your auth too.
      </>
    ),
    serverCta: "Build an MCP server →",
    serverSnippet: MCP_SERVER_SNIPPET,
    docsTitle: "Read these docs over MCP",
    docsBody:
      "A public, read-only endpoint your AI coding agent can search and read without copy and paste. No API key needed.",
    endpointTitle: "Endpoint",
    endpointBody: "Point any MCP-compatible client at this URL:",
    tools: {
      search_docs: "Keyword search across every docs page, ranked by relevance.",
      get_doc: "Read the full text of one page by its route or slug.",
      list_docs: "Browse every available documentation page in one call.",
    },
    configLabel: "Add it to your MCP client config",
    stdioNote: "Using a stdio-only client? Bridge it with",
  },
  contracts: {
    eyebrow: "Blast-Radius Boundaries",
    title: "Contracts as safety enclosures, not vanity syntax",
    body: "In an AI-first workflow, contracts are not an aesthetic luxury for humans: they are the machine-enforced boundary that prevents hallucinated data structures from leaking between components. One route contract strictly validates requests, bounds response payloads, and emits the live OpenAPI 3.1 spec and typed client.",
    helloWorld: HELLO_WORLD,
  },
  scalar: {
    title: "Scalar API reference, one line",
    body: (
      <>
        Scalar is the modern successor to Swagger UI: fast, clean,
        dark-mode-native, with built-in try-it requests. In DaloyJS it is the{" "}
        <em>default</em> docs UI, not a plugin: <code>docs: true</code> on the{" "}
        <code>App</code> constructor auto-mounts this page at{" "}
        <code>/docs</code> and the live OpenAPI 3.1 spec at{" "}
        <code>/openapi.json</code>.
      </>
    ),
    footer:
      "Generated from your route contracts, zero extra code. Prefer Swagger UI or Redoc? Both are one config field away.",
    guideCta: "OpenAPI & docs UI guide →",
  },
  comparison: {
    eyebrow: "Ecosystem Tradeoffs",
    title: "Competitor strengths, fewer tradeoffs",
    body: "DaloyJS is not trying to win one checkbox. It is trying to remove the glue work between the best ideas developers already like.",
    youWant: "You want",
    todayPrefix: "Today:",
    todaysBest: "Today's best-of",
    daloyGives: "What DaloyJS gives you",
    rows: [
      {
        want: "Portable supply-chain hardening for the apps you build",
        best: "pnpm defaults + zero-runtime-dep core",
        give: "Hardened pnpm install settings, source-verified lockfiles, SBOM + npm provenance",
      },
      {
        want: "Serverless / edge fit",
        best: "Hono",
        give: "Web-standard core, multi-runtime adapters",
      },
      {
        want: "Mature Node ops & docs",
        best: "Fastify",
        give: "Encapsulated plugins, structured logs, graceful shutdown",
      },
      {
        want: "Modern TS-first DX, Bun OK",
        best: "Elysia",
        give: "End-to-end typed handlers, typed context, typed client",
      },
      {
        want: "Best OpenAPI ergonomics",
        best: "FastAPI",
        give: "Built-in OpenAPI 3.1 from one route definition",
      },
      {
        want: "Best typed client codegen",
        best: "Hey API",
        give: "pnpm gen → fully typed fetch SDK",
      },
    ],
  },
  cta: {
    title: "Ready to ship with secure defaults?",
    body: "Scaffold a project in seconds with install hardening for your package manager, generated CI that blocks install scripts, pinned GitHub Actions, Dependabot, CODEOWNERS, and lockfile source verification. Then keep the contract as the app grows, the same app runs on Node, Bun, Deno, and Cloudflare Workers.",
    install: "Install DaloyJS",
    tutorial: "Build a bookstore API",
    source: "View source",
  },
  support: {
    eyebrow: "Support the project",
    title: "If DaloyJS saves you time, you can buy me a coffee",
    body: "DaloyJS is free and MIT-licensed. If the docs, posts, or the framework itself helped you ship something with a little less drama, coffee is a perfectly reasonable way to keep the work going.",
    coffee: "Buy me a coffee",
    blog: "Read the blog",
  },
};
