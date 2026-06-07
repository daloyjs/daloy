/**
 * Node adapter: translates IncomingMessage/ServerResponse to web-standard
 * Request/Response. Includes graceful shutdown wired to SIGTERM/SIGINT.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";
import type { App } from "../app.js";
import { DALOY_RAW_BODY, DALOY_RAW_STREAM, DALOY_REQUEST_RAW_BODY } from "../app.js";
import {
  setClientCertificate,
  normalizePeerCertificate,
  type PeerCertificateLike,
} from "../mtls.js";
import {
  FrameSink,
  encodeFrame,
  encodeClosePayload,
  encodeSendPayload,
  validateUpgrade,
  validateSelectedSubprotocol,
  checkWebSocketOrigin,
  WS_OPCODE,
  WS_CLOSE_CODE,
  WS_READY_STATE,
  WS_MAX_CONTROL_PAYLOAD,
  WebSocketProtocolError,
  WebSocketPayloadTooLargeError,
  type NormalizedWebSocketOptions,
  type WebSocketConnection,
  type WebSocketContext,
  type WebSocketHandler,
} from "../websocket.js";

/** Options for the Node.js {@link serve} entry point. */
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
  /**
   * Maximum number of incoming HTTP header fields, forwarded to Node's
   * `server.maxHeadersCount`. This is the native, parser-level counterpart to
   * the framework's portable {@link "../app.js".AppOptions.maxHeaderCount}
   * guard: a header-count flood is dropped by the HTTP parser before it ever
   * becomes a `Request`, which is the cheapest place to shed header-count
   * amplification (the dimension abused by the "HTTP/2 Bomb"). Node's own
   * default is `2000`; this adapter tightens it to `100` to mirror the
   * application-tier cap. Set `0` to disable (use Node's unbounded default).
   * Default: 100.
   *
   * @since 0.38.0
   */
  maxHeaderCount?: number;
  /**
   * Maximum number of concurrent sockets the server will accept, forwarded to
   * Node's `server.maxConnections`. Acts as connection-layer admission
   * control: once the limit is reached, additional incoming connections are
   * rejected at accept time instead of being queued into the event loop,
   * where they would otherwise inflate tail latency for everyone under
   * overload. Pair it with an upstream load balancer / API gateway that
   * translates the rejection into a `503 Retry-After` for clients. Leave
   * unset for Node's default (unbounded). Default: unset.
   */
  maxConnections?: number;
  /**
   * When true, honor `x-forwarded-proto` and `x-forwarded-host` headers when
   * constructing the request URL. Enable this only when running behind a
   * trusted reverse proxy (e.g. a TLS-terminating load balancer); otherwise
   * clients can spoof the scheme/host. Default: false.
   */
  trustProxy?: boolean;
  /**
   * Maximum declared `Content-Length` (in bytes) for which the Node adapter
   * pre-buffers the request body into a `Uint8Array` before constructing the
   * `Request`. Bodies above this threshold fall back to the streaming
   * `Readable.toWeb(req)` path so the adapter never holds an unbounded buffer
   * per in-flight request — important under high concurrency where N
   * simultaneous large uploads would otherwise pin N × threshold bytes of
   * memory. The threshold is independently capped by `App.bodyLimitBytes`,
   * which is the actual security limit. Default: 256 KiB.
   */
  bufferedBodyMaxBytes?: number;
}

/** Handle returned by {@link serve} exposing the underlying Node `Server` plus a `close()` for graceful shutdown. */
export interface NodeServerHandle { server: Server; port: number; close(): Promise<void>; }

