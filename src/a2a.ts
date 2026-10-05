import { readNodeEnv } from "./internal-env.js";
import type { Hooks, PathString, RouteDefinition } from "./types.js";
import type { StandardSchemaV1 } from "./schema.js";
import { mediaTypeEssence, randomId, safeJsonParseLimited } from "./security.js";
import { compileOriginAllowlist, isAllowedAgentOrigin } from "./origin-allowlist.js";

/**
 * A2A protocol version this module implements (`Major.Minor`).
 *
 * @see https://a2a-protocol.org/latest/specification/
 * @since 1.4.0
 */
export const A2A_PROTOCOL_VERSION = "1.0";

/**
 * Well-known path where peers discover the public Agent Card (RFC 8615).
 *
 * @since 1.4.0
 */
export const A2A_AGENT_CARD_PATH = "/.well-known/agent-card.json";

/**
 * Default cap on the JSON-RPC request body, in bytes (256 KiB). Matches the
 * MCP default. Raise it with `maxBodyBytes` when peers send inline files.
 *
 * @since 1.4.0
 */
export const A2A_DEFAULT_MAX_BODY_BYTES = 1 << 18;

/**
 * JSON-RPC error codes defined by A2A 1.0 (spec section 5.4), plus the
 * standard JSON-RPC codes this binding emits.
 *
 * @since 1.4.0
 */
export const A2A_ERROR_CODES: {
  readonly parseError: -32700;
  readonly invalidRequest: -32600;
  readonly methodNotFound: -32601;
  readonly invalidParams: -32602;
  readonly internalError: -32603;
  readonly taskNotFound: -32001;
  readonly taskNotCancelable: -32002;
  readonly pushNotificationNotSupported: -32003;
  readonly unsupportedOperation: -32004;
  readonly contentTypeNotSupported: -32005;
  readonly invalidAgentResponse: -32006;
  readonly extendedAgentCardNotConfigured: -32007;
  readonly extensionSupportRequired: -32008;
  readonly versionNotSupported: -32009;
} = Object.freeze({
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  invalidAgentResponse: -32006,
  extendedAgentCardNotConfigured: -32007,
  extensionSupportRequired: -32008,
  versionNotSupported: -32009,
} as const);

const CODES = A2A_ERROR_CODES;

/** `google.rpc.ErrorInfo` reason strings, keyed by A2A error code. */
const ERROR_REASONS: Readonly<Record<number, string>> = Object.freeze({
  [-32001]: "TASK_NOT_FOUND",
  [-32002]: "TASK_NOT_CANCELABLE",
  [-32003]: "PUSH_NOTIFICATION_NOT_SUPPORTED",
  [-32004]: "UNSUPPORTED_OPERATION",
  [-32005]: "CONTENT_TYPE_NOT_SUPPORTED",
  [-32006]: "INVALID_AGENT_RESPONSE",
  [-32007]: "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
  [-32008]: "EXTENSION_SUPPORT_REQUIRED",
  [-32009]: "VERSION_NOT_SUPPORTED",
});

// ---------------------------------------------------------------------------
// Wire types (A2A 1.0 ProtoJSON: camelCase fields, SCREAMING_SNAKE enums)
// ---------------------------------------------------------------------------

/**
 * Task lifecycle state as serialized on the wire.
 *
 * @since 1.4.0
 */
export type A2aTaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

/**
 * One piece of message or artifact content. Exactly one of `text`, `raw`
 * (base64 bytes), `url`, or `data` is set: the member name is the type
 * discriminator (A2A 1.0 removed the `kind` field).
 *
 * @since 1.4.0
 */
export interface A2aPart {
  text?: string;
  /** File bytes, base64-encoded. */
  raw?: string;
  /**
   * URL of the file content. DaloyJS never fetches it. If your handler does,
   * route the fetch through `fetchGuard()` so a peer cannot aim it at
   * loopback, private, or cloud-metadata addresses.
   */
  url?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  filename?: string;
  mediaType?: string;
}

/**
 * One unit of communication between a client and the agent.
 *
 * @since 1.4.0
 */
export interface A2aMessage {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: A2aPart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

/**
 * Output produced by a task.
 *
 * @since 1.4.0
 */
export interface A2aArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2aPart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

/**
 * Current status of a task.
 *
 * @since 1.4.0
 */
export interface A2aTaskStatus {
  state: A2aTaskState;
  message?: A2aMessage;
  /** ISO 8601 UTC timestamp. */
  timestamp?: string;
}

/**
 * Stateful unit of work tracked by the agent.
 *
 * @since 1.4.0
 */
export interface A2aTask {
  id: string;
  contextId: string;
  status: A2aTaskStatus;
  artifacts?: A2aArtifact[];
  history?: A2aMessage[];
  metadata?: Record<string, unknown>;
}

/**
 * Organization publishing the agent.
 *
 * @since 1.4.0
 */
export interface A2aAgentProvider {
  organization: string;
  url: string;
}

/**
 * Protocol extension declared on the Agent Card.
 *
 * @since 1.4.0
 */
export interface A2aAgentExtension {
  uri: string;
  description?: string;
  /** When `true`, requests that do not activate this extension are refused with `-32008`. */
  required?: boolean;
  params?: Record<string, unknown>;
}

/**
 * Map of security-scheme name to the scopes it requires. Serializes as the
 * ProtoJSON `{ "schemes": { "<name>": { "list": [...] } } }` shape.
 *
 * @since 1.4.0
 */
export interface A2aSecurityRequirement {
  schemes: Record<string, { list: string[] }>;
}

/**
 * Security scheme (OpenAPI 3.2 based). Exactly one member is set.
 *
 * @since 1.4.0
 */
export interface A2aSecurityScheme {
  apiKeySecurityScheme?: { description?: string; location: "query" | "header" | "cookie"; name: string };
  httpAuthSecurityScheme?: { description?: string; scheme: string; bearerFormat?: string };
  oauth2SecurityScheme?: {
    description?: string;
    flows: Record<string, unknown>;
    oauth2MetadataUrl?: string;
  };
  openIdConnectSecurityScheme?: { description?: string; openIdConnectUrl: string };
  mtlsSecurityScheme?: { description?: string };
}

/**
 * A capability the agent advertises. Skills are descriptive: A2A carries no
 * skill id on messages, so your `onMessage` handler decides what to run.
 *
 * @since 1.4.0
 */
export interface A2aAgentSkill {
  id: string;
  name: string;
  description: string;
  /** At least one keyword. */
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  securityRequirements?: A2aSecurityRequirement[];
}

/**
 * URL, binding, and protocol version at which the agent can be reached.
 *
 * @since 1.4.0
 */
export interface A2aAgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
}

/**
 * Capability flags. DaloyJS derives these from what the handler actually
 * implements, so the card can never advertise a feature that is missing.
 *
 * @since 1.4.0
 */
export interface A2aAgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  extendedAgentCard: boolean;
  extensions?: A2aAgentExtension[];
}

/**
 * Public Agent Card served at {@link A2A_AGENT_CARD_PATH}.
 *
 * @since 1.4.0
 */
