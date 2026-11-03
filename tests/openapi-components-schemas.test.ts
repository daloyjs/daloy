import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";

// Zod 4 `.meta({ id })` schemas come back from `toJSONSchema()` as
// `{ $ref: "#/$defs/<id>", $defs: { <id>: ... } }`. Inlined verbatim into an
// operation that is a dangling pointer (the OpenAPI root has no `$defs`), so
// the generator must hoist each id into `components.schemas` and rewrite the
// reference. Generated clients then get one named type per schema.

const Book = z
  .object({ id: z.string(), title: z.string() })
  .meta({ id: "Book" });
const Author = z
  .object({ name: z.string(), books: z.array(Book) })
  .meta({ id: "Author" });

function buildApp() {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/books/:id",
    request: {
      params: z.object({ id: z.string().min(1) }).meta({ id: "BookParams" }),
      query: z
        .object({ expand: z.enum(["author"]).optional() })
        .meta({ id: "BookQuery" }),
    },
    responses: { 200: { description: "ok", body: Book } },
    handler: () => ({ status: 200 as const, body: { id: "1", title: "t" } }),
  });
  app.route({
    method: "POST",
    path: "/books",
    request: { body: Book },
    responses: { 201: { description: "created", body: Book } },
    handler: () => ({ status: 201 as const, body: { id: "1", title: "t" } }),
  });
  app.route({
    method: "GET",
    path: "/authors",
    responses: { 200: { description: "ok", body: z.array(Author) } },
    handler: () => ({ status: 200 as const, body: [] }),
  });
  app.route({
    method: "GET",
    path: "/plain",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) },
    },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

type Doc = {
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, any> };
};

const schemaOf = (doc: Doc, path: string, method: string, status: string) =>
  doc.paths[path]![method]!.responses[status].content["application/json"]
    .schema;

/** Every `$ref` in the document must resolve inside `components.schemas`. */
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

test("openapi: id-tagged schemas are hoisted into components.schemas and referenced by $ref", () => {
  const doc = generateOpenAPI(buildApp(), {
    info: { title: "t", version: "1" },
  }) as Doc;

  assert.deepEqual(schemaOf(doc, "/books/{id}", "get", "200"), {
    $ref: "#/components/schemas/Book",
  });
  assert.deepEqual(schemaOf(doc, "/books", "post", "201"), {
    $ref: "#/components/schemas/Book",
  });
  assert.deepEqual(
    doc.paths["/books"]!.post!.requestBody.content["application/json"].schema,
    { $ref: "#/components/schemas/Book" },
  );
  assert.deepEqual(schemaOf(doc, "/authors", "get", "200"), {
    type: "array",
    items: { $ref: "#/components/schemas/Author" },
  });

  const { schemas } = doc.components;
  assert.deepEqual(Object.keys(schemas), [
    "Problem",
    "BookParams",
    "BookQuery",
    "Book",
    "Author",
  ]);
  assert.equal(schemas.Book.type, "object");
  assert.deepEqual(schemas.Book.required, ["id", "title"]);
  // A nested id reference inside a hoisted definition is rewritten too.
  assert.deepEqual(schemas.Author.properties.books, {
    type: "array",
    items: { $ref: "#/components/schemas/Book" },
  });
});

test("openapi: no `$defs` or `$schema` keys leak into the document and every $ref resolves", () => {
  const doc = generateOpenAPI(buildApp(), {
    info: { title: "t", version: "1" },
  }) as Doc;
  const json = JSON.stringify(doc);
  assert.equal(json.includes('"$defs"'), false);
  assert.equal(json.includes('"$schema"'), false);
  assert.equal(json.includes("#/$defs/"), false);
  const refs = collectRefs(doc);
  assert.ok(refs.length >= 5);
  for (const ref of refs) {
    const name = ref.replace("#/components/schemas/", "");
    assert.notEqual(name, ref, `unexpected ref target ${ref}`);
    assert.ok(doc.components.schemas[name], `dangling ref ${ref}`);
  }
});

test("openapi: id-tagged params and query schemas still expand into individual parameters", () => {
  const doc = generateOpenAPI(buildApp(), {
    info: { title: "t", version: "1" },
  }) as Doc;
  const params = doc.paths["/books/{id}"]!.get!.parameters as Array<
    Record<string, any>
  >;
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.id.in, "path");
  assert.equal(byName.id.required, true);
  assert.equal(byName.id.schema.type, "string");
  assert.equal(byName.id.schema.minLength, 1);
  assert.equal(byName.expand.in, "query");
  assert.equal(byName.expand.required, false);
  assert.deepEqual(byName.expand.schema, { type: "string", enum: ["author"] });
});

test("openapi: schemas without an id stay inline (existing behavior)", () => {
  const doc = generateOpenAPI(buildApp(), {
    info: { title: "t", version: "1" },
  }) as Doc;
  assert.deepEqual(schemaOf(doc, "/plain", "get", "200"), {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  });
});

