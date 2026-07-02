import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Streaming responses (SSE & NDJSON)",
  description:
    "Build backpressure-safe Server-Sent Events and newline-delimited JSON streams in DaloyJS. Honor AbortSignal, release iterators on disconnect, and reuse the same handler across Node, Bun, Deno, Cloudflare Workers, and Vercel.",
  path: "/docs/streaming",
  keywords: [
    "Server-Sent Events",
    "SSE",
    "NDJSON",
    "streaming response",
    "ReadableStream",
    "AbortSignal",
    "DaloyJS streaming",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Streaming responses</h1>
      <p>
        DaloyJS ships first-class helpers for two streaming formats that are
        common in HTTP APIs: <strong>Server-Sent Events (SSE)</strong> and
        <strong> newline-delimited JSON (NDJSON)</strong>. Both helpers wrap an
        <code>AsyncIterable</code> in a backpressure-safe{" "}
        <code>ReadableStream</code>: the underlying iterator is only advanced
        when the consumer pulls the next chunk, so a slow client cannot cause
        unbounded memory growth.
      </p>
      <p>
        They also honor an optional <code>AbortSignal</code> and call{" "}
        <code>iterator.return()</code> when the client disconnects, so any
        caller-owned resources (DB cursors, upstream fetches, message-queue
        subscriptions) get released cleanly.
      </p>

      <SequenceDiagram
        title="A pull-driven stream"
        participants={["Async generator", "DaloyJS helper", "Client"]}
        steps={[
          {
            from: "Client",
            to: "DaloyJS helper",
            label: "Pull the next chunk",
            detail: "ReadableStream pull(), one per consumer read",
            kind: "request",
          },
          {
            from: "DaloyJS helper",
            to: "Async generator",
            label: "Advance the iterator",
            detail: "iterator.next() called exactly once per pull",
            kind: "request",
          },
          {
            from: "DaloyJS helper",
            to: "Client",
            label: "Encode and send one frame",
            detail: "SSE data: ... or one NDJSON line + \\n",
            kind: "response",
          },
          {
            from: "DaloyJS helper",
            to: "Client",
            label: "Optional keep-alive comment while idle",
            detail: ": keep-alive every keepAliveMs",
            kind: "async",
          },
          {
            from: "Client",
            to: "DaloyJS helper",
            label: "Disconnect or abort",
            detail: "request.signal fires, iterator.return() runs finally",
            kind: "note",
          },
        ]}
        caption="The consumer drives the pace. A slow client pulls slowly, so the generator is only advanced when there is demand, then iterator.return() releases resources on disconnect."
      />

      <p>
        The helpers live in the main barrel and in the <code>/streaming</code>{" "}
        subpath:
      </p>
      <CodeBlock
        code={`import {
  sseStream,
  sseResponse,
  ndjsonStream,
  ndjsonResponse,
} from "@daloyjs/core";

// Or, if you want a tree-shake-friendly subpath:
import { sseStream } from "@daloyjs/core/streaming";`}
      />

      <h2 id="server-sent-events-sse">Server-Sent Events (SSE)</h2>
      <p>
        Yield either a string (sent as <code>data: …</code>) or an{" "}
        <code>SSEMessage</code> object with any combination of{" "}
        <code>event</code>, <code>id</code>, <code>retry</code>,{" "}
        <code>comment</code>, and <code>data</code>. Multi-line strings are
        split into one <code>data:</code> line per source line, and CR/LF in
        <code> event</code> / <code>id</code> values are sanitized.
      </p>
      <CodeBlock
        code={`import { sseStream } from "@daloyjs/core";

app.route({
  method: "GET",
  path: "/events",
  operationId: "events",
  responses: { 200: { description: "SSE stream" } },
  handler: ({ request }) => ({
    status: 200 as const,
    headers: { "content-type": "text/event-stream" },
    body: sseStream(
      async function* () {
        for (let i = 0; i < 5; i++) {
          yield { event: "tick", id: String(i), data: { now: Date.now() } };
          await new Promise((r) => setTimeout(r, 1_000));
        }
      },
      { signal: request.signal, keepAliveMs: 15_000 }
    ),
  }),
});`}
      />

      <p>
        Use <code>sseResponse(...)</code> when you want a fully-formed{" "}
        <code>Response</code> with the standard SSE headers (
        <code>text/event-stream</code>,{" "}
        <code>cache-control: no-cache, no-transform</code>,{" "}
        <code>connection: keep-alive</code>, and{" "}
        <code>x-accel-buffering: no</code>) already set:
      </p>
      <CodeBlock
        code={`import { sseResponse } from "@daloyjs/core";

const res = sseResponse(async function* () {
  yield { event: "ping", data: "hi" };
});`}
      />
      <p>
        A handler may also <strong>return a raw <code>Response</code></strong>{" "}
        directly, instead of the <code>{"{ status, body, headers }"}</code>{" "}
        shape. It bypasses response-schema validation (there is no schema for an
        opaque stream) but is still finalized like any other response: the
        request id, <code>secureHeaders()</code>, CORS, your <code>onSend</code>{" "}
        hooks, and fingerprint stripping all still apply. This is what lets you
        forward a stream from a library such as the{" "}
        <a href="/docs/ai-sdk">Vercel AI SDK</a> in one line:
      </p>
      <CodeBlock
        code={`app.route({
  method: "GET",
  path: "/ping",
  operationId: "ping",
  responses: { 200: { description: "SSE stream" } },
  // Return the Response as-is. Useful for AI SDK streams or a
  // forwarded upstream fetch() response.
  handler: () => sseResponse(async function* () {
    yield { event: "ping", data: "hi" };
  }),
});`}
      />

      <h3 id="keep-alive-comments">Keep-alive comments</h3>
      <p>
        Pass <code>keepAliveMs</code> to send a <code>: keep-alive</code>{" "}
        comment frame at a fixed interval. This prevents idle proxies from
        closing the connection while no events are flowing.
      </p>

      <h2 id="newline-delimited-json-ndjson">Newline-delimited JSON (NDJSON)</h2>
      <p>
        Yield any JSON-serializable value; each value is encoded with{" "}
        <code>JSON.stringify</code> and terminated with a single <code>\n</code>
        . Strings are emitted as JSON strings, and values that cannot be
        represented as JSON throw instead of emitting invalid NDJSON.
      </p>
      <CodeBlock
        code={`import { ndjsonStream } from "@daloyjs/core";

app.route({
  method: "GET",
  path: "/exports/users.ndjson",
  operationId: "exportUsers",
  responses: { 200: { description: "NDJSON dump" } },
  handler: ({ request }) => ({
    status: 200 as const,
    headers: { "content-type": "application/x-ndjson" },
    body: ndjsonStream(
      (async function* () {
        for await (const user of db.users.cursor()) {
          yield user;
        }
      })(),
      { signal: request.signal }
    ),
  }),
});`}
      />

      <p>
        <code>ndjsonResponse(...)</code> builds the same stream with{" "}
        <code>application/x-ndjson</code> headers pre-set.
      </p>

      <h2 id="backpressure-and-cancellation">Backpressure & cancellation</h2>
      <p>
        Both helpers use the <code>pull()</code> entry point of{" "}
        <code>ReadableStream</code>: they call <code>iterator.next()</code>{" "}
        exactly once per pull. The runtime decides when to pull: a slow client
        on a Node socket pulls slowly, a fast Cloudflare consumer pulls quickly.
        You never need to write throttling code.
      </p>
      <p>
        When the request is aborted (client disconnects, request timeout fires,
        explicit <code>AbortController.abort()</code>), the stream is closed and{" "}
        <code>iterator.return()</code> is invoked so a generator&apos;s{" "}
        <code>finally</code> block runs and any underlying cursor/socket is
        released.
      </p>

      <h2 id="cross-runtime-compatibility">Cross-runtime compatibility</h2>
      <p>
        The helpers only depend on web-standard <code>ReadableStream</code> and{" "}
        <code>TextEncoder</code>, so the same handler works identically on Node,
        Bun, Deno, Cloudflare Workers, and Vercel. The DaloyJS response
        serializer recognizes a <code>ReadableStream</code> body when you set an
        explicit non-JSON <code>content-type</code> and forwards it to the
        runtime without buffering.
      </p>

      <h2 id="openapi">OpenAPI</h2>
      <p>
        OpenAPI 3.1 has no rich schema for streamed event payloads. Document
        streaming routes with a free-form <code>200</code> response (just{" "}
        <code>{`{ description }`}</code>) and describe the event shape in prose,
        or attach an example string showing one or two frames.
      </p>
    </>
  );
}
