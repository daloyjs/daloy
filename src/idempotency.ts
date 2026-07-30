/**
 * First-class `Idempotency-Key` handling for DaloyJS.
 *
 * The {@link idempotency} middleware lets clients safely retry unsafe requests
 * (`POST`, `PUT`, `PATCH`, `DELETE`) without risking duplicate side effects —
 * the table-stakes guarantee for payment surfaces and serverless retries. It
 * mirrors the IETF *The Idempotency-Key HTTP Header Field* draft and the
 * conventions used by major payment processors:
 *
 * 1. The client sends a unique, client-generated `Idempotency-Key` header.
 * 2. On the **first** request the handler runs normally; the framework
 *    fingerprints the request (method + path + body) and persists the final
 *    response keyed by the idempotency key.
 * 3. On a **retry** carrying the same key and the same fingerprint, the stored
 *    response is replayed byte-for-byte (with an `Idempotency-Replayed: true`
 *    marker) — the handler never runs twice.
 * 4. A retry that arrives **while the original is still in flight** gets a
 *    `409 Conflict` so the client backs off instead of racing.
 * 5. Reusing a key with a **different** request body returns `422
 *    Unprocessable Content` — a key is permanently bound to its first payload.
 *
 * The store is pluggable via {@link IdempotencyStore}, mirroring the
 * `SessionStore` / rate-limit-store pattern. The default
 * {@link MemoryIdempotencyStore} is process-local; supply a shared backend
 * (e.g. Redis) for multi-instance deployments.
 *
 * This module is dependency-free and uses only Web Crypto + Web Standard
 * `Request`/`Response`, so it runs unchanged on Node, Bun, Deno, Cloudflare
 * Workers, and Vercel.
 *
 * @module
 * @since 0.37.0
 */

import { BadRequestError, ConflictError, HttpError } from "./errors.js";
import { markSchemaValidatedResponse } from "./internal-response.js";
import type { BaseContext, Hooks } from "./types.js";

const enc = new TextEncoder();

/** Internal `ctx.state` key carrying the reservation between hooks. */
const PENDING_STATE_KEY = "__idempotencyPending";

/**
 * Process-wide registry of in-memory stores shared by
 * {@link IdempotencyOptions.groupId}. Two `idempotency({ groupId: "payments" })`
 * mounts receive the same store so a key reserved on one route is honored on
 * the others.
 *
 * @internal
 */
const SHARED_IDEMPOTENCY_STORES = new Map<string, MemoryIdempotencyStore>();

/**
 * Test-only helper that clears the process-wide shared stores used by
 * `idempotency({ groupId })`. Not part of the documented public API.
 *
 * @internal
 */
export function _resetSharedIdempotencyStoresForTests(): void {
  SHARED_IDEMPOTENCY_STORES.clear();
}

// ---------- Public types ----------

/**
 * A captured HTTP response persisted for replay. The body is stored as
 * standard base64 so arbitrary binary payloads round-trip safely.
 */
export interface StoredIdempotentResponse {
  /** HTTP status code of the original response. */
  status: number;
  /** Response headers as `[name, value]` pairs (lower-cased by `Headers`). */
  headers: Array<[string, string]>;
  /** Base64-encoded response body (empty string for a bodyless response). */
  body: string;
}

/**
 * A persisted idempotency entry. An entry is first written as `in-flight`
 * while the handler runs, then upgraded to `completed` (carrying the captured
 * {@link StoredIdempotentResponse}) once the response is produced.
 */
export interface IdempotencyRecord {
  /** SHA-256 hex fingerprint of the originating request (method + path + body). */
  fingerprint: string;
  /** Lifecycle state of the reservation. */
  status: "in-flight" | "completed";
  /** Captured response, present only when `status` is `"completed"`. */
  response?: StoredIdempotentResponse;
  /** Creation time as ms since epoch. */
  createdAt: number;
  /** Absolute expiration as ms since epoch. */
  expiresAt: number;
}

