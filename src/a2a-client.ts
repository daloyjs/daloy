import type {
  A2aAgentCard,
  A2aAgentInterface,
  A2aMessage,
  A2aPart,
  A2aTask,
  A2aTaskState,
} from "./a2a.js";
import { fetchGuard } from "./fetch-guard.js";
import { randomId, safeJsonParseLimited } from "./security.js";

/** Protocol version this client speaks; matches the server in `a2a.ts`. */
const CLIENT_PROTOCOL_VERSION = "1.0";
const WELL_KNOWN_CARD = "/.well-known/agent-card.json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1 << 20;
const DEFAULT_CARD_MAX_AGE_MS = 300_000;
/** W3C Trace Context `traceparent`: version-traceid-parentid-flags, all lowercase hex. */
const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;
const MAX_TRACESTATE_LENGTH = 512;

/**
 * Error thrown by {@link createA2aClient} calls: a JSON-RPC error from the
 * remote agent (`code` is the A2A / JSON-RPC code, e.g. `-32001`), or a
 * client-side refusal (`code` is `0`) such as an unsafe card, an oversized
 * or malformed response, or a timeout. The message never contains request
 * headers, so credentials cannot leak through logged errors.
 *
 * @since 1.5.0
 */
export class A2aClientError extends Error {
  /** A2A / JSON-RPC error code from the agent, or `0` for a client-side refusal. */
  readonly code: number;
  /** `error.data` from the agent, when it sent one. */
  readonly data?: unknown;
  /** HTTP status of the response, when there was one. */
  readonly status?: number;
  /**
   * @param message - Safe, human-readable description.
   * @param code - Remote JSON-RPC code, or `0` for client-side errors.
   * @param extra - Optional remote `data`, HTTP `status`, and underlying `cause`
   *   (for example an `SsrfBlockedError` from the guarded transport).
   */
  constructor(
    message: string,
    code = 0,
    extra: { data?: unknown; status?: number; cause?: unknown } = {}
  ) {
    super(message, extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = "A2aClientError";
    this.code = code;
    if (extra.data !== undefined) this.data = extra.data;
    if (extra.status !== undefined) this.status = extra.status;
  }
}

/**
 * Options for {@link createA2aClient}.
 *
 * @since 1.5.0
 */
export interface A2aClientOptions {
  /**
   * The remote agent: its base URL (the card is read from
   * `/.well-known/agent-card.json`) or the full Agent Card URL. Must be
   * `https:` unless the host is loopback or {@link allowInsecureHttp} is set.
   */
  url: string;
  /**
   * Transport. Defaults to `fetchGuard()`, which refuses loopback, private,
   * link-local, and cloud-metadata addresses (SSRF). On runtimes without a
   * DNS resolver (Cloudflare Workers, some Deno setups) pass
   * `fetchGuard({ resolve })`. Passing a plain `fetch` turns SSRF protection
   * off; only do that for agents you fully control.
   */
  fetch?: typeof fetch;
  /**
   * Headers sent on every JSON-RPC call, typically auth
   * (`{ authorization: "Bearer ..." }`). A function is called per request, so
   * short-lived tokens stay fresh. Never sent when fetching the public card.
   */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /**
   * Extra origins the card's JSON-RPC URL may point at. By default it must
   * share the card's origin: a card is controlled by the remote party, and
   * without this check it could name any host as the endpoint that receives
   * your credentials.
   */
  allowedOrigins?: readonly string[];
  /** Allow plain `http:` to non-loopback hosts. Default `false`. */
  allowInsecureHttp?: boolean;
  /** Per-request timeout in milliseconds. Default 10 seconds. */
  timeoutMs?: number;
  /** Maximum accepted response body in bytes. Default 1 MiB. */
  maxResponseBytes?: number;
  /** How long a fetched Agent Card is reused, in milliseconds. Default 5 minutes. */
  cardMaxAgeMs?: number;
  /** Extension URIs to activate, sent as the `A2A-Extensions` header. */
  extensions?: readonly string[];
  /**
   * Forward trace context to the remote agent. Off by default, because trace
   * ids are not always meant to cross a trust boundary.
   *
   * - `true`: copy a valid W3C `traceparent` (and `tracestate`) from the
   *   `request` passed to each call. `baggage` is never forwarded, because
   *   it often carries user data.
   * - a function: called with the outgoing headers and the call's `request`,
   *   e.g. to run an OpenTelemetry propagator:
   *   `(headers) => propagation.inject(context.active(), headers, headerSetter)`.
   */
  propagateTrace?: boolean | ((headers: Headers, request: Request | undefined) => void);
}

/**
 * Per-call options shared by every {@link A2aClient} method.
 *
 * @since 1.5.0
 */
export interface A2aCallOptions {
  /** Cancel the call. Combined with the client's timeout. */
  signal?: AbortSignal;
  /**
   * The incoming request being handled (for example `ctx.request` in a
   * DaloyJS handler). Used only for trace propagation.
   */
  request?: Request;
}

/**
 * Message content for {@link A2aClient.sendMessage}: a string (one text part),
 * an array of parts, or a full message body.
 *
 * @since 1.5.0
 */
export type A2aOutgoingMessage =
  | string
  | readonly A2aPart[]
  | {
      parts: readonly A2aPart[];
      contextId?: string;
      taskId?: string;
      metadata?: Record<string, unknown>;
      referenceTaskIds?: readonly string[];
    };

/**
 * Result of {@link A2aClient.sendMessage}: exactly one of a direct message or
 * a task.
 *
 * @since 1.5.0
 */
export type A2aSendResult = { message: A2aMessage; task?: undefined } | { task: A2aTask; message?: undefined };

/**
 * One page of {@link A2aClient.listTasks}.
 *
 * @since 1.5.0
 */
export interface A2aListTasksResult {
  tasks: A2aTask[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}

/**
 * Client for one remote A2A 1.0 agent, returned by {@link createA2aClient}.
 *
 * @since 1.5.0
 */
export interface A2aClient {
  /** Fetch (or reuse the cached) public Agent Card. */
  getAgentCard(options?: A2aCallOptions): Promise<A2aAgentCard>;
  /** Send a message. `messageId` and `role` are filled in for you. */
  sendMessage(
    message: A2aOutgoingMessage,
    options?: A2aCallOptions & {
      acceptedOutputModes?: readonly string[];
      historyLength?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<A2aSendResult>;
  /** Read a task (requires the agent to keep tasks). */
  getTask(id: string, options?: A2aCallOptions & { historyLength?: number }): Promise<A2aTask>;
  /** Cancel a task that has not finished. */
  cancelTask(id: string, options?: A2aCallOptions): Promise<A2aTask>;
  /** List tasks visible to your credentials. */
  listTasks(
    query?: {
      contextId?: string;
      status?: A2aTaskState;
      pageSize?: number;
      pageToken?: string;
      historyLength?: number;
      includeArtifacts?: boolean;
    },
    options?: A2aCallOptions
  ): Promise<A2aListTasksResult>;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function assertSafeUrl(raw: string, what: string, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new A2aClientError(`A2A ${what} is not an absolute URL.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new A2aClientError(`A2A ${what} must not embed credentials.`);
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && (allowInsecureHttp || isLoopbackHost(url.hostname))) return url;
  throw new A2aClientError(`A2A ${what} must use https: (got ${url.protocol}).`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readCapped(res: Response, limit: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new A2aClientError("A2A response is larger than maxResponseBytes.", 0, { status: res.status });
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new A2aClientError("A2A response is larger than maxResponseBytes.", 0, { status: res.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new A2aClientError("A2A response is not valid UTF-8.", 0, { status: res.status });
  }
}

function partsOf(input: string | readonly A2aPart[]): A2aPart[] {
  return typeof input === "string" ? [{ text: input }] : input.map((part) => ({ ...part }));
}

/**
 * Create a client for a remote A2A 1.0 agent (JSON-RPC binding).
 *
 * Built for services that delegate work to other agents, with the same
 * posture as the rest of DaloyJS:
 *
 * - SSRF-guarded transport by default (`fetchGuard()`).
 * - The public Agent Card is fetched without credentials, and the JSON-RPC
 *   URL it names must share its origin (or be in `allowedOrigins`), so a
 *   malicious card cannot redirect your credentials to another host.
 * - `https:` only (loopback excepted), redirects are never followed, and
 *   responses are size-capped, parsed with prototype-pollution-safe JSON,
 *   and checked for a matching JSON-RPC id and a well-formed result.
 * - Timeouts on every call; optional, opt-in trace propagation.
 *
 * @param options - See {@link A2aClientOptions}.
 * @returns An {@link A2aClient}.
 * @throws {A2aClientError} Synchronously when `url` is unsafe or limits are invalid;
 *   the returned methods reject with it on remote or protocol errors.
 *
 * @example
 * ```ts
 * const inventory = createA2aClient({
 *   url: "https://inventory.acme.example",
 *   headers: async () => ({ authorization: `Bearer ${await tokenFor("inventory")}` }),
 *   propagateTrace: true,
 * });
 * const result = await inventory.sendMessage([a2aData({ sku: "ABC-1" })], { request: ctx.request });
 * if (result.task?.status.state === "TASK_STATE_COMPLETED") use(result.task.artifacts);
 * ```
 *
 * @since 1.5.0
 */
export function createA2aClient(options: A2aClientOptions): A2aClient {
  const allowInsecureHttp = options.allowInsecureHttp === true;
  const base = assertSafeUrl(options.url, "url", allowInsecureHttp);
  const cardUrl = base.pathname.endsWith(".json") ? base : new URL(WELL_KNOWN_CARD, base);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const cardMaxAgeMs = options.cardMaxAgeMs ?? DEFAULT_CARD_MAX_AGE_MS;
  for (const [name, value] of [
    ["timeoutMs", timeoutMs],
    ["maxResponseBytes", maxResponseBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new A2aClientError(`A2A client ${name} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(cardMaxAgeMs) || cardMaxAgeMs < 0) {
    throw new A2aClientError("A2A client cardMaxAgeMs must be a non-negative safe integer.");
  }
  const allowedOrigins = new Set<string>([cardUrl.origin]);
  for (const origin of options.allowedOrigins ?? []) {
    allowedOrigins.add(assertSafeUrl(origin, "allowedOrigins entry", allowInsecureHttp).origin);
  }
  const transport = options.fetch ?? fetchGuard();
  const extensionsHeader =
    options.extensions && options.extensions.length > 0 ? options.extensions.join(",") : undefined;

  let cached: { card: A2aAgentCard; iface: A2aAgentInterface; rpcHref: string; at: number } | undefined;

  function signalFor(callSignal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return callSignal ? AbortSignal.any([callSignal, timeout]) : timeout;
  }

  async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    try {
      // Never follow redirects: a redirect could carry credentials to a host
      // the origin check never saw.
      return await transport(url, { ...init, redirect: "error", signal });
    } catch (error) {
      if (signal.aborted) {
        throw new A2aClientError(
          signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
            ? `A2A request timed out after ${timeoutMs} ms.`
            : "A2A request was aborted."
        );
      }
      if (error instanceof A2aClientError) throw error;
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      throw new A2aClientError(`A2A request failed (${name}): ${message}`, 0, { cause: error });
    }
  }

  async function discover(callOptions: A2aCallOptions = {}): Promise<{ card: A2aAgentCard; iface: A2aAgentInterface; rpcHref: string }> {
    if (cached && Date.now() - cached.at < cardMaxAgeMs) return cached;
    const signal = signalFor(callOptions.signal);
    // No credentials here: the card is public, and it has not been vetted yet.
    const res = await send(cardUrl.href, { method: "GET", headers: { accept: "application/json" } }, signal);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new A2aClientError(`A2A Agent Card request failed with HTTP ${res.status}.`, 0, { status: res.status });
    }
    let card: unknown;
    try {
      card = safeJsonParseLimited(await readCapped(res, maxResponseBytes));
    } catch (error) {
      if (error instanceof A2aClientError) throw error;
      throw new A2aClientError("A2A Agent Card is not valid JSON.");
    }
    if (!isPlainObject(card) || typeof card.name !== "string" || !Array.isArray(card.supportedInterfaces)) {
      throw new A2aClientError("A2A Agent Card is missing name or supportedInterfaces.");
    }
    const iface = (card.supportedInterfaces as unknown[]).find(
      (entry): entry is A2aAgentInterface =>
        isPlainObject(entry) &&
        entry.protocolBinding === "JSONRPC" &&
        entry.protocolVersion === CLIENT_PROTOCOL_VERSION &&
        typeof entry.url === "string"
    );
    if (!iface) {
      throw new A2aClientError(`A2A Agent Card has no JSONRPC ${CLIENT_PROTOCOL_VERSION} interface.`);
    }
    const rpcUrl = assertSafeUrl(iface.url, "interface url", allowInsecureHttp);
    if (!allowedOrigins.has(rpcUrl.origin)) {
      throw new A2aClientError(
        `A2A Agent Card points its endpoint at ${rpcUrl.origin}, which is not the card's origin or an allowedOrigins entry. Refusing to send credentials there.`
      );
    }
    // Send to the URL that was validated, not the card's raw string, so a
    // custom `fetch` transport cannot parse it differently from the check.
    cached = { card: card as unknown as A2aAgentCard, iface, rpcHref: rpcUrl.href, at: Date.now() };
    return cached;
  }

  async function call(method: string, params: Record<string, unknown>, callOptions: A2aCallOptions = {}): Promise<unknown> {
    const { iface, rpcHref } = await discover(callOptions);
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "a2a-version": CLIENT_PROTOCOL_VERSION,
    });
    const extra = typeof options.headers === "function" ? await options.headers() : options.headers;
    for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
    if (extensionsHeader !== undefined) headers.set("a2a-extensions", extensionsHeader);
    if (options.propagateTrace === true) {
      const traceparent = callOptions.request?.headers.get("traceparent");
      if (traceparent && TRACEPARENT_PATTERN.test(traceparent)) {
        headers.set("traceparent", traceparent);
        const tracestate = callOptions.request?.headers.get("tracestate");
        if (tracestate && tracestate.length <= MAX_TRACESTATE_LENGTH) headers.set("tracestate", tracestate);
      }
    } else if (typeof options.propagateTrace === "function") {
      options.propagateTrace(headers, callOptions.request);
    }
    // Spec 4.4.6: when the interface declares a tenant, every request carries it.
    const body = iface.tenant !== undefined ? { tenant: iface.tenant, ...params } : params;
    const id = randomId();
    const signal = signalFor(callOptions.signal);
    const res = await send(
      rpcHref,
      { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params: body }) },
      signal
    );
    let envelope: unknown;
    try {
      envelope = safeJsonParseLimited(await readCapped(res, maxResponseBytes));
    } catch (error) {
      if (error instanceof A2aClientError) throw error;
      throw new A2aClientError(`A2A agent returned a non-JSON response (HTTP ${res.status}).`, 0, { status: res.status });
    }
    if (!isPlainObject(envelope) || envelope.jsonrpc !== "2.0") {
      throw new A2aClientError(`A2A agent returned a malformed JSON-RPC response (HTTP ${res.status}).`, 0, { status: res.status });
    }
    if (isPlainObject(envelope.error)) {
      const code = typeof envelope.error.code === "number" ? envelope.error.code : 0;
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "A2A agent error";
      throw new A2aClientError(message.slice(0, 500), code, { data: envelope.error.data, status: res.status });
    }
    if (envelope.id !== id) {
      throw new A2aClientError("A2A agent response id does not match the request.", 0, { status: res.status });
    }
    if (!("result" in envelope)) {
      throw new A2aClientError("A2A agent response has neither result nor error.", 0, { status: res.status });
    }
    return envelope.result;
  }

  function asTask(value: unknown, what: string): A2aTask {
    if (!isPlainObject(value) || typeof value.id !== "string" || !isPlainObject(value.status)) {
      throw new A2aClientError(`A2A agent returned an invalid ${what}.`);
    }
    return value as unknown as A2aTask;
  }

  return {
    async getAgentCard(callOptions) {
      return (await discover(callOptions)).card;
    },

    async sendMessage(message, callOptions = {}) {
      const body =
        typeof message === "string" || Array.isArray(message)
          ? { parts: partsOf(message as string | readonly A2aPart[]) }
          : {
              ...(message as Exclude<A2aOutgoingMessage, string | readonly A2aPart[]>),
              parts: partsOf((message as { parts: readonly A2aPart[] }).parts),
            };
      const configuration: Record<string, unknown> = {};
      if (callOptions.acceptedOutputModes) configuration.acceptedOutputModes = [...callOptions.acceptedOutputModes];
      if (callOptions.historyLength !== undefined) configuration.historyLength = callOptions.historyLength;
      const params: Record<string, unknown> = {
        message: { messageId: randomId(), role: "ROLE_USER", ...body },
        ...(Object.keys(configuration).length > 0 ? { configuration } : {}),
        ...(callOptions.metadata ? { metadata: callOptions.metadata } : {}),
      };
      const result = await call("SendMessage", params, callOptions);
      if (!isPlainObject(result)) throw new A2aClientError("A2A agent returned an invalid SendMessage result.");
      const hasTask = isPlainObject(result.task);
      const hasMessage = isPlainObject(result.message);
      if (hasTask === hasMessage) {
        throw new A2aClientError("A2A SendMessage result must contain exactly one of task or message.");
      }
      return hasTask
        ? { task: asTask(result.task, "task") }
        : { message: result.message as unknown as A2aMessage };
    },

    async getTask(id, callOptions = {}) {
      const params: Record<string, unknown> = { id };
      if (callOptions.historyLength !== undefined) params.historyLength = callOptions.historyLength;
      return asTask(await call("GetTask", params, callOptions), "task");
    },

    async cancelTask(id, callOptions = {}) {
      return asTask(await call("CancelTask", { id }, callOptions), "task");
    },

    async listTasks(query = {}, callOptions = {}) {
      const result = await call("ListTasks", { ...query }, callOptions);
      if (!isPlainObject(result) || !Array.isArray(result.tasks)) {
        throw new A2aClientError("A2A agent returned an invalid ListTasks result.");
      }
      return result as unknown as A2aListTasksResult;
    },
  };
}
