import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Validation with Zod",
  description:
    "Validate request params, query, headers, and bodies in DaloyJS using Zod schemas. Errors are returned as RFC 9457 problem+json with full type inference.",
  path: "/docs/validation/zod",
  keywords: [
    "Zod validation",
    "DaloyJS validation",
    "request validation TypeScript",
    "problem+json",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Validation with Zod</h1>
      <p>
        <a href="https://zod.dev/" target="_blank" rel="noreferrer">
          Zod
        </a>{" "}
        is the default validator most DaloyJS apps reach for: chainable schemas,
        mature ecosystem, and a huge community. Zod implements{" "}
        <a
          href="https://github.com/standard-schema/standard-schema"
          target="_blank"
          rel="noreferrer"
        >
          Standard Schema
        </a>
        {", "}so DaloyJS picks it up without any adapter.
      </p>
      <p>
        Prefer a more modular, tree-shakeable API? See{" "}
        <a href="/docs/validation/valibot">Validation with Valibot</a>
        {". "}Both work the same way at the framework level.
      </p>

      <FlowDiagram
        title="One Zod schema, picked up everywhere"
        steps={[
          {
            eyebrow: "you write",
            label: "Zod schema",
            detail: "z.object({ ... })",
            tone: "accent",
          },
          {
            eyebrow: "runtime",
            label: "Request & response validation",
            detail: "422 on invalid input",
          },
          {
            eyebrow: "compile time",
            label: "Inferred handler types",
            detail: "z.infer<typeof ...>",
          },
          {
            eyebrow: "spec",
            label: "OpenAPI JSON Schema",
            detail: "stays in sync via pnpm gen",
            tone: "success",
          },
        ]}
        caption="Because Zod implements Standard Schema, DaloyJS reuses one schema for runtime validation, handler type inference, and the OpenAPI document. No adapter, no second source of truth."
      />

      <h2 id="install">Install</h2>
      <CodeBlock code={`pnpm add @daloyjs/core zod`} />

      <h2 id="what-gets-validated">What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li>
          <code>request.params</code>
          {": "}decoded path parameters. They start as strings, so use{" "}
          <code>z.coerce.number()</code>
          {", "}
          <code>z.uuid()</code>
          {", "}
          or enums when you need stronger shapes.
        </li>
        <li>
          <code>request.query</code>
          {": "}query string values. Repeated keys become arrays before
          validation.
        </li>
        <li>
          <code>request.headers</code>
          {": "}request headers as lower-case names.
        </li>
        <li>
          <code>request.body</code>
          {": "}parsed request bodies. The body is only read when declared.
        </li>
        <li>
          <code>responses[status].body</code>
          {": "}typed and validated responses.
        </li>
      </ul>

      <h2 id="bound-numeric-fields">Bound numeric fields (money and qty)</h2>
      <p>
        Prefer domain-bounded numbers over bare <code>z.number()</code>
        {". "}Money and quantities need a finite range so refund-fraud amounts,{" "}
        <code>1e308</code> overflows, and negative balances die at the schema
        boundary instead of in the ledger:
      </p>
      <CodeBlock
        code={`const Money = z.number().finite().positive().max(1_000_000);
const Qty = z.coerce.number().int().positive().max(10_000);

const CreatePayment = z
  .object({ amount: Money, currency: z.enum(["USD", "EUR"]) })
  .strict();`}
      />

      <h2 id="a-complete-route">A complete route</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const CreateOrder = z.object({
  sku: z.string().min(1),
  qty: z.coerce.number().int().positive().max(10_000),
});

const Order = z.object({
  id: z.uuid(),
  tenantId: z.string(),
  sku: z.string(),
  qty: z.number().int().positive(),
  dryRun: z.boolean(),
});

export const app = new App().post(
  "/orders",
  {
    operationId: "createOrder",
    request: {
      query: z
        .object({
          dryRun: z
            .enum(["true", "false"])
            .transform((value) => value === "true")
            .optional(),
        })
        .optional(),
      headers: z.object({ "x-tenant": z.string().min(1) }),
      body: CreateOrder,
    },
    responses: {
      201: { description: "Created", body: Order },
      422: { description: "Validation failed" },
    },
  },
  async ({ query, headers, body }) => {
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
);`}
      />

      <p>
        On invalid input, DaloyJS returns{" "}
        <strong>422 Unprocessable Entity</strong> as RFC 9457 problem+json with
        an <code>errors</code> array of per-issue <code>path</code> and{" "}
        <code>message</code> records.
      </p>

      <h2 id="zod-coercion-for-strings">Zod coercion for strings</h2>
      <p>
        Path params, query values, headers, and urlencoded form values arrive as
        strings before schema validation. Use Zod coercion or transforms when
        you want numbers, booleans, or dates in the handler.
      </p>
      <CodeBlock
        code={`const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  published: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});`}
      />

      <h2 id="body-limits-and-content-types">Body limits and content types</h2>
      <p>
        When a route declares <code>request.body</code>
        {", "}DaloyJS will also enforce:
      </p>
      <ul>
        <li>
          Content-Length and streamed size against{" "}
          <code>app.bodyLimitBytes</code> -&gt; <strong>413</strong>.
        </li>
        <li>
          Content-Type against the route&apos;s <code>accepts</code> list, or
          global <code>allowedContentTypes</code> if set -&gt;{" "}
          <strong>415</strong>.
        </li>
        <li>
          Default accepted body types: <code>application/json</code>
          {", "}
          <code>application/x-www-form-urlencoded</code>
          {", "}and <code>multipart/form-data</code>.
        </li>
        <li>
          Prototype-pollution-safe parsing for JSON, query strings, urlencoded
          forms, and multipart forms.
        </li>
      </ul>
      <p>
        JSON bodies validate as parsed JSON. Urlencoded bodies validate as an
        object built from <code>URLSearchParams</code>
        {". "}Multipart bodies validate as an object built from{" "}
        <code>Request.formData()</code>
        {". "}For a custom text media type, opt in with <code>accepts</code> and
        validate a <code>z.string()</code> body.
      </p>
      <CodeBlock
        code={`app.post(
  "/legacy-form",
  {
    operationId: "legacyForm",
    accepts: ["application/x-www-form-urlencoded"],
    request: {
      body: z.object({
        email: z.email(),
        qty: z.coerce.number().int().positive(),
      }),
    },
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) },
    },
  },
  async ({ body }) => ({ status: 200, body: { ok: body.qty > 0 } }),
);`}
      />

      <h2 id="response-validation">Response validation</h2>
      <p>
        When a response schema is declared, DaloyJS validates the handler return
        before serializing it. Zod object schemas strip unknown keys by default,
        so the validated value also prevents undeclared fields from leaking to
        clients. Use <code>z.looseObject()</code> only when extra keys are part
        of the intended response contract.
      </p>
      <CodeBlock
        code={`const PublicUser = z.object({
  id: z.string(),
  email: z.email(),
});

