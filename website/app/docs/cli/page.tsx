import { CodeBlock } from "../../../components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "CLI inspector — daloy inspect",
  description:
    "Use the daloy CLI to introspect routes, contract-test an app, or dump OpenAPI 3.1 from any DaloyJS project.",
  path: "/docs/cli",
  keywords: [
    "daloy CLI",
    "daloy inspect",
    "DaloyJS routes",
    "OpenAPI dump",
    "contract tests CLI",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>CLI inspector</h1>
      <p>
        <code>@daloyjs/core</code> ships a tiny <code>daloy</code> binary that loads your{" "}
        <code>App</code> instance and prints what is registered. It is the fastest way to answer
        questions like <em>“what routes does this service expose?”</em>,{" "}
        <em>“are any operationIds missing?”</em>, or <em>“give me the OpenAPI spec”</em> without
        starting a server.
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        language="bash"
        code={`pnpm daloy inspect             # also tries build-app/createApp-style factories
pnpm daloy inspect ./src/server.ts
pnpm daloy inspect --schemas
pnpm daloy inspect --check        # exit 1 on contract errors
pnpm daloy inspect --openapi > openapi.json
pnpm daloy inspect --tag Users
pnpm daloy inspect --method post --json`}
      />

      <h2>Loading the App</h2>
      <p>
        The entry file must export an <code>App</code> instance, either as the default export or as
        a named export called <code>app</code>. It can also export a zero-argument <code>buildApp</code>
        or <code>createApp</code> factory that returns an <code>App</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";

export const app = new App();
app.route({ /* ... */ });

// Or:
// export default app;

// Or:
export function buildApp() {
  const app = new App();
  app.route({ /* ... */ });
  return app;
}`}
      />
      <p>
        TypeScript entry files are loaded via <code>tsx</code>. <code>create-daloy</code>{" "}
        templates already include <code>tsx</code>; in other projects install it with{" "}
        <code>pnpm add -D tsx</code>.
      </p>

      <h2>Flags</h2>
      <ul>
        <li>
          <code>--json</code> — emit a machine-readable JSON document instead of a human table.
        </li>
        <li>
          <code>--check</code> — run the contract suite ({" "}
          <a href="/docs/testing">missing operationIds, duplicate operationIds, dead routes,
          body schemas on safe methods, invalid examples</a>
          ) and exit 1 on any error.
        </li>
        <li>
          <code>--schemas</code> — add a <code>B/Q/P/H</code> column showing which of body, query,
          params, and headers schemas the route declares.
        </li>
        <li>
          <code>--openapi</code> — print the OpenAPI 3.1 document.
        </li>
        <li>
          <code>--tag &lt;tag&gt;</code> — only show routes that declare this tag.
        </li>
        <li>
          <code>--method &lt;method&gt;</code> — only show routes for this HTTP method.
        </li>
        <li>
          <code>-h, --help</code> · <code>-v, --version</code>
        </li>
      </ul>

      <h2>CI usage</h2>
      <p>
        <code>daloy inspect --check</code> is a drop-in replacement for the in-process{" "}
        <code>runContractTests</code> runner. Wire it into your pipeline to fail builds on dead
        routes, duplicate operationIds, and missing operationIds:
      </p>
      <CodeBlock
        language="yaml"
        code={`- name: Contract checks
  run: pnpm daloy inspect --check`}
      />

      <h2>Programmatic API</h2>
      <p>
        The CLI is also exported as a function so you can wire it into custom scripts or your own
        binary:
      </p>
      <CodeBlock
        language="ts"
        code={`import { runCli } from "@daloyjs/core/cli";

const result = await runCli(process.argv.slice(2), {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
  importEntry: (specifier) => import(specifier),
  version: "1.0.0",
});

process.exit(result.exitCode);`}
      />
    </>
  );
}
