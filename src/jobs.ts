/**
 * Queue-agnostic background jobs for DaloyJS.
 *
 * Where {@link Scheduler} answers *&ldquo;run this work in this process, on this
 * clock&rdquo;*, this module answers *&ldquo;run this work somewhere,
 * eventually&rdquo;* — the three things a production job interface needs:
 *
 * - **A durable record.** {@link JobStore.put} persists a named JSON payload
 *   so the work survives the HTTP request and the process that accepted it.
 *   {@link MemoryJobStore} is correct for tests and single-process apps;
 *   production supplies a shared adapter (Redis, Postgres, SQS) that
 *   implements the same SPI. Core stays zero-dependency.
 * - **At-least-once execution.** {@link createJobWorker} claims a lease,
 *   runs an allowlisted handler, and completes or fails with bounded
 *   retries (exponential backoff, full jitter) and a dead-letter status.
 *   If the process dies after the side effect but before complete, the
 *   lease expires and another worker may run it again — handlers must be
 *   idempotent. {@link EnqueueOptions.idempotencyKey} collapses duplicate
 *   producers (same key + same payload) the way HTTP `idempotency()`
 *   collapses duplicate POSTs.
 * - **A clean split from workflows.** This is not Temporal, Inngest, or
 *   Vercel Workflow: there is no replay of TypeScript, no &ldquo;world&rdquo;,
 *   and no `await sleep("7 days")` inside a function body. Delayed jobs and
 *   retries are *new attempts of the same record*, not continuations.
 *
 * Pair `App.useJobs` to attach a queue (and optionally a worker that
 * drains on graceful shutdown) and `App.cronEnqueue` when a cron tick
 * should create a job instead of running the side effect in-process.
 *
 * @example
 * ```ts
 * import { createJobQueue, createJobWorker, MemoryJobStore } from "@daloyjs/core/jobs";
 *
 * const store = new MemoryJobStore();
 * const queue = createJobQueue({ store });
 * const worker = createJobWorker({
 *   queue,
 *   handlers: {
 *     "email.welcome": async ({ job, signal }) => {
 *       await sendEmail(job.payload, { signal });
 *     },
 *   },
 * });
 * await queue.enqueue({ name: "email.welcome", payload: { to: "a@b.c" } });
 * await worker.runOnce();
 * ```
 *
 * @module
 * @since 1.3.0
 */

import { isForbiddenObjectKey, safeJsonParse } from "./security.js";
import type { SchedulerLogger, TimerFns } from "./scheduler.js";

const enc = new TextEncoder();

// ── errors ──────────────────────────────────────────────────────────

/**
 * Machine-readable reason carried by a {@link JobConfigError}.
 *
 * - `invalid_name` — job or queue name failed the charset allowlist.
 * - `invalid_payload` — payload (or result) is not plain JSON, or carries a
 *   prototype-pollution key.
 * - `payload_too_large` — serialized payload (or result) exceeds
 *   {@link JobQueueOptions.payloadMaxBytes}.
 * - `invalid_option` — a numeric/enum option failed validation, or a
 *   lifecycle call was duplicated (`useJobs` twice, worker `start()` twice).
 * - `unknown_handler` — no handler was registered for a claimed job's name.
 * - `store_required` — an operation needs a queue that was never configured
 *   (for example `app.cronEnqueue()` before `app.useJobs()`).
 * - `store_full` — a bounded store rejected a new job because it is at
 *   capacity.
 *
 * @since 1.3.0
 */
export type JobConfigErrorCode =
  | "invalid_name"
  | "invalid_payload"
  | "payload_too_large"
  | "invalid_option"
  | "unknown_handler"
  | "store_required"
  | "store_full";

/**
 * Enqueue validation, unknown names at define-time, and bad options. An
 * ordinary `Error` subclass (like `CronParseError`), not an `HttpError` —
 * the jobs engine is a library, not a mounted route; map it to `400`/`422`
 * in your own contract route if you expose enqueue over HTTP.
 *
 * @since 1.3.0
 */
export class JobConfigError extends Error {
  /** Machine-readable failure reason; see {@link JobConfigErrorCode}. */
  readonly code: JobConfigErrorCode;

  constructor(code: JobConfigErrorCode, message: string) {
    super(message);
    this.name = "JobConfigError";
    this.code = code;
  }
}

/**
 * Same idempotency key, different payload fingerprint. A key is permanently
 * bound to the first payload it was enqueued with — mirroring the `422`
 * key-reuse rule of the HTTP `idempotency()` middleware.
 *
 * @since 1.3.0
 */
export class JobIdempotencyConflictError extends Error {
  /** Machine-readable failure reason. */
  readonly code = "idempotency_conflict" as const;
  /** The idempotency key that was reused. */
  readonly key: string;
  /** The id of the job that already holds the key. */
  readonly existingJobId: string;

  constructor(key: string, existingJobId: string) {
    super(
      `Job idempotency key "${key}" was already used with a different payload ` +
        `(existing job "${existingJobId}").`
    );
    this.name = "JobIdempotencyConflictError";
    this.key = key;
    this.existingJobId = existingJobId;
  }
}

/**
 * Thrown by a handler (or the worker, for an unknown job name) to signal
 * &ldquo;do not retry&rdquo; — the job is dead-lettered on the spot, however
 * many attempts remain. Analogous to a webhook SSRF / permanent-4xx failure.
 *
 * @since 1.3.0
 */
