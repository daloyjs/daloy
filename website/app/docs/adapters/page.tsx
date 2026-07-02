import Link from "next/link";
import type { Route } from "next";

import { CodeBlock } from "@/components/code-block";
import { BranchDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Adapters & runtimes",
  description:
    "Run the same DaloyJS REST API on Node.js, Bun, Deno, Cloudflare Workers, Vercel, Netlify, Fastly Compute, and AWS Lambda. One codebase, multiple runtimes, zero rewrites.",
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
      "Long-lived process on Node 24 LTS or Node 26+. Sane request/header/keep-alive timeouts and SIGTERM-driven graceful shutdown.",
  },
  {
    name: "Bun",
    href: "/docs/adapters/bun" as Route,
    blurb:
      "Native Bun.serve for REST APIs. Fast startup, built-in TLS, Unix sockets, and hot reload in dev.",
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
      "Deploy a standalone REST API as a Vercel Node Function or Edge Function.",
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
        DaloyJS is a REST API backend framework. The core only ever sees{" "}
        <code>Request &rarr; Response</code>. Runtime-specific concerns, 
        sockets, signals, edge handlers, Lambda event shapes, live in
        thin adapters at the edge. Choose the adapter for the place you want to
        deploy your API.
      </p>

      <BranchDiagram
        title="One app core, many runtimes"
        source={{
          eyebrow: "web-standard core",
          label: "Your DaloyJS App",
          detail: "Request → Response",
        }}
        branches={[
          { eyebrow: "runtime", label: "Node.js", detail: "@daloyjs/core/node" },
          { eyebrow: "runtime", label: "Bun", detail: "@daloyjs/core/bun" },
          { eyebrow: "runtime", label: "Deno", detail: "@daloyjs/core/deno" },
          {
            eyebrow: "edge",
            label: "Cloudflare Workers",
            detail: "@daloyjs/core/cloudflare",
          },
          {
            eyebrow: "serverless",
            label: "Vercel / Netlify",
            detail: "@daloyjs/core/vercel",
          },
          {
            eyebrow: "edge / serverless",
            label: "Fastly / AWS Lambda",
            detail: "@daloyjs/core/fastly · /lambda",
          },
        ]}
        caption="The core only ever sees a Request and returns a Response. Each thin adapter handles one platform's sockets, signals, or event shape, so the same app ships everywhere without a rewrite."
      />

      <h2 id="pick-a-target">Pick a target</h2>

      <h3 id="runtimes-you-own-the-process">Runtimes (you own the process)</h3>
      <Grid items={RUNTIMES} />

      <h3 id="edge-and-serverless-platform-owns-the-process">Edge &amp; serverless (platform owns the process)</h3>
      <Grid items={EDGE} />

      <h2 id="roll-your-own">Roll your own</h2>
      <p>
        If your runtime exposes the web-standard <code>Request / Response</code>{" "}
        contract and isn&apos;t listed above, you don&apos;t need an adapter at
        all, pass the incoming request straight to <code>app.fetch</code>
        :
      </p>
      <CodeBlock
        language="ts"
        code={`// modules-format (Cloudflare Workers, Deno, Bun, etc.)
export default {
  fetch(request: Request): Promise<Response> {
    return app.fetch(request);
  },
};`}
      />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/deployment">Deployment</Link>: Docker,
          reverse proxies, health checks, and Node platform guides (Fly.io,
          Render, Railway, Heroku).
        </li>
        <li>
          <Link href="/docs/scaffolder">Scaffolder</Link>: {" "}
          <code>pnpm create daloy</code> ships runtime-specific templates.
        </li>
      </ul>
    </>
  );
}