/** Start a Node.js HTTP (and optional WebSocket) server bound to the given {@link App}. */
export function serve(app: App, opts: NodeServerOptions = {}): NodeServerHandle {
  const trustProxy = opts.trustProxy === true;
  const bufferedBodyMaxBytes =
    typeof opts.bufferedBodyMaxBytes === "number" && opts.bufferedBodyMaxBytes >= 0
      ? opts.bufferedBodyMaxBytes
      : DEFAULT_BUFFERED_BODY_MAX_BYTES;
  const server = createServer({ maxHeaderSize: opts.maxHeaderBytes ?? 16 * 1024 }, (req, res) => {
    // GET/HEAD: no body work, dispatch directly. Keep this first so the GET
    // hot path doesn't pay for any of the buffering bookkeeping below.
    const method = req.method;
    if (method === "GET" || method === "HEAD" || method === undefined) {
      dispatchToApp(app, req, res, trustProxy, undefined);
      return;
    }
    // POST/PUT/PATCH/DELETE with a small known content-length: pre-buffer
    // bytes from the Node socket directly so the Request constructor gets a
    // Uint8Array body instead of `Readable.toWeb(req)`. This skips the
    // WHATWG-stream adapter that dominates POST throughput on Node.
    const cl = req.headers["content-length"];
    const n = cl ? Number(cl) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= bufferedBodyMaxBytes) {
      bufferRequestBody(req, n).then(
        (bytes) => dispatchToApp(app, req, res, trustProxy, bytes),
        (e) => writeAdapterError(res, e),
      );
      return;
    }
    dispatchToApp(app, req, res, trustProxy, undefined);
  });

  server.requestTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.headersTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.keepAliveTimeout = 5_000;
  // Native parser-level header-count cap. Drops header-count floods (the
  // "HTTP/2 Bomb" amplification dimension) before they become a Request.
  // `0` opts out and restores Node's unbounded-ish default (2000).
  const maxHeaderCount = opts.maxHeaderCount;
  server.maxHeadersCount =
    typeof maxHeaderCount === "number" && maxHeaderCount >= 0
      ? maxHeaderCount
      : 100;
  // Connection-layer admission control. Reject overflow sockets at accept time
  // rather than queuing them into the event loop under overload.
  if (typeof opts.maxConnections === "number" && opts.maxConnections > 0) {
    server.maxConnections = opts.maxConnections;
  }
  const wsSockets = new Set<Duplex>();
  if (app.webSocketRoutes.size > 0) {
    server.on("upgrade", (req, socket, head) => {
      wsSockets.add(socket as Duplex);
      (socket as Duplex).on("close", () => wsSockets.delete(socket as Duplex));
      void handleUpgrade(app, req, socket as Duplex, head, trustProxy);
    });
  }
  const port = opts.port ?? 3000;
  server.listen(port, opts.hostname ?? "0.0.0.0");
  // Kill idle keep-alive sockets immediately when draining begins.
  // In-flight requests keep their socket because Node's
  // `closeIdleConnections()` is a no-op for sockets with an in-flight request.
  app._registerIdleConnectionCloseHook(() => {
    const s = server as Server & { closeIdleConnections?: () => void };
    if (typeof s.closeIdleConnections === "function") {
      s.closeIdleConnections();
    }
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    for (const sock of wsSockets) sock.destroy();
    wsSockets.clear();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  };
  if (opts.handleSignals !== false) {
    const onSignal = (sig: string) => { app.log.info({ sig }, "DaloyJS received signal, shutting down"); void close().then(() => process.exit(0)); };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }
  return { server, port, close }; }

/**
 * Default pre-buffer ceiling for the Node adapter. 256 KiB is a compromise:
 * large enough that the vast majority of JSON / form requests stay on the
 * fast (Uint8Array) path, small enough that N concurrent in-flight bodies
 * don't pin huge amounts of memory. Override via
 * {@link NodeServerOptions.bufferedBodyMaxBytes}. The actual security cap
 * on body size remains `App.bodyLimitBytes`.
 */
const DEFAULT_BUFFERED_BODY_MAX_BYTES = 256 * 1024;

function dispatchToApp(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  trustProxy: boolean,
  bufferedBody: Uint8Array | undefined,
): void {
  let request: Request;
  try {
    request = toWebRequest(req, trustProxy, bufferedBody);
  } catch (e) {
    writeAdapterError(res, e);
    return;
  }
  attachClientCertificate(req, request);
  const responseOrPromise = app.fetch(request);
  if (responseOrPromise instanceof Promise) {
    responseOrPromise.then(
      (response) => {
        try {
          const sent = sendWebResponse(response, res);
          if (sent instanceof Promise) sent.catch((e) => writeAdapterError(res, e));
        } catch (e) {
          writeAdapterError(res, e);
        }
      },
      (e) => writeAdapterError(res, e),
    );
  } else {
    try {
      const sent = sendWebResponse(responseOrPromise, res);
      if (sent instanceof Promise) sent.catch((e) => writeAdapterError(res, e));
    } catch (e) {
      writeAdapterError(res, e);
    }
  }
}

