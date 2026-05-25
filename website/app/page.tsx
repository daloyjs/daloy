import Link from "next/link";
import {
  ArrowRightIcon,
  CubeIcon,
  FileCodeIcon,
  LightningIcon,
  LockIcon,
  RobotIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { CodeBlock } from "../components/code-block";
import { ContractFlowVisual } from "../components/contract-flow-visual";
import { FlowHeroScene } from "../components/flow-hero-scene";
import {
  buildMetadata,
  CORE_PACKAGE_VERSION,
  HOME_DESCRIPTION,
  HOME_TITLE,
  serializeJsonLd,
  SITE_URL,
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
  ],
});

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // global unless you configure keyGenerator or trustProxyHeaders

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: z.object({ id: z.string(), title: z.string() }) },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Book \${params.id}\` },
  }),
});

serve(app, { port: 3000 });`;

const CREATE_COMMAND = "pnpm create daloy@latest my-api";

const DEVELOPER_PITCH = [
  {
    icon: ShieldCheckIcon,
    title: "Security is the product",
    body: "Most frameworks leave supply-chain posture as a company checklist. DaloyJS puts runtime guardrails, pnpm hardening, CI hygiene, ownership files, and release discipline on the happy path from the first scaffold.",
  },
  {
    icon: FileCodeIcon,
    title: "One contract, fewer moving parts",
    body: "Define the route once and get validation, types, OpenAPI 3.1, Scalar docs, Hey API clients, and contract tests from the same source. Less glue code, fewer stale specs, fewer places for an agent or teammate to drift.",
  },
  {
    icon: CubeIcon,
    title: "Portable without giving up ops",
    body: "You get a web-standard core that runs on Node, Bun, Deno, Workers, and Edge, plus the production pieces teams expect: request ids, structured logs, plugin encapsulation, graceful shutdown, and first-party middleware.",
  },
  {
    icon: RobotIcon,
    title: "Built for AI-assisted teams",
    body: "LLMs make teams faster, and they also make attackers faster at finding dependency mistakes. DaloyJS assumes coding agents are in the loop and ships scaffolds with security defaults, agent guidance, and source-verified installs.",
  },
];

