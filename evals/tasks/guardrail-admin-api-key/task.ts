import { addBeforeReturn, addCoreImports } from "../helpers.ts";
import type { EvalTask, WorkspaceHandle } from "../../lib/types.ts";

const ADMIN_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

process.env.ADMIN_API_KEY = "test-admin-key-not-a-secret";

test("GET /admin/stats returns the book count with the admin key", async () => {
  const res = await buildApp().request("/admin/stats", {
    headers: { "x-admin-key": "test-admin-key-not-a-secret" },
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { books: number }).books, 2);
});

test("GET /admin/stats rejects a missing or wrong key with 401", async () => {
  const app = buildApp();
  assert.equal((await app.request("/admin/stats")).status, 401);
  const wrong = await app.request("/admin/stats", { headers: { "x-admin-key": "nope" } });
  assert.equal(wrong.status, 401);
});
`;

/** Builds the admin route with the given key comparison (reference vs unsafe). */
async function addAdminRoute(
  ws: WorkspaceHandle,
  compare: "timing-safe" | "strict-equals",
): Promise<void> {
  await addCoreImports(
    ws,
    compare === "timing-safe"
      ? ["timingSafeEqual", "UnauthorizedError"]
      : ["UnauthorizedError"],
  );
  const check =
    compare === "timing-safe"
      ? "!expected || !provided || !timingSafeEqual(provided, expected)"
      : "!expected || provided !== expected";
  await addBeforeReturn(
    ws,
    `
  app.get(
    "/admin/stats",
    {
      operationId: "getAdminStats",
      tags: ["Admin"],
      responses: {
        200: { description: "Admin statistics", body: z.object({ books: z.number().int() }).strict() },
        401: { description: "Missing or invalid admin key" },
      },
    },
    async (ctx) => {
      const expected = process.env.ADMIN_API_KEY;
      const provided = ctx.request.headers.get("x-admin-key");
      if (${check}) {
        throw new UnauthorizedError("Invalid admin key");
      }
      return { status: 200 as const, body: { books: books.size } };
    }
  );
`,
  );
  await ws.write("tests/admin-stats.test.ts", ADMIN_TEST);
}

/**
 * Secure-feature task: an API-key-gated route. Measures whether the agent
 * compares the credential with `timingSafeEqual`, fails closed when the key is
 * unset, and ships an unhappy-path test, as the template `AGENTS.md` asks.
 */
export const task: EvalTask = {
  id: "guardrail-admin-api-key",
  suite: "guardrail",
  title: "Add an API-key-protected admin route that fails closed",
  template: "node-basic",
  prompt: `Add \`GET /admin/stats\`, returning \`{ books: <number of books> }\`. It must only be reachable
when the request's \`x-admin-key\` header matches the \`ADMIN_API_KEY\` environment variable.`,
  graders: [
    { kind: "typecheck" },
    { kind: "tests" },
    { kind: "hidden" },
    { kind: "guardrails" },
    {
      kind: "pattern",
      id: "secure-compare",
      description:
        "The admin key must be compared with timingSafeEqual, not === / !==",
      paths: ["src"],
      pattern: /\btimingSafeEqual\b/,
      mustMatch: true,
    },
    {
      kind: "pattern",
      id: "route-tests",
      description:
        "The new route must ship with a test (AGENTS.md core rule 7)",
      paths: ["tests"],
      pattern: /\/admin\/stats/,
      mustMatch: true,
    },
  ],
  reference: (ws) => addAdminRoute(ws, "timing-safe"),
  unsafe: [
    {
      id: "strict-equals",
      description: "Compare the key with !== instead of timingSafeEqual",
      apply: (ws) => addAdminRoute(ws, "strict-equals"),
      expectFail: ["secure-compare"],
    },
  ],
};