export interface A2aAgentCard {
  name: string;
  description: string;
  supportedInterfaces: A2aAgentInterface[];
  provider?: A2aAgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: A2aAgentCapabilities;
  securitySchemes?: Record<string, A2aSecurityScheme>;
  securityRequirements?: A2aSecurityRequirement[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2aAgentSkill[];
  iconUrl?: string;
}

// ---------------------------------------------------------------------------
// Developer-facing types
// ---------------------------------------------------------------------------

/**
 * Agent Card fields you supply. `supportedInterfaces` and `capabilities` are
 * derived by {@link createA2aHandler}.
 *
 * @since 1.4.0
 */
export interface A2aAgentCardInput {
  /** Human-readable agent name. */
  name: string;
  /** What the agent does. Other agents read this to decide whether to call you. */
  description: string;
  /** Your agent's version, e.g. `"1.0.0"`. */
  version: string;
  /**
   * Absolute URL of the JSON-RPC endpoint, e.g. `"https://api.example.com/a2a"`.
   * Must be `https:` in production unless the host is loopback.
   */
  url: string;
  /** At least one skill. */
  skills: readonly A2aAgentSkill[];
  provider?: A2aAgentProvider;
  documentationUrl?: string;
  iconUrl?: string;
  /** Media types accepted across all skills. Defaults to `["text/plain", "application/json"]`. */
  defaultInputModes?: readonly string[];
  /** Media types produced across all skills. Defaults to `["text/plain", "application/json"]`. */
  defaultOutputModes?: readonly string[];
  /**
   * How peers authenticate. Required unless the routes are mounted with
   * `{ public: true }`: a card that hides its auth scheme cannot be used.
   */
  securitySchemes?: Record<string, A2aSecurityScheme>;
  securityRequirements?: readonly A2aSecurityRequirement[];
  /** Protocol extensions your handler implements. */
  extensions?: readonly A2aAgentExtension[];
}

/**
 * Host-framework context forwarded to the handler. {@link a2aRoutes} fills it
 * from the Daloy route context so `onMessage` and `taskOwner` can read the
 * principal your auth middleware stored on `ctx.state`.
 *
 * @since 1.4.0
 */
export interface A2aHostContext {
  /** Daloy `ctx.state` (auth principal, tenant, and so on). */
  state: Record<string, unknown>;
}

/**
 * Context passed to {@link A2aHandlerOptions.onMessage}.
 *
 * @since 1.4.0
 */
export interface A2aMessageContext {
  /** Original HTTP request. */
  request: Request;
  /** Daloy `ctx.state`, or `{}` when the handler runs outside Daloy routes. */
  state: Record<string, unknown>;
  /** The validated inbound message. */
  message: A2aMessage;
  /** All `text` parts of the message joined with `"\n"`. Convenience only. */
  text: string;
  /** Id the task will have if you return a task result. */
  taskId: string;
  /** Conversation id (client-supplied, inherited from the task, or generated). */
  contextId: string;
  /** Existing task when the message continues one (requires a task store). */
  task?: A2aTask;
  /** Output media types the client accepts, when it said. */
  acceptedOutputModes?: readonly string[];
  /** Request-level `metadata` from `SendMessageRequest`. */
  metadata?: Record<string, unknown>;
  /** Extension URIs the client activated through the `A2A-Extensions` header. */
  extensions: readonly string[];
  /** Resolved task owner, when a task store is configured. */
  owner?: string;
  /** Aborts when the request is aborted (for example by `requestTimeoutMs`). */
  signal: AbortSignal;
}

/**
 * Artifact returned from a handler. `artifactId` is generated when omitted.
 *
 * @since 1.4.0
 */
export interface A2aArtifactInput {
  artifactId?: string;
  name?: string;
  description?: string;
  /** At least one part. */
  parts: readonly A2aPart[];
  metadata?: Record<string, unknown>;
}

/**
 * Task states a handler may finish in. `canceled` is reserved for `CancelTask`.
 *
 * @since 1.4.0
 */
export type A2aResultState = "completed" | "failed" | "rejected" | "input-required" | "auth-required";

/**
 * What `onMessage` returns.
 *
 * - A `string` or `{ reply }`: a direct Message answer, no task created.
 * - `{ status }`: a Task in that state, with optional artifacts and status
 *   message. `input-required` / `auth-required` need a task store so the
 *   client can continue the task.
 *
 * @since 1.4.0
 */
export type A2aReply =
  | string
  | { reply: string | readonly A2aPart[]; metadata?: Record<string, unknown> }
  | {
      status: A2aResultState;
      /** Status message shown to the client, e.g. what input is missing. */
      message?: string | readonly A2aPart[];
      artifacts?: readonly A2aArtifactInput[];
      metadata?: Record<string, unknown>;
    };

/**
 * Query forwarded to {@link A2aTaskStore.list}. Already validated.
 *
 * @since 1.4.0
 */
export interface A2aTaskListQuery {
  contextId?: string;
  state?: A2aTaskState;
  /** 1 to 100. */
  pageSize: number;
  pageToken?: string;
  /** Epoch milliseconds; only tasks whose status timestamp is at or after this. */
  statusTimestampAfter?: number;
}

/**
 * One page from {@link A2aTaskStore.list}.
 *
 * @since 1.4.0
 */
export interface A2aTaskListPage {
  tasks: A2aTask[];
  /** `""` on the last page. */
  nextPageToken: string;
  totalSize: number;
}

/**
 * Persistence for tasks. Every call is scoped by `owner`, the value returned
 * by {@link A2aHandlerOptions.taskOwner}. An implementation MUST NOT return a
 * task stored under a different owner: that is the IDOR boundary.
 *
 * @since 1.4.0
 */
export interface A2aTaskStore {
  get(owner: string, taskId: string): A2aTask | undefined | Promise<A2aTask | undefined>;
  set(owner: string, task: A2aTask): void | Promise<void>;
  /** Optional. Without it, `ListTasks` answers `-32004`. */
  list?(owner: string, query: A2aTaskListQuery): A2aTaskListPage | Promise<A2aTaskListPage>;
}

/**
 * Options for {@link createA2aHandler}.
 *
 * @since 1.4.0
 */
export interface A2aHandlerOptions {
  /** Agent Card contents. */
  card: A2aAgentCardInput;
  /**
   * Your agent logic. Receives the validated message and returns a reply or
   * a task result. Throw {@link A2aError} for a caller-visible JSON-RPC
   * error; any other throw becomes a redacted `-32603`.
   */
  onMessage: (ctx: A2aMessageContext) => A2aReply | Promise<A2aReply>;
  /**
   * Enables `GetTask`, `CancelTask`, `ListTasks`, and multi-turn tasks.
   * Without it the agent is stateless. Requires {@link taskOwner}.
   */
  taskStore?: A2aTaskStore;
  /**
   * Resolve the authenticated caller that owns tasks, e.g.
   * `({ state }) => (state.user as { sub?: string })?.sub`. Required with a
   * task store. Returning `undefined`, `null`, or `""` fails closed: the
   * request is refused, never served from a shared bucket.
   */
  taskOwner?: (host: A2aHostContext & { request: Request }) => string | undefined | null;
  /**
   * Extra browser `Origin` values allowed on the JSON-RPC endpoint. Requests
   * without `Origin` and loopback origins are always allowed; every other
   * origin gets `403` (DNS-rebinding defense, same rule as MCP).
   */
  allowedOrigins?: readonly string[];
  /** Maximum JSON-RPC body size in bytes. Defaults to 256 KiB. */
  maxBodyBytes?: number;
  /** Maximum messages kept in a stored task's history. Defaults to 50. */
  maxHistory?: number;
  /** `max-age` for the Agent Card response, in seconds. Defaults to 300. */
  cardMaxAgeSeconds?: number;
  /**
   * Include raw error text from unexpected throws in `-32603` responses.
   * Fails closed: defaults to on only when `NODE_ENV` is `development` or
   * `test`, and is forced off when mounted on a production App.
   */
  exposeInternalErrors?: boolean;
  /** Extra headers added to every JSON-RPC response. */
  headers?: Record<string, string>;
}

/**
 * Handler produced by {@link createA2aHandler}. Mount it with
 * {@link a2aRoutes}, or call the two methods yourself on any Fetch runtime.
 *
 * @since 1.4.0
 */
export interface A2aHandler {
  /** The frozen public Agent Card. */
  readonly agentCard: Readonly<A2aAgentCard>;
  /** Serve the Agent Card (`GET`/`HEAD`, with `ETag` and `304` support). */
  handleCard(request: Request): Promise<Response>;
  /** Serve the JSON-RPC endpoint. */
  handleRpc(request: Request, host?: A2aHostContext): Promise<Response>;
}

/**
 * Throw from `onMessage` to answer with a specific JSON-RPC error, e.g.
 * `throw new A2aError(A2A_ERROR_CODES.invalidParams, "Missing SKU")`. The
 * message is caller-visible, so keep secrets out of it.
 *
 * @since 1.4.0
 */
export class A2aError extends Error {
  /** JSON-RPC error code. */
  readonly code: number;
  /**
   * @param code - JSON-RPC code: `-32602` or an A2A code from `-32001` to `-32099`.
   * @param message - Safe, caller-visible explanation.
   * @throws {TypeError} When `code` is outside the allowed range.
   */
  constructor(code: number, message: string) {
    super(message);
    if (!(code === CODES.invalidParams || (Number.isInteger(code) && code <= -32001 && code >= -32099))) {
      throw new TypeError("A2aError code must be -32602 or within -32001..-32099.");
    }
    this.name = "A2aError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------

/**
 * Build a text part.
 *
 * @param text - Text content.
 * @param mediaType - Optional media type, e.g. `"text/markdown"`.
 * @returns An {@link A2aPart}.
 * @since 1.4.0
 */
export function a2aText(text: string, mediaType?: string): A2aPart {
  return mediaType === undefined ? { text } : { text, mediaType };
}

/**
 * Build a structured-data part (`mediaType` defaults to `application/json`).
 *
 * @param data - Any JSON value.
 * @param mediaType - Optional media type override.
 * @returns An {@link A2aPart}.
 * @since 1.4.0
 */
export function a2aData(data: unknown, mediaType = "application/json"): A2aPart {
  return { data, mediaType };
}

// ---------------------------------------------------------------------------
// In-memory task store
// ---------------------------------------------------------------------------

/**
 * Options for {@link memoryTaskStore}.
 *
 * @since 1.4.0
 */
export interface MemoryTaskStoreOptions {
  /** Maximum stored tasks across all owners; oldest writes are evicted. Defaults to 1000. */
  maxTasks?: number;
  /** Time to live after the last write, in milliseconds. Defaults to 1 hour. */
  ttlMs?: number;
}

/**
 * Bounded, process-local {@link A2aTaskStore}. Good for development, tests,
 * and single-instance servers. On serverless or multi-instance deployments a
 * follow-up `GetTask` may land on another instance: use a shared store there.
 *
 * Tasks are deep-copied on write and read, so handlers cannot mutate stored
 * state by reference.
 *
 * @param options - Capacity and TTL.
 * @returns A task store.
 * @throws {TypeError} On a non-positive `maxTasks` or `ttlMs`.
 * @since 1.4.0
 */
export function memoryTaskStore(options: MemoryTaskStoreOptions = {}): A2aTaskStore {
  const maxTasks = options.maxTasks ?? 1000;
  const ttlMs = options.ttlMs ?? 3_600_000;
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 1) {
    throw new TypeError("memoryTaskStore maxTasks must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new TypeError("memoryTaskStore ttlMs must be a positive safe integer.");
  }
  // JSON array keys are an unambiguous (owner, id) encoding: no delimiter an
  // owner string could forge to collide with another owner's task.
  const entries = new Map<string, { owner: string; task: A2aTask; expiresAt: number }>();
  const keyOf = (owner: string, id: string): string => JSON.stringify([owner, id]);

  return {
    get(owner, taskId) {
      const key = keyOf(owner, taskId);
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return structuredClone(entry.task);
    },
    set(owner, task) {
      const key = keyOf(owner, task.id);
      entries.delete(key);
      entries.set(key, { owner, task: structuredClone(task), expiresAt: Date.now() + ttlMs });
      while (entries.size > maxTasks) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },
    list(owner, query) {
      const now = Date.now();
      const matches: A2aTask[] = [];
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) {
          entries.delete(key);
          continue;
        }
        if (entry.owner !== owner) continue;
        const task = entry.task;
        if (query.contextId !== undefined && task.contextId !== query.contextId) continue;
        if (query.state !== undefined && task.status.state !== query.state) continue;
        if (
          query.statusTimestampAfter !== undefined &&
          statusTime(task) < query.statusTimestampAfter
        ) {
          continue;
        }
        matches.push(task);
      }
      matches.sort((a, b) => statusTime(b) - statusTime(a));
      const offset = query.pageToken === undefined ? 0 : decodePageToken(query.pageToken);
      const page = matches.slice(offset, offset + query.pageSize);
      const next = offset + page.length;
      return {
        tasks: page.map((task) => structuredClone(task)),
        nextPageToken: next < matches.length ? encodePageToken(next) : "",
        totalSize: matches.length,
      };
    },
  };
}

function statusTime(task: A2aTask): number {
  const t = task.status.timestamp === undefined ? NaN : Date.parse(task.status.timestamp);
  return Number.isNaN(t) ? 0 : t;
}

function encodePageToken(offset: number): string {
  return `o${offset.toString(36)}`;
}

function decodePageToken(token: string): number {
  if (!/^o[0-9a-z]{1,10}$/.test(token)) {
    throw new A2aError(CODES.invalidParams, "Invalid pageToken.");
  }
  return Number.parseInt(token.slice(1), 36);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Bounds on inbound structure, independent of the byte cap. */
const MAX_ID_LENGTH = 256;
const MAX_PARTS = 64;
const MAX_LIST_ITEMS = 64;
const DEFAULT_MAX_HISTORY = 50;
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]*={0,2}$/;
const VERSION_PATTERN = /^(\d{1,4})\.(\d{1,4})(?:\.\d{1,6})?$/;

const TASK_STATES: ReadonlySet<string> = new Set<A2aTaskState>([
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
]);

/** ProtoJSON parsers accept enum integers as well as names (proto field order). */
const TASK_STATE_BY_NUMBER: readonly (A2aTaskState | undefined)[] = [
  undefined, // TASK_STATE_UNSPECIFIED
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
];

const TERMINAL_STATES: ReadonlySet<string> = new Set<A2aTaskState>([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

const RESULT_STATES: Readonly<Record<A2aResultState, A2aTaskState>> = Object.freeze({
  completed: "TASK_STATE_COMPLETED",
  failed: "TASK_STATE_FAILED",
  rejected: "TASK_STATE_REJECTED",
  "input-required": "TASK_STATE_INPUT_REQUIRED",
  "auth-required": "TASK_STATE_AUTH_REQUIRED",
});

/** A field-level validation failure (`google.rpc.BadRequest.FieldViolation`). */
interface FieldViolation {
  field: string;
  description: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function checkStringList(
  value: unknown,
  field: string,
  out: FieldViolation[]
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_LIST_ITEMS ||
    !value.every((v) => typeof v === "string" && v.length <= 2048)
  ) {
    out.push({ field, description: `Must be an array of at most ${MAX_LIST_ITEMS} strings.` });
    return undefined;
  }
  return value as string[];
}

/** Validate one part; pushes violations and returns whether it is well formed. */
function checkPart(part: unknown, field: string, out: FieldViolation[]): boolean {
  if (!isPlainObject(part)) {
    out.push({ field, description: "Part must be an object." });
    return false;
  }
  let members = 0;
  if (part.text !== undefined) {
    members++;
    if (typeof part.text !== "string") out.push({ field: `${field}.text`, description: "Must be a string." });
  }
  if (part.raw !== undefined) {
    members++;
    if (typeof part.raw !== "string" || !BASE64_PATTERN.test(part.raw)) {
      out.push({ field: `${field}.raw`, description: "Must be a base64 string." });
    }
  }
  if (part.url !== undefined) {
    members++;
    if (!isSafeFileUrl(part.url)) {
      out.push({
        field: `${field}.url`,
        description: "Must be an absolute http(s) URL without credentials.",
      });
    }
  }
  if ("data" in part) members++;
  if (members !== 1) {
    out.push({ field, description: "Part must contain exactly one of text, raw, url, data." });
    return false;
  }
  if (part.mediaType !== undefined && typeof part.mediaType !== "string") {
    out.push({ field: `${field}.mediaType`, description: "Must be a string." });
  }
  if (part.filename !== undefined && typeof part.filename !== "string") {
    out.push({ field: `${field}.filename`, description: "Must be a string." });
  }
  if (part.metadata !== undefined && !isPlainObject(part.metadata)) {
    out.push({ field: `${field}.metadata`, description: "Must be an object." });
  }
  return true;
}

function isSafeFileUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 8192) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

function checkParts(value: unknown, field: string, out: FieldViolation[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) {
    out.push({ field, description: `Must be an array of 1 to ${MAX_PARTS} parts.` });
    return;
  }
  value.forEach((part, i) => checkPart(part, `${field}[${i}]`, out));
}

function parseInboundMessage(value: unknown, out: FieldViolation[]): A2aMessage | undefined {
  if (!isPlainObject(value)) {
    out.push({ field: "message", description: "Required object." });
    return undefined;
  }
  const before = out.length;
  // ProtoJSON: a proto3 default ("" or enum 0/1 as integers) means "unset" or
  // the named value. Accept both forms so every conforming client interops.
  if (value.role === 1) value.role = "ROLE_USER";
  for (const key of ["contextId", "taskId"] as const) {
    if (value[key] === "") delete value[key];
  }
  if (!isBoundedId(value.messageId)) {
    out.push({ field: "message.messageId", description: `Required string of 1 to ${MAX_ID_LENGTH} characters.` });
  }
  if (value.role !== "ROLE_USER") {
    out.push({ field: "message.role", description: 'Must be "ROLE_USER".' });
  }
  for (const key of ["contextId", "taskId"] as const) {
    if (value[key] !== undefined && !isBoundedId(value[key])) {
      out.push({ field: `message.${key}`, description: `Must be a string of 1 to ${MAX_ID_LENGTH} characters.` });
    }
  }
  checkParts(value.parts, "message.parts", out);
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    out.push({ field: "message.metadata", description: "Must be an object." });
  }
  checkStringList(value.extensions, "message.extensions", out);
  checkStringList(value.referenceTaskIds, "message.referenceTaskIds", out);
  if (out.length > before) return undefined;
  return value as unknown as A2aMessage;
}

/** Parse an `A2A-Version` value into `Major.Minor`; empty means `0.3` (spec 3.6.2). */
function requestedVersion(header: string | null): string | undefined {
  const raw = (header ?? "").trim();
  if (raw === "") return "0.3";
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return undefined;
  return `${Number(match[1])}.${Number(match[2])}`;
}

function parseExtensionsHeader(header: string | null): string[] {
  if (header === null) return [];
  const out: string[] = [];
  for (const piece of header.split(",")) {
    const uri = piece.trim();
    if (uri !== "" && out.length < MAX_LIST_ITEMS) out.push(uri);
  }
  return out;
}

function checkPublicUrl(value: string | undefined, field: string): void {
  if (value === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`A2A card ${field} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`A2A card ${field} must use http: or https:.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(`A2A card ${field} must not embed credentials.`);
  }
}

function isLoopbackUrl(value: string): boolean {
  const host = new URL(value).hostname;
  return (
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildCard(input: A2aAgentCardInput): A2aAgentCard {
  if (!nonEmpty(input.name)) throw new TypeError("A2A card name is required.");
  if (!nonEmpty(input.description)) throw new TypeError("A2A card description is required.");
  if (!nonEmpty(input.version)) throw new TypeError("A2A card version is required.");
  if (!nonEmpty(input.url)) throw new TypeError("A2A card url is required.");
  checkPublicUrl(input.url, "url");
  checkPublicUrl(input.documentationUrl, "documentationUrl");
  checkPublicUrl(input.iconUrl, "iconUrl");
  if (input.provider) {
    if (!nonEmpty(input.provider.organization)) {
      throw new TypeError("A2A card provider.organization is required.");
    }
    checkPublicUrl(input.provider.url, "provider.url");
  }
  if (!Array.isArray(input.skills) || input.skills.length === 0) {
    throw new TypeError("A2A card must declare at least one skill.");
  }
  const ids = new Set<string>();
  for (const skill of input.skills) {
    if (!nonEmpty(skill.id)) throw new TypeError("A2A skill id is required.");
    if (ids.has(skill.id)) throw new TypeError(`A2A skill id "${skill.id}" is not unique.`);
    ids.add(skill.id);
    if (!nonEmpty(skill.name)) throw new TypeError(`A2A skill "${skill.id}" needs a name.`);
    if (!nonEmpty(skill.description)) {
      throw new TypeError(`A2A skill "${skill.id}" needs a description.`);
    }
    if (!Array.isArray(skill.tags) || skill.tags.length === 0 || !skill.tags.every(nonEmpty)) {
      throw new TypeError(`A2A skill "${skill.id}" needs at least one tag.`);
    }
  }
  if (input.securitySchemes) {
    for (const [name, scheme] of Object.entries(input.securitySchemes)) {
      const members = Object.keys(scheme).filter(
        (k) => (scheme as Record<string, unknown>)[k] !== undefined
      );
      if (members.length !== 1) {
        throw new TypeError(`A2A security scheme "${name}" must set exactly one scheme member.`);
      }
    }
  }
  const schemeNames = new Set(Object.keys(input.securitySchemes ?? {}));
  const allRequirements = [
    ...(input.securityRequirements ?? []),
    ...input.skills.flatMap((s) => s.securityRequirements ?? []),
  ];
  for (const requirement of allRequirements) {
    for (const name of Object.keys(requirement.schemes)) {
      if (!schemeNames.has(name)) {
        throw new TypeError(`A2A security requirement names undeclared scheme "${name}".`);
      }
    }
  }
  for (const ext of input.extensions ?? []) {
    if (!nonEmpty(ext.uri)) throw new TypeError("A2A extension uri is required.");
  }

  const card: A2aAgentCard = {
    name: input.name,
    description: input.description,
    supportedInterfaces: [
      { url: input.url, protocolBinding: "JSONRPC", protocolVersion: A2A_PROTOCOL_VERSION },
    ],
    ...(input.provider ? { provider: { ...input.provider } } : {}),
    version: input.version,
    ...(input.documentationUrl ? { documentationUrl: input.documentationUrl } : {}),
    capabilities: {
      // Derived, never user-set: this module implements neither streaming,
      // push notifications, nor an extended card, so advertising any of them
      // would make peers call methods that can only fail.
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      ...(input.extensions && input.extensions.length > 0
        ? { extensions: input.extensions.map((e) => ({ ...e })) }
        : {}),
    },
    ...(input.securitySchemes ? { securitySchemes: structuredClone(input.securitySchemes) } : {}),
    ...(input.securityRequirements && input.securityRequirements.length > 0
      ? { securityRequirements: structuredClone([...input.securityRequirements]) }
      : {}),
    defaultInputModes: [...(input.defaultInputModes ?? ["text/plain", "application/json"])],
    defaultOutputModes: [...(input.defaultOutputModes ?? ["text/plain", "application/json"])],
    skills: structuredClone([...input.skills]),
    ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
  };
  return deepFreeze(card);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

type RpcId = string | number | null;

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(headers ?? {}),
    },
  });
}

