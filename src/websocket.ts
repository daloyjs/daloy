/**
 * WebSocket primitives — runtime-agnostic types, handshake, and RFC 6455
 * frame protocol. Adapter packages (`@daloyjs/core/node`, `@daloyjs/core/bun`)
 * wire these primitives into their respective servers.
 *
 * The public API mirrors the WHATWG `WebSocket` interface where it makes
 * sense for the server side (`readyState`, `send`, `close`, `protocol`,
 * `extensions`, `bufferedAmount`, `binaryType`) and uses Bun-style handler
 * callbacks (`open`, `message`, `close`, `drain`, `error`) so the same
 * handler shape runs on both Node and Bun.
 *
 * ```ts
 * import { App } from "@daloyjs/core";
 * import { serve } from "@daloyjs/core/node";
 *
 * const app = new App();
 *
 * app.ws("/chat/:room", {
 *   open(conn, ctx) {
 *     conn.data = { user: ctx.query.user ?? "anon", room: ctx.params.room };
 *     conn.send(`welcome ${(conn.data as any).user}`);
 *   },
 *   message(conn, data) {
 *     conn.send(typeof data === "string" ? data.toUpperCase() : data);
 *   },
 *   close(conn, code, reason) {
 *     // cleanup
 *   },
 * });
 *
 * serve(app, { port: 3000 });
 * ```
 */
import { HttpError, InternalError } from "./errors.js";
import { rateLimit, type RateLimitOptions } from "./middleware.js";
import { getFileFieldOptions } from "./multipart.js";
import { Router, type RouteMatch } from "./router.js";
import type { StandardSchemaV1 } from "./schema.js";
import type { AppState, BaseContext, PathString, PathParams } from "./types.js";
/** RFC 6455 magic GUID used to compute `Sec-WebSocket-Accept`. */
export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** WHATWG `WebSocket.readyState` constants. */
export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/** RFC 6455 opcodes. */
export const WS_OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

/** Common RFC 6455 / IANA close codes. */
export const WS_CLOSE_CODE = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
} as const;

/** Maximum payload length permitted on a single control frame (RFC 6455 §5.5). */
export const WS_MAX_CONTROL_PAYLOAD = 125;
/** Default ceiling for queued outbound bytes before backpressure handling triggers (1 MiB). */
export const DEFAULT_WS_BACKPRESSURE_LIMIT = 1024 * 1024;
/** Default maximum inbound frame/message payload length (1 MiB). */
export const DEFAULT_WS_MAX_PAYLOAD_LENGTH = 1024 * 1024;
/** Default idle timeout applied to WebSocket routes (seconds). */
export const DEFAULT_WS_IDLE_TIMEOUT_SECONDS = 120;

// ---------- Public types ----------

/**
 * Live, server-side view of a WebSocket connection. Implementations are
 * supplied by the runtime adapter; user handlers receive an instance and
 * interact with it via this stable interface.
 */
export interface WebSocketConnection<TData = unknown> {
  /** WHATWG ready state. */
  readonly readyState: 0 | 1 | 2 | 3;
  /** Negotiated subprotocol (the value of the response `Sec-WebSocket-Protocol`). */
  readonly protocol: string;
  /** Negotiated extensions (the value of the response `Sec-WebSocket-Extensions`). */
  readonly extensions: string;
  /** Bytes queued but not yet flushed to the kernel. */
  readonly bufferedAmount: number;
  /** Hint for how binary `message` payloads are surfaced. */
  binaryType: "arraybuffer" | "nodebuffer";
  /** Free-form user data slot. Persists for the lifetime of the connection. */
  data: TData;
  /** Send a text or binary frame. */
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  /** Send a CLOSE frame and start the closing handshake. */
  close(code?: number, reason?: string): void;
  /** Send a PING frame (≤ 125 bytes). */
  ping(data?: string | ArrayBufferLike | ArrayBufferView): void;
  /** Send a PONG frame (≤ 125 bytes). */
  pong(data?: string | ArrayBufferLike | ArrayBufferView): void;
  /** Forcefully tear the socket down without a closing handshake. */
  terminate(): void;
}

/**
 * Per-upgrade context handed to `beforeUpgrade` and `open`. Mirrors the
 * subset of {@link BaseContext} that makes sense before a request body has
 * been read.
 */
export interface WebSocketContext<P extends string = string, S = AppState> {
  /** The original RFC 6455 upgrade `Request`. */
  request: Request;
  /** Path parameters extracted from the matched route pattern. */
  params: PathParams<P>;
  /** Query-string parameters from the upgrade URL. */
  query: Record<string, string>;
  /** Upgrade request headers, lower-cased keys. */
  headers: Record<string, string>;
  /** Per-app state produced by the route's state factory. */
  state: S;
  /** Subprotocols offered by the client (parsed from `Sec-WebSocket-Protocol`). */
  protocols: string[];
}

/**
 * Optional contract/documentation metadata for a WebSocket route, mirroring
 * the HTTP route `meta` block. Consumed by the built-in AsyncAPI generator
 * ({@link generateAsyncAPI}) to describe the channel, its operations, and the
 * payloads exchanged over the socket. Purely descriptive — it never changes
 * runtime behavior or the RFC 6455 handshake.
 *
 * @since 0.37.0
 */
export interface WebSocketMeta {
  /** Short channel summary surfaced as the AsyncAPI channel/operation summary. */
  summary?: string;
  /** Longer CommonMark description for the channel. */
  description?: string;
  /** Tags applied to the generated AsyncAPI operations. */
  tags?: string[];
  /**
   * Schema describing messages the **server sends to clients** (outbound).
   * Surfaced as the payload of the AsyncAPI `send` operation. Falls back to no
   * outbound message when omitted.
   */
  send?: StandardSchemaV1;
  /**
   * Schema describing messages the **server receives from clients** (inbound).
   * Surfaced as the payload of the AsyncAPI `receive` operation. Defaults to
   * {@link WebSocketHandler.request}'s `body` schema when omitted.
   */
  receive?: StandardSchemaV1;
  /**
   * Stable identifier base used to derive the AsyncAPI `operationId`s and
   * channel name for this route. Defaults to a slug derived from the path.
   */
  operationId?: string;
}

