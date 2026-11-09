import { test } from "node:test";
import assert from "node:assert/strict";

import { App, DALOY_REQUEST_RAW_BODY } from "../src/app.js";

const raw = {
  responses: { 200: { description: "body length" } },
  acknowledgeNoResponseBodySchema: true,
} as const;
const encoder = new TextEncoder();
type BodyReader = (request: Request) => Promise<number>;

const readers: Record<string, BodyReader> = {
  arrayBuffer: async (request) => (await request.arrayBuffer()).byteLength,
  bytes: async (request) =>
    (await (request as Request & { bytes(): Promise<Uint8Array> }).bytes()).byteLength,
  text: async (request) => encoder.encode(await request.text()).byteLength,
  json: async (request) => encoder.encode(JSON.stringify(await request.json())).byteLength,
  blob: async (request) => (await request.blob()).size,
  formData: async (request) => String((await request.formData()).get("value")).length + 6,
  clone: async (request) => (await request.clone().arrayBuffer()).byteLength,
  body: async (request) => {
    const reader = request.body!.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
    }
  },
};

function streamingPost(size: number, reader = "arrayBuffer", declared?: number): Request {
  const text = reader === "json"
    ? JSON.stringify("a".repeat(size - 2))
    : reader === "formData"
      ? `value=${"a".repeat(size - 6)}`
      : "a".repeat(size);
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Request("http://localhost/tiny", {
    method: "POST",
    headers: {
      "content-type": reader === "formData"
        ? "application/x-www-form-urlencoded"
        : reader === "json" ? "application/json" : "text/plain",
      ...(declared === undefined ? {} : { "content-length": String(declared) }),
    },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) return controller.close();
        const end = Math.min(offset + 32, bytes.byteLength);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    }, { highWaterMark: 0 }),
    duplex: "half",
  } as RequestInit);
}

for (const [name, read] of Object.entries(readers)) {
  test(`body-cap retuning: lowered post-clone cap bounds ${name}`, async () => {
    let accepted = 0;
    const app = new App({
      logger: false,
      bodyLimitBytes: 1024,
      hooks: {
        async onRequest(request) {
          await request.clone().arrayBuffer();
        },
      },
    });
    app.post("/tiny", { ...raw, bodyLimitBytes: 64 }, async ({ request }) => {
      const length = await read(request);
      accepted++;
      return new Response(String(length));
    });
    const oversized = await app.fetch(streamingPost(512, name));
    assert.equal(oversized.status, 413);
    assert.equal(accepted, 0, "over-limit bytes must not complete a raw read");
    const exact = await app.fetch(streamingPost(64, name));
    assert.equal(exact.status, 200);
    assert.equal(await exact.text(), "64");
    assert.equal(accepted, 1);
  });
}

test("body-cap retuning: raising preserves route and sibling caps", async () => {
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: { onRequest() {} },
  });
  const echo: BodyReader = readers.arrayBuffer!;
  app.post("/tiny", { ...raw, bodyLimitBytes: 4096 }, async ({ request }) =>
    new Response(String(await echo(request))));
  app.post("/sibling", raw, async ({ request }) => new Response(String(await echo(request))));
  const raised = await app.fetch(streamingPost(2048));
  assert.equal(raised.status, 200);
  assert.equal(await raised.text(), "2048");
  assert.equal((await app.fetch(streamingPost(4097))).status, 413);
  const sibling = new Request("http://localhost/sibling", streamingPost(2048));
  assert.equal((await app.fetch(sibling)).status, 413);
});

test("body-cap retuning: raised cap preserves bytes already buffered by a clone", async () => {
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: {
      async onRequest(request) {
        await request.clone().arrayBuffer();
      },
    },
  });
  app.post("/tiny", { ...raw, bodyLimitBytes: 4096 }, async ({ request }) =>
    new Response(String((await request.arrayBuffer()).byteLength)));
  const exactApp = await app.fetch(streamingPost(1024));
  assert.equal(exactApp.status, 200);
  assert.equal(await exactApp.text(), "1024");
  assert.equal((await app.fetch(streamingPost(1025))).status, 413);
});

test("body-cap retuning: lowered cap rechecks Content-Length after clone buffering", async () => {
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: {
      async onRequest(request) {
        await request.clone().arrayBuffer();
      },
    },
  });
  app.post("/tiny", { ...raw, bodyLimitBytes: 64 }, async ({ request }) =>
    new Response(String((await request.arrayBuffer()).byteLength)));
  assert.equal((await app.fetch(streamingPost(32, "arrayBuffer", 512))).status, 413);
  const exact = await app.fetch(streamingPost(64, "arrayBuffer", 64));
  assert.equal(exact.status, 200);
  assert.equal(await exact.text(), "64");
});

test("body-cap retuning: adapter-cached bytes still obey lowered and raised caps", async () => {
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: {
      async onRequest(request) {
        await request.clone().arrayBuffer();
      },
    },
  });
  app.post("/tiny", { ...raw, bodyLimitBytes: 64 }, async ({ request }) =>
    new Response(String((await request.arrayBuffer()).byteLength)));
  app.post("/wide", { ...raw, bodyLimitBytes: 4096 }, async ({ request }) =>
    new Response(String((await request.arrayBuffer()).byteLength)));
  const cachedPost = (size: number, path = "/tiny") => {
    const bytes = new Uint8Array(size).fill(0x61);
    const request = new Request(`http://localhost${path}`, { method: "POST", body: bytes });
    Object.defineProperty(request, DALOY_REQUEST_RAW_BODY, { value: bytes });
    return request;
  };
  assert.equal((await app.fetch(cachedPost(512))).status, 413);
  const exact = await app.fetch(cachedPost(64));
  assert.equal(exact.status, 200);
  assert.equal(await exact.text(), "64");
  const raised = await app.fetch(cachedPost(512, "/wide"));
  assert.equal(raised.status, 200);
  assert.equal(await raised.text(), "512");
});

test("body-cap retuning: initialized streams remain lazy when a lowered route ignores its body", async () => {
  let pulls = 0;
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: { onRequest(request) { void request.body; } },
  });
  app.post("/tiny", { ...raw, bodyLimitBytes: 64 }, () => new Response("ignored"));
  const response = await app.fetch(new Request("http://localhost/tiny", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    }, { highWaterMark: 0 }),
    duplex: "half",
  } as RequestInit));
  assert.equal(response.status, 200);
  assert.equal(pulls, 0);
});

test("body-cap retuning: clone buffering does not eagerly reject an ignored route body", async () => {
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: {
      async onRequest(request) { await request.clone().arrayBuffer(); },
    },
  });
  app.post("/tiny", { ...raw, bodyLimitBytes: 64 }, () => new Response("ignored"));
  assert.equal((await app.fetch(streamingPost(512))).status, 200);
});

test("body-cap retuning: app cap and preBody denial remain fail-closed", async () => {
  let handlerCalls = 0;
  const app = new App({
    logger: false,
    bodyLimitBytes: 1024,
    hooks: {
      async onRequest(request) { await request.clone().arrayBuffer(); },
    },
  });
  app.post("/tiny", {
    ...raw,
    bodyLimitBytes: 64,
    hooks: { preBody() { return new Response("denied", { status: 401 }); } },
  }, () => {
    handlerCalls++;
    return new Response("unexpected");
  });
  assert.equal((await app.fetch(streamingPost(1025))).status, 413);
  assert.equal((await app.fetch(streamingPost(512))).status, 401);
  assert.equal(handlerCalls, 0);
});
