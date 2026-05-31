import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resilientFetch,
  CircuitBreaker,
  CircuitOpenError,
  FetchTimeoutError,
  fetchGuard,
  SsrfBlockedError,
  type CircuitState,
} from "../src/index.js";

// A stub fetch driven by a queue of step functions. Each step receives
// the (cloned) Request and the per-attempt AbortSignal and either
// returns a Response or throws.
type Step = (req: Request, signal?: AbortSignal) => Promise<Response> | Response;

function scriptedFetch(steps: Step[]): { fn: typeof fetch } {
  let calls = 0;
  const fn = (async (input: Request | string | URL, init?: RequestInit) => {
    const i = calls++;
    const step = steps[Math.min(i, steps.length - 1)];
    const req = input instanceof Request ? input : new Request(input as RequestInfo, init);
    return step(req, init?.signal ?? undefined);
  }) as unknown as typeof fetch;
  return { fn };
}

function ok(body = "ok"): Step {
  return () => new Response(body, { status: 200 });
}
function status(code: number, headers?: Record<string, string>): Step {
  return () => new Response("err", { status: code, headers });
}
function netError(): Step {
  return () => {
    throw new TypeError("network down");
  };
}

// Sleep stub: resolves immediately, records the requested delays.
function recordingSleep(): { sleep: (ms: number, s?: AbortSignal) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

// ── per-call timeout ────────────────────────────────────────────────

test("resilientFetch: aborts a stalled attempt with FetchTimeoutError", async () => {
  const fetchImpl = (async (_input: Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    })) as unknown as typeof fetch;
  const f = resilientFetch({ fetch: fetchImpl, timeoutMs: 10, retries: 0, circuitBreaker: false });
  await assert.rejects(() => f("https://example.com/"), FetchTimeoutError);
});

