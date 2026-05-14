import Link from "next/link";
import { CodeBlock } from "../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Introduction to DaloyJS",
  description:
    "DaloyJS is a runtime-portable TypeScript web framework built around contract-first routing, Zod validation, OpenAPI generation, and a typed client. Learn what makes it different.",
  path: "/docs",
  keywords: ["DaloyJS introduction", "TypeScript framework overview", "contract-first framework"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Introduction to DaloyJS</h1>
      <p>
        <strong>DaloyJS</strong> is a runtime-portable TypeScript web framework with built-in
        contract-first routing, validation, OpenAPI (via{" "}
        <a href="https://heyapi.dev/openapi-ts/get-started" target="_blank" rel="noreferrer">Hey API</a>),
        typed client generation, large-scale maintainability, and security-first defaults — distributed
        via <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a>.
      </p>

      <h2>Why another framework?</h2>
      <p>
        Each existing stack is excellent at one thing and forces trade-offs everywhere else.
        DaloyJS combines the best ideas without the lock-in:
      </p>
      <ul>
        <li>OpenAPI ergonomics on par with FastAPI — built into the core, not bolted on.</li>
        <li>Vercel/serverless/edge fit on par with <a href="https://hono.dev/docs/" target="_blank" rel="noreferrer">Hono</a> — web-standard <code>Request → Response</code>.</li>
        <li>Mature plugin/lifecycle/ops story on par with <a href="https://fastify.dev/docs/latest/Reference/" target="_blank" rel="noreferrer">Fastify</a>.</li>
        <li>TS-first DX on par with <a href="https://elysiajs.com/at-glance.html" target="_blank" rel="noreferrer">Elysia</a> — without forcing you onto Bun.</li>
        <li>Hey API typed client generation as a first-class workflow.</li>
        <li>Better supply-chain security than npm thanks to pnpm.</li>
      </ul>

      <h2>The 30-second taste</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";
import { serve } from "@daloyjs/core/node";

const app = new App();

app.route({
  method: "GET",
  path: "/hello/:name",
  operationId: "sayHello",
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: "Greeting", body: z.object({ msg: z.string() }) },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { msg: \`Hello, \${params.name}\` },
  }),
});

serve(app, { port: 3000 });`}
      />

      <p>That single route definition gives you:</p>
      <ul>
        <li>Strict, typed <code>params</code> in your handler.</li>
        <li>A typed return — TypeScript knows <code>200 → {`{ msg: string }`}</code>.</li>
        <li>An OpenAPI 3.1 entry under <code>operationId: sayHello</code>.</li>
        <li>A typed client method <code>client.sayHello({`{ params: { name: string } }`})</code>.</li>
        <li>An entry in <code>app.introspect()</code> for tooling and contract tests.</li>
      </ul>

      <h2>Where to next?</h2>
      <ul>
        <li><Link href="/docs/installation">Installation</Link> — get DaloyJS into your project.</li>
        <li><Link href="/docs/getting-started">Getting started</Link> — your first server in 5 minutes.</li>
        <li><Link href="/docs/tutorials/bookstore">Tutorial: build a bookstore API</Link>.</li>
        <li><Link href="/docs/api-reference">API reference</Link>.</li>
      </ul>
    </>
  );
}
