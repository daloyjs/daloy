import type { Route } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  BroadcastIcon,
  CubeIcon,
  FileCodeIcon,
  GlobeIcon,
  LockIcon,
  PackageIcon,
  PlugsConnectedIcon,
  SparkleIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { BenchmarkCharts } from "../components/benchmark-charts";
import { CodeBlock } from "../components/code-block";
import { CodeCopyButton } from "../components/code-copy-button";
import { ContractFlowVisual } from "../components/contract-flow-visual";
import { FlowHeroScene } from "../components/flow-hero-scene";
import { ScalarPreview } from "../components/scalar-preview";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
  HOME_DESCRIPTION,
  HOME_TITLE,
  serializeJsonLd,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  path: "/",
  keywords: [
    "DaloyJS",
    "secure by default",
    "secure-by-default framework",
    "secure JavaScript framework",
    "portable supply-chain hardening",
    "supply-chain attack protection",
    "slopsquatting protection",
    "AI-era supply chain security",
    "vibe coding security",
    "secure vibe coding framework",
    "AI-generated code security",
    "runtime-portable framework",
    "TypeScript HTTP framework",
    "contract-first TypeScript",
    "OpenAPI 3.1 framework",
    "edge framework",
    "OpenTelemetry tracing",
    "SSE NDJSON streaming",
    "blocked install scripts",
    "source-verified lockfiles",
    "zero runtime dependencies",
    "hardened GitHub Actions bundle",
    "create-daloy",
    "MCP endpoint",
    "Model Context Protocol",
    "MCP documentation server",
    "AI agent docs",
  ],
});

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

const CREATE_COMMAND = "pnpm create daloy@latest my-api";

const HERO_FACTS = [
  "3,000+ framework tests passing",
  "≥90% line/function and ≥92% branch coverage gates",
  "0 runtime dependencies",
  "Node 24 LTS, Node 26+, Bun, Deno, Cloudflare",
  "MIT licensed",
] as const;

const MCP_ENDPOINT_URL = "https://daloyjs.dev/mcp";