function errorInfo(code: number, metadata?: Record<string, string>): unknown[] | undefined {
  const reason = ERROR_REASONS[code];
  if (reason === undefined) return undefined;
  return [
    {
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason,
      domain: "a2a-protocol.org",
      ...(metadata ? { metadata } : {}),
    },
  ];
}

function badRequest(violations: readonly FieldViolation[]): unknown[] {
  return [
    {
      "@type": "type.googleapis.com/google.rpc.BadRequest",
      fieldViolations: violations.slice(0, 20),
    },
  ];
}

/** Internal signal carrying a JSON-RPC error out of a method implementation. */
class RpcFailure {
  constructor(
    readonly code: number,
    readonly message: string,
    readonly data?: unknown,
    readonly status = 200
  ) {}
}

function fail(code: number, message: string, metadata?: Record<string, string>): never {
  throw new RpcFailure(code, message, errorInfo(code, metadata));
}

function applyHistoryLength(task: A2aTask, historyLength: number | undefined): A2aTask {
  if (historyLength === undefined || task.history === undefined) return task;
  if (historyLength === 0) {
    const { history: _omit, ...rest } = task;
    return rest;
  }
  return { ...task, history: task.history.slice(-historyLength) };
}

function readHistoryLength(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RpcFailure(CODES.invalidParams, "Invalid parameters", badRequest([
      { field, description: "Must be a non-negative integer." },
    ]));
  }
  return value as number;
}

