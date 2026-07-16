/**
 * Bun adapter — `Bun.serve` already speaks web-standard fetch,
 * so this is the smallest possible wrapper. The adapter passes through the
 * commonly-needed modern `Bun.serve` options (`idleTimeout`, `tls`,
 * `development`, `unix`), exposes the server's `url` for ergonomic logging,
 * and wires graceful shutdown to SIGTERM/SIGINT like the Node adapter.
 */
import type { App } from "../app.js";
import { setConnInfo } from "../conn-info.js";
import {
  WS_READY_STATE,
  WS_CLOSE_CODE,
  WS_MAX_CONTROL_PAYLOAD,
  encodeSendPayload,
  parseSubprotocols,
  validateSelectedSubprotocol,
  checkWebSocketOrigin,
  WebSocketProtocolError,
  type NormalizedWebSocketOptions,
  type WebSocketConnection,
  type WebSocketContext,
  type WebSocketHandler,
} from "../websocket.js";

/** TLS material accepted by Bun's `serve({ tls })` option. */
export interface BunTLSOptions {
  /** PEM certificate. */
  cert: string;
  /** PEM private key. */
  key: string;
  /** Optional passphrase for the key. */
  passphrase?: string;
  /** Optional CA bundle. */
  ca?: string;
}

/** Options forwarded to `Bun.serve` by {@link serve}. */
export interface BunServeOptions {
  /** TCP port to listen on. Ignored when `unix` is set. Defaults to `3000`. */
  port?: number;
  /** Interface to bind. Ignored when `unix` is set. Defaults to `"0.0.0.0"`. */
  hostname?: string;
  /** Maximum request body bytes (Bun-level cap). Default: 16 MiB. */
  maxRequestBodySize?: number;
  /** Seconds before an idle connection is closed. Default: Bun default (10). */
  idleTimeout?: number;
  /** When true, Bun enables development-mode error pages and verbose output. */
  development?: boolean;
  /** Optional unix socket path; when set, TCP `port`/`hostname` are not passed to Bun. */
  unix?: string;
  /** When supplied, Bun.serve listens on HTTPS. */
  tls?: BunTLSOptions;
  /**
   * Drain timeout in ms passed to {@link App.shutdown} during graceful
   * shutdown (signal-triggered or via `stop()`). Default: 10000.
   *
   * @since 1.0.0
   */
  shutdownTimeoutMs?: number;
  /**
   * Listen for SIGTERM/SIGINT and shut down gracefully (drain
   * {@link App.shutdown} hooks, then stop the Bun server and exit). Matches
   * the Node and Deno adapters so rolling deploys under Kubernetes/systemd
   * do not hard-kill in-flight requests. Set `false` to manage signals
   * yourself. Default: true.
   *
   * @since 1.0.0
   */
  handleSignals?: boolean;
}

/** Handle returned by {@link serve} for shutdown and listener introspection. */
export interface BunServerHandle {
  /** Port the server is actually listening on (as reported by Bun). */
  port: number;
  /** Server URL as reported by `Bun.serve` (e.g. for startup logging), if available. */
  url: URL | undefined;
  /** Graceful stop: drains {@link App.shutdown} hooks first, then force-stops the Bun server. Idempotent. */
  stop: () => Promise<void>;
}

/**
 * Start `Bun.serve` bound to the given {@link App}, wiring HTTP and WebSocket routes.
 *
 * @param app - The DaloyJS {@link App} whose `fetch` (and WebSocket routes) serve requests.
 * @param opts - Listener options forwarded to `Bun.serve`; see {@link BunServeOptions}.
 * @returns A {@link BunServerHandle} exposing the bound `port`, `url`, and a graceful `stop()`.
 * @throws Error when the Bun runtime (`globalThis.Bun.serve`) is not detected.
 */
