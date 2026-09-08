import assert from "node:assert/strict";
import { test } from "node:test";
import { idempotency } from "../src/idempotency.js";
import { responseCache } from "../src/response-cache.js";
import { compression } from "../src/compression.js";
import { readResponseBodyUpTo } from "../src/internal-body.js";
import type { BaseContext, Hooks } from "../src/types.js";

for (const [name, createHooks] of [
  ["responseCache", () => responseCache({ maxBodyBytes: 4 })],
  ["idempotency", () => idempotency({ maxResponseBytes: 4 })],
  [
    "compression",
    () =>
      compression({
        minimumSize: 0,
        maxCompressibleBytes: 4,
        encodings: ["gzip"],
      }),
  ],
] satisfies Array<[string, () => Hooks]>) {
  test(`${name}: stops capturing immediately after the byte cap without consuming the client branch`, async () => {
    const hooks = createHooks();
    const context = {
      request: new Request("https://example.test/stream", {
        method: name === "idempotency" ? "POST" : "GET",
        headers: {
          "idempotency-key": "bounded-response",
          "accept-encoding": "gzip",
        },
      }),
      state: {},
    } as BaseContext<string, undefined>;
    await hooks.beforeHandle?.(context);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          controller.enqueue(new TextEncoder().encode("12345"));
        },
      }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = Promise.resolve(hooks.onSend!(response, context));
    try {
      const outcome = await Promise.race([
        capture.then(() => "returned"),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("waiting-for-eof"), 500);
        }),
      ]);
      assert.equal(
        outcome,
        "returned",
        "the size limit must not wait for the oversized stream to end",
      );
    } finally {
      clearTimeout(timer);
      controller.close();
      assert.equal(
        await response.text(),
        "12345",
        "the original response body must remain intact",
      );
      await capture;
    }
  });
}

for (const chunks of [
  [],
  ["1234"],
  ["12", "34"],
  ["", "1", "", "2"],
  ["12345"],
  ["12", "345"],
]) {
  test(`bounded response reader handles chunks ${JSON.stringify(chunks)}`, async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
    );
    const bytes = await readResponseBodyUpTo(response.clone(), 4);
    const expected = chunks.join("");
    if (expected.length > 4) assert.equal(bytes, null);
    else assert.equal(new TextDecoder().decode(bytes!), expected);
    assert.equal(await response.text(), expected);
  });
}

test("bounded response reader handles a bodyless response", async () => {
  assert.deepEqual(
    await readResponseBodyUpTo(new Response(null, { status: 204 }), 4),
    new Uint8Array(),
  );
});

test("bounded response reader propagates stream errors and releases its reader", async () => {
  const failure = new Error("test stream failure");
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    }),
  );
  await assert.rejects(readResponseBodyUpTo(response, 4), failure);
  assert.equal(response.body!.locked, false);
});

for (const name of ["responseCache", "idempotency"] as const) {
  for (const payload of ["1234", "12345"]) {
    test(`${name}: ${payload.length === 4 ? "replays an exact-limit" : "does not retain an oversized"} response`, async () => {
      const hooks =
        name === "responseCache"
          ? responseCache({ maxBodyBytes: 4 })
          : idempotency({ maxResponseBytes: 4 });
      const makeContext = () =>
        ({
          request: new Request("https://example.test/stream", {
            method: name === "idempotency" ? "POST" : "GET",
            headers: { "idempotency-key": "bounded-response" },
          }),
          state: {},
        }) as BaseContext<string, undefined>;
      const first = makeContext();
      assert.equal(await hooks.beforeHandle!(first), undefined);
      const response = new Response(payload);
      await hooks.onSend!(response, first);
      assert.equal(await response.text(), payload);
      const replay = await hooks.beforeHandle!(makeContext());
      if (payload.length === 4) {
        assert.ok(replay instanceof Response);
        assert.equal(await replay.text(), payload);
      } else {
        assert.equal(
          replay,
          undefined,
          "oversized capture must not leave an idempotency reservation or cached response",
        );
      }
    });
  }
}