/**
 * User-supplied WebSocket lifecycle callbacks.
 *
 * - `beforeUpgrade` may reject the upgrade by returning a `Response`. Returning
 *   a string selects that subprotocol. Returning `undefined` accepts the
 *   upgrade with no subprotocol.
 * - `open`/`message`/`close`/`error`/`drain` follow Bun's signature so the
 *   same handler runs on both Node and Bun.
 */
export interface WebSocketHandler<
  P extends string = string,
  S = AppState,
  TData = unknown,
> {
  /** Optional schema used for payload-size consistency checks. */
  request?: { body?: StandardSchemaV1 };
  /**
   * Optional contract/documentation metadata consumed by the built-in
   * AsyncAPI generator ({@link generateAsyncAPI}). Purely descriptive.
   *
   * @since 0.37.0
   */
  meta?: WebSocketMeta;
  /** Close the connection when queued outbound bytes exceed backpressureLimit. Default: true. */
  closeOnBackpressureLimit?: boolean;
  /** Maximum queued outbound bytes before backpressure handling triggers. Default: 1 MiB. */
  backpressureLimit?: number;
  /** Per-message compression. Default: false; refused in production secureDefaults. */
  perMessageDeflate?: boolean;
  /** Idle timeout in seconds. Default: 120; `0` is refused. */
  idleTimeout?: number;
  /** Maximum inbound message payload length in bytes. Default: 1 MiB. */
  maxPayloadLength?: number;
  /**
   * Explicitly mark this WebSocket route as intentionally public.
   * In production with `secureDefaults` enabled, routes without a
   * `beforeUpgrade` decision hook are refused at registration unless this is
   * `true`, so an authenticated WebSocket cannot accidentally perform auth in
   * `open()` after the RFC 6455 upgrade has already succeeded.
   *
   * @since 0.32.0
   */
  acknowledgeUnauthenticated?: boolean;
  /**
   * Acknowledge that a header-mutating middleware (CORS,
   * `secureHeaders`, `etag`, `compression`, CSRF) is mounted on a path that
   * matches this WebSocket route. By default the framework refuses at
   * registration because once the RFC 6455 upgrade response is sent, no
   * further headers can be added by middleware. Pass `true` only if the
   * middleware is known to skip the upgrade request (the framework cannot
   * verify this).
   *
   * @since 0.32.0
   */
  acknowledgeHeaderMutatingMiddleware?: boolean;
  /**
   * Allowlist for the upgrade request's `Origin` header. Daloy validates
   * this **before** {@link WebSocketHandler.beforeUpgrade} runs, closing the
   * Cross-Site WebSocket Hijacking (CSWSH) class of bug — including the
   * Storybook dev-server upgrade hijack disclosed as
   * [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack)
   * — where a malicious site triggers `new WebSocket(...)` in a victim's
   * browser. Browsers always attach cookies on a WS handshake; without
   * Origin validation the upgrade succeeds and the attacker can speak the
   * protocol on the user's behalf.
   *
   * Accepted forms:
   *  - `"same-origin"` — when an `Origin` header is present, it must match
   *    the request's own origin (scheme + host + port). When absent (a
   *    non-browser client), the upgrade is allowed.
   *  - `readonly string[]` — when an `Origin` header is present, it must
   *    equal one of the listed origins exactly. When absent, allowed.
   *  - `(origin, request) => boolean` — full control. The function is
   *    invoked with the `Origin` header (string or `null`) and the upgrade
   *    `Request`; returning `false` rejects the handshake with `403`.
   *
   * @since 0.33.0
   */
  allowedOrigins?:
    | "same-origin"
    | readonly string[]
    | ((origin: string | null, request: Request) => boolean);
  /**
   * Acknowledge that this WebSocket route is intentionally exposed to
   * upgrade requests from any browser origin. In production with
   * `secureDefaults` enabled, registration refuses to add a WS route
   * unless either {@link WebSocketHandler.allowedOrigins} is set or this
   * flag is `true`, mirroring the Storybook / CSWSH lesson: the
   * `beforeUpgrade` hook authenticates the user, but CSWSH attaches the
   * user's own cookies, so authentication alone does not stop the
   * cross-site handshake.
   *
   * @since 0.33.0
   */
  acknowledgeCrossOriginUpgrade?: boolean;
  /**
   * Auth/decision hook run before the 101 response is sent (after the
   * {@link WebSocketHandler.allowedOrigins} check). Return a `Response` to
   * reject, a string to select that subprotocol, or `undefined` to accept.
   */
  beforeUpgrade?(
    request: Request,
    ctx: WebSocketContext<P, S>,
  ): Response | string | undefined | Promise<Response | string | undefined>;
  /** Called once after the upgrade completes and the connection is open. */
  open?(
    conn: WebSocketConnection<TData>,
    ctx: WebSocketContext<P, S>,
  ): void | Promise<void>;
  /** Called for each complete inbound message; `data` is a string for text frames, bytes for binary (`isBinary: true`). */
  message?(
    conn: WebSocketConnection<TData>,
    data: string | Uint8Array | ArrayBuffer,
    isBinary: boolean,
  ): void | Promise<void>;
  /** Called when the connection closes, with the RFC 6455 close code and reason. */
  close?(
    conn: WebSocketConnection<TData>,
    code: number,
    reason: string,
  ): void | Promise<void>;
  /** Called when a socket or handler error occurs on the connection. */
  error?(conn: WebSocketConnection<TData>, err: unknown): void | Promise<void>;
  /** Called when the socket's send buffer drains after backpressure. */
  drain?(conn: WebSocketConnection<TData>): void | Promise<void>;
}

