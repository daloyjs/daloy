import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "WebSocket primitives (Node & Bun)",
  description:
    "Register typed WebSocket routes in DaloyJS with the same Bun-style handler shape running on both Node and Bun adapters, safe defaults, upgrade rate limiting, and graceful close semantics.",
  path: "/docs/websocket",
  keywords: [
    "WebSocket",
    "RFC 6455",
    "real-time",
    "Bun WebSocket",
    "Node WebSocket",
    "DaloyJS websocket",
    "wsRateLimit",
    "maxPayloadLength",
    "perMessageDeflate",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>WebSocket primitives</h1>
      <p>
        DaloyJS ships runtime-agnostic WebSocket primitives in{" "}
        <code>src/websocket.ts</code> (re-exported from{" "}
        <code>@daloyjs/core/websocket</code>) plus adapter wiring for{" "}
        <code>@daloyjs/core/node</code> and <code>@daloyjs/core/bun</code>
        {". "}Both adapters accept the <strong>same handler shape</strong>
        {": "}the Bun-style
        <code>open</code> / <code>message</code> / <code>close</code> /{" "}
        <code>drain</code> / <code>error</code> callbacks, so the same{" "}
        <code>app.ws(path, handler)</code> registration works on either runtime
        without changes.
      </p>
      <p>
        On Node the adapter only installs an <code>upgrade</code> listener when
        at least one WS route is registered, so apps that don&apos;t use
        WebSockets pay zero overhead. On Bun the adapter forwards to{" "}
        <code>Bun.serve</code>&apos;s native <code>websocket</code> config.
      </p>
      <p>
        <code>app.ws()</code> also normalizes safe runtime defaults:{" "}
        <code>closeOnBackpressureLimit: true</code>
        {", "}a 1 MiB <code>backpressureLimit</code>
        {", "}
        <code>perMessageDeflate: false</code>
        {", "}a non-zero <code>idleTimeout</code>
        {", "}and a 1 MiB <code>maxPayloadLength</code>
        {". "}Production apps running with <code>secureDefaults</code> refuse{" "}
        <code>perMessageDeflate: true</code>.
      </p>
      <p>
        Production routes also require an Origin policy with{" "}
        <code>allowedOrigins</code> or an explicit{" "}
        <code>acknowledgeCrossOriginUpgrade: true</code>
        {". "}This closes the Cross-Site WebSocket Hijacking pattern behind
        Storybook&apos;s CVE-2026-27148: browsers attach cookies to WS
        handshakes, even when another site opened the socket.
      </p>

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App();

app.ws("/chat/:room", {
  open(conn, ctx) {
    conn.data = { user: ctx.query.user ?? "anon", room: ctx.params.room };
    conn.send(\`welcome \${(conn.data as { user: string }).user}\`);
  },
  message(conn, data, isBinary) {
    // Echo back, upper-cased for text frames
    conn.send(typeof data === "string" ? data.toUpperCase() : data, { binary: isBinary });
  },
  close(conn, code, reason) {
    // release any per-connection resources here
  },
});

serve(app, { port: 3000 });`}
      />

      <h2 id="handler-shape">Handler shape</h2>
      <p>
        Use <code>defineWebSocket()</code> for full type-inference on path
        params (<code>ctx.params</code>), query (<code>ctx.query</code>), and
        per-connection state (<code>conn.data</code>):
      </p>
      <CodeBlock
        code={`import { defineWebSocket } from "@daloyjs/core";

const chatHandler = defineWebSocket({
  open(conn, ctx) {
    // ctx.params is typed from the path pattern "/chat/:room"
    conn.data = { room: ctx.params.room, joinedAt: Date.now() };
  },
  message(conn, data) {
    conn.send(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  },
  close(conn, code, reason) {
    // cleanup
  },
  error(conn, err) {
    // user error handler - does not affect close code
  },
  drain(conn) {
    // backpressure released
  },
});

app.ws("/chat/:room", chatHandler);`}
      />

      <h2 id="connection-api">Connection API</h2>
      <p>
        The <code>WebSocketConnection</code> passed to your handlers mirrors the
        WHATWG <code>WebSocket</code> interface where it makes sense on the
        server side:
      </p>
      <ul>
        <li>
          <code>conn.readyState</code>
          {": "}one of{" "}
          <code>WS_READY_STATE.CONNECTING / OPEN / CLOSING / CLOSED</code>.
        </li>
        <li>
          <code>conn.send(data, options?)</code>
          {": "}send a text frame for <code>string</code>
          {", "}or a binary frame for <code>Uint8Array</code> /{" "}
          <code>ArrayBuffer</code>
          {". "}Pass <code>{`{ binary: true }`}</code> to force binary framing
          of a string.
        </li>
        <li>
          <code>conn.ping(data?)</code> / <code>conn.pong(data?)</code>
          {": "}control frames; payload must be ≤ 125 bytes per RFC 6455.
        </li>
        <li>
          <code>conn.close(code?, reason?)</code>
          {": "}graceful close (sends a CLOSE frame, fires your{" "}
          <code>close</code> handler, then closes the underlying socket).
        </li>
        <li>
          <code>conn.terminate()</code>
          {": "}immediate transport-level close, no CLOSE frame.
        </li>
        <li>
          <code>conn.bufferedAmount</code>
          {", "}
          <code>conn.protocol</code>
          {", "}
          <code>conn.extensions</code>
          {", "}
          <code>conn.binaryType</code>.
        </li>
        <li>
          <code>conn.data</code>
          {": "}opaque per-connection slot for your app state.
        </li>
      </ul>

      <h2 id="protocol-negotiation-and-upgrade-hook">
        Protocol negotiation & upgrade hook
      </h2>
      <p>
        Optional <code>beforeUpgrade(req, ctx)</code> runs after the path match
        and Origin policy, but before the 101 response. Return a{" "}
        <code>Response</code> to reject (handy for auth or rate-limiting), or
        return a <code>string</code> to pick a subprotocol from{" "}
        <code>Sec-WebSocket-Protocol</code>
        {": "}
      </p>

      <SequenceDiagram
        title="Upgrade, message, close"
        participants={["Client", "DaloyJS adapter", "Your handler"]}
        steps={[
          {
            from: "Client",
            to: "DaloyJS adapter",
            label: "GET with Upgrade: websocket",
            detail: "Origin policy checked first, then beforeUpgrade",
            kind: "request",
          },
          {
            from: "DaloyJS adapter",
            to: "Client",
            label: "101 Switching Protocols (or a rejection Response)",
            detail: "Sec-WebSocket-Accept, optional negotiated subprotocol",
            kind: "response",
          },
          {
            from: "DaloyJS adapter",
            to: "Your handler",
            label: "open(conn, ctx)",
            detail: "set conn.data, send a welcome frame",
            kind: "async",
          },
          {
            from: "Client",
            to: "Your handler",
            label: "message(conn, data, isBinary)",
            detail: "text or binary frames, capped by maxPayloadLength",
            kind: "async",
          },
          {
            from: "Client",
            to: "Your handler",
            label: "close(conn, code, reason)",
            detail: "CLOSE frame, then the socket is torn down",
            kind: "note",
          },
        ]}
        caption="The adapter runs the Origin policy and beforeUpgrade hook before replying 101. After the upgrade your open, message, and close callbacks run with the same shape on both Node and Bun."
      />

      <CodeBlock
        code={`app.ws("/api", {
  allowedOrigins: "same-origin",
  beforeUpgrade(req, ctx) {
    const token = ctx.headers["authorization"]?.replace(/^Bearer /, "");
    if (!token || !isValid(token)) {
      return new Response("unauthorized", { status: 401 });
    }
    // Pick a subprotocol the client offered
    const offered = (ctx.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
    return offered.includes("daloy.v1") ? "daloy.v1" : undefined;
  },
  open(conn) {
    conn.send("ready");
  },
  message(conn, data) {
    conn.send(data);
  },
});`}
      />

      <h2 id="origin-policy-and-cswsh">Origin policy and CSWSH</h2>
      <p>
        <code>allowedOrigins</code> is checked before <code>beforeUpgrade</code>{" "}
        in both Node and Bun. Use <code>&quot;same-origin&quot;</code> for
        browser clients served from the same scheme, host, and port as the WS
        endpoint, use an array for explicit cross-origin browser clients, or use
        a predicate when machine clients must also send an <code>Origin</code>{" "}
        header.
      </p>
      <CodeBlock
        code={`app.ws("/session", {
  allowedOrigins: "same-origin",
  beforeUpgrade(req, ctx) {
    const session = readSession(ctx.headers.cookie);
    if (!session) return new Response("unauthorized", { status: 401 });
  },
  open(conn) {
    conn.send("ready");
  },
});

app.ws("/partner-feed", {
  allowedOrigins: ["https://partner.example.com"],
  beforeUpgrade(req) {
    return verifyPartner(req) ? undefined : new Response("forbidden", { status: 403 });
  },
  message(conn, data) {
    conn.send(data);
  },
});

app.ws("/cli", {
  allowedOrigins: (origin) => origin !== null && origin === "https://admin.example.com",
  beforeUpgrade(req) {
    return verifyBearerToken(req) ? undefined : new Response("unauthorized", { status: 401 });
  },
  open(conn) {
    conn.send("ready");
  },
});`}
        language="ts"
      />
      <p>
        Missing <code>Origin</code> is allowed by the{" "}
        <code>&quot;same-origin&quot;</code>
        and array policies because browsers send <code>Origin</code> on WS
        handshakes; no <code>Origin</code> usually means a CLI or
        server-to-server client. Use the predicate form when your route should
        reject clients that omit the header.
      </p>

      <h2 id="upgrade-rate-limiting">Upgrade rate limiting</h2>
      <p>
        Use <code>wsRateLimit()</code> in <code>beforeUpgrade</code> when a
        WebSocket route belongs to the same login or session-establishment
        surface as HTTP endpoints. It spends from the same{" "}
        <code>rateLimit({`{ groupId }`})</code> bucket and preserves rate-limit
        headers on rejection.
      </p>
      <CodeBlock
        code={`import { wsRateLimit } from "@daloyjs/core";

app.ws("/session", {
  beforeUpgrade: wsRateLimit({
    windowMs: 60_000,
    max: 10,
    groupId: "auth-entry",
    keyGenerator: (ctx) => ctx.request.headers.get("x-user-key") ?? "global",
  }),
  open(conn) {
    conn.send("ready");
  },
});`}
        language="ts"
      />

      <h2 id="payload-and-backpressure-limits">
        Payload and backpressure limits
      </h2>
      <p>
        Override safe defaults per route when a connection needs tighter bounds.{" "}
        <code>idleTimeout</code>
        {", "}
        <code>backpressureLimit</code>
        {", "}and <code>maxPayloadLength</code> must be positive integers. If
        your WebSocket handler declares a body schema with a maximum size, Daloy
        refuses a larger <code>maxPayloadLength</code> at registration time.
      </p>
      <CodeBlock
        code={`app.ws("/events", {
  idleTimeout: 120,
  maxPayloadLength: 64 * 1024,
  closeOnBackpressureLimit: true,
  backpressureLimit: 1 * 1024 * 1024,
  perMessageDeflate: false,
  message(conn, data) {
    conn.send(data);
  },
});`}
        language="ts"
      />

      <h2 id="graceful-shutdown">Graceful shutdown</h2>
      <p>
        The Node adapter tracks every upgraded socket. When <code>close()</code>{" "}
        is invoked (or the app receives <code>SIGTERM</code> /{" "}
        <code>SIGINT</code> with <code>handleSignals: true</code>), all active
        WebSocket sockets are destroyed before <code>server.close()</code>{" "}
        resolves so the process exits promptly even if clients linger.
      </p>

      <h2 id="custom-adapters">Custom adapters</h2>
      <p>
        If you target a runtime other than Node or Bun, import the primitives
        directly from <code>@daloyjs/core/websocket</code>
        {": "}
      </p>
      <CodeBlock
        code={`import {
  validateUpgrade,
  computeAcceptKey,
  FrameSink,
  encodeFrame,
  encodeSendPayload,
  encodeClosePayload,
  WS_OPCODE,
  WS_CLOSE_CODE,
  WS_READY_STATE,
} from "@daloyjs/core/websocket";`}
      />
      <p>
        <code>FrameSink</code> is a streaming RFC 6455 parser: feed it bytes via{" "}
        <code>sink.push(chunk)</code> and it dispatches <code>onMessage</code>{" "}
        (with reassembled payload + <code>isBinary</code> flag),{" "}
        <code>onPing</code>
        {", "}
        <code>onPong</code>
        {", "}
        <code>onClose</code>
        {", "}and <code>onProtocolError</code>
        {". "}UTF-8 validation on text frames is handled for you.
      </p>
    </>
  );
}