const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "daloyjs-docs": {
      "url": "https://daloyjs.dev/mcp"
    }
  }
}`;

const MCP_TOOLS = [
  {
    name: "search_docs",
    body: "Keyword search across every docs page, ranked by relevance.",
  },
  {
    name: "get_doc",
    body: "Read the full text of one page by its route or slug.",
  },
  {
    name: "list_docs",
    body: "Browse every available documentation page in one call.",
  },
] as const;

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

interface Feature {
  icon: typeof ShieldCheckIcon;
  title: string;
  body: string;
  span?: string;
  badges?: readonly string[];
  stat?: { value: string; label: string };
}

const FEATURES: readonly Feature[] = [
  {
    icon: ShieldCheckIcon,
    title: "Secure runtime defaults",
    body: "Unlike frameworks that leave basic protections to plugins or manual error routing, the DaloyJS core starts with guardrails on: body limits, request timeouts, prototype-pollution-safe JSON, proper 405 Method Not Allowed responses, and 5xx detail redaction that fails closed (on everywhere except an explicit development or test environment). In production it refuses to boot on the misconfigurations it knows about, such as weak session secrets or session cookies without CSRF.",
    span: "md:col-span-2 lg:col-span-2",
    badges: [
      "Body limits (1 MiB default)",
      "Request timeouts",
      "Prototype pollution defense",
      "RFC 9457 problem+json",
      "Strict schema validation",
      "Boot misconfiguration guards",
    ],
  },
  {
    icon: PackageIcon,
    title: "Zero runtime dependencies",
    body: "Installing @daloyjs/core adds exactly zero transitive packages. No postinstall scripts to audit and no surprise CVEs from dependencies you never chose. The framework adds no dependency tree of its own; your app's other dependencies are still yours to vet.",
    span: "lg:col-span-1",
    stat: {
      value: "0",
      label: "transitive packages in @daloyjs/core",
    },
  },
  {
    icon: LockIcon,
    title: "Supply-chain-hardened scaffolds",
    body: "Pick pnpm in create-daloy and pnpm-workspace.yaml is already hardened: ignoreScripts blocks install-script payloads (not code that runs on import), a 24-hour minimumReleaseAge waits out freshly published bad versions that get caught in time, and verifyStoreIntegrity keeps installs honest. The optional security bundle adds hardened GitHub Actions, Dependabot, CODEOWNERS, SECURITY.md, lockfile source verification, non-root + tini container templates, and a daloy doctor production-posture validator.",
    span: "lg:col-span-2",
    badges: [
      "ignoreScripts",
      "24h minimumReleaseAge",
      "verifyStoreIntegrity",
      "Pinned SHA Actions",
      "daloy doctor audit",
    ],
  },
  {
    icon: SparkleIcon,
    title: "AI-native scaffolding",
    body: "Every project scaffolded by create-daloy includes an AGENTS.md and context skills, and these docs are readable over MCP. Coding agents that read AGENTS.md pick up your framework's conventions, routing rules, and security primitives without a prompt-engineering ritual.",
    span: "lg:col-span-1",
    badges: ["AGENTS.md included", "Context skills", "Readable over MCP"],
  },
  {
    icon: BroadcastIcon,
    title: "Streaming & observability",
    body: "Backpressure-safe SSE and NDJSON helpers, plus an OpenTelemetry tracing hook that emits HTTP server spans with semantic-convention attributes.",
    span: "lg:col-span-1",
    badges: [
      "Backpressure-safe SSE",
      "NDJSON streaming",
      "OTel HTTP server spans",
    ],
  },
  {
    icon: GlobeIcon,
    title: "Runtime-portable",
    body: "The core only sees Request → Response. Adapters live at the edge: Node, Bun, Deno, Cloudflare Workers, Vercel, Fastly Compute, and AWS Lambda: same app, same tests.",
    span: "lg:col-span-1",
    badges: [
      "Node 24+",
      "Bun",
      "Deno",
      "Cloudflare Workers",
      "Vercel",
      "AWS Lambda",
    ],
  },
  {
    icon: FileCodeIcon,
    title: "Contract-first by design",
    body: "One route definition is the source of truth for validation, types, OpenAPI 3.1, the typed client, and built-in contract tests, so drift has fewer places to hide.",
    span: "lg:col-span-1",
    badges: [
      "Runtime validation",
      "OpenAPI 3.1 spec",
      "Hey API typed client",
      "Built-in contract tests",
    ],
  },
  {
    icon: RocketLaunchIcon,
    title: "Hey API typed clients",
    body: "Run pnpm gen and get a fully typed fetch SDK, for any consumer, in any TS project, generated from your real spec. Or skip codegen with the in-process typed client.",
    span: "lg:col-span-1",
    badges: ["pnpm gen", "Zero config", "End-to-end typed fetch SDK"],
  },
  {
    icon: CubeIcon,
    title: "Batteries included",
    body: "Edge-friendly sessions, WebSockets that spend from the same rate-limit buckets as HTTP, structured logs, and graceful shutdown: the production plumbing you usually assemble from plugins, still with zero runtime dependencies.",
    span: "lg:col-span-2",
    badges: [
      "Edge sessions",
      "WebSocket rate limits",
      "Structured logs",
      "Graceful shutdown",
    ],
  },
];

const COMPARISON_ROWS = [
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
] as const;

const FEATURE_ACCENTS = [
  {
    card: "border border-mauve-200/70 bg-mauve-50/60 dark:border-mauve-900/70 dark:bg-mauve-950/18 dim:border-mauve-900/60 dim:bg-mauve-950/15",
    icon: "bg-mauve-100 text-mauve-700 ring-1 ring-mauve-200/80 dark:bg-mauve-950/40 dark:text-mauve-200 dark:ring-mauve-800/70 dim:bg-mauve-950/35 dim:text-mauve-100",
  },
  {
    card: "border border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15",
    icon: "bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100",
  },
  {
    card: "border border-mist-200/75 bg-mist-50/65 dark:border-mist-900/70 dark:bg-mist-950/18 dim:border-mist-900/60 dim:bg-mist-950/15",
    icon: "bg-mist-100 text-mist-700 ring-1 ring-mist-200/80 dark:bg-mist-950/40 dark:text-mist-200 dark:ring-mist-800/70 dim:bg-mist-950/35 dim:text-mist-100",
  },
  {
    card: "border border-taupe-200/70 bg-taupe-50/60 dark:border-taupe-900/70 dark:bg-taupe-950/18 dim:border-taupe-900/60 dim:bg-taupe-950/15",
    icon: "bg-taupe-100 text-taupe-700 ring-1 ring-taupe-200/80 dark:bg-taupe-950/40 dark:text-taupe-200 dark:ring-taupe-800/70 dim:bg-taupe-950/35 dim:text-taupe-100",
  },
] as const;

export default function HomePage() {
  // Connected entity graph for search engines. The goal is entity
  // *disambiguation*: explicit `alternateName` spellings plus `sameAs` links to
  // the canonical GitHub/npm/JSR/social profiles tell Google that "DaloyJS" is a
  // distinct named entity, not a misspelling of the similarly named "dayjs".
  // `@id` references connect the Organization, WebSite, and SoftwareApplication
  // into one graph rather than three unrelated nodes. Organization includes
  // contactPoint + PostalAddress so agents can verify the project is real.
  const jsonLd = [
    buildOrganizationJsonLd(),
    buildWebSiteJsonLd(),
    buildSoftwareApplicationJsonLd(),
  ];

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      {/* Hero */}
      <section className="relative isolate overflow-hidden border-b bg-background">
        <FlowHeroScene />
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-12 lg:py-16">
          <div className="flex flex-col items-center gap-5 text-center">
            <h1
              className="float-up max-w-4xl text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              Contract-first TypeScript REST APIs with secure defaults,
              built for AI-assisted teams
            </h1>
            <h2
              className="float-up max-w-3xl text-base font-medium text-foreground/80 text-pretty sm:text-lg"
              style={{ animationDelay: "120ms" }}
            >
              DaloyJS ships secure defaults, refuses to start in production on
              the misconfigurations it knows about, and runs with zero runtime
              dependencies and a hardened, provenance-signed publish pipeline.
              No framework makes an app fully secure or stops every
              supply-chain attack, so the docs say what is on by default, what
              you turn on, and the risks that remain.
            </h2>
            <div
              className="float-up mt-2 flex flex-col gap-3 sm:flex-row"
              style={{ animationDelay: "160ms" }}
            >
              <Link
                href="/docs/getting-started"
                className={buttonVariants({ size: "lg" }) + " group"}
              >
                Get started: Install Daloy
                <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/docs"
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                Read the docs
              </Link>
            </div>
            <div
              className="float-up flex max-w-full items-center gap-2 rounded-md border border-taupe-200/80 bg-taupe-50/85 px-3 py-2 text-taupe-950 shadow-sm dark:border-taupe-900/70 dark:bg-taupe-950/25 dark:text-taupe-100 dim:border-mist-900/60 dim:bg-mist-950/20 dim:text-mist-100"
              style={{ animationDelay: "200ms" }}
            >
              <code className="overflow-x-auto text-sm whitespace-nowrap">
                $ {CREATE_COMMAND}
              </code>
              <CodeCopyButton code={CREATE_COMMAND} />
            </div>
            <ul
              aria-label="Project facts"
              className='float-up flex flex-wrap justify-center gap-2 font-features-["tnum"] text-xs text-muted-foreground'
              style={{ animationDelay: "240ms" }}
            >
              {HERO_FACTS.map((fact) => (
                <li
                  key={fact}
                  className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-1"
                >
                  {fact}
                </li>
              ))}
            </ul>
            <div
              className="float-up mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground"
              style={{ animationDelay: "280ms" }}
            >
              <span>
                <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
                means <span className="text-foreground">flow</span> in Tagalog
                (pronounced{" "}
                <span className="whitespace-nowrap text-foreground">da-loy</span>
                ).
              </span>
              <span aria-hidden className="text-border">•</span>
              <Link
                href={"/about" as Route}
                className="underline underline-offset-4 hover:text-foreground"
              >
                About
              </Link>
              <span aria-hidden className="text-border">•</span>
              <Link
                href="/about-the-name"
                className="underline underline-offset-4 hover:text-foreground"
              >
                The name
              </Link>
              <span aria-hidden className="text-border">•</span>
              <Link
                href="/docs/tutorials/bookstore"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Bookstore tutorial
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Architecture - Bento Grid */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Security &amp; Supply Chain
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              Security defaults: the defense layer for AI-generated code
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              When AI models generate code, developer typing speed is not the
              bottleneck: runtime safety and supply-chain integrity are. DaloyJS
              enforces guardrails at the runtime layer: request body limits,
              timeouts, prototype-pollution protection, 5xx detail redactions,
              and boot-time misconfiguration refusals, with zero transitive
              dependencies to exploit.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const accent = FEATURE_ACCENTS[i % FEATURE_ACCENTS.length];

              return (
                <Card
                  key={f.title}
                  className={`${accent.card} ${f.span ?? "lg:col-span-1"} group float-up transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <CardHeader>
                    <span
                      className={`${accent.icon} mb-2 inline-flex size-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110`}
                    >
                      <f.icon className="size-6" />
                    </span>
                    <CardTitle>{f.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <CardDescription className="text-sm leading-relaxed">
                      {f.body}
                    </CardDescription>
                  </CardContent>
                  {f.badges && f.badges.length > 0 && (
                    <CardFooter className="flex-wrap gap-1.5">
                      {f.badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-md border border-border/70 bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground/80 dark:bg-background/50"
                        >
                          {badge}
                        </span>
                      ))}
                    </CardFooter>
                  )}
                  {f.stat && (
                    <CardFooter>
                      <div className="flex w-full items-baseline gap-2.5 rounded-lg border border-border/60 bg-background/60 px-3 py-2 dark:bg-background/40">
                        <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground">
                          {f.stat.value}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {f.stat.label}
                        </span>
                      </div>
                    </CardFooter>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benchmarks & Performance */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Benchmarks &amp; Performance
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              The numbers, with the asterisks attached
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              When AI agents loop tools and stream high-concurrency requests,
              throughput and cold-start latency become critical. DaloyJS ships
              security checks on by default, and these benchmarks measure
              performance with every guard active.
            </p>
          </div>
          <BenchmarkCharts />
        </div>
      </section>

      {/* MCP - AI Agent Integration */}
      <section id="mcp" className="border-b scroll-mt-20">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Machine-Native: For AI Agents and Tools
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              DaloyJS is MCP-ready
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-muted-foreground">
              The{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Model Context Protocol
              </a>{" "}
              (MCP) is the open standard AI agents like Claude, Cursor, and VS
              Code use to call tools and read docs. DaloyJS supports it on both
              ends: your app can become an MCP server, and these docs already
              are one.
            </p>
          </div>

          <Card className="mb-10 border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15">
            <CardContent className="grid gap-8 pt-2 lg:grid-cols-2 lg:items-center">
              <div className="flex flex-col gap-4">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100">
                  <PlugsConnectedIcon className="size-6" />
                </span>
                <h3 className="text-xl font-bold tracking-tight">
                  Turn your API into an MCP server
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  DaloyJS builds MCP servers from <code>@daloyjs/core</code>{" "}
                  alone, no SDK required: Streamable HTTP transport,
                  input-schema validation, and a production boot guard that
                  refuses to start when an MCP endpoint has no auth hook in
                  its chain. It checks that the hook is there and, in
                  production, that it ran on each request, not that it
                  rejects anyone, so test your auth too.
                </p>
                <Link
                  href="/docs/mcp"
                  className="text-sm font-medium underline underline-offset-4"
                >
                  Build an MCP server →
                </Link>
              </div>
              <CodeBlock
                code={MCP_SERVER_SNIPPET}
                language="ts"
                showCopyButton={false}
              />
            </CardContent>
          </Card>

          <div className="mb-6 text-center">
            <h3 className="text-xl font-bold tracking-tight">
              Read these docs over MCP
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              A public, read-only endpoint your AI coding agent can search and
              read without copy and paste. No API key needed.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
            <Card className="flex flex-col border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15">
              <CardHeader>
                <span className="mb-2 inline-flex size-11 items-center justify-center rounded-xl bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100">
                  <SparkleIcon className="size-6" />
                </span>
                <CardTitle>Endpoint</CardTitle>
                <CardDescription>
                  Point any MCP-compatible client at this URL:
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="flex items-center justify-between gap-2 rounded-md border border-taupe-200/80 bg-taupe-50/85 px-3 py-2 text-taupe-950 shadow-sm dark:border-taupe-900/70 dark:bg-taupe-950/25 dark:text-taupe-100 dim:border-mist-900/60 dim:bg-mist-950/20 dim:text-mist-100">
                  <code className="text-sm break-all">{MCP_ENDPOINT_URL}</code>
                  <CodeCopyButton code={MCP_ENDPOINT_URL} />
                </div>
                <ul className="flex flex-col gap-3 text-sm">
                  {MCP_TOOLS.map((tool) => (
                    <li key={tool.name} className="flex flex-col gap-0.5">
                      <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {tool.name}
                      </code>
                      <span className="text-muted-foreground">{tool.body}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-foreground">
                Add it to your MCP client config
              </p>
              <CodeBlock code={MCP_CLIENT_CONFIG} language="json" />
              <p className="text-sm leading-6 text-muted-foreground">
                Using a stdio-only client? Bridge it with{" "}
                <code>npx -y mcp-remote {MCP_ENDPOINT_URL}</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contracts as Blast-Radius Safety Boundaries */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div
            className="float-up mb-8 text-center"
            style={{ animationDelay: "80ms" }}
          >
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Blast-Radius Boundaries
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              Contracts as safety enclosures, not vanity syntax
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              In an AI-first workflow, contracts are not an aesthetic luxury for
              humans: they are the machine-enforced boundary that prevents
              hallucinated data structures from leaking between components. One
              route contract strictly validates requests, bounds response
              payloads, and emits the live OpenAPI 3.1 spec and typed client.
            </p>
          </div>
          <div className="mb-8">
            <ContractFlowVisual />
          </div>
          <div className="float-up" style={{ animationDelay: "120ms" }}>
            <CodeBlock
              code={HELLO_WORLD}
              language="ts"
              showCopyButton={false}
            />
          </div>
        </div>
      </section>

      {/* Scalar docs */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-10 flex flex-col items-center gap-3 text-center">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-mist-100 text-mist-700 ring-1 ring-mist-200/80 dark:bg-mist-950/40 dark:text-mist-200 dark:ring-mist-800/70 dim:bg-mist-950/35 dim:text-mist-100">
              <BookOpenTextIcon className="size-6" />
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-balance">
              Scalar API reference, one line
            </h2>
            <p className="max-w-3xl leading-8 text-muted-foreground">
              Scalar is the modern successor to Swagger UI: fast, clean,
              dark-mode-native, with built-in try-it requests. In DaloyJS it is
              the <em>default</em> docs UI, not a plugin:{" "}
              <code>docs: true</code> on the <code>App</code> constructor
              auto-mounts this page at <code>/docs</code> and the live OpenAPI
              3.1 spec at <code>/openapi.json</code>.
            </p>
          </div>
          <ScalarPreview />
          <p className="mt-4 text-center text-sm leading-6 text-muted-foreground">
            Generated from your route contracts, zero extra code. Prefer Swagger
            UI or Redoc? Both are one config field away.{" "}
            <Link
              href="/docs/openapi"
              className="font-medium text-foreground underline underline-offset-4"
            >
              OpenAPI &amp; docs UI guide →
            </Link>
          </p>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Ecosystem Tradeoffs
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              Competitor strengths, fewer tradeoffs
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              DaloyJS is not trying to win one checkbox. It is trying to remove
              the glue work between the best ideas developers already like.
            </p>
          </div>

          {/* Mobile view: Stacked card format */}
          <div className="space-y-4 md:hidden">
            {COMPARISON_ROWS.map((row) => (
              <div
                key={row.want}
                className="rounded-xl border border-border/80 bg-card p-4 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    You want
                  </span>
                  <span className="rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Today: {row.best}
                  </span>
                </div>
                <p className="mt-1.5 font-semibold text-foreground">
                  {row.want}
                </p>
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <span className="mb-1 block text-[11px] font-semibold tracking-wider text-foreground/70 uppercase">
                    What DaloyJS gives you
                  </span>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {row.give}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop view: Structured table */}
          <div className="hidden scrollbar-thin scrollbar-thumb-mist-300 scrollbar-track-transparent overflow-x-auto rounded-lg border md:block dark:scrollbar-thumb-mist-700 dim:scrollbar-thumb-mist-800">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">You want</th>
                  <th className="p-3 text-left">Today&apos;s best-of</th>
                  <th className="p-3 text-left">What DaloyJS gives you</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.want} className="border-t">
                    <td className="p-3 font-medium">{row.want}</td>
                    <td className="p-3 text-muted-foreground">{row.best}</td>
                    <td className="p-3">{row.give}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-balance">
            Ready to ship with secure defaults?
          </h2>
          <p className="mb-8 leading-8 text-muted-foreground">
            Scaffold a project in seconds with install hardening for your
            package manager, generated CI that blocks install scripts, pinned GitHub
            Actions, Dependabot, CODEOWNERS, and lockfile source verification.
            Then keep the contract as the app grows, the same app runs on Node,
            Bun, Deno, and Cloudflare Workers.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/docs/installation"
              className={buttonVariants({ size: "lg" })}
            >
              Install DaloyJS
            </Link>
            <Link
              href="/docs/tutorials/bookstore"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              Build a bookstore API
            </Link>
            <a
              href="https://github.com/daloyjs/daloy"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              View source
            </a>
          </div>
        </div>
      </section>

      {/* Support */}
      <section className="border-b bg-mauve-50/35 dark:bg-mauve-950/10 dim:bg-mauve-950/10">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <div className="rounded-3xl border border-mauve-200/70 bg-background/90 p-8 text-center shadow-sm dark:border-mauve-900/70 dark:bg-background/80">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Support the project
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              If DaloyJS saves you time, you can buy me a coffee
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-muted-foreground">
              DaloyJS is free and MIT-licensed. If the docs, posts, or the
              framework itself helped you ship something with a little less
              drama, coffee is a perfectly reasonable way to keep the work
              going.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="https://buymeacoffee.com/daloyjs"
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ size: "lg" })}
              >
                Buy me a coffee
              </a>
              <Link
                href="/blog"
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                Read the blog
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
