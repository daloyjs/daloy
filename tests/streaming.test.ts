import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  ndjsonResponse,
  ndjsonStream,
  sseResponse,
  sseStream,
} from "../src/index.js";

const decoder = new TextDecoder();

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

test("sseResponse sets event-stream headers and encodes events", async () => {
  const res = sseResponse(async function* () {
    yield { event: "hello", id: "1", data: { msg: "hi" } };
    yield "raw";
    yield { retry: 5000, comment: "first comment", data: "value" };
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(res.headers.get("connection"), "keep-alive");
  assert.equal(res.headers.get("x-accel-buffering"), "no");

  const body = await readAll(res);
  assert.match(body, /event: hello\n/);
  assert.match(body, /id: 1\n/);
  assert.match(body, /data: \{"msg":"hi"\}\n\n/);
  assert.match(body, /data: raw\n\n/);
  assert.match(body, /: first comment\n/);
  assert.match(body, /retry: 5000\n/);
  assert.match(body, /data: value\n\n/);
});

test("sseStream encodes multi-line data with one data: line per source line", async () => {
  const stream = sseStream([{ data: "line1\nline2\nline3" }]);
  const text = await collect(stream);
  assert.equal(text, "data: line1\ndata: line2\ndata: line3\n\n");
});

test("sseStream sanitizes CRLF in event/id fields", async () => {
  const stream = sseStream([{ event: "evt\nname", id: "i\r\nd", data: "x" }]);
  const text = await collect(stream);
  assert.match(text, /event: evt name\n/);
  assert.match(text, /id: i d\n/);
});

test("sseStream allows comment-only and retry-only control frames", async () => {
  const stream = sseStream([{ comment: "keep\nalive" }, { retry: 2500 }]);
  const text = await collect(stream);
  assert.equal(text, ": keep\n: alive\n\nretry: 2500\n\n");
});

test("sseStream is pull-driven and respects backpressure", async () => {
  let yielded = 0;
  const stream = sseStream(async function* () {
    while (yielded < 5) {
      yielded++;
      yield { data: `n=${yielded}` };
    }
  });
  const reader = stream.getReader();

  const first = await reader.read();
  assert.equal(decoder.decode(first.value), "data: n=1\n\n");
  // Only one chunk pulled so far.
  assert.equal(yielded, 1);

  const second = await reader.read();
  assert.equal(decoder.decode(second.value), "data: n=2\n\n");
  assert.equal(yielded, 2);

  await reader.cancel("done");
});

test("sseStream calls iterator.return on consumer cancel", async () => {
  let returned = false;
  const iterable: AsyncIterable<{ data: string }> = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: { data: "x" }, done: false }),
        return: async (value?: unknown) => {
          returned = true;
          return { value, done: true };
        },
      } as AsyncIterator<{ data: string }>;
    },
  };
  const stream = sseStream(iterable);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel("client gone");
  assert.equal(returned, true);
});

test("sseStream aborts via AbortSignal and releases the iterator", async () => {
  let returned = false;
  const ctrl = new AbortController();
  const stream = sseStream(
    {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {/* never resolves */}) as any,
          return: async () => {
            returned = true;
            return { value: undefined, done: true };
          },
        } as AsyncIterator<unknown>;
      },
    } as any,
    { signal: ctrl.signal }
  );
  const reader = stream.getReader();
  ctrl.abort();
  const r = await reader.read();
  assert.equal(r.done, true);
  // give microtasks a tick
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(returned, true);
});

test("sseStream respects an already-aborted signal", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const stream = sseStream([{ data: "never" }], { signal: ctrl.signal });
  const reader = stream.getReader();
  const r = await reader.read();
  assert.equal(r.done, true);
});

test("sseStream emits keep-alive comments", async () => {
  const stream = sseStream(
    async function* () {
      // wait long enough for a keep-alive
      await new Promise((r) => setTimeout(r, 30));
      yield { data: "ok" };
    },
    { keepAliveMs: 5 }
  );
  const reader = stream.getReader();
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await reader.read();
    if (r.done) break;
    seen.push(decoder.decode(r.value));
    if (seen.some((s) => s.includes(": keep-alive"))) break;
  }
  assert.ok(seen.some((s) => s.includes(": keep-alive")), "saw a keep-alive frame");
  await reader.cancel();
});

test("sseStream surfaces iterator errors as stream errors", async () => {
  const stream = sseStream(async function* () {
    yield { data: "ok" };
    throw new Error("boom");
  });
  const reader = stream.getReader();
  await reader.read();
  await assert.rejects(reader.read(), /boom/);
});

test("ndjsonResponse encodes one JSON value per line", async () => {
  const res = ndjsonResponse([{ a: 1 }, { a: 2 }, "raw-string"]);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const body = await readAll(res);
  assert.equal(body, '{"a":1}\n{"a":2}\n"raw-string"\n');
});

test("ndjsonStream rejects values that cannot be represented as JSON", async () => {
  const stream = ndjsonStream([undefined]);
  const reader = stream.getReader();
  await assert.rejects(reader.read(), /JSON-serializable/);
});

