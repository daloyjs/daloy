/**
 * Streaming response helpers — Server-Sent Events (SSE) and NDJSON.
 *
 * Both helpers return a `ReadableStream<Uint8Array>` (or, in the `*Response`
 * forms, a `Response`) that is **backpressure-safe**: data is only pulled
 * from the underlying `AsyncIterable`/generator when the consumer asks for
 * the next chunk. They also honor an optional `AbortSignal` and call
 * `iterator.return()` so caller-owned resources (DB cursors, fetches, queues)
 * are released when the client disconnects.
 *
 * ```ts
 * import { sseStream } from "@daloyjs/core";
 *
 * app.route({
 *   method: "GET",
 *   path: "/events",
 *   operationId: "events",
 *   responses: { 200: { description: "SSE stream" } },
 *   handler: ({ request }) => ({
 *     status: 200,
 *     headers: { "content-type": "text/event-stream" },
 *     body: sseStream(async function* () {
 *       yield { event: "ping", data: { now: Date.now() } };
 *     }, { signal: request.signal }),
 *   }),
 * });
 * ```
 *
 * For NDJSON, each yielded value is JSON-encoded and terminated with `\n`.
 */

const TEXT_ENCODER = new TextEncoder();

/**
 * A single SSE event or control frame.
 *
 * `data` may be a string or any JSON-serializable value. It is optional so
 * callers can emit valid comment-only or retry-only SSE frames for keep-alive
 * and reconnection control without sending an event payload.
 */
export interface SSEMessage {
  data?: unknown;
  event?: string;
  id?: string;
  /** Reconnection delay in milliseconds. */
  retry?: number;
  /** Comment line (sent as `: <comment>`). Useful for keep-alive pings. */
  comment?: string;
}

/** Common options shared by every streaming helper in this module. */
export interface StreamOptions {
  /** Abort the stream when this signal fires. */
  signal?: AbortSignal;
}

/** Options for {@link sseStream}. */
export interface SSEStreamOptions extends StreamOptions {
  /**
   * Send a comment (`:keep-alive`) every N milliseconds to keep the
   * connection open through proxies. Set to `0`/`undefined` to disable.
   */
  keepAliveMs?: number;
}

/** Options for {@link sseResponse}. */
export interface SSEResponseOptions extends SSEStreamOptions {
  /** HTTP status (default `200`). */
  status?: number;
  /** Response headers merged with SSE defaults; caller-supplied values win. */
  headers?: HeadersInit;
}

/** Options for {@link ndjsonResponse}. */
export interface NDJSONResponseOptions extends StreamOptions {
  /** HTTP status (default `200`). */
  status?: number;
  /** Response headers merged with NDJSON defaults; caller-supplied values win. */
  headers?: HeadersInit;
}

type IterableSource<T> = AsyncIterable<T> | Iterable<T> | (() => AsyncIterable<T> | Iterable<T>);

function getAsyncIterator<T>(src: IterableSource<T>): AsyncIterator<T> {
  const it = typeof src === "function" ? src() : src;
  if (it == null) {
    throw new TypeError("Streaming source is null/undefined");
  }
  if (typeof (it as AsyncIterable<T>)[Symbol.asyncIterator] === "function") {
    return (it as AsyncIterable<T>)[Symbol.asyncIterator]();
  }
  if (typeof (it as Iterable<T>)[Symbol.iterator] === "function") {
    const sync = (it as Iterable<T>)[Symbol.iterator]();
    const wrapped: AsyncIterator<T> = {
      next: async () => sync.next(),
    };
    if (sync.return) {
      wrapped.return = async (value?: unknown) => sync.return!(value);
    }
    return wrapped;
  }
  throw new TypeError("Streaming source is not iterable");
}

function encodeSSE(msg: SSEMessage | string): Uint8Array {
  const message: SSEMessage = typeof msg === "string" ? { data: msg } : msg;
  let out = "";
  if (message.comment) {
    for (const line of String(message.comment).split(/\r?\n/)) {
      out += `: ${line}\n`;
    }
  }
  if (message.event !== undefined) {
    // Event names cannot contain newlines per the spec.
    out += `event: ${String(message.event).replace(/[\r\n]+/g, " ")}\n`;
  }
  if (message.id !== undefined) {
    out += `id: ${String(message.id).replace(/[\r\n]+/g, " ")}\n`;
  }
  if (message.retry !== undefined && Number.isFinite(message.retry)) {
    out += `retry: ${Math.max(0, Math.floor(message.retry))}\n`;
  }
  if (message.data !== undefined) {
    const raw = typeof message.data === "string" ? message.data : JSON.stringify(message.data);
    for (const line of raw.split(/\r?\n/)) {
      out += `data: ${line}\n`;
    }
  }
  out += "\n";
  return TEXT_ENCODER.encode(out);
}