function normalizeParts(value: string | readonly A2aPart[], where: string): A2aPart[] {
  if (typeof value === "string") return [{ text: value }];
  const violations: FieldViolation[] = [];
  checkParts(value, where, violations);
  if (violations.length > 0) {
    throw new TypeError(`A2A onMessage returned invalid ${where}: ${violations[0]!.description}`);
  }
  return value.map((p) => ({ ...p }));
}

const ENVELOPE_JSON_SCHEMA = {
  type: "object",
  description: "JSON-RPC 2.0 envelope produced by the A2A 1.0 JSON-RPC binding.",
  properties: {
    jsonrpc: { type: "string", const: "2.0" },
    id: { oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
    result: { description: "Method result. Present on success; shape varies by A2A method." },
    error: {
      type: "object",
      properties: { code: { type: "integer" }, message: { type: "string" }, data: {} },
      required: ["code", "message"],
    },
  },
  required: ["jsonrpc"],
} as const;

const CARD_JSON_SCHEMA = {
  type: "object",
  description: "A2A 1.0 public Agent Card.",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    version: { type: "string" },
    supportedInterfaces: { type: "array", items: { type: "object" } },
    capabilities: { type: "object" },
    skills: { type: "array", items: { type: "object" } },
    defaultInputModes: { type: "array", items: { type: "string" } },
    defaultOutputModes: { type: "array", items: { type: "string" } },
  },
  required: [
    "name",
    "description",
    "version",
    "supportedInterfaces",
    "capabilities",
    "skills",
    "defaultInputModes",
    "defaultOutputModes",
  ],
} as const;