test("ndjsonStream rejects function values that cannot be serialized", async () => {
  const stream = ndjsonStream([() => "nope"]);
  const reader = stream.getReader();
  await assert.rejects(reader.read(), /JSON-serializable/);
});

test("ndjsonStream is pull-driven", async () => {
  let yielded = 0;
  const stream = ndjsonStream<number>(async function* () {
    while (yielded < 3) {
      yielded++;
      yield yielded;
    }
  });
  const reader = stream.getReader();
  await reader.read();
  assert.equal(yielded, 1);
  await reader.read();
  assert.equal(yielded, 2);
  await reader.cancel();
});

test("ndjsonStream aborts via signal and releases iterator", async () => {
  let returned = false;
  const ctrl = new AbortController();
  const stream = ndjsonStream(
    {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {/* hang */}) as any,
          return: async () => {
            returned = true;
            return { value: undefined, done: true };
          },
        } as AsyncIterator<unknown>;
      },
    },
    { signal: ctrl.signal }
  );
  const reader = stream.getReader();
  ctrl.abort();
  const r = await reader.read();
  assert.equal(r.done, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(returned, true);
});

test("ndjsonStream respects already-aborted signal", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const stream = ndjsonStream([1, 2, 3], { signal: ctrl.signal });
  const reader = stream.getReader();
  const r = await reader.read();
  assert.equal(r.done, true);
});

test("ndjsonStream surfaces iterator errors", async () => {
  const stream = ndjsonStream(async function* () {
    yield 1;
    throw new Error("bad");
  });
  const reader = stream.getReader();
  await reader.read();
  await assert.rejects(reader.read(), /bad/);
});

test("streaming helpers integrate with App.request via the explicit-body pass-through", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/sse",
    operationId: "sseRoute",
    responses: { 200: { description: "stream" } },
    handler: ({ request }) => ({
      status: 200 as const,
      headers: { "content-type": "text/event-stream" },
      body: sseStream(
        async function* () {
          yield { event: "tick", data: 1 };
          yield { event: "tick", data: 2 };
        },
        { signal: request.signal }
      ) as any,
    }),
  });
  app.route({
    method: "GET",
    path: "/lines",
    operationId: "linesRoute",
    responses: { 200: { description: "ndjson" } },
    handler: ({ request }) => ({
      status: 200 as const,
      headers: { "content-type": "application/x-ndjson" },
      body: ndjsonStream([{ n: 1 }, { n: 2 }], { signal: request.signal }) as any,
    }),
  });

  const sse = await app.request("/sse");
  assert.equal(sse.headers.get("content-type"), "text/event-stream");
  const sseBody = await sse.text();
  assert.match(sseBody, /event: tick\ndata: 1\n\n/);
  assert.match(sseBody, /event: tick\ndata: 2\n\n/);

  const nd = await app.request("/lines");
  assert.equal(nd.headers.get("content-type"), "application/x-ndjson");
  assert.equal(await nd.text(), '{"n":1}\n{"n":2}\n');
});

test("ndjsonResponse accepts a sync iterable and a factory function", async () => {
  const res = ndjsonResponse(() => [1, 2, 3]);
  assert.equal(await res.text(), "1\n2\n3\n");
});

test("sync iterable cancellation forwards to the iterator's return()", async () => {
  let returned = false;
  const iterable: Iterable<number> = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next: () => ({ value: ++i, done: false }),
        return: (value?: unknown) => {
          returned = true;
          return { value, done: true };
        },
      } as Iterator<number>;
    },
  };
  const stream = ndjsonStream(iterable);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel("stop");
  assert.equal(returned, true);
});

test("sync iterable without return() still works", async () => {
  const iterable: Iterable<number> = {
    [Symbol.iterator]() {
      let i = 0;
      // No return() defined.
      return { next: () => ({ value: ++i, done: i > 2 ? true : false }) } as Iterator<number>;
    },
  };
  const stream = ndjsonStream(iterable);
  let txt = "";
  const reader = stream.getReader();
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    txt += decoder.decode(r.value);
  }
  assert.equal(txt, "1\n2\n");
});

test("getAsyncIterator throws TypeError on non-iterable input", () => {
  // @ts-expect-error — intentionally wrong
  assert.throws(() => sseStream(null), TypeError);
  // @ts-expect-error — intentionally wrong
  assert.throws(() => sseStream({ not: "iterable" }), TypeError);
});

test("ndjsonStream throws TypeError on null or non-iterable input", () => {
  assert.throws(() => ndjsonStream(null as any), /null\/undefined/);
  assert.throws(() => ndjsonStream({ not: "iterable" } as any), /not iterable/);
});

test("sseStream cleanup tolerates iterator.return throwing", async () => {
  const stream = sseStream({
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: { data: "x" }, done: false }),
        return: async () => {
          throw new Error("ignored");
        },
      } as AsyncIterator<unknown>;
    },
  } as any);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel(); // must not throw
});

test("ndjsonStream cleanup tolerates iterator.return throwing", async () => {
  const stream = ndjsonStream({
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: 1, done: false }),
        return: async () => {
          throw new Error("ignored");
        },
      } as AsyncIterator<unknown>;
    },
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
});