app.get(
  "/me",
  {
    operationId: "me",
    responses: {
      200: { description: "Current user", body: PublicUser },
    },
  },
  async () => ({
    status: 200,
    // passwordHash is stripped before serialization.
    body: { id: "u_1", email: "dev@example.com", passwordHash: "secret" },
  }),
);`}
      />

      <h2 id="type-inference">Type inference</h2>
      <p>
        The handler context is fully typed: <code>body</code>
        {", "}
        <code>params</code>
        {", "}
        <code>query</code>
        {", "}and <code>headers</code> are inferred from your schemas. The
        return value is also typed; TypeScript reports an error if you return a
        status not declared in <code>responses</code>.
      </p>
      <CodeBlock
        code={`import { z } from "zod";

const Book = z.object({
  id: z.uuid(),
  title: z.string(),
  author: z.string(),
});

export type Book = z.infer<typeof Book>;`}
      />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <a href="/docs/validation">Validation overview</a>
          {": "}how validators plug in via Standard Schema.
        </li>
        <li>
          <a href="/docs/validation/valibot">Validation with Valibot</a>
          {": "}the tree-shakeable alternative.
        </li>
        <li>
          <a href="/docs/openapi">OpenAPI generation</a>
          {": "}how schemas become a spec.
        </li>
        <li>
          <a href="/docs/errors">Errors &amp; problem+json</a>
          {": "}the error contract.
        </li>
      </ul>
    </>
  );
}
