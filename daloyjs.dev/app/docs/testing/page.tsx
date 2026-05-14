import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "Testing & contract tests" };

export default function Page() {
  return (
    <>
      <h1>Testing & contract tests</h1>

      <h2>In-process test client</h2>
      <p>Every <code>App</code> exposes a <code>request()</code> method that round-trips a fetch <code>Request</code> through the same pipeline real traffic uses — no socket, no port:</p>
      <CodeBlock code={`import test from "node:test";
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
});`} />

      <h2>Mock mode</h2>
      <p>
        For pure-contract testing (no DB, no side effects), enable <code>mockMode</code>. DaloyJS will return the first
        declared <code>examples</code> entry from your response schema without ever invoking your handler:
      </p>
      <CodeBlock code={`const app = new App({ mockMode: true });

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  responses: {
    200: {
      description: "ok",
      body: z.object({ id: z.string(), name: z.string() }),
      examples: { default: { id: "u_1", name: "Alice" } },
    },
  },
  handler: async () => { throw new Error("not called in mock mode"); },
});`} />

      <h2>Contract test runner</h2>
      <p>
        <code>runContractTests</code> walks your registered routes and verifies that every declared example
        validates against its schema, every operationId is unique, and there are no obvious anti-patterns:
      </p>
      <CodeBlock code={`import { runContractTests } from "@daloyjs/core/contract";

const report = await runContractTests(app, {
  requireOperationId: true,
  allowBodyOnSafeMethods: false,
});

if (!report.ok) {
  console.error(report.issues);
  process.exit(1);
}
console.log(\`\${report.checked} routes — all clean\`);`} />

      <p>The report flags:</p>
      <ul>
        <li>Routes missing <code>operationId</code>.</li>
        <li>Duplicate operationIds.</li>
        <li>Examples that don&apos;t match their schemas.</li>
        <li>Body schemas declared on safe methods (<code>GET</code>, <code>HEAD</code>, <code>DELETE</code>).</li>
        <li>Routes with no declared <code>responses</code>.</li>
      </ul>

      <h2>Wire into CI</h2>
      <CodeBlock language="json" code={`{
  "scripts": {
    "test":      "node --import tsx --test tests/**/*.test.ts",
    "test:contract": "node --import tsx scripts/contract.ts"
  }
}`} />
    </>
  );
}
