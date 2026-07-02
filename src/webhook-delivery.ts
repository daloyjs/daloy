/**
 * Outbound webhook delivery — the sending counterpart to the inbound
 * {@link verifyWebhookSignature} / {@link signWebhookPayload} helpers.
 *
 * Where the inbound helpers answer *&ldquo;is this webhook I received
 * authentic?&rdquo;*, this module answers *&ldquo;how do I reliably and
 * securely deliver a webhook to someone else?&rdquo;* — the three things a
 * production webhook sender needs:
 *
 * - **Signed delivery with timestamped signatures.** Every request carries
 *   an HMAC signature computed over `"<timestamp>.<body>"` (the Stripe /
 *   Standard Webhooks convention), plus an idempotency id and a timestamp
 *   header, so the receiver can authenticate the payload and reject
 *   replays with {@link verifyWebhookSignature}.
 * - **Retry with backoff.** Transient failures (network errors, timeouts,
 *   `408` / `429` / `5xx`) are retried with exponential backoff and full
 *   jitter, honouring a `Retry-After` header. The signature is computed
 *   **once** so every retry carries the same id and signature — the
 *   receiver can dedupe on the id.
 * - **Dead-letter semantics.** When every attempt is exhausted (or the
 *   upstream returns a permanent `4xx`), the failed delivery is handed to
 *   a {@link WebhookDeadLetterSink} for later inspection or replay instead
 *   of being silently dropped.
 *
 * Delivery is **SSRF-hardened by default**: the transport defaults to
 * {@link fetchGuard}, so a webhook URL that resolves to cloud-metadata or
 * an internal address is refused before any bytes are sent. Pass your own
 * `fetch` (e.g. `fetchGuard({ allowPrivate: true })` or a
 * {@link resilientFetch}) to change that posture deliberately.
 *
 * ```ts
 * import { createWebhookSender, MemoryWebhookDeadLetterSink } from "@daloyjs/core";
 *
 * const deadLetters = new MemoryWebhookDeadLetterSink();
 * const send = createWebhookSender({ secret: process.env.WEBHOOK_SECRET!, deadLetter: deadLetters });
 *
 * const result = await send({
 *   url: "https://example.com/hooks",
 *   eventType: "invoice.paid",
 *   payload: { id: "in_123", amount: 4200 },
 * });
 * if (!result.ok) {
 *   // result.deadLettered === true; inspect deadLetters.list()
 * }
 * ```
 *
 * @module
 * @since 0.37.0
 */

import { signWebhookPayload, type WebhookHmacAlgorithm } from "./security.js";
import { fetchGuard } from "./fetch-guard.js";

/**
 * A single webhook event to deliver. The `payload` is signed and sent as
 * the request body; everything else shapes the request and the signature
 * headers.
 *
 * @since 0.37.0
 */
export interface WebhookEvent {
  /** Absolute `http(s)` URL of the receiver. */
  url: string;
  /**
   * The event body. An object or array is JSON-serialised; a `string` is
   * sent verbatim; a `Uint8Array` is sent as raw bytes. The signature is
   * always computed over the exact bytes sent.
   */
  payload: unknown;
  /**
   * Optional event type (e.g. `"invoice.paid"`), emitted as a header and
   * recorded on the dead letter. Purely informational.
   */
  eventType?: string;
  /**
   * Stable idempotency id, emitted in the id header so the receiver can
   * dedupe retries. A random UUID is generated when omitted.
   */
  id?: string;
  /**
   * Extra request headers merged in **after** the signature headers, so
   * they cannot overwrite the id / timestamp / signature headers.
   */
  headers?: Record<string, string>;
  /**
   * Override the `Content-Type` header. Defaults to `application/json`
   * for objects / strings and `application/octet-stream` for bytes.
   */
  contentType?: string;
}

/**
 * A failed delivery handed to a {@link WebhookDeadLetterSink} after every
 * attempt is exhausted. Carries enough context to inspect, alert on, or
 * replay the delivery later.
 *
 * @since 0.37.0
 */
export interface WebhookDeadLetter {
  /** The idempotency id used for the delivery. */
  id: string;
  /** The receiver URL. */
  url: string;
  /** The event type, when one was supplied. */
  eventType?: string;
  /** The exact body bytes that were signed and sent. */
  payload: Uint8Array;
  /** The `Content-Type` that was sent. */
  contentType: string;
  /** Total number of attempts made before giving up. */
  attempts: number;
  /** The last HTTP status seen, when the final failure was a response. */
  lastStatus?: number;
  /** The last error message, when the final failure was a thrown error. */
  lastError?: string;
  /** The Unix-seconds timestamp bound into the signature. */
  timestamp: number;
  /** Wall-clock time (ms since epoch) the delivery was dead-lettered. */
  failedAt: number;
}