/**
 * Pluggable persistence backend for {@link idempotency}. All methods may be
 * synchronous or asynchronous. The contract mirrors `SessionStore` /
 * `RateLimitStore`: implementations should treat an `expiresAt` in the past as
 * "missing" and may lazily delete expired records.
 *
 * The {@link reserve} method MUST be atomic ("set if absent") so two
 * concurrent requests carrying the same key cannot both win the reservation —
 * exactly the `SET key value NX` semantics of a Redis backend.
 */
export interface IdempotencyStore {
  /**
   * Atomically reserve `key` for an in-flight request. If `key` is unused,
   * persist `record` with the given TTL and return `null` (the caller now owns
   * the key). If `key` already exists (in-flight or completed), return the
   * existing record **without modifying it**.
   *
   * @param key - The (already namespaced) storage key.
   * @param record - The in-flight record to persist on a successful reservation.
   * @param ttlMs - Time-to-live in milliseconds for the reservation.
   */
  reserve(
    key: string,
    record: IdempotencyRecord,
    ttlMs: number
  ): IdempotencyRecord | null | Promise<IdempotencyRecord | null>;
  /**
   * Persist the final response for a previously reserved key, upgrading it to
   * `completed` so subsequent retries replay it.
   *
   * @param key - The (already namespaced) storage key.
   * @param record - The completed record carrying the captured response.
   * @param ttlMs - Time-to-live in milliseconds for the stored response.
   */
  complete(key: string, record: IdempotencyRecord, ttlMs: number): void | Promise<void>;
  /**
   * Release a reservation so the client may retry. Called when the handler
   * produces a non-cacheable response (e.g. `5xx`) or throws.
   *
   * @param key - The (already namespaced) storage key.
   */
  release(key: string): void | Promise<void>;
}