/** Pass-through schema: the handler builds the body itself; this only documents it. */
function documentedSchema<S>(jsonSchema: S): StandardSchemaV1 & { toJSONSchema(): S } {
  return {
    "~standard": { version: 1, vendor: "daloyjs", validate: (value) => ({ value }) },
    toJSONSchema: () => jsonSchema,
  };
}

/**
 * Hidden hook key on a handler returned by {@link createA2aHandler}. The App
 * calls it at route registration with its resolved production flag; it can
 * only make the handler stricter (force error redaction, require HTTPS).
 */
const A2A_APP_PRODUCTION_HOOK = Symbol.for("daloyjs.a2a.appProduction");

const STREAMING_METHODS = new Set(["SendStreamingMessage", "SubscribeToTask"]);
const PUSH_METHODS = new Set([
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Create an A2A 1.0 agent endpoint (JSON-RPC binding) for an existing service.
 *
 * DaloyJS owns the protocol: the Agent Card, JSON-RPC envelope, version and
 * extension negotiation, input validation, error mapping, task bookkeeping,
 * and the DNS-rebinding `Origin` check. You own the meaning: `onMessage`
 * receives a validated message and returns a reply or a task result. No LLM
 * or skill router runs inside the framework.
 *
 * Capabilities are derived and honest: `streaming`, `pushNotifications`, and
 * `extendedAgentCard` are `false`, and their methods return the errors the
 * spec requires (`-32004`, `-32003`).
 *
 * @param options - See {@link A2aHandlerOptions}.
 * @returns An {@link A2aHandler}.
 * @throws {TypeError} On an invalid card (missing fields, no skills, unsafe
 *   URLs, undeclared security schemes), a task store without `taskOwner`, or
 *   bad numeric limits.
 *
 * @example
 * ```ts
 * const agent = createA2aHandler({
 *   card: {
 *     name: "inventory-agent",
 *     description: "Answers stock questions for Acme products.",
 *     version: "1.0.0",
 *     url: "https://api.acme.example/a2a",
 *     skills: [{ id: "stock", name: "Stock lookup", description: "Units on hand by SKU.", tags: ["inventory"] }],
 *     securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
 *     securityRequirements: [{ schemes: { bearer: { list: [] } } }],
 *   },
 *   onMessage: async ({ message }) => {
 *     const sku = message.parts.find((p) => p.data !== undefined)?.data;
 *     return { status: "completed", artifacts: [{ name: "stock", parts: [a2aData(await lookup(sku))] }] };
 *   },
 * });
 * ```
 *
 * @since 1.4.0
 */
export function createA2aHandler(options: A2aHandlerOptions): A2aHandler {
  if (typeof options.onMessage !== "function") {
    throw new TypeError("A2A onMessage handler is required.");
  }
  const card = buildCard(options.card);
  const store = options.taskStore;
  const taskOwner = options.taskOwner;
  if (store && typeof taskOwner !== "function") {
    throw new TypeError(
      "A2A taskStore requires taskOwner so tasks are scoped to the authenticated caller."
    );
  }
  const maxBodyBytes = options.maxBodyBytes ?? A2A_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("A2A maxBodyBytes must be a positive safe integer.");
  }
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
  if (!Number.isSafeInteger(maxHistory) || maxHistory < 0) {
    throw new TypeError("A2A maxHistory must be a non-negative safe integer.");
  }
  const cardMaxAge = options.cardMaxAgeSeconds ?? 300;
  if (!Number.isSafeInteger(cardMaxAge) || cardMaxAge < 0) {
    throw new TypeError("A2A cardMaxAgeSeconds must be a non-negative safe integer.");
  }
  const allowedOrigins = compileOriginAllowlist(options.allowedOrigins, "A2A");
  const headers = options.headers;
  const nodeEnv = readNodeEnv();
  let exposeInternalErrors =
    options.exposeInternalErrors ?? (nodeEnv === "development" || nodeEnv === "test");

  const cardUrl = options.card.url;
  const cardJson = JSON.stringify(card);
  let cardEtag: string | undefined;
  const requiredExtensions = (card.capabilities.extensions ?? [])
    .filter((e) => e.required === true)
    .map((e) => e.uri);
  const inputModes = new Set<string>();
  for (const mode of [...card.defaultInputModes, ...card.skills.flatMap((s) => s.inputModes ?? [])]) {
    inputModes.add(mediaTypeEssence(mode));
  }
  const acceptsAnyInput = inputModes.has("*/*");

  const rpcHeaders = headers;

  function rpcResult(id: RpcId, result: unknown): Response {
    return jsonResponse({ jsonrpc: "2.0", id, result }, 200, rpcHeaders);
  }

  function rpcError(
    id: RpcId,
    code: number,
    message: string,
    data: unknown,
    status: number
  ): Response {
    const error: { code: number; message: string; data?: unknown } = { code, message };
    if (data !== undefined) error.data = data;
    return jsonResponse({ jsonrpc: "2.0", id, error }, status, rpcHeaders);
  }

  function resolveOwner(request: Request, state: Record<string, unknown>): string {
    const owner = taskOwner!({ request, state });
    if (typeof owner !== "string" || owner.length === 0) {
      // Fail closed: an unresolved identity must never fall into a shared
      // bucket that every other anonymous caller could read.
      throw new RpcFailure(
        CODES.invalidRequest,
        "Caller identity could not be resolved for task access.",
        undefined,
        401
      );
    }
    return owner;
  }

  async function loadTask(owner: string, id: string): Promise<A2aTask> {
    const task = await store!.get(owner, id);
    if (!task) fail(CODES.taskNotFound, "Task not found", { taskId: id });
    return task;
  }

  function agentMessage(
    parts: A2aPart[],
    contextId: string,
    taskId: string | undefined,
    metadata?: Record<string, unknown>
  ): A2aMessage {
    return {
      messageId: randomId(),
      contextId,
      ...(taskId !== undefined ? { taskId } : {}),
      role: "ROLE_AGENT",
      parts,
      ...(metadata ? { metadata } : {}),
    };
  }

  async function sendMessage(
    params: Record<string, unknown>,
    request: Request,
    state: Record<string, unknown>,
    extensions: readonly string[]
  ): Promise<unknown> {
    const violations: FieldViolation[] = [];
    const message = parseInboundMessage(params.message, violations);
    const config = params.configuration;
    if (config !== undefined && !isPlainObject(config)) {
      violations.push({ field: "configuration", description: "Must be an object." });
    }
    const configuration = isPlainObject(config) ? config : {};
    const acceptedOutputModes = checkStringList(
      configuration.acceptedOutputModes,
      "configuration.acceptedOutputModes",
      violations
    );
    if (params.metadata !== undefined && !isPlainObject(params.metadata)) {
      violations.push({ field: "metadata", description: "Must be an object." });
    }
    if (violations.length > 0 || !message) {
      throw new RpcFailure(CODES.invalidParams, "Invalid parameters", badRequest(violations));
    }
    const historyLength = readHistoryLength(
      configuration.historyLength,
      "configuration.historyLength"
    );
    if (configuration.taskPushNotificationConfig !== undefined) {
      fail(CODES.pushNotificationNotSupported, "Push notifications are not supported by this agent.");
    }
    if (!acceptsAnyInput) {
      for (const part of message.parts) {
        if (part.mediaType !== undefined && !inputModes.has(mediaTypeEssence(part.mediaType))) {
          fail(CODES.contentTypeNotSupported, "Content type not supported", {
            mediaType: part.mediaType.slice(0, 128),
          });
        }
      }
    }

    const owner = store ? resolveOwner(request, state) : undefined;
    let existing: A2aTask | undefined;
    if (message.taskId !== undefined) {
      if (!store) fail(CODES.taskNotFound, "Task not found", { taskId: message.taskId });
      existing = await loadTask(owner!, message.taskId);
      if (TERMINAL_STATES.has(existing.status.state)) {
        fail(CODES.unsupportedOperation, "Task is in a terminal state and cannot accept messages.", {
          taskId: existing.id,
        });
      }
      if (message.contextId !== undefined && message.contextId !== existing.contextId) {
        throw new RpcFailure(CODES.invalidParams, "Invalid parameters", badRequest([
          { field: "message.contextId", description: "Does not match the referenced task." },
        ]));
      }
    }
    const contextId = existing?.contextId ?? message.contextId ?? randomId();
    const taskId = existing?.id ?? randomId();
    const text = message.parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");

    const ctx: A2aMessageContext = {
      request,
      state,
      message,
      text,
      taskId,
      contextId,
      extensions,
      signal: request.signal,
      ...(existing ? { task: structuredClone(existing) } : {}),
      ...(acceptedOutputModes ? { acceptedOutputModes } : {}),
      ...(isPlainObject(params.metadata) ? { metadata: params.metadata } : {}),
      ...(owner !== undefined ? { owner } : {}),
    };

    const reply = await options.onMessage(ctx);

    if (typeof reply === "string" || (isPlainObject(reply) && "reply" in reply)) {
      if (existing) {
        throw new TypeError(
          "A2A onMessage must return a task result ({ status }) when continuing an existing task."
        );
      }
      const parts =
        typeof reply === "string" ? [{ text: reply }] : normalizeParts(reply.reply, "reply");
      const metadata = typeof reply === "string" ? undefined : reply.metadata;
      return { message: agentMessage(parts, contextId, undefined, metadata) };
    }
    if (!isPlainObject(reply) || !("status" in reply) || !(reply.status in RESULT_STATES)) {
      throw new TypeError("A2A onMessage returned an unrecognized result.");
    }
    const state_ = RESULT_STATES[reply.status];
    const interrupted = state_ === "TASK_STATE_INPUT_REQUIRED" || state_ === "TASK_STATE_AUTH_REQUIRED";
    if (interrupted && !store) {
      throw new TypeError(
        `A2A onMessage returned "${reply.status}" but no taskStore is configured, so the client could never continue the task.`
      );
    }
    const newArtifacts: A2aArtifact[] = (reply.artifacts ?? []).map((artifact, i) => ({
      artifactId: artifact.artifactId ?? randomId(),
      ...(artifact.name !== undefined ? { name: artifact.name } : {}),
      ...(artifact.description !== undefined ? { description: artifact.description } : {}),
      parts: normalizeParts(artifact.parts, `artifacts[${i}].parts`),
      ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
    }));
    const statusMessage =
      reply.message !== undefined
        ? agentMessage(normalizeParts(reply.message, "message"), contextId, taskId)
        : undefined;
    const inbound: A2aMessage = { ...message, contextId, taskId };
    const history = [...(existing?.history ?? []), inbound, ...(statusMessage ? [statusMessage] : [])];
    const artifacts = [...(existing?.artifacts ?? []), ...newArtifacts];
    const task: A2aTask = {
      id: taskId,
      contextId,
      status: {
        state: state_,
        ...(statusMessage ? { message: statusMessage } : {}),
        timestamp: new Date().toISOString(),
      },
      ...(artifacts.length > 0 ? { artifacts } : {}),
      ...(maxHistory > 0 ? { history: history.slice(-maxHistory) } : {}),
      ...(reply.metadata ?? existing?.metadata
        ? { metadata: reply.metadata ?? existing!.metadata! }
        : {}),
    };
    if (store) await store.set(owner!, task);
    return { task: applyHistoryLength(task, historyLength) };
  }

  async function getTask(
    params: Record<string, unknown>,
    request: Request,
    state: Record<string, unknown>
  ): Promise<unknown> {
    const id = requireTaskId(params);
    const historyLength = readHistoryLength(params.historyLength, "historyLength");
    if (!store) fail(CODES.taskNotFound, "Task not found", { taskId: id });
    const owner = resolveOwner(request, state);
    return applyHistoryLength(await loadTask(owner, id), historyLength);
  }

  async function cancelTask(
    params: Record<string, unknown>,
    request: Request,
    state: Record<string, unknown>
  ): Promise<unknown> {
    const id = requireTaskId(params);
    if (!store) fail(CODES.taskNotFound, "Task not found", { taskId: id });
    const owner = resolveOwner(request, state);
    const task = await loadTask(owner, id);
    if (TERMINAL_STATES.has(task.status.state)) {
      fail(CODES.taskNotCancelable, "Task cannot be canceled", { taskId: id });
    }
    task.status = { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() };
    await store.set(owner, task);
    return task;
  }

  async function listTasks(
    params: Record<string, unknown>,
    request: Request,
    state: Record<string, unknown>
  ): Promise<unknown> {
    if (!store?.list) fail(CODES.unsupportedOperation, "ListTasks is not supported by this agent.");
    const violations: FieldViolation[] = [];
    // ProtoJSON defaults mean "no filter": "" for strings, UNSPECIFIED / 0 for
    // the state enum. Integers name states by proto field number.
    if (params.contextId === "") params.contextId = undefined;
    if (params.status === "TASK_STATE_UNSPECIFIED" || params.status === 0) params.status = undefined;
    if (typeof params.status === "number" && Number.isInteger(params.status)) {
      params.status = TASK_STATE_BY_NUMBER[params.status] ?? params.status;
    }
    if (params.contextId !== undefined && !isBoundedId(params.contextId)) {
      violations.push({ field: "contextId", description: "Must be a non-empty string." });
    }
    if (params.status !== undefined && (typeof params.status !== "string" || !TASK_STATES.has(params.status))) {
      violations.push({ field: "status", description: "Must be a TASK_STATE_* value." });
    }
    const pageSize = params.pageSize ?? 50;
    if (!Number.isSafeInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
      violations.push({ field: "pageSize", description: "Must be an integer from 1 to 100." });
    }
    if (params.pageToken !== undefined && typeof params.pageToken !== "string") {
      violations.push({ field: "pageToken", description: "Must be a string." });
    }
    let after: number | undefined;
    if (params.statusTimestampAfter !== undefined) {
      after = typeof params.statusTimestampAfter === "string" ? Date.parse(params.statusTimestampAfter) : NaN;
      if (Number.isNaN(after)) {
        violations.push({ field: "statusTimestampAfter", description: "Must be an ISO 8601 timestamp." });
      }
    }
    if (params.includeArtifacts !== undefined && typeof params.includeArtifacts !== "boolean") {
      violations.push({ field: "includeArtifacts", description: "Must be a boolean." });
    }
    if (violations.length > 0) {
      throw new RpcFailure(CODES.invalidParams, "Invalid parameters", badRequest(violations));
    }
    const historyLength = readHistoryLength(params.historyLength, "historyLength");
    const owner = resolveOwner(request, state);
    const page = await store.list(owner, {
      pageSize: pageSize as number,
      ...(params.contextId !== undefined ? { contextId: params.contextId as string } : {}),
      ...(params.status !== undefined ? { state: params.status as A2aTaskState } : {}),
      ...(params.pageToken !== undefined && params.pageToken !== ""
        ? { pageToken: params.pageToken as string }
        : {}),
      ...(after !== undefined ? { statusTimestampAfter: after } : {}),
    });
    const includeArtifacts = params.includeArtifacts === true;
    return {
      tasks: page.tasks.map((task) => {
        const trimmed = applyHistoryLength(task, historyLength);
        if (includeArtifacts) return { ...trimmed, artifacts: trimmed.artifacts ?? [] };
        const { artifacts: _omit, ...rest } = trimmed;
        return rest;
      }),
      nextPageToken: page.nextPageToken,
      pageSize: pageSize as number,
      totalSize: page.totalSize,
    };
  }

  function requireTaskId(params: Record<string, unknown>): string {
    if (!isBoundedId(params.id)) {
      throw new RpcFailure(CODES.invalidParams, "Invalid parameters", badRequest([
        { field: "id", description: `Required string of 1 to ${MAX_ID_LENGTH} characters.` },
      ]));
    }
    return params.id;
  }

  async function handleRpc(request: Request, host?: A2aHostContext): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && !isAllowedAgentOrigin(origin, allowedOrigins)) {
      return rpcError(null, CODES.invalidRequest, "Origin is not allowed for this A2A endpoint.", undefined, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS", ...(headers ?? {}) } });
    }
    if (request.method !== "POST") {
      return jsonResponse(
        {
          protocol: "A2A",
          protocolVersion: A2A_PROTOCOL_VERSION,
          agentCard: A2A_AGENT_CARD_PATH,
          hint: "Send A2A JSON-RPC 2.0 requests (SendMessage, GetTask, ...) over HTTP POST.",
        },
        405,
        { allow: "POST, OPTIONS", ...(headers ?? {}) }
      );
    }
    const essence = mediaTypeEssence(request.headers.get("content-type") ?? "");
    if (essence !== "application/json" && essence !== "application/a2a+json") {
      return rpcError(null, CODES.invalidRequest, "A2A requests must use application/json.", undefined, 415);
    }
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      return rpcError(null, CODES.invalidRequest, "Request body too large.", undefined, 413);
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > maxBodyBytes) {
      return rpcError(null, CODES.invalidRequest, "Request body too large.", undefined, 413);
    }
    let message: Record<string, unknown>;
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
      // Limited parser: strips __proto__/constructor/prototype keys and bounds
      // key count and depth, so a peer cannot DoS or pollute via the envelope.
      message = safeJsonParseLimited(raw) as Record<string, unknown>;
    } catch {
      return rpcError(null, CODES.parseError, "Invalid JSON payload", undefined, 400);
    }
    if (Array.isArray(message)) {
      return rpcError(null, CODES.invalidRequest, "JSON-RPC batch requests are not supported.", undefined, 400);
    }
    if (!isPlainObject(message) || message.jsonrpc !== "2.0") {
      return rpcError(null, CODES.invalidRequest, "Request must be a JSON-RPC 2.0 message.", undefined, 400);
    }
    const id = message.id;
    if (id === undefined || !(id === null || typeof id === "string" || typeof id === "number")) {
      // A2A defines no notifications: every method returns a result, so a
      // request without a usable id is malformed rather than fire-and-forget.
      return rpcError(null, CODES.invalidRequest, "A2A requests require a string or number id.", undefined, 400);
    }
    if (typeof message.method !== "string") {
      return rpcError(id, CODES.invalidRequest, "JSON-RPC method must be a string.", undefined, 400);
    }
    const method = message.method;
    if (message.params !== undefined && !isPlainObject(message.params)) {
      return rpcError(id, CODES.invalidParams, "Invalid parameters", undefined, 200);
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    const state = host?.state ?? {};

    try {
      const version = requestedVersion(request.headers.get("a2a-version"));
      if (version !== A2A_PROTOCOL_VERSION) {
        fail(CODES.versionNotSupported, "Protocol version not supported", {
          requestedVersion: (request.headers.get("a2a-version") ?? "").slice(0, 32) || "0.3",
          supportedVersions: A2A_PROTOCOL_VERSION,
        });
      }
      const extensions = parseExtensionsHeader(request.headers.get("a2a-extensions"));
      for (const uri of requiredExtensions) {
        if (!extensions.includes(uri)) {
          fail(CODES.extensionSupportRequired, "Extension support required", { extension: uri });
        }
      }
      let result: unknown;
      switch (method) {
        case "SendMessage":
          result = await sendMessage(params, request, state, extensions);
          break;
        case "GetTask":
          result = await getTask(params, request, state);
          break;
        case "CancelTask":
          result = await cancelTask(params, request, state);
          break;
        case "ListTasks":
          result = await listTasks(params, request, state);
          break;
        case "GetExtendedAgentCard":
          fail(CODES.unsupportedOperation, "This agent does not provide an extended Agent Card.");
        default:
          if (STREAMING_METHODS.has(method)) {
            fail(CODES.unsupportedOperation, "Streaming is not supported by this agent.");
          }
          if (PUSH_METHODS.has(method)) {
            fail(CODES.pushNotificationNotSupported, "Push notifications are not supported by this agent.");
          }
          return rpcError(id, CODES.methodNotFound, "Method not found", undefined, 200);
      }
      return rpcResult(id, result);
    } catch (error) {
      if (error instanceof RpcFailure) {
        return rpcError(id, error.code, error.message, error.data, error.status);
      }
      if (error instanceof A2aError) {
        return rpcError(id, error.code, error.message, errorInfo(error.code), 200);
      }
      return rpcError(
        id,
        CODES.internalError,
        "Internal error",
        exposeInternalErrors
          ? { detail: error instanceof Error ? error.message : String(error) }
          : undefined,
        500
      );
    }
  }

  async function handleCard(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "The Agent Card is served over GET." }, 405, { allow: "GET, HEAD" });
    }
    cardEtag ??= await strongEtag(cardJson);
    const cacheHeaders = {
      "cache-control": `public, max-age=${cardMaxAge}`,
      etag: cardEtag,
    };
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch !== null && etagMatches(ifNoneMatch, cardEtag)) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }
    return new Response(request.method === "HEAD" ? null : cardJson, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", ...cacheHeaders },
    });
  }

  const handler: A2aHandler = { agentCard: card, handleCard, handleRpc };
  const explicitExpose = options.exposeInternalErrors !== undefined;
  Object.defineProperty(handler, A2A_APP_PRODUCTION_HOOK, {
    value: (production: boolean): void => {
      if (!production) return;
      if (!explicitExpose) exposeInternalErrors = false;
      // Spec 4.4.6: interface URLs must be HTTPS in production. Refuse to
      // register rather than publish a card that downgrades peers to HTTP.
      if (new URL(cardUrl).protocol !== "https:" && !isLoopbackUrl(cardUrl)) {
        throw new TypeError(
          `A2A card url "${cardUrl}" must use https: in production (spec section 4.4.6).`
        );
      }
    },
  });
  return handler;
}

