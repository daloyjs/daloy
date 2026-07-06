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
        <a href="https://valibot.dev/" target="_blank" rel="noreferrer">
          Valibot
        </a>{" "}
        is a modular, tree-shakeable schema library that ships as a collection
        of small functions instead of a chained builder. It implements{" "}
        <a
          href="https://github.com/standard-schema/standard-schema"
          target="_blank"
          rel="noreferrer"
        >
          Standard Schema
        </a>
        , so DaloyJS picks it up the same way it picks up Zod: no adapter, no
        wrapper, no extra runtime dependency in the framework.
      </p>
      <p>
        Valibot is developed in the open at{" "}
        <a
          href="https://github.com/open-circle/valibot"
          target="_blank"
          rel="noreferrer"
        >
          github.com/open-circle/valibot
        </a>{" "}
        and published to npm as <code>valibot</code>: that&apos;s the package
        you install below.
      </p>

      <h2 id="install">Install</h2>
      <CodeBlock code={`pnpm add @daloyjs/core valibot`} />

      <h2 id="why-valibot">Why Valibot</h2>
      <ul>
        <li>
          <strong>Bundle size.</strong> You import only the validators you
          actually use, which matters on edge runtimes and in browser-shipped
          contracts.
        </li>
        <li>
          <strong>Functional API.</strong>{" "}
          <code>v.pipe(v.string(), v.email())</code> instead of{" "}
          <code>z.email()</code>. Easier to compose, easier to lint.
        </li>
        <li>
          <strong>Standard Schema native.</strong> Same handler types and the
          same problem+json error shape you get with Zod. DaloyJS does not care
          which one you picked.
        </li>
      </ul>

      <h2 id="what-gets-validated">What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li>
          <code>request.params</code>: decoded path parameters. They start as
          strings, so use <code>v.pipe(...)</code> with transforms when you need
          stronger shapes.
        </li>
        <li>
          <code>request.query</code>: query string values. Repeated keys become
          arrays before validation.
        </li>
        <li>
          <code>request.headers</code>: request headers as lower-case names.
        </li>
        <li>
          <code>request.body</code>: parsed request bodies. The body is only
          read when declared.
        </li>
        <li>
          <code>responses[status].body</code>: typed and validated responses.
        </li>
      </ul>

      <h2 id="a-complete-route">A complete route</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import * as v from "valibot";

const CreateOrder = v.object({
  sku: v.pipe(v.string(), v.minLength(1)),
  qty: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
});

const Order = v.object({
  id: v.pipe(v.string(), v.uuid()),
  tenantId: v.string(),
  sku: v.string(),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
  dryRun: v.boolean(),
});

export const app = new App().route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  request: {
    query: v.optional(
      v.object({
        dryRun: v.optional(
          v.pipe(
            v.union([v.literal("true"), v.literal("false")]),
            v.transform((value) => value === "true"),
          ),
        ),
      }),
    ),
    headers: v.object({
      "x-tenant": v.pipe(v.string(), v.minLength(1)),
    }),
    body: CreateOrder,
  },
  responses: {
    201: { description: "Created", body: Order },
    422: { description: "Validation failed" },
  },
  handler: async ({ query, headers, body }) => {
    const tenantId = headers["x-tenant"];
    const dryRun = query?.dryRun ?? false;

    return {
      status: 201,
      body: {
        id: crypto.randomUUID(),
        tenantId,
        sku: body.sku,
        qty: body.qty,
        dryRun,
      },
    };
  },
});`}
      />
      <p>
        <code>body</code> in the handler is inferred from{" "}
        <code>CreateOrder</code>. Returning anything that does not match{" "}
        <code>Order</code> is a TypeScript error, and DaloyJS also validates the
        response before serialization.
      </p>

      <h2 id="params-query-and-headers">Params, query, and headers</h2>
      <p>
        Path params, query values, headers, and urlencoded form values arrive as
        strings before schema validation. Drop a <code>v.transform</code> or one
        of the built-in <code>v.toNumber</code>, <code>v.toBoolean</code>, or{" "}
        <code>v.toDate</code> actions into the pipe to convert before further
        validation.
      </p>
      <FlowDiagram
        title="Inside a v.pipe()"
        numbered
        steps={[
          {
            eyebrow: "from the URL",
            label: "Raw string",
            detail: '"?page=2"',
            tone: "muted",
          },
          { label: "v.string()", detail: "assert it is a string" },
          {
            label: "v.transform(Number)",
            detail: "coerce to a number",
            tone: "accent",
          },
          {
            label: "v.integer() · v.minValue(1)",
            detail: "validate the result",
          },
          {
            eyebrow: "in your handler",
            label: "Typed value",
            detail: "query.page: number",
            tone: "success",
          },
        ]}
        caption="A pipe runs left to right: each action receives the previous output. Coerce first with v.transform, then validate the converted value, so query.page reaches your handler already typed as a number."
      />
      <CodeBlock
        code={`import * as v from "valibot";

const Params = v.object({
  id: v.pipe(v.string(), v.uuid()),
});

