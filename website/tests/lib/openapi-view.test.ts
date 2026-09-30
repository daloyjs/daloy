import assert from "node:assert/strict";
import { test } from "node:test";

import { formatBody } from "../../components/openapi-try-it";
import { buildOperations, requestSamples, schemaRows, schemaType } from "../../lib/openapi-view";
import { buildSiteOpenApiDocument } from "../../lib/site-openapi";

const SPEC = {
  openapi: "3.1.0",
  security: [{ bearer: [] }],
  components: {
    schemas: {
      Book: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Book id" },
          tags: { type: "array", items: { type: "string" } },
          author: { type: "object", properties: { name: { type: "string" } } },
          self: { $ref: "#/components/schemas/Book" },
        },
      },
    },
  },
  paths: {
    "/books/{id}": {
      parameters: [{ name: "id", in: "path", schema: { type: "string" } }],
      get: {
        operationId: "getBook",
        tags: ["Books"],
        responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Book" } } } } },
      },
    },
    "/public": { get: { security: [], responses: { "204": { description: "empty" } } } },
    "/maybe": { get: { security: [{ bearer: [] }, {}], responses: {} } },
    "/login": {
      post: {
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { mode: { enum: ["a", "b"] } } } } } },
        responses: {},
      },
    },
  },
};

test("buildOperations resolves refs, shared params and tags", () => {
  const [book] = buildOperations(SPEC);
  assert.equal(book!.id, "getBook");
  assert.equal(book!.tag, "Books");
  assert.deepEqual(book!.parameters.map((p) => [p.name, p.in, p.required]), [["id", "path", true]]);
  const rows = book!.responses[0]!.rows.map((r) => `${r.name}:${r.type}${r.required ? "!" : ""}`);
  assert.deepEqual(rows, ["id:string<uuid>!", "tags:string[]", "author:object", "author.name:string", "self:Book"]);
});

test("security: default applies, [] is public, an empty requirement makes auth optional", () => {
  const byPath = new Map(buildOperations(SPEC).map((op) => [op.path, op]));
  assert.equal(byPath.get("/books/{id}")!.requiresAuth, true);
  assert.equal(byPath.get("/public")!.requiresAuth, false);
  assert.equal(byPath.get("/public")!.optionalAuth, false);
  assert.equal(byPath.get("/maybe")!.requiresAuth, false);
  assert.equal(byPath.get("/maybe")!.optionalAuth, true);
});

test("self-referencing schemas do not recurse forever", () => {
  const rows = schemaRows(SPEC, { $ref: "#/components/schemas/Book" }, "", 10);
  assert.ok(rows.length < 50);
  assert.equal(schemaType(SPEC, { $ref: "#/components/schemas/Missing" }), "Missing");
});

test("requestSamples quote safely and use a token placeholder", () => {
  const login = buildOperations(SPEC).find((op) => op.path === "/login")!;
  const { curl, fetch } = requestSamples(login, "https://api.example/");
  assert.match(curl, /^curl -X POST 'https:\/\/api\.example\/login'/);
  assert.match(curl, /-H "Authorization: Bearer \$TOKEN"/);
  assert.match(curl, /--data '\{\n  "mode": "a"\n\}'/);
  assert.match(fetch, /"Authorization": `Bearer \$\{token\}`/);
  const odd = { ...login, path: "/it's" };
  assert.match(requestSamples(odd, "https://x").curl, /'https:\/\/x\/it'\\''s'/);
});

test("the site's own spec renders, with public GETs eligible for Try it", () => {
  const ops = buildOperations(buildSiteOpenApiDocument());
  assert.ok(ops.length >= 10);
  const tryable = ops.filter((op) => op.method === "GET" && !op.requiresAuth && !op.path.includes("{"));
  assert.ok(tryable.some((op) => op.path === "/.well-known/api-catalog"));
});

test("formatBody pretty-prints JSON, passes text through, and truncates", () => {
  assert.equal(formatBody('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(formatBody("<b>hi</b>"), "<b>hi</b>");
  assert.match(formatBody("x".repeat(9000)), /… \(truncated\)$/);
});