export class JobFatalError extends Error {
  /** Machine-readable failure reason. */
  readonly code = "fatal" as const;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "JobFatalError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * A claimed job exceeded its `timeoutMs`; the worker aborted the handler's
 * signal and failed the job as retryable (unless the attempt budget is
 * already exhausted).
 *
 * @since 1.3.0
 */
export class JobTimeoutError extends Error {
  /** Machine-readable failure reason. */
  readonly code = "timeout" as const;
  /** The per-attempt timeout that elapsed, in ms. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Job exceeded its timeoutMs of ${timeoutMs}ms and was aborted.`);
    this.name = "JobTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ── job record ──────────────────────────────────────────────────────

/**
 * Lifecycle states of a {@link Job}. Terminal states (`completed`, `dead`,
 * `cancelled`) have no outgoing transitions.
 *
 * ```text
 * delayed  --(runAt <= now)--> queued
 * queued   --claim--> running
 * running  --complete--> completed   (terminal)
 * running  --fail, attempts < max--> delayed (runAt = now + backoff)
 * running  --fail, attempts >= max--> dead     (terminal)
 * running  --JobFatalError--> dead             (terminal)
 * running  --lease expired--> queued           (attempts already counted)
 * queued/delayed/running --cancel--> cancelled (terminal)
 * ```
 *
 * @since 1.3.0
 */
export type JobStatus = "queued" | "delayed" | "running" | "completed" | "dead" | "cancelled";

/**
 * A serializable snapshot of one unit of background work: an opaque named
 * handler plus a plain-JSON payload. All fields are readonly snapshots —
 * mutate nothing; stores return deep copies.
 *
 * @since 1.3.0
 */
export interface Job<P = unknown> {
  /** Unique job id (`crypto.randomUUID()`). */
  readonly id: string;
  /** Named partition inside the store (`default`, `mail`, …). */
  readonly queue: string;
  /** Handler registry key. */
  readonly name: string;
  /** Plain-JSON handler input, validated at enqueue. */
  readonly payload: P;
  /** Current lifecycle state. */
  readonly status: JobStatus;
  /** How many times execution has started, including the current run. */
  readonly attempts: number;
  /** Maximum starts before the job dead-letters. */
  readonly maxAttempts: number;
  /** Earliest epoch ms the job may be claimed. */
  readonly runAt: number;
  /** Epoch ms the record was created. */
  readonly createdAt: number;
  /** Epoch ms the record last changed. */
  readonly updatedAt: number;
  /** Epoch ms the current lease ends, or `null` when not claimed. */
  readonly leaseUntil: number | null;
  /** Worker holding the lease, or `null` when not claimed. */
  readonly lockedBy: string | null;
  /** Lease duration granted per claim, in ms. */
  readonly leaseMs: number;
  /** Producer-supplied dedupe key, unique per queue, or `null`. */
  readonly idempotencyKey: string | null;
  /** Claim ordering: higher first. */
  readonly priority: number;
  /** Per-attempt timeout in ms; `0` disables. */
  readonly timeoutMs: number;
  /** Message of the most recent failure, or `null`. */
  readonly lastError: string | null;
  /** Epoch ms the job completed, or `null`. */
  readonly completedAt: number | null;
  /** Optional value stored at completion (the handler's return value). */
  readonly result: unknown | null;
  /** Optional tenant discriminator copied from enqueue (data, not authz). */
  readonly tenant: string | null;
}

/**
 * Input to {@link JobQueue.enqueue}. Only `name` and `payload` are required.
 *
 * @since 1.3.0
 */
export interface EnqueueOptions<P = unknown> {
  /** Handler registry key: `^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$`. */
  name: string;
  /** Plain-JSON handler input. Not a blob store — see `payloadMaxBytes`. */
  payload: P;
  /** Named partition. Default `"default"`. Charset `[a-zA-Z0-9_:-]{1,64}`. */
  queue?: string;
  /**
   * Unique-per-queue dedupe key. A second enqueue with the same key and a
   * deep-equal payload returns the existing job with `duplicate: true`; the
   * same key with a different payload throws {@link JobIdempotencyConflictError}.
   * Printable ASCII, 1–255 chars — build tenant-safe keys with
   * {@link jobIdempotencyKey}.
   */
  idempotencyKey?: string;
  /** Absolute earliest claim time. If in the future, status starts `delayed`. */
  runAt?: number | Date;
  /** Relative delay in ms. Ignored when {@link runAt} is set. */
  delayMs?: number;
  /** Claim ordering: higher first. Default `0`. */
  priority?: number;
  /** Maximum starts before dead-letter. Default `5`. */
  maxAttempts?: number;
  /** Per-attempt timeout in ms; `0` disables (dangerous). Default `30_000`. */
  timeoutMs?: number;
  /** Lease duration granted per claim in ms. Default `30_000`. */
  leaseMs?: number;
  /**
   * Optional tenant discriminator copied onto the record for store key
   * partitioning and logs. Validated against the same `[a-z0-9_-]` grammar
   * as `tenancy()` ids. Jobs are not HTTP — pass `ctx.state.tenant`
   * explicitly; nothing reads it for you.
   */
  tenant?: string;
}

/**
 * Outcome of {@link JobQueue.enqueue} / {@link JobStore.put}.
 *
 * @since 1.3.0
 */
export interface EnqueueResult<P = unknown> {
  /** The created job, or the existing one on an idempotency hit. */
  job: Job<P>;
  /** `true` when an existing job was returned due to an idempotency-key hit. */
  duplicate: boolean;
}

// ── store SPI ───────────────────────────────────────────────────────

/**
 * Persistence SPI — the whole point of &ldquo;queue-agnostic&rdquo;. All
 * durability lives behind this interface; durable backends (Redis, Postgres,
 * SQS) are user-supplied adapters, never core dependencies. Every method may
 * be synchronous or asynchronous, mirroring `IdempotencyStore`.
 *
 * Implementations must treat {@link JobStore.claim} and {@link JobStore.put}
 * as atomic: two concurrent claims must never hand the same job to two
 * workers, and two concurrent puts with the same idempotency key must never
 * create two records.
 *
 * @since 1.3.0
 */
export interface JobStore {
  /**
   * Insert a new job. If `idempotencyKey` is set and a job already exists in
   * this queue with that key, return the existing job with `duplicate: true`
   * WITHOUT modifying it — even if it is terminal (first-writer-wins). If the
   * existing payload fingerprint differs, throw
   * {@link JobIdempotencyConflictError}.
   *
   * @param job - The fully-formed record to persist.
   * @param fingerprint - SHA-256 hex of the serialized payload, or `null`
   *   when no idempotency key is set. Provided so adapters can compare
   *   payloads without re-hashing.
   */
  put(job: Job, fingerprint: string | null): Promise<EnqueueResult> | EnqueueResult;

  /**
   * Atomically select the next runnable job in `queue` (`queued`, or
   * `delayed` with `runAt <= now`, or `running` with an expired lease),
   * highest `priority` first, then oldest `runAt` / `createdAt`. Set
   * `status = "running"`, `leaseUntil = now + job.leaseMs`,
   * `lockedBy = workerId`, increment `attempts`, and return the claimed
   * record. Return `null` when nothing is runnable.
   *
   * @param queue - The partition to claim from (never cross-queue).
   * @param workerId - Identity written to `lockedBy` for fencing.
   * @param now - Epoch ms, injected for deterministic leases.
   */
  claim(queue: string, workerId: string, now: number): Promise<Job | null> | Job | null;

  /**
   * Extend the lease of a running job still owned by `workerId`.
   *
   * @returns `false` when the lease was lost (not running, wrong owner, or
   *   already expired) — the caller must stop touching the job.
   */
  heartbeat(
    id: string,
    workerId: string,
    leaseUntil: number,
    now: number
  ): Promise<boolean> | boolean;

  /**
   * Mark a running job owned by `workerId` as `completed` (terminal),
   * storing an optional result value.
   *
   * @returns `false` when the lease was lost — the worker must treat the
   *   completion as not persisted.
   */
  complete(
    id: string,
    workerId: string,
    now: number,
    result: unknown | null
  ): Promise<boolean> | boolean;

  /**
   * Record a failure for a running job owned by `workerId`. Attempts were
   * already incremented at claim time: when `attempts >= maxAttempts` the
   * store marks the job `dead`; otherwise it applies `next` (requeue
   * `delayed` until `runAt`, or straight back to `queued`).
   *
   * @returns `false` when the lease was lost — another worker owns the job.
   */
  fail(
    id: string,
    workerId: string,
    error: string,
    next: { status: "delayed" | "queued" | "dead"; runAt: number },
    now: number
  ): Promise<boolean> | boolean;

  /**
   * Cancel a non-terminal job. Terminal jobs return `false`.
   */
  cancel(id: string, now: number): Promise<boolean> | boolean;

  /**
   * Read one job by id, or `null` when unknown. Expired leases are reaped
   * lazily before the snapshot is taken.
   */
  get(id: string, now: number): Promise<Job | null> | Job | null;

  /**
   * Optional filtered listing — required on {@link MemoryJobStore} for
   * tests and inspection; production adapters may omit it.
   */
  list?(filter?: {
    queue?: string;
    status?: JobStatus | JobStatus[];
    name?: string;
    tenant?: string;
  }): Promise<readonly Job[]> | readonly Job[];
}

// ── internal helpers ────────────────────────────────────────────────

// Anchored, bounded character-class allowlists — linear-time, ReDoS-free.
const JOB_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$/;
const QUEUE_NAME_RE = /^[a-zA-Z0-9_:-]{1,64}$/;
// Printable ASCII only (no control chars / whitespace), 1–255 chars — the
// same grammar as the HTTP Idempotency-Key header.
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;
// Tenant ids share the tenancy() default grammar: lowercase DNS-label-like,
// safe to embed in keys and log lines.
const TENANT_RE = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

function assertJobName(name: string): string {
  if (typeof name !== "string" || !JOB_NAME_RE.test(name)) {
    throw new JobConfigError(
      "invalid_name",
      `Invalid job name ${JSON.stringify(String(name))}: must match ^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$.`
    );
  }
  return name;
}

function assertQueueName(queue: string): string {
  if (typeof queue !== "string" || !QUEUE_NAME_RE.test(queue)) {
    throw new JobConfigError(
      "invalid_name",
      `Invalid queue name ${JSON.stringify(String(queue))}: must match ^[a-zA-Z0-9_:-]{1,64}$.`
    );
  }
  return queue;
}

function assertIdempotencyKey(key: string): string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_RE.test(key)) {
    throw new JobConfigError(
      "invalid_option",
      "Job idempotencyKey must be 1-255 printable ASCII characters (no whitespace or control characters)."
    );
  }
  return key;
}

