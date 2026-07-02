import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "AsyncAPI for WebSockets",
  description:
    "Generate AsyncAPI 3.0 contract documents for your DaloyJS app.ws() surfaces with the built-in, dependency-free generateAsyncAPI() generator, plus an auto-mounted interactive AsyncAPI UI (asyncapi: true) that mirrors the Scalar/Swagger OpenAPI docs, a handler meta block, and the daloy inspect --asyncapi CLI flag.",
  path: "/docs/asyncapi",
  keywords: [
    "AsyncAPI",
    "AsyncAPI 3.0",
    "WebSocket contract",
    "generateAsyncAPI",
    "asyncapiToYAML",
    "DaloyJS asyncapi",
    "WebSocket documentation",
    "real-time contract",
    "daloy inspect --asyncapi",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>AsyncAPI for WebSockets</h1>
      <p>
        DaloyJS already turns every HTTP route into an OpenAPI 3.1 operation.
        The same contract-first story extends to your real-time surfaces: the{" "}
        <code>@daloyjs/core/asyncapi</code> module emits a standards-compliant{" "}
        <strong>AsyncAPI 3.0</strong> document for the WebSocket routes you
        register with <code>app.ws()</code>. It is{" "}
        <strong>built-in and dependency-free</strong>, the same posture as the
        OpenAPI generator, so it adds nothing to your runtime footprint.
      </p>
      <p>
        Each <code>app.ws()</code> route becomes one AsyncAPI{" "}
        <strong>channel</strong> (the socket address plus any path parameters)
        and one or more <strong>operations</strong>:
      </p>
      <ul>
        <li>
          a <code>receive</code> operation for messages the server receives from
          clients (always emitted, because clients can send messages after the
          upgrade), and
        </li>
        <li>
          an optional <code>send</code> operation for messages the server pushes
          to clients (emitted only when you declare an outbound schema).
        </li>
      </ul>

      <FlowDiagram
        title="From socket route to AsyncAPI"
        numbered
        caption="The same contract-first flow as OpenAPI: each app.ws() route becomes one channel with a receive operation plus an optional send operation. The generator is read-only, it never mounts a route or changes your socket's security posture."
        steps={[
          {
            label: 'app.ws("/chat/:room")',
            detail: "+ optional meta block",
            tone: "accent",
          },
          {
            label: "generateAsyncAPI(app)",
            detail: "built-in, dependency-free",
          },
          { label: "AsyncAPI 3.0 document", detail: "channels + operations" },
          {
            label: "receive / send ops",
            detail: "receive always, send when declared",
          },
          {
            label: "UI / YAML / codegen",
            detail: "GET /asyncapi, asyncapiToYAML, CLI",
            tone: "success",
          },
        ]}
      />

      <h2 id="quick-start">Quick start</h2>
      <p>
        Call <code>generateAsyncAPI(app, options)</code> and you get a plain,
        JSON-serializable AsyncAPI document. Hand it to AsyncAPI Studio, write
        it to disk for codegen, or serve it from a route.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { generateAsyncAPI } from "@daloyjs/core/asyncapi";
import { writeFileSync } from "node:fs";

const app = new App();

app.ws("/chat/:room", {
  allowedOrigins: "same-origin",
  open(conn, ctx) {
    conn.data = { room: ctx.params.room };
  },
  message(conn, data) {
    conn.send(typeof data === "string" ? data.toUpperCase() : data);
  },
});

const doc = generateAsyncAPI(app, {
  info: { title: "Realtime API", version: "1.0.0" },
  servers: { production: { host: "api.example.com", protocol: "wss" } },
});

writeFileSync("./generated/asyncapi.json", JSON.stringify(doc, null, 2));`}
      />

      <h2 id="serving-an-interactive-ui">Serving an interactive UI</h2>
      <p>
        You don&apos;t have to wire the spec up yourself. Set{" "}
        <code>asyncapi: true</code> on the app and DaloyJS auto-mounts the
        AsyncAPI surface, the WebSocket counterpart to <code>docs: true</code>{" "}
        for OpenAPI (Scalar / Swagger / Redoc):
      </p>
      <ul>
        <li>
          <code>GET /asyncapi</code>: an <strong>interactive UI</strong> that
          renders the official AsyncAPI React component, loaded from a CDN via a{" "}
          <code>&lt;script&gt;</code> tag exactly like the OpenAPI viewers (no
          build step, no extra runtime dependency).
        </li>
        <li>
          <code>GET /asyncapi.json</code> and <code>GET /asyncapi.yaml</code>:
          the AsyncAPI 3.0 document, generated lazily so <code>app.ws()</code>{" "}
          routes registered afterwards are included.
        </li>
      </ul>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App({
  asyncapi: true, // or "auto" (skips production), or an AsyncAPIRouteOptions object
  openapi: { info: { title: "Realtime API", version: "1.0.0" } },
});

app.ws("/chat/:room", {
  allowedOrigins: "same-origin",
  meta: { summary: "Room chat" },
  message(conn, data) {
    conn.send(data);
  },
});

// GET /asyncapi        → interactive AsyncAPI UI
// GET /asyncapi.json   → AsyncAPI 3.0 document
// GET /asyncapi.yaml   → AsyncAPI 3.0 document (YAML)`}
      />
      <p>
        Like the Scalar/Swagger docs link, surface the URL in your startup
        banner so it shows up in the terminal:
      </p>
      <CodeBlock
        code={`import { printStartupBanner } from "@daloyjs/core/banner";

printStartupBanner({
  name: "Realtime API",
  url: \`http://localhost:\${port}\`,
  runtime: "Node.js",
  links: [{ label: "AsyncAPI", url: \`http://localhost:\${port}/asyncapi\` }],
});`}
      />
      <p>
        The UI page ships the same hardened response as the OpenAPI docs: a
        strict Content-Security-Policy that only allows the CDN asset origin
        (jsDelivr by default) plus <code>connect-src &apos;self&apos;</code> so
        the component can fetch the served spec, <code>nosniff</code>, and{" "}
        <code>no-referrer</code>. Pin Subresource Integrity hashes or point at
        self-hosted assets via the <code>assets</code> option (
        <code>asyncapiScriptUrl</code> / <code>asyncapiScriptIntegrity</code> /{" "}
        <code>asyncapiStyleUrl</code> / <code>asyncapiStyleIntegrity</code>) for
        supply-chain hardening, exactly as with the OpenAPI docs UIs. Use{" "}
        <code>asyncapi: &quot;auto&quot;</code> to mount everywhere except
        production.
      </p>
      <p>
        The WebSocket route itself keeps the normal production guardrails. If
        you run with secure defaults in production, each <code>app.ws()</code>{" "}
        route still needs an <code>allowedOrigins</code> policy or an explicit{" "}
        <code>acknowledgeCrossOriginUpgrade: true</code>. AsyncAPI generation is
        descriptive; it never relaxes Cross-Site WebSocket Hijacking defenses.
      </p>

      <h2 id="describing-the-messages">Describing the messages</h2>
      <p>
        WebSocket handlers accept an optional <code>meta</code> block that
        mirrors the HTTP route <code>meta</code>. It is purely descriptive (it
        never changes the RFC 6455 handshake or runtime behavior), and the
        AsyncAPI generator reads it to fill in summaries, tags, and message
        payloads.
      </p>
      <ul>
        <li>
          <code>summary</code> / <code>description</code> / <code>tags</code>:
          surfaced on the generated channel and operations.
        </li>
        <li>
          <code>receive</code>: a Standard Schema describing messages the server
          receives from clients. Falls back to the handler&apos;s{" "}
          <code>request.body</code> schema (the same schema used for
          payload-size checks).
        </li>
        <li>
          <code>send</code>: a Standard Schema describing messages the server
          sends to clients. Adds a <code>send</code> operation when present.
        </li>
        <li>
          <code>operationId</code>: overrides the channel key that is otherwise
          derived from the path.
        </li>
      </ul>
      <CodeBlock
        code={`import { z } from "zod";

const ClientMessage = z.object({ text: z.string() });
const ServerMessage = z.object({ user: z.string(), text: z.string() });

app.ws("/chat/:room", {
  allowedOrigins: "same-origin",
  request: { body: ClientMessage },
  meta: {
    summary: "Room chat",
    description: "Bidirectional chat scoped to a room.",
    tags: ["chat"],
    send: ServerMessage,
  },
  open() {},
  message() {},
});`}
      />
      <p>
        Schemas that expose a <code>toJSONSchema()</code> method are converted
        to JSON Schema for the message payload. Zod 4 schemas expose that method
        directly; other validators may need the same adapter they use for
        OpenAPI output. Anything else still validates at runtime, but the
        generated AsyncAPI payload falls back to a permissive{" "}
        <code>{`{}`}</code> placeholder rather than throwing.
      </p>

      <h2 id="generated-document-shape">Generated document shape</h2>
      <p>
        A single <code>app.ws(&quot;/chat/:room&quot;, ...)</code> route with
        the <code>meta</code> above produces roughly:
      </p>
      <CodeBlock
        code={`{
  "asyncapi": "3.0.0",
  "info": { "title": "Realtime API", "version": "1.0.0" },
  "servers": { "production": { "host": "api.example.com", "protocol": "wss" } },
  "channels": {
    "chatRoom": {
      "address": "/chat/{room}",
      "summary": "Room chat",
      "parameters": { "room": { "description": "Path parameter \`room\`." } },
      "messages": {
        "receiveMessage": { "$ref": "#/components/messages/chatRoomReceive" },
        "sendMessage": { "$ref": "#/components/messages/chatRoomSend" }
      }
    }
  },
  "operations": {
    "chatRoomReceive": {
      "action": "receive",
      "channel": { "$ref": "#/channels/chatRoom" },
      "messages": [{ "$ref": "#/channels/chatRoom/messages/receiveMessage" }]
    },
    "chatRoomSend": {
      "action": "send",
      "channel": { "$ref": "#/channels/chatRoom" },
      "messages": [{ "$ref": "#/channels/chatRoom/messages/sendMessage" }]
    }
  },
  "components": { "messages": { /* ... payloads ... */ } }
}`}
      />

      <h2 id="yaml-output">YAML output</h2>
      <p>
        <code>asyncapiToYAML(doc)</code> renders the document as YAML 1.2 using
        the same dependency-free emitter shared with the OpenAPI generator.
      </p>
      <CodeBlock
        code={`import { generateAsyncAPI, asyncapiToYAML } from "@daloyjs/core/asyncapi";

const yaml = asyncapiToYAML(generateAsyncAPI(app, {
  info: { title: "Realtime API", version: "1.0.0" },
}));`}
      />

      <h2 id="cli">CLI</h2>
      <p>
        The <code>daloy inspect</code> command can print the AsyncAPI document
        for any app it can load, mirroring <code>--openapi</code>. Use{" "}
        <code>--format yaml</code> (or <code>--yaml</code>) for YAML output.
      </p>
      <CodeBlock
        language="bash"
        code={`daloy inspect --asyncapi > asyncapi.json
daloy inspect --asyncapi --format yaml > asyncapi.yaml`}
      />

      <h2 id="notes">Notes</h2>
      <ul>
        <li>
          When the app has no WebSocket routes the document still validates,
          with empty <code>channels</code> and <code>operations</code> maps.
        </li>
        <li>
          Channel keys are derived from the path (<code>/chat/:room/feed</code>{" "}
          → <code>chatRoomFeed</code>); collisions are de-duplicated with a
          numeric suffix. Set <code>meta.operationId</code> for a stable,
          explicit key.
        </li>
        <li>
          The generator is read-only: it never mounts a route or changes your
          socket&apos;s security posture. See the{" "}
          <a href="/docs/websocket">WebSocket primitives</a> page for the CSWSH
          refuse-to-boot guards.
        </li>
      </ul>
    </>
  );
}