/** Result of {@link normalizeWebSocketOptions}: fully resolved limits applied by the adapter. */
export interface NormalizedWebSocketOptions {
  /** Close the connection when queued outbound bytes exceed `backpressureLimit`. Defaults to `true`. */
  closeOnBackpressureLimit: boolean;
  /** Maximum queued outbound bytes before backpressure handling triggers. Defaults to 1 MiB. */
  backpressureLimit: number;
  /** Per-message compression flag. Defaults to `false`; refused in production under secureDefaults. */
  perMessageDeflate: boolean;
  /** Idle timeout in seconds. Defaults to `120`. */
  idleTimeout: number;
  /** Maximum inbound message payload length in bytes. Defaults to 1 MiB. */
  maxPayloadLength: number;
}

function assertPositiveWebSocketInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`app.ws(): ${name} must be a positive integer.`);
  }
}

function assertWebSocketOriginPolicy(
  policy: WebSocketHandler<any, any, any>["allowedOrigins"],
): void {
  if (policy === undefined || policy === "same-origin" || typeof policy === "function") return;
  if (!Array.isArray(policy)) {
    throw new Error(
      'app.ws(): allowedOrigins must be "same-origin", an array of origin strings, or a predicate function.',
    );
  }
  for (const origin of policy) {
    if (typeof origin !== "string" || origin.length === 0) {
      throw new Error("app.ws(): allowedOrigins entries must be non-empty origin strings.");
    }
  }
}

function schemaToJson(schema: StandardSchemaV1 | undefined): unknown {
  const converter = (schema as unknown as { toJSONSchema?: () => unknown } | undefined)?.toJSONSchema;
  if (typeof converter !== "function") return undefined;
  try {
    return converter.call(schema);
  } catch {
    return undefined;
  }
}

function declaredSchemaMaxBytes(schema: StandardSchemaV1 | undefined): number | undefined {
  const fileOptions = getFileFieldOptions(schema);
  if (fileOptions?.maxBytes !== undefined) return fileOptions.maxBytes;
  const jsonSchema = schemaToJson(schema);
  if (!jsonSchema || typeof jsonSchema !== "object") return undefined;
  const record = jsonSchema as Record<string, unknown>;
  const maxLength = record.maxLength;
  if (typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength >= 0) {
    return Math.floor(maxLength);
  }
  const maxBytes = record["x-max-bytes"] ?? record.maxBytes;
  if (typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes >= 0) {
    return Math.floor(maxBytes);
  }
  return undefined;
}

/**
 * Resolve a user-supplied {@link WebSocketHandler} into the strict
 * {@link NormalizedWebSocketOptions} the adapter consumes. Applies defaults,
 * runs production safety checks, and throws on invalid values.
 *
 * @param handler The user-supplied handler whose option fields are validated.
 * @param context Environment flags: `production` and `secureDefaults` gate the perMessageDeflate refusal.
 * @returns The fully resolved options applied by the runtime adapter.
 * @throws Error when a limit is not a positive integer, `allowedOrigins` is malformed, `perMessageDeflate` is enabled in production under secureDefaults, or `maxPayloadLength` exceeds the body schema maximum.
 */
export function normalizeWebSocketOptions(
  handler: WebSocketHandler<any, any, any>,
  context: { production: boolean; secureDefaults: boolean },
): NormalizedWebSocketOptions {
  const closeOnBackpressureLimit = handler.closeOnBackpressureLimit ?? true;
  const backpressureLimit = handler.backpressureLimit ?? DEFAULT_WS_BACKPRESSURE_LIMIT;
  const perMessageDeflate = handler.perMessageDeflate ?? false;
  const idleTimeout = handler.idleTimeout ?? DEFAULT_WS_IDLE_TIMEOUT_SECONDS;
  const maxPayloadLength = handler.maxPayloadLength ?? DEFAULT_WS_MAX_PAYLOAD_LENGTH;

  assertPositiveWebSocketInteger("backpressureLimit", backpressureLimit);
  assertPositiveWebSocketInteger("idleTimeout", idleTimeout);
  assertPositiveWebSocketInteger("maxPayloadLength", maxPayloadLength);
  if (typeof closeOnBackpressureLimit !== "boolean") {
    throw new Error("app.ws(): closeOnBackpressureLimit must be a boolean.");
  }
  if (typeof perMessageDeflate !== "boolean") {
    throw new Error("app.ws(): perMessageDeflate must be a boolean.");
  }
  assertWebSocketOriginPolicy(handler.allowedOrigins);
  if (perMessageDeflate && context.secureDefaults && context.production) {
    throw new Error(
      "app.ws(): perMessageDeflate: true is refused in production under secureDefaults. " +
        "Leave it false or pass app({ secureDefaults: false }) only for a reviewed deployment.",
    );
  }
  const schemaMaxBytes = declaredSchemaMaxBytes(handler.request?.body);
  if (schemaMaxBytes !== undefined && maxPayloadLength > schemaMaxBytes) {
    throw new Error(
      `app.ws(): maxPayloadLength (${maxPayloadLength}) exceeds the route body schema maximum (${schemaMaxBytes}).`,
    );
  }
  return {
    closeOnBackpressureLimit,
    backpressureLimit,
    perMessageDeflate,
    idleTimeout,
    maxPayloadLength,
  };
}

/** Non-nullable `beforeUpgrade` hook type from {@link WebSocketHandler}, useful for adapter authors composing upgrade gates. */
export type WebSocketBeforeUpgrade<P extends string = string, S = AppState> = NonNullable<
  WebSocketHandler<P, S>["beforeUpgrade"]
>;

