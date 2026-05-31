/**
 * `resilientFetch()` — circuit breaker, retry-with-backoff, and per-call
 * timeout for outbound `fetch`, designed to layer **on top of**
 * {@link fetchGuard} (which only covers SSRF on egress).
 *
 * `fetchGuard()` answers "is this outbound address safe?". This module
 * answers "is this upstream healthy, and how do we behave when it is
 * not?" — the operational half of a mature outbound HTTP client
 * (timeouts that prevent a hung upstream from exhausting your event
 * loop, bounded retries that ride out a blip without amplifying an
 * outage, and a circuit breaker that fails fast when an upstream is
 * clearly down). The two compose: wrap an SSRF-guarded fetch in a
 * resilient one and you get both safety and resilience with zero runtime
 * dependencies.
 *
 * ```ts
 * import { fetchGuard, resilientFetch } from "@daloyjs/core";
 *
 * const safeFetch = resilientFetch({
 *   fetch: fetchGuard(),       // SSRF floor underneath
 *   timeoutMs: 2_000,          // abort any call that stalls past 2s
 *   retries: 2,                // up to 2 retries on transient failures
 *   circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
 * });
 *
 * const res = await safeFetch("https://api.example.com/things");
 * ```
 *
 * ## Design notes
 *
 * - **Per-call timeout** is enforced with an `AbortController` that is
 *   combined with any caller-supplied `signal`, so cancellation works in
 *   both directions. A timeout surfaces as {@link FetchTimeoutError}; a
 *   caller-initiated abort surfaces as the caller's own `AbortError` and
 *   is **never** retried or counted as an upstream failure.
 * - **Retry-with-backoff** only retries idempotent methods
 *   (`GET`/`HEAD`/`OPTIONS`/`PUT`/`DELETE`) and a conservative set of
 *   transient statuses (`408`, `429`, `500`, `502`, `503`, `504`) plus
 *   network errors and timeouts. Backoff is exponential with full
 *   jitter and honours a `Retry-After` header when present. A
 *   {@link SsrfBlockedError} is treated as a hard refusal — never
 *   retried, never trips the breaker.
 * - **Circuit breaker** is a classic three-state machine
 *   (`closed → open → half-open`). Consecutive failures past the
 *   threshold open the circuit; while open every call fails fast with
 *   {@link CircuitOpenError} until `resetTimeoutMs` elapses, after which
 *   a limited number of trial requests probe the upstream. The breaker
 *   is shared across every call made through the returned function, so a
 *   single hot upstream is protected process-wide.
 *
 * @module
 * @since 0.37.0
 */

/**
 * The three states of a {@link CircuitBreaker}.
 *
 * - `closed` — normal operation; calls pass through and failures are
 *   counted.
 * - `open` — the upstream is considered down; calls fail fast with
 *   {@link CircuitOpenError} without touching the network.
 * - `half-open` — a recovery probe window; a limited number of trial
 *   calls are allowed through to test whether the upstream has healed.
 *
 * @since 0.37.0
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Thrown by {@link resilientFetch} (and {@link CircuitBreaker.execute})
 * when the circuit is open and the call is refused without hitting the
 * network. Distinct from a network failure so callers can render a
 * dedicated "service temporarily unavailable" path.
 *
 * @since 0.37.0
 */
export class CircuitOpenError extends Error {
  /** Milliseconds until the breaker will next allow a trial request. */
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`circuit breaker is open; retry in ~${Math.max(0, Math.round(retryAfterMs))}ms`);
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown by {@link resilientFetch} when a single attempt exceeds the
 * configured `timeoutMs`. A caller-initiated abort (via a `signal`
 * passed in the request init) surfaces as the caller's own `AbortError`
 * instead and is never retried.
 *
 * @since 0.37.0
 */
