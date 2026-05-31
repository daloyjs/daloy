import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Outbound resilience for fetch",
  description:
    "Layer a circuit breaker, retry-with-backoff, and per-call timeout on top of fetchGuard() for DaloyJS outbound calls. A dependency-free resilientFetch() that composes with SSRF protection for a mature outbound HTTP client.",
  path: "/docs/fetch-resilience",
  keywords: [
    "circuit breaker",
    "retry with backoff",
    "fetch timeout",
    "resilientFetch",
    "outbound resilience",
    "DaloyJS fetch",
    "SSRF",
    "fetchGuard",
    "Retry-After",
    "exponential backoff",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>
        Outbound resilience for <code>fetch</code>
      </h1>
      <p>
        <code>fetchGuard()</code> answers{" "}
        <em>&ldquo;is this outbound address safe?&rdquo;</em> &mdash; it blocks
        the SSRF chain to cloud metadata and internal ranges.{" "}
        <code>resilientFetch()</code> answers the operational other half:{" "}
        <em>
          &ldquo;is this upstream healthy, and how do we behave when it is
          not?&rdquo;
        </em>{" "}
        As of <strong>0.37.0</strong> DaloyJS ships a{" "}
        <strong>dependency-free</strong> resilience layer with three classic
        guards:
      </p>
      <ul>
        <li>
          <strong>Per-call timeout</strong> &mdash; an{" "}
          <code>AbortController</code> aborts any attempt that stalls, so a hung
          upstream can never exhaust your event loop. Surfaces as{" "}
          <code>FetchTimeoutError</code>.
        </li>
        <li>
          <strong>Retry-with-backoff</strong> &mdash; bounded retries with
          exponential backoff and full jitter, scoped to idempotent methods and
          transient statuses, honouring <code>Retry-After</code>.
        </li>
        <li>
          <strong>Circuit breaker</strong> &mdash; a three-state machine (
          <code>closed &rarr; open &rarr; half-open</code>) that fails fast when
          an upstream is clearly down, then probes for recovery.
        </li>
      </ul>
      <p>
        The two compose: wrap an SSRF-guarded <code>fetch</code> in a resilient
        one and you get both safety <em>and</em> resilience with zero runtime
        dependencies.
      </p>

      <h2>Quick start</h2>
      <p>
        Layer <code>resilientFetch()</code> over <code>fetchGuard()</code> so
        the SSRF floor stays underneath the resilience logic.
      </p>
      <CodeBlock
        code={`import { fetchGuard, resilientFetch } from "@daloyjs/core";

const safeFetch = resilientFetch({
  fetch: fetchGuard(),       // SSRF floor underneath
  timeoutMs: 2_000,          // abort any attempt that stalls past 2s
  retries: 2,                // up to 2 retries on transient failures
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
});

// Same call signature as the global fetch.
const res = await safeFetch("https://api.example.com/things");`}
        language="ts"
      />
      <p>
        The returned function has the exact call signature of the global{" "}
        <code>fetch</code>, so it is a drop-in replacement anywhere you already
        call <code>fetch</code>.
      </p>

      <h2>Per-call timeout</h2>
      <p>
        Each attempt &mdash; including every retry &mdash; gets a fresh
        <code>timeoutMs</code> budget (default <code>10_000</code>). A timeout
        aborts the in-flight request and throws <code>FetchTimeoutError</code>.
        A timeout combines with any caller-supplied <code>signal</code>: a
        caller-initiated abort surfaces as the caller&rsquo;s own{" "}
        <code>AbortError</code> and is <strong>never</strong> retried or counted
        as an upstream failure.
      </p>
      <CodeBlock
        code={`import { resilientFetch, FetchTimeoutError } from "@daloyjs/core";

const fetchWithTimeout = resilientFetch({ timeoutMs: 1_000, retries: 0 });

try {
  await fetchWithTimeout("https://slow.example.com/");
} catch (err) {
  if (err instanceof FetchTimeoutError) {
    // err.timeoutMs === 1000
  }
}`}
        language="ts"
      />

      <h2>Retry-with-backoff</h2>
      <p>
        Retries only fire for <strong>idempotent</strong> methods (
        <code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code>,{" "}
        <code>PUT</code>, <code>DELETE</code>) and a conservative set of
        transient statuses (<code>408</code>, <code>429</code>, <code>500</code>
        , <code>502</code>, <code>503</code>, <code>504</code>), plus network
        errors and timeouts. Non-idempotent <code>POST</code> /{" "}
        <code>PATCH</code> calls are never retried unless you opt in via{" "}
        <code>retryableMethods</code>. Backoff is exponential with full jitter
        to avoid a thundering-herd retry storm, and a <code>Retry-After</code>{" "}
        response header is honoured (capped by <code>maxRetryDelayMs</code>).
      </p>
      <CodeBlock
        code={`const client = resilientFetch({
  retries: 3,
  retryDelayMs: 100,        // first backoff
  backoffFactor: 2,         // 100ms, 200ms, 400ms (pre-jitter)
  maxRetryDelayMs: 2_000,   // cap any single delay
  jitter: true,             // full jitter: delay * random()
  respectRetryAfter: true,  // honour Retry-After on 429/503
  onRetry: (ctx, delayMs) => {
    metrics.counter("http_client_retries_total").inc({ host: new URL(ctx.request.url).host });
  },
});`}
        language="ts"
      />
      <p>
        Override the decision entirely with <code>isRetryable</code> when you
        need bespoke logic:
      </p>
      <CodeBlock
        code={`const client = resilientFetch({
  retries: 2,
  isRetryable: (ctx) =>
    // retry only on explicit 503 from this upstream
    ctx.response?.status === 503,
});`}
        language="ts"
      />

      <h2>Circuit breaker</h2>
      <p>
        After <code>failureThreshold</code> consecutive failures the breaker
        trips <strong>open</strong>: every subsequent call fails fast with{" "}
        <code>CircuitOpenError</code> &mdash; no network round-trip &mdash;
        until <code>resetTimeoutMs</code> elapses. The breaker then enters{" "}
        <strong>half-open</strong> and admits a limited number of trial
        requests; a success closes it again, a failure re-opens it. The breaker
        is shared across every call made through the returned function, so one
        hot upstream is protected process-wide. A <code>5xx</code> response
        counts as a failure (configurable via{" "}
        <code>circuitBreakerFailureStatuses</code>); an SSRF refusal and a
        caller-initiated abort do <strong>not</strong>.
      </p>
      <CodeBlock
        code={`import { resilientFetch, CircuitOpenError } from "@daloyjs/core";

const client = resilientFetch({
  fetch: fetchGuard(),
  circuitBreaker: {
    failureThreshold: 5,      // trip after 5 consecutive failures
    resetTimeoutMs: 30_000,   // stay open 30s before probing
    halfOpenMaxAttempts: 1,   // one probe at a time
    successThreshold: 1,      // one success closes the circuit
    onStateChange: (next, prev) => log.warn({ next, prev }, "circuit state"),
  },
});

try {
  await client("https://api.example.com/");
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // fail fast — err.retryAfterMs hints when to try again
  }
}`}
        language="ts"
      />
      <p>
        Pass <code>circuitBreaker: false</code> to disable it, or pass an
        existing <code>CircuitBreaker</code> instance to share one breaker
        across several clients targeting the same upstream.
      </p>

      <h2>The standalone CircuitBreaker</h2>
      <p>
        The breaker is exported on its own so you can protect any non-{" "}
        <code>fetch</code> dependency &mdash; a database driver, a gRPC client
        &mdash; with the same semantics.
      </p>
      <CodeBlock
        code={`import { CircuitBreaker } from "@daloyjs/core";

const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 10_000 });

const rows = await breaker.execute(() => db.query("SELECT 1"));
// breaker.state -> "closed" | "open" | "half-open"`}
        language="ts"
      />

      <h2>Security posture</h2>
      <ul>
        <li>
          <strong>SSRF protection is preserved.</strong>{" "}
          <code>resilientFetch()</code> never replaces <code>fetchGuard()</code>{" "}
          &mdash; it wraps it. An <code>SsrfBlockedError</code> is a terminal
          refusal: it bubbles unchanged, is never retried, and never trips the
          circuit breaker.
        </li>
        <li>
          <strong>Bounded amplification.</strong> Retries are capped and scoped
          to idempotent methods, so a transient blip cannot turn into a retry
          storm against a struggling upstream.
        </li>
        <li>
          <strong>No event-loop exhaustion.</strong> Every attempt is bounded by
          a per-call timeout, and the backoff timer is <code>unref()</code>
          &rsquo;d so it never keeps the process alive on its own.
        </li>
        <li>
          <strong>Zero runtime dependencies.</strong> Built entirely on
          Web-standard <code>AbortController</code> / <code>fetch</code>, so it
          runs unchanged on Node, Bun, Deno, Cloudflare Workers, and Vercel
          Edge.
        </li>
      </ul>
    </>
  );
}