function assertTenant(tenant: string): string {
  if (typeof tenant !== "string" || !TENANT_RE.test(tenant)) {
    throw new JobConfigError(
      "invalid_option",
      `Invalid tenant ${JSON.stringify(String(tenant))}: must match the tenancy() id grammar ` +
        `^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$.`
    );
  }
  return tenant;
}

/**
 * Serialize a payload (or completion result) to JSON under the same rules:
 * plain JSON only, prototype-pollution keys rejected (never stripped —
 * silent key dropping is how `__proto__` smuggles past a review), byte size
 * capped. A `JSON.stringify` replacer throws on forbidden keys, so the
 * check rides the one traversal the serialization already performs.
 */
function serializePayload(
  payload: unknown,
  maxBytes: number,
  what: "payload" | "result"
): { json: string; bytes: Uint8Array } {
  if (
    payload === undefined ||
    typeof payload === "function" ||
    typeof payload === "symbol" ||
    typeof payload === "bigint"
  ) {
    throw new JobConfigError(
      "invalid_payload",
      `Job ${what} must be a JSON-serializable value; got ${payload === undefined ? "undefined" : typeof payload}.`
    );
  }
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    // Reject class instances at the top level (Date, Map, Uint8Array, …):
    // they stringify by silently dropping or reshaping data. Nested values
    // follow ordinary JSON.stringify semantics (Date -> ISO string, …).
    const proto: unknown = Object.getPrototypeOf(payload);
    if (proto !== Object.prototype && proto !== null) {
      throw new JobConfigError(
        "invalid_payload",
        `Job ${what} must be a plain JSON object, array, or primitive; got a non-plain object.`
      );
    }
  }
  let json: string;
  try {
    json = JSON.stringify(payload, (key, value) => {
      if (key !== "" && isForbiddenObjectKey(key)) {
        throw new JobConfigError(
          "invalid_payload",
          `Job ${what} contains forbidden key "${key}" (prototype pollution).`
        );
      }
      return value;
    }) as string;
  } catch (error) {
    if (error instanceof JobConfigError) throw error;
    throw new JobConfigError(
      "invalid_payload",
      `Job ${what} is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const bytes = enc.encode(json);
  if (bytes.byteLength > maxBytes) {
    throw new JobConfigError(
      "payload_too_large",
      `Job ${what} is ${bytes.byteLength} bytes serialized; the limit is ${maxBytes} bytes. ` +
        "Jobs are not a blob store — put large payloads in object storage and enqueue the URL."
    );
  }
  return { json, bytes };
}

function getSubtle(): SubtleCrypto {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "jobs: Web Crypto (crypto.subtle) is required for idempotency fingerprints. " +
        "Provide a polyfill in environments without it."
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

/** SHA-256 hex of already-serialized payload bytes (idempotency fingerprint). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await getSubtle().digest("SHA-256", bytes as BufferSource));
  return bytesToHex(digest);
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Await a store result that may be sync or async (the SPI allows both). */
async function settle<T>(value: T | Promise<T>): Promise<T> {
  return isPromiseLike<T>(value) ? await value : value;
}

function randomId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Web-Crypto is mandatory on every runtime Daloy supports; this is an
  // unreachable last-resort guard so a missing global never throws.
  throw new Error("WebCrypto unavailable: cannot generate a job id");
}

/** Cap persisted error strings so a huge stack cannot bloat the store. */
const MAX_ERROR_CHARS = 2_000;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.length > MAX_ERROR_CHARS ? `${raw.slice(0, MAX_ERROR_CHARS)}…` : raw;
}

// ── backoff ─────────────────────────────────────────────────────────

/**
 * Exponential backoff with full jitter, in ms — the same math as webhook
 * delivery: `min(max, base * 2^(attempt-1))` scaled by a uniform random
 * factor in `[0, 1)`. Exported for deterministic tests (inject
 * `random: () => 1` for the unfuzzed ceiling).
 *
 * @param attempt - The attempt number that just failed (1-based; attempts
 *   were already incremented at claim time).
 * @param base - Base delay for the first retry, in ms.
 * @param max - Upper bound on the un-jittered delay, in ms.
 * @param random - Uniform source in `[0, 1)`.
 * @returns The delay before the next attempt, in ms.
 * @since 1.3.0
 */
export function computeBackoffMs(
  attempt: number,
  base: number,
  max: number,
  random: () => number
): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exp); // full jitter
}

// ── memory store ────────────────────────────────────────────────────

/** Default cap on jobs (all statuses) held by {@link MemoryJobStore}. */
const DEFAULT_CAPACITY = 10_000;
/** Default retention for `completed` / `cancelled` records: 24 hours. */
const DEFAULT_RETENTION_MS = 86_400_000;
/** Default retention for `dead` records (kept longer for inspection): 7 days. */
const DEFAULT_DEAD_RETENTION_MS = 604_800_000;

/** Mutable internal record; payloads/results stay serialized at rest. */
interface StoredJob {
  id: string;
  queue: string;
  name: string;
  payloadJson: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  createdAt: number;
  updatedAt: number;
  leaseUntil: number | null;
  lockedBy: string | null;
  leaseMs: number;
  idempotencyKey: string | null;
  priority: number;
  timeoutMs: number;
  lastError: string | null;
  completedAt: number | null;
  resultJson: string | null;
  tenant: string | null;
}

/** Higher priority first, then earliest runAt, then oldest, then id. */
function compareRunnable(a: StoredJob, b: StoredJob): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.runAt !== b.runAt) return a.runAt - b.runAt;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Options for {@link MemoryJobStore}.
 *
 * @since 1.3.0
 */
export interface MemoryJobStoreOptions {
  /**
   * Maximum jobs held (all statuses). Default `10_000`. On overflow of new
   * puts the store first sweeps terminal records past their retention, then
   * throws {@link JobConfigError} (`store_full`) — evicting queued work
   * would be silent data loss.
   */
  capacity?: number;
  /** Injectable clock (ms since epoch). Default {@link Date.now}. */
  now?: () => number;
  /**
   * How long `completed` / `cancelled` records are retained after their last
   * update, in ms. Default 24h. Terminal records are swept lazily on
   * mutating operations.
   */
  retentionMs?: number;
  /** How long `dead` records are retained for inspection, in ms. Default 7d. */
  deadRetentionMs?: number;
}

/**
 * In-memory {@link JobStore}. Correct for tests and single-process apps —
 * a full implementation of the SPI, not a fake. **Not durable across
 * processes** and invisible to other replicas: production deployments must
 * supply a shared store (Redis, Postgres, SQS) through the same interface.
 * `app.useJobs()` warns when it sees this store with production config.
 *
 * Payloads are held serialized and re-parsed with the prototype-pollution-safe
 * `safeJsonParse` on every read, and every read returns a deep copy, so
 * callers can never mutate store state.
 *
 * @since 1.3.0
 */
export class MemoryJobStore implements JobStore {
  readonly #jobs = new Map<string, StoredJob>();
  readonly #idem = new Map<string, string>(); // `${queue}\0${idempotencyKey}` -> job id
  readonly #capacity: number;
  readonly #now: () => number;
  readonly #retentionMs: number;
  readonly #deadRetentionMs: number;

  /**
   * @param opts - Capacity, clock, and retention knobs.
   * @throws {RangeError} when a numeric option is out of bounds.
   */
  constructor(opts: MemoryJobStoreOptions = {}) {
    const capacity = opts.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("MemoryJobStore: capacity must be a positive integer.");
    }
    const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
    if (!Number.isInteger(retentionMs) || retentionMs < 0) {
      throw new RangeError("MemoryJobStore: retentionMs must be a non-negative integer.");
    }
    const deadRetentionMs = opts.deadRetentionMs ?? DEFAULT_DEAD_RETENTION_MS;
    if (!Number.isInteger(deadRetentionMs) || deadRetentionMs < 0) {
      throw new RangeError("MemoryJobStore: deadRetentionMs must be a non-negative integer.");
    }
    this.#capacity = capacity;
    this.#now = opts.now ?? Date.now;
    this.#retentionMs = retentionMs;
    this.#deadRetentionMs = deadRetentionMs;
  }

  /** The number of jobs currently held (all statuses). */
  get size(): number {
    return this.#jobs.size;
  }

  /**
   * @inheritDoc
   * `_fingerprint` is part of the {@link JobStore} contract but unused here:
   * the in-memory store compares serialized payloads directly.
   */
  put(job: Job, _fingerprint: string | null): EnqueueResult {
    const now = this.#now();
    const payloadJson = JSON.stringify(job.payload);
    if (job.idempotencyKey !== null) {
      const idemKey = `${job.queue}\0${job.idempotencyKey}`;
      const existingId = this.#idem.get(idemKey);
      if (existingId !== undefined) {
        const existing = this.#jobs.get(existingId);
        if (existing !== undefined) {
          if (existing.payloadJson !== payloadJson) {
            throw new JobIdempotencyConflictError(job.idempotencyKey, existingId);
          }
          return { job: this.#clone(existing), duplicate: true };
        }
        // Stale index entry (record was swept): fall through and re-insert.
      }
      if (this.#jobs.size >= this.#capacity) {
        this.#purgeExpiredTerminal(now);
        if (this.#jobs.size >= this.#capacity) {
          throw new JobConfigError(
            "store_full",
            `MemoryJobStore is at capacity (${this.#capacity} jobs); refusing to drop queued work. ` +
              "Supply a durable JobStore for production volumes."
          );
        }
      }
      this.#insert(job, payloadJson, now);
      this.#idem.set(idemKey, job.id);
      return { job: this.#clone(this.#jobs.get(job.id)!), duplicate: false };
    }
    if (this.#jobs.size >= this.#capacity) {
      this.#purgeExpiredTerminal(now);
      if (this.#jobs.size >= this.#capacity) {
        throw new JobConfigError(
          "store_full",
          `MemoryJobStore is at capacity (${this.#capacity} jobs); refusing to drop queued work. ` +
            "Supply a durable JobStore for production volumes."
        );
      }
    }
    this.#insert(job, payloadJson, now);
    return { job: this.#clone(this.#jobs.get(job.id)!), duplicate: false };
  }

  /** @inheritDoc */
  claim(queue: string, workerId: string, now: number): Job | null {
    this.#reapLeases(now);
    let best: StoredJob | undefined;
    for (const job of this.#jobs.values()) {
      if (job.queue !== queue) continue;
      const runnable =
        job.status === "queued" || (job.status === "delayed" && job.runAt <= now);
      if (!runnable) continue;
      if (best === undefined || compareRunnable(job, best) < 0) best = job;
    }
    if (best === undefined) return null;
    best.status = "running";
    best.lockedBy = workerId;
    best.leaseUntil = now + best.leaseMs;
    // Attempts increment at claim: a crashed worker that never reports back
    // still spends one attempt, so a poison handler cannot loop forever.
    best.attempts += 1;
    best.updatedAt = now;
    return this.#clone(best);
  }

  /** @inheritDoc */
  heartbeat(id: string, workerId: string, leaseUntil: number, now: number): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || job.status !== "running" || job.lockedBy !== workerId) {
      return false;
    }
    if (job.leaseUntil !== null && job.leaseUntil < now) return false; // already lost
    job.leaseUntil = leaseUntil;
    job.updatedAt = now;
    return true;
  }

  /** @inheritDoc */
  complete(id: string, workerId: string, now: number, result: unknown | null): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || job.status !== "running" || job.lockedBy !== workerId) {
      return false;
    }
    job.status = "completed";
    job.completedAt = now;
    job.resultJson = result === null || result === undefined ? null : JSON.stringify(result);
    job.lockedBy = null;
    job.leaseUntil = null;
    job.updatedAt = now;
    return true;
  }

  /** @inheritDoc */
  fail(
    id: string,
    workerId: string,
    error: string,
    next: { status: "delayed" | "queued" | "dead"; runAt: number },
    now: number
  ): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || job.status !== "running" || job.lockedBy !== workerId) {
      return false;
    }
    job.lastError = error;
    job.lockedBy = null;
    job.leaseUntil = null;
    if (job.attempts >= job.maxAttempts) {
      job.status = "dead";
      job.runAt = now;
    } else {
      job.status = next.status;
      job.runAt = next.status === "delayed" ? next.runAt : now;
    }
    job.updatedAt = now;
    return true;
  }

  /** @inheritDoc */
  cancel(id: string, now: number): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined) return false;
    if (job.status === "completed" || job.status === "dead" || job.status === "cancelled") {
      return false;
    }
    job.status = "cancelled";
    job.lockedBy = null;
    job.leaseUntil = null;
    job.updatedAt = now;
    return true;
  }

  /** @inheritDoc */
  get(id: string, now: number): Job | null {
    this.#reapLeases(now);
    const job = this.#jobs.get(id);
    return job === undefined ? null : this.#clone(job);
  }

  /** @inheritDoc */
  list(filter?: {
    queue?: string;
    status?: JobStatus | JobStatus[];
    name?: string;
    tenant?: string;
  }): Job[] {
    this.#reapLeases(this.#now());
    const statuses = filter?.status === undefined
      ? undefined
      : new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
    const out: Job[] = [];
    for (const job of this.#jobs.values()) {
      if (filter?.queue !== undefined && job.queue !== filter.queue) continue;
      if (statuses !== undefined && !statuses.has(job.status)) continue;
      if (filter?.name !== undefined && job.name !== filter.name) continue;
      if (filter?.tenant !== undefined && job.tenant !== filter.tenant) continue;
      out.push(this.#clone(job));
    }
    // Deterministic inspection order: oldest first, id as tiebreak.
    out.sort((a, b) =>
      a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    return out;
  }

  /** Test helper: every job, including terminal records. */
  dump(): Job[] {
    return this.list();
  }

  #insert(job: Job, payloadJson: string, now: number): void {
    this.#jobs.set(job.id, {
      id: job.id,
      queue: job.queue,
      name: job.name,
      payloadJson,
      // The store decides the initial status from its own clock: a job with
      // a future runAt starts delayed, anything else is immediately claimable.
      status: job.runAt > now ? "delayed" : "queued",
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAt: job.runAt,
      createdAt: job.createdAt,
      updatedAt: now,
      leaseUntil: null,
      lockedBy: null,
      leaseMs: job.leaseMs,
      idempotencyKey: job.idempotencyKey,
      priority: job.priority,
      timeoutMs: job.timeoutMs,
      lastError: null,
      completedAt: null,
      resultJson: null,
      tenant: job.tenant,
    });
  }

  /** Expired leases return to `queued`; attempts stay spent. */
  #reapLeases(now: number): void {
    for (const job of this.#jobs.values()) {
      if (job.status === "running" && job.leaseUntil !== null && job.leaseUntil < now) {
        job.status = "queued";
        job.lockedBy = null;
        job.leaseUntil = null;
        job.updatedAt = now;
      }
    }
  }

  /** Sweep terminal records past their retention; also drops index entries. */
  #purgeExpiredTerminal(now: number): void {
    for (const job of this.#jobs.values()) {
      const retention =
        job.status === "dead"
          ? this.#deadRetentionMs
          : job.status === "completed" || job.status === "cancelled"
            ? this.#retentionMs
            : undefined;
      if (retention === undefined) continue;
      if (now - job.updatedAt <= retention) continue;
      if (job.idempotencyKey !== null) this.#idem.delete(`${job.queue}\0${job.idempotencyKey}`);
      this.#jobs.delete(job.id);
    }
  }

  /** Deep copy: callers can never mutate store state through a snapshot. */
  #clone(job: StoredJob): Job {
    return {
      id: job.id,
      queue: job.queue,
      name: job.name,
      payload: safeJsonParse(job.payloadJson),
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAt: job.runAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      leaseUntil: job.leaseUntil,
      lockedBy: job.lockedBy,
      leaseMs: job.leaseMs,
      idempotencyKey: job.idempotencyKey,
      priority: job.priority,
      timeoutMs: job.timeoutMs,
      lastError: job.lastError,
      completedAt: job.completedAt,
      result: job.resultJson === null ? null : safeJsonParse(job.resultJson),
      tenant: job.tenant,
    };
  }
}

