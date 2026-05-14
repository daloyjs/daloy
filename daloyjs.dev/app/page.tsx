import Link from "next/link";
import {
  ArrowRightIcon,
  CubeIcon,
  FileCodeIcon,
  GithubLogoIcon,
  LightningIcon,
  LockIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { CodeBlock } from "../components/code-block";

const HELLO_WORLD = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "daloy";
import { serve } from "daloy/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

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

const FEATURES = [
  {
    icon: FileCodeIcon,
    title: "Contract-first by design",
    body: "One route definition is the source of truth for validation, types, OpenAPI, the typed client, and contract tests. No drift, ever.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Secure by default",
    body: "Body limits, prototype-pollution-safe JSON, path-traversal rejection, request timeouts, Helmet-grade headers, RFC 9457 problem+json — all built in.",
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
    title: "Hey API typed clients",
    body: "Run pnpm gen and get a fully typed fetch SDK — for any consumer, in any TS project — generated from your real spec.",
  },
  {
    icon: LockIcon,
    title: "Supply-chain hardened",
    body: "Distributed via pnpm with strict isolation, content-addressable store, frozen lockfiles, and an .npmrc that says no to phantom deps.",
  },
];

export default function HomePage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="flex flex-col items-center text-center gap-6">
            <Badge variant="outline" className="gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              v0.1 — public preview
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight max-w-4xl">
              The runtime-portable TypeScript web framework
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Contract-first routing, validation, OpenAPI (Hey API), typed client generation,
              large-scale maintainability, and highly secured by default — distributed via pnpm.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-4">
              <Link href="/docs/getting-started" className={buttonVariants({ size: "lg" })}>
                Get started <ArrowRightIcon className="size-4" />
              </Link>
              <Link href="/docs" className={buttonVariants({ size: "lg", variant: "outline" })}>
                Read the docs
              </Link>
            </div>
            <code className="mt-4 rounded-md bg-muted px-3 py-2 text-sm">$ pnpm add daloy</code>
          </div>
        </div>
      </section>

      {/* Hello world */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold tracking-tight">Hello, contract</h2>
            <p className="text-muted-foreground mt-2">
              One route — types, validation, OpenAPI, and the typed client all generated from it.
            </p>
          </div>
          <CodeBlock code={HELLO_WORLD} language="ts" />
        </div>
      </section>

      {/* Features */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight">Why DaloyJS</h2>
            <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
              Take the best ideas from each modern stack — without the trade-offs.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title}>
                <CardHeader>
                  <f.icon className="size-6 text-primary mb-2" />
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
            One framework. Best of every other.
          </h2>
          <p className="text-muted-foreground text-center mb-10">
            We&apos;re standing on the shoulders of giants — and stitching their wins together.
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
                  ["Better supply-chain security", "pnpm", "Strict, content-addressable installs by default"],
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
          <p className="text-muted-foreground mb-8">
            Install in seconds, scale for years. Read the docs, then write your first contract.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/docs/installation" className={buttonVariants({ size: "lg" })}>
              Install DaloyJS
            </Link>
            <Link href="/docs/tutorials/bookstore" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Build a bookstore API
            </Link>
            <a
              href="https://github.com/daloyjs/daloy"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              View source <GithubLogoIcon className="size-4" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
