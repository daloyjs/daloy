import { addBeforeReturn, BUILD_APP, replaceOnce } from "../helpers.ts";
import type { EvalTask, WorkspaceHandle } from "../../lib/types.ts";

const LIST_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

test("GET /books lists books and honours limit", async () => {
  const app = buildApp();
  const all = await app.request("/books");
  assert.equal(all.status, 200);
  const one = await app.request("/books?limit=1");
  assert.equal(((await one.json()) as { items: unknown[] }).items.length, 1);
});

test("GET /books rejects an out-of-range limit", async () => {
  assert.equal((await buildApp().request("/books?limit=0")).status, 422);
});
`;

async function addList(
  ws: WorkspaceHandle,
  shape: "bounded" | "optional" | "unbounded",
): Promise<void> {
  const limit = {
    bounded: "z.coerce.number().int().min(1).max(50).default(10)",
    optional: "z.coerce.number().int().positive().max(50).optional()",
    unbounded: "z.coerce.number().default(10)",
  }[shape];
  const take = shape === "optional" ? "query.limit ?? 10" : "query.limit";
  await addBeforeReturn(
    ws,
    `
  app.get(
    "/books",
    {
      operationId: "listBooks",
      tags: ["Books"],
      request: { query: z.object({ limit: ${limit} }).strict() },
      responses: { 200: { description: "Books", body: z.object({ items: z.array(Book) }).strict() } },
    },
    async ({ query }) => ({
      status: 200 as const,
      body: { items: [...books.values()].slice(0, ${take}) },
    })
  );
`,
  );
  await ws.write("tests/list-books.test.ts", LIST_TEST);
}

/** Feature task: a list route with a validated, bounded query parameter. */
export const task: EvalTask = {
  id: "scaffold-books-list",
  graderRevision: 2,
  suite: "scaffold",
  title: "Add a paginated list route with a validated query parameter",
  template: "node-basic",
  prompt: `Add \`GET /books\` that lists books. It takes an optional \`limit\` query parameter (an integer
from 1 to 50, default 10) and returns \`{ items: Book[] }\` with at most \`limit\` books.`,
  // Grader revision 2: enough data to distinguish the default cap from listing everything.
  setup: async (ws) => {
    await replaceOnce(ws, BUILD_APP, "function buildApp(): App", "function buildApp(seedBookCount = 2): App");
    const anchor = "  // daloy-minimal:strip-end books";
    await replaceOnce(ws, BUILD_APP, anchor, `  for (let i = 3; i <= seedBookCount; i++) {
    const id = String(i);
    books.set(id, { id, title: "Book " + id });
  }
${anchor}`);
  },
  graders: [
    { kind: "typecheck" },
    { kind: "tests" },
    { kind: "hidden" },
    { kind: "guardrails" },
    {
      kind: "pattern",
      id: "route-tests",
      description:
        "The new route must ship with a test that exercises limit (AGENTS.md core rule 7)",
      paths: ["tests"],
      pattern: /limit=/,
      mustMatch: true,
    },
  ],
  reference: (ws) => addList(ws, "bounded"),
  alternatives: [
    {
      id: "optional-limit",
      description: "Optional limit with the default applied in the handler",
      apply: (ws) => addList(ws, "optional"),
    },
  ],
  unsafe: [
    {
      id: "wrong-default",
      description: "All explicit limits work, but an omitted limit returns every book",
      apply: async (ws) => {
        await addList(ws, "optional");
        await replaceOnce(ws, BUILD_APP, "query.limit ?? 10", "query.limit ?? books.size");
      },
      expectFail: ["hidden"],
    },
    {
      id: "unbounded-limit",
      description: "limit accepted without integer / range validation",
      apply: (ws) => addList(ws, "unbounded"),
      expectFail: ["hidden"],
    },
  ],
};