// ── handler + worker context ────────────────────────────────────────

/**
 * Context handed to a {@link JobHandler} on each attempt.
 *
 * @since 1.3.0
 */
export interface JobContext<P = unknown> {
  /** The claimed job snapshot (status `running`, `attempts` already incremented). */
  readonly job: Job<P>;
  /**
   * Aborted when the per-attempt `timeoutMs` elapses, when the worker stops
   * out of grace, or when the lease is lost to another worker. Forward it to
   * every I/O call the handler makes.
   */
  readonly signal: AbortSignal;
  /** 1-based attempt number (=== `job.attempts`). */
  readonly attempt: number;
  /**
   * Extend the lease by another `leaseMs`. Long-running handlers should call
   * this (or rely on the worker's automatic heartbeat every `leaseMs / 3`).
   * If the lease is already lost, the handler's signal is aborted instead.
   */
  heartbeat(): Promise<void>;
  /** Structured logger pre-bound with job id / name / queue / attempt. */
  readonly log: SchedulerLogger;
}

/**
 * A registered unit of work. Throw {@link JobFatalError} for permanent
 * failures (no retry); any other throw — or a timeout — is retried with
 * backoff until the attempt budget is spent, then the job is dead-lettered.
 * The return value, when not `undefined`, is stored as {@link Job.result}
 * under the same plain-JSON rules and size cap as payloads.
 *
 * Handlers must be idempotent: delivery is at-least-once. Pass an
 * idempotency key through to downstream APIs (e.g. Stripe's
 * `Idempotency-Key`) when a duplicate run would move money or send email.
 *
 * @since 1.3.0
 */