/** Options for the {@link idempotency} middleware. */
export interface IdempotencyOptions {
  /** Pluggable persistence backend. Default: a fresh in-memory store. */
  store?: IdempotencyStore;
  /** How long a key (and its replayed response) lives, in seconds. Default: `86400` (24h). */
  ttlSeconds?: number;
  /** Request header carrying the key. Default: `"idempotency-key"`. */
  headerName?: string;
  /** Response header marking a replayed response. Default: `"idempotency-replayed"`. */
  replayHeaderName?: string;
  /**
   * HTTP methods the middleware applies to. Requests with other methods pass
   * through untouched even when they carry the header. Default:
   * `["POST", "PUT", "PATCH", "DELETE"]`.
   */
  methods?: string[];
  /**
   * Require the key on every applicable request, returning `400` when it is
   * missing. Default: `false` (idempotency is opt-in per request).
   */
  requireKey?: boolean;
  /** Maximum accepted key length in characters. Default: `255`. */
  maxKeyLength?: number;
  /**
   * Maximum response body size (bytes) the middleware will buffer and store.
   * Larger responses are streamed through without caching and the reservation
   * is released so a later retry can re-run the handler. Default: `1048576`
   * (1 MiB). A guard against unbounded memory growth from large replies.
   */
  maxResponseBytes?: number;
  /**
   * Decide whether a produced response should be cached for replay. Returning
   * `false` releases the reservation so the client may retry. Default: cache
   * any response with status `< 500` (server errors are retryable).
   */
  cacheableStatus?: (status: number) => boolean;
  /**
   * Share a single in-memory store across every `idempotency()` mount that
   * declares the same `groupId`. Only meaningful for the default in-memory
   * store; supply an explicit `store` to coordinate across processes.
   */
  groupId?: string;
  /**
   * Namespace idempotency keys by the calling principal so one client can
   * never replay another client's stored response by reusing the same key
   * (CWE-524 — cross-tenant cached-response disclosure). The returned string
   * is mixed into the store key, so two principals using the *same*
   * `Idempotency-Key` get independent reservations.
   *
   * Defaults to the request's `Authorization` header value, which scopes the
   * common bearer- / API-key-authenticated case (Stripe-style idempotency)
   * out of the box. Override it when identity lives elsewhere, e.g.
   * `scope: (ctx) => ctx.state.session?.id` for cookie-based sessions, or
   * return `undefined` to opt a request out of scoping (e.g. truly public,
   * unauthenticated idempotent writes). Returning a stable per-user id is
   * preferable to the raw credential when tokens rotate between retries.
   *
   * **Supply this whenever `Authorization` is not per-user.** The default assumes
   * that header names one caller. If it is shared — a per-tenant API key, a
   * service token, a gateway credential — with end users distinguished some other
   * way (a session cookie, a subject claim your app reads), then the default
   * partitions per *tenant* and every user inside one tenant shares a namespace.
   * A caller who knows another's `Idempotency-Key` can then replay their stored
   * response. This is not detectable from the header alone, which is why it is
   * your call rather than a framework guard: a resolvable-but-coarse scope looks
   * identical to a correctly per-user one. The cookie-only case *is* guarded —
   * see {@link allowUnscopedCallers}.
   *
   * Independently of scoping, a replay never re-issues `Set-Cookie`, so a coarse
   * namespace cannot escalate from disclosing a response body into handing over a
   * live session.
   *
   * @since 0.40.0
   */
  scope?: (ctx: BaseContext<any, any>) => string | undefined | Promise<string | undefined>;
  /**
   * Accept callers the default {@link scope} resolver cannot identify, letting
   * them share one idempotency namespace. Default `false`.
   *
   * The guard this disables exists because a cookie-authenticated request
   * carries no `Authorization` header, so the default resolver returns
   * `undefined` and the namespace collapses. The retry fingerprint (method +
   * path + body) is then all that separates two users — and two users
   * submitting the same payload fingerprint identically, so one replays the
   * other's stored response (CWE-524). Rather than share the namespace
   * silently, a cookie-bearing request with no resolvable scope throws with an
   * actionable message.
   *
   * Set this to `true` only when unscoped callers are genuinely interchangeable
   * — a public, unauthenticated idempotent write where no response body is
   * caller-specific. Supplying {@link scope} is almost always the right answer
   * instead. A custom `scope` bypasses the guard entirely, including when it
   * returns `undefined`, because an explicit resolver owns its own posture.
   *
   * @since 1.0.0-rc.8
   */
  allowUnscopedCallers?: boolean;
}

// ---------- Default store ----------

/**
 * Default cap on live records held by {@link MemoryIdempotencyStore}.
 *
 * Each record can hold a base64 response body up to
 * {@link IdempotencyOptions.maxResponseBytes} (1 MiB by default), so the cap is
 * what actually bounds this store's footprint. Matches the size at which the
 * store already attempted an expiry sweep.
 */
const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 10_000;