/**
 * A sink that receives {@link WebhookDeadLetter}s for permanently-failed
 * deliveries. Implement this to persist to a queue, database, or alerting
 * pipeline. `add` may be async; the sender awaits it.
 *
 * @since 0.37.0
 */
export interface WebhookDeadLetterSink {
  /** Persist a permanently-failed delivery. May be async; the sender awaits it. */
  add(letter: WebhookDeadLetter): void | Promise<void>;
}

/**
 * An in-memory, bounded {@link WebhookDeadLetterSink} suitable for tests
 * and single-process apps. Holds the most recent `capacity` dead letters
 * (default `1000`) in a ring buffer; older entries are evicted.
 *
 * @since 0.37.0
 */
export class MemoryWebhookDeadLetterSink implements WebhookDeadLetterSink {
  readonly #capacity: number;
  #items: WebhookDeadLetter[] = [];

  constructor(capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("MemoryWebhookDeadLetterSink: capacity must be a positive integer");
    }
    this.#capacity = capacity;
  }

  /** Append a dead letter, evicting the oldest if at capacity. */
  add(letter: WebhookDeadLetter): void {
    this.#items.push(letter);
    if (this.#items.length > this.#capacity) this.#items.shift();
  }

  /** A snapshot of the currently-held dead letters, oldest first. */
  list(): readonly WebhookDeadLetter[] {
    return [...this.#items];
  }

  /** Remove and return every held dead letter (e.g. for a replay sweep). */
  drain(): WebhookDeadLetter[] {
    const out = this.#items;
    this.#items = [];
    return out;
  }

  /** The number of dead letters currently held. */
  get size(): number {
    return this.#items.length;
  }
}

/**
 * Per-attempt telemetry passed to {@link WebhookSenderOptions.onAttempt}.
 *
 * @since 0.37.0
 */
export interface WebhookAttempt {
  /** The idempotency id of the delivery. */
  id: string;
  /** 1-based attempt number. */
  attempt: number;
  /** The HTTP status, when the attempt produced a response. */
  status?: number;
  /** The error, when the attempt threw (network error / timeout). */
  error?: unknown;
  /** Whether the sender will retry after this attempt. */
  willRetry: boolean;
  /** The backoff delay (ms) before the next attempt, when retrying. */
  delayMs?: number;
}

/**
 * The outcome of a {@link createWebhookSender} delivery. Never throws for
 * an ordinary delivery failure — inspect `ok` / `deadLettered` instead.
 *
 * @since 0.37.0
 */
export interface WebhookDeliveryResult {
  /** `true` when the receiver returned a 2xx response. */
  ok: boolean;
  /** The idempotency id used for the delivery. */
  id: string;
  /** The event type, when one was supplied. */
  eventType?: string;
  /** Total number of attempts made. */
  attempts: number;
  /** The final HTTP status, when the last attempt produced a response. */
  status?: number;
  /** The final response object, when the last attempt produced one. */
  response?: Response;
  /** The final error, when the last attempt threw. */
  error?: unknown;
  /** Whether the failed delivery was handed to the dead-letter sink. */
  deadLettered: boolean;
}

/**
 * Configuration for {@link createWebhookSender}. Only `secret` is
 * required; every other field has a production-safe default.
 *
 * @since 0.37.0
 */
export interface WebhookSenderOptions {
  /** HMAC secret used to sign every delivery. */
  secret: string | Uint8Array;
  /** HMAC digest. Default `"sha256"`. */
  algorithm?: WebhookHmacAlgorithm;
  /**
   * Transport. Defaults to {@link fetchGuard} so webhook URLs that resolve
   * to internal / cloud-metadata addresses are refused (SSRF defence).
   * Pass your own to relax or extend that posture.
   */
  fetch?: typeof fetch;
  /** Maximum total attempts (first try + retries). Default `5`. */
  maxAttempts?: number;
  /** Base backoff for the first retry, in ms. Default `500`. */
  retryDelayMs?: number;
  /** Upper bound on any single backoff delay, in ms. Default `30_000`. */
  maxRetryDelayMs?: number;
  /** Exponential backoff multiplier. Default `2`. */
  backoffFactor?: number;
  /** Apply full jitter to backoff. Default `true`. */
  jitter?: boolean;
  /** Per-attempt timeout, in ms. `0` disables. Default `10_000`. */
  timeoutMs?: number;
  /**
   * Response statuses that trigger a retry. Default
   * `[408, 429, 500, 502, 503, 504]`. Any other non-2xx status is a
   * permanent failure (dead-lettered immediately).
   */
  retryableStatuses?: readonly number[];
  /** Honour a `Retry-After` header on a retryable response. Default `true`. */
  respectRetryAfter?: boolean;
  /** Header carrying the idempotency id. Default `"webhook-id"`. */
  idHeader?: string;
  /** Header carrying the Unix-seconds timestamp. Default `"webhook-timestamp"`. */
  timestampHeader?: string;
  /** Header carrying the signature. Default `"webhook-signature"`. */
  signatureHeader?: string;
  /** Header carrying the event type. Default `"webhook-event-type"`. */
  eventTypeHeader?: string;
  /** `User-Agent` sent with every delivery. Default `"DaloyJS-Webhook/1.0"`. */
  userAgent?: string;
  /** Sink for permanently-failed deliveries. */
  deadLetter?: WebhookDeadLetterSink;
  /** Clock (ms since epoch). Default {@link Date.now}. Override in tests. */
  now?: () => number;
  /**
   * Abortable sleep, primarily for deterministic tests. Defaults to a
   * `setTimeout`-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt observer (e.g. to emit a metric). */
  onAttempt?: (attempt: WebhookAttempt) => void;
}

const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - now);
  return undefined;
}

