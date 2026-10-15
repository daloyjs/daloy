import assert from "node:assert/strict";
import { test } from "node:test";

import { readBodyLimited } from "../../lib/read-body-limited";

/** A chunked body (no Content-Length) that records how many chunks were pulled. */
function chunkedRequest(chunks: number, chunkBytes: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) {
        controller.close();
        return;
      }
      pulled++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
    },
  });
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => pulled };
}

test("[happy] readBodyLimited returns the full body within the cap", async () => {
  const result = await readBodyLimited(
    new Request("http://localhost/x", { method: "POST", body: "token=abc" }),
    16,
  );
  assert.equal(result.ok, true);
  assert.equal(
    new TextDecoder().decode(result.ok ? result.bytes : undefined),
    "token=abc",
  );
});

test("[happy] readBodyLimited accepts a body exactly at the cap and an empty body", async () => {
  const exact = await readBodyLimited(
    new Request("http://localhost/x", { method: "POST", body: "a".repeat(16) }),
    16,
  );
  assert.equal(exact.ok && exact.bytes.byteLength, 16);

  const empty = await readBodyLimited(
    new Request("http://localhost/x", { method: "POST" }),
    16,
  );
  assert.equal(empty.ok && empty.bytes.byteLength, 0);
});

test("[unhappy] readBodyLimited refuses an oversized declared Content-Length without reading", async () => {
  const request = new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-length": "65536" },
    body: "token=abc",
  });
  const result = await readBodyLimited(request, 16);
  assert.equal(result.ok, false);
  assert.equal(request.bodyUsed, false);
});

test("[unhappy] readBodyLimited cancels a chunked body as soon as it passes the cap", async () => {
  const { request, pulled } = chunkedRequest(1000, 1024);
  const result = await readBodyLimited(request, 4 * 1024);
  assert.equal(result.ok, false);
  // Stops right after the chunk that crossed the cap instead of buffering
  // all 1000 chunks (~1 MiB) first.
  assert.ok(pulled() <= 7, `pulled ${pulled()} chunks`);
});
