import { test } from "node:test";
import assert from "node:assert/strict";

const { GET, POST } = await import("../../app/api/[[...path]]/route");
const { GET: getOpenApi, POST: postOpenApi } = await import(
  "../../app/openapi.json/route"
);

test("GET /api returns a JSON catalog of DaloyJS website APIs", async () => {
  const res = await GET(new Request("http://localhost/api"), {
    params: Promise.resolve({ path: undefined }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = (await res.json()) as {
    name: string;
    links: Record<string, string>;
  };
  assert.match(body.name, /DaloyJS/);
  assert.ok(body.links.openapi.endsWith("/openapi.json"));
  assert.ok(body.links.mcp.endsWith("/mcp"));
});

test("GET /api/does-not-exist returns problem+json with code and hint", async () => {
  const res = await GET(new Request("http://localhost/api/does-not-exist"), {
    params: Promise.resolve({ path: ["does-not-exist"] }),
  });
  assert.equal(res.status, 404);
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
  const body = (await res.json()) as {
    code: string;
    hint: string;
    status: number;
  };
  assert.equal(body.status, 404);
  assert.equal(body.code, "not_found");
  assert.ok(body.hint.length > 0);
});

test("POST /api returns 405 problem+json with a recovery hint", async () => {
  const res = POST(new Request("http://localhost/api", { method: "POST" }));
  assert.equal(res.status, 405);
  const body = (await res.json()) as { code: string; hint: string };
  assert.equal(body.code, "method_not_allowed");
  assert.match(body.hint, /GET/);
});

test("GET /openapi.json is an OpenAPI 3.1 document", async () => {
  const res = getOpenApi();
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    openapi: string;
    info: { title: string };
    paths: Record<string, unknown>;
  };
  assert.equal(body.openapi, "3.1.0");
  assert.match(body.info.title, /DaloyJS/);
  assert.ok(body.paths["/mcp"]);
  assert.ok(body.paths["/api"]);
});

test("POST /openapi.json returns problem+json", async () => {
  const res = postOpenApi(
    new Request("http://localhost/openapi.json", { method: "POST" }),
  );
  assert.equal(res.status, 405);
  const body = (await res.json()) as { code: string; hint: string };
  assert.equal(body.code, "method_not_allowed");
  assert.match(body.hint, /openapi\.json/);
});