function bufferRequestBody(req: IncomingMessage, expected: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Pre-allocate to the declared Content-Length. The caller has already
    // checked `expected <= BUFFERED_BODY_MAX_BYTES` (1 MiB) so this
    // allocation is bounded and DoS-safe. Skipping the intermediate
    // `chunks: Buffer[]` array + `Buffer.concat` avoids one full-body
    // copy per request — significant at 1 MiB bodies under load.
    // Use `Buffer.alloc` (zero-filled) rather than `Buffer.allocUnsafe`:
    // the unsafe variant returns uninitialized memory and is forbidden by
    // `verify:no-unsafe-buffer`. Any unwritten tail is sliced off below.
    const out = expected > 0 ? Buffer.alloc(expected) : null;
    let received = 0;
    let settled = false;
    const onData = (chunk: Buffer) => {
      if (settled) return;
      const next = received + chunk.length;
      if (next > expected) {
        settled = true;
        cleanup();
        req.destroy();
        reject(new Error("Request body exceeded declared Content-Length"));
        return;
      }
      // out is non-null here because next > 0 implies expected > 0.
      chunk.copy(out!, received);
      received = next;
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (received === 0) {
        resolve(new Uint8Array(0));
        return;
      }
      // Trust Content-Length: if the client under-delivered we still
      // resolve the prefix actually received (matches prior behavior).
      const buf = received === expected ? out! : out!.subarray(0, received);
      resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    };
    const onErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onErr);
      req.off("aborted", onErr);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onErr);
    req.on("aborted", onErr as any);
  });
}

/**
 * Minimal structural view of the `tls.TLSSocket` members the adapter touches,
 * so the mTLS plumbing stays free of a hard `node:tls` import on the hot path.
 */
interface TlsSocketLike {
  encrypted?: boolean;
  authorized?: boolean;
  getPeerCertificate?: (detailed?: boolean) => PeerCertificateLike;
}

/**
 * Attach the TLS client certificate (if any) to the web `Request` so
 * `clientCertAuth()` can enforce a mutual-TLS identity. The read is deferred
 * behind a lazy thunk and only happens when a guarded route actually inspects
 * the certificate, so plain-HTTP and ordinary TLS requests pay nothing beyond a
 * single `encrypted` boolean check. Only runs when the peer socket is a
 * `TLSSocket` exposing `getPeerCertificate`.
 */
function attachClientCertificate(req: IncomingMessage, request: Request): void {
  const sock = req.socket as unknown as TlsSocketLike;
  if (!sock.encrypted || typeof sock.getPeerCertificate !== "function") return;
  setClientCertificate(request, () => {
    const raw = sock.getPeerCertificate!(true);
    return normalizePeerCertificate(raw, sock.authorized === true);
  });
}

function writeAdapterError(res: ServerResponse, e: unknown): void {
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

function toWebRequest(
  req: IncomingMessage,
  trustProxy: boolean,
  bufferedBody?: Uint8Array,
): Request {
  const reqHeaders = req.headers;
  const forwardedHost = trustProxy
    ? firstHeader(reqHeaders["x-forwarded-host"])
    : undefined;
  const host = forwardedHost ?? reqHeaders.host ?? "localhost";
  const forwardedProto = trustProxy
    ? firstHeader(reqHeaders["x-forwarded-proto"])
    : undefined;
  const proto =
    forwardedProto ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = `${proto}://${host}${req.url ?? "/"}`;
  // Build headers from `rawHeaders` (a flat [k0,v0,k1,v1,...] array) instead
  // of the parsed `req.headers` object. This matches @hono/node-server's
  // `newHeadersFromIncoming`: one `new Headers([[k,v],...])` constructor
  // call rather than N `headers.set()` calls. It is also stricter for
  // duplicate-Host smuggling — Node coalesces some singleton headers down
  // to the first value on `req.headers`, but `rawHeaders` preserves every
  // occurrence so `assertNoDuplicateSingletonHeaders` actually sees them.
  // Skip HTTP/2 pseudo-headers (leading ':') defensively, even though
  // node:http's createServer is HTTP/1.1 only today.
  const rawHeaders = req.rawHeaders;
  const headerPairs: Array<[string, string]> = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const k = rawHeaders[i]!;
    if (k.charCodeAt(0) === 58 /* ':' */) continue;
    headerPairs.push([k, rawHeaders[i + 1]!]);
  }
  const headers = new Headers(headerPairs);
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  if (bufferedBody !== undefined) {
    const req2 = new Request(url, {
      method,
      headers,
      body: bufferedBody as BodyInit,
    });
    // Stash the validated bytes so readBodyLimited (and any other internal
    // body reader) can skip the WHATWG ReadableStream reader loop. The
    // adapter has already enforced BUFFERED_BODY_MAX_BYTES + Content-Length
    // here; readBodyLimited re-checks against the caller's limit.
    (req2 as unknown as Record<symbol, unknown>)[DALOY_REQUEST_RAW_BODY] = bufferedBody;
    return req2;
  }
  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req) as ReadableStream,
    duplex: "half",
  } as RequestInit);
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined) return undefined;
  const comma = raw.indexOf(",");
  return (comma === -1 ? raw : raw.slice(0, comma)).trim() || undefined;
}