function encodeNDJSON(value: unknown): Uint8Array {
  const line = JSON.stringify(value);
  if (line === undefined) {
    throw new TypeError("NDJSON values must be JSON-serializable");
  }
  return TEXT_ENCODER.encode(line + "\n");
}

/**
 * Build a backpressure-safe `ReadableStream` from an async iterable of SSE
 * messages. The iterator is only advanced when the consumer pulls the next
 * chunk, so a slow client cannot cause unbounded buffering.
 */
export function sseStream(
  source: IterableSource<SSEMessage | string>,
  opts: SSEStreamOptions = {}
): ReadableStream<Uint8Array> {
  const iterator = getAsyncIterator<SSEMessage | string>(source);
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  let abortHandler: (() => void) | undefined;

  const cleanup = async (cancelValue?: unknown) => {
    if (keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
    if (opts.signal && abortHandler) {
      opts.signal.removeEventListener("abort", abortHandler);
      abortHandler = undefined;
    }
    if (typeof iterator.return === "function") {
      try {
        await iterator.return(cancelValue);
      } catch {
        /* swallow — the consumer is already gone */
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.signal?.aborted) {
        controller.close();
        void cleanup();
        return;
      }
      if (opts.signal) {
        abortHandler = () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          void cleanup();
        };
        opts.signal.addEventListener("abort", abortHandler, { once: true });
      }
      if (opts.keepAliveMs && opts.keepAliveMs > 0) {
        keepAliveTimer = setInterval(() => {
          try {
            if ((controller.desiredSize ?? 0) > 0) {
              controller.enqueue(TEXT_ENCODER.encode(": keep-alive\n\n"));
            }
          } catch {
            /* stream closed — interval will be cleared on cancel */
          }
        }, opts.keepAliveMs);
      }
    },
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          await cleanup();
          return;
        }
        controller.enqueue(encodeSSE(value));
      } catch (err) {
        controller.error(err);
        await cleanup(err);
      }
    },
    async cancel(reason) {
      await cleanup(reason);
    },
  });
}

/**
 * Wrap `sseStream` in a `Response` with the proper SSE headers
 * (`text/event-stream`, no caching, keep-alive). Caller-supplied headers win.
 */
export function sseResponse(
  source: IterableSource<SSEMessage | string>,
  opts: SSEResponseOptions = {}
): Response {
  const stream = sseStream(source, opts);
  const headers = new Headers(opts.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/event-stream; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache, no-transform");
  if (!headers.has("connection")) headers.set("connection", "keep-alive");
  // Disable proxy buffering (nginx).
  if (!headers.has("x-accel-buffering")) headers.set("x-accel-buffering", "no");
  return new Response(stream, { status: opts.status ?? 200, headers });
}

/**
 * Build a backpressure-safe `ReadableStream` of NDJSON (newline-delimited
 * JSON) records from an async iterable. Each yielded value is encoded with
 * `JSON.stringify` and terminated with `\n`. Values that stringify to
 * `undefined` throw because they cannot be represented as valid NDJSON.
 */
export function ndjsonStream<T>(
  source: IterableSource<T>,
  opts: StreamOptions = {}
): ReadableStream<Uint8Array> {
  const iterator = getAsyncIterator<T>(source);
  let abortHandler: (() => void) | undefined;

  const cleanup = async (cancelValue?: unknown) => {
    if (opts.signal && abortHandler) {
      opts.signal.removeEventListener("abort", abortHandler);
      abortHandler = undefined;
    }
    if (typeof iterator.return === "function") {
      try {
        await iterator.return(cancelValue);
      } catch {
        /* swallow */
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.signal?.aborted) {
        controller.close();
        void cleanup();
        return;
      }
      if (opts.signal) {
        abortHandler = () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          void cleanup();
        };
        opts.signal.addEventListener("abort", abortHandler, { once: true });
      }
    },
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          await cleanup();
          return;
        }
        controller.enqueue(encodeNDJSON(value));
      } catch (err) {
        controller.error(err);
        await cleanup(err);
      }
    },
    async cancel(reason) {
      await cleanup(reason);
    },
  });
}

/**
 * Wrap `ndjsonStream` in a `Response` with `application/x-ndjson` and
 * cache-busting headers. Caller-supplied headers win.
 */
export function ndjsonResponse<T>(
  source: IterableSource<T>,
  opts: NDJSONResponseOptions = {}
): Response {
  const stream = ndjsonStream<T>(source, opts);
  const headers = new Headers(opts.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/x-ndjson; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache, no-transform");
  if (!headers.has("x-accel-buffering")) headers.set("x-accel-buffering", "no");
  return new Response(stream, { status: opts.status ?? 200, headers });
}
