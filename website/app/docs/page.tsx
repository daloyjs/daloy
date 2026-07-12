import Link from "next/link";
import { CodeBlock } from "../../components/code-block";
import { BranchDiagram } from "../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Introduction to DaloyJS",
  description:
    "DaloyJS is a runtime-portable TypeScript web framework built around contract-first routing, Standard Schema validation, OpenAPI 3.1 generation, typed clients, and core security guardrails. Learn what makes it different.",
  path: "/docs",
  keywords: ["DaloyJS introduction", "TypeScript framework overview", "contract-first framework"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <div className="not-prose mb-8 rounded-2xl border border-mist-200/80 bg-[radial-gradient(circle_at_top_left,theme(colors.mist.100/.85),transparent_48%),linear-gradient(135deg,theme(colors.background),theme(colors.mist.50/.72))] p-5 shadow-sm dark:border-mist-900/70 dark:bg-[radial-gradient(circle_at_top_left,theme(colors.mist.950/.55),transparent_48%),linear-gradient(135deg,theme(colors.background),theme(colors.mist.950/.18))] dim:border-mist-900/60 dim:bg-[radial-gradient(circle_at_top_left,theme(colors.mist.950/.5),transparent_48%),linear-gradient(135deg,theme(colors.background),theme(colors.mist.950/.16))] sm:p-6">
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.22em] text-mist-950 uppercase dark:text-mist-100">
          <span className="rounded-full border border-mauve-300/80 bg-mauve-100/80 px-3 py-1 dark:border-mauve-800/70 dark:bg-mauve-950/35">Contract-first</span>
          <span className="rounded-full border border-olive-300/80 bg-olive-100/80 px-3 py-1 dark:border-olive-800/70 dark:bg-olive-950/35">Runtime-portable</span>
          <span className="rounded-full border border-taupe-300/80 bg-taupe-100/80 px-3 py-1 dark:border-taupe-800/70 dark:bg-taupe-950/35">OpenAPI 3.1</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link href="/docs/installation" className="rounded-xl border border-mist-200/80 bg-background/80 p-4 transition-colors hover:border-mist-300 hover:bg-white/80 dark:border-mist-900/70 dark:bg-background/70 dark:hover:bg-mist-950/20">
            <div className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Start here</div>
            <div className="mt-2 text-base font-semibold text-foreground">Installation</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">Set up DaloyJS without wandering through ten setup guides.</div>
          </Link>
          <Link href="/docs/getting-started" className="rounded-xl border border-mist-200/80 bg-background/80 p-4 transition-colors hover:border-olive-300 hover:bg-white/80 dark:border-mist-900/70 dark:bg-background/70 dark:hover:bg-olive-950/20">
            <div className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Quick path</div>
            <div className="mt-2 text-base font-semibold text-foreground">Getting started</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">Build the first route and see the contract shape immediately.</div>
          </Link>
          <Link href="/docs/tutorials/bookstore" className="rounded-xl border border-mist-200/80 bg-background/80 p-4 transition-colors hover:border-taupe-300 hover:bg-white/80 dark:border-mist-900/70 dark:bg-background/70 dark:hover:bg-taupe-950/20">
            <div className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Hands-on</div>
            <div className="mt-2 text-base font-semibold text-foreground">Bookstore tutorial</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">Route-by-route walkthrough with a practical API shape.</div>
          </Link>
        </div>
      </div>
      <h1>Introduction to DaloyJS</h1>
      <p>
        <strong>DaloyJS</strong> is a runtime-portable TypeScript web framework with built-in
        contract-first routing, validation, OpenAPI 3.1 generation,{" "}
        <a href="https://heyapi.dev/docs/openapi/typescript/get-started" target="_blank" rel="noreferrer">Hey API</a>{" "}
        typed client codegen, large-scale maintainability, and core security guardrails plus
        first-party security middleware, backed by
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer"> pnpm</a> plus hardened install and release controls.
      </p>

      <p>
        The name comes from the Tagalog word <strong>daloy</strong>, meaning <strong>flow</strong>,
        pronounced <strong>da-loy</strong>. The project also uses the Baybayin spelling{" "}
        <strong>ᜇᜎᜓᜌ᜔</strong>. See <Link href="/about-the-name">About the name</Link> for the short version.
      </p>

      <h2 id="why-another-framework">Why another framework?</h2>
      <p>
        Each existing stack is excellent at one thing and forces trade-offs everywhere else.
        DaloyJS combines the best ideas without the lock-in:
      </p>
      <ul>
        <li>OpenAPI ergonomics on par with FastAPI, built into the core, not bolted on.</li>
        <li>Vercel/serverless/edge fit on par with <a href="https://hono.dev/docs/" target="_blank" rel="noreferrer">Hono</a> - web-standard <code>Request → Response</code>.</li>
        <li>Mature plugin/lifecycle/ops story on par with <a href="https://fastify.dev/docs/latest/Reference/" target="_blank" rel="noreferrer">Fastify</a>.</li>
        <li>TS-first DX on par with <a href="https://elysiajs.com/at-glance" target="_blank" rel="noreferrer">Elysia</a>: without forcing you onto Bun.</li>
        <li>Hey API typed client generation as a first-class workflow.</li>
        <li>Supply-chain-hardened installs and publishing via pnpm plus hardened repo defaults.</li>
      </ul>

      <h2 id="the-30-second-taste">The 30-second taste</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";
