import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Getting started",
  description:
    "Build your first DaloyJS application: declare a contract-first route, validate with Zod, generate OpenAPI, and serve responses on any supported runtime.",
  path: "/docs/getting-started",
  keywords: [
    "DaloyJS quickstart",
    "first DaloyJS app",
    "TypeScript API tutorial",
    "Swagger UI",
    "Scalar API reference",
    "OpenAPI docs UI",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Getting started</h1>
      <p>
        Build a tiny DaloyJS server, hit it with the typed client, and inspect
        the OpenAPI spec, in five minutes.
      </p>

      <FlowDiagram
        numbered
        title="Five minutes, five steps"
        steps={[
          { label: "Scaffold", detail: "pnpm add @daloyjs/core zod" },
          {
            label: "Write a route",
            detail: "app.route({ ... })",
            tone: "accent",
          },
          { label: "Add OpenAPI & docs UI", detail: "docs: true" },
          {
            label: "Call the typed client",
            detail: "createClient(app)",
          },
          {
            label: "Generate a Hey API SDK",
            detail: "pnpm exec openapi-ts",
            tone: "success",
          },
        ]}
        caption="This guide goes from an empty folder to a typed SDK in five steps, each one builds on the route you declared in step two."
      />

      <h2>1. Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`mkdir hello-daloy && cd hello-daloy
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript tsx @types/node`}
      />

      <CodeBlock
        language="json"
        code={`// package.json, add these
{
  "type": "module",
  "scripts": {
    "dev": "node --import tsx/esm --watch src/index.ts",
    "start": "node --import tsx/esm src/index.ts"
  }
}`}
      />
      <p>
        We use the explicit <code>tsx/esm</code> loader subpath because the
        project is <code>&quot;type&quot;: &quot;module&quot;</code>. The bare{" "}
        <code>--import tsx</code> form also works on recent Node versions, but{" "}
        <code>tsx/esm</code> is the canonical entrypoint for ESM projects and
        avoids loader-resolution surprises in stricter setups.
      </p>

      <p>
        We use <code>src/index.ts</code> and <code>--watch</code> here so the
        layout matches what <Link href="/docs/scaffolder">create-daloy</Link>{" "}
        emits, copy/paste between this guide and a scaffolded project without
        renaming files.
      </p>

      <h2>2. Write your first route</h2>
      <CodeBlock
        code={`// src/index.ts
import { z } from "zod";
import { App, requestId, secureHeaders } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
})
  .use(requestId())
  .use(secureHeaders())
  .route({
    method: "GET",
    path: "/greet/:name",
    operationId: "greet",
    tags: ["Demo"],
    request: { params: z.object({ name: z.string().min(1) }) },
    responses: {
      200: { description: "Greeting", body: z.object({ msg: z.string() }) },
    },
    handler: async ({ params }) => ({
      status: 200,
      body: { msg: \`Hello, \${params.name}!\` },
    }),
  });

const { port } = serve(app, { port: 3000 });
console.log(\`listening on http://localhost:\${port}\`);`}
      />

      <p>
        Prefer the colorized startup panel you get from{" "}
        <code>create-daloy</code> templates? Swap the plain{" "}
        <code>console.log</code> for <code>printStartupBanner()</code> from{" "}
        <code>@daloyjs/core/banner</code>: it renders a TTY-aware,
        ASCII-fallback boxed banner with your app name, URL, and any extra links
        (API docs, health check, etc.):
      </p>
      <CodeBlock
        code={`import { printStartupBanner } from "@daloyjs/core/banner";

const { port } = serve(app, { port: 3000 });
printStartupBanner({
  name: "MyAPI",
  version: "1.0.0",
  url: \`http://localhost:\${port}\`,
  runtime: "Node.js",
  links: [
    { label: "API docs", url: \`http://localhost:\${port}/docs\` },
    { label: "OpenAPI JSON", url: \`http://localhost:\${port}/openapi.json\` },
    { label: "OpenAPI YAML", url: \`http://localhost:\${port}/openapi.yaml\` },
    { label: "Health", url: \`http://localhost:\${port}/healthz\` },
  ],
});`}
      />

      <CodeBlock
        language="bash"
        code={`pnpm dev
# in another shell
curl http://localhost:3000/greet/world
# → {"msg":"Hello, world!"}`}
      />

      <p>
        Don&apos;t want to spin up a real server? Every <code>App</code> exposes{" "}
        <code>app.request(input, init?)</code>, an in-process test client that
        takes a URL or <code>Request</code> and returns a <code>Response</code>{" "}
        , no network stack, no port, no second terminal. It&apos;s the same
        entrypoint the typed client and{" "}
        <Link href="/docs/testing">testing guide</Link> use:
      </p>
      <CodeBlock
        code={`const res = await app.request("/greet/world");
console.log(res.status, await res.json());
// → 200 { msg: "Hello, world!" }`}
      />

      <h2>3. Add OpenAPI &amp; docs UI</h2>
      <p>
        One line on the <code>App</code> constructor and DaloyJS auto-mounts{" "}
        <code>GET /openapi.json</code> + <code>GET /openapi.yaml</code> (the
        live spec in both formats) and <code>GET /docs</code> (a Scalar API
        reference UI) for you:
      </p>
      <CodeBlock
        code={`const app = new App({
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
  openapi: { info: { title: "Hello", version: "1.0.0" } },
  docs: true, // mounts GET /docs, GET /openapi.json, GET /openapi.yaml
});`}
      />

      <p>
        Open <code>http://localhost:3000/docs</code> for an interactive Scalar
        reference, <code>http://localhost:3000/openapi.json</code> for the raw
        JSON spec, or <code>http://localhost:3000/openapi.yaml</code> for the
        YAML spec.
      </p>

      <p>
        If you omit <code>openapi.info</code> entirely, DaloyJS will read your
        project&apos;s <code>package.json</code> (<code>name</code>,{" "}
        <code>version</code>, <code>description</code>) and use those for the
        spec automatically. Deno projects without a <code>package.json</code>{" "}
        fall back to <code>deno.json</code> / <code>deno.jsonc</code>. Explicit
        values always override the autofill.
      </p>

      <p>
        Prefer a factory call? <code>createApp(options)</code> is an exported
        alias of <code>new App(options)</code> with identical behaviour:
      </p>
      <CodeBlock
        code={`import { createApp } from "@daloyjs/core";

const app = createApp({ docs: true });`}
      />

      <h3>Prefer the classic Swagger UI?</h3>
      <p>
        Scalar is the default because it&apos;s faster, prettier, and friendlier
        on mobile, but if your team is used to Swagger UI, or you have existing
        screenshots, runbooks, or muscle memory built around it, DaloyJS ships
        it out of the box. Flip the <code>ui</code> field on the object form of{" "}
        <code>docs</code> and you&apos;re back to the familiar green UI:
      </p>
      <CodeBlock
        code={`const app = new App({
  openapi: { info: { title: "Hello", version: "1.0.0" } },
  docs: {
    ui: "swagger", // "scalar" (default) | "swagger" | "redoc"
    path: "/docs", // optional, change if you want /reference, /api-docs, etc.
  },
});`}
      />
      <p>
        Same URL (<code>GET /docs</code>), same live <code>/openapi.json</code>{" "}
        and <code>/openapi.yaml</code> endpoints, same CSP handling, only the
        rendered HTML changes. You can also keep both: leave the auto-mounted
        route on Scalar and expose a second Swagger route yourself with{" "}
        <code>swaggerUiHtml()</code> (see the{" "}
        <Link href="/docs/openapi">OpenAPI guide</Link> for the manual recipe).
      </p>

      <p>
        Want a custom path? Use the object form:{" "}
        <code>{`docs: { ui: "swagger", path: "/reference" }`}</code>. Want it
        only in development? Use <code>{`docs: "auto"`}</code>: it skips the
        mount when <code>production: true</code>. Need full control? Set{" "}
        <code>docs: false</code> and mount your own routes with{" "}
        <code>generateOpenAPI()</code> and{" "}
        <code>swaggerUiHtml() / scalarHtml()</code>: see the{" "}
        <Link href="/docs/openapi">OpenAPI guide</Link>.
      </p>

      <p>
        Both <code>swaggerUiHtml()</code> and <code>scalarHtml()</code> load
        their default assets from the jsDelivr CDN, so a strict
        Content-Security-Policy must allow those assets or the docs UI can
        render blank. The auto-mounted route and <code>htmlResponse()</code>{" "}
        both add a compatible CSP automatically; if you build your own response,
        import <code>docsContentSecurityPolicy</code> from{" "}
        <code>@daloyjs/core/docs</code> and pass the result as the response
        header:
      </p>
      <CodeBlock
        code={`import { docsContentSecurityPolicy } from "@daloyjs/core/docs";

headers: { "content-security-policy": docsContentSecurityPolicy() }`}
      />

      <h2>4. Use the typed in-process client</h2>
      <CodeBlock
        code={`import { createClient } from "@daloyjs/core/client";

const client = createClient(app, { baseUrl: "http://localhost:3000" });
const r = await client.greet({ params: { name: "DaloyJS" } });
//    ^? { status: 200; body: { msg: string } }
console.log(r.status, r.body);`}
      />
      <p>
        The client&apos;s methods are inferred from the routes you chained onto{" "}
        <code>app</code>. Keep the registrations chained (
        <code>new App().route(a).route(b)</code>) and avoid a widening{" "}
        <code>const app: App</code> annotation; either one erases the per-route
        types and the client falls back to an untyped surface.
      </p>

      <h2>5. Generate a Hey API SDK</h2>
      <p>
        For consumers outside the monorepo, generate a fully typed fetch SDK:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm add -D @hey-api/openapi-ts prettier`}
      />

      <CodeBlock
        code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", postProcess: ["prettier"] },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`}
      />

      <p>
        Keep the dev server from step two running, then write the live OpenAPI
        document to disk before you run the SDK generator:
      </p>

      <CodeBlock
        language="bash"
        code={`mkdir -p generated
curl http://localhost:3000/openapi.json -o generated/openapi.json
pnpm exec openapi-ts`}
      />

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link href="/docs/routing">Routing</Link>
        </li>
        <li>
          <Link href="/docs/validation">Validation with Standard Schema</Link>
        </li>
        <li>
          <Link href="/docs/security">Security guardrails and middleware</Link>
        </li>
        <li>
          <Link href="/docs/tutorials/bookstore">Tutorial: bookstore API</Link>
        </li>
      </ul>
    </>
  );
}
