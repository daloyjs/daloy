import { addBeforeReturn } from "../helpers.ts";
import type { EvalTask, WorkspaceHandle } from "../../lib/types.ts";

/** The legacy Express app the agent ports. Never executed: `express` is not installed. */
const LEGACY_SERVER = `// Legacy Express notes API, being migrated to DaloyJS.
// Not runnable in this project (express is intentionally not installed).
import express from "express";

const app = express();
app.use(express.json());

const notes = new Map([["1", { id: "1", title: "Welcome", done: false }]]);
let nextId = 2;

app.get("/notes", (req, res) => {
  res.json({ items: [...notes.values()] });
});

app.get("/notes/:id", (req, res) => {
  const note = notes.get(req.params.id);
  if (!note) return res.status(404).json({ error: "Note not found" });
  res.json(note);
});

app.post("/notes", (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.length === 0 || title.length > 200) {
    return res.status(400).json({ error: "title must be 1-200 characters" });
  }
  const note = { id: String(nextId++), title, done: false };
  notes.set(note.id, note);
  res.status(201).json(note);
});

app.patch("/notes/:id", (req, res) => {
  const note = notes.get(req.params.id);
  if (!note) return res.status(404).json({ error: "Note not found" });
  if (typeof req.body?.done !== "boolean") {
    return res.status(400).json({ error: "done must be a boolean" });
  }
  note.done = req.body.done;
  res.json(note);
});

app.delete("/notes/:id", (req, res) => {
  if (!notes.delete(req.params.id)) return res.status(404).json({ error: "Note not found" });
  res.status(204).end();
});

app.listen(3000);
`;

const NOTES_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

test("notes can be created, read, completed, and deleted", async () => {
  const app = buildApp();
  const created = await app.request("/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Write tests" }),
  });
  assert.equal(created.status, 201);
  const note = (await created.json()) as { id: string };
  const patched = await app.request(\`/notes/\${note.id}\`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: true }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await app.request(\`/notes/\${note.id}\`, { method: "DELETE" })).status, 204);
});

test("unknown notes 404 and invalid input 422s", async () => {
  const app = buildApp();
  assert.equal((await app.request("/notes/999")).status, 404);
  const bad = await app.request("/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(bad.status, 422);
});
`;

async function port(
  ws: WorkspaceHandle,
  opts: { deleteLegacy: boolean; createdStatus: 200 | 201 },
): Promise<void> {
  await addBeforeReturn(
    ws,
    `
  const Note = z.object({ id: z.string(), title: z.string(), done: z.boolean() }).strict();
  const notes = new Map<string, z.infer<typeof Note>>([["1", { id: "1", title: "Welcome", done: false }]]);
  let nextNoteId = 2;
  const NoteParams = z.object({ id: z.string().min(1) }).strict();

  app.get(
    "/notes",
    {
      operationId: "listNotes",
      tags: ["Notes"],
      responses: { 200: { description: "All notes", body: z.object({ items: z.array(Note) }).strict() } },
    },
    async () => ({ status: 200 as const, body: { items: [...notes.values()] } })
  );

  app.get(
    "/notes/:id",
    {
      operationId: "getNote",
      tags: ["Notes"],
      request: { params: NoteParams },
      responses: { 200: { description: "Found", body: Note }, 404: { description: "Not found" } },
    },
    async ({ params }) => {
      const note = notes.get(params.id);
      if (!note) throw new NotFoundError("Note not found");
      return { status: 200 as const, body: note };
    }
  );

  app.post(
    "/notes",
    {
      operationId: "createNote",
      tags: ["Notes"],
      request: { body: z.object({ title: z.string().min(1).max(200) }).strict() },
      responses: { ${opts.createdStatus}: { description: "Created", body: Note } },
    },
    async ({ body }) => {
      const note = { id: String(nextNoteId++), title: body.title, done: false };
      notes.set(note.id, note);
      return { status: ${opts.createdStatus} as const, body: note };
    }
  );

  app.patch(
    "/notes/:id",
    {
      operationId: "updateNote",
      tags: ["Notes"],
      request: { params: NoteParams, body: z.object({ done: z.boolean() }).strict() },
      responses: { 200: { description: "Updated", body: Note }, 404: { description: "Not found" } },
    },
    async ({ params, body }) => {
      const note = notes.get(params.id);
      if (!note) throw new NotFoundError("Note not found");
      note.done = body.done;
      return { status: 200 as const, body: note };
    }
  );

  app.delete(
    "/notes/:id",
    {
      operationId: "deleteNote",
      tags: ["Notes"],
      request: { params: NoteParams },
      responses: { 204: { description: "Deleted" }, 404: { description: "Not found" } },
    },
    async ({ params }) => {
      if (!notes.delete(params.id)) throw new NotFoundError("Note not found");
      return { status: 204 as const, body: undefined };
    }
  );
`,
  );
  await ws.write("tests/notes.test.ts", NOTES_TEST);
  if (opts.deleteLegacy) await ws.remove("legacy");
}

/**
 * Migration task: port a small Express API. Exercises the
 * `migrating-from-express` reference bundled with the template skill (and
 * mirrored in `skills/express-to-daloyjs`). Graded by HTTP parity tests.
 */
export const task: EvalTask = {
  id: "migration-express-notes",
  suite: "migration",
  title: "Port a small Express API to DaloyJS with behaviour parity",
  template: "node-basic",
  prompt: `We are moving off Express. Port the notes API in \`legacy/server.js\` into this DaloyJS app
(\`src/build-app.ts\`), keeping the existing routes. Keep the same paths, status codes, and success
response bodies; error responses should use DaloyJS's standard problem+json errors. Delete the
\`legacy/\` directory when you are done.`,
  async setup(ws) {
    await ws.write("legacy/server.js", LEGACY_SERVER);
  },
  graders: [
    { kind: "typecheck" },
    { kind: "tests" },
    { kind: "hidden" },
    { kind: "guardrails" },
    {
      kind: "pattern",
      id: "no-express",
      description: "src/ must not import express",
      paths: ["src"],
      pattern: /from\s+["']express["']|require\(\s*["']express["']\s*\)/,
      mustMatch: false,
    },
    {
      kind: "pattern",
      id: "route-tests",
      description: "The ported routes must ship with tests",
      paths: ["tests"],
      pattern: /\/notes/,
      mustMatch: true,
    },
    { kind: "absent", id: "legacy-removed", paths: ["legacy"] },
  ],
  reference: (ws) => port(ws, { deleteLegacy: true, createdStatus: 201 }),
  unsafe: [
    {
      id: "keep-legacy",
      description: "Port the routes but leave legacy/ behind",
      apply: (ws) => port(ws, { deleteLegacy: false, createdStatus: 201 }),
      expectFail: ["legacy-removed"],
    },
    {
      id: "wrong-status",
      description: "POST /notes answers 200 instead of 201",
      apply: (ws) => port(ws, { deleteLegacy: true, createdStatus: 200 }),
      expectFail: ["hidden"],
    },
  ],
};
