import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Typed API clients",
  description:
    "Generate fully typed TypeScript clients from your DaloyJS OpenAPI spec with Hey API. Get end-to-end type safety between server and client with no drift.",
  path: "/docs/typed-client",
  keywords: [
    "typed API client",
    "OpenAPI client TypeScript",
    "Hey API client",
    "end-to-end type safety",
    "ts-rest alternative",
    "ts-rest vs DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Typed clients</h1>
      <p>
        DaloyJS ships <strong>two</strong> ways to call your API with full
        type-safety. Use whichever fits your consumer.
      </p>

      <h2 id="1-in-process-typed-client-zero-codegen">
        1. In-process typed client (zero codegen)
      </h2>
      <p>
        For TypeScript consumers in the same monorepo (tests, internal tools,
        Next.js server actions):
      </p>
      <CodeBlock
        code={`import { createInProcessClient } from "@daloyjs/core/client";
import { app } from "./app.js";

const client = createInProcessClient(app);

const r = await client.getBookById({ params: { id: "1" } });
//    ^? { status: 200; body: { id: string; title: string } }
//      | { status: 404; body: ProblemJson }

if (r.status === 200) {
  console.log(r.body.title); // string, fully typed
}`}
      />

      <p>
        The client is keyed by <code>operationId</code>, returns a discriminated
        union of <code>{`{status, body, headers}`}</code>, and infers everything
        from the route definition itself. No build step.
      </p>

      <div role="note">
        <p>
          <strong>Compose route tuples instead of widening the App.</strong>{" "}
          Export route files with <code>defineRoute()</code> and register a
          literal tuple with <code>app.registerRoutes([...])</code>. Chained{" "}
          <code>route()</code> calls also work. Two things deliberately erase
          inference and collapse the client to a loose surface:
        </p>
        <ul>
          <li>
            Annotating the instance with a bare{" "}
            <code>const app: App = ...</code> (or returning <code>: App</code>{" "}
            from a factory). The widening annotation discards the accumulated
            routes, so let the type be inferred instead.
          </li>
          <li>
            Registering routes as separate statements on a previously-declared
            variable instead of returning the chained result or using{" "}
            <code>registerRoutes()</code>.
          </li>
        </ul>
        <p>
          The modular-monolith guide shows a multi-file composition with route
          tuples from several bounded contexts. Callback-style{" "}
          <code>group()</code> and plugin <code>register()</code> still provide
          runtime encapsulation, but their callbacks cannot widen the parent
          variable&apos;s TypeScript generic. Use route tuples as the
          typed-client composition boundary.
        </p>
      </div>

      <h2 id="2-hey-api-sdk-cross-language-cross-repo-build-time">
        2. Hey API SDK (cross-language, cross-repo, build-time)
      </h2>
      <p>
        For consumers outside the monorepo or in other languages, generate a
        fully typed fetch SDK with{" "}
        <a
          href="https://heyapi.dev/openapi-ts/get-started"
          target="_blank"
          rel="noreferrer"
        >
          @hey-api/openapi-ts
        </a>
        .
      </p>

      <FlowDiagram
        title="Codegen pipeline"
        numbered
        caption="pnpm gen runs the whole chain: dump the spec from your routes, then let Hey API turn it into a typed fetch SDK. Re-run it whenever a route changes and the client stays in lockstep with the contract."
        steps={[
          { label: "Routes", detail: "app.route(...)", tone: "accent" },
          { label: "generateOpenAPI", detail: "@daloyjs/core/openapi" },
          { label: "openapi.json", detail: "OpenAPI 3.1 spec on disk" },
          { label: "openapi-ts", detail: "Hey API generator" },
          { label: "Typed SDK", detail: "sdk.gen.ts · types.gen.ts" },
          {
            label: "Consumer",
            detail: "fully typed fetch calls",
            tone: "success",
          },
        ]}
      />

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

      <CodeBlock
        language="json"
        code={`// package.json
"scripts": {
  "gen:openapi": "node scripts/dump-openapi.ts",
  "gen:client":  "openapi-ts",
  "gen":         "pnpm gen:openapi && pnpm gen:client"
}`}
      />

      <CodeBlock
        language="bash"
        code={`pnpm gen
# writes:
#   generated/openapi.json
#   generated/client/{client.gen.ts, sdk.gen.ts, types.gen.ts, index.ts}`}
      />

      <h2 id="using-the-generated-sdk">Using the generated SDK</h2>
      <CodeBlock
        code={`import { client } from "./generated/client/client.gen.js";
import { getBookById } from "./generated/client/sdk.gen.js";

client.setConfig({ baseUrl: "https://api.example.com" });

const { data, error } = await getBookById({ path: { id: "1" } });
if (error) console.error(error);
else if (data) console.log(data.title);`}
      />

      <h2 id="which-one-should-i-use">Which one should I use?</h2>
      <table>
        <thead>
          <tr>
            <th>Use case</th>
            <th>Pick</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Same-repo TypeScript caller (tests, internal tools)</td>
            <td>
              <code>createInProcessClient</code>
            </td>
          </tr>
          <tr>
            <td>Web app / mobile RN bundle in a separate repo</td>
            <td>Hey API SDK</td>
          </tr>
          <tr>
            <td>Non-TypeScript consumer (Python, Swift, Kotlin)</td>
            <td>OpenAPI doc + their preferred generator</td>
          </tr>
          <tr>
            <td>Public SDK for third parties</td>
            <td>Hey API SDK, published as its own package</td>
          </tr>
        </tbody>
      </table>

      <h2 id="coming-from-ts-rest">Coming from ts-rest?</h2>
      <p>
        <a href="https://ts-rest.com/" target="_blank" rel="noreferrer">
          ts-rest
        </a>{" "}
        is a popular contract-first library that gives you end-to-end TypeScript
        types <strong>without codegen</strong> by sharing a contract (
        <code>initContract</code>) between an adapter-based server (Express,
        Fastify, NestJS, Next.js) and a fetch client (<code>initClient</code>).
        If you like that model, DaloyJS will feel familiar, with two
        differences.
      </p>
      <p>
        First, in DaloyJS the <strong>route definition is the contract</strong>,
        there is no separate contract object to keep in sync. The in-process{" "}
        <code>createClient</code> shown above gives the same zero-codegen,
        shared-types experience for same-repo TypeScript callers.
      </p>
      <p>
        Second, ts-rest&apos;s type safety is TypeScript-only and requires the
        client to import the contract. DaloyJS emits a first-class{" "}
        <strong>OpenAPI 3.1</strong> spec and a Hey API SDK from the same
        routes, so consumers that can&apos;t import your types (other repos,
        other languages, public SDKs) are covered too. In ts-rest, OpenAPI is an
        optional add-on (<code>@ts-rest/open-api</code>). DaloyJS is also the
        server and runtime itself, portable across Node, Bun, Deno, Cloudflare,
        and Vercel, rather than a typing layer mounted on a separate framework.
      </p>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>ts-rest</th>
            <th>DaloyJS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Contract source</td>
            <td>
              Separate <code>initContract</code> object
            </td>
            <td>The route definition itself</td>
          </tr>
          <tr>
            <td>Zero-codegen typed client</td>
            <td>
              Yes (<code>initClient</code>, TypeScript only)
            </td>
            <td>
              Yes (<code>createClient</code>, TypeScript only)
            </td>
          </tr>
          <tr>
            <td>Cross-language / cross-repo clients</td>
            <td>
              OpenAPI add-on (<code>@ts-rest/open-api</code>)
            </td>
            <td>OpenAPI 3.1 + Hey API SDK, first-class</td>
          </tr>
          <tr>
            <td>Server</td>
            <td>Adapter on Express / Fastify / NestJS / Next.js</td>
            <td>Built-in, runtime-portable</td>
          </tr>
          <tr>
            <td>Runtime validation</td>
            <td>Standard Schema (Zod / Valibot / ArkType)</td>
            <td>Standard Schema (Zod / Valibot / ArkType / TypeBox)</td>
          </tr>
          <tr>
            <td>Security defaults</td>
            <td>Bring your own</td>
            <td>Built-in headers, CSRF, rate limits, body limits, and more</td>
          </tr>
        </tbody>
      </table>

      <p>
        Need a bigger contract to validate your generator output? Use the{" "}
        <Link href="/docs/tutorials/fake-rest-api">large fake REST demo</Link>{" "}
        as the stress case instead of a minimal tutorial app.
      </p>
    </>
  );
}