export type JobHandler<P = unknown> = (ctx: JobContext<P>) => unknown | Promise<unknown>;

/**
 * A handler registry: job name to handler. Closed at
 * {@link createJobWorker} time — there is deliberately no dynamic
 * registration and no `import(job.name)`, so a store record can never pick
 * the code that runs it. Typed as `unknown` payload per entry; a
 * heterogeneous map cannot unify payload types, so annotate each handler's
 * `ctx` as {@link JobContext}`<YourPayload>` for narrowing.
 *
 * @since 1.3.0
 */
export type JobHandlerMap = { [name: string]: JobHandler<unknown> };

// ── queue ───────────────────────────────────────────────────────────

/**
 * Backoff policy shared by queue and worker.
 *
 * @since 1.3.0
 */
export interface JobBackoffOptions {
  /** Base delay for the first retry, in ms. Default `200`. */
  baseDelayMs: number;
  /** Upper bound on the un-jittered delay, in ms. Default `60_000`. */
  maxDelayMs: number;
  /** Uniform jitter source in `[0, 1)`. Default {@link Math.random}. */
  random: () => number;
}

/**
 * Options for {@link createJobQueue}. Only `store` is required.
 *
 * @since 1.3.0
 */
export interface JobQueueOptions {
  /** Persistence backend. {@link MemoryJobStore} for tests / single process. */
  store: JobStore;
  /** Structured logger for queue events. */
  logger?: SchedulerLogger;
  /** Injectable clock (ms since epoch). Default {@link Date.now}. */
  now?: () => number;
  /**
   * Maximum UTF-8 bytes of the serialized payload (and of a completion
   * result). Default `65536` (64 KiB) — jobs are not a blob store.
   */
  payloadMaxBytes?: number;
  /** Partition used when {@link EnqueueOptions.queue} is omitted. Default `"default"`. */
  defaultQueue?: string;
  /** Default for {@link EnqueueOptions.maxAttempts}. Default `5`. */
  defaultMaxAttempts?: number;
  /** Default for {@link EnqueueOptions.timeoutMs}. Default `30_000`. */
  defaultTimeoutMs?: number;
  /** Default for {@link EnqueueOptions.leaseMs}. Default `30_000`. */
  defaultLeaseMs?: number;
  /** Retry backoff policy; see {@link JobBackoffOptions}. */
  backoff?: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number };
}

/**
 * The producer façade: validate, serialize, fingerprint, enqueue, inspect,
 * cancel. Split from {@link JobWorker} so HTTP replicas never poll. Safe to
 * share across an entire process.
 *
 * @since 1.3.0
 */
export interface JobQueue {
  /**
   * Persist a job. Resolves with `duplicate: true` and the existing job when
   * the idempotency key matches a prior enqueue of the same payload.
   *
   * @param opts - The job to create; see {@link EnqueueOptions}.
   * @returns The created (or deduplicated) record.
   * @throws {@link JobConfigError} on invalid names, options, non-JSON
   *   payloads, oversized payloads, or a full bounded store.
   * @throws {@link JobIdempotencyConflictError} when the key was already used
   *   with a different payload.
   */
  enqueue<P>(opts: EnqueueOptions<P>): Promise<EnqueueResult<P>>;
  /** Read one job by id, or `null`. */
  get(id: string): Promise<Job | null>;
  /** Cancel a non-terminal job. Resolves `false` for terminal/unknown ids. */
  cancel(id: string): Promise<boolean>;
  /** The underlying store, exposed for adapters and test inspection. */
  readonly store: JobStore;
  /** Partition used when enqueue omits `queue`. */
  readonly defaultQueue: string;
  /** Serialized-payload (and result) byte cap. */
  readonly payloadMaxBytes: number;
  /** Resolved retry backoff policy (used by workers on failure). */
  readonly backoff: JobBackoffOptions;
}

/**
 * Create a {@link JobQueue} over a {@link JobStore}. Validates all options
 * eagerly (fail-fast config): numeric bounds throw `RangeError`, bad names
 * throw {@link JobConfigError}, a missing store throws
 * {@link JobConfigError} (`store_required`).
 *
 * @param opts - Queue configuration; see {@link JobQueueOptions}.
 * @returns The producer façade.
 * @since 1.3.0
 */
