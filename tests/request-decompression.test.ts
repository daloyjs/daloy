import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  requestDecompression,
  decompressRequestBody,
  DecompressionBombError,
  UnsupportedContentEncodingError,
  MalformedCompressedBodyError,
  readBodyLimited,
} from "../src/index.js";

// ---------- compression helpers (build fixtures with the web-standard API) ----------

async function drain(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function compress(bytes: Uint8Array, format: "gzip" | "deflate"): Promise<Uint8Array> {
  const cs = new (globalThis as any).CompressionStream(format);
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return drain(cs.readable);
}

const enc = new TextEncoder();

function gzipJson(value: unknown): Promise<Uint8Array> {
  return compress(enc.encode(JSON.stringify(value)), "gzip");
}

// A highly compressible payload: 1 MiB of a single byte gzips to ~1 KiB.
const HIGHLY_COMPRESSIBLE = enc.encode("A".repeat(1_000_000));

function echoApp(opts: Parameters<typeof requestDecompression>[0]) {
  const app = new App({ env: "development", logger: false });
  app.use(requestDecompression(opts));
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ value: z.string() }) },
    responses: {
      200: { description: "ok", body: z.object({ value: z.string() }) },
    },
    handler: async ({ body }) => ({
      status: 200 as const,
      body: body as { value: string },
    }),
  });
  return app;
}

// ---------- construction validation (unhappy paths) ----------

test("requestDecompression() requires a positive maxDecompressedBytes", () => {
  assert.throws(() => requestDecompression({ maxDecompressedBytes: 0 }), /maxDecompressedBytes/);
  assert.throws(() => requestDecompression({ maxDecompressedBytes: -1 }), /maxDecompressedBytes/);
  assert.throws(() => requestDecompression({ maxDecompressedBytes: 1.5 }), /maxDecompressedBytes/);
});

test("requestDecompression() rejects a non-positive maxCompressedBytes", () => {
  assert.throws(
    () =>
      requestDecompression({
        maxDecompressedBytes: 1024,
        maxCompressedBytes: 0,
      }),
    /maxCompressedBytes/
  );
});

test("requestDecompression() rejects a maxRatio below 1", () => {
  assert.throws(
    () => requestDecompression({ maxDecompressedBytes: 1024, maxRatio: 0.5 }),
    /maxRatio/
  );
  assert.throws(
    () =>
      requestDecompression({
        maxDecompressedBytes: 1024,
        maxRatio: Number.POSITIVE_INFINITY,
      }),
    /maxRatio/
  );
});

test("requestDecompression() rejects an empty encodings list", () => {
  assert.throws(
    () => requestDecompression({ maxDecompressedBytes: 1024, encodings: [] }),
    /at least one encoding/
  );
});

test("requestDecompression() rejects an unsupported encoding", () => {
  assert.throws(
    () =>
      requestDecompression({
        maxDecompressedBytes: 1024,
        encodings: ["br" as any],
      }),
    /unsupported encoding/
  );
});

// ---------- happy paths ----------

test("inflates a gzip JSON body and feeds schema validation", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024, maxRatio: 1000 });
  const body = await gzipJson({ value: "hello" });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { value: "hello" });
});

test("inflates a deflate JSON body", async () => {
  const app = echoApp({
    maxDecompressedBytes: 1024 * 1024,
    maxRatio: 1000,
    encodings: ["deflate"],
  });
  const body = await compress(enc.encode(JSON.stringify({ value: "deflated" })), "deflate");
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "deflate",
      },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { value: "deflated" });
});

test("passes through an uncompressed body untouched", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024 });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "plain" }),
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { value: "plain" });
});

test("treats Content-Encoding: identity as a pass-through", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024 });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "identity",
      },
      body: JSON.stringify({ value: "identity" }),
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { value: "identity" });
});