/** Serialise a payload to body bytes + a default content type. */
function encodePayload(payload: unknown): { bytes: Uint8Array; contentType: string } {
  if (payload instanceof Uint8Array) {
    return { bytes: payload, contentType: "application/octet-stream" };
  }
  if (typeof payload === "string") {
    return { bytes: new TextEncoder().encode(payload), contentType: "application/json" };
  }
  return {
    bytes: new TextEncoder().encode(JSON.stringify(payload ?? null)),
    contentType: "application/json",
  };
}

function randomId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Web-Crypto is mandatory on every runtime Daloy supports; this is an
  // unreachable last-resort guard so a missing global never throws.
  throw new Error("WebCrypto unavailable: cannot generate a webhook id");
}

/**
 * Build a webhook sender bound to a signing secret and delivery policy.
 * The returned `send(event)` function signs, delivers, retries, and
 * dead-letters a single {@link WebhookEvent}, resolving to a
 * {@link WebhookDeliveryResult} (it does not throw on ordinary delivery
 * failure).
 *
 * @example
 * ```ts
 * const send = createWebhookSender({ secret: process.env.WEBHOOK_SECRET! });
 * const result = await send({ url, eventType: "user.created", payload: { id } });
 * ```
 *
 * @param options - Signing secret plus delivery policy; see
 *   {@link WebhookSenderOptions} for the per-field defaults.
 * @returns A `send(event)` function that resolves to a
 *   {@link WebhookDeliveryResult}.
 * @throws Error at construction when `secret` is missing or empty.
 * @since 0.37.0
 */