test("resilientFetch: a fast call resolves and is not timed out", async () => {
  const { fn } = scriptedFetch([ok("hi")]);
  const f = resilientFetch({ fetch: fn, timeoutMs: 1_000, retries: 0, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hi");
});

test("resilientFetch: timeoutMs=0 disables the per-call timeout", async () => {
  const { fn } = scriptedFetch([ok()]);
  const f = resilientFetch({ fetch: fn, timeoutMs: 0, retries: 0, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 200);
});

// ── retry-with-backoff ──────────────────────────────────────────────

test("resilientFetch: retries a 503 then succeeds (idempotent GET)", async () => {
  const { sleep, delays } = recordingSleep();
  const { fn } = scriptedFetch([status(503), status(503), ok("recovered")]);
  const f = resilientFetch({
    fetch: fn,
    retries: 2,
    jitter: false,
    retryDelayMs: 100,
    backoffFactor: 2,
    sleep,
    circuitBreaker: false,
  });
  const res = await f("https://example.com/");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "recovered");
  assert.deepEqual(delays, [100, 200]); // exponential, no jitter
});

test("resilientFetch: returns the last failing response after retries exhausted", async () => {
  const { sleep } = recordingSleep();
  const { fn } = scriptedFetch([status(500), status(500), status(500)]);
  const f = resilientFetch({ fetch: fn, retries: 2, jitter: false, sleep, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 500);
});

test("resilientFetch: retries a network error on an idempotent method", async () => {
  const { sleep } = recordingSleep();
  const { fn } = scriptedFetch([netError(), ok("ok")]);
  const f = resilientFetch({ fetch: fn, retries: 1, jitter: false, sleep, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 200);
});

test("resilientFetch: does NOT retry a non-idempotent POST by default", async () => {
  const { sleep, delays } = recordingSleep();
  const { fn } = scriptedFetch([status(503), ok()]);
  const f = resilientFetch({ fetch: fn, retries: 3, sleep, circuitBreaker: false });
  const res = await f("https://example.com/", { method: "POST" });
  assert.equal(res.status, 503);
  assert.deepEqual(delays, []); // never retried
});

test("resilientFetch: does NOT retry a non-retryable 404", async () => {
  const { fn } = scriptedFetch([status(404), ok()]);
  const f = resilientFetch({ fetch: fn, retries: 3, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 404);
});

test("resilientFetch: honours Retry-After seconds header (capped by max)", async () => {
  const { sleep, delays } = recordingSleep();
  const { fn } = scriptedFetch([status(429, { "retry-after": "2" }), ok()]);
  const f = resilientFetch({
    fetch: fn,
    retries: 1,
    maxRetryDelayMs: 5_000,
    sleep,
    circuitBreaker: false,
  });
  const res = await f("https://example.com/");
  assert.equal(res.status, 200);
  assert.deepEqual(delays, [2_000]); // 2s from header
});

test("resilientFetch: Retry-After is capped by maxRetryDelayMs", async () => {
  const { sleep, delays } = recordingSleep();
  const { fn } = scriptedFetch([status(429, { "retry-after": "999" }), ok()]);
  const f = resilientFetch({
    fetch: fn,
    retries: 1,
    maxRetryDelayMs: 1_500,
    sleep,
    circuitBreaker: false,
  });
  await f("https://example.com/");
  assert.deepEqual(delays, [1_500]);
});

test("resilientFetch: onRetry hook fires with attempt + delay", async () => {
  const { sleep } = recordingSleep();
  const seen: Array<{ attempt: number; status?: number; delay: number }> = [];
  const { fn } = scriptedFetch([status(503), ok()]);
  const f = resilientFetch({
    fetch: fn,
    retries: 1,
    jitter: false,
    sleep,
    circuitBreaker: false,
    onRetry: (ctx, delay) => seen.push({ attempt: ctx.attempt, status: ctx.response?.status, delay }),
  });
  await f("https://example.com/");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.attempt, 1);
  assert.equal(seen[0]?.status, 503);
  assert.equal(seen[0]?.delay, 100);
});

test("resilientFetch: custom isRetryable overrides method/status defaults", async () => {
  const { sleep } = recordingSleep();
  const { fn } = scriptedFetch([status(418), ok("teapot-recovered")]);
  const f = resilientFetch({
    fetch: fn,
    retries: 1,
    sleep,
    circuitBreaker: false,
    isRetryable: (ctx) => ctx.response?.status === 418,
  });
  const res = await f("https://example.com/");
  assert.equal(await res.text(), "teapot-recovered");
});

test("resilientFetch: retries=0 makes exactly one attempt", async () => {
  const { fn } = scriptedFetch([status(503), ok()]);
  let calls = 0;
  const counting = (async (input: Request | string | URL, init?: RequestInit) => {
    calls++;
    return fn(input as RequestInfo, init);
  }) as unknown as typeof fetch;
  const f = resilientFetch({ fetch: counting, retries: 0, circuitBreaker: false });
  const res = await f("https://example.com/");
  assert.equal(res.status, 503);
  assert.equal(calls, 1);
});

// ── caller-supplied AbortSignal ─────────────────────────────────────

test("resilientFetch: a caller abort is not retried and surfaces AbortError", async () => {
  const controller = new AbortController();
  const fetchImpl = (async (_input: Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    })) as unknown as typeof fetch;
  const f = resilientFetch({ fetch: fetchImpl, retries: 3, timeoutMs: 0, circuitBreaker: false });
  const p = f("https://example.com/", { signal: controller.signal });
  controller.abort();
  await assert.rejects(p, (err: unknown) => err instanceof Error && err.name === "AbortError");
});

// ── circuit breaker (via resilientFetch) ────────────────────────────

test("resilientFetch: opens the circuit after consecutive failures and fails fast", async () => {
  const { sleep } = recordingSleep();
  const { fn } = scriptedFetch([status(500)]); // always 500
  const f = resilientFetch({
    fetch: fn,
    retries: 0,
    sleep,
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 10_000 },
  });
  // Two failing calls (503/500 family) trip the breaker.
  assert.equal((await f("https://example.com/")).status, 500);
  assert.equal((await f("https://example.com/")).status, 500);
  // Third call should fail fast without touching fetch.
  await assert.rejects(() => f("https://example.com/"), CircuitOpenError);
});

test("resilientFetch: half-open probe closes the circuit on success", async () => {
  let clock = 1_000;
  const now = () => clock;
  const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1_000, now });
  const steps: Step[] = [status(500), ok("healthy")];
  const { fn } = scriptedFetch(steps);
  const f = resilientFetch({ fetch: fn, retries: 0, circuitBreaker: breaker });

  assert.equal((await f("https://example.com/")).status, 500); // trips open
  await assert.rejects(() => f("https://example.com/"), CircuitOpenError); // open
  clock += 1_000; // elapse reset timeout → half-open
  const res = await f("https://example.com/"); // trial succeeds
  assert.equal(await res.text(), "healthy");
  assert.equal(breaker.state, "closed");
});

test("resilientFetch: circuitBreaker:false disables the breaker entirely", async () => {
  const { fn } = scriptedFetch([status(500)]);
  const f = resilientFetch({ fetch: fn, retries: 0, circuitBreaker: false });
  for (let i = 0; i < 10; i++) {
    assert.equal((await f("https://example.com/")).status, 500);
  }
});

