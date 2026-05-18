import Link from "next/link";
import {
  ArrowRightIcon,
  CubeIcon,
  FileCodeIcon,
  LightningIcon,
  LockIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { CodeBlock } from "../components/code-block";
import { ContractFlowVisual } from "../components/contract-flow-visual";
import { FlowHeroScene } from "../components/flow-hero-scene";
import { buildMetadata, CORE_PACKAGE_VERSION, SITE_URL } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Runtime-portable TypeScript web framework",
  description:
    "DaloyJS is a runtime-portable TypeScript web framework with contract-first routing, Standard Schema validation, OpenAPI 3.1 generation, a typed client, streaming and OpenTelemetry tracing, edge-friendly sessions, core-enforced security guardrails, and supply-chain controls. Run on Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge.",
  path: "/",
  keywords: [
    "DaloyJS",
    "runtime-portable framework",
    "TypeScript HTTP framework",
    "contract-first TypeScript",
    "OpenAPI 3.1 framework",
    "edge framework",
    "OpenTelemetry tracing",
    "SSE NDJSON streaming",
    "supply-chain hardened",
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

const FEATURES = [
  {
    icon: FileCodeIcon,
    title: "Contract-first by design",
    body: "One route definition is the source of truth for validation, types, OpenAPI 3.1, the typed client, and contract tests, so drift has fewer places to hide.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Security guardrails built in",
    body: "The core enforces body limits, prototype-pollution-safe JSON, path-traversal rejection, request timeouts, content-type checks, and production 5xx redaction. First-party middleware adds secure headers, CSRF, rate limits, and signed-cookie sessions.",
  },
  {
    icon: LightningIcon,
    title: "Faster than you'd expect",
    body: "Static routes resolve via a single Map.get (~12.3M ops/sec). Dynamic routes walk a trie in O(segments) regardless of route count.",
  },
  {
    icon: CubeIcon,
    title: "Runtime-portable",
    body: "The core only sees Request → Response. Adapters live at the edge: Node, Bun, Deno, Cloudflare Workers, Vercel Edge.",
  },
  {
    icon: RocketLaunchIcon,
    title: "Streaming & observability",
    body: "Backpressure-safe SSE and NDJSON helpers, plus an OpenTelemetry tracing hook that emits HTTP server spans with semantic-convention attributes.",
  },
  {
    icon: RocketLaunchIcon,
    title: "Hey API typed clients",
    body: "Run pnpm gen and get a fully typed fetch SDK — for any consumer, in any TS project — generated from your real spec. Or skip codegen with the in-process typed client.",
  },
  {
    icon: LockIcon,
    title: "Supply-chain hardened",
    body: "Backed by pnpm plus hardened repo defaults: blocked lifecycle scripts, release-age cooldowns, verified installs, SHA-pinned CI actions, and OIDC trusted publishing with provenance.",
  },
  {
    icon: CubeIcon,
    title: "Project ops included",
    body: "pnpm create daloy scaffolder (Node, Bun, Deno, Vercel Edge, Cloudflare Worker), a daloy inspect CLI, multipart with typed file fields, and a Redis rate-limit store.",
  },
];

export default function HomePage() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "DaloyJS",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform",
      description:
        "Runtime-portable TypeScript web framework with contract-first routing, Standard Schema validation, OpenAPI 3.1 generation, typed clients, streaming, OpenTelemetry tracing, edge-friendly sessions, core-enforced security guardrails, and first-party security middleware.",
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
         
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero */}
      <section className="relative isolate overflow-hidden border-b bg-background">
        <FlowHeroScene />
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-12 lg:py-16">
          <div className="flex flex-col items-center text-center gap-5">
            <Badge variant="outline" className="gap-2 float-up" style={{ animationDelay: "0ms" }}>
              <span className="relative inline-flex size-1.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              {`@daloyjs/core ${CORE_PACKAGE_VERSION}`}
            </Badge>
            <h1
              className="max-w-4xl text-4xl font-bold tracking-tight leading-tight sm:text-5xl lg:text-6xl float-up"
              style={{ animationDelay: "80ms" }}
            >
              The runtime-portable TypeScript web framework
            </h1>
            <ContractFlowVisual />
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground float-up" style={{ animationDelay: "180ms" }}>
              Contract-first routing, Standard Schema validation, OpenAPI 3.1 with Hey API typed
              client codegen, streaming and OpenTelemetry tracing, edge-friendly sessions, a
              security-focused runtime by default, and a supply-chain-hardened release pipeline
              for the framework itself.
            </p>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔</span> Daloy means{" "}
              <span className="text-foreground">flow</span> in Tagalog, pronounced{" "}
              <span className="whitespace-nowrap text-foreground">da-loy</span>.{" "}
              <Link href="/about-the-name" className="underline underline-offset-4">
                About the name
              </Link>
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-4 float-up" style={{ animationDelay: "320ms" }}>
              <Link href="/docs/getting-started" transitionTypes={["nav-forward"]} className={buttonVariants({ size: "lg" }) + " group"}>
                Get started
                <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link href="/docs" transitionTypes={["nav-forward"]} className={buttonVariants({ size: "lg", variant: "outline" })}>
                Read the docs
              </Link>
            </div>
            <div className="float-up flex items-center gap-2 rounded-md border bg-muted/70 px-3 py-2" style={{ animationDelay: "380ms" }}>
              <code className="text-sm">$ {CREATE_COMMAND}</code>
            </div>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span>320/320 tests passing</span>
              <span aria-hidden>·</span>
              <span>100% line + function coverage</span>
              <span aria-hidden>·</span>
              <span>strict TypeScript 6</span>
              <span aria-hidden>·</span>
              <span>Node 24.15+, Bun, Deno, Cloudflare, Vercel</span>
            </div>
          </div>
        </div>
      </section>

      {/* Hello world */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-8 text-center float-up" style={{ animationDelay: "80ms" }}>
            <h2 className="text-3xl font-bold tracking-tight">Hello, contract</h2>
            <p className="mt-3 text-muted-foreground leading-8">
              One route — types, validation, OpenAPI, and the typed client all generated from it.
            </p>
          </div>
          <div className="float-up" style={{ animationDelay: "120ms" }}>
            <CodeBlock code={HELLO_WORLD} language="ts" showCopyButton={false} />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight">Why DaloyJS</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground leading-8">
              Take the best ideas from each modern stack without having to choose only one axis:
              OpenAPI ergonomics, runtime portability, typed clients, Node ops, and real security guardrails.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Card
                key={f.title}
                className="group float-up transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary/40"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <CardHeader>
                  <f.icon className="size-6 text-primary mb-2 transition-transform duration-300 group-hover:scale-110" />
                  <CardTitle>{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">{f.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
            Proven ideas, one contract
          </h2>
          <p className="mb-10 text-center text-muted-foreground leading-8">
            DaloyJS is inspired by the strongest parts of modern web stacks and makes the route
            definition the place where they meet.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3">You want</th>
                  <th className="text-left p-3">Today&apos;s best-of</th>
                  <th className="text-left p-3">What DaloyJS gives you</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Best OpenAPI ergonomics", "FastAPI", "Built-in OpenAPI 3.1 from one route definition"],
                  ["Vercel / serverless / edge fit", "Hono", "Web-standard core, multi-runtime adapters"],
                  ["Mature Node ops & docs", "Fastify", "Encapsulated plugins, structured logs, graceful shutdown"],
                  ["Modern TS-first DX, Bun OK", "Elysia", "End-to-end typed handlers, typed context, typed client"],
                  ["Best typed client codegen", "Hey API", "pnpm gen → fully typed fetch SDK"],
                  [
                    "Supply-chain-hardened installs and publishing",
                    "pnpm + hardened CI/CD",
                    "Blocked scripts, release-age cooldowns, SHA-pinned actions, and provenance publishing",
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
          <h2 className="text-3xl font-bold tracking-tight mb-4">Ready to ship?</h2>
          <p className="mb-8 text-muted-foreground leading-8">
            Scaffold a project in seconds, then keep the contract as the app grows. The same app
            runs on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/docs/installation" transitionTypes={["nav-forward"]} className={buttonVariants({ size: "lg" })}>
              Install DaloyJS
            </Link>
            <Link href="/docs/tutorials/bookstore" transitionTypes={["nav-forward"]} className={buttonVariants({ size: "lg", variant: "outline" })}>
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