import { serve } from "@daloyjs/core/node";

const app = new App();

app.get(
  "/hello/:name",
  {
    operationId: "sayHello",
    request: { params: z.object({ name: z.string() }) },
    responses: {
      200: { description: "Greeting", body: z.object({ msg: z.string() }) },
    },
  },
  async ({ params }) => ({
    status: 200,
    body: { msg: \`Hello, \${params.name}\` },
  }),
);

serve(app, { port: 3000 });`}
      />

      <p>That single route definition gives you:</p>

      <BranchDiagram
        title="One route, five outputs"
        source={{
          eyebrow: "single declaration",
          label: "app.get(path, contract, handler)",
          detail: "method, path, request, responses, handler",
        }}
        branches={[
          {
            eyebrow: "handler",
            label: "Typed params",
            detail: "params.name is string",
          },
          {
            eyebrow: "return",
            label: "Typed response",
            detail: "200 to { msg: string }",
          },
          {
            eyebrow: "spec",
            label: "OpenAPI 3.1 entry",
            detail: "operationId: sayHello",
          },
          {
            eyebrow: "consumers",
            label: "Typed client method",
            detail: "client.sayHello(...)",
          },
          {
            eyebrow: "tooling",
            label: "Introspection entry",
            detail: "app.introspect()",
          },
        ]}
        caption="You write one contract-first route. The handler types, the response type, the OpenAPI entry, the typed client method, and the introspection record are all derived from it."
      />

      <ul>
        <li>Strict, typed <code>params</code> in your handler.</li>
        <li>A typed return - TypeScript knows <code>200 → {`{ msg: string }`}</code>.</li>
        <li>An OpenAPI 3.1 entry under <code>operationId: sayHello</code>.</li>
        <li>A typed client method <code>client.sayHello({`{ params: { name: string } }`})</code>.</li>
        <li>An entry in <code>app.introspect()</code> for tooling and contract tests.</li>
      </ul>

      <h2 id="where-to-next">Where to next?</h2>
      <ul>
        <li><Link href="/docs/installation">Installation</Link>: get DaloyJS into your project.</li>
        <li><Link href="/docs/getting-started">Getting started</Link>: your first server in 5 minutes.</li>
        <li><Link href="/docs/tutorials/bookstore">Tutorial: build a bookstore API</Link>.</li>
        <li><Link href="/docs/api-reference">API reference</Link>.</li>
      </ul>
    </>
  );
}