export class FetchTimeoutError extends Error {
  /** The timeout that was exceeded, in milliseconds. */
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`outbound fetch timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Tuning for the {@link CircuitBreaker}. All fields are optional and
 * default to a conservative posture suited to a single upstream.
 *
 * @since 0.37.0
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures that trips the breaker from `closed`
   * to `open`. Default `5`.
   */
  failureThreshold?: number;
  /**
   * Time the breaker stays `open` before allowing trial requests
   * (transition to `half-open`), in milliseconds. Default `30_000`.
   */
  resetTimeoutMs?: number;
  /**
   * Number of concurrent trial requests permitted while `half-open`.
   * Extra calls during the probe window fail fast with
   * {@link CircuitOpenError}. Default `1`.
   */
  halfOpenMaxAttempts?: number;
  /**
   * Number of consecutive trial successes required to close the breaker
   * again. Default `1`.
   */
  successThreshold?: number;
  /**
   * Observe state transitions (e.g. to emit a metric or log). Called
   * synchronously with the previous and next state.
   */
  onStateChange?: (next: CircuitState, previous: CircuitState) => void;
  /**
   * Monotonic clock, primarily for deterministic tests. Defaults to
   * `Date.now`.
   */
  now?: () => number;
}

/**
 * A standalone three-state circuit breaker. {@link resilientFetch}
 * builds on this, but it is exported for callers who want to protect a
 * non-`fetch` dependency (a database driver, a gRPC client, …) with the
 * same semantics.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ failureThreshold: 3 });
 * const rows = await breaker.execute(() => db.query("SELECT 1"));
 * ```
 *
 * @since 0.37.0
 */
export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #resetTimeoutMs: number;
  readonly #halfOpenMaxAttempts: number;
  readonly #successThreshold: number;
  readonly #onStateChange?: (next: CircuitState, previous: CircuitState) => void;
  readonly #now: () => number;