/**
 * Adapt `rateLimit({ groupId })` to the WebSocket upgrade boundary. Use it as
 * a `beforeUpgrade` handler to spend from the same shared buckets as HTTP
 * routes (for example, login and WebSocket session-establishment endpoints).
 *
 * @param options The same {@link RateLimitOptions} accepted by the HTTP `rateLimit` middleware.
 * @returns A `beforeUpgrade` hook that returns the 429 (or error) `Response` when the limit is exceeded, or `undefined` to allow the upgrade. Rate-limit headers are copied onto rejection responses.
 * @since 0.23.0
 */
export function wsRateLimit<P extends string = string, S = AppState>(
  options: RateLimitOptions,
): WebSocketBeforeUpgrade<P, S> {
  const hooks = rateLimit(options);
  return async (request, wsContext) => {
    const setHeaders = new Headers();
    const ctx: BaseContext<any, any> = {
      request,
      params: wsContext.params,
      query: wsContext.query,
      headers: wsContext.headers,
      body: undefined,
      state: wsContext.state as AppState & Record<string, unknown>,
      set: { headers: setHeaders },
    };
    try {
      const result = await hooks.beforeHandle?.(ctx);
      if (result instanceof Response) {
        copyWsRateLimitHeaders(setHeaders, result);
        return result;
      }
      return undefined;
    } catch (err) {
      const response = err instanceof HttpError
        ? err.toResponse()
        : new InternalError(err instanceof Error ? err.message : "WebSocket rate limit failed").toResponse();
      copyWsRateLimitHeaders(setHeaders, response);
      return response;
    }
  };
}

function copyWsRateLimitHeaders(headers: Headers, response: Response): void {
  headers.forEach((value, key) => {
    if (!response.headers.has(key)) response.headers.set(key, value);
  });
}

/**
 * Helper for declaring a handler with full type-inference.
 *
 * @param handler The {@link WebSocketHandler} to type-check; returned as-is.
 * @returns The same handler object, with `P`/`S`/`TData` inferred.
 */
export function defineWebSocket<
  P extends string,
  S = AppState,
  TData = unknown,
>(handler: WebSocketHandler<P, S, TData>): WebSocketHandler<P, S, TData> {
  return handler;
}

// ---------- WebSocket route registry ----------

/** Entry stored inside {@link WebSocketRegistry} for a single WS route. */
export interface WebSocketRouteEntry {
  /** Route path pattern the entry was registered under (may contain `:param` segments). */
  path: PathString;
  /** The user-supplied lifecycle handler for this route. */
  handler: WebSocketHandler<any, any, any>;
  /** Factory producing the per-upgrade `state` object handed to the context. */
  createState: WebSocketStateFactory;
  /** Resolved limits from {@link normalizeWebSocketOptions} applied by the adapter. */
  options: NormalizedWebSocketOptions;
}

type WebSocketStateFactory = () => Record<string, unknown>;

/**
 * Per-app registry of WebSocket routes. Uses the same trie router as HTTP so
 * `:param` and static-route fast paths work identically.
 *
 * Adapters call {@link WebSocketRegistry.find} during the HTTP `upgrade`
 * event (Node) or inside `fetch` (Bun / Workers).
 */
export class WebSocketRegistry {
  private router = new Router<WebSocketRouteEntry>(); private _size = 0;
  private entries: WebSocketRouteEntry[] = [];
  /**
   * Register a WebSocket route.
   *
   * @param path Route path pattern (supports `:param` segments).
   * @param handler Lifecycle handler for connections on this route.
   * @param createState Per-upgrade state factory. Defaults to `() => ({})`.
   * @param options Resolved limits; defaults to normalizing `handler` with dev-mode secure defaults.
   */
  add(
    path: PathString,
    handler: WebSocketHandler<any, any, any>,
    createState: WebSocketStateFactory = () => ({}),
    options: NormalizedWebSocketOptions = normalizeWebSocketOptions(handler, {
      production: false,
      secureDefaults: true,
    }),
  ): void {
    const entry = { path, handler, createState, options };
    this.router.add("GET", path, entry);
    this.entries.push(entry);
    this._size += 1;
  }

  /**
   * Match a request pathname against the registered WS routes.
   *
   * @param pathname URL pathname of the upgrade request.
   * @returns The matched entry plus extracted params, or `undefined` when no route matches.
   */
  find(pathname: string): RouteMatch<WebSocketRouteEntry> | undefined {
    return this.router.find("GET", pathname);
  }

  /**
   * List every registered WebSocket route entry in registration order.
   *
   * Returns a shallow copy so callers (the AsyncAPI generator, introspection
   * tooling) cannot mutate the registry's internal array. The entry objects
   * themselves are shared by reference and must be treated as read-only.
   *
   * @returns A new array of the registered {@link WebSocketRouteEntry} values.
   * @since 0.37.0
   */
  list(): WebSocketRouteEntry[] {
    return [...this.entries];
  }

  /** Number of registered WebSocket routes. */
  get size(): number {
    return this._size;
  }

  /**
   * Aggregate the per-route options into a single set for runtimes (Bun) that
   * take one server-wide WebSocket config: `closeOnBackpressureLimit` only when
   * every route enables it, largest `backpressureLimit`/`maxPayloadLength`,
   * smallest `idleTimeout`, and `perMessageDeflate` if any route enables it.
   * Returns the secure defaults when no routes are registered.
   *
   * @returns The merged {@link NormalizedWebSocketOptions} for the whole app.
   */
  runtimeOptions(): NormalizedWebSocketOptions {
    if (this.entries.length === 0) {
      return {
        closeOnBackpressureLimit: true,
        backpressureLimit: DEFAULT_WS_BACKPRESSURE_LIMIT,
        perMessageDeflate: false,
        idleTimeout: DEFAULT_WS_IDLE_TIMEOUT_SECONDS,
        maxPayloadLength: DEFAULT_WS_MAX_PAYLOAD_LENGTH,
      };
    }
    return {
      closeOnBackpressureLimit: this.entries.every(
        (entry) => entry.options.closeOnBackpressureLimit,
      ),
      backpressureLimit: Math.max(...this.entries.map((entry) => entry.options.backpressureLimit)),
      perMessageDeflate: this.entries.some((entry) => entry.options.perMessageDeflate),
      idleTimeout: Math.min(...this.entries.map((entry) => entry.options.idleTimeout)),
      maxPayloadLength: Math.max(...this.entries.map((entry) => entry.options.maxPayloadLength)),
    };
  }
}