export function serve(app: App, opts: BunServeOptions = {}): BunServerHandle {
  const Bun = (
    globalThis as {
      Bun?: {
        serve?: (cfg: Record<string, unknown>) => {
          port: number;
          url?: URL;
          stop: (force?: boolean) => void;
          upgrade?: (
            req: Request,
            opts?: { data?: unknown; headers?: HeadersInit },
          ) => boolean;
        };
      };
    }
  ).Bun;
  if (!Bun?.serve) throw new Error("Bun runtime not detected");

  const hasWs = app.webSocketRoutes.size > 0;

  const servesTls = opts.tls !== undefined;
  // Fulfil the conn-info contract with the immediate TCP peer from Bun's
  // native `server.requestIP()`, so `getConnInfo` / `resolveClientIp` /
  // `behindProxy` work on Bun. Never derived from spoofable headers.
  const tagConnInfo = (
    req: Request,
    server: BunRequestIPServer | undefined,
  ): void => {
    const ip = server?.requestIP?.(req);
    if (ip) {
      setConnInfo(req, {
        remoteAddress: ip.address,
        remotePort: ip.port,
        tls: servesTls,
      });
    }
  };
  const cfg: Record<string, unknown> = {
    maxRequestBodySize: opts.maxRequestBodySize ?? 16 * 1024 * 1024,
    fetch: hasWs
      ? (
          req: Request,
          server: BunRequestIPServer & {
            upgrade: (
              req: Request,
              opts?: { data?: unknown; headers?: HeadersInit },
            ) => boolean;
          },
        ) => {
          tagConnInfo(req, server);
          if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            return tryBunUpgrade(app, req, server);
          }
          return app.fetch(req);
        }
      : (req: Request, server: BunRequestIPServer) => {
          tagConnInfo(req, server);
          return app.fetch(req);
        },
    error: (err: Error) => {
      // Last-resort handler reached only if app.fetch itself throws (it
      // normally catches everything). Log the error server-side but never
      // echo `err.message` to the client — that would leak internal details
      // and bypass the framework's prod-mode error redaction. Mirrors the
      // redacted problem+json body the Node adapter emits in writeAdapterError.
      app.log.error({ err }, "Unhandled error in Bun fetch handler");
      return new Response(
        JSON.stringify({
          type: "https://daloyjs.dev/errors/internal",
          title: "Internal Server Error",
          status: 500,
        }),
        {
          status: 500,
          headers: { "content-type": "application/problem+json" },
        },
      );
    },
  };
  if (hasWs) cfg.websocket = buildBunWebSocketConfig(app);
  if (opts.unix === undefined) {
    cfg.port = opts.port ?? 3000;
    cfg.hostname = opts.hostname ?? "0.0.0.0";
  }
  if (opts.idleTimeout !== undefined) cfg.idleTimeout = opts.idleTimeout;
  if (opts.development !== undefined) cfg.development = opts.development;
  if (opts.unix !== undefined) cfg.unix = opts.unix;
  if (opts.tls) cfg.tls = opts.tls;

  const server = Bun.serve(cfg);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    server.stop(true);
  };
  if (opts.handleSignals !== false) {
    // Parity with the Node/Deno adapters: without this, SIGTERM on a rolling
    // deploy hard-kills the process — in-flight requests are dropped and
    // `onShutdown`/`onClose` hooks never run. Bun implements Node's
    // `process` signal events, so the same wiring works.
    const onSignal = (sig: string) => {
      app.log.info({ sig }, "DaloyJS received signal, shutting down");
      void stop().then(() => process.exit(0));
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }
  return {
    port: server.port,
    url: server.url,
    stop,
  };
}

/**
 * Minimal shape of the `Bun.serve` server object needed for peer-address
 * lookup. `requestIP` is optional so old Bun versions (or test fakes)
 * degrade to "no conn info" instead of throwing.
 *
 * @internal
 */
interface BunRequestIPServer {
  requestIP?: (req: Request) => { address: string; port: number } | null;
}

// ---------- WebSocket integration ----------

interface BunWebSocketServer {
  upgrade(
    req: Request,
    opts?: { data?: unknown; headers?: HeadersInit },
  ): boolean;
}

interface BunNativeWebSocket {
  readyState: 0 | 1 | 2 | 3;
  data: BunUpgradeData | undefined;
  binaryType: "arraybuffer" | "nodebuffer" | "uint8array";
  remoteAddress?: string;
  send(data: string | Uint8Array | ArrayBuffer, compress?: boolean): number;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data?: string | Uint8Array | ArrayBuffer): number;
  pong(data?: string | Uint8Array | ArrayBuffer): number;
  publish?: (...args: unknown[]) => number;
  subscribe?: (topic: string) => void;
  unsubscribe?: (topic: string) => void;
  isSubscribed?: (topic: string) => boolean;
  getBufferedAmount?(): number;
}