function sendWebResponse(
  res: Response,
  out: ServerResponse,
): void | Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  // Fast-path: response was produced by serializeResult and carries the raw
  // body bytes via the DALOY_RAW_BODY Symbol. Skip arrayBuffer() and the
  // reader-loop microtask churn entirely for buffer-backed responses.
  const raw = (res as any)[DALOY_RAW_BODY] as Uint8Array | null | undefined;
  if (raw !== undefined) {
    if (raw === null) {
      out.end();
    } else {
      out.end(raw);
    }
    return;
  }
  // Fast-path: handler returned a raw stream. Check before `!res.body` —
  // a Node Readable is stashed alongside a null Response body, and the
  // `new Response(null)` constructor also auto-sets `content-length: 0`
  // which we must strip so Node falls back to chunked transfer-encoding.
  const rawStream = (res as any)[DALOY_RAW_STREAM] as
    | ReadableStream<Uint8Array>
    | Readable
    | undefined;
  if (rawStream !== undefined) {
    if (typeof (rawStream as Readable).pipe === "function" && !(rawStream instanceof ReadableStream)) {
      // Node `Readable` from the handler: skip the Web-stream bridge entirely
      // and `.pipe(out)` like Fastify/Koa/Express do.
      out.removeHeader("content-length");
      return new Promise<void>((resolve, reject) => {
        const r = rawStream as Readable;
        const onError = (err: Error) => {
          r.destroy();
          reject(err);
        };
        r.once("error", onError);
        out.once("error", onError);
        out.once("finish", () => resolve());
        r.pipe(out);
      });
    }
    return pumpBody(rawStream as ReadableStream<Uint8Array>, out);
  }
  if (!res.body) {
    out.end();
    return;
  }
  const ct = out.getHeader("content-type");
  const isStream = ct && typeof ct === "string" && ct.startsWith("text/event-stream");
  const rawLength = out.getHeader("content-length");
  const contentLength =
    typeof rawLength === "number"
      ? rawLength
      : typeof rawLength === "string"
        ? Number(rawLength)
        : Number.NaN;
  if (!isStream && Number.isFinite(contentLength) && contentLength <= 64 * 1024) {
    return res.arrayBuffer().then((ab) => {
      out.end(Buffer.from(ab));
    });
  }
  return pumpBody(res.body, out);
}

function pumpBody(body: ReadableStream<Uint8Array>, out: ServerResponse): Promise<void> {
  // Delegate to Node's native pipe: it honors backpressure and avoids the
  // per-chunk microtask overhead of an explicit `await reader.read()` loop.
  return new Promise((resolve, reject) => {
    const readable = Readable.fromWeb(body as never);
    const onError = (err: Error) => {
      readable.destroy();
      reject(err);
    };
    readable.once("error", onError);
    out.once("error", onError);
    out.once("finish", () => resolve());
    readable.pipe(out);
  });
}

// ---------- WebSocket upgrade ----------

