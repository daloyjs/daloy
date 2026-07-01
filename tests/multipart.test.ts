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

test("fileField verifies inferred magic bytes", async () => {
  const f = fileField({ accept: ["image/png"], magicBytes: true });
  const png = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    "x.png",
    { type: "image/png" }
  );
  assert.equal((await validate(f, png)).issues, undefined);

  const forged = new File(["not-a-png"], "x.png", { type: "image/png" });
  const result = await validate(f, forged);
  assert.ok(result.issues);
  assert.match(result.issues![0]!.message, /magic bytes/);
});

test("fileField rejects payload bytes that disagree with the declared MIME", async () => {
  const f = fileField({ accept: ["image/png", "image/jpeg"], magicBytes: true });
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  const disguised = new File([jpegBytes], "x.png", { type: "image/png" });
  const result = await validate(f, disguised);
  assert.ok(result.issues);
  assert.match(result.issues![0]!.message, /Declared MIME/);
});

test("fileField accepts custom magic-byte signatures", async () => {
  const f = fileField({
    accept: ["application/x-daloy"],
    magicBytes: [{ mime: "application/x-daloy", bytes: [0x44, 0x4c, 0x59], offset: 1 }],
  });
  const ok = new File([new Uint8Array([0x00, 0x44, 0x4c, 0x59])], "x.daloy", {
    type: "application/x-daloy",
  });
  assert.equal((await validate(f, ok)).issues, undefined);

  const bad = new File([new Uint8Array([0x44, 0x4c, 0x59])], "x.daloy", {
    type: "application/x-daloy",
  });
  const result = await validate(f, bad);
  assert.ok(result.issues);
});

test("fileField validates magic-byte options", () => {
  assert.throws(() => fileField({ magicBytes: [{ mime: "text/plain", bytes: [] }] }), /bytes/);
  assert.throws(() => fileField({ magicBytes: [{ mime: "text/plain", bytes: [256] }] }), /bytes/);
  assert.throws(
    () => fileField({ magicBytes: [{ mime: "text/plain", bytes: [0], offset: -1 }] }),
    /offset/
  );
});

test("fileField rejects magicBytes true without a sniffable accept type", () => {
  assert.throws(() => fileField({ magicBytes: true }), /known sniffable MIME/);
  assert.throws(
    () => fileField({ accept: ["text/plain"], magicBytes: true }),
    /known sniffable MIME/
  );
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
  assert.equal(isMultipartObjectSchema(multipartObject({ a: z.string() })), true);
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

test("multipartObject rejects missing required file fields", async () => {
  const schema = multipartObject({ file: fileField() });
  const r = await validate(schema, {});
  assert.ok(r.issues);
  assert.deepEqual(r.issues![0]!.path, ["file"]);
});

test("multipartObject strict mode flags unknown fields", async () => {
  const schema = multipartObject({ a: z.string() }, { strict: true });
  const r = await validate(schema, { a: "ok", extra: "no" });
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /Unknown field/);
});

test("fileField rejects scriptable image formats by default when magicBytes is set", async () => {
  const f = fileField({ accept: ["image/*"], magicBytes: true });

  const svg = new File(
    [
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    ],
    "x.svg",
    { type: "image/svg+xml" }
  );
  const svgResult = await validate(f, svg);
  assert.ok(svgResult.issues, "SVG should be rejected");
  assert.match(svgResult.issues![0]!.message, /scriptable image/i);

  // Bare <svg> without an XML prologue.
  const bareSvg = new File([`<svg xmlns="http://www.w3.org/2000/svg"></svg>`], "x.svg", {
    type: "image/svg+xml",
  });
  const bareResult = await validate(f, bareSvg);
  assert.ok(bareResult.issues);
  assert.match(bareResult.issues![0]!.message, /scriptable image/i);

  // ImageMagick MVG \u2014 the ImageTragick payload shape.
  const mvg = new File(
    [
      `push graphic-context\nviewbox 0 0 640 480\nimage Over 0,0 0,0 'url(http://example.com/)'\npop graphic-context`,
    ],
    "x.mvg",
    { type: "image/png" }
  );
  const mvgResult = await validate(f, mvg);
  assert.ok(mvgResult.issues);
  assert.match(mvgResult.issues![0]!.message, /scriptable image/i);

  // PostScript / EPS \u2014 attacker disguises it under an image MIME so the
  // accept-list pass-through, then the scriptable-image guard catches it.
  const ps = new File([`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n`], "x.eps", {
    type: "image/jpeg",
  });
  const psResult = await validate(f, ps);
  assert.ok(psResult.issues);
  assert.match(psResult.issues![0]!.message, /scriptable image/i);
});

test("fileField scriptable-image guard handles a UTF-8 BOM before <svg", async () => {
  const f = fileField({ accept: ["image/*"], magicBytes: true });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const body = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
  const buf = new Uint8Array(bom.length + body.length);
  buf.set(bom, 0);
  buf.set(body, bom.length);
  const svg = new File([buf], "x.svg", { type: "image/svg+xml" });
  const r = await validate(f, svg);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /scriptable image/i);
});