export function createJobQueue(opts: JobQueueOptions): JobQueue {
  if (opts === undefined || opts.store === undefined || opts.store === null) {
    throw new JobConfigError(
      "store_required",
      "createJobQueue(): a JobStore is required (MemoryJobStore for tests, a durable adapter in production)."
    );
  }
  const store = opts.store;
  const logger = opts.logger;
  const now = opts.now ?? Date.now;

  const payloadMaxBytes = opts.payloadMaxBytes ?? 64 * 1024;
  if (!Number.isInteger(payloadMaxBytes) || payloadMaxBytes < 1) {
    throw new RangeError("createJobQueue(): payloadMaxBytes must be a positive integer.");
  }
  const defaultQueue =
    opts.defaultQueue === undefined ? "default" : assertQueueName(opts.defaultQueue);
  const defaultMaxAttempts = opts.defaultMaxAttempts ?? 5;
  if (!Number.isInteger(defaultMaxAttempts) || defaultMaxAttempts < 1) {
    throw new RangeError("createJobQueue(): defaultMaxAttempts must be a positive integer.");
  }
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
  if (!Number.isInteger(defaultTimeoutMs) || defaultTimeoutMs < 0) {
    throw new RangeError("createJobQueue(): defaultTimeoutMs must be a non-negative integer.");
  }
  const defaultLeaseMs = opts.defaultLeaseMs ?? 30_000;
  if (!Number.isInteger(defaultLeaseMs) || defaultLeaseMs < 1) {
    throw new RangeError("createJobQueue(): defaultLeaseMs must be a positive integer.");
  }
  const baseDelayMs = opts.backoff?.baseDelayMs ?? 200;
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("createJobQueue(): backoff.baseDelayMs must be a non-negative integer.");
  }
  const maxDelayMs = opts.backoff?.maxDelayMs ?? 60_000;
  if (!Number.isInteger(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new RangeError(
      "createJobQueue(): backoff.maxDelayMs must be an integer >= backoff.baseDelayMs."
    );
  }
  const backoff: JobBackoffOptions = {
    baseDelayMs,
    maxDelayMs,
    // Backoff jitter spreads load; it is not a security primitive.
    random: opts.backoff?.random ?? Math.random, // daloy-allow-weak-random: backoff jitter is not a security primitive
  };

  return {
    store,
    defaultQueue,
    payloadMaxBytes,
    backoff,

    async enqueue<P>(enqueueOpts: EnqueueOptions<P>): Promise<EnqueueResult<P>> {
      const name = assertJobName(enqueueOpts.name);
      const queueName =
        enqueueOpts.queue === undefined ? defaultQueue : assertQueueName(enqueueOpts.queue);
      const idempotencyKey =
        enqueueOpts.idempotencyKey === undefined
          ? null
          : assertIdempotencyKey(enqueueOpts.idempotencyKey);
      const tenant = enqueueOpts.tenant === undefined ? null : assertTenant(enqueueOpts.tenant);

      const enqueueNow = now();
      let runAt: number;
      if (enqueueOpts.runAt !== undefined) {
        runAt =
          enqueueOpts.runAt instanceof Date
            ? enqueueOpts.runAt.getTime()
            : enqueueOpts.runAt;
        if (!Number.isFinite(runAt)) {
          throw new JobConfigError("invalid_option", "enqueue(): runAt must be a finite epoch ms or a Date.");
        }
      } else {
        const delayMs = enqueueOpts.delayMs ?? 0;
        if (!Number.isInteger(delayMs) || delayMs < 0) {
          throw new JobConfigError(
            "invalid_option",
            "enqueue(): delayMs must be a non-negative integer."
          );
        }
        runAt = enqueueNow + delayMs;
      }
      const priority = enqueueOpts.priority ?? 0;
      if (!Number.isInteger(priority)) {
        throw new JobConfigError("invalid_option", "enqueue(): priority must be an integer.");
      }
      const maxAttempts = enqueueOpts.maxAttempts ?? defaultMaxAttempts;
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new JobConfigError(
          "invalid_option",
          "enqueue(): maxAttempts must be a positive integer."
        );
      }
      const timeoutMs = enqueueOpts.timeoutMs ?? defaultTimeoutMs;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
        throw new JobConfigError(
          "invalid_option",
          "enqueue(): timeoutMs must be a non-negative integer (0 disables the per-attempt timeout)."
        );
      }
      const leaseMs = enqueueOpts.leaseMs ?? defaultLeaseMs;
      if (!Number.isInteger(leaseMs) || leaseMs < 1) {
        throw new JobConfigError("invalid_option", "enqueue(): leaseMs must be a positive integer.");
      }

      const { json, bytes } = serializePayload(enqueueOpts.payload, payloadMaxBytes, "payload");
      // The fingerprint rides only idempotent enqueues; without a key the
      // store never compares payloads, so skip the hash.
      const fingerprint = idempotencyKey === null ? null : await sha256Hex(bytes);
      // A clean, plain-JSON clone: key order and values are exactly what was
      // serialized, so two enqueues of the same logical payload compare equal.
      const payload = safeJsonParse(json);

      const job: Job = {
        id: randomId(),
        queue: queueName,
        name,
        payload,
        status: runAt > enqueueNow ? "delayed" : "queued",
        attempts: 0,
        maxAttempts,
        runAt,
        createdAt: enqueueNow,
        updatedAt: enqueueNow,
        leaseUntil: null,
        lockedBy: null,
        leaseMs,
        idempotencyKey,
        priority,
        timeoutMs,
        lastError: null,
        completedAt: null,
        result: null,
        tenant,
      };
      logger?.debug(
        { event: "jobs.enqueue", queue: queueName, name, jobId: job.id, delayed: runAt > enqueueNow },
        `Enqueued job "${name}" (${job.id})`
      );
      const result = await settle(store.put(job, fingerprint));
      return { job: result.job as Job<P>, duplicate: result.duplicate };
    },

    async get(id: string): Promise<Job | null> {
      return settle(store.get(id, now()));
    },

    async cancel(id: string): Promise<boolean> {
      return settle(store.cancel(id, now()));
    },
  };
}

// ── worker ──────────────────────────────────────────────────────────

/**
 * Options for {@link createJobWorker}.
 *
 * @since 1.3.0
 */
export interface JobWorkerOptions {
  /** The queue to claim from (provides the store and backoff policy). */
  queue: JobQueue;
  /**
   * Handler registry, closed at construction. Keys must satisfy the job-name
   * grammar; values are `JobHandler<any>` because a heterogeneous map cannot
   * unify payload types — annotate each handler's ctx for narrowing.
   */
  handlers: Record<string, JobHandler<any>>;
  /** Partitions to claim from, in order. Default `[queue.defaultQueue]`. */
  queues?: string[];
  /** Maximum jobs run concurrently. Default `1`. */
  concurrency?: number;
  /** Idle poll cadence in ms. Default `200`. */
  pollIntervalMs?: number;
  /** Fencing identity written to `lockedBy`. Default `crypto.randomUUID()`. */
  workerId?: string;
  /** Structured logger for worker lifecycle and failure events. */
  logger?: SchedulerLogger;
  /** Injectable timer primitives (shared shape with the Scheduler). */
  timers?: TimerFns;
  /** Injectable clock (ms since epoch). Default {@link Date.now}. */
  now?: () => number;
  /** Called when a job dead-letters (fatal, or budget exhausted). */
  onDead?: (job: Job, error: string) => void | Promise<void>;
  /** Called when a job completes. */
  onComplete?: (job: Job) => void | Promise<void>;
  /** Called on every non-fatal failure, before the next state is applied. */
  onFail?: (job: Job, error: string, willRetry: boolean, delayMs?: number) => void | Promise<void>;
}

/**
 * A claimed-job consumer: poll/claim/run/complete with leases, heartbeats,
 * bounded retries, and graceful drain. Create it where a long-lived process
 * exists (Node/Bun/Deno); on serverless isolates, enqueue only.
 *
 * @since 1.3.0
 */
export interface JobWorker {
  /**
   * Start the poll loop.
   *
   * @throws {@link JobConfigError} when the worker was already started (or
   *   was started and then stopped — a stopped worker is spent).
   */
  start(): void;
  /**
   * Stop polling, wait up to `graceMs` for in-flight jobs to settle, then
   * abort their signals and wait for them to unwind. Jobs aborted this way
   * are failed back to the queue so another worker can pick them up.
   * Idempotent.
   */
  stop(graceMs?: number): Promise<void>;
  /** Point-in-time worker state. */
  getState(): { running: boolean; inFlight: number; workerId: string };
  /**
   * Test helper: claim and run one available job to settlement, whether or
   * not the loop is started. Resolves `false` when nothing was claimable.
   */
  runOnce(): Promise<boolean>;
}