// ---------- Handshake helpers ----------

const enc = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function getSubtle(): SubtleCrypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "websocket: Web Crypto (crypto.subtle) is required to compute Sec-WebSocket-Accept.",
    );
  }
  return c.subtle;
}

/**
 * Compute the `Sec-WebSocket-Accept` response header value for a given
 * `Sec-WebSocket-Key` per RFC 6455 §4.2.2:
 *
 * `base64(SHA1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`
 *
 * @param key - The client's `Sec-WebSocket-Key` header value.
 * @returns The base64-encoded accept token for the 101 response.
 * @throws Error when Web Crypto (`crypto.subtle`) is unavailable.
 */
export async function computeAcceptKey(key: string): Promise<string> {
  const digest = await getSubtle().digest("SHA-1", enc.encode(key + WS_GUID));
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Parse the offered subprotocols from a `Sec-WebSocket-Protocol` header.
 * Returns trimmed, non-empty tokens in client preference order.
 *
 * @param header - Raw header value; `null`/`undefined` yields an empty list.
 * @returns The offered subprotocol tokens, most-preferred first.
 */
export function parseSubprotocols(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const WS_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Validate a server-selected subprotocol before it is written to the 101
 * response. RFC 6455 requires the value to be one of the client-offered
 * tokens; enforcing it also prevents accidental response-header injection.
 *
 * @param protocol - The subprotocol the server wants to select.
 * @param offered - Tokens the client offered (from {@link parseSubprotocols}).
 * @returns The validated `protocol`, unchanged.
 * @throws WebSocketProtocolError when `protocol` is not a valid HTTP token
 *   or was not offered by the client.
 */
export function validateSelectedSubprotocol(
  protocol: string,
  offered: readonly string[],
): string {
  if (!WS_TOKEN_RE.test(protocol)) {
    throw new WebSocketProtocolError(
      "Selected WebSocket subprotocol must be a valid HTTP token",
    );
  }
  if (!offered.includes(protocol)) {
    throw new WebSocketProtocolError(
      "Selected WebSocket subprotocol was not offered by the client",
    );
  }
  return protocol;
}

/**
 * Result of attempting a handshake against an incoming HTTP request.
 * Adapters either send the 101 response and return `{ ok: true }` or send
 * the error response described by {@link HandshakeFailure} and abort.
 */
export type HandshakeResult =
  | { ok: true; acceptKey: string; protocols: string[] }
  | { ok: false; status: number; reason: string };

/**
 * Validate the upgrade request headers and compute the accept key when
 * valid. This helper does **not** touch the wire — it only decides whether
 * the handshake should succeed and what the response key should be.
 *
 * @param headers - Header accessor for the upgrade request (any object with
 *   a `Headers`-style `get`).
 * @returns `{ ok: true, acceptKey, protocols }` when the RFC 6455 handshake
 *   headers are valid, or `{ ok: false, status, reason }` describing the
 *   error response the adapter should send.
 */
export async function validateUpgrade(headers: {
  get(name: string): string | null;
}): Promise<HandshakeResult> {
  const upgrade = headers.get("upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return {
      ok: false,
      status: 400,
      reason: "Missing or invalid Upgrade header",
    };
  }
  const connection = headers.get("connection");
  if (!connection || !/\bupgrade\b/i.test(connection)) {
    return {
      ok: false,
      status: 400,
      reason: "Missing or invalid Connection header",
    };
  }
  const version = headers.get("sec-websocket-version");
  if (version !== "13") {
    return {
      ok: false,
      status: 426,
      reason: "Unsupported Sec-WebSocket-Version",
    };
  }
  const key = headers.get("sec-websocket-key");
  if (!key || !isValidWebSocketKey(key)) {
    return {
      ok: false,
      status: 400,
      reason: "Missing or invalid Sec-WebSocket-Key",
    };
  }
  const acceptKey = await computeAcceptKey(key);
  return {
    ok: true,
    acceptKey,
    protocols: parseSubprotocols(headers.get("sec-websocket-protocol")),
  };
}

function isValidWebSocketKey(key: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(key), (char) => char.charCodeAt(0));
    return bytes.length === 16;
  } catch {
    return false;
  }
}

/**
 * Validate the `Origin` header on a WebSocket upgrade request against the
 * route's `allowedOrigins` policy. Adapters call this **before** invoking
 * the route's `beforeUpgrade` hook so a Cross-Site WebSocket Hijacking
 * attempt is rejected with `403` before any authenticated handler runs.
 *
 * Returns `{ ok: true }` when the upgrade is permitted, otherwise
 * `{ ok: false, reason }` with a short human-readable reason suitable for
 * the upgrade-error body.
 *
 * @param request - The upgrade request whose `Origin` header is checked.
 * @param policy - The route's `allowedOrigins` value: `undefined` (allow
 *   all), `"same-origin"`, a string allowlist, or a predicate function.
 * @returns `{ ok: true }` when permitted, otherwise `{ ok: false, reason }`.
 * @since 0.33.0
 */