const Query = v.object({
  // "?page=2" -> number
  page: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1))),
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
});`}
      />

      <h2 id="body-limits-and-content-types">Body limits and content types</h2>
      <p>
        When a route declares <code>request.body</code>, DaloyJS will also
        enforce:
      </p>
      <ul>
        <li>
          Content-Length and streamed size against{" "}
          <code>app.bodyLimitBytes</code> → <strong>413</strong>.
        </li>
        <li>
          Content-Type against the route&apos;s <code>accepts</code> list, or
          global <code>allowedContentTypes</code> if set → <strong>415</strong>.
        </li>
        <li>
          Default accepted body types: <code>application/json</code>,{" "}
          <code>application/x-www-form-urlencoded</code>, and{" "}
          <code>multipart/form-data</code>.
        </li>
        <li>
          Prototype-pollution-safe parsing for JSON, query strings, urlencoded
          forms, and multipart forms.
        </li>
      </ul>
      <p>
        JSON bodies validate as parsed JSON. Urlencoded bodies validate as an
        object built from <code>URLSearchParams</code>. Multipart bodies
        validate as an object built from <code>Request.formData()</code>. For a
        custom text media type, opt in with <code>accepts</code> and validate a{" "}
        <code>v.string()</code> body.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/legacy-form",
  operationId: "legacyForm",
  accepts: ["application/x-www-form-urlencoded"],
  request: {
    body: v.object({
      email: v.pipe(v.string(), v.email()),
      qty: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
    }),
  },
  responses: {
    200: { description: "ok", body: v.object({ ok: v.boolean() }) },
  },
  handler: async ({ body }) => ({ status: 200, body: { ok: body.qty > 0 } }),
});`}
      />

      <h2 id="response-validation">Response validation</h2>
      <p>
        When a response schema is declared, DaloyJS validates the handler return
        before serializing it. Valibot object schemas return only declared keys
        by default, so the validated value also prevents undeclared fields from
        leaking to clients. Use <code>v.looseObject()</code> or{" "}
        <code>v.objectWithRest()</code> only when extra keys are part of the
        intended response contract.
      </p>
      <CodeBlock
        code={`const PublicUser = v.object({
  id: v.string(),
  email: v.pipe(v.string(), v.email()),
});

app.route({
  method: "GET",
  path: "/me",
  operationId: "me",
  responses: {
    200: { description: "Current user", body: PublicUser },
  },
  handler: async () => ({
    status: 200,
    // passwordHash is stripped before serialization.
    body: { id: "u_1", email: "dev@example.com", passwordHash: "secret" },
  }),
});`}
      />

      <h2 id="discriminated-unions">Discriminated unions</h2>
      <p>
        Use <code>v.variant</code> for tagged unions. DaloyJS emits a proper{" "}
        <code>discriminator</code> in the OpenAPI document so generated clients
        get narrowing for free.
      </p>
      <CodeBlock
        code={`import * as v from "valibot";

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
    return { status: 202, body: undefined };
  },
});`}
      />

      <h2 id="reusing-types">Reusing types</h2>
      <CodeBlock
        code={`import * as v from "valibot";

const Book = v.object({
  id: v.pipe(v.string(), v.uuid()),
  title: v.string(),
  author: v.string(),
});

export type Book = v.InferOutput<typeof Book>;
export type BookInput = v.InferInput<typeof Book>;`}
      />
      <p>
        <code>v.InferOutput</code> mirrors Zod&apos;s <code>z.infer</code>. Use{" "}
        <code>v.InferInput</code> when you have transforms and need the
        pre-parse shape, for example in a form library.
      </p>

      <h2 id="errors">Errors</h2>
      <p>
        Validation failures produce the same response as every other validator
        in DaloyJS: <strong>422 Unprocessable Entity</strong> as RFC 9457
        problem+json, with an <code>errors</code> array of per-issue{" "}
        <code>path</code> and <code>message</code> records. You do not need to
        write an error handler. That is the framework&apos;s job.
      </p>
      <CodeBlock
        code={`{
  "type": "https://daloyjs.dev/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    { "path": ["qty"], "message": "Invalid type: Expected number but received string" }
  ]
}`}
      />

      <h2 id="openapi">OpenAPI</h2>
      <p>
        Valibot schemas are converted into JSON Schema by DaloyJS&apos;s OpenAPI
        generator the same way Zod schemas are. Run the CLI and your spec is in
        sync with the route definitions:
      </p>
      <CodeBlock code={`pnpm daloy openapi --out openapi.json`} />

      <h2 id="mixing-validators">Mixing validators</h2>
      <p>
        Nothing stops you from using Valibot for one route and Zod for another
        in the same app. Both speak Standard Schema. That is useful when
        migrating a codebase incrementally, or when a shared package already
        exports its schemas in one library and you do not want to rewrite them.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <a href="/docs/validation">Validation overview</a>: how validators
          plug in via Standard Schema.
        </li>
        <li>
          <a href="/docs/validation/zod">Validation with Zod</a>: the chainable
          alternative.
        </li>
        <li>
          <a href="/docs/openapi">OpenAPI generation</a>: how schemas become a
          spec.
        </li>
        <li>
          <a href="/docs/errors">Errors &amp; problem+json</a>: the error
          contract.
        </li>
      </ul>
    </>
  );
}
