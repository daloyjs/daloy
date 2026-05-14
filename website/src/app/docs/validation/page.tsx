import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Validation" };

export default function Page() {
  return (
    <>
      <h1>Validation</h1>
      <p>
        DaloyJS validates inputs through{" "}
        <a href="https://github.com/standard-schema/standard-schema" target="_blank" rel="noreferrer">Standard Schema</a>{" "}
        — a tiny interface that <strong>Zod</strong>, <strong>Valibot</strong>, <strong>ArkType</strong>,
        and <strong>TypeBox</strong> all implement. Pick whichever validator fits your project.
      </p>

      <h2>What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li><code>request.params</code> — path parameters (always strings; coerce in your schema if needed).</li>
        <li><code>request.query</code> — query string.</li>
        <li><code>request.headers</code> — request headers.</li>
        <li><code>request.body</code> — parsed JSON body. Only read when declared (no overhead otherwise).</li>
        <li><code>responses[status].body</code> — typed responses.</li>
      </ul>

      <h2>Example with Zod</h2>
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

      <h2>Other validators</h2>
      <CodeBlock code={`// Valibot
import * as v from "valibot";
const Body = v.object({ sku: v.string(), qty: v.pipe(v.number(), v.integer(), v.minValue(1)) });

// ArkType
import { type } from "arktype";
const Body = type({ sku: "string", qty: "1<=number.integer" });

// TypeBox
import { Type } from "@sinclair/typebox";
const Body = Type.Object({ sku: Type.String(), qty: Type.Integer({ minimum: 1 }) });`} />
      <p>All four expose a <code>~standard</code> property that DaloyJS picks up automatically.</p>

      <h2>Type inference</h2>
      <p>
        Whatever validator you use, the handler context is fully typed: <code>body</code>, <code>params</code>,
        <code>query</code>, and <code>headers</code> are inferred from your schemas. The return value is also typed
        — TypeScript yells if you return a status not declared in <code>responses</code>.
      </p>
    </>
  );
}
