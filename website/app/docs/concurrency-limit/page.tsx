import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";
import { UseCaseGuide } from "../../../components/use-case-guide";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Per-route / per-client concurrency limits",
  description:
    "Bound in-flight requests per route and per client with concurrencyLimit(), HAProxy maxconn/queue parity at the app layer: a semaphore, a bounded FIFO queue, and a fast 503. Complements maxConnections and loadShedding(). Zero runtime dependencies.",
  path: "/docs/concurrency-limit",
  keywords: [
    "concurrency limit",
    "concurrencyLimit",
    "maxconn",
    "request queue",
    "backpressure",
    "HAProxy",
    "load shedding",
    "503",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Per-route / per-client concurrency limits</h1>
      <p>
        DaloyJS ships <code>concurrencyLimit()</code>
        {": "}HAProxy <code>maxconn</code> + request-queue parity, but inside
        the app where the framework already owns routing and client identity.
        Where the Node adapter&apos;s <code>maxConnections</code> caps{" "}
        <em>sockets</em> at accept time and <code>loadShedding()</code> rejects
        traffic under <em>process</em> pressure, <code>concurrencyLimit()</code>{" "}
        bounds the number of requests{" "}
        <strong>in flight through a given surface</strong>.
      </p>

      <UseCaseGuide
        featureName="Concurrency limit middleware"
        recommendation="Use concurrency limits to protect downstream resources (like databases or third-party APIs) and high-compute CPU operations from exhaustion under heavy load. Avoid limiting standard, lightweight I/O operations."
        whenToUse={[
          "Gating resource-heavy tasks like PDF generation, video transcoding, or large-scale data processing.",
          "Endpoints querying databases with small connection pools or calling rate-limited external services.",
          "Shedding load under sudden traffic spikes to prioritize system stability over serving every client immediately.",
        ]}
        whenNotToUse={[
          "Standard lightweight, highly-scalable I/O endpoints (like returning a user profile or configuration metadata).",
          "When autoscaling (such as Kubernetes KEDA or serverless scaling) is configured to handle the load dynamically.",
          "Where client-side queuing or throttling is already implemented and sufficient.",
        ]}
      />
      <p>Each request:</p>
      <ul>
        <li>
          tries to acquire a slot from a per-bucket semaphore (
          <code>maxConcurrent</code>);
        </li>
        <li>
          if all slots are busy, waits in a bounded FIFO queue (
          <code>maxQueue</code>) for up to <code>queueTimeoutMs</code>;
        </li>
        <li>
          is rejected with a fast <code>503 Service Unavailable</code> (+{" "}
          <code>Retry-After</code>) once the queue is full or the wait times
          out;
        </li>
        <li>
          releases its slot when the response is finalized: on success, error,
          and short-circuit paths alike, so a slot is never leaked.
        </li>
      </ul>

      <FlowDiagram
        title="Acquire, queue, or shed"
        steps={[
          {
            label: "Incoming request",
            detail: "bucket key from scope: global / route / client / fn",
            eyebrow: "request",
          },
          {
            label: "Slot free?",
            detail: "per-bucket semaphore (maxConcurrent)",
            tone: "accent",
          },
          {
            label: "Run handler",
            detail: "slot released on success, error, and short-circuit",
            tone: "success",
          },
          {
            label: "Full -> wait in FIFO queue",
            detail: "up to maxQueue, for up to queueTimeoutMs",
          },
          {
            label: "Queue full / timed out -> shed",
            detail: "503 + Retry-After; onReject(queue-full | queue-timeout)",
            tone: "danger",
          },
        ]}
        caption="A request acquires a slot from the per-bucket semaphore, waits in a bounded FIFO queue if every slot is busy, and is shed with a fast 503 once the queue is full or the wait times out. The slot is always released when the response finalizes, so a slot is never leaked."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { App, concurrencyLimit } from "@daloyjs/core";

const app = new App();

// At most 100 in flight per route, queue up to 50 more, wait at most 2s.
app.use(concurrencyLimit({
  maxConcurrent: 100,
  maxQueue: 50,
  queueTimeoutMs: 2000,
  scope: "route",
}));`}
      />

      <h2 id="scopes">Scopes</h2>
      <p>
        <code>scope</code> decides how the concurrency budget is partitioned:
      </p>
      <ul>
        <li>
          <code>&quot;global&quot;</code> (default): one shared budget across
          the whole mount.
        </li>
        <li>
          <code>&quot;route&quot;</code>
          {": "}a separate budget per <code>method + path</code>
          {", "}so one hot endpoint can&apos;t starve the others mounted under
          the same guard.
        </li>
        <li>
          <code>&quot;client&quot;</code>
          {": "}a separate budget per client identity (requires{" "}
          <code>trustProxyHeaders</code> or a <code>keyGenerator</code>), so a
          heavy client can&apos;t consume everyone else&apos;s slots.
        </li>
        <li>
          a <strong>function</strong>
          {": "}return a custom bucket key, or <code>undefined</code> to skip
          limiting for that request (fail-open).
        </li>
      </ul>
      <CodeBlock
        language="ts"
        code={`// Per-client fairness behind a trusted proxy.
app.use(concurrencyLimit({
  maxConcurrent: 10,
  maxQueue: 20,
  queueTimeoutMs: 1000,
  scope: "client",
  trustProxyHeaders: true,
}));

// Custom partition (e.g. per API tenant); undefined => unlimited.
app.use(concurrencyLimit({
  maxConcurrent: 50,
  scope: (ctx) => ctx.state.tenantId as string | undefined,
}));`}
      />

      <h2 id="no-queue-vs-queue">No queue vs. queue</h2>
      <p>
        With the default <code>maxQueue: 0</code>
        {", "}an overflowing request is rejected <em>immediately</em> with{" "}
        <code>503</code>
        {", "}useful when you prefer fast failure over added latency. Set{" "}
        <code>maxQueue</code> to absorb short bursts, and pair it with{" "}
        <code>queueTimeoutMs</code> to bound tail latency so a waiting request
        doesn&apos;t hang indefinitely.
      </p>
      <CodeBlock
        language="ts"
        code={`// Fail fast, no waiting.
app.use(concurrencyLimit({ maxConcurrent: 200 }));

// Absorb bursts, but never wait longer than 500ms.
app.use(concurrencyLimit({
  maxConcurrent: 200,
  maxQueue: 100,
  queueTimeoutMs: 500,
}));`}
      />

      <h2 id="observability">Observability</h2>
      <p>
        <code>onReject</code> fires whenever a request is turned away, with the
        bucket key, the reason (<code>&quot;queue-full&quot;</code> or{" "}
        <code>&quot;queue-timeout&quot;</code>), and the live active / queued
        counts:
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(concurrencyLimit({
  maxConcurrent: 100,
  maxQueue: 50,
  queueTimeoutMs: 2000,
  scope: "route",
  onReject: ({ key, reason, active, queued }) => {
    metrics.increment("concurrency.rejected", { key, reason });
    logger.warn({ key, reason, active, queued }, "request shed by concurrencyLimit");
  },
}));`}
      />

      <h2 id="customizing-the-503">Customizing the 503</h2>
      <CodeBlock
        language="ts"
        code={`app.use(concurrencyLimit({
  maxConcurrent: 100,
  retryAfterSeconds: 5,           // default 1; set 0 to omit the header
  message: "Server is busy, please retry shortly.",
}));`}
      />

      <h2 id="how-it-complements-the-rest-of-the-stack">
        How it complements the rest of the stack
      </h2>
      <ul>
        <li>
          <strong>
            <code>maxConnections</code>
          </strong>{" "}
          (Node adapter): rejects surplus <em>sockets</em> at accept time (L4
          admission).
        </li>
        <li>
          <strong>
            <code>loadShedding()</code>
          </strong>{" "}
          sheds traffic when the <em>process</em> is under pressure (event-loop
          delay, heap, RSS).
        </li>
        <li>
          <strong>
            <code>concurrencyLimit()</code>
          </strong>{" "}
          bounds <em>in-flight requests</em> per route / client with queueing
          (L7 fairness + backpressure).
        </li>
        <li>
          <strong>
            <code>rateLimit()</code>
          </strong>{" "}
          bounds <em>request rate</em> over time per client.
        </li>
      </ul>
      <p>
        They stack cleanly: admission cap → process shedding → concurrency
        fairness → rate limiting.
      </p>
    </>
  );
}