export function checkWebSocketOrigin(
  request: Request,
  policy: WebSocketHandler<any, any, any>["allowedOrigins"],
): { ok: true } | { ok: false; reason: string } {
  if (policy === undefined) return { ok: true };
  const origin = request.headers.get("origin");
  if (typeof policy === "function") {
    let allowed: boolean;
    try {
      allowed = policy(origin, request) === true;
    } catch {
      return { ok: false, reason: "WebSocket origin check failed" };
    }
    return allowed
      ? { ok: true }
      : { ok: false, reason: "WebSocket upgrade rejected by origin policy" };
  }
  // For string-list and "same-origin" policies, a missing Origin header
  // means the client is not a browser (browsers always attach Origin on
  // a WS handshake) and the CSWSH class of attack is not reachable, so we
  // allow it through. Callers that want to reject non-browser clients can
  // pass a predicate function.
  if (origin === null) return { ok: true };
  if (policy === "same-origin") {
    try {
      const requestOrigin = new URL(request.url).origin;
      return origin === requestOrigin
        ? { ok: true }
        : {
            ok: false,
            reason: "WebSocket upgrade rejected: cross-origin handshake",
          };
    } catch {
      return { ok: false, reason: "WebSocket origin check failed" };
    }
  }
  if (!Array.isArray(policy)) {
    return { ok: false, reason: "WebSocket origin policy is invalid" };
  }
  // string[] allowlist
  return policy.includes(origin)
    ? { ok: true }
    : {
        ok: false,
        reason: "WebSocket upgrade rejected: origin not allowlisted",
      };
}

// ---------- Frame protocol (RFC 6455 §5) ----------

/** A single decoded RFC 6455 frame, as returned by {@link parseFrame}. */
export interface ParsedFrame {
  /** FIN bit — `true` when this frame ends a message. */
  fin: boolean;
  /** Frame opcode (see `WS_OPCODE`): continuation, text, binary, close, ping, or pong. */
  opcode: number;
  /** Unmasked payload bytes — a subarray view over the input buffer, not a copy. */
  payload: Uint8Array;
  /** Number of bytes consumed from the input buffer (header + payload). */
  consumed: number;
}

/** Returned from `parseFrame` when the buffer doesn't yet hold a full frame. */
export const FRAME_INCOMPLETE = Symbol("daloy.ws.frameIncomplete");

/**
 * Parse a single frame from `buf` starting at offset 0. Returns
 * {@link FRAME_INCOMPLETE} when the buffer is too short for a complete
 * frame; throws {@link WebSocketProtocolError} for RFC 6455 violations.
 *
 * The parser unmasks payloads in-place when needed. The returned `payload`
 * is a subarray view over `buf`; copy it if you intend to retain it past
 * the next call.
 *
 * @param buf - Buffered socket bytes beginning at a frame boundary.
 * @param opts - `requireMask: true` enforces the RFC 6455 rule that
 *   client-to-server frames are masked. Defaults to `{}` (not enforced).
 * @returns The decoded {@link ParsedFrame}, or {@link FRAME_INCOMPLETE}
 *   when more bytes are needed.
 * @throws WebSocketProtocolError on RSV bits, unknown opcodes, fragmented
 *   or oversized control frames, unmasked client frames, or payload lengths
 *   above `Number.MAX_SAFE_INTEGER`.
 */
export function parseFrame(
  buf: Uint8Array,
  opts: { requireMask?: boolean } = {},
): ParsedFrame | typeof FRAME_INCOMPLETE {
  if (buf.length < 2) return FRAME_INCOMPLETE;
  const b0 = buf[0]!;
  const b1 = buf[1]!;
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  if (rsv !== 0)
    throw new WebSocketProtocolError(
      "RSV bits must be zero (no extensions negotiated)",
    );
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let payloadLen = b1 & 0x7f;
  let offset = 2;

  if ((opcode & 0x8) !== 0) {
    if (!fin)
      throw new WebSocketProtocolError("Control frames must not be fragmented");
    if (payloadLen > WS_MAX_CONTROL_PAYLOAD)
      throw new WebSocketProtocolError(
        "Control frame payload exceeds 125 bytes",
      );
    if (
      opcode !== WS_OPCODE.CLOSE &&
      opcode !== WS_OPCODE.PING &&
      opcode !== WS_OPCODE.PONG
    )
      throw new WebSocketProtocolError(
        `Unknown control opcode 0x${opcode.toString(16)}`,
      );
  } else if (
    opcode !== WS_OPCODE.CONTINUATION &&
    opcode !== WS_OPCODE.TEXT &&
    opcode !== WS_OPCODE.BINARY
  ) {
    throw new WebSocketProtocolError(
      `Unknown data opcode 0x${opcode.toString(16)}`,
    );
  }

  if (payloadLen === 126) {
    if (buf.length < offset + 2) return FRAME_INCOMPLETE;
    payloadLen = (buf[offset]! << 8) | buf[offset + 1]!;
    offset += 2;
  } else if (payloadLen === 127) {
    if (buf.length < offset + 8) return FRAME_INCOMPLETE;
    // JS numbers safely represent up to 2^53 - 1. RFC permits 64-bit; we cap.
    const hi =
      buf[offset]! * 2 ** 24 +
      (buf[offset + 1]! << 16) +
      (buf[offset + 2]! << 8) +
      buf[offset + 3]!;
    const lo =
      buf[offset + 4]! * 2 ** 24 +
      (buf[offset + 5]! << 16) +
      (buf[offset + 6]! << 8) +
      buf[offset + 7]!;
    if (hi > 0x1fffff)
      throw new WebSocketProtocolError(
        "Frame payload exceeds Number.MAX_SAFE_INTEGER",
      );
    payloadLen = hi * 2 ** 32 + lo;
    offset += 8;
  }

  if (opts.requireMask && !masked) {
    throw new WebSocketProtocolError("Client frames must be masked");
  }

  let mask: Uint8Array | undefined;
  if (masked) {
    if (buf.length < offset + 4) return FRAME_INCOMPLETE;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + payloadLen) return FRAME_INCOMPLETE;

  const payload = buf.subarray(offset, offset + payloadLen);
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i]! ^ mask[i & 3]!;
    }
  }

  return { fin, opcode, payload, consumed: offset + payloadLen };
}

