import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, NotFoundError, bearerAuth } from "../src/index.js";
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

test("wildcard methods retain auth, HEAD fallback, and internal-route hiding", async () => {
  const app = new App({ logger: false });
  for (const method of ["GET", "POST", "DELETE"] as const) {
    app.route({
      method,
      path: "/assets/*path",
      internal: method === "DELETE",
      hooks: bearerAuth({ validate: () => true }),
      request: { params: z.object({ path: z.string() }).strict() },
      responses: {
        200: {
          description: "ok",
          body: z.object({ path: z.string() }).strict(),
        },
      },
      handler: ({ params }) => ({ status: 200, body: params }),
    });
  }
  for (const method of ["GET", "POST", "HEAD"]) {
    assert.equal(
      (await app.request("/assets/css/app.css", { method })).status,
      401,
    );
    const response = await app.request("/assets/css/app.css", {
      method,
      headers: { authorization: "Bearer router-test" },
    });
    assert.equal(response.status, 200);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { path: "css/app.css" });
  }
  assert.equal(
    (await app.request("/assets/css/app.css", { method: "DELETE" })).status,
    404,
  );
  for (const method of ["OPTIONS", "PATCH"]) {
    const response = await app.request("/assets/css/app.css", { method });
    assert.equal(response.status, method === "OPTIONS" ? 204 : 405);
    assert.deepEqual(response.headers.get("allow")?.split(", ").sort(), [
      "GET",
      "POST",
    ]);
  }
  for (const path of ["/assets//app.css", "/assets/%zz"]) {
    const response = await app.request(path, { method: "OPTIONS" });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("allow"), null);
  }
});

test("overlapping static and dynamic routes advertise only reachable public methods", async () => {
  const app = new App({ logger: false });
  for (const [method, path] of [
    ["GET", "/users/me"],
    ["GET", "/users/me/details/:field"],
    ["POST", "/users/:id"],
    ["DELETE", "/users/:id"],
  ] as const) {
    app.route({
      method,
      path,
      internal: method === "DELETE",
      responses: { 204: { description: "ok" } },
      handler: () => ({ status: 204, body: undefined }),
    });
  }
  assert.equal(
    (await app.request("/users/me", { method: "POST" })).status,
    204,
  );
  assert.equal(
    (await app.request("/users/me", { method: "DELETE" })).status,
    404,
  );
  for (const method of ["OPTIONS", "PATCH"]) {
    const response = await app.request("/users/me", { method });
    assert.equal(response.status, method === "OPTIONS" ? 204 : 405);
    assert.deepEqual(response.headers.get("allow")?.split(", ").sort(), [
      "GET",
      "POST",
    ]);
  }
});

test("prototype-named methods cannot expose internal routes or dispatch public handlers", async () => {
  const app = new App({ logger: false });
  let calls = 0;
  for (const path of ["/fixed", "/dynamic/:id", "/assets/*path"] as const) {
    for (const internal of [false, true]) {
      app.route({
        method: "GET",
        path: internal ? `/private${path}` : path,
        internal,
        responses: { 204: { description: "ok" } },
        handler: () => {
          calls++;
          return { status: 204, body: undefined };
        },
      });
    }
  }
  for (const method of [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
    "valueOf",
    "CUSTOM",
  ]) {
    for (const path of ["/fixed", "/dynamic/value", "/assets/file"]) {
      const publicResponse = await app.fetch(
        new Request(`http://test.local${path}`, { method }),
      );
      assert.equal(publicResponse.status, 405);
      assert.equal(publicResponse.headers.get("allow"), "GET");
      for (const hiddenPath of [`/private${path}`, "/unknown"]) {
        const response = await app.fetch(
          new Request(`http://test.local${hiddenPath}`, { method }),
        );
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("allow"), null);
      }
    }
  }
  assert.equal(calls, 0);
  assert.equal(
    (await app.fetch(new Request("http://test.local/fixed"))).status,
    204,
  );
  assert.equal(
    (await app.fetch(new Request("http://test.local/private/fixed"))).status,
    404,
  );
  assert.equal(calls, 1);
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
    }),
  );
});
