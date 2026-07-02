import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Validation in DaloyJS",
  description:
    "DaloyJS validates requests and responses through Standard Schema. Use Zod, Valibot, ArkType, or TypeBox, pick the validator that fits your project.",
  path: "/docs/validation",
  keywords: [
    "DaloyJS validation",
    "Standard Schema",
    "request validation TypeScript",
    "Zod DaloyJS",
    "Valibot DaloyJS",
    "ArkType",
    "TypeBox",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Validation</h1>
      <p>
        DaloyJS validates inputs through{" "}
        <a
          href="https://github.com/standard-schema/standard-schema"
          target="_blank"
          rel="noreferrer"
        >
          Standard Schema
        </a>
        , a tiny interface exposed by validators such as <strong>Zod</strong>,{" "}
        <strong>Valibot</strong>, <strong>ArkType</strong>, and TypeBox via a
        Standard Schema adapter. Pick the validator that fits your project; the
        DaloyJS contract is the same.
      </p>

      <BranchDiagram
        title="One interface, four validators"
        source={{
          eyebrow: "framework contract",
          label: "Standard Schema",
          detail: "the ~standard property",
        }}
        branches={[
          { eyebrow: "default", label: "Zod", detail: "z.object({ ... })" },
          {
            eyebrow: "tree-shakeable",
            label: "Valibot",
            detail: "v.object({ ... })",
          },
          { label: "ArkType", detail: "type({ ... })" },
          { label: "TypeBox", detail: "via adapter" },
        ]}
        caption="Each validator exposes the same ~standard property, so DaloyJS infers handler types, generates OpenAPI, and returns problem+json errors through one framework path."
      />

      <h2 id="what-gets-validated">What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li>
          <code>request.params</code>: decoded path parameters. They start as
          strings; coerce in your schema if you want numbers, UUIDs, or enums.
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
          read when a route declares a body schema.
        </li>
        <li>
          <code>responses[status].body</code>: typed and validated response
          bodies.
        </li>
      </ul>
      <p>
        Query strings, form fields, and multipart fields drop prototype
        pollution keys such as <code>__proto__</code>, <code>constructor</code>,
        and <code>prototype</code> before validation.
      </p>

      <h2 id="end-to-end-example">End-to-end example</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const CreateLineItem = z.object({
  sku: z.string().min(1),
  qty: z.coerce.number().int().positive(),
});

const LineItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  sku: z.string(),
  qty: z.number().int().positive(),
  dryRun: z.boolean(),
});

export const app = new App().route({
  method: "POST",
  path: "/orders/:orderId/items",
  operationId: "createOrderItem",
  request: {
    params: z.object({ orderId: z.string().uuid() }),
    query: z
      .object({
        dryRun: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      })
      .optional(),
    headers: z.object({ "x-tenant": z.string().min(1) }),
    body: CreateLineItem,
  },
  responses: {
    201: { description: "Created", body: LineItem },
    422: { description: "Validation error" },
  },
  handler: async ({ params, query, headers, body }) => {
    const tenantId = headers["x-tenant"];
    const dryRun = query?.dryRun ?? false;

    return {
      status: 201,
      body: {
        id: \`\${params.orderId}:li_1\`,
        tenantId,
        ...body,
        dryRun,
      },
    };
  },
});`}
      />

      <h2 id="pick-your-validator">Pick your validator</h2>
      <ul>
        <li>
          <Link href="/docs/validation/zod">Zod</Link>: the default for most
          teams. Chainable API, large ecosystem, easy to learn.
        </li>
        <li>
          <Link href="/docs/validation/valibot">Valibot</Link>: modular and
          tree-shakeable. Great for edge runtimes and browser-shipped contracts.
        </li>
      </ul>
      <p>
        ArkType and TypeBox-compatible schemas also work when they expose the
        same <code>~standard</code> property, but DaloyJS only ships first-party
        docs and scaffolds for Zod and Valibot.
      </p>

      <h2 id="side-by-side">Side-by-side</h2>
      <CodeBlock
        code={`// Zod
import { z } from "zod";
const Body = z.object({
  sku: z.string(),
  qty: z.number().int().positive(),
});

// Valibot
import * as v from "valibot";
const Body = v.object({
  sku: v.string(),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

// ArkType
import { type } from "arktype";
const Body = type({ sku: "string", qty: "1<=number.integer" });

// TypeBox
import { Type } from "@sinclair/typebox";
const Body = Type.Object({ sku: Type.String(), qty: Type.Integer({ minimum: 1 }) });
// Wrap with your project's Standard Schema adapter before passing to DaloyJS.`}
      />
      <p>
        Once a schema exposes <code>~standard</code>, DaloyJS infers handler
        types, generates OpenAPI, and returns problem+json errors the same way
        regardless of which validator produced it.
      </p>

      <h2 id="errors">Errors</h2>
      <FlowDiagram
        title="Parse, then branch on the outcome"
        steps={[
          {
            eyebrow: "untrusted",
            label: "Raw request",
            detail: "params · query · headers · body",
            tone: "muted",
          },
          {
            eyebrow: "standard schema",
            label: "Schema parse",
            detail: "validate(schema, input)",
            tone: "accent",
          },
          {
            eyebrow: "on failure",
            label: "422 problem+json",
            detail: "errors: [{ path, message }]",
            tone: "danger",
          },
          {
            eyebrow: "on success",
            label: "Typed handler",
            detail: "ctx.body / params / query / headers",
            tone: "success",
          },
        ]}
        caption="Every declared schema runs before your handler. Invalid input never reaches handler code, it short-circuits to a 422 RFC 9457 response; valid input arrives fully typed."
      />
      <p>
        On invalid input, DaloyJS returns{" "}
        <strong>422 Unprocessable Entity</strong> as RFC 9457 problem+json with
        an <code>errors</code> array of per-issue <code>path</code> and{" "}
        <code>message</code> records. You don&apos;t write an error handler for
        this, it&apos;s built in. See{" "}
        <Link href="/docs/errors">Errors &amp; problem+json</Link>.
      </p>

      <h2 id="response-validation">Response validation</h2>
      <p>
        When a response schema is declared, DaloyJS validates the handler return
        before serializing it. The validated value is what goes on the wire, so
        object schemas that strip unknown keys also prevent undeclared fields
        from leaking to clients. If validation fails, the client receives a
        redacted 500 problem response in production.
      </p>

      <h2 id="body-limits-and-content-types">Body limits and content types</h2>
      <p>
        When a route declares <code>request.body</code>, DaloyJS also enforces:
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
        JSON bodies parse to objects, urlencoded bodies parse through{" "}
        <code>URLSearchParams</code>, and multipart bodies parse through the
        platform <code>Request.formData()</code> API. If you opt a route into a
        custom text media type, DaloyJS passes the decoded text into your body
        schema.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/legacy-form",
  operationId: "legacyForm",
  accepts: ["application/x-www-form-urlencoded"],
  request: {
    body: z.object({
      email: z.string().email(),
      qty: z.coerce.number().int().positive(),
    }),
  },
  responses: {
    200: { description: "ok", body: z.object({ ok: z.boolean() }) },
  },
  handler: async ({ body }) => ({ status: 200, body: { ok: body.qty > 0 } }),
});`}
      />

      <h2 id="mixing-validators">Mixing validators</h2>
      <p>
        You can mix and match per route. A Zod schema in one file and a Valibot
        schema in another are both valid, useful when migrating an existing
        codebase or consuming schemas from a shared package.
      </p>
    </>
  );
}