export function createWebhookSender(
  options: WebhookSenderOptions,
): (event: WebhookEvent) => Promise<WebhookDeliveryResult> {
  if (options.secret === undefined || options.secret === null || options.secret === "") {
    throw new Error("createWebhookSender(): a non-empty signing secret is required");
  }
  const algorithm = options.algorithm ?? "sha256";
  const transport = options.fetch ?? fetchGuard();
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  const backoffFactor = options.backoffFactor ?? 2;
  const jitter = options.jitter ?? true;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const respectRetryAfter = options.respectRetryAfter ?? true;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("createWebhookSender(): maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("createWebhookSender(): timeoutMs must be a non-negative number");
  }
  const retryStatuses = new Set(options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES);
  const idHeader = options.idHeader ?? "webhook-id";
  const timestampHeader = options.timestampHeader ?? "webhook-timestamp";
  const signatureHeader = options.signatureHeader ?? "webhook-signature";
  const eventTypeHeader = options.eventTypeHeader ?? "webhook-event-type";
  const userAgent = options.userAgent ?? "DaloyJS-Webhook/1.0";
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  function backoffFor(attempt: number, response?: Response): number {
    if (respectRetryAfter && response) {
      const fromHeader = parseRetryAfter(response.headers.get("retry-after"), now());
      if (fromHeader !== undefined) return Math.min(maxRetryDelayMs, fromHeader);
    }
    const exp = retryDelayMs * backoffFactor ** (attempt - 1);
    const capped = Math.min(maxRetryDelayMs, exp);
    // Backoff jitter spreads load; it is not a security primitive.
    return jitter ? Math.random() * capped : capped; // daloy-allow-weak-random: backoff jitter is not a security primitive
  }

  async function attemptOnce(
    url: string,
    headers: Record<string, string>,
    body: Uint8Array,
  ): Promise<{ response?: Response; error?: unknown }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      (timer as { unref?: () => void }).unref?.();
    }
    try {
      const response = await transport(url, {
        method: "POST",
        headers,
        body: body as BodyInit,
        signal: controller.signal,
      });
      return { response };
    } catch (error) {
      return { error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return async function send(event: WebhookEvent): Promise<WebhookDeliveryResult> {
    const id = event.id ?? randomId();
    const { bytes, contentType: defaultContentType } = encodePayload(event.payload);
    const contentType = event.contentType ?? defaultContentType;
    const timestamp = Math.floor(now() / 1000);

    // Sign ONCE — every retry carries the same id + signature so the
    // receiver can dedupe and the timestamp stays stable.
    const signature = await signWebhookPayload({
      payload: bytes,
      secret: options.secret,
      algorithm,
      timestamp,
    });

    const baseHeaders: Record<string, string> = {
      "content-type": contentType,
      "user-agent": userAgent,
      [idHeader]: id,
      [timestampHeader]: String(timestamp),
      [signatureHeader]: `${algorithm}=${signature}`,
    };
    if (event.eventType !== undefined) baseHeaders[eventTypeHeader] = event.eventType;
    // Caller headers are merged last but cannot clobber signature headers.
    const reserved = new Set([
      "content-type",
      idHeader.toLowerCase(),
      timestampHeader.toLowerCase(),
      signatureHeader.toLowerCase(),
      eventTypeHeader.toLowerCase(),
    ]);
    for (const [k, v] of Object.entries(event.headers ?? {})) {
      if (!reserved.has(k.toLowerCase())) baseHeaders[k] = v;
    }

    let lastStatus: number | undefined;
    let lastResponse: Response | undefined;
    let lastError: unknown;
    let madeAttempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      madeAttempts = attempt;
      const { response, error } = await attemptOnce(event.url, baseHeaders, bytes);

      if (response) {
        lastResponse = response;
        lastStatus = response.status;
        lastError = undefined;
        if (response.ok) {
          options.onAttempt?.({ id, attempt, status: response.status, willRetry: false });
          return { ok: true, id, eventType: event.eventType, attempts: attempt, status: response.status, response, deadLettered: false };
        }
        const retryable = retryStatuses.has(response.status) && attempt < maxAttempts;
        const delayMs = retryable ? backoffFor(attempt, response) : undefined;
        options.onAttempt?.({ id, attempt, status: response.status, willRetry: retryable, delayMs });
        if (!retryable) break;
        await sleep(delayMs!);
        continue;
      }

      // Thrown error. An SSRF refusal is a permanent decision about the
      // target and is never retried; a per-attempt timeout (our own abort)
      // and ordinary network errors are transient and retried.
      lastError = error;
      lastResponse = undefined;
      lastStatus = undefined;
      const isSsrf = error instanceof Error && error.name === "SsrfBlockedError";
      const retryable = !isSsrf && attempt < maxAttempts;
      const delayMs = retryable ? backoffFor(attempt) : undefined;
      options.onAttempt?.({ id, attempt, error, willRetry: retryable, delayMs });
      if (!retryable) break;
      await sleep(delayMs!);
    }

    // Exhausted / permanent failure → dead-letter.
    let deadLettered = false;
    if (options.deadLetter) {
      await options.deadLetter.add({
        id,
        url: event.url,
        ...(event.eventType !== undefined ? { eventType: event.eventType } : {}),
        payload: bytes,
        contentType,
        attempts: madeAttempts,
        ...(lastStatus !== undefined ? { lastStatus } : {}),
        ...(lastError !== undefined ? { lastError: lastError instanceof Error ? lastError.message : String(lastError) } : {}),
        timestamp,
        failedAt: now(),
      });
      deadLettered = true;
    }

    const result: WebhookDeliveryResult = {
      ok: false,
      id,
      attempts: madeAttempts,
      deadLettered,
    };
    if (event.eventType !== undefined) result.eventType = event.eventType;
    if (lastStatus !== undefined) result.status = lastStatus;
    if (lastResponse !== undefined) result.response = lastResponse;
    if (lastError !== undefined) result.error = lastError;
    return result;
  };
}