const defaultWorkerTimers: TimerFns = {
  set(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface InFlightJob {
  controller: AbortController;
  promise: Promise<void>;
  jobId: string;
}

/**
 * Create a {@link JobWorker}. The handler registry is frozen into a
 * null-prototype map at construction: unknown job names dead-letter as
 * poison pills instead of spinning, and no code path resolves a handler by
 * dynamic lookup or import.
 *
 * @param opts - Worker configuration; see {@link JobWorkerOptions}.
 * @returns The worker.
 * @throws {RangeError} on out-of-bounds numeric options.
 * @throws {@link JobConfigError} on a missing/empty registry or invalid
 *   handler names.
 * @since 1.3.0
 */
export function createJobWorker(opts: JobWorkerOptions): JobWorker {
  if (opts === undefined || opts.queue === undefined || opts.queue === null) {
    throw new JobConfigError("store_required", "createJobWorker(): a JobQueue is required.");
  }
  const queue = opts.queue;
  const store = queue.store;
  const logger = opts.logger;
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? defaultWorkerTimers;

  if (opts.handlers === undefined || opts.handlers === null || typeof opts.handlers !== "object") {
    throw new JobConfigError(
      "unknown_handler",
      "createJobWorker(): a handlers registry is required."
    );
  }
  const handlers: Record<string, JobHandler<any>> = Object.create(null) as Record<
    string,
    JobHandler<any>
  >;
  for (const [name, handler] of Object.entries(opts.handlers)) {
    assertJobName(name);
    if (typeof handler !== "function") {
      throw new JobConfigError(
        "invalid_option",
        `createJobWorker(): handler "${name}" must be a function.`
      );
    }
    handlers[name] = handler;
  }
  const handlerNames = Object.keys(handlers);
  if (handlerNames.length === 0) {
    throw new JobConfigError(
      "unknown_handler",
      "createJobWorker(): the handlers registry is empty; every claimed job would dead-letter."
    );
  }
  Object.freeze(handlers);

  const queues = (opts.queues ?? [queue.defaultQueue]).map(assertQueueName);
  const concurrency = opts.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("createJobWorker(): concurrency must be a positive integer.");
  }
  if (concurrency > 1000) {
    throw new RangeError("createJobWorker(): concurrency above 1000 is not a supported posture.");
  }
  if (concurrency > 32) {
    logger?.warn(
      { event: "jobs.worker.high_concurrency", concurrency },
      `Job worker concurrency ${concurrency} is unusually high; bound it to downstream capacity.`
    );
  }
  const pollIntervalMs = opts.pollIntervalMs ?? 200;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new RangeError("createJobWorker(): pollIntervalMs must be a positive integer.");
  }
  const workerId = opts.workerId ?? randomId();
  const backoff = queue.backoff;

  let started = false;
  let stopped = false;
  let pollTimer: unknown;
  let draining = false;
  let drainAgain = false;
  const inFlight = new Set<InFlightJob>();

  function arm(): void {
    if (stopped || !started) return;
    pollTimer = timers.set(() => {
      pollTimer = undefined;
      void tick();
    }, pollIntervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    // Re-arm first (fixed cadence), then claim. Overlapping drains are
    // collapsed by the single-flight drain flag.
    arm();
    await drainAvailable();
  }

  async function drainAvailable(): Promise<void> {
    if (draining) {
      drainAgain = true;
      return;
    }
    draining = true;
    try {
      do {
        drainAgain = false;
        while (!stopped && inFlight.size < concurrency) {
          let job: Job | null;
          try {
            job = await claimNext();
          } catch (error) {
            // A throwing store must not kill the loop; the next poll retries.
            logger?.error(
              { event: "jobs.worker.claim_failed", err: errorMessage(error), workerId },
              "Job worker: claim failed"
            );
            break;
          }
          if (job === null) break;
          launch(job);
        }
      } while (drainAgain && !stopped);
    } finally {
      draining = false;
    }
  }

  async function claimNext(): Promise<Job | null> {
    for (const queueName of queues) {
      const job = await settle(store.claim(queueName, workerId, now()));
      if (job !== null) {
        logger?.debug(
          { event: "jobs.claim", queue: job.queue, name: job.name, jobId: job.id, attempt: job.attempts, workerId },
          `Claimed job "${job.name}" (${job.id})`
        );
        return job;
      }
    }
    return null;
  }

  /** Track and run a claimed job without awaiting it (concurrency > 1). */
  function launch(job: Job): InFlightJob {
    const controller = new AbortController();
    const entry: InFlightJob = { controller, promise: Promise.resolve(), jobId: job.id };
    entry.promise = execute(job, controller)
      .catch((error) => {
        // The run algorithm handles every expected failure; this catch is the
        // last-resort guard that keeps a defect from crashing the loop.
        logger?.error(
          { event: "jobs.worker.run_crashed", jobId: job.id, err: errorMessage(error), workerId },
          "Job worker: unexpected runner error"
        );
      })
      .finally(() => {
        inFlight.delete(entry);
      });
    inFlight.add(entry);
    return entry;
  }

  async function execute(job: Job, controller: AbortController): Promise<void> {
    let timedOut = false;
    let lostLease = false;
    let settled = false;
    let timeoutTimer: unknown;
    let heartbeatTimer: unknown;

    const clearJobTimers = (): void => {
      if (timeoutTimer !== undefined) {
        timers.clear(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (heartbeatTimer !== undefined) {
        timers.clear(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const beat = async (): Promise<void> => {
      if (settled || lostLease) return;
      const ok = await settle(store.heartbeat(job.id, workerId, now() + job.leaseMs, now()));
      if (!ok && !settled) {
        // Another worker owns the job now: unwind locally, touch nothing.
        lostLease = true;
        logger?.warn(
          { event: "jobs.lease_lost", queue: job.queue, name: job.name, jobId: job.id, workerId },
          `Lost lease for job "${job.name}" (${job.id}); aborting local run`
        );
        controller.abort();
      }
    };

    const scheduleBeat = (): void => {
      if (settled) return;
      heartbeatTimer = timers.set(() => {
        heartbeatTimer = undefined;
        void (async () => {
          await beat();
          if (!settled && !lostLease && !controller.signal.aborted) scheduleBeat();
        })();
      }, Math.max(1, Math.floor(job.leaseMs / 3)));
    };

    if (job.timeoutMs > 0) {
      timeoutTimer = timers.set(() => {
        timedOut = true;
        controller.abort();
      }, job.timeoutMs);
    }
    // Auto-heartbeat so handlers that forget ctx.heartbeat() still hold the
    // lease while they run; long jobs should also call ctx.heartbeat().
    scheduleBeat();

    const jobLog: SchedulerLogger = {
      debug: (obj, msg) =>
        logger?.debug(
          typeof obj === "string"
            ? obj
            : { jobId: job.id, name: job.name, queue: job.queue, attempt: job.attempts, ...obj },
          msg
        ),
      info: (obj, msg) =>
        logger?.info(
          typeof obj === "string"
            ? obj
            : { jobId: job.id, name: job.name, queue: job.queue, attempt: job.attempts, ...obj },
          msg
        ),
      warn: (obj, msg) =>
        logger?.warn(
          typeof obj === "string"
            ? obj
            : { jobId: job.id, name: job.name, queue: job.queue, attempt: job.attempts, ...obj },
          msg
        ),
      error: (obj, msg) =>
        logger?.error(
          typeof obj === "string"
            ? obj
            : { jobId: job.id, name: job.name, queue: job.queue, attempt: job.attempts, ...obj },
          msg
        ),
    };

    try {
      const handler = handlers[job.name];
      if (handler === undefined) {
        // Poison pill: no code is registered for this name. Dead-letter
        // immediately instead of retrying a record that can never succeed.
        throw new JobFatalError(`Unknown job handler: "${job.name}".`);
      }
      const returned = await handler({
        job,
        signal: controller.signal,
        attempt: job.attempts,
        heartbeat: beat,
        log: jobLog,
      });
      if (controller.signal.aborted) {
        if (lostLease) return; // the other worker owns the outcome
        if (timedOut) throw new JobTimeoutError(job.timeoutMs);
        throw new Error("Job aborted: worker is stopping.");
      }
      const resultValue = returned === undefined ? null : returned;
      if (resultValue !== null) {
        // Same rules as payloads: plain JSON, pollution keys rejected, size cap.
        serializePayload(resultValue, queue.payloadMaxBytes, "result");
      }
      const ok = await settle(store.complete(job.id, workerId, now(), resultValue));
      if (!ok) {
        logger?.warn(
          { event: "jobs.complete_lost", queue: job.queue, name: job.name, jobId: job.id, workerId },
          `Complete for job "${job.name}" (${job.id}) was rejected: lease lost`
        );
        return;
      }
      logger?.debug(
        { event: "jobs.complete", queue: job.queue, name: job.name, jobId: job.id, attempt: job.attempts },
        `Completed job "${job.name}" (${job.id})`
      );
      await safeHook(() => opts.onComplete?.(job));
    } catch (error) {
      if (lostLease) return; // the other worker owns the outcome
      // A handler that unwound because of the timeout abort reports the
      // timeout, not whatever the abort made it throw.
      const effectiveError = timedOut
        ? error instanceof JobTimeoutError
          ? error
          : new JobTimeoutError(job.timeoutMs)
        : error;
      const fatal = effectiveError instanceof JobFatalError;
      const message = errorMessage(effectiveError);
      const willRetry = !fatal && job.attempts < job.maxAttempts;
      const delayMs = willRetry
        ? computeBackoffMs(job.attempts, backoff.baseDelayMs, backoff.maxDelayMs, backoff.random)
        : 0;
      const nextRunAt = now() + delayMs;
      const ok = await settle(
        store.fail(
          job.id,
          workerId,
          message,
          willRetry
            ? { status: "delayed", runAt: nextRunAt }
            : { status: "dead", runAt: now() },
          now()
        )
      );
      if (!ok) {
        logger?.warn(
          { event: "jobs.fail_lost", queue: job.queue, name: job.name, jobId: job.id, workerId },
          `Fail for job "${job.name}" (${job.id}) was rejected: lease lost`
        );
        return;
      }
      if (willRetry) {
        logger?.warn(
          {
            event: "jobs.retry",
            queue: job.queue,
            name: job.name,
            jobId: job.id,
            attempt: job.attempts,
            delayMs,
            err: message,
          },
          `Job "${job.name}" (${job.id}) failed; retrying in ${delayMs}ms`
        );
        await safeHook(() => opts.onFail?.(job, message, true, delayMs));
      } else {
        logger?.error(
          {
            event: "jobs.dead",
            queue: job.queue,
            name: job.name,
            jobId: job.id,
            attempt: job.attempts,
            fatal,
            err: message,
          },
          `Job "${job.name}" (${job.id}) dead-lettered`
        );
        await safeHook(() => opts.onFail?.(job, message, false));
        await safeHook(() => opts.onDead?.(job, message));
      }
    } finally {
      settled = true;
      clearJobTimers();
    }
  }

  async function safeHook(hook: () => void | Promise<void> | undefined): Promise<void> {
    try {
      await hook();
    } catch (error) {
      // Hooks observe; they must never change the job's outcome.
      logger?.error(
        { event: "jobs.hook_failed", err: errorMessage(error) },
        "Job worker: lifecycle hook threw"
      );
    }
  }

  return {
    start(): void {
      if (stopped) {
        throw new JobConfigError(
          "invalid_option",
          "Job worker cannot be restarted after stop(); create a new worker."
        );
      }
      if (started) {
        throw new JobConfigError("invalid_option", "Job worker is already started.");
      }
      started = true;
      logger?.info(
        { event: "jobs.worker.started", workerId, queues, concurrency },
        "Job worker started"
      );
      arm();
    },

    async stop(graceMs = 5_000): Promise<void> {
      if (!Number.isInteger(graceMs) || graceMs < 0) {
        throw new RangeError("Job worker stop(): graceMs must be a non-negative integer.");
      }
      if (stopped) return;
      stopped = true;
      if (pollTimer !== undefined) {
        timers.clear(pollTimer);
        pollTimer = undefined;
      }
      if (inFlight.size === 0) {
        logger?.info({ event: "jobs.worker.stopped", workerId }, "Job worker stopped");
        return;
      }

      let timedOut = false;
      let deadlineTimer: unknown;
      const deadline = new Promise<void>((resolve) => {
        deadlineTimer = timers.set(() => {
          timedOut = true;
          resolve();
        }, graceMs);
      });
      const settledAll = Promise.all([...inFlight].map((entry) => entry.promise)).then(
        () => undefined
      );
      await Promise.race([settledAll, deadline]);
      if (deadlineTimer !== undefined) timers.clear(deadlineTimer);

      if (timedOut && inFlight.size > 0) {
        logger?.warn(
          { event: "jobs.worker.stop_timeout", workerId, inFlight: inFlight.size },
          `Job worker grace period elapsed; aborting ${inFlight.size} in-flight job(s)`
        );
        for (const entry of inFlight) entry.controller.abort();
        // Wait for the aborted runs to unwind (they fail back to the queue).
        await Promise.all([...inFlight].map((entry) => entry.promise)).catch(() => undefined);
      }
      logger?.info({ event: "jobs.worker.stopped", workerId }, "Job worker stopped");
    },

    getState(): { running: boolean; inFlight: number; workerId: string } {
      return { running: started && !stopped, inFlight: inFlight.size, workerId };
    },

    async runOnce(): Promise<boolean> {
      const job = await claimNext();
      if (job === null) return false;
      const entry = launch(job);
      await entry.promise;
      return true;
    },
  };
}

// ── tenancy helper ──────────────────────────────────────────────────

/**
 * Build a tenant-safe idempotency key of the form `t/{tenant}/{name}/{key}`
 * (or `g/{name}/{key}` when no tenant applies). Segments are validated so a
 * key can never smuggle whitespace/control characters, newlines, or `..`
 * into store keys or log lines, and tenant ids follow the `tenancy()`
 * grammar — one tenant's keys can never collide with another's.
 *
 * @param parts - `name` is the job name; `key` is the caller's dedupe id
 *   (user id, provider event id, order id, …); `tenant` scopes the key.
 * @returns The composed key, at most 255 chars.
 * @throws {@link JobConfigError} when a segment fails validation.
 * @since 1.3.0
 */
export function jobIdempotencyKey(parts: { tenant?: string; name: string; key: string }): string {
  const name = assertJobName(parts.name);
  const key = parts.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new JobConfigError("invalid_option", "jobIdempotencyKey(): key must be a non-empty string.");
  }
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new JobConfigError(
      "invalid_option",
      "jobIdempotencyKey(): key must be printable ASCII (no whitespace or control characters)."
    );
  }
  if (key.includes("..")) {
    throw new JobConfigError(
      "invalid_option",
      'jobIdempotencyKey(): key must not contain "..".'
    );
  }
  const scope =
    parts.tenant === undefined ? "g" : `t/${assertTenant(parts.tenant)}`;
  const out = `${scope}/${name}/${key}`;
  if (out.length > 255) {
    throw new JobConfigError(
      "invalid_option",
      `jobIdempotencyKey(): composed key is ${out.length} chars; the limit is 255.`
    );
  }
  return out;
}
