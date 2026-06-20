import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Validation with Zod",
  description:
    "Validate request params, query, headers, and bodies in DaloyJS using Zod schemas. Errors are returned as RFC 9457 problem+json with full type inference.",
  path: "/docs/validation/zod",
  keywords: ["Zod validation", "DaloyJS validation", "request validation TypeScript", "problem+json"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Validation with Zod</h1>
      <p>
        <a href="https://zod.dev/" target="_blank" rel="noreferrer">Zod</a> is the default
        validator most DaloyJS apps reach for: chainable schemas, mature ecosystem, and a huge
        community. It implements{" "}
        <a href="https://github.com/standard-schema/standard-schema" target="_blank" rel="noreferrer">Standard Schema</a>,
        so DaloyJS picks it up without any adapter.
      </p>
      <p>
        Prefer a more modular, tree-shakeable API? See{" "}
        <a href="/docs/validation/valibot">Validation with Valibot</a>. Both work the same way at the
        framework level.
      </p>

      <FlowDiagram
        title="One Zod schema, picked up everywhere"
        steps={[
          { eyebrow: "you write", label: "Zod schema", detail: "z.object({ ... })", tone: "accent" },
          { eyebrow: "runtime", label: "Request & response validation", detail: "422 on invalid input" },
          { eyebrow: "compile time", label: "Inferred handler types", detail: "z.infer<typeof ...>" },
          { eyebrow: "spec", label: "OpenAPI JSON Schema", detail: "stays in sync via pnpm gen", tone: "success" },
        ]}
        caption="Because Zod implements Standard Schema, DaloyJS reuses one schema for runtime validation, handler type inference, and the OpenAPI document. No adapter, no second source of truth."
      />

      <h2>Install</h2>
      <CodeBlock code={`pnpm add @daloyjs/core zod`} />

      <h2>What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li><code>request.params</code>: path parameters (always strings; coerce in your schema if needed).</li>
        <li><code>request.query</code>: query string.</li>
        <li><code>request.headers</code>: request headers.</li>
        <li><code>request.body</code>: parsed JSON body. Only read when declared (no overhead otherwise).</li>
        <li><code>responses[status].body</code>: typed responses.</li>
      </ul>

      <h2>A complete route</h2>
      <CodeBlock code={`import { z } from "zod";

app.route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  request: {
    body: z.object({
      sku: z.string(),
      qty: z.number().int().positive(),
    }),
  },
  responses: {
    201: {
      description: "Created",
      body: z.object({ id: z.string().uuid(), sku: z.string(), qty: z.number() }),
    },
    422: { description: "Validation failed" },
  },
  handler: async ({ body }) => ({
    status: 201,
    body: { id: crypto.randomUUID(), sku: body.sku, qty: body.qty },
  }),
});`} />

      <p>
        On invalid input, DaloyJS returns <strong>422 Unprocessable Entity</strong> as RFC 9457 problem+json
        with the per-issue <code>path</code> and <code>message</code> array.
      </p>

      <h2>Body limits and content types</h2>
      <p>
        When a route declares <code>request.body</code>, DaloyJS will also enforce:
      </p>
      <ul>
        <li>Content-Length / streamed size against <code>app.bodyLimitBytes</code> → <strong>413</strong>.</li>
        <li>Content-Type against <code>app.allowedContentTypes</code> (default <code>application/json</code>) → <strong>415</strong>.</li>
        <li>Prototype-pollution-safe JSON parsing (<code>__proto__</code>, <code>constructor</code>, <code>prototype</code> stripped).</li>
      </ul>

      <h2>Type inference</h2>
      <p>
        The handler context is fully typed: <code>body</code>, <code>params</code>, <code>query</code>, and{" "}
        <code>headers</code> are inferred from your schemas. The return value is also typed, TypeScript yells
        if you return a status not declared in <code>responses</code>.
      </p>
      <CodeBlock code={`import { z } from "zod";

const Book = z.object({
  id: z.string().uuid(),
  title: z.string(),
  author: z.string(),
});

export type Book = z.infer<typeof Book>;`} />

      <h2>See also</h2>
      <ul>
        <li><a href="/docs/validation">Validation overview</a>: how validators plug in via Standard Schema.</li>
        <li><a href="/docs/validation/valibot">Validation with Valibot</a>: the tree-shakeable alternative.</li>
        <li><a href="/docs/openapi">OpenAPI generation</a>: how schemas become a spec.</li>
        <li><a href="/docs/errors">Errors &amp; problem+json</a>: the error contract.</li>
      </ul>
    </>
  );
}