async function handleUpgrade(
  app: App,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  trustProxy: boolean,
): Promise<void> {
  const forwardedHost = trustProxy
    ? firstHeader(req.headers["x-forwarded-host"])
    : undefined;
  const host = forwardedHost ?? req.headers.host ?? "localhost";
  const forwardedProto = trustProxy
    ? firstHeader(req.headers["x-forwarded-proto"])
    : undefined;
  const proto =
    forwardedProto ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = new URL(`${proto}://${host}${req.url ?? "/"}`);
  const match = app.webSocketRoutes.find(url.pathname);
  if (!match) {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const result = await validateUpgrade(headers);
  if (!result.ok) {
    writeUpgradeError(socket, result.status, result.reason);
    return;
  }

  const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method: "GET",
    headers,
  });
  const ctx: WebSocketContext = {
    request,
    params: match.params as any,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries(headers.entries()),
    state: match.handler.createState() as any,
    protocols: result.protocols,
  };

  const handler = match.handler.handler as WebSocketHandler<any, any, any>;
  const originCheck = checkWebSocketOrigin(request, handler.allowedOrigins);
  if (!originCheck.ok) {
    writeUpgradeError(socket, 403, originCheck.reason);
    return;
  }
  let chosenProtocol = "";
  try {
    const decision = await handler.beforeUpgrade?.(request, ctx);
    if (decision instanceof Response) {
      writeRejection(socket, decision);
      return;
    }
    if (typeof decision === "string")
      chosenProtocol = validateSelectedSubprotocol(decision, result.protocols);
  } catch (err) {
    if (err instanceof WebSocketProtocolError) {
      writeUpgradeError(socket, 400, err.message);
      return;
    }
    app.log.error({ err }, "WebSocket beforeUpgrade hook failed");
    writeUpgradeError(socket, 500, "Internal Server Error");
    return;
  }

  // Send the 101 response.
  const responseLines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${result.acceptKey}`,
  ];
  if (chosenProtocol)
    responseLines.push(`Sec-WebSocket-Protocol: ${chosenProtocol}`);
  socket.write(responseLines.join("\r\n") + "\r\n\r\n");

  (socket as unknown as { setNoDelay: (b: boolean) => void }).setNoDelay(true);

  const routeOptions = match.handler.options;
  const conn = new NodeWebSocketConnection(
    socket,
    handler,
    chosenProtocol,
    app,
    routeOptions,
  );
  (socket as unknown as { setTimeout: (n: number, cb?: () => void) => void }).setTimeout(
    routeOptions.idleTimeout * 1000,
    () => conn.close(WS_CLOSE_CODE.GOING_AWAY, "idle timeout"),
  );
  // If the upgrade arrived with extra bytes already in the buffer, feed them first.
  if (head.length > 0) conn._ingest(head);

  socket.on("data", (chunk: Buffer) => conn._ingest(chunk));
  socket.on("close", () => conn._handleSocketClose());
  socket.on("error", (err: Error) => conn._handleSocketError(err));

  try {
    await handler.open?.(conn, ctx);
  } catch (err) {
    app.log.error({ err }, "WebSocket open() handler failed");
    conn._invokeError(err);
    conn.terminate();
  }
}

function writeUpgradeError(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  const body = `${status} ${reason}`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
      body,
  );
}

function writeRejection(socket: Duplex, res: Response): void {
  const lines = [
    `HTTP/1.1 ${res.status} ${res.statusText || "Error"}`,
    "Connection: close",
    "Content-Length: 0",
  ];
  res.headers.forEach((v, k) => lines.push(`${k}: ${v}`));
  socket.end(lines.join("\r\n") + "\r\n\r\n");
}

class NodeWebSocketConnection implements WebSocketConnection {
  readyState: 0 | 1 | 2 | 3 = WS_READY_STATE.OPEN;
  readonly extensions = "";
  binaryType: "arraybuffer" | "nodebuffer" = "nodebuffer";
  data: unknown = undefined;
  private sink: FrameSink;
  private closeHandled = false;

  constructor(
    private socket: Duplex,
    private handler: WebSocketHandler<any, any, any>,
    readonly protocol: string,
    private app: App,
    private options: NormalizedWebSocketOptions,
  ) {
    this.sink = new FrameSink({
      requireMask: true,
      maxPayloadLength: options.maxPayloadLength,
      onMessage: (ev) => {
        if (ev.isBinary && this.binaryType === "arraybuffer") {
          const buf = ev.data as Uint8Array;
          const ab =
            buf.buffer instanceof ArrayBuffer
              ? buf.buffer.slice(
                  buf.byteOffset,
                  buf.byteOffset + buf.byteLength,
                )
              : new Uint8Array(buf).buffer;
          void this._invokeMessage(ab, true);
        } else {
          void this._invokeMessage(ev.data, ev.isBinary);
        }
      },
      onPing: (payload) => {
        // Auto-pong per RFC 6455 §5.5.2.
        this._writeFrame(WS_OPCODE.PONG, payload);
      },
      onPong: () => {
        /* application-level latency tracking is out of scope */
      },
      onClose: (code, reason) => {
        if (this.readyState === WS_READY_STATE.OPEN) {
          // Echo close per RFC 6455 §5.5.1.
          this.readyState = WS_READY_STATE.CLOSING;
          this._writeFrame(WS_OPCODE.CLOSE, encodeClosePayload(code, reason));
        }
        this.readyState = WS_READY_STATE.CLOSED;
        this._fireClose(code, reason);
        this.socket.end();
      },
      onProtocolError: (err) => {
        this._invokeError(err);
        this.close(
          err instanceof WebSocketPayloadTooLargeError
            ? WS_CLOSE_CODE.MESSAGE_TOO_BIG
            : WS_CLOSE_CODE.PROTOCOL_ERROR,
          err.message,
        );
      },
    });
  }

  get bufferedAmount(): number {
    return (this.socket as { writableLength?: number }).writableLength ?? 0;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== WS_READY_STATE.OPEN) return;
    const { opcode, payload } = encodeSendPayload(
      data as string | ArrayBuffer | ArrayBufferView,
    );
    this._writeFrame(opcode, payload);
  }

  close(code: number = WS_CLOSE_CODE.NORMAL_CLOSURE, reason = ""): void {
    if (this.readyState >= WS_READY_STATE.CLOSING) return;
    this.readyState = WS_READY_STATE.CLOSING;
    this._writeFrame(WS_OPCODE.CLOSE, encodeClosePayload(code, reason));
    this._fireClose(code, reason);
    this.socket.end();
  }

  ping(data?: string | ArrayBufferLike | ArrayBufferView): void {
    this._controlFrame(WS_OPCODE.PING, data);
  }

  pong(data?: string | ArrayBufferLike | ArrayBufferView): void {
    this._controlFrame(WS_OPCODE.PONG, data);
  }

  terminate(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.socket.destroy();
  }

  // --- internals ---

  _ingest(chunk: Buffer): void {
    if (this.readyState === WS_READY_STATE.CLOSED) return;
    this.sink.push(
      new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    );
  }

  _handleSocketClose(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this._fireClose(WS_CLOSE_CODE.ABNORMAL_CLOSURE, "");
  }

  _handleSocketError(err: Error): void {
    this._invokeError(err);
    this.readyState = WS_READY_STATE.CLOSED;
    this.socket.destroy();
  }

  private _controlFrame(
    opcode: number,
    data?: string | ArrayBufferLike | ArrayBufferView,
  ): void {
    if (this.readyState !== WS_READY_STATE.OPEN) return;
    let payload: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    if (data !== undefined) {
      payload = encodeSendPayload(data as any).payload;
      if (payload.length > WS_MAX_CONTROL_PAYLOAD) {
        throw new WebSocketProtocolError(
          "Control frame payload exceeds 125 bytes",
        );
      }
    }
    this._writeFrame(opcode, payload);
  }

  private _writeFrame(opcode: number, payload: Uint8Array): void {
    const frame = encodeFrame({ opcode, payload });
    const flushed = this.socket.write(
      Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength),
    );
    if (!flushed) {
      this.socket.once("drain", () =>
        this._invokeHandler("WebSocket drain() handler threw", () =>
          this.handler.drain?.(this),
        ),
      );
    }
    if (
      this.options.closeOnBackpressureLimit &&
      this.readyState === WS_READY_STATE.OPEN &&
      this.bufferedAmount > this.options.backpressureLimit
    ) {
      this.close(WS_CLOSE_CODE.MESSAGE_TOO_BIG, "backpressure limit exceeded");
    }
  }

  _invokeError(err: unknown): void {
    this._invokeHandler("WebSocket error() handler threw", () =>
      this.handler.error?.(this, err),
    );
  }

  private async _invokeMessage(
    data: string | Uint8Array | ArrayBuffer,
    isBinary: boolean,
  ): Promise<void> {
    try {
      await this.handler.message?.(this, data, isBinary);
    } catch (err) {
      this.app.log.error({ err }, "WebSocket message() handler failed");
      this._invokeError(err);
    }
  }

  private _fireClose(code: number, reason: string): void {
    if (this.closeHandled) return;
    this.closeHandled = true;
    this._invokeHandler("WebSocket close() handler threw", () =>
      this.handler.close?.(this, code, reason),
    );
  }

  private _invokeHandler(
    label: string,
    run: () => void | Promise<void> | undefined,
  ): void {
    try {
      const result = run();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch((err) => {
          this.app.log.error({ err }, label);
        });
      }
    } catch (err) {
      this.app.log.error({ err }, label);
    }
  }
}