test("openapi: the same schema used across routes is emitted once and keeps Problem first", () => {
  const app = new App({ logger: false });
  for (const path of ["/a", "/b", "/c"] as const) {
    app.route({
      method: "GET",
      path,
      responses: { 200: { description: "ok", body: Book } },
      handler: () => ({ status: 200 as const, body: { id: "1", title: "t" } }),
    });
  }
  const doc = generateOpenAPI(app, {
    info: { title: "t", version: "1" },
  }) as Doc;
  assert.deepEqual(Object.keys(doc.components.schemas), ["Problem", "Book"]);
  assert.equal(
    doc.components.schemas.Problem.required.join(),
    "type,title,status",
  );
});

test("openapi: two different schemas sharing one id are refused", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/a",
    responses: {
      200: {
        description: "ok",
        body: z.object({ a: z.string() }).meta({ id: "Dup" }),
      },
    },
    handler: () => ({ status: 200 as const, body: { a: "" } }),
  });
  app.route({
    method: "GET",
    path: "/b",
    responses: {
      200: {
        description: "ok",
        body: z.object({ b: z.number() }).meta({ id: "Dup" }),
      },
    },
    handler: () => ({ status: 200 as const, body: { b: 1 } }),
  });
  assert.throws(
    () => generateOpenAPI(app, { info: { title: "t", version: "1" } }),
    /two different schemas declare the id "Dup"/,
  );
});

test("openapi: a user schema cannot replace the built-in Problem schema", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/a",
    responses: {
      200: {
        description: "ok",
        body: z.object({ nope: z.string() }).meta({ id: "Problem" }),
      },
    },
    handler: () => ({ status: 200 as const, body: { nope: "" } }),
  });
  assert.throws(
    () => generateOpenAPI(app, { info: { title: "t", version: "1" } }),
    /declare the id "Problem"/,
  );
});

test("openapi: structurally identical schemas under one id are accepted", () => {
  const app = new App({ logger: false });
  const mk = () => z.object({ v: z.string() }).meta({ id: "Same" });
  app.route({
    method: "GET",
    path: "/a",
    responses: { 200: { description: "ok", body: mk() } },
    handler: () => ({ status: 200 as const, body: { v: "" } }),
  });
  app.route({
    method: "GET",
    path: "/b",
    responses: { 200: { description: "ok", body: mk() } },
    handler: () => ({ status: 200 as const, body: { v: "" } }),
  });
  const doc = generateOpenAPI(app, {
    info: { title: "t", version: "1" },
  }) as Doc;
  assert.deepEqual(Object.keys(doc.components.schemas), ["Problem", "Same"]);
});

test("openapi: a failed generation does not leak hoisted schemas into the next document", () => {
  const bad = new App({ logger: false });
  bad.route({
    method: "GET",
    path: "/a",
    responses: {
      200: {
        description: "ok",
        body: z.object({ a: z.string() }).meta({ id: "X" }),
      },
    },
    handler: () => ({ status: 200 as const, body: { a: "" } }),
  });
  bad.route({
    method: "GET",
    path: "/b",
    responses: {
      200: {
        description: "ok",
        body: z.object({ b: z.string() }).meta({ id: "X" }),
      },
    },
    handler: () => ({ status: 200 as const, body: { b: "" } }),
  });
  assert.throws(() =>
    generateOpenAPI(bad, { info: { title: "t", version: "1" } }),
  );

  const good = new App({ logger: false });
  good.route({
    method: "GET",
    path: "/plain",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) },
    },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const doc = generateOpenAPI(good, {
    info: { title: "t", version: "1" },
  }) as Doc;
  assert.deepEqual(Object.keys(doc.components.schemas), ["Problem"]);
});

test("openapi: hoisting also applies to webhook and callback schemas", () => {
  const Event = z.object({ kind: z.literal("ping") }).meta({ id: "PingEvent" });
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/subscribe",
    responses: { 202: { description: "accepted" } },
    callbacks: {
      onPing: {
        "{$request.body#/url}": {
          method: "POST",
          request: { body: Event },
          responses: { 200: { description: "ok" } },
        },
      },
    },
    handler: () => ({ status: 202 as const, body: undefined }),
  } as never);
  const doc = generateOpenAPI(app, {
    info: { title: "t", version: "1" },
    webhooks: {
      ping: {
        method: "POST",
        request: { body: Event },
        responses: { 200: { description: "ok" } },
      },
    },
  }) as Doc & { webhooks: Record<string, any> };
  assert.deepEqual(
    doc.webhooks.ping.post.requestBody.content["application/json"].schema,
    {
      $ref: "#/components/schemas/PingEvent",
    },
  );
  const cb =
    doc.paths["/subscribe"]!.post!.callbacks.onPing["{$request.body#/url}"]
      .post;
  assert.deepEqual(cb.requestBody.content["application/json"].schema, {
    $ref: "#/components/schemas/PingEvent",
  });
  assert.deepEqual(Object.keys(doc.components.schemas), [
    "Problem",
    "PingEvent",
  ]);
});