  #state: CircuitState = "closed";
  #failureCount = 0;
  #successCount = 0;
  #openedAt = 0;
  #halfOpenInFlight = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    const failureThreshold = options.failureThreshold ?? 5;
    const resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    const halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 1;
    const successThreshold = options.successThreshold ?? 1;
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new RangeError("CircuitBreaker: failureThreshold must be a positive integer");
    }
    if (!Number.isFinite(resetTimeoutMs) || resetTimeoutMs < 0) {
      throw new RangeError("CircuitBreaker: resetTimeoutMs must be a non-negative number");
    }
    if (!Number.isInteger(halfOpenMaxAttempts) || halfOpenMaxAttempts < 1) {
      throw new RangeError("CircuitBreaker: halfOpenMaxAttempts must be a positive integer");
    }
    if (!Number.isInteger(successThreshold) || successThreshold < 1) {
      throw new RangeError("CircuitBreaker: successThreshold must be a positive integer");
    }
    this.#failureThreshold = failureThreshold;
    this.#resetTimeoutMs = resetTimeoutMs;
    this.#halfOpenMaxAttempts = halfOpenMaxAttempts;
    this.#successThreshold = successThreshold;
    if (options.onStateChange) this.#onStateChange = options.onStateChange;
    this.#now = options.now ?? Date.now;
  }

  /** The breaker's current state, after applying any pending timeout. */
  get state(): CircuitState {
    if (this.#state === "open" && this.#now() - this.#openedAt >= this.#resetTimeoutMs) {
      return "half-open";
    }
    return this.#state;
  }

  /** Milliseconds until the breaker will next admit a trial request. */
  get retryAfterMs(): number {
    if (this.#state !== "open") return 0;
    return Math.max(0, this.#resetTimeoutMs - (this.#now() - this.#openedAt));
  }

  #transition(next: CircuitState): void {
    const previous = this.#state;
    if (previous === next) return;
    this.#state = next;
    if (next === "open") this.#openedAt = this.#now();
    if (next === "closed") {
      this.#failureCount = 0;
      this.#successCount = 0;
      this.#halfOpenInFlight = 0;
    }
    if (next === "half-open") {
      this.#successCount = 0;
      this.#halfOpenInFlight = 0;
    }
    this.#onStateChange?.(next, previous);
  }

  /** Reserve a slot, throwing {@link CircuitOpenError} if none is free. */
  #admit(): void {
    if (this.#state === "open") {
      if (this.#now() - this.#openedAt >= this.#resetTimeoutMs) {
        this.#transition("half-open");
      } else {
        throw new CircuitOpenError(this.retryAfterMs);
      }
    }
    if (this.#state === "half-open") {
      if (this.#halfOpenInFlight >= this.#halfOpenMaxAttempts) {
        throw new CircuitOpenError(this.retryAfterMs);
      }
      this.#halfOpenInFlight++;
    }
  }

  #onSuccess(): void {
    if (this.#state === "half-open") {
      this.#halfOpenInFlight = Math.max(0, this.#halfOpenInFlight - 1);
      this.#successCount++;
      if (this.#successCount >= this.#successThreshold) {
        this.#transition("closed");
      }
      return;
    }
    this.#failureCount = 0;
  }

  #onFailure(): void {
    if (this.#state === "half-open") {
      this.#halfOpenInFlight = Math.max(0, this.#halfOpenInFlight - 1);
      this.#transition("open");
      return;
    }
    this.#failureCount++;
    if (this.#failureCount >= this.#failureThreshold) {
      this.#transition("open");
    }
  }

  /**
   * Run `fn` under breaker supervision. Throws {@link CircuitOpenError}
   * immediately when the circuit is open. A thrown error (other than
   * `CircuitOpenError`) counts as a failure; a returned value counts as
   * a success. Use {@link recordOutcome} from {@link resilientFetch}
   * when an HTTP *response* (not a thrown error) should count as a
   * failure.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.#admit();
    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.#onFailure();
      throw err;
    }
  }

  /**
   * Record an externally-determined outcome. Lets a caller treat a
   * non-throwing result (e.g. an HTTP 503 response) as a failure while
   * still flowing the value back. Returns nothing; pair with an explicit
   * {@link admit}/{@link release} when you need full manual control.
   */
  recordOutcome(success: boolean): void {
    if (success) this.#onSuccess();
    else this.#onFailure();
  }

  /**
   * Reserve a breaker slot for a manually-supervised call. Throws
   * {@link CircuitOpenError} if the circuit will not admit the call.
   * Must be paired with exactly one {@link recordOutcome} or
   * {@link release}.
   */
  admit(): void {
    this.#admit();
  }

  /**
   * Release a slot reserved by {@link admit} without recording a success
   * or failure. Use for outcomes that are not an upstream health signal
   * (a caller-initiated abort, an SSRF refusal). Counts and state are
   * left untouched aside from freeing a half-open probe slot.
   */
  release(): void {
    if (this.#state === "half-open") {
      this.#halfOpenInFlight = Math.max(0, this.#halfOpenInFlight - 1);
    }
  }
}

/**
 * Context passed to the {@link ResilientFetchOptions.onRetry} hook and
 * the {@link ResilientFetchOptions.isRetryable} predicate.
 *
 * @since 0.37.0
 */
export interface RetryContext {
  /** 1-based attempt number that just failed. */
  readonly attempt: number;
  /** The request that was attempted. */
  readonly request: Request;
  /** The response received, when the failure was a retryable status. */
  readonly response?: Response;
  /** The error thrown, when the failure was a network error or timeout. */
  readonly error?: unknown;
}

/**
 * Options for {@link resilientFetch}. Every field is optional; the
 * defaults bias toward safe, low-amplification behaviour.
 *
 * @since 0.37.0
 */
