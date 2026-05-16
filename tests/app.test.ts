import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, NotFoundError } from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";

function buildApp() {
  const app = new App();
  app.route({
    method: "GET",
    path: "/hello/:name",
    operationId: "hello",
    request: { params: z.object({ name: z.string() }) as any },
    responses: {
      200: { description: "ok", body: z.object({ msg: z.string() }) as any },
    },
    handler: async ({ params }) => ({
      status: 200 as const,
      body: { msg: `hi ${params.name}` },
    }),
  });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ value: z.string() }) as any },
    responses: {
      200: { description: "ok", body: z.object({ value: z.string() }) as any },
    },
    handler: async ({ body }) => ({
      status: 200 as const,
      body: body as { value: string },
    }),
  });
  app.route({
    method: "GET",
    path: "/missing",
    operationId: "missing",
    responses: { 404: { description: "nope" } },
    handler: async () => {
      throw new NotFoundError("nothing here");
    },
  });
  return app;
}

test("matches static + param routes", async () => {
  const app = buildApp();
  const res = await app.request("/hello/world");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { msg: "hi world" });
});

test("validates JSON body via Standard Schema", async () => {
  const app = buildApp();
  const ok = await app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x" }),
  });
  assert.equal(ok.status, 200);

  const bad = await app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: 1 }),
  });
  assert.equal(bad.status, 422);
  const problem: any = await bad.json();
  assert.equal(problem.status, 422);
  assert.equal(problem.title, "Request validation failed");
});

test("HttpError surfaces as problem+json", async () => {
  const app = buildApp();
  const res = await app.request("/missing");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
});

test("404 for unknown path", async () => {
  const app = buildApp();
  const res = await app.request("/nope");
  assert.equal(res.status, 404);
});

test("introspection lists routes", () => {
  const app = buildApp();
  const routes = app.introspect();
  const ids = routes.map((r) => r.operationId).sort();
  assert.deepEqual(ids, ["echo", "hello", "missing"]);
});

test("OpenAPI doc generation", () => {
  const app = buildApp();
  const doc: any = generateOpenAPI(app, { info: { title: "T", version: "1" } });
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.paths["/hello/{name}"]);
  assert.equal(doc.paths["/hello/{name}"].get.operationId, "hello");
});

test("duplicate operationId throws", () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/a",
    operationId: "dup",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  assert.throws(() =>
    app.route({
      method: "GET",
      path: "/b",
      operationId: "dup",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: undefined }),
    })
  );
});