test("a handler reading the raw body sees the inflated bytes", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(requestDecompression({ maxDecompressedBytes: 1024 * 1024, maxRatio: 1000 }));
  app.route({
    method: "POST",
    path: "/raw",
    operationId: "raw",
    responses: { 200: { description: "ok", body: z.object({ length: z.number() }) } },
    handler: async ({ request }) => {
      const bytes = await readBodyLimited(request, 1024 * 1024);
      return { status: 200 as const, body: { length: bytes.byteLength } };
    },
  });
  const payload = enc.encode("A".repeat(5000));
  const res = await app.fetch(
    new Request("http://x/raw", {
      method: "POST",
      headers: { "content-encoding": "gzip" },
      body: (await compress(payload, "gzip")) as BodyInit,
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { length: 5000 });
});

// ---------- unhappy paths ----------

test("rejects an unknown Content-Encoding with 415", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024 });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "br" },
      body: "anything",
    })
  );
  assert.equal(res.status, 415);
  assert.match(res.headers.get("accept-encoding") ?? "", /gzip/);
});

test("rejects a layered Content-Encoding (gzip, gzip) with 415", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024 });
  const body = await gzipJson({ value: "x" });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip, gzip",
      },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 415);
});

test("rejects a body that exceeds maxCompressedBytes with 413", async () => {
  const app = echoApp({
    maxDecompressedBytes: 1024 * 1024,
    maxCompressedBytes: 16,
  });
  const body = await gzipJson({ value: "x".repeat(5000) });
  assert.ok(body.byteLength > 16, "fixture must exceed the compressed cap");
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 413);
});

test("aborts a decompression bomb on the absolute cap with 413", async () => {
  let bombInfo: any;
  const app = echoApp({
    maxDecompressedBytes: 1000,
    maxRatio: 1_000_000,
    onBomb: (info) => {
      bombInfo = info;
    },
  });
  const body = await compress(HIGHLY_COMPRESSIBLE, "gzip");
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 413);
  assert.equal(bombInfo.reason, "absolute");
  assert.equal(bombInfo.encoding, "gzip");
});

test("aborts a decompression bomb on the ratio cap with 413", async () => {
  let bombInfo: any;
  const app = echoApp({
    maxDecompressedBytes: 10 * 1024 * 1024,
    maxRatio: 2,
    onBomb: (info) => {
      bombInfo = info;
    },
  });
  const body = await compress(HIGHLY_COMPRESSIBLE, "gzip");
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: body as BodyInit,
    })
  );
  assert.equal(res.status, 413);
  assert.equal(bombInfo.reason, "ratio");
});

test("rejects a malformed compressed body with 400", async () => {
  const app = echoApp({ maxDecompressedBytes: 1024 * 1024 });
  const res = await app.fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: enc.encode("not a real gzip stream") as BodyInit,
    })
  );
  assert.equal(res.status, 400);
});

// ---------- decompressRequestBody (low-level helper) ----------

test("decompressRequestBody inflates a valid gzip payload", async () => {
  const original = enc.encode("round-trip me");
  const compressed = await compress(original, "gzip");
  const inflated = await decompressRequestBody(compressed, "gzip", {
    maxDecompressedBytes: 1024,
  });
  assert.deepEqual(inflated, original);
});

test("decompressRequestBody returns empty for an empty input", async () => {
  const inflated = await decompressRequestBody(new Uint8Array(0), "gzip", {
    maxDecompressedBytes: 1024,
  });
  assert.equal(inflated.byteLength, 0);
});

test("decompressRequestBody throws DecompressionBombError on the ratio cap", async () => {
  const compressed = await compress(HIGHLY_COMPRESSIBLE, "gzip");
  await assert.rejects(
    () =>
      decompressRequestBody(compressed, "gzip", {
        maxDecompressedBytes: 10 * 1024 * 1024,
        maxRatio: 2,
      }),
    (err: unknown) => err instanceof DecompressionBombError && err.info.reason === "ratio"
  );
});

test("decompressRequestBody throws MalformedCompressedBodyError on junk input", async () => {
  await assert.rejects(
    () =>
      decompressRequestBody(enc.encode("definitely not gzip"), "gzip", {
        maxDecompressedBytes: 1024,
      }),
    MalformedCompressedBodyError
  );
});

test("decompressRequestBody validates its caps", async () => {
  await assert.rejects(
    () =>
      decompressRequestBody(new Uint8Array(1), "gzip", {
        maxDecompressedBytes: 0,
      }),
    /maxDecompressedBytes/
  );
});

test("UnsupportedContentEncodingError carries the proper name", () => {
  const err = new UnsupportedContentEncodingError("br", ["gzip", "deflate"]);
  assert.equal(err.name, "UnsupportedContentEncodingError");
  assert.equal(err.status, 415);
});
