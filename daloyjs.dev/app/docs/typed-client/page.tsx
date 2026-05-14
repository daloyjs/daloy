import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "Typed clients" };

export default function Page() {
  return (
    <>
      <h1>Typed clients</h1>
      <p>
        DaloyJS ships <strong>two</strong> ways to call your API with full type-safety. Use whichever fits your
        consumer.
      </p>

      <h2>1. In-process typed client (zero codegen)</h2>
      <p>For TypeScript consumers in the same monorepo (tests, internal tools, Next.js server actions):</p>
      <CodeBlock code={`import { createClient } from "@daloyjs/core/client";
    import { app } from "./server.js"; // your App instance

const client = createClient(app, { baseUrl: "http://localhost:3000" });

const r = await client.getBookById({ params: { id: "1" } });
//    ^? { status: 200; body: { id: string; title: string } }
//      | { status: 404; body: ProblemJson }

if (r.status === 200) {
  console.log(r.body.title); // string, fully typed
}`} />

      <p>The client is keyed by <code>operationId</code>, returns a discriminated union of <code>{`{status, body, headers}`}</code>, and infers everything from the route definition itself. No build step.</p>

      <h2>2. Hey API SDK (cross-language, cross-repo, build-time)</h2>
      <p>
        For consumers outside the monorepo or in other languages, generate a fully typed fetch SDK with{" "}
        <a href="https://heyapi.dev/openapi-ts/get-started" target="_blank" rel="noreferrer">@hey-api/openapi-ts</a>.
      </p>

      <CodeBlock language="bash" code={`pnpm add -D @hey-api/openapi-ts`} />

      <CodeBlock code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", format: "prettier" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`} />

      <CodeBlock language="json" code={`// package.json
"scripts": {
  "gen:openapi": "node --import tsx scripts/dump-openapi.ts",
  "gen:client":  "openapi-ts",
  "gen":         "pnpm gen:openapi && pnpm gen:client"
}`} />

      <CodeBlock language="bash" code={`pnpm gen
# writes:
#   generated/openapi.json
#   generated/client/{client.gen.ts, sdk.gen.ts, types.gen.ts, index.ts}`} />

      <h2>Using the generated SDK</h2>
      <CodeBlock code={`import { client } from "./generated/client";
import { getBookById } from "./generated/client/sdk.gen";

client.setConfig({ baseUrl: "https://api.example.com" });

const { data, error } = await getBookById({ path: { id: "1" } });
if (error) console.error(error);
else console.log(data.title);`} />

      <h2>Which one should I use?</h2>
      <table>
        <thead>
          <tr><th>Use case</th><th>Pick</th></tr>
        </thead>
        <tbody>
          <tr><td>Same-repo TypeScript caller (tests, internal tools)</td><td>In-process <code>createClient</code></td></tr>
          <tr><td>Web app / mobile RN bundle in a separate repo</td><td>Hey API SDK</td></tr>
          <tr><td>Non-TypeScript consumer (Python, Swift, Kotlin)</td><td>OpenAPI doc + their preferred generator</td></tr>
          <tr><td>Public SDK for third parties</td><td>Hey API SDK, published as its own package</td></tr>
        </tbody>
      </table>
    </>
  );
}