/**
 * Encode a single frame. By default the frame is emitted unmasked (server
 * → client). Pass `mask: true` to generate a client-style masked frame (used
 * mainly for testing).
 *
 * @param opts - Frame parts: `opcode` (required), `payload` (default empty),
 *   `fin` (default `true`), and `mask` (default `false`).
 * @returns The wire-ready frame bytes (header + payload).
 * @throws WebSocketProtocolError when a control-frame payload exceeds 125
 *   bytes; Error when masking is requested without Web Crypto.
 */
export function encodeFrame(opts: {
  fin?: boolean;
  opcode: number;
  payload?: Uint8Array;
  mask?: boolean;
}): Uint8Array {
  const fin = opts.fin !== false;
  const opcode = opts.opcode & 0x0f;
  const payload = opts.payload ?? new Uint8Array(0);
  const masked = opts.mask === true;

  if ((opcode & 0x8) !== 0 && payload.length > WS_MAX_CONTROL_PAYLOAD) {
    throw new WebSocketProtocolError("Control frame payload exceeds 125 bytes");
  }

  let headerLen = 2;
  let extLen: 0 | 2 | 8 = 0;
  if (payload.length >= 65536) extLen = 8;
  else if (payload.length > 125) extLen = 2;
  headerLen += extLen;
  if (masked) headerLen += 4;

  const out = new Uint8Array(headerLen + payload.length);
  out[0] = (fin ? 0x80 : 0) | opcode;
  if (extLen === 0) out[1] = (masked ? 0x80 : 0) | payload.length;
  else if (extLen === 2) {
    out[1] = (masked ? 0x80 : 0) | 126;
    out[2] = (payload.length >> 8) & 0xff;
    out[3] = payload.length & 0xff;
  } else {
    out[1] = (masked ? 0x80 : 0) | 127;
    // High 4 bytes are always 0 because JS numbers can't exceed 2^53.
    const len = payload.length;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 0;
    out[6] = Math.floor(len / 2 ** 24) & 0xff;
    out[7] = (len >> 16) & 0xff;
    out[8] = (len >> 8) & 0xff;
    out[9] = len & 0xff;
    // Fix high-32 bits when length actually exceeds 2^32 (defensive; JS arrays cap).
    if (len > 0xffffffff) {
      out[2] = Math.floor(len / 2 ** 56) & 0xff;
      out[3] = Math.floor(len / 2 ** 48) & 0xff;
      out[4] = Math.floor(len / 2 ** 40) & 0xff;
      out[5] = Math.floor(len / 2 ** 32) & 0xff;
    }
  }

  if (masked) {
    const maskOff = 2 + extLen;
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (!c?.getRandomValues) {
      throw new Error(
        "websocket: Web Crypto getRandomValues required to mask frames",
      );
    }
    c.getRandomValues(out.subarray(maskOff, maskOff + 4));
    const mask = out.subarray(maskOff, maskOff + 4);
    const dataOff = maskOff + 4;
    for (let i = 0; i < payload.length; i++) {
      out[dataOff + i] = payload[i]! ^ mask[i & 3]!;
    }
  } else {
    out.set(payload, 2 + extLen);
  }

  return out;
}

/**
 * Encode a CLOSE frame payload (`uint16 code` + optional UTF-8 reason).
 *
 * @param code - RFC 6455 close status code, written big-endian.
 * @param reason - Optional human-readable reason. Defaults to `""`.
 * @returns The 2+N byte close payload.
 * @throws WebSocketProtocolError when the encoded reason exceeds 123 bytes.
 */
export function encodeClosePayload(code: number, reason = ""): Uint8Array {
  const reasonBytes = enc.encode(reason);
  if (reasonBytes.length > WS_MAX_CONTROL_PAYLOAD - 2) {
    throw new WebSocketProtocolError("Close reason exceeds 123 bytes");
  }
  const out = new Uint8Array(2 + reasonBytes.length);
  out[0] = (code >> 8) & 0xff;
  out[1] = code & 0xff;
  out.set(reasonBytes, 2);
  return out;
}

/**
 * Decode a CLOSE frame payload. Returns `{ code: 1005, reason: "" }` when empty.
 *
 * @param payload - Unmasked close-frame payload bytes.
 * @returns The close `code` and decoded UTF-8 `reason`.
 * @throws WebSocketProtocolError when the payload is exactly 1 byte or the
 *   reason is not valid UTF-8.
 */
export function decodeClosePayload(payload: Uint8Array): {
  code: number;
  reason: string;
} {
  if (payload.length === 0)
    return { code: WS_CLOSE_CODE.NO_STATUS_RECEIVED, reason: "" };
  if (payload.length === 1)
    throw new WebSocketProtocolError("Close payload must be empty or ≥2 bytes");
  const code = (payload[0]! << 8) | payload[1]!;
  const reason = new TextDecoder("utf-8", { fatal: true }).decode(
    payload.subarray(2),
  );
  return { code, reason };
}

/** Thrown on RFC 6455 violations. Adapters map these to a CLOSE(1002) frame. */
export class WebSocketProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSocketProtocolError";
  }
}

/** Specialization of {@link WebSocketProtocolError} thrown when an inbound message exceeds the configured `maxPayloadLength`. */
export class WebSocketPayloadTooLargeError extends WebSocketProtocolError {
  constructor(
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`WebSocket message exceeds maxPayloadLength (${actual} > ${limit})`);
    this.name = "WebSocketPayloadTooLargeError";
  }
}

// ---------- Streaming frame parser ----------

/**
 * Incremental parser that buffers bytes from a socket and emits whole
 * frames. Handles fragmentation, interleaved control frames, and UTF-8
 * validation of text messages.
 */
