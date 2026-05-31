import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import { createClient } from "../src/client.js";
import { generateOpenAPI } from "../src/openapi.js";

test("typed client replaces params, appends array query values, merges headers, and parses JSON", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/orgs/:org/books/:id",
    operationId: "updateBook",
    request: {
      params: z.object({ org: z.string(), id: z.string() }) as any,
      query: z.object({ tag: z.array(z.string()).optional() }) as any,
      body: z.object({ title: z.string() }) as any,
    },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const client = createClient(app, {
    baseUrl: "https://api.example.com/base/",
    headers: { authorization: "Bearer token" },
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "x-result": "yes" },
      });
    },
  });

  const result = await client.updateBook({
    params: { org: "acme inc", id: "book/1" },
    query: { tag: ["sci-fi", "classic"] },
    headers: { "x-client": "tests" },
    body: { title: "Dune" },
  } as any);

  const url = new URL(seenUrl);
  assert.equal(url.origin, "https://api.example.com");
  assert.equal(url.pathname, "/orgs/acme%20inc/books/book%2F1");
  assert.deepEqual(url.searchParams.getAll("tag"), ["sci-fi", "classic"]);
  assert.equal(seenInit?.method, "POST");
  assert.deepEqual(seenInit?.headers, {
    authorization: "Bearer token",
    "x-client": "tests",
    "content-type": "application/json",
  });
  assert.equal(seenInit?.body, JSON.stringify({ title: "Dune" }));
  assert.deepEqual(result, { status: 200, body: { ok: true }, headers: { "content-type": "application/json", "x-result": "yes" } });
});

test("typed client sets scalar query values and skips undefined ones", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/search",
    operationId: "searchBooks",
    request: {
      query: z.object({ q: z.string(), page: z.number().optional(), cursor: z.string().optional() }) as any,
    },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  let seenUrl = "";
  const client = createClient(app, {
    baseUrl: "https://api.example.com",
    fetch: async (url) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.searchBooks({
    // `q` and `page` are scalars (hits the non-array `searchParams.set` path);
    // `cursor: undefined` must be skipped entirely.
    query: { q: "dune", page: 2, cursor: undefined },
  } as any);

  const url = new URL(seenUrl);
  assert.equal(url.searchParams.get("q"), "dune");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.has("cursor"), false);
});

test("typed client preserves non-JSON response bodies as text", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/plain",
    operationId: "plain",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const client = createClient(app, {
    baseUrl: "https://api.example.com",
    fetch: async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
  });

  const result = await client.plain({ params: {} } as any);
  assert.equal(result.status, 200);
  assert.equal(result.body, "hello");
  assert.match(result.headers["content-type"] ?? "", /^text\/plain/);
});

test("typed client preserves malformed JSON response bodies as text", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/broken-json",
    operationId: "brokenJson",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const client = createClient(app, {
    baseUrl: "https://api.example.com",
    fetch: async () => new Response("{not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  const result = await client.brokenJson({ params: {} } as any);
  assert.equal(result.status, 200);
  assert.equal(result.body, "{not-json");
});

test("typed client rejects when fetch fails", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/plain",
    operationId: "plain",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const client = createClient(app, {
    baseUrl: "https://api.example.com",
    fetch: async () => {
      throw new Error("network down");
    },
  });

  await assert.rejects(client.plain({ params: {} } as any), /network down/);
});

test("typed client omits routes missing operationId", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/anonymous",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const client = createClient(app, { baseUrl: "https://api.example.com" });
  assert.deepEqual(Object.keys(client), []);
});

test("OpenAPI includes metadata, parameters, request body, responses, and security", () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/books/:id",
    operationId: "createBookReview",
    tags: ["Books"],
    summary: "Create review",
    description: "Stores a book review",
    deprecated: true,
    auth: { scheme: "bearer", scopes: ["reviews:write"] },
    request: {
      params: z.object({ id: z.string() }) as any,
      query: z.object({ preview: z.boolean().optional() }) as any,
      body: z.object({ rating: z.number() }) as any,
    },
    responses: {
      201: {
        description: "Created",
        body: z.object({ id: z.string(), rating: z.number() }) as any,
        examples: { sample: { id: "r1", rating: 5 } },
      },
      401: { description: "Unauthorized" },
    },
    handler: async () => ({ status: 201 as const, body: { id: "r1", rating: 5 } }),
  });

  const doc: any = generateOpenAPI(app, {
    info: { title: "Books", version: "1.0.0", description: "Book API" },
    servers: [{ url: "https://api.example.com" }],
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  });

  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.info, { title: "Books", version: "1.0.0", description: "Book API" });
  assert.deepEqual(doc.servers, [{ url: "https://api.example.com" }]);
  assert.deepEqual(doc.components.securitySchemes.bearer, { type: "http", scheme: "bearer" });

  const op = doc.paths["/books/{id}"].post;
  assert.equal(op.operationId, "createBookReview");
  assert.deepEqual(op.tags, ["Books"]);
  assert.equal(op.summary, "Create review");
  assert.equal(op.description, "Stores a book review");
  assert.equal(op.deprecated, true);
  assert.deepEqual(op.security, [{ bearer: ["reviews:write"] }]);
  assert.ok(op.parameters.some((p: any) => p.name === "id" && p.in === "path" && p.required));
  assert.ok(op.parameters.some((p: any) => p.name === "preview" && p.in === "query"));
  assert.ok(op.requestBody.content["application/json"].schema);
  assert.equal(op.responses[201].description, "Created");
  assert.deepEqual(op.responses[201].content["application/json"].examples, { sample: { id: "r1", rating: 5 } });
  assert.equal(op.responses[401].description, "Unauthorized");
  assert.ok(doc.components.schemas.Problem);
});
