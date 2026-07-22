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
            detail: "app.get(path, contract, handler)",
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

      <h2 id="1-scaffold">1. Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`mkdir hello-daloy && cd hello-daloy
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript @types/node`}
      />

      <CodeBlock
        language="json"
        code={`// package.json, add these
{
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.ts",
    "start": "node src/index.ts"
  }
}`}
      />
      <p>
        Node.js runs TypeScript entrypoints directly via built-in type stripping
        (stable in Node 24+, available since 22.18), so local development needs
        no transpiler and no separate build step.
      </p>

      <p>
        We use <code>src/index.ts</code> and <code>--watch</code> here so the
        layout matches what <Link href="/docs/scaffolder">create-daloy</Link>{" "}
        emits, copy/paste between this guide and a scaffolded project without
        renaming files.
      </p>

      <h2 id="2-write-your-first-route">2. Write your first route</h2>
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
  .get(
    "/greet/:name",
    {
      tags: ["Demo"],
      request: { params: z.object({ name: z.string().min(1) }) },
      responses: {
        200: { description: "Greeting", body: z.object({ msg: z.string() }) },
      },
    },
    async ({ params }) => ({
      status: 200,
      body: { msg: \`Hello, \${params.name}!\` },
    }),
  );

const { port } = serve(app, { port: 3000 });
console.log(\`listening on http://localhost:\${port}\`);`}
      />

      <p>
        Prefer the colorized startup panel you get from{" "}
        <code>create-daloy</code> templates? Swap the plain{" "}
        <code>console.log</code> for <code>printStartupBanner()</code> from{" "}
        <code>@daloyjs/core/banner</code>
        {": "}it renders a TTY-aware, ASCII-fallback boxed banner with your app
        name, URL, and any extra links (API docs, health check, etc.):
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
# -> {"msg":"Hello, world!"}`}
      />

      <p>
        Don&apos;t want to spin up a real server? Every <code>App</code> exposes{" "}
        <code>app.request(input, init?)</code>
        {", "}an in-process test client that takes a URL or <code>Request</code>{" "}
        and returns a <code>Response</code>
        {", "}
        no network stack, no port, no second terminal. It&apos;s the same
        entrypoint the typed client and{" "}
        <Link href="/docs/testing">testing guide</Link> use:
      </p>
      <CodeBlock
        code={`const res = await app.request("/greet/world");
console.log(res.status, await res.json());
// -> 200 { msg: "Hello, world!" }`}
      />

      <h2 id="3-add-openapi-and-docs-ui">3. Add OpenAPI &amp; docs UI</h2>
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
        Set <code>openapi.info</code> (or the top-level <code>title</code>
        {", "}
        <code>version</code>
        {", "}and <code>description</code>) for a real service. If omitted,
        DaloyJS uses the portable <code>DaloyJS API</code> / <code>0.0.0</code>{" "}
        fallback. The core never reads a host manifest, so the same docs bundle
        works on Node, Bun, Deno, Workers, and Vercel.
      </p>

      <p>
        Prefer a factory call? <code>createApp(options)</code> is an exported
        alias of <code>new App(options)</code> with identical behaviour:
      </p>
      <CodeBlock
        code={`import { createApp } from "@daloyjs/core";

const app = createApp({
  docs: true,
  openapi: { info: { title: "My API", version: "1.0.0" } },
});`}
      />

      <h3 id="prefer-the-classic-swagger-ui">Prefer the classic Swagger UI?</h3>
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
        <code>{`docs: { ui: "swagger", path: "/reference" }`}</code>
        {". "}Want it only in development? Use <code>{`docs: "auto"`}</code>
        {": "}it skips the mount when <code>production: true</code>
        {". "}Need full control? Set <code>docs: false</code> and mount your own
        routes with <code>generateOpenAPI()</code> and{" "}
        <code>swaggerUiHtml() / scalarHtml()</code>
        {": "}see the <Link href="/docs/openapi">OpenAPI guide</Link>.
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

      <h2 id="4-use-the-typed-in-process-client">
        4. Use the typed in-process client
      </h2>
      <CodeBlock
        code={`import { createInProcessClient } from "@daloyjs/core/client";

const client = createInProcessClient(app);
const r = await client.greet({ params: { name: "DaloyJS" } });
//    ^? { status: 200; body: { msg: string } }
console.log(r.status, r.body);`}
      />
      <p>
        The client&apos;s methods are inferred from the app&apos;s route tuple.
        Chain registrations or compose exported <code>defineRoute()</code>{" "}
        contracts with <code>registerRoutes([...])</code>
        {". "}Avoid widening the result to a bare <code>App</code> annotation,
        which deliberately erases that tuple.
      </p>

      <h2 id="5-generate-a-hey-api-sdk">5. Generate a Hey API SDK</h2>
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

      <h2 id="next-steps">Next steps</h2>
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