test("fileField scriptable-image guard can be opted out", async () => {
  const f = fileField({
    accept: ["image/svg+xml"],
    rejectScriptableImages: false,
  });
  const svg = new File([`<svg xmlns="http://www.w3.org/2000/svg"></svg>`], "x.svg", {
    type: "image/svg+xml",
  });
  const r = await validate(f, svg);
  assert.equal(r.issues, undefined);
});

test("fileField scriptable-image guard can be enabled without magicBytes", async () => {
  const f = fileField({ accept: ["image/*"], rejectScriptableImages: true });
  const svg = new File([`<svg xmlns="http://www.w3.org/2000/svg"></svg>`], "x.svg", {
    type: "image/svg+xml",
  });
  const r = await validate(f, svg);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /scriptable image/i);
});

test("fileField scriptable-image guard leaves real PNGs alone", async () => {
  const f = fileField({ accept: ["image/png"], magicBytes: true });
  const png = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])],
    "ok.png",
    { type: "image/png" }
  );
  const r = await validate(f, png);
  assert.equal(r.issues, undefined);
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

test("end-to-end: parses a mixed-case boundary (browser / curl regression)", async () => {
  // Regression: the body parser used to lower-case the whole Content-Type
  // header (for case-insensitive media-type matching) and then reuse that
  // string — including the now-lower-cased `boundary=` parameter — when
  // reconstructing the Request for `formData()`. Multipart boundaries are
  // case-SENSITIVE (RFC 2046 §5.1.1), so any upload whose boundary contained
  // uppercase letters — every Chromium/WebKit browser (`----WebKitFormBoundary…`)
  // and curl (`------------------------…`) — failed to parse and returned 500.
  // A native FormData body (undici's boundary is all-lowercase) masked it.
  const app = new App({ logger: false });
  let received: any = null;
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "uploadMixedCaseBoundary",
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

  const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  const rawBody =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="title"\r\n\r\n` +
    `hi\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="x.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `abc\r\n` +
    `--${boundary}--\r\n`;
  const req = new Request("http://test.local/upload", {
    method: "POST",
    // Mixed-case boundary parameter — must survive verbatim to the parser.
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: rawBody,
  });
  const res = await app.fetch(req);
  assert.equal(res.status, 201);
  assert.equal(received.title, "hi");
  assert.equal(received.file.size, 3);
});

test("end-to-end: a malformed multipart body is a 400, not a 500", async () => {
  // A body the platform parser cannot read is a client error (RFC 9457 400),
  // not a server fault (500). Declaring one boundary while the body uses
  // another makes `formData()` throw; the framework must translate that into
  // a 400 rather than letting the raw TypeError surface as a generic 500.
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "uploadMalformed",
    request: { body: multipartObject({ file: fileField() }) },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });

  const req = new Request("http://test.local/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=DECLARED" },
    body: "--WRONG\r\nnot a valid multipart part\r\n--WRONG--\r\n",
  });
  const res = await app.fetch(req);
  assert.equal(res.status, 400);
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
          magicBytes: true,
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
  assert.deepEqual(schema.properties.file["x-accept"], ["image/png", "image/jpeg"]);
  assert.equal(schema.properties.file["x-max-bytes"], 1024);
  assert.equal(schema.properties.file["x-magic-bytes"], true);
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
    doc.paths["/strict-upload"].post.requestBody.content["multipart/form-data"].schema
      .additionalProperties,
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
    doc.paths["/u"].post.requestBody.content["multipart/form-data"].schema.properties.f.format,
    "byte"
  );
});

test("multipart body is capped at bodyLimitBytes even with no Content-Length (streamed upload)", async () => {
  // Regression: the multipart branch used to trust Content-Length and then
  // hand the body to the platform formData() parser. A chunked upload sends no
  // Content-Length, so on runtimes without a socket-layer cap (Workers/Deno/
  // Vercel) the parser could buffer an unbounded body. The reader now caps
  // the ACTUAL bytes against bodyLimitBytes before parsing.
  const app = new App({ logger: false, bodyLimitBytes: 512 });
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "uploadStreamCap",
    request: { body: multipartObject({ file: fileField() }) },
    responses: { 201: { description: "ok" } },
    handler: async () => ({ status: 201, body: null }),
  });

  // Serialize a multipart body whose real size far exceeds the 512-byte cap,
  // then replay it as a ReadableStream so the Request carries NO Content-Length.
  const fd = buildMultipart([
    { name: "file", value: new File(["A".repeat(4000)], "big.txt", { type: "text/plain" }) },
  ]);
  const probe = new Request("http://localhost/upload", { method: "POST", body: fd });
  const contentType = probe.headers.get("content-type")!;
  const wire = new Uint8Array(await probe.arrayBuffer());
  assert.ok(wire.byteLength > 512, "fixture must exceed the cap");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(wire);
      controller.close();
    },
  });
  const req = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body: stream,
    duplex: "half",
  } as RequestInit);

  const res = await app.fetch(req);
  assert.equal(res.status, 413, "an oversize streamed multipart upload must be refused with 413");
});
