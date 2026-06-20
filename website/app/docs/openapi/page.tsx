import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "OpenAPI generation",
  description:
    "Auto-generate OpenAPI 3.1 specs from your DaloyJS routes. Powered by Hey API, the spec stays in sync with your contracts and powers the typed client.",
  path: "/docs/openapi",
  keywords: [
    "OpenAPI 3.1",
    "OpenAPI generator TypeScript",
    "Hey API",
    "DaloyJS OpenAPI",
    "automatic API docs",
    "Swagger UI",
    "Scalar API reference",
    "Redoc",
    "docs UI switch",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>OpenAPI generation</h1>
      <p>
        DaloyJS emits a clean <strong>OpenAPI 3.1</strong> document straight
        from your route definitions, no plugins, no separate decorators.
        Validation, types, and the spec all share one source of truth.
      </p>

      <BranchDiagram
        title="One contract, four outputs"
        source={{
          eyebrow: "single source of truth",
          label: "Route definition",
          detail: "app.route({ request, responses, handler })",
        }}
        branches={[
          {
            eyebrow: "runtime",
            label: "Request & response validation",
            detail: "Zod · Valibot · ArkType",
          },
          {
            eyebrow: "spec",
            label: "OpenAPI 3.1 document",
            detail: "GET /openapi.json · /openapi.yaml",
          },
          {
            eyebrow: "humans",
            label: "Docs UI",
            detail: "Scalar · Swagger UI · Redoc",
          },
          {
            eyebrow: "consumers",
            label: "Typed client SDK",
            detail: "Hey API codegen",
          },
        ]}
        caption="You write the route once. Validation, the OpenAPI spec, the interactive docs, and the typed client are all derived from it, so they can never drift out of sync."
      />

      <h2>One line: auto-mount /docs, /openapi.json, /openapi.yaml</h2>
      <p>
        FastAPI-style. Pass <code>docs: true</code> to the <code>App</code>{" "}
        constructor and DaloyJS registers <code>GET /openapi.json</code> +{" "}
        <code>GET /openapi.yaml</code> (the live spec in both formats) and{" "}
        <code>GET /docs</code> (a Scalar API reference UI) for you.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App({
  openapi: {
    info: { title: "My API", version: "1.0.0" },
    servers: [{ url: "https://api.example.com" }],
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  docs: true, // mounts GET /docs, GET /openapi.json, GET /openapi.yaml
});`}
      />

      <p>
        Use <code>docs: &quot;auto&quot;</code> to mount only when{" "}
        <code>production: false</code>, or leave it off (the default) and mount
        manually with the helpers below. Customize paths, UI, and tags via the
        object form:
      </p>
      <CodeBlock
        code={`new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: {
    path: "/reference",              // default: "/docs"
    openapiPath: "/spec.json",       // default: "/openapi.json"
    openapiYamlPath: "/spec.yaml",   // default: "/openapi.yaml"; false disables it
    ui: "scalar",                     // "scalar" (default) | "swagger" | "redoc"
    scalar: {
      theme: "kepler",
      customCss: ":root { --scalar-color-accent: #2563eb; }",
      hideTestRequestButton: true,
    },
    tags: ["Docs"],                   // default: ["Docs"], pass [] to omit
    enabled: "auto",                  // true | false | "auto" (off in production)
  },
});`}
      />

      <h2>Pick a UI: Scalar, Swagger UI, or Redoc</h2>
      <p>
        Set <code>ui</code> to <code>&quot;scalar&quot;</code> (default),{" "}
        <code>&quot;swagger&quot;</code>, or <code>&quot;redoc&quot;</code>. All
        three render the same live spec, mount on the same paths, and ship the
        same strict CSP and CDN-hosted assets, so switching is a one-word change.
      </p>
      <CodeBlock
        code={`new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: {
    ui: "redoc",
    redoc: {
      // Any Redoc standalone option is accepted (forwarded to Redoc.init):
      disableSearch: false,
      hideDownloadButtons: true,
      sortPropsAlphabetically: true,
      theme: { colors: { primary: { main: "#2563eb" } } },
    },
  },
});`}
      />
      <p>
        The <code>redoc</code> object is forwarded verbatim to{" "}
        <code>Redoc.init(specUrl, configuration, element)</code>. Because Redoc
        builds its search index in a <code>blob:</code> Web Worker, the
        auto-mounted <code>/docs</code> route automatically widens that page&apos;s
        CSP with <code>worker-src &apos;self&apos; blob:</code> for{" "}
        <code>ui: &quot;redoc&quot;</code> only. Scalar and Swagger UI keep the
        tighter policy. The <code>scalar</code> option is ignored unless{" "}
        <code>ui</code> is <code>&quot;scalar&quot;</code>, and likewise for{" "}
        <code>redoc</code>.
      </p>

      <p>
        The <code>scalar</code> object is forwarded to Scalar&apos;s HTML API as
        JSON configuration while Daloy keeps the live <code>openapiPath</code>{" "}
        as the source. Use it for themes, custom CSS, layout, auth defaults, and
        client visibility without copying the docs HTML.
      </p>

      <h2>Advanced: generate the spec manually</h2>
      <p>
        Need the raw spec object (for codegen, contract tests, or a custom
        route)? Call <code>generateOpenAPI(app, options)</code> directly:
      </p>
      <CodeBlock
        code={`import { generateOpenAPI } from "@daloyjs/core/openapi";