const FEATURES = [
  {
    icon: LockIcon,
    title: "Supply-chain-hardened pnpm scaffolds",
    body: "Pick pnpm in create-daloy and you get a hardened .npmrc out of the box: ignore-scripts=true blocks malicious post-install payloads, minimum-release-age=1440 waits out fresh-package attacks, and verify-store-integrity keeps installs honest. The optional GitHub Actions bundle adds lockfile source checks so git deps and non-registry tarballs cannot quietly sneak in.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Secure-by-default runtime",
    body: "Unlike frameworks that leave basic protections to plugins or manual error routing, the DaloyJS core starts with guardrails on: prototype-pollution-safe JSON, built-in load shedding, proper 405 Method Not Allowed responses, automatic 5xx info-disclosure stripping in production, and a rate-limited CSP violation receiver.",
  },
  {
    icon: RobotIcon,
    title: "Hardened against LLM-era attacks",
    body: "Attackers can use LLMs to scale package impersonation, slopsquatting, dependency reconnaissance, and vulnerability hunting. DaloyJS answers with boring but sharp defaults: blocked lifecycle scripts, delayed fresh-package resolution, source-verified lockfiles, and a zero-runtime-dependency core.",
  },
  {
    icon: RobotIcon,
    title: "AI-native scaffolding",
    body: "Every project scaffolded by create-daloy includes an AGENTS.md and context skills. Copilot, Claude, and Cursor automatically understand your framework's conventions, routing rules, and security primitives without a prompt-engineering ritual.",
  },
  {
    icon: FileCodeIcon,
    title: "Contract-first by design",
    body: "One route definition is the source of truth for validation, types, OpenAPI 3.1, the typed client, and built-in contract tests, so drift has fewer places to hide.",
  },
  {
    icon: CubeIcon,
    title: "Runtime-portable",
    body: "The core only sees Request → Response. Adapters live at the edge: Node, Bun, Deno, Cloudflare Workers, Vercel Edge — same app, same tests, five runtimes.",
  },
  {
    icon: RocketLaunchIcon,
    title: "Hey API typed clients",
    body: "Run pnpm gen and get a fully typed fetch SDK — for any consumer, in any TS project — generated from your real spec. Or skip codegen with the in-process typed client.",
  },
  {
    icon: LightningIcon,
    title: "Faster than you'd expect",
    body: "Static routes resolve via a single Map.get (~12.3M ops/sec). Dynamic routes walk a trie in O(segments) regardless of route count.",
  },
  {
    icon: RocketLaunchIcon,
    title: "Streaming & observability",
    body: "Backpressure-safe SSE and NDJSON helpers, plus an OpenTelemetry tracing hook that emits HTTP server spans with semantic-convention attributes.",
  },
  {
    icon: CubeIcon,
    title: "Hardened scaffolds, batteries included",
    body: "create-daloy's security bundle ships hardened GitHub Actions (top-level permissions:{}, persist-credentials:false, pinned actions, harden-runner), Dependabot, CODEOWNERS, SECURITY.md, lockfile verification, container templates with non-root + tini PID 1, and a daloy doctor production-posture validator.",
  },
];

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
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "DaloyJS",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform",
      description: HOME_DESCRIPTION,
      url: SITE_URL,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "DaloyJS",
      url: SITE_URL,
    },
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
            <Badge
              variant="outline"
              className="float-up gap-2 border border-mauve-200/80 bg-mauve-50/85 px-3 py-1 text-mauve-950 shadow-sm dark:border-mauve-800/70 dark:bg-mauve-950/25 dark:text-mauve-100 dim:border-mauve-900/60 dim:bg-mauve-950/20 dim:text-mauve-100"
              style={{ animationDelay: "0ms" }}
            >
              <span className="relative inline-flex size-1.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className='font-features-["tnum"]'>
                {`@daloyjs/core ${CORE_PACKAGE_VERSION}`}
              </span>
            </Badge>
            <h1
              className="float-up max-w-4xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl lg:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              The runtime-portable TypeScript framework with supply-chain-aware
              defaults
            </h1>
            <p
              className="float-up max-w-3xl text-base font-medium text-foreground/80 sm:text-lg"
              style={{ animationDelay: "120ms" }}
            >
              Secure-by-default runtime. Blocked install scripts.
              Source-verified lockfiles. Typed end-to-end. Optional hardened
              GitHub Actions bundle for teams on GitHub.
            </p>
            <ContractFlowVisual />
            <p
              className="float-up max-w-2xl text-lg leading-8 text-muted-foreground"
              style={{ animationDelay: "180ms" }}
            >
              Contract-first routing, Standard Schema validation, OpenAPI 3.1
              with Hey API typed client codegen, streaming and OpenTelemetry
              tracing, edge-friendly sessions, a security-focused runtime by
              default, and a supply-chain-hardened release pipeline for the
              framework itself. One line on the <code>App</code> constructor —{" "}
              <code>docs: true</code> — auto-mounts a Scalar API reference at{" "}
              <code>/docs</code> and the live OpenAPI 3.1 spec at{" "}
              <code>/openapi.json</code>, the same DX as FastAPI.
            </p>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy
              means <span className="text-foreground">flow</span> in Tagalog,
              pronounced{" "}
              <span className="whitespace-nowrap text-foreground">da-loy</span>.{" "}
              <Link
                href="/about-the-name"
                className="underline underline-offset-4"
              >
                About the name
              </Link>
            </p>
            <div
              className="float-up mt-4 flex flex-col gap-3 sm:flex-row"
              style={{ animationDelay: "320ms" }}
            >
              <Link
                href="/docs/getting-started"
                transitionTypes={["nav-forward"]}
                className={buttonVariants({ size: "lg" }) + " group"}
              >
                Get started
                <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/docs"
                transitionTypes={["nav-forward"]}
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                Read the docs
              </Link>
            </div>
            <div
              className="float-up flex items-center gap-2 rounded-md border border-taupe-200/80 bg-taupe-50/85 px-3 py-2 text-taupe-950 shadow-sm dark:border-taupe-900/70 dark:bg-taupe-950/25 dark:text-taupe-100 dim:border-mist-900/60 dim:bg-mist-950/20 dim:text-mist-100"
              style={{ animationDelay: "380ms" }}
            >
              <code className="text-sm">$ {CREATE_COMMAND}</code>
            </div>
            <div className='flex flex-wrap justify-center gap-x-6 gap-y-2 font-features-["tnum"] text-xs text-muted-foreground'>
              <span>1,184/1,184 tests passing</span>
              <span aria-hidden>·</span>
              <span>≥90% line, function, and branch coverage gates</span>
              <span aria-hidden>·</span>
              <span>Node 24+, Bun, Deno, Cloudflare, Vercel</span>
            </div>
          </div>
        </div>
      </section>

      {/* Developer pitch */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Why developers pick DaloyJS
            </h2>
            <p className="mx-auto mt-3 max-w-3xl leading-8 text-muted-foreground">
              The pitch is simple: keep the delightful parts of the modern web
              framework ecosystem, then move security and supply-chain posture
              from &quot;later&quot; to &quot;already handled.&quot; That is the
              difference.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {DEVELOPER_PITCH.map((item, index) => {
              const accent = FEATURE_ACCENTS[index % FEATURE_ACCENTS.length];

              return (
                <Card
                  key={item.title}
                  className={`${accent.card} group float-up transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg`}
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <CardHeader>
                    <span
                      className={`${accent.icon} mb-2 inline-flex size-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110`}
                    >
                      <item.icon className="size-6" />
                    </span>
                    <CardTitle>{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      {item.body}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Hello world */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div
            className="float-up mb-8 text-center"
            style={{ animationDelay: "80ms" }}
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Hello, contract
            </h2>
            <p className="mt-3 leading-8 text-muted-foreground">
              One route — types, validation, OpenAPI, and the typed client all
              generated from it.
            </p>
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

      {/* Features */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Why DaloyJS</h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              The JS framework that is <strong>secure by default</strong> at the
              runtime layer — and ships <code>create-daloy</code> with pnpm
              install-time hardening and an optional hardened GitHub Actions
              bundle, so the app-safe pieces of the LLM-era supply-chain defense
              are on the happy path without giving up OpenAPI ergonomics,
              runtime portability, typed clients, or Node ops.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) =>
              (() => {
                const accent = FEATURE_ACCENTS[i % FEATURE_ACCENTS.length];

                return (
                  <Card
                    key={f.title}
                    className={`${accent.card} group float-up transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg`}
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
                    <CardContent>
                      <CardDescription className="text-sm leading-relaxed">
                        {f.body}
                      </CardDescription>
                    </CardContent>
                  </Card>
                );
              })()
            )}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="mb-2 text-center text-3xl font-bold tracking-tight">
            Competitor strengths, fewer tradeoffs
          </h2>
          <p className="mb-10 text-center leading-8 text-muted-foreground">
            DaloyJS is not trying to win one checkbox. It is trying to remove
            the glue work between the best ideas developers already like.
          </p>
          <div className="scrollbar-thin scrollbar-thumb-mist-300 scrollbar-track-transparent overflow-x-auto rounded-lg border dark:scrollbar-thumb-mist-700 dim:scrollbar-thumb-mist-800">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">You want</th>
                  <th className="p-3 text-left">Today&apos;s best-of</th>
                  <th className="p-3 text-left">What DaloyJS gives you</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Best OpenAPI ergonomics",
                    "FastAPI",
                    "Built-in OpenAPI 3.1 from one route definition",
                  ],
                  [
                    "Vercel / serverless / edge fit",
                    "Hono",
                    "Web-standard core, multi-runtime adapters",
                  ],
                  [
                    "Mature Node ops & docs",
                    "Fastify",
                    "Encapsulated plugins, structured logs, graceful shutdown",
                  ],
                  [
                    "Modern TS-first DX, Bun OK",
                    "Elysia",
                    "End-to-end typed handlers, typed context, typed client",
                  ],
                  [
                    "Best typed client codegen",
                    "Hey API",
                    "pnpm gen → fully typed fetch SDK",
                  ],
                  [
                    "Portable supply-chain hardening for the apps you build",
                    "pnpm defaults + zero-runtime-dep core",
                    "Hardened .npmrc, source-verified lockfiles, SBOM + npm provenance",
                  ],
                ].map(([want, best, give]) => (
                  <tr key={want} className="border-t">
                    <td className="p-3 font-medium">{want}</td>
                    <td className="p-3 text-muted-foreground">{best}</td>
                    <td className="p-3">{give}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight">
            Ready to ship — secure by default?
          </h2>
          <p className="mb-8 leading-8 text-muted-foreground">
            Scaffold a project in seconds with pnpm hardening when you choose
            pnpm, generated CI that blocks install scripts, pinned GitHub
            Actions, Dependabot, CODEOWNERS, and lockfile source verification.
            Then keep the contract as the app grows — the same app runs on Node,
            Bun, Deno, Cloudflare Workers, and Vercel Edge.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/docs/installation"
              transitionTypes={["nav-forward"]}
              className={buttonVariants({ size: "lg" })}
            >
              Install DaloyJS
            </Link>
            <Link
              href="/docs/tutorials/bookstore"
              transitionTypes={["nav-forward"]}
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
    </main>
  );
}