/**
 * In-memory {@link IdempotencyStore}. Suitable for tests and single-process
 * deployments. Expired records are dropped on access.
 *
 * Growth is bounded by {@link maxEntries}: an expiry sweep runs first, and if the
 * store is still at the cap the oldest surviving record is evicted. The sweep
 * alone is not a bound — it only drops records that have *expired*, so a stream
 * of unique keys inside the TTL grew the map linearly no matter how often it ran,
 * with each entry pinning a stored response body.
 *
 * Evicting a live record can only cost exactly-once semantics for a retry that
 * arrives after the eviction — it re-executes rather than replaying. That is the
 * right trade against unbounded memory, but it is a reason to supply a shared
 * (e.g. Redis) store for any deployment where the key volume approaches the cap.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, IdempotencyRecord>();
  private readonly maxEntries: number;

  /**
   * @param maxEntries - Maximum live records retained. Must be a positive
   *   integer. Default {@link DEFAULT_MAX_IDEMPOTENCY_ENTRIES} (10 000).
   * @throws Error when `maxEntries` is not a positive integer.
   */
  constructor(maxEntries: number = DEFAULT_MAX_IDEMPOTENCY_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error(
        `MemoryIdempotencyStore: maxEntries must be a positive integer; got ${String(maxEntries)}.`
      );
    }
    this.maxEntries = maxEntries;
  }

  /**
   * @inheritDoc
   * `_ttlMs` is part of the {@link IdempotencyStore} contract but unused here:
   * the in-memory store derives expiry from `record.expiresAt`.
   */
  reserve(key: string, record: IdempotencyRecord, _ttlMs?: number): IdempotencyRecord | null {
    const existing = this.read(key);
    if (existing) return existing;
    if (this.map.size >= this.maxEntries) {
      this.prune();
      // Still full: every record is live, so drop the oldest. `Map` iterates in
      // insertion order, and `complete()` overwrites in place rather than
      // re-inserting, so the first key is the least recently reserved.
      while (this.map.size >= this.maxEntries) {
        const oldest = this.map.keys().next();
        if (oldest.done) break;
        this.map.delete(oldest.value);
      }
    }
    this.map.set(key, record);
    return null;
  }

  /** @inheritDoc */
  complete(key: string, record: IdempotencyRecord, _ttlMs?: number): void {
    this.map.set(key, record);
  }

  /** @inheritDoc */
  release(key: string): void {
    this.map.delete(key);
  }

  private read(key: string): IdempotencyRecord | null {
    const rec = this.map.get(key);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return rec;
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }

  /** Test helper. Remove every record. */
  clear(): void {
    this.map.clear();
  }

  /** Test helper. Number of stored records (including expired). */
  size(): number {
    return this.map.size;
  }
}

// ---------- Internal helpers ----------

interface PendingReservation {
  storeKey: string;
  fingerprint: string;
}

function getSubtle(): SubtleCrypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "idempotency(): Web Crypto (crypto.subtle) is required. Provide a polyfill in environments without it."
    );
  }
  return c.subtle;
}

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += HEX[b >> 4]! + HEX[b & 0x0f]!;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Deterministic, key-order-insensitive serialization of a parsed request body
 * so two logically-identical retries fingerprint the same.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

async function computeFingerprint(method: string, ctx: BaseContext<any, any>): Promise<string> {
  const url = new URL(ctx.request.url);
  const material = `${method}\n${url.pathname}${url.search}\n${stableStringify(ctx.body)}`;
  return sha256Hex(material);
}

/**
 * SHA-256 hex of an arbitrary string. Used to fingerprint requests and to
 * derive a fixed-length, delimiter-safe tag for the caller-scope namespace so
 * a long or attacker-controlled `Authorization` value cannot inject into or
 * bloat the store key.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await getSubtle().digest("SHA-256", enc.encode(input)));
  return bytesToHex(digest);
}

// Printable ASCII only (no control chars / whitespace). Anchored + bounded to
// the character class, so this is linear-time and ReDoS-free.
const KEY_PATTERN = /^[\x21-\x7e]+$/;

function validateKey(key: string, headerName: string, maxLen: number): void {
  if (key.length === 0) {
    throw new BadRequestError(`${headerName} header must not be empty.`);
  }
  if (key.length > maxLen) {
    throw new BadRequestError(`${headerName} header must be at most ${maxLen} characters.`);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new BadRequestError(`${headerName} header contains invalid characters.`);
  }
}

/**
 * Response headers that must never be stored for replay.
 *
 * `set-cookie` is the security-critical entry. A stored response was replayed
 * with every header the original produced, so a `Set-Cookie` issued to the first
 * caller was re-issued to whoever replayed the record. Combined with any
 * coarse-scoped namespace (a shared tenant `Authorization`, or an explicit
 * `allowUnscopedCallers: true`) that promotes a body disclosure into handing over
 * a live session — account takeover rather than data leakage. Even for a
 * correctly scoped, genuinely same-caller retry it is wrong: the replay would
 * resurrect a cookie the handler set once, silently rolling back a session
 * rotation performed at login or on a privilege change.
 *
 * Unlike `responseCache()`, which refuses to store a `Set-Cookie` response at
 * all, idempotency strips and stores: declining to store would release the
 * reservation and let a retry re-execute the handler, which for a payment or
 * order endpoint is the double-charge this middleware exists to prevent.
 * Stripping keeps exactly-once semantics and drops only the header that must not
 * be replayed.
 *
 * The remainder are hop-by-hop or per-request fields (RFC 9110 §7.6.1) that
 * describe the one connection or the one request that populated the record;
 * replaying `x-request-id` in particular hands every later caller a correlation
 * id belonging to someone else's request.
 */