export interface ResilientFetchOptions {
  /**
   * Underlying fetch implementation. Defaults to `globalThis.fetch`.
   * Pass a {@link fetchGuard} result to keep the SSRF floor underneath
   * the resilience layer.
   */
  fetch?: typeof fetch;
  /**
   * Per-attempt timeout in milliseconds. Each retry gets a fresh
   * timeout. Set `0` to disable. Default `10_000`.
   */
  timeoutMs?: number;
  /**
   * Maximum number of retries **after** the first attempt. `0` disables
   * retrying. Default `2` (so up to 3 total attempts).
   */
  retries?: number;
  /**
   * Base backoff delay in milliseconds for the first retry. Default
   * `100`.
   */
  retryDelayMs?: number;
  /** Upper bound on any single backoff delay. Default `2_000`. */
  maxRetryDelayMs?: number;
  /** Exponential backoff multiplier. Default `2`. */
  backoffFactor?: number;
  /**
   * Apply full jitter (`delay * random()`) to backoff to avoid
   * thundering-herd retries. Default `true`.
   */
  jitter?: boolean;
  /**
   * HTTP methods that are safe to retry. Default the idempotent set:
   * `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`. Non-idempotent methods
   * (`POST`, `PATCH`) are never retried unless added here.
   */
  retryableMethods?: readonly string[];
  /**
   * Response statuses that should be retried. Default
   * `[408, 429, 500, 502, 503, 504]`.
   */
  retryableStatuses?: readonly number[];
  /**
   * Honour a `Retry-After` header on a retryable response (seconds or
   * HTTP-date), capped by `maxRetryDelayMs`. Default `true`.
   */
  respectRetryAfter?: boolean;
  /**
   * Override the retry decision entirely. Return `true` to retry the
   * given outcome. When provided, replaces the method/status defaults.
   */
  isRetryable?: (context: RetryContext) => boolean;
  /**
   * Observe each retry, e.g. to emit a metric. Called with the failed
   * attempt's context and the delay before the next attempt.
   */
  onRetry?: (context: RetryContext, delayMs: number) => void;
  /**
   * Circuit breaker configuration, an existing {@link CircuitBreaker}
   * instance to share across clients, or `false` to disable. Default
   * enabled with {@link CircuitBreakerOptions} defaults.
   */
  circuitBreaker?: CircuitBreakerOptions | CircuitBreaker | false;
  /**
   * Response statuses that count as an upstream failure for the circuit
   * breaker. Default `[500, 502, 503, 504]`. A failing status still
   * flows back to the caller after retries are exhausted.
   */
  circuitBreakerFailureStatuses?: readonly number[];
  /**
   * Sleep implementation, primarily for deterministic tests. Receives
   * the delay and an `AbortSignal` that fires if the caller cancels.
   * Defaults to a `setTimeout`-based abortable sleep.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_RETRYABLE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];
const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];
const DEFAULT_BREAKER_FAILURE_STATUSES: readonly number[] = [500, 502, 503, 504];

/** Abortable sleep that resolves early (without throwing) if cancelled. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // Do not keep the event loop alive solely for a backoff timer.
    (timer as { unref?: () => void }).unref?.();
  });
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to ms. */
function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now);
  }
  return undefined;
}

/**
 * Combine a caller-supplied signal with a fresh timeout signal. Returns
 * the merged signal plus a `cleanup` to clear the timer / listeners and
 * a `timedOut` flag so the caller can distinguish our timeout from the
 * caller's own abort.
 */