interface BunUpgradeData {
  handler: WebSocketHandler<any, any, any>;
  ctx: WebSocketContext;
  protocol: string;
  options?: NormalizedWebSocketOptions;
  conn?: BunWebSocketConnection;
}

async function tryBunUpgrade(
  app: App,
  req: Request,
  server: BunWebSocketServer,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  const match = app.webSocketRoutes.find(url.pathname);
  if (!match) return new Response("Not Found", { status: 404 });

  const ctx: WebSocketContext = {
    request: req,
    params: match.params as any,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries(req.headers.entries()),
    state: match.handler.createState() as any,
    protocols: parseSubprotocols(req.headers.get("sec-websocket-protocol")),
  };

  const handler = match.handler.handler as WebSocketHandler<any, any, any>;
  const originCheck = checkWebSocketOrigin(req, handler.allowedOrigins);
  if (!originCheck.ok) {
    return new Response(originCheck.reason, { status: 403 });
  }
  let chosenProtocol = "";
  try {
    const decision = await handler.beforeUpgrade?.(req, ctx);
    if (decision instanceof Response) return decision;
    if (typeof decision === "string")
      chosenProtocol = validateSelectedSubprotocol(decision, ctx.protocols);
  } catch (err) {
    if (err instanceof WebSocketProtocolError) {
      return new Response(err.message, { status: 400 });
    }
    app.log.error({ err }, "WebSocket beforeUpgrade hook failed");
    return new Response("Internal Server Error", { status: 500 });
  }

  const headers: Record<string, string> = {};
  if (chosenProtocol) headers["sec-websocket-protocol"] = chosenProtocol;
  const data: BunUpgradeData = {
    handler,
    ctx,
    protocol: chosenProtocol,
    options: match.handler.options,
  };
  const ok = server.upgrade(req, { data, headers });
  if (!ok) return new Response("Upgrade Failed", { status: 500 });
  return undefined;
}

function buildBunWebSocketConfig(app: App) {
  const runtimeOptions = app.webSocketRoutes.runtimeOptions();
  return {
    closeOnBackpressureLimit: runtimeOptions.closeOnBackpressureLimit,
    backpressureLimit: runtimeOptions.backpressureLimit,
    perMessageDeflate: runtimeOptions.perMessageDeflate,
    idleTimeout: runtimeOptions.idleTimeout,
    maxPayloadLength: runtimeOptions.maxPayloadLength,
    open(ws: BunNativeWebSocket) {
      const data = ws.data as BunUpgradeData | undefined;
      if (!data) return;
      const conn = new BunWebSocketConnection(
        ws,
        data.protocol,
        data.options ?? runtimeOptions,
      );
      data.conn = conn;
      invokeBunHandler(
        app,
        data,
        "WebSocket open() handler failed",
        () => data.handler.open?.(conn, data.ctx),
        true,
      );
    },
    message(
      ws: BunNativeWebSocket,
      msg: string | Buffer | Uint8Array | ArrayBuffer,
    ) {
      const data = ws.data as BunUpgradeData | undefined;
      if (!data?.conn) return;
      const isBinary = typeof msg !== "string";
      const options = data.options ?? runtimeOptions;
      if (payloadByteLength(msg) > options.maxPayloadLength) {
        data.conn.close(
          WS_CLOSE_CODE.MESSAGE_TOO_BIG,
          "maxPayloadLength exceeded",
        );
        return;
      }
      invokeBunHandler(
        app,
        data,
        "WebSocket message() handler failed",
        () => data.handler.message?.(data.conn!, msg as any, isBinary),
        true,
      );
    },
    close(ws: BunNativeWebSocket, code: number, reason: string) {
      const data = ws.data as BunUpgradeData | undefined;
      if (!data?.conn) return;
      data.conn._markClosed();
      invokeBunHandler(app, data, "WebSocket close() handler threw", () =>
        data.handler.close?.(
          data.conn!,
          code ?? WS_CLOSE_CODE.NO_STATUS_RECEIVED,
          reason ?? "",
        ),
      );
    },
    drain(ws: BunNativeWebSocket) {
      const data = ws.data as BunUpgradeData | undefined;
      if (!data?.conn) return;
      invokeBunHandler(app, data, "WebSocket drain() handler threw", () =>
        data.handler.drain?.(data.conn!),
      );
    },
  };
}