const doc = generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
});

console.log(JSON.stringify(doc, null, 2));`}
      />

      <h2>Advanced: serve docs from your own route</h2>
      <CodeBlock
        code={`import { swaggerUiHtml, scalarHtml, redocHtml, htmlResponse } from "@daloyjs/core/docs";

app.route({
  method: "GET",
  path: "/docs",
  operationId: "docs",
  responses: { 200: { description: "API reference" } },
  handler: async () => {
    const html = scalarHtml({
      specUrl: "/openapi.json",
      title: "My API",
      configuration: { theme: "kepler" },
    });
    const res = htmlResponse(html);
    return { status: 200, body: await res.text(), headers: Object.fromEntries(res.headers) };
  },
});`}
      />

      <p>
        <code>swaggerUiHtml</code>, <code>scalarHtml</code>, and{" "}
        <code>redocHtml</code> all return self-contained HTML pages that load
        their assets from jsDelivr with a strict CSP allowing only that origin.
        When you hand-roll the route with <code>redocHtml</code>, pass{" "}
        <code>allowBlobWorkers: true</code> to <code>htmlResponse</code> (or{" "}
        <code>docsContentSecurityPolicy</code>) so Redoc&apos;s{" "}
        <code>blob:</code> search worker is allowed by the CSP:
      </p>
      <CodeBlock
        code={`import { redocHtml, htmlResponse } from "@daloyjs/core/docs";

const res = htmlResponse(
  redocHtml({ specUrl: "/openapi.json", title: "My API", configuration: { hideDownloadButtons: true } }),
  { allowBlobWorkers: true },
);`}
      />

      <p>
        If you want to test your docs UX against a much larger contract, see the{" "}
        <Link href="/docs/tutorials/fake-rest-api">large fake REST demo</Link>.
        It is a better benchmark than a toy CRUD sample when you need to
        validate search, grouping, and render performance.
      </p>

      <h2>Dump to disk for codegen</h2>
      <CodeBlock
        language="ts"
        code={`// scripts/dump-openapi.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { buildApp } from "../src/build-app.js";

const app = buildApp();
const out = "./generated/openapi.json";
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
}), null, 2));
console.log(\`wrote \${out}\`);`}
      />

      <CodeBlock
        language="json"
        code={`// package.json
"scripts": {
  "gen:openapi": "node --import tsx/esm scripts/dump-openapi.ts"
}`}
      />

      <h2>What gets emitted</h2>
      <ul>
        <li>
          One <code>operationId</code> per route, duplicates throw at
          registration.
        </li>
        <li>
          Path params <code>:id</code> normalized to <code>{`{id}`}</code>.
        </li>
        <li>
          Schema bodies converted via <code>schema.toJSONSchema?.()</code> when
          supported, or a structural fallback.
        </li>
        <li>
          Reusable <code>components.schemas.Problem</code> for RFC 9457 errors.
        </li>
        <li>
          <code>tags</code>, <code>summary</code>, <code>description</code>, and
          per-status <code>description</code>.
        </li>
      </ul>

      <h2>Webhooks</h2>
      <p>
        OpenAPI 3.1 lets a producer publish <strong>top-level webhooks</strong>{" "}
