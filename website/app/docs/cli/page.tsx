import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "CLI, daloy inspect & daloy dev",
  description:
    "Use the daloy CLI to introspect routes, contract-test an app, dump OpenAPI 3.1, or start a watch-mode dev server on any DaloyJS project.",
  path: "/docs/cli",
  keywords: [
    "daloy CLI",
    "daloy inspect",
    "daloy dev",
    "daloy doctor",
    "daloy diff",
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
        <code>@daloyjs/core</code> ships a tiny <code>daloy</code> binary that
        loads your <code>App</code> instance and prints what is registered. It
        is the fastest way to answer questions like{" "}
        <em>“what routes does this service expose?”</em>,{" "}
        <em>“are any operationIds missing?”</em>, or{" "}
        <em>“give me the OpenAPI spec”</em> without starting a server.
      </p>

      <BranchDiagram
        title="Load the App, emit anything"
        source={{
          eyebrow: "loads your app",
          label: "daloy inspect [entry]",
          detail: "default export, app, or buildApp() / createApp()",
        }}
        branches={[
          {
            eyebrow: "default",
            label: "Human table",
            detail: "method, path, operationId",
          },
          {
            eyebrow: "--json",
            label: "Machine-readable JSON",
            detail: "route catalog",
          },
          {
            eyebrow: "--openapi",
            label: "OpenAPI 3.1 document",
            detail: "add --yaml for YAML",
          },
          {
            eyebrow: "--asyncapi",
            label: "AsyncAPI 3.0 document",
            detail: "app.ws() surfaces",
          },
          {
            eyebrow: "--ai",
            label: "AI/codegen dump",
            detail: "schemas + meta.examples",
          },
          {
            eyebrow: "--check",
            label: "Contract suite",
            detail: "exit 1 on errors",
            tone: "danger",
          },
        ]}
        caption="One command loads your App instance without starting a server, then prints the registered routes in whatever shape you ask for."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="bash"
        code={`pnpm exec daloy inspect             # also tries build-app/createApp-style factories
pnpm exec daloy inspect ./src/server.ts
pnpm exec daloy inspect --schemas
pnpm exec daloy inspect --check        # exit 1 on contract errors
pnpm exec daloy inspect --openapi > openapi.json
pnpm exec daloy inspect --openapi --yaml > openapi.yaml
pnpm exec daloy inspect --asyncapi > asyncapi.json
pnpm exec daloy inspect --asyncapi --yaml > asyncapi.yaml
pnpm exec daloy inspect --ai > routes.json
pnpm exec daloy inspect --ai --yaml > routes.yaml      # ~30% fewer LLM tokens
pnpm exec daloy inspect --tag Users
pnpm exec daloy inspect --method post --json
pnpm exec daloy doctor
pnpm exec daloy diff openapi.published.json openapi.json`}
      />

      <h2 id="loading-the-app">Loading the App</h2>
      <p>
        The entry file must export an <code>App</code> instance. The CLI accepts
        a default export, named <code>app</code> or <code>default_app</code>{" "}
        exports, a zero-argument <code>buildApp</code> or <code>createApp</code>{" "}
        factory, or any named export that is already an <code>App</code>:
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
        Without an explicit entry, <code>daloy inspect</code> tries{" "}
        <code>src/app.ts</code>, <code>src/app.js</code>,{" "}
        <code>src/build-app.ts</code>, <code>src/build-app.js</code>,{" "}
        <code>app.ts</code>, <code>app.js</code>, <code>build-app.ts</code>, and{" "}
        <code>build-app.js</code>. TypeScript entry files load directly —
        Node.js (22.18+) strips types natively. If the native load fails (older
        Node, non-erasable syntax such as enums, or extensionless relative
        imports), the CLI falls back to <code>tsx</code> when it is installed
        (<code>pnpm add -D tsx</code>).
      </p>
      <p>
        Point <code>inspect</code>, <code>doctor</code>, and <code>diff</code>{" "}
        at import-safe app construction files, not files that call{" "}
        <code>serve(...)</code> as a module side effect. When redirecting JSON
        or YAML to a file, keep app-construction logs off stdout so the output
        stays parseable.
      </p>

      <h2 id="flags">Flags</h2>
      <ul>
        <li>
          <code>--json</code>: emit a machine-readable JSON document instead of
          a human table.
        </li>
        <li>
          <code>--check</code>: run the contract suite ({" "}
          <a href="/docs/testing">
            missing operationIds, duplicate operationIds, dead routes, body
            schemas on safe methods, invalid examples
          </a>
          ) and exit 1 on any error.
        </li>
        <li>
          <code>--schemas</code>: add a <code>B/Q/P/H</code> column showing
          which of body, query, params, and headers schemas the route declares.
        </li>
        <li>
          <code>--openapi</code>: print the OpenAPI 3.1 document.
        </li>
        <li>
          <code>--asyncapi</code>: print the AsyncAPI 3.0 document for{" "}
          <code>app.ws()</code> WebSocket surfaces.
        </li>
        <li>
          <code>--ai</code>: print an AI/codegen-friendly dump of the route
          catalog with JSON Schemas and any <code>meta.examples</code> you
          authored. See the{" "}
          <a href="/docs/ai-metadata">AI-friendly route metadata</a> guide.
        </li>
        <li>
          <code>--yaml</code> · <code>--format &lt;json|yaml&gt;</code>: emit{" "}
          <code>--openapi</code>, <code>--asyncapi</code>, or <code>--ai</code>{" "}
          output as YAML instead of JSON. YAML drops braces, commas, and most
          quotes, so the payload is typically ~30% smaller than the equivalent
          pretty-printed JSON, useful when pasting route metadata into an LLM
          system prompt where every token counts.
        </li>
        <li>
          <code>--tag &lt;tag&gt;</code>: only show routes that declare this
          tag.
        </li>
        <li>
          <code>--method &lt;method&gt;</code>: only show routes for this HTTP
          method.
        </li>
        <li>
          <code>--runtime &lt;node|bun|deno&gt;</code>: force the runtime for{" "}
          <code>daloy dev</code>.
        </li>
        <li>
          <code>--audit-secrets</code>: make <code>daloy doctor</code> scan
          matching environment variables for known-weak placeholders and short
          production secrets.
        </li>
        <li>
          <code>--no-audit-defaults</code>: skip the default secure-defaults
          audit in <code>daloy doctor</code>.
        </li>
        <li>
          <code>-h, --help</code> · <code>-v, --version</code>
        </li>
      </ul>

      <h2 id="daloy-dev-watch-mode-dev-server">
        <code>daloy dev</code>: watch-mode dev server
      </h2>
      <p>
        <code>daloy dev [entry]</code> starts your app in the host
        runtime&apos;s native watch mode, no extra config, no extra dependency
        to install on Bun or Deno:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm exec daloy dev                # auto-detects ./src/index.ts, ./src/main.ts, ...
pnpm exec daloy dev ./src/server.ts`}
      />
      <p>
        The exact command spawned depends on the runtime that hosts the CLI:
      </p>
      <ul>
        <li>
          <strong>Node</strong>: <code>node --watch &lt;entry&gt;</code>{" "}
          (Node.js 22.18+ runs TypeScript entries natively via built-in type
          stripping — no loader needed).
        </li>
        <li>
          <strong>Bun</strong>: <code>bun --hot &lt;entry&gt;</code>.
        </li>
        <li>
          <strong>Deno</strong>:{" "}
          <code>
            deno run --watch --allow-net --allow-env --allow-read &lt;entry&gt;
          </code>
          .
        </li>
      </ul>
      <p>
        Pass <code>--runtime &lt;node|bun|deno&gt;</code> to override runtime
        detection. This is required when running <code>daloy dev</code> from a{" "}
        <code>package.json</code> script on Bun or Deno, because the CLI
        binary&apos;s <code>#!/usr/bin/env node</code> shebang otherwise forces
        Node detection. The <code>bun-basic</code> template ships{" "}
        <code>&quot;dev&quot;: &quot;daloy dev --runtime bun&quot;</code> for
        this reason.
      </p>

      <h2 id="daloy-doctor-secure-defaults-audit">
        <code>daloy doctor</code>: secure-defaults audit
      </h2>
      <p>
        <code>daloy doctor [entry]</code> loads the same <code>App</code> as{" "}
        <code>inspect</code>, then audits the live configuration for
        secure-by-default regressions. It exits 1 when it finds an error-level
        issue, so it can guard CI or a container <code>HEALTHCHECK</code>:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm exec daloy doctor
pnpm exec daloy doctor ./src/app.ts --json
pnpm exec daloy doctor --audit-secrets`}
      />
      <p>
        Warning-level findings are advisory and exit 0. In JSON mode,{" "}
        <code>ok</code> is only true when there are no findings at all.
      </p>

      <h2 id="daloy-diff-openapi-change-gate">
        <code>daloy diff</code>: OpenAPI change gate
      </h2>
      <p>
        <code>daloy diff &lt;baseline&gt; &lt;current&gt;</code> compares two
        OpenAPI 3.1 JSON files, reports added, removed, and changed operations,
        and exits 1 when it detects a breaking change:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm exec daloy inspect --openapi > openapi.json
pnpm exec daloy diff openapi.published.json openapi.json
pnpm exec daloy diff --json openapi.published.json openapi.json`}
      />

      <h2 id="ci-usage">CI usage</h2>
      <p>
        <code>daloy inspect --check</code> is a drop-in replacement for the
        in-process <code>runContractTests</code> runner. Wire it into your
        pipeline to fail builds on dead routes, duplicate operationIds, and
        missing operationIds:
      </p>
      <CodeBlock
        language="yaml"
        code={`- name: Contract checks
  run: pnpm exec daloy inspect --check

- name: OpenAPI compatibility
  run: pnpm exec daloy diff openapi.published.json openapi.json`}
      />

      <h2 id="programmatic-api">Programmatic API</h2>
      <p>
        The CLI is also exported as a function so you can wire it into custom
        scripts or your own binary:
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
