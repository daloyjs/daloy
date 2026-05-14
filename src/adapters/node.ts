/**
 * Node adapter: translates IncomingMessage/ServerResponse to web-standard
 * Request/Response. Includes graceful shutdown wired to SIGTERM/SIGINT.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { Readable } from "node:stream";
import type { App } from "../app.js";

export interface NodeServerOptions {
  port?: number;
  hostname?: string;
  /** Connection-level timeout in ms. Default: 30000. */
  connectionTimeoutMs?: number;
  /** Drain timeout for graceful shutdown. Default: 10000. */
  shutdownTimeoutMs?: number;
  /** Listen for SIGTERM/SIGINT and shut down. Default: true. */
  handleSignals?: boolean;
  /** Maximum HTTP header size bytes (DoS protection). Default: 16 KiB. */
  maxHeaderBytes?: number;
}

export interface NodeServerHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export function serve(app: App, opts: NodeServerOptions = {}): NodeServerHandle {
  const server = createServer({ maxHeaderSize: opts.maxHeaderBytes ?? 16 * 1024 }, async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const response = await app.fetch(request);
      await sendWebResponse(response, res);
    } catch (e) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/problem+json");
        res.end(
          JSON.stringify({
            type: "https://daloyjs.dev/errors/internal",
            title: "Internal Server Error",
            status: 500,
          })
        );
      } else {
        res.destroy(e as Error);
      }
    }
  });

  server.requestTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.headersTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.keepAliveTimeout = 5_000;

  const port = opts.port ?? 3000;
  const hostname = opts.hostname ?? "0.0.0.0";
  server.listen(port, hostname);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  };

  if (opts.handleSignals !== false) {
    const onSignal = (sig: string) => {
      app.log.info({ sig }, "DaloyJS received signal, shutting down");
      void close().then(() => process.exit(0));
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }

  return { server, port, close };
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) headers.set(k, v.join(", "));
    else headers.set(k, String(v));
  }
  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    (init as any).body = Readable.toWeb(req) as ReadableStream;
    (init as any).duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(res: Response, out: ServerResponse): Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  if (!res.body) {
    out.end();
    return;
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.write(value);
  }
  out.end();
}