// ── circuit breaker (standalone) ────────────────────────────────────

test("CircuitBreaker: execute() trips open after threshold and rejects when open", async () => {
  const transitions: CircuitState[] = [];
  const breaker = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 5_000,
    onStateChange: (next) => transitions.push(next),
  });
  const boom = () => Promise.reject(new Error("boom"));
  await assert.rejects(() => breaker.execute(boom));
  await assert.rejects(() => breaker.execute(boom));
  assert.equal(breaker.state, "open");
  await assert.rejects(() => breaker.execute(() => Promise.resolve(1)), CircuitOpenError);
  assert.deepEqual(transitions, ["open"]);
});

test("CircuitBreaker: a success resets the consecutive-failure count", async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2 });
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x"))));
  await breaker.execute(() => Promise.resolve("ok")); // resets
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x"))));
  assert.equal(breaker.state, "closed"); // not tripped: only 1 consecutive
});

test("CircuitBreaker: half-open failure re-opens the circuit", async () => {
  let clock = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, now: () => clock });
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x"))));
  assert.equal(breaker.state, "open");
  clock = 100; // → half-open
  assert.equal(breaker.state, "half-open");
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x")))); // trial fails
  clock = 150;
  assert.equal(breaker.state, "open"); // re-opened, timer reset
});

test("CircuitBreaker: half-open limits concurrent probes", async () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 100,
    halfOpenMaxAttempts: 1,
    now: () => clock,
  });
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x"))));
  clock = 100; // half-open
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const probe = breaker.execute(async () => {
    await gate;
    return "ok";
  });
  // A second probe while the first is in flight is rejected.
  await assert.rejects(() => breaker.execute(() => Promise.resolve("ok")), CircuitOpenError);
  release();
  await probe;
  assert.equal(breaker.state, "closed");
});

test("CircuitBreaker: rejects invalid options", () => {
  assert.throws(() => new CircuitBreaker({ failureThreshold: 0 }), RangeError);
  assert.throws(() => new CircuitBreaker({ resetTimeoutMs: -1 }), RangeError);
  assert.throws(() => new CircuitBreaker({ halfOpenMaxAttempts: 0 }), RangeError);
  assert.throws(() => new CircuitBreaker({ successThreshold: 0 }), RangeError);
});

test("CircuitBreaker: successThreshold requires multiple half-open successes", async () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 100,
    halfOpenMaxAttempts: 2,
    successThreshold: 2,
    now: () => clock,
  });
  await assert.rejects(() => breaker.execute(() => Promise.reject(new Error("x"))));
  clock = 100; // half-open
  await breaker.execute(() => Promise.resolve("a")); // 1st success
  assert.equal(breaker.state, "half-open"); // still probing
  await breaker.execute(() => Promise.resolve("b")); // 2nd success → close
  assert.equal(breaker.state, "closed");
});

// ── validation ──────────────────────────────────────────────────────

test("resilientFetch: rejects invalid timeoutMs and retries", () => {
  assert.throws(() => resilientFetch({ timeoutMs: -1, fetch: scriptedFetch([ok()]).fn }), RangeError);
  assert.throws(() => resilientFetch({ retries: -1, fetch: scriptedFetch([ok()]).fn }), RangeError);
});

test("resilientFetch: throws when no fetch is available", () => {
  assert.throws(
    () => resilientFetch({ fetch: 123 as unknown as typeof fetch }),
    /no global fetch available/,
  );
});

// ── composition with fetchGuard ─────────────────────────────────────

test("resilientFetch: SSRF refusal from fetchGuard bubbles, is not retried", async () => {
  const { sleep, delays } = recordingSleep();
  const guarded = fetchGuard(); // blocks 169.254.169.254
  const f = resilientFetch({ fetch: guarded, retries: 3, sleep });
  await assert.rejects(
    () => f("http://169.254.169.254/latest/meta-data/"),
    (err: unknown) => err instanceof SsrfBlockedError,
  );
  assert.deepEqual(delays, []); // refusal is terminal, never retried
});

test("resilientFetch: SSRF refusal does not trip the circuit breaker", async () => {
  const guarded = fetchGuard();
  const f = resilientFetch({
    fetch: guarded,
    retries: 0,
    circuitBreaker: { failureThreshold: 1 },
  });
  await assert.rejects(() => f("http://169.254.169.254/"), SsrfBlockedError);
  // Breaker should still be closed → a second guarded call still reaches
  // the guard (and is refused again) rather than failing fast.
  await assert.rejects(() => f("http://169.254.169.254/"), SsrfBlockedError);
});