class BunWebSocketConnection implements WebSocketConnection {
  readyState: 0 | 1 | 2 | 3 = WS_READY_STATE.OPEN;
  readonly extensions = "";
  data: unknown = undefined;

  constructor(
    private ws: BunNativeWebSocket,
    readonly protocol: string,
    private options: NormalizedWebSocketOptions,
  ) {}

  get binaryType(): "arraybuffer" | "nodebuffer" {
    const v = this.ws.binaryType;
    return v === "arraybuffer" ? "arraybuffer" : "nodebuffer";
  }
  set binaryType(v: "arraybuffer" | "nodebuffer") {
    this.ws.binaryType = v;
  }

  get bufferedAmount(): number {
    return this.ws.getBufferedAmount?.() ?? 0;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== WS_READY_STATE.OPEN) return;
    let sent = 0;
    if (typeof data === "string") {
      sent = this.ws.send(data, this.options.perMessageDeflate);
    } else if (data instanceof ArrayBuffer) {
      sent = this.ws.send(data, this.options.perMessageDeflate);
    } else if (ArrayBuffer.isView(data)) {
      sent = this.ws.send(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        this.options.perMessageDeflate,
      );
    } else {
      sent = this.ws.send(
        new Uint8Array(data as ArrayBufferLike),
        this.options.perMessageDeflate,
      );
    }
    void sent;
    if (
      this.options.closeOnBackpressureLimit &&
      this.bufferedAmount > this.options.backpressureLimit
    ) {
      this.close(WS_CLOSE_CODE.MESSAGE_TOO_BIG, "backpressure limit exceeded");
    }
  }

  close(code: number = WS_CLOSE_CODE.NORMAL_CLOSURE, reason = ""): void {
    if (this.readyState >= WS_READY_STATE.CLOSING) return;
    this.readyState = WS_READY_STATE.CLOSING;
    this.ws.close(code, reason);
  }

  ping(data?: string | ArrayBufferLike | ArrayBufferView): void {
    validateControlPayload(data);
    this.ws.ping(toBunBinary(data));
  }
  pong(data?: string | ArrayBufferLike | ArrayBufferView): void {
    validateControlPayload(data);
    this.ws.pong(toBunBinary(data));
  }
  terminate(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.ws.terminate();
  }

  _markClosed(): void {
    this.readyState = WS_READY_STATE.CLOSED;
  }
}

function invokeBunHandler(
  app: App,
  data: BunUpgradeData,
  label: string,
  run: () => void | Promise<void> | undefined,
  notifyError = false,
): void {
  try {
    const result = run();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch((err) =>
        reportBunHandlerFailure(app, data, label, err, notifyError),
      );
    }
  } catch (err) {
    reportBunHandlerFailure(app, data, label, err, notifyError);
  }
}

function reportBunHandlerFailure(
  app: App,
  data: BunUpgradeData,
  label: string,
  err: unknown,
  notifyError: boolean,
): void {
  app.log.error({ err }, label);
  if (notifyError && data.conn) {
    invokeBunHandler(app, data, "WebSocket error() handler threw", () =>
      data.handler.error?.(data.conn!, err),
    );
  }
}

function validateControlPayload(
  data: string | ArrayBufferLike | ArrayBufferView | undefined,
): void {
  if (
    data !== undefined &&
    encodeSendPayload(data).payload.length > WS_MAX_CONTROL_PAYLOAD
  ) {
    throw new WebSocketProtocolError("Control frame payload exceeds 125 bytes");
  }
}

function payloadByteLength(
  data: string | Buffer | Uint8Array | ArrayBuffer,
): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.byteLength;
}

function toBunBinary(
  data: string | ArrayBufferLike | ArrayBufferView | undefined,
): string | Uint8Array | undefined {
  if (data === undefined) return undefined;
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBufferLike);
}