const NEVER_REPLAYED_HEADERS: ReadonlySet<string> = new Set([
  "set-cookie",
  "set-cookie2",
  "age",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-request-id",
]);

async function captureResponse(
  res: Response,
  maxBytes: number
): Promise<StoredIdempotentResponse | null> {
  const buf = new Uint8Array(await res.clone().arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  const headers: Array<[string, string]> = [];
  res.headers.forEach((value, name) => {
    // Filter on capture, not on replay, so a credential never reaches the store
    // in the first place — a shared (Redis) store would otherwise persist one
    // caller's session cookie for the whole TTL.
    if (!NEVER_REPLAYED_HEADERS.has(name.toLowerCase())) headers.push([name, value]);
  });
  return { status: res.status, headers, body: buf.byteLength ? bytesToBase64(buf) : "" };
}

function buildReplayResponse(stored: StoredIdempotentResponse, replayHeaderName: string): Response {
  const headers = new Headers();
  for (const [name, value] of stored.headers) {
    // Filtered on capture already; re-checked here so a record written by an
    // older build — or by any other writer sharing the same Redis store — cannot
    // replay a credential either.
    if (NEVER_REPLAYED_HEADERS.has(name.toLowerCase())) continue;
    headers.set(name, value);
  }
  headers.set(replayHeaderName, "true");
  const body = stored.body ? base64ToBytes(stored.body) : null;
  return markSchemaValidatedResponse(
    new Response(body as BodyInit | null, { status: stored.status, headers })
  );
}

// ---------- Middleware ----------

/**
 * Internal Symbol stamped on the hooks {@link idempotency} returns, so `App`'s
 * boot guards can see where a stored-response replay sits in a route's effective
 * hook chain.
 *
 * A replay is returned from `beforeHandle` and ends the hook chain, which means
 * anything enforcing from the *same* phase but mounted later never runs. That is
 * how a `rateLimit()` behind a replay stops counting. The marker lets the boot
 * path refuse that order rather than leave the limiter silently infinite.
 *
 * @internal
 */
export const IDEMPOTENCY_HOOK_MARKER: unique symbol = Symbol.for("daloyjs.idempotency.hook");

/**
 * Idempotency-key middleware. Mount it ahead of the routes that need
 * exactly-once semantics under retries (typically the payment / write
 * surface).
 *
 * Behavior for an applicable method (see {@link IdempotencyOptions.methods}):
 *
 * - **No key** → pass through (or `400` when {@link IdempotencyOptions.requireKey}).
 * - **First key** → run the handler, then persist the response keyed by the
 *   request fingerprint for {@link IdempotencyOptions.ttlSeconds}.
 * - **Same key + same body, completed** → replay the stored response with an
 *   `Idempotency-Replayed: true` header; the handler does not run.
 * - **Same key, still in flight** → {@link ConflictError} (`409`).
 * - **Same key + different body** → `422 Unprocessable Content` (a key is
 *   permanently bound to its first payload).
 *
 * Responses that fail {@link IdempotencyOptions.cacheableStatus} (server errors
 * by default) or exceed {@link IdempotencyOptions.maxResponseBytes} are not
 * cached and the reservation is released so the client can retry.
 *
 * @example
 * ```ts
 * import { idempotency } from "@daloyjs/core";
 *
 * app.use(idempotency({ ttlSeconds: 86_400 }));
 * ```
 *
 * @param opts - Idempotency configuration.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @since 0.37.0
 */
export function idempotency(opts: IdempotencyOptions = {}): Hooks {
  const ttlSeconds = opts.ttlSeconds ?? 86_400;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("idempotency(): ttlSeconds must be a positive integer.");
  }
  const maxKeyLength = opts.maxKeyLength ?? 255;
  if (!Number.isInteger(maxKeyLength) || maxKeyLength <= 0) {
    throw new Error("idempotency(): maxKeyLength must be a positive integer.");
  }
  const maxResponseBytes = opts.maxResponseBytes ?? 1_048_576;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("idempotency(): maxResponseBytes must be a positive integer.");
  }

  const headerName = (opts.headerName ?? "idempotency-key").toLowerCase();
  const replayHeaderName = (opts.replayHeaderName ?? "idempotency-replayed").toLowerCase();
  const methods = new Set(
    (opts.methods ?? ["POST", "PUT", "PATCH", "DELETE"]).map((m) => m.toUpperCase())
  );
  const requireKey = opts.requireKey === true;
  const allowUnscopedCallers = opts.allowUnscopedCallers === true;
  const cacheableStatus = opts.cacheableStatus ?? ((status: number) => status < 500);
  const ttlMs = ttlSeconds * 1_000;

  let store: IdempotencyStore;
  if (opts.store) {
    store = opts.store;
  } else if (opts.groupId) {
    let shared = SHARED_IDEMPOTENCY_STORES.get(opts.groupId);
    if (!shared) {
      shared = new MemoryIdempotencyStore();
      SHARED_IDEMPOTENCY_STORES.set(opts.groupId, shared);
    }
    store = shared;
  } else {
    store = new MemoryIdempotencyStore();
  }
  const keyPrefix = opts.groupId ? `${opts.groupId}:` : "";

  const hooks: Hooks = {
    async beforeHandle(ctx) {
      const method = ctx.request.method.toUpperCase();
      if (!methods.has(method)) return undefined;

      const rawKey = ctx.request.headers.get(headerName);
      if (rawKey === null || rawKey.trim() === "") {
        if (requireKey) {
          throw new BadRequestError(`Missing required ${headerName} header.`);
        }
        return undefined;
      }

      const key = rawKey.trim();
      validateKey(key, headerName, maxKeyLength);

      const fingerprint = await computeFingerprint(method, ctx);
      // Namespace the key by the calling principal so client B can never
      // replay client A's stored response by reusing the same Idempotency-Key
      // (CWE-524). Defaults to the Authorization header; `scope` overrides.
      const scopeRaw = opts.scope
        ? await opts.scope(ctx)
        : (ctx.request.headers.get("authorization") ?? undefined);
      // A credentialed request the default resolver cannot see is the dangerous
      // case: cookie-session auth sends no `Authorization`, so `scopeRaw` is
      // undefined, the namespace collapses to the shared one, and the retry
      // fingerprint (method + path + body) becomes the only thing separating two
      // users. Two users legitimately submit the same payload fingerprint
      // identically — so client B replays client A's stored response, which is
      // exactly the CWE-524 disclosure `scope` exists to prevent.
      //
      // Fail loudly rather than share the namespace. This mirrors
      // `responseCache()`, which treats `Cookie` as a credential alongside
      // `Authorization` for the same reason. Only fires when a cookie is present
      // *and* nothing resolved, so the documented bearer-token path is untouched
      // and a genuinely anonymous caller still shares the unscoped namespace.
      //
      // Deliberately NOT widened to "any cookie-bearing request". A resolvable
      // scope can still be too coarse — a per-tenant API key with
      // cookie-identified end users partitions per tenant while every user inside
      // one shares a namespace — but that is indistinguishable from the far more
      // common shape of a *per-user* bearer token arriving alongside incidental
      // browser cookies (analytics, consent, CSRF), where the default is already
      // correct. Keying the guard on the cookie's presence rejects that setup with
      // a 500, so the check stays where the default is provably useless rather
      // than merely possibly coarse. Callers whose `Authorization` is shared
      // across users must pass `scope` — see the TSDoc on
      // {@link IdempotencyOptions.scope}. Independently of scoping, `Set-Cookie`
      // is never stored or replayed (see {@link NEVER_REPLAYED_HEADERS}), so a
      // coarse namespace cannot escalate into handing over a live session.
      if (
        !opts.scope &&
        scopeRaw === undefined &&
        !allowUnscopedCallers &&
        ctx.request.headers.has("cookie")
      ) {
        throw new Error(
          "idempotency(): cannot determine the calling principal for a cookie-bearing request. " +
            "The default scope reads the Authorization header, which this request does not carry, " +
            "so every cookie-authenticated caller would share one idempotency namespace and could " +
            "replay another caller's stored response (CWE-524). Pass " +
            "`scope: (ctx) => ctx.state.session?.id` (or another stable per-caller id), or set " +
            "`allowUnscopedCallers: true` if these callers are genuinely interchangeable."
        );
      }
      const scopeTag = scopeRaw ? `${await sha256Hex(scopeRaw)}:` : "";
      const storeKey = `${keyPrefix}${scopeTag}${key}`;
      const now = Date.now();
      const record: IdempotencyRecord = {
        fingerprint,
        status: "in-flight",
        createdAt: now,
        expiresAt: now + ttlMs,
      };

      const reserveResult = store.reserve(storeKey, record, ttlMs);
      const existing = isPromiseLike(reserveResult) ? await reserveResult : reserveResult;

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new HttpError(
            422,
            {
              type: "https://daloyjs.dev/errors/idempotency-key-reuse",
              title: "Unprocessable Content",
              detail: `The ${headerName} header was already used with a different request payload.`,
            },
            { "cache-control": "no-store" }
          );
        }
        if (existing.status === "in-flight") {
          throw new ConflictError(
            `A request with this ${headerName} is still being processed. Retry after it completes.`
          );
        }
        // Completed: replay the stored response verbatim.
        return buildReplayResponse(existing.response!, replayHeaderName);
      }

      (ctx.state as Record<string, unknown>)[PENDING_STATE_KEY] = {
        storeKey,
        fingerprint,
      } satisfies PendingReservation;
      return undefined;
    },

    async onSend(res, ctx) {
      if (!ctx) return undefined;
      const state = ctx.state as Record<string, unknown>;
      const pending = state[PENDING_STATE_KEY] as PendingReservation | undefined;
      if (!pending) return undefined;
      // Consume once: a replayed response on a later retry must not re-store.
      delete state[PENDING_STATE_KEY];

      if (!cacheableStatus(res.status)) {
        await store.release(pending.storeKey);
        return undefined;
      }

      const captured = await captureResponse(res, maxResponseBytes);
      if (captured === null) {
        // Body too large to cache safely: drop the reservation so retries work.
        await store.release(pending.storeKey);
        return undefined;
      }

      const now = Date.now();
      const completeResult = store.complete(
        pending.storeKey,
        {
          fingerprint: pending.fingerprint,
          status: "completed",
          response: captured,
          createdAt: now,
          expiresAt: now + ttlMs,
        },
        ttlMs
      );
      if (isPromiseLike(completeResult)) await completeResult;
      return undefined;
    },
  };
  (hooks as Record<PropertyKey, unknown>)[IDEMPOTENCY_HOOK_MARKER] = true;
  return hooks;
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
