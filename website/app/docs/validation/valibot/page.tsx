import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Validation with Valibot",
  description:
    "Use Valibot as the request and response validator in DaloyJS. Modular, tree-shakeable schemas with full Standard Schema interop, type inference, and RFC 9457 problem+json errors.",
  path: "/docs/validation/valibot",
  keywords: [
    "Valibot validation",
    "DaloyJS Valibot",
    "Standard Schema Valibot",
    "Valibot OpenAPI",
    "tree-shakeable validator",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Validation with Valibot</h1>
      <p>
        <a href="https://valibot.dev/" target="_blank" rel="noreferrer">Valibot</a> is a modular,
        tree-shakeable schema library that ships as a collection of small functions instead of a
        chained builder. It implements{" "}
        <a href="https://github.com/standard-schema/standard-schema" target="_blank" rel="noreferrer">Standard Schema</a>,
        so DaloyJS picks it up the same way it picks up Zod, no adapter, no wrapper, no extra deps.
      </p>
      <p>
        Valibot is developed in the open at{" "}
        <a href="https://github.com/open-circle/valibot" target="_blank" rel="noreferrer">github.com/open-circle/valibot</a>{" "}
        and published to npm as <code>valibot</code>: that&apos;s the package you install below.
      </p>

      <h2>Install</h2>
      <CodeBlock code={`pnpm add @daloyjs/core valibot`} />

      <h2>Why Valibot</h2>
      <ul>
        <li>
          <strong>Bundle size.</strong> You import only the validators you actually use, which matters on
          edge runtimes and in browser-shipped contracts.
        </li>
        <li>
          <strong>Functional API.</strong> <code>v.pipe(v.string(), v.email())</code> instead of
          <code> z.string().email()</code>. Easier to compose, easier to lint.
        </li>
        <li>
          <strong>Standard Schema native.</strong> Same handler types and the same problem+json error
          shape you get with Zod, DaloyJS doesn&apos;t care which one you picked.
        </li>
      </ul>

      <h2>A complete route</h2>
      <CodeBlock code={`import * as v from "valibot";
import { Daloy } from "@daloyjs/core";

const app = new Daloy();

const CreateOrder = v.object({
  sku: v.pipe(v.string(), v.minLength(1)),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
  notes: v.optional(v.pipe(v.string(), v.maxLength(280))),
});

const Order = v.object({
  id: v.pipe(v.string(), v.uuid()),
  sku: v.string(),
  qty: v.number(),
});

app.route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  request: { body: CreateOrder },
  responses: {
    201: { description: "Created", body: Order },
    422: { description: "Validation failed" },
  },
  handler: async ({ body }) => ({
    status: 201,
    body: { id: crypto.randomUUID(), sku: body.sku, qty: body.qty },
  }),
});`} />
      <p>
        <code>body</code> in the handler is inferred from <code>CreateOrder</code>: including the
        optional <code>notes</code> field. Returning anything that doesn&apos;t match <code>Order</code>{" "}
        is a TypeScript error, not a runtime surprise.
      </p>

      <h2>Params, query, and headers</h2>
      <p>
        Path params and query strings arrive as strings. Drop a <code>v.transform</code> (or one of
        the built-in <code>v.toNumber</code>/<code>v.toBoolean</code>/<code>v.toDate</code> actions)
        into the pipe to convert before further validation:
      </p>
      <FlowDiagram
        title="Inside a v.pipe()"
        numbered
        steps={[
          { eyebrow: "from the URL", label: "Raw string", detail: '"?page=2"', tone: "muted" },
          { label: "v.string()", detail: "assert it is a string" },
          { label: "v.transform(Number)", detail: "coerce to a number", tone: "accent" },
          { label: "v.integer() · v.minValue(1)", detail: "validate the result" },
          { eyebrow: "in your handler", label: "Typed value", detail: "query.page: number", tone: "success" },
        ]}
        caption="A pipe runs left to right: each action receives the previous output. Coerce first with v.transform, then validate the converted value, so query.page reaches your handler already typed as a number."
      />
      <CodeBlock code={`import * as v from "valibot";

const Params = v.object({
  id: v.pipe(v.string(), v.uuid()),
});

const Query = v.object({
  // "?page=2" -> number
  page: v.optional(
    v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
    "1",
  ),
  // "?tag=foo&tag=bar" -> string[]
  tag: v.optional(v.array(v.string()), []),
});

const Headers = v.object({
  "x-request-id": v.optional(v.pipe(v.string(), v.uuid())),
});

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBook",
  request: { params: Params, query: Query, headers: Headers },
  responses: { 200: { description: "OK", body: v.object({ id: v.string() }) } },
  handler: async ({ params, query, headers }) => ({
    status: 200,
    body: { id: params.id },
  }),
});`} />

      <h2>Discriminated unions</h2>
      <p>
        Use <code>v.variant</code> for tagged unions. DaloyJS emits a proper{" "}
        <code>discriminator</code> in the OpenAPI document so generated clients get narrowing for free.
      </p>
      <CodeBlock code={`import * as v from "valibot";

const Event = v.variant("type", [
  v.object({ type: v.literal("created"), id: v.string() }),
  v.object({ type: v.literal("updated"), id: v.string(), fields: v.array(v.string()) }),
  v.object({ type: v.literal("deleted"), id: v.string() }),
]);

app.route({
  method: "POST",
  path: "/events",
  operationId: "ingestEvent",
  request: { body: Event },
  responses: { 202: { description: "Accepted" } },
  handler: async ({ body }) => {
    if (body.type === "updated") {
      // body.fields is string[] here - narrowed by the discriminator.
    }
    return { status: 202 };
  },
});`} />

      <h2>Reusing types</h2>
      <CodeBlock code={`import * as v from "valibot";

const Book = v.object({
  id: v.pipe(v.string(), v.uuid()),
  title: v.string(),
  author: v.string(),
});

export type Book = v.InferOutput<typeof Book>;
export type BookInput = v.InferInput<typeof Book>;`} />
      <p>
        <code>v.InferOutput</code> mirrors Zod&apos;s <code>z.infer</code>. Use <code>v.InferInput</code>{" "}
        when you have transforms and need the pre-parse shape (for example, in a form library).
      </p>

      <h2>Errors</h2>
      <p>
        Validation failures produce the same response as every other validator in DaloyJS:
        <strong> 422 Unprocessable Entity</strong> as RFC 9457 problem+json, with each issue&apos;s{" "}
        <code>path</code> and <code>message</code>. You don&apos;t need to write an error handler, that&apos;s
        the framework&apos;s job.
      </p>
      <CodeBlock code={`{
  "type": "https://daloyjs.dev/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    { "path": ["qty"], "message": "Invalid type: Expected number but received string" }
  ]
}`} />

      <h2>OpenAPI</h2>
      <p>
        Valibot schemas are converted into JSON Schema by DaloyJS&apos;s OpenAPI generator the same
        way Zod schemas are. Run the CLI and your spec is in sync with the route definitions:
      </p>
      <CodeBlock code={`pnpm daloy openapi --out openapi.json`} />

      <h2>Mixing validators</h2>
      <p>
        Nothing stops you from using Valibot for one route and Zod for another in the same app, both
        speak Standard Schema. Useful when migrating a codebase incrementally, or when a shared package
        already exports its schemas in one library and you don&apos;t want to rewrite them.
      </p>

      <h2>See also</h2>
      <ul>
        <li>
          <a href="/docs/validation">Validation overview</a>: how validators plug in via Standard Schema.
        </li>
        <li>
          <a href="/docs/validation/zod">Validation with Zod</a>: the chainable alternative.
        </li>
        <li>
          <a href="/docs/openapi">OpenAPI generation</a>: how schemas become a spec.
        </li>
        <li>
          <a href="/docs/errors">Errors &amp; problem+json</a>: the error contract.
        </li>
      </ul>
    </>
  );
}
