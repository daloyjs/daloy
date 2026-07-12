import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Testing & contract tests",
  description:
    "Write fast, in-process tests for DaloyJS handlers and generate contract tests from your OpenAPI spec to guarantee server and client stay in sync.",
  path: "/docs/testing",
  keywords: [
    "DaloyJS testing",
    "contract testing",
    "OpenAPI contract tests",
    "TypeScript API testing",
    "pre-push git hook",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Testing & contract tests</h1>

      <FlowDiagram
        title="Three layers, one app"
        numbered
        caption="In-process tests exercise real handlers through app.request(), mock mode returns declared examples for pure contract assertions, and the contract runner validates the whole spec, the same check daloy inspect runs in CI and the pre-push hook."
        steps={[
          {
            label: "In-process tests",
            detail: "app.request() through the real pipeline",
            tone: "accent",
          },
          {
            label: "Mock mode",
            detail: "new App({ mockMode: true }), returns examples",
          },
          {
            label: "Contract runner",
            detail: "runContractTests(app) validates every route",
          },
          {
            label: "CI / pre-push gate",
            eyebrow: "backstop",
            detail: "daloy inspect --check, exits non-zero",
            tone: "success",
          },
        ]}
      />

      <h2 id="in-process-test-client">In-process test client</h2>
      <p>
        Every <code>App</code> exposes a <code>request()</code> method that
        round-trips a fetch <code>Request</code> through the same pipeline real
        traffic uses, no socket, no port:
      </p>
      <CodeBlock
        code={`import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/server.js";

test("GET /books/1 returns 200", async () => {
  const res = await app.request("/books/1");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "Foundation");
});

test("POST /books rejects unauthorized", async () => {
  const res = await app.request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Dune" }),
  });
  assert.equal(res.status, 401);
});`}
      />

      <h2 id="typed-in-process-client">Typed in-process client</h2>
      <p>
        When the test should use operation ids and contract-derived inputs,
        build a <code>createInProcessClient(app)</code>. It opens no socket but
        still traverses routing, authentication, validation, hooks, and response
        serialization.
      </p>
      <CodeBlock
        code={`import { createInProcessClient } from "@daloyjs/core/client";
import { app } from "../src/app.js";

const client = createInProcessClient(app);

test("getBook is typed end to end", async () => {
  const response = await client.getBook({ params: { id: "book_1" } });
  assert.equal(response.status, 200);
  if (response.status === 200) {
    assert.equal(response.body.id, "book_1"); // body is narrowed and typed
  }
});`}
      />

      <h2 id="mock-mode">Mock mode</h2>
      <p>
        For pure-contract testing (no DB, no side effects), enable{" "}
        <code>mockMode</code>. DaloyJS returns the first declared response{" "}
        <code>examples</code> entry for the first 2xx status without ever
        invoking your handler. If no example is declared, the mocked body is{" "}
        <code>null</code>.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const app = new App({ mockMode: true });

app.get(
  "/users/:id",
  {
    operationId: "getUser",
    responses: {
      200: {
        description: "ok",
        body: z.object({ id: z.string(), name: z.string() }),
        examples: { default: { id: "u_1", name: "Alice" } },
      },
    },
  },
  async () => {
    throw new Error("not called in mock mode");
  },
);`}
      />

      <h2 id="contract-test-runner">Contract test runner</h2>
      <p>
        <code>runContractTests</code> walks your registered routes and verifies
        that every declared response and <code>meta.examples</code> payload
        validates against its schema, every required <code>operationId</code> is
        present and unique, and there are no obvious anti-patterns:
      </p>
      <CodeBlock
        code={`import { runContractTests } from "@daloyjs/core/contract";

const report = await runContractTests(app, {
  requireOperationId: true,
  allowBodyOnSafeMethods: false,
});

if (!report.ok) {
  console.error(report.issues);
  process.exit(1);
}
console.log(\`\${report.checked} routes - all clean\`);`}
      />

      <BranchDiagram
        title="What the runner checks"
        source={{
          eyebrow: "one pass",
          label: "runContractTests(app)",
          detail: "walks every registered route",
        }}
        branches={[
          {
            label: "operationId present",
            detail: "requireOperationId",
          },
          {
            label: "operationIds unique",
            detail: "no duplicates across routes",
          },
          {
            label: "examples match schema",
            detail: "response examples + meta.examples",
          },
          {
            label: "no body on safe methods",
            detail: "GET / HEAD / DELETE warning",
          },
          {
            label: "responses declared",
            detail: "every route has responses",
          },
        ]}
        converge={{
          label: "report.ok",
          detail: "false only for error-level issues",
        }}
        caption="A single walk over your routes produces one report. Error-level issues make report.ok false; warnings, such as safe-method body schemas, stay in report.issues without failing the gate."
      />

      <p>The report flags:</p>
      <ul>
        <li>
          Routes missing <code>operationId</code>.
        </li>
        <li>Duplicate operationIds.</li>
        <li>
          Response examples and <code>meta.examples</code> payloads that
          don&apos;t match their schemas.
        </li>
        <li>
          Body schemas declared on safe methods (<code>GET</code>,{" "}
          <code>HEAD</code>, <code>DELETE</code>) as warnings.
        </li>
        <li>
          Routes with no declared <code>responses</code>.
        </li>
      </ul>

      <h2 id="wire-into-ci">Wire into CI</h2>
      <CodeBlock
        language="json"
        code={`{
  "scripts": {
    "test": "node --test tests/**/*.test.ts",
    "contract": "daloy inspect --check src/build-app.ts"
  }
}`}
      />
      <p>
        Or skip the script and let the CLI do it directly.{" "}
        <code>daloy inspect --check &lt;entry&gt;</code> loads your app, runs
        the same checks, and exits non-zero on any error-level issue, so it
        drops straight into a CI step. The entry must export your{" "}
        <code>App</code> as the default export or a named <code>app</code>{" "}
        export.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm exec daloy inspect --check src/build-app.ts`}
      />
      <p>
        Every <code>create-daloy</code> template already ships this gate: a{" "}
        <code>tests/contract.test.ts</code> (<code>tests/contract_test.ts</code>{" "}
        on Deno) that asserts <code>report.ok</code> for the real app and proves
        the gate rejects a broken contract. It runs as part of the
        project&apos;s <code>test</code> task, so a missing operationId or a
        mismatched example fails CI from the first commit.
      </p>

      <h2 id="gate-it-locally-with-a-pre-push-hook">
        Gate it locally with a pre-push hook
      </h2>
      <p>
        A contract check is an authoring-time concern, so it belongs on your
        machine, never on the production request path. A <code>pre-push</code>{" "}
        git hook is the cleanest home for it: it is localhost-only by
        construction (it cannot run in production), adds no server boot cost,
        and fires right before code leaves your machine, with CI as the
        backstop.
      </p>
      <p>
        Every <code>create-daloy</code> template ships this hook under{" "}
        <code>.githooks/pre-push</code>, wired to a <code>hooks:install</code>{" "}
        script. Enabling it is one command per clone: it points{" "}
        <code>core.hooksPath</code> at the committed hook, so the whole team
        shares the same gate. The hook skips gracefully when tooling is missing
        (it never blocks a push over an uninstalled dependency), and you can
        always bypass it once with <code>git push --no-verify</code>.
      </p>
      <CodeBlock
        language="bash"
        code={`# Enable the contract gate for this clone (points core.hooksPath at .githooks)
pnpm hooks:install

# From then on, every \`git push\` runs the contract check first:
#   .githooks/pre-push  ->  daloy inspect --check src/build-app.ts
# Need to push past it once:
git push --no-verify`}
      />
    </>
  );
}