function withTimeout(
  timeoutMs: number,
  external?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onExternalAbort = (): void => {
    controller.abort((external as AbortSignal).reason);
  };

  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  if (timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
    timedOut: () => timedOut,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Wrap a `fetch` with per-call timeout, retry-with-backoff, and a shared
 * circuit breaker. The returned function has the same call signature as
 * the global `fetch`.
 *
 * Layer it over {@link fetchGuard} to keep SSRF protection underneath:
 *
 * ```ts
 * const safeFetch = resilientFetch({ fetch: fetchGuard(), timeoutMs: 2_000 });
 * ```
 *
 * @since 0.37.0
 */
export function resilientFetch(options: ResilientFetchOptions = {}): typeof fetch {
  const baseFetch = options.fetch ?? (globalThis.fetch as typeof fetch);
  if (typeof baseFetch !== "function") {
    throw new Error("resilientFetch(): no global fetch available; pass options.fetch.");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 2_000;
  const backoffFactor = options.backoffFactor ?? 2;
  const jitter = options.jitter ?? true;
  const respectRetryAfter = options.respectRetryAfter ?? true;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("resilientFetch(): timeoutMs must be a non-negative number");
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("resilientFetch(): retries must be a non-negative integer");
  }
  const retryMethods = new Set(
    (options.retryableMethods ?? DEFAULT_RETRYABLE_METHODS).map((m) => m.toUpperCase()),
  );
  const retryStatuses = new Set(options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES);
  const breakerFailureStatuses = new Set(
    options.circuitBreakerFailureStatuses ?? DEFAULT_BREAKER_FAILURE_STATUSES,
  );
  const sleep = options.sleep ?? defaultSleep;

  let breaker: CircuitBreaker | undefined;
  if (options.circuitBreaker !== false) {
    breaker =
      options.circuitBreaker instanceof CircuitBreaker
        ? options.circuitBreaker
        : new CircuitBreaker(options.circuitBreaker ?? {});
  }

  function backoffFor(attempt: number, response?: Response): number {
    if (respectRetryAfter && response) {
      const fromHeader = parseRetryAfter(response.headers.get("retry-after"), Date.now());
      if (fromHeader !== undefined) return Math.min(maxRetryDelayMs, fromHeader);
    }
    const exp = retryDelayMs * backoffFactor ** (attempt - 1);
    const capped = Math.min(maxRetryDelayMs, exp);
    // Backoff jitter is a load-spreading heuristic, not a security primitive;
    // a non-cryptographic PRNG is the correct, conventional choice here.
    return jitter ? Math.random() * capped : capped; // daloy-allow-weak-random: backoff jitter is not a security primitive
  }

  function shouldRetry(ctx: RetryContext): boolean {
    if (options.isRetryable) return options.isRetryable(ctx);
    if (!retryMethods.has(ctx.request.method.toUpperCase())) return false;
    if (ctx.response) return retryStatuses.has(ctx.response.status);
    return true; // network error / timeout on an idempotent method
  }

  const resilient = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Materialise once so method/headers are stable across retries and
    // the caller's signal can be combined per attempt.
    const request = new Request(input as RequestInfo, init);
    const callerSignal = init?.signal ?? request.signal;

    const run = async (): Promise<Response> => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        const { signal, cleanup, timedOut } = withTimeout(timeoutMs, callerSignal);
        let response: Response | undefined;
        try {
          // Clone the request per attempt so a consumed body can be re-sent.
          response = await baseFetch(request.clone(), { signal });
        } catch (err) {
          cleanup();
          // Caller cancelled: never retry, never count as upstream failure.
          if (isAbortError(err) && callerSignal?.aborted) throw err;
          // An SSRF refusal from an underlying fetchGuard is a hard, terminal
          // decision about the request itself — never retried.
          if (err instanceof Error && err.name === "SsrfBlockedError") throw err;
          // Our timeout fired.
          lastError = timedOut() && isAbortError(err) ? new FetchTimeoutError(timeoutMs) : err;
          const ctx: RetryContext = { attempt, request, error: lastError };
          if (attempt <= retries && shouldRetry(ctx)) {
            const delay = backoffFor(attempt);
            options.onRetry?.(ctx, delay);
            await sleep(delay, callerSignal ?? undefined);
            if (callerSignal?.aborted) throw lastError;
            continue;
          }
          throw lastError;
        }
        cleanup();
        const ctx: RetryContext = { attempt, request, response };
        if (attempt <= retries && shouldRetry(ctx)) {
          const delay = backoffFor(attempt, response);
          options.onRetry?.(ctx, delay);
          await sleep(delay, callerSignal ?? undefined);
          if (callerSignal?.aborted) return response;
          continue;
        }
        return response;
      }
      // Unreachable: the loop always returns or throws.
      throw lastError;
    };

    if (!breaker) return run();

    // Supervise with the breaker. A retryable-but-exhausted server-error
    // response must count as a failure, so we admit/record manually.
    breaker.admit();
    try {
      const response = await run();
      breaker.recordOutcome(!breakerFailureStatuses.has(response.status));
      return response;
    } catch (err) {
      // SSRF refusals and caller aborts are not upstream health signals.
      if (err instanceof CircuitOpenError) throw err;
      const isCallerAbort = isAbortError(err) && callerSignal?.aborted;
      const isSsrf = err instanceof Error && err.name === "SsrfBlockedError";
      if (isCallerAbort || isSsrf) breaker.release();
      else breaker.recordOutcome(false);
      throw err;
    }
  };

  return resilient as typeof fetch;
}