export interface MessageEvent {
  /** Decoded string for text messages, or the raw byte payload for binary. */
  data: string | Uint8Array;
  /** True when the message was assembled from binary frames. */
  isBinary: boolean;
}

/** Callbacks supplied to a {@link FrameSink} by an adapter to receive decoded frames and protocol events. */
export interface FrameSinkEvents {
  /** A complete (possibly reassembled) text or binary message arrived. */
  onMessage(ev: MessageEvent): void;
  /** A PING control frame arrived; `payload` is a copied buffer. */
  onPing(payload: Uint8Array): void;
  /** A PONG control frame arrived; `payload` is a copied buffer. */
  onPong(payload: Uint8Array): void;
  /** A CLOSE frame arrived; the sink stops processing further input. */
  onClose(code: number, reason: string): void;
  /** An RFC 6455 violation was detected; the adapter should CLOSE(1002). */
  onProtocolError(err: WebSocketProtocolError): void;
}

/**
 * Stream-oriented assembler. Push chunks via {@link FrameSink.push}; callbacks
 * fire as whole messages and control frames become available. Designed to be
 * driven by an adapter's socket `data` event.
 */
export class FrameSink {
  private buffer: Uint8Array = new Uint8Array(0);
  private fragments: Uint8Array[] = [];
  private fragmentOpcode = -1;
  private fragmentBytes = 0;
  private closed = false;

  constructor(
    private readonly opts: FrameSinkEvents & {
      requireMask?: boolean;
      maxPayloadLength?: number;
    },
  ) {}

  /**
   * Feed raw socket bytes into the assembler. Complete frames trigger the
   * configured callbacks; partial frames are buffered until more bytes
   * arrive. No-op after a CLOSE frame or protocol error.
   *
   * @param chunk - The next bytes read from the socket.
   */
  push(chunk: Uint8Array): void {
    if (this.closed) return;
    if (this.buffer.length === 0) {
      this.buffer = chunk.slice();
    } else {
      const next = new Uint8Array(this.buffer.length + chunk.length);
      next.set(this.buffer, 0);
      next.set(chunk, this.buffer.length);
      this.buffer = next;
    }
    try {
      while (this.buffer.length > 0) {
        const frame = parseFrame(this.buffer, {
          requireMask: this.opts.requireMask,
        });
        if (frame === FRAME_INCOMPLETE) return;
        this.buffer = this.buffer.subarray(frame.consumed);
        this.handle(frame);
        if (this.closed) return;
      }
    } catch (err) {
      if (err instanceof WebSocketProtocolError) {
        this.closed = true;
        this.opts.onProtocolError(err);
      } else {
        throw err;
      }
    }
  }

  private handle(frame: ParsedFrame): void {
    if ((frame.opcode & 0x8) !== 0) {
      // Control frame — copy payload because the buffer slice may be reused.
      const copy = frame.payload.slice();
      if (frame.opcode === WS_OPCODE.CLOSE) {
        const { code, reason } = decodeClosePayload(copy);
        this.closed = true;
        this.opts.onClose(code, reason);
      } else if (frame.opcode === WS_OPCODE.PING) {
        this.opts.onPing(copy);
      } else {
        this.opts.onPong(copy);
      }
      return;
    }

    if (frame.opcode === WS_OPCODE.CONTINUATION) {
      if (this.fragmentOpcode === -1) {
        throw new WebSocketProtocolError(
          "Continuation frame without an initial data frame",
        );
      }
      this.assertMessageSize(frame.payload.length);
      this.fragments.push(frame.payload.slice());
    } else {
      if (this.fragmentOpcode !== -1) {
        throw new WebSocketProtocolError(
          "New data frame received while a fragmented message is in progress",
        );
      }
      this.fragmentOpcode = frame.opcode;
      this.assertMessageSize(frame.payload.length);
      this.fragments.push(frame.payload.slice());
    }

    if (frame.fin) {
      const total = this.fragments.reduce((n, p) => n + p.length, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const p of this.fragments) {
        joined.set(p, offset);
        offset += p.length;
      }
      const isBinary = this.fragmentOpcode === WS_OPCODE.BINARY;
      this.fragments = [];
      this.fragmentOpcode = -1;
      this.fragmentBytes = 0;
      if (isBinary) {
        this.opts.onMessage({ data: joined, isBinary: true });
      } else {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
        } catch {
          throw new WebSocketProtocolError("Invalid UTF-8 in text message");
        }
        this.opts.onMessage({ data: text, isBinary: false });
      }
    }
  }

  private assertMessageSize(nextPayloadLength: number): void {
    const limit = this.opts.maxPayloadLength;
    const nextTotal = this.fragmentBytes + nextPayloadLength;
    if (limit !== undefined && nextTotal > limit) {
      throw new WebSocketPayloadTooLargeError(limit, nextTotal);
    }
    this.fragmentBytes = nextTotal;
  }
}

// ---------- Helpers shared by adapters ----------

/**
 * Coerce arbitrary `send()` payloads to a `Uint8Array` + opcode pair.
 *
 * @param data - A string (sent as TEXT) or any `ArrayBuffer`/view (sent as
 *   BINARY without copying when possible).
 * @returns The `WS_OPCODE` to use and the payload bytes to frame.
 */
export function encodeSendPayload(
  data: string | ArrayBufferLike | ArrayBufferView,
): { opcode: number; payload: Uint8Array } {
  if (typeof data === "string") {
    return { opcode: WS_OPCODE.TEXT, payload: enc.encode(data) };
  }
  if (data instanceof Uint8Array) {
    return { opcode: WS_OPCODE.BINARY, payload: data };
  }
  if (ArrayBuffer.isView(data)) {
    return {
      opcode: WS_OPCODE.BINARY,
      payload: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    };
  }
  return {
    opcode: WS_OPCODE.BINARY,
    payload: new Uint8Array(data as ArrayBufferLike),
  };
}
