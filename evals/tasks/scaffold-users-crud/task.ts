import { addBeforeReturn } from "../helpers.ts";
import type { EvalTask, WorkspaceHandle } from "../../lib/types.ts";

const USERS_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

function createUser(app: ReturnType<typeof buildApp>, body: unknown): Promise<Response> {
  return app.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /users creates a user that GET /users/:id returns", async () => {
  const app = buildApp();
  const res = await createUser(app, { name: "Jose Rizal", email: "jose@example.com" });
  assert.equal(res.status, 201);
  const user = (await res.json()) as { id: string };
  const got = await app.request(\`/users/\${user.id}\`);
  assert.equal(got.status, 200);
});

test("POST /users rejects an invalid email and GET /users/:id 404s", async () => {
  const app = buildApp();
  assert.equal((await createUser(app, { name: "x", email: "not-an-email" })).status, 422);
  assert.equal((await app.request("/users/missing")).status, 404);
});
`;

async function addUsers(
  ws: WorkspaceHandle,
  opts: { strict: boolean; tests: boolean },
): Promise<void> {
  const strict = opts.strict ? ".strict()" : "";
  await addBeforeReturn(
    ws,
    `
  const User = z.object({ id: z.string(), name: z.string(), email: z.string() }).strict();
  const users = new Map<string, z.infer<typeof User>>();

  app.post(
    "/users",
    {
      operationId: "createUser",
      tags: ["Users"],
      request: {
        body: z.object({ name: z.string().min(1).max(100), email: z.email() })${strict},
      },
      responses: { 201: { description: "Created", body: User } },
    },
    async ({ body }) => {
      const user = { id: crypto.randomUUID(), name: body.name, email: body.email };
      users.set(user.id, user);
      return { status: 201 as const, body: user };
    }
  );

  app.get(
    "/users/:id",
    {
      operationId: "getUserById",
      tags: ["Users"],
      request: { params: z.object({ id: z.string().min(1) }).strict() },
      responses: {
        200: { description: "Found", body: User },
        404: { description: "Not found" },
      },
    },
    async ({ params }) => {
      const user = users.get(params.id);
      if (!user) throw new NotFoundError(\`User \${params.id} not found\`);
      return { status: 200 as const, body: user };
    }
  );
`,
  );
  if (opts.tests) await ws.write("tests/users.test.ts", USERS_TEST);
}

/** Feature task: a small contract-first CRUD resource. */
export const task: EvalTask = {
  id: "scaffold-users-crud",
  suite: "scaffold",
  title: "Add a validated users resource with tests and OpenAPI",
  template: "node-basic",
  prompt: `Add a users resource: \`POST /users\` creates a user from \`{ name, email }\` (name 1 to 100
characters, a valid email) and returns 201 with \`{ id, name, email }\`. \`GET /users/:id\` returns that
user, or 404 when it does not exist.`,
  graders: [
    { kind: "typecheck" },
    { kind: "tests" },
    { kind: "hidden" },
    { kind: "guardrails" },
    {
      kind: "pattern",
      id: "route-tests",
      description:
        "The new routes must ship with tests (AGENTS.md core rule 7)",
      paths: ["tests"],
      pattern: /\/users/,
      mustMatch: true,
    },
  ],
  reference: (ws) => addUsers(ws, { strict: true, tests: true }),
  unsafe: [
    {
      id: "loose-body",
      description: "Request body schema without .strict()",
      apply: (ws) => addUsers(ws, { strict: false, tests: true }),
      expectFail: ["hidden"],
    },
    {
      id: "no-tests",
      description: "Routes added without any test",
      apply: (ws) => addUsers(ws, { strict: true, tests: false }),
      expectFail: ["route-tests"],
    },
  ],
};
