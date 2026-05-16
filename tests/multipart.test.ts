import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  fileField,
  isFileFieldSchema,
  isMultipartObjectSchema,
  multipartObject,
} from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";
import { validate } from "../src/schema.js";

function buildMultipart(parts: Array<{ name: string; value: string | Blob; filename?: string }>) {
  const fd = new FormData();
  for (const p of parts) {
    if (p.value instanceof Blob) {
      fd.append(p.name, p.value, p.filename ?? p.name);
    } else {
      fd.append(p.name, p.value);
    }
  }
  return fd;
}

test("fileField accepts a valid file", async () => {
  const f = fileField({ maxBytes: 1024, accept: ["text/plain", "image/*"] });
  const blob = new File(["hello"], "x.txt", { type: "text/plain" });
  const r = await validate(f, blob);
  assert.equal(r.issues, undefined);
  assert.equal((r as any).value, blob);
});

test("fileField rejects non-blob input", async () => {
  const f = fileField();
  const r = await validate(f, "not a file");
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /file upload/);
});

test("fileField rejects missing input unless optional", async () => {
  const required = fileField();
  const r1 = await validate(required, undefined);
  assert.ok(r1.issues);

  const optional = fileField({ optional: true });
  const r2 = await validate(optional, undefined);
  assert.equal(r2.issues, undefined);
  assert.equal((r2 as any).value, undefined);

  const r3 = await validate(optional, null);
  assert.equal(r3.issues, undefined);
  assert.equal((r3 as any).value, null);
});

test("fileField enforces maxBytes", async () => {
  const f = fileField({ maxBytes: 4 });
  const big = new File(["12345"], "x.txt", { type: "text/plain" });
  const r = await validate(f, big);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /maxBytes/);
});

test("fileField enforces accept allowlist with wildcards", async () => {
  const f = fileField({ accept: ["image/*"] });
  const png = new File(["x"], "x.png", { type: "image/png" });
  const txt = new File(["x"], "x.txt", { type: "text/plain" });
  assert.equal((await validate(f, png)).issues, undefined);
  const r = await validate(f, txt);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /not in accept list/);
});

test("fileField accepts */* as 'any MIME type'", async () => {
  const f = fileField({ accept: ["*/*"] });
  const blob = new File(["x"], "x.bin", { type: "application/octet-stream" });
  assert.equal((await validate(f, blob)).issues, undefined);
});

test("fileField rejects file when type is unknown and accept is set", async () => {
  const f = fileField({ accept: ["text/plain"] });
  const blob = new Blob(["x"]);
  const r = await validate(f, blob);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /unknown/);
});

test("fileField runs filename matcher", async () => {
  const f = fileField({ filename: (n) => n.endsWith(".csv") });
  const ok = new File(["x"], "x.csv", { type: "text/csv" });
  const bad = new File(["x"], "x.txt", { type: "text/csv" });
  assert.equal((await validate(f, ok)).issues, undefined);
  const r = await validate(f, bad);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /filename/);
});

test("fileField filename matcher tolerates missing name", async () => {
  const f = fileField({ filename: (n) => n.length > 0 });
  const blob = new Blob(["x"], { type: "text/plain" });
  const r = await validate(f, blob);
  assert.ok(r.issues);
});

test("isFileFieldSchema / isMultipartObjectSchema", () => {
  assert.equal(isFileFieldSchema(fileField()), true);
  assert.equal(isFileFieldSchema({}), false);
  assert.equal(
    isMultipartObjectSchema(multipartObject({ a: z.string() })),
    true
  );
  assert.equal(isMultipartObjectSchema({}), false);
});

test("multipartObject validates each field and aggregates issues", async () => {
  const schema = multipartObject({
    title: z.string().min(2),
    avatar: fileField({ maxBytes: 1024, accept: ["image/png"] }),
  });
  const ok = await validate(schema, {
    title: "hello",
    avatar: new File(["x"], "x.png", { type: "image/png" }),
  });
  assert.equal(ok.issues, undefined);

  const bad = await validate(schema, {
    title: "x",
    avatar: new File(["x"], "x.txt", { type: "text/plain" }),
  });
  assert.ok(bad.issues);
  assert.equal(bad.issues!.length, 2);
});

test("multipartObject rejects non-object input", async () => {
  const schema = multipartObject({ a: z.string() });
  const r = await validate(schema, null);
  assert.ok(r.issues);
});

test("multipartObject strict mode flags unknown fields", async () => {
  const schema = multipartObject(
    { a: z.string() },
    { strict: true }
  );
  const r = await validate(schema, { a: "ok", extra: "no" });
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /Unknown field/);
});

test("end-to-end: app parses a multipart request and the handler receives a File", async () => {
  const app = new App({ logger: false });
  let received: any = null;
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "upload",
    request: {
      body: multipartObject({
        title: z.string(),
        file: fileField({ maxBytes: 1024, accept: ["text/plain"] }),
      }),
    },
    responses: { 201: { description: "ok" } },
    handler: async ({ body }) => {
      received = body;
      return { status: 201, body: null };
    },
  });

  const fd = buildMultipart([
    { name: "title", value: "hi" },
    {
      name: "file",
      value: new File(["abc"], "x.txt", { type: "text/plain" }),
    },
  ]);
  const res = await app.request("/upload", { method: "POST", body: fd });
  assert.equal(res.status, 201);
  assert.equal(received.title, "hi");
  assert.equal(typeof received.file.arrayBuffer, "function");
  assert.equal(received.file.size, 3);
});