, operations a consumer is expected to implement. Pass{" "}
        <code>webhooks</code> to <code>generateOpenAPI</code>
        and DaloyJS emits them under the document&apos;s top-level{" "}
        <code>webhooks</code> map.
      </p>
      <CodeBlock
        code={`import { generateOpenAPI } from "@daloyjs/core/openapi";

const doc = generateOpenAPI(app, {
  info: { title: "Books", version: "1.0.0" },
  webhooks: {
    bookCreated: {
      method: "POST",
      operationId: "onBookCreated",
      summary: "Fires when a book is created",
      tags: ["Webhooks"],
      request: { body: z.object({ id: z.string(), title: z.string() }) },
      responses: { 200: { description: "Acknowledged" } },
      auth: { scheme: "bearer", scopes: ["webhook:receive"] },
    },
  },
});`}
      />

      <h2>Callbacks</h2>
      <p>
        <strong>Callbacks</strong> describe out-of-band requests that an
        operation may trigger on the consumer (e.g. a subscription endpoint that
        later POSTs to the URL the caller supplied). Attach a{" "}
        <code>callbacks</code> map directly to a route or webhook.
      </p>
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/subscribe",
  operationId: "subscribe",
  request: { body: z.object({ callbackUrl: z.string().url() }) },
  responses: { 201: { description: "Subscribed" } },
  callbacks: {
    onEvent: {
      "{$request.body#/callbackUrl}": {
        method: "POST",
        operationId: "onEventCallback",
        request: { body: z.object({ id: z.string() }) },
        responses: {
          200: { description: "ack" },
          410: { description: "gone" },
        },
      },
    },
  },
  handler: async () => ({ status: 201, body: undefined }),
});`}
      />
      <p>
        Each callback name maps to one or more runtime expression keys (e.g.{" "}
        <code>{`"{$request.body#/callbackUrl}"`}</code>), each of which maps to
        one or more operations keyed by HTTP method. Empty maps and empty arrays
        are skipped, passing an empty callback never produces a malformed spec.
      </p>

      <h2>Discriminated unions</h2>
      <p>
        OpenAPI 3.1&apos;s <code>discriminator</code> is the canonical way to
        describe tagged unions. DaloyJS ships two helpers from{" "}
        <code>@daloyjs/core/openapi</code> (and the root package):
      </p>
      <ul>
        <li>
          <code>discriminator(propertyName, mapping?)</code>: the bare spec
          builder. Use it when you already have a hand-rolled JSON Schema and
          just want to attach the field cleanly.
        </li>
        <li>
          <code>discriminatedUnion(propertyName, variants, opts?)</code>: a
          Standard-Schema- compatible wrapper that <em>both</em> validates at
          runtime (dispatching on the discriminator value) <em>and</em> exposes{" "}
          <code>.toJSONSchema()</code> so the OpenAPI generator emits{" "}
          <code>{`{ oneOf, discriminator }`}</code> automatically.
        </li>
      </ul>
      <CodeBlock
        code={`import { z } from "zod";
import { discriminatedUnion } from "@daloyjs/core";

const Cat = z.object({ kind: z.literal("cat"), meow: z.boolean() });
const Dog = z.object({ kind: z.literal("dog"), bark: z.boolean() });

const Animal = discriminatedUnion(
  "kind",
  { cat: Cat, dog: Dog },
  { mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" } },
);

app.route({
  method: "POST",
  path: "/animals",
  operationId: "createAnimal",
  request: { body: Animal },
  responses: { 201: { description: "ok", body: Animal } },
  handler: async ({ body }) => ({ status: 201, body }),
});`}
      />
      <p>
        At runtime the wrapper rejects non-objects, missing or non-string
        discriminators, and unknown discriminator values with a clear Standard
        Schema issue, then defers to the matching variant&apos;s validator for
        everything else.
      </p>
    </>
  );
}
