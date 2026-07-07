/**
 * WebSocket demo — DaloyJS dependency-free RFC 6455 server (Node adapter).
 *
 * An echo server that also broadcasts a live connection count, demonstrating
 * the open / message / close lifecycle and conn.send / conn.ping. The Node
 * adapter implements the WebSocket protocol from scratch (no `ws` package).
 *
 * Run:  node --import tsx examples/websocket-demo.ts
 * Then connect a client (Node 24+ has a global WebSocket):
 *
 *   const ws = new WebSocket("ws://localhost:3004/ws");
 *   ws.onmessage = (e) => console.log(e.data);
 *   ws.onopen = () => ws.send("hello");
 */

import { serve } from "../src/adapters/node.ts";
import { App } from "../src/index.ts";
import { printStartupBanner, type StartupBannerLink } from "../src/banner.ts";

const app = new App({
  env: "development",
  // Auto-mount the AsyncAPI surface for the WS channels below: GET /asyncapi
  // (interactive UI), /asyncapi.json, /asyncapi.yaml — the WebSocket
  // counterpart to `docs: true` (Scalar/Swagger) for OpenAPI.
  asyncapi: true,
  openapi: { info: { title: "DaloyJS WebSocket Demo", version: "1.0.0" } },
});

const clients = new Set<{ send(data: string): void }>();

app.ws("/ws", {
  // Production-recommended posture (also fine in dev): same-origin only.
  // A non-browser client (no Origin header) is allowed through.
  allowedOrigins: "same-origin",
  acknowledgeUnauthenticated: true,
  meta: {
    summary: "Echo channel",
    description: "Echoes any text/binary message; reply to \"ping\" with a PING.",
  },

  open(conn) {
    clients.add(conn);
    conn.send(JSON.stringify({ type: "welcome", clients: clients.size }));
    console.log(`[ws] open — ${clients.size} client(s)`);
  },

  message(conn, data, isBinary) {
    if (isBinary) {
      // Echo binary frames back unchanged.
      conn.send(data as Uint8Array as unknown as ArrayBufferLike);
      return;
    }
    const text = String(data);
    if (text === "ping") {
      conn.ping();
      return;
    }
    conn.send(JSON.stringify({ type: "echo", message: text }));
  },

  close(conn, code, reason) {
    clients.delete(conn as { send(data: string): void });
    console.log(`[ws] close — code ${code}${reason ? ` (${reason})` : ""}, ${clients.size} left`);
  },

  error(_conn, err) {
    console.error("[ws] error:", err);
  },
});

const PORT = 3004;
const { port } = serve(app, { port: PORT });
const base = `http://localhost:${port}`;

// Like the Scalar/Swagger docs link in the scaffolded templates, surface the
// AsyncAPI UI URL in the startup banner so it shows up in the terminal.
const links: StartupBannerLink[] = [
  { label: "WebSocket", url: `ws://localhost:${port}/ws` },
  { label: "AsyncAPI UI", url: `${base}/asyncapi` },
  { label: "AsyncAPI JSON", url: `${base}/asyncapi.json` },
];
printStartupBanner({ name: "DaloyJS WebSocket Demo", url: base, runtime: "Node.js", links });
console.log(`Send "ping" to get a protocol PING; any other text echoes back.`);