test("end-to-end: app returns 422 when a file fails validation", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "upload2",
    request: {
      body: multipartObject({
        file: fileField({ maxBytes: 2 }),
      }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });

  const fd = buildMultipart([
    {
      name: "file",
      value: new File(["abcdef"], "big.txt", { type: "text/plain" }),
    },
  ]);
  const res = await app.request("/upload", { method: "POST", body: fd });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { errors: Array<{ path: string }> };
  assert.equal(body.errors[0]!.path, "file");
});

test("AppOptions.multipart enforces maxFileBytes", async () => {
  const app = new App({
    logger: false,
    multipart: { maxFileBytes: 4 },
  });
  app.route({
    method: "POST",
    path: "/u",
    operationId: "u3",
    request: {
      body: multipartObject({ file: fileField() }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const fd = buildMultipart([
    { name: "file", value: new File(["12345"], "x.txt", { type: "text/plain" }) },
  ]);
  const res = await app.request("/u", { method: "POST", body: fd });
  assert.equal(res.status, 413);
});

test("AppOptions.multipart enforces maxFields", async () => {
  const app = new App({
    logger: false,
    multipart: { maxFields: 1 },
  });
  app.route({
    method: "POST",
    path: "/u",
    operationId: "u4",
    request: {
      body: multipartObject({ a: z.string(), b: z.string() }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const fd = buildMultipart([
    { name: "a", value: "x" },
    { name: "b", value: "y" },
  ]);
  const res = await app.request("/u", { method: "POST", body: fd });
  assert.equal(res.status, 400);
});

test("AppOptions.multipart enforces maxFiles", async () => {
  const app = new App({
    logger: false,
    multipart: { maxFiles: 1 },
  });
  app.route({
    method: "POST",
    path: "/u",
    operationId: "u5",
    request: {
      body: multipartObject({
        a: fileField(),
        b: fileField(),
      }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const fd = buildMultipart([
    { name: "a", value: new File(["x"], "a.txt", { type: "text/plain" }) },
    { name: "b", value: new File(["y"], "b.txt", { type: "text/plain" }) },
  ]);
  const res = await app.request("/u", { method: "POST", body: fd });
  assert.equal(res.status, 400);
});

test("Content-Length over body limit short-circuits multipart parsing", async () => {
  const app = new App({ bodyLimitBytes: 16, logger: false });
  app.route({
    method: "POST",
    path: "/u",
    operationId: "u6",
    request: {
      body: multipartObject({ file: fileField() }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  // Forge a request with an inflated Content-Length header.
  const req = new Request("http://test.local/u", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=xyz",
      "content-length": "999999",
    },
    body: "--xyz--\r\n",
  });
  const res = await app.fetch(req);
  assert.equal(res.status, 413);
});

test("OpenAPI generator emits multipart/form-data for multipartObject bodies", () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "uploadOAS",
    request: {
      body: multipartObject({
        title: z.string(),
        nickname: z.string().optional(),
        file: fileField({
          maxBytes: 1024,
          accept: ["image/png", "image/jpeg"],
        }),
        cover: fileField({ optional: true }),
      }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const doc = generateOpenAPI(app, {
    info: { title: "t", version: "1" },
  }) as any;
  const op = doc.paths["/upload"].post;
  const content = op.requestBody.content;
  assert.ok(content["multipart/form-data"]);
  const schema = content["multipart/form-data"].schema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required.sort(), ["file", "title"]);
  assert.equal(schema.properties.file.type, "string");
  assert.equal(schema.properties.file.format, "binary");
  assert.deepEqual(schema.properties.file["x-accept"], [
    "image/png",
    "image/jpeg",
  ]);
  assert.equal(schema.properties.file["x-max-bytes"], 1024);
  assert.equal(schema.properties.cover.format, "binary");
});

test("OpenAPI generator reflects strict multipart objects", () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/strict-upload",
    operationId: "strictUploadOAS",
    request: {
      body: multipartObject({ file: fileField() }, { strict: true }),
    },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const doc = generateOpenAPI(app, { info: { title: "t", version: "1" } }) as any;
  assert.equal(
    doc.paths["/strict-upload"].post.requestBody.content["multipart/form-data"]
      .schema.additionalProperties,
    false
  );
});

test("fileField honors the format option", async () => {
  const f = fileField({ format: "byte" });
  const blob = new File(["x"], "x.txt", { type: "text/plain" });
  const r = await validate(f, blob);
  assert.equal(r.issues, undefined);

  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/u",
    operationId: "u7",
    request: { body: multipartObject({ f }) },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });
  const doc = generateOpenAPI(app, { info: { title: "t", version: "1" } }) as any;
  assert.equal(
    doc.paths["/u"].post.requestBody.content["multipart/form-data"].schema
      .properties.f.format,
    "byte"
  );
});