async function strongEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  let hex = "";
  for (const byte of new Uint8Array(digest).subarray(0, 16)) hex += byte.toString(16).padStart(2, "0");
  return `"${hex}"`;
}

function etagMatches(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

// ---------------------------------------------------------------------------
// Client (calling other agents) lives in a2a-client.ts; re-exported here so
// `@daloyjs/core/a2a` covers both sides.
// ---------------------------------------------------------------------------

export { A2aClientError, createA2aClient } from "./a2a-client.js";
export type {
  A2aCallOptions,
  A2aClient,
  A2aClientOptions,
  A2aListTasksResult,
  A2aOutgoingMessage,
  A2aSendResult,
} from "./a2a-client.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Options for {@link a2aRoutes}.
 *
 * @since 1.4.0
 */
export interface A2aRoutesOptions {
  /**
   * Set `true` to expose the JSON-RPC endpoint WITHOUT authentication,
   * opting out of the production boot guard. Peer agents act on what the
   * endpoint does, so only do this for a genuinely public, read-only agent.
   *
   * @defaultValue false
   */
  public?: boolean;
  /**
   * Hooks (typically auth) applied to the JSON-RPC `POST` route only, so the
   * Agent Card, the `GET` hint, and CORS preflight stay public. This is the
   * simplest way to protect the agent without an `except()` for the card:
   * `a2aRoutes("/a2a", agent, { hooks: bearerAuth({ ... }) })`. An auth hook
   * here satisfies the production boot guard.
   */
  hooks?: Hooks;
  /**
   * Where to serve the Agent Card. Defaults to {@link A2A_AGENT_CARD_PATH};
   * change it only when several agents share one host and peers are given
   * the card URL directly. Pass `false` to skip the card route.
   */
  cardPath?: PathString | false;
}

/**
 * Build the Daloy route definitions for an A2A agent.
 *
 * Returns the public Agent Card route (`GET` at the well-known path) and the
 * JSON-RPC transport (`POST`, plus `GET` 405 hint and `OPTIONS` preflight at
 * `path`). The route handlers forward `ctx.state` to the A2A handler so
 * `onMessage` and `taskOwner` see the principal your auth middleware set.
 *
 * Unless `{ public: true }` is passed, the `POST` route is stamped so a
 * production `secureDefaults` App **refuses to boot** when no authentication
 * hook covers it, and the card must declare `securitySchemes` so peers know
 * how to authenticate. The card route itself stays public: discovery must
 * work before a peer has credentials.
 *
 * @param path - JSON-RPC endpoint path, e.g. `"/a2a"`. The card's `url`
 *   should be the absolute public URL of this path.
 * @param handler - Handler from {@link createA2aHandler}.
 * @param options - See {@link A2aRoutesOptions}.
 * @returns Route definitions to register with `app.route()`.
 * @throws {TypeError} When not public and the card declares no `securitySchemes`.
 *
 * @example
 * ```ts
 * const auth = bearerAuth({ validate: (t) => timingSafeEqual(t, process.env.A2A_TOKEN!) });
 * for (const route of a2aRoutes("/a2a", agent, { hooks: auth })) app.route(route);
 * ```
 *
 * @since 1.4.0
 */
export function a2aRoutes(
  path: PathString,
  handler: A2aHandler,
  options: A2aRoutesOptions = {}
): RouteDefinition<PathString, "GET" | "POST" | "OPTIONS">[] {
  const isPublic = options.public === true;
  if (!isPublic && Object.keys(handler.agentCard.securitySchemes ?? {}).length === 0) {
    throw new TypeError(
      "A2A card must declare securitySchemes so peers know how to authenticate, or mount with a2aRoutes(path, handler, { public: true })."
    );
  }
  const envelope = documentedSchema(ENVELOPE_JSON_SCHEMA);
  const rpcResponses = {
    200: { description: "A2A JSON-RPC response", body: envelope },
    204: { description: "CORS preflight accepted" },
    400: { description: "Malformed JSON-RPC request" },
    401: { description: "Caller identity could not be resolved" },
    403: { description: "Origin not allowed" },
    405: { description: "Unsupported HTTP method" },
    413: { description: "Request body too large" },
    415: { description: "Unsupported content type" },
    500: { description: "Internal error", body: envelope },
  };
  const rpc = ({ request, state }: { request: Request; state: unknown }) =>
    handler.handleRpc(request, { state: (state ?? {}) as Record<string, unknown> });

  const post: RouteDefinition<PathString, "POST"> = {
    method: "POST",
    path,
    operationId: "a2aPost",
    summary: "A2A JSON-RPC endpoint",
    acknowledgeNoResponseBodySchema: true,
    responses: rpcResponses,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    handler: rpc as never,
  };
  const routes: RouteDefinition<PathString, "GET" | "POST" | "OPTIONS">[] = [
    post as RouteDefinition<PathString, "GET" | "POST" | "OPTIONS">,
    {
      method: "GET",
      path,
      operationId: "a2aGet",
      summary: "A2A JSON-RPC endpoint hint",
      acknowledgeNoResponseBodySchema: true,
      responses: rpcResponses,
      handler: rpc as never,
    },
    {
      method: "OPTIONS",
      path,
      operationId: "a2aOptions",
      summary: "A2A JSON-RPC preflight",
      acknowledgeNoResponseBodySchema: true,
      responses: rpcResponses,
      handler: rpc as never,
    },
  ];
  if (options.cardPath !== false) {
    routes.push({
      method: "GET",
      path: options.cardPath ?? (A2A_AGENT_CARD_PATH as PathString),
      operationId: "a2aAgentCard",
      summary: "A2A public Agent Card",
      acknowledgeNoResponseBodySchema: true,
      responses: {
        200: { description: "Agent Card", body: documentedSchema(CARD_JSON_SCHEMA) },
        304: { description: "Agent Card not modified" },
      },
      handler: (({ request }: { request: Request }) => handler.handleCard(request)) as never,
    });
  }
  // The hint, the preflight and the Agent Card are public by design, and the
  // JSON-RPC route is public when the caller said so: exempt them from
  // app({ requireAuth: true }).
  for (const route of routes) {
    if (route !== post || isPublic) route.public = true;
  }
  const record = post as unknown as Record<PropertyKey, unknown>;
  if (!isPublic) {
    // Same global-registry marker pattern as mcpRoutes(): app.ts reads the
    // bare Symbol.for string so the App core never imports this module.
    record[Symbol.for("daloyjs.a2a.route")] = true;
  }
  const productionHook = (handler as unknown as Record<PropertyKey, unknown>)[
    A2A_APP_PRODUCTION_HOOK
  ];
  if (typeof productionHook === "function") record[A2A_APP_PRODUCTION_HOOK] = productionHook;
  return routes;
}
