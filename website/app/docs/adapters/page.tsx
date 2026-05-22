import Link from "next/link";
import type { Route } from "next";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Adapters & runtimes",
  description:
    "Run the same DaloyJS app on Node.js, Bun, Deno, Cloudflare Workers, Vercel, Netlify, Fastly Compute, and AWS Lambda. One codebase, multiple runtimes, zero rewrites.",
  path: "/docs/adapters",
  keywords: [
    "runtime adapters",
    "Cloudflare Workers TypeScript",
    "Vercel adapter",
    "Bun framework",
    "Deno HTTP framework",
    "AWS Lambda framework",
    "Netlify Functions",
    "Fastly Compute",
  ],
  type: "article",
});

type Target = {
  name: string;
  href: Route;
  blurb: string;
};

const RUNTIMES: Target[] = [
  {
    name: "Node.js",
    href: "/docs/adapters/node" as Route,
    blurb:
      "Long-lived process on Node 24+. Sane request/header/keep-alive timeouts and SIGTERM-driven graceful shutdown.",
  },
  {
    name: "Bun",
    href: "/docs/adapters/bun" as Route,
    blurb:
      "Native Bun.serve. Fast startup, built-in TLS and Unix sockets, hot reload in dev.",
  },
  {
    name: "Deno",
    href: "/docs/adapters/deno" as Route,
    blurb:
      "Stable Deno.serve with AbortSignal-based shutdown. Runs anywhere, including Deno Deploy.",
  },
];

const EDGE: Target[] = [
  {
    name: "Cloudflare Workers",
    href: "/docs/adapters/cloudflare-workers" as Route,
    blurb:
      "Modules-format Worker. wrangler.jsonc, nodejs_compat, and bindings for KV, R2, D1, DO, Queues, Hyperdrive.",
  },
  {
    name: "Vercel",
    href: "/docs/adapters/vercel" as Route,
    blurb:
      "Three handler shapes from one app: Next.js App Router, Vercel Node Functions, Vercel Edge Functions.",
  },
  {
    name: "Netlify",
    href: "/docs/adapters/netlify" as Route,
    blurb:
      "Edge Functions (Deno) and Functions v2 (Node, fetch-style). The v1 lambda shape is legacy.",
  },
  {
    name: "Fastly Compute",
    href: "/docs/adapters/fastly" as Route,
    blurb:
      "JS Compute via @fastly/js-compute and the fetch-event listener model, wrapped by installFastlyListener.",
  },
  {
    name: "AWS Lambda",
    href: "/docs/adapters/aws-lambda" as Route,
    blurb:
      "API Gateway HTTP API v2.0, REST API v1.0, Function URLs, and streamifyResponse for streaming.",
  },
];

function Grid({ items }: { items: Target[] }) {
  return (
    <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="rounded-lg border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
        >
          <div className="font-medium text-foreground">{t.name}</div>
          <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
        </Link>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <>
      <h1>Adapters &amp; runtimes</h1>
      <p>
        The DaloyJS core only ever sees <code>Request &rarr; Response</code>. Runtime-specific
        concerns &mdash; sockets, signals, edge handlers, Lambda event shapes &mdash; live in thin
        adapters at the edge. The same <code>app</code> object runs everywhere; you only change the
        adapter import and the deploy config.
      </p>

      <h2>Pick a target</h2>

      <h3>Runtimes (you own the process)</h3>
      <Grid items={RUNTIMES} />

      <h3>Edge &amp; serverless (platform owns the process)</h3>
      <Grid items={EDGE} />

      <h2>Roll your own</h2>
      <p>
        If your runtime exposes the web <code>fetch</code> standard, you don&apos;t need an adapter
        at all &mdash; just forward the request to <code>app.fetch</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`addEventListener("fetch", (event) => event.respondWith(app.fetch(event.request)));`}
      />

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/deployment">Deployment</Link> &mdash; Docker, reverse proxies, health
          checks, and Node platform guides (Fly.io, Render, Railway, Heroku).
        </li>
        <li>
          <Link href="/docs/scaffolder">Scaffolder</Link> &mdash; <code>pnpm create daloy</code>{" "}
          ships runtime-specific templates.
        </li>
      </ul>
    </>
  );
}
