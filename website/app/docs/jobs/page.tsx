import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Background jobs (queue-agnostic)",
  description:
    "Enqueue JSON jobs after the HTTP response. JobStore SPI, MemoryJobStore for tests, a leased worker with retries and dead letters, and cronEnqueue for cluster-wide schedules. Zero runtime dependencies. Redis, Postgres, and SQS adapters live in your app.",
  path: "/docs/jobs",
  keywords: [
    "background jobs",
    "job queue",
    "queue-agnostic",
    "JobStore SPI",
    "DaloyJS jobs",
    "cronEnqueue",
    "at-least-once delivery",
    "job idempotency key",
    "job worker leases",
    "retry backoff dead letter",
    "Redis Postgres job adapter",
    "serverless enqueue",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Background jobs (queue-agnostic)</h1>
      <p>
        DaloyJS ships a background-job interface. Work that must outlive the
        HTTP request (and maybe the process) becomes a named handler plus a
        JSON payload, persisted behind a <code>JobStore</code> SPI and run by
        a leased worker with bounded retries. It is the durable counterpart to{" "}
        <Link href="/docs/scheduler">in-process cron</Link>, with zero runtime
        dependencies.
      </p>
      <ul>
        <li>
          <strong>Idempotent enqueue.</strong> A{" "}
          <code>(queue, idempotencyKey)</code> pair is unique. Retried
          producers (a client that re-POSTs, a cron tick firing on 8 replicas)
          collapse into one job instead of eight side effects.
        </li>
        <li>
          <strong>At-least-once worker.</strong> Atomic claims with leases and
          heartbeats, retries with full-jitter backoff, per-attempt timeouts,
          and a dead-letter state for poison jobs. Graceful shutdown drains
          in-flight work.
        </li>
        <li>
          <strong>Bring your own durability.</strong>{" "}
          <code>MemoryJobStore</code> covers tests and single-process dev.
          Production plugs Redis, Postgres, or a cloud queue in through the
          same SPI, as application code. DaloyJS never takes a storage
          dependency.
        </li>
      </ul>

      <div className="not-prose my-6 rounded-lg border border-primary/30 bg-primary/[0.05] p-4">
        <p className="text-sm leading-6 font-semibold text-foreground">
          Boundary with Temporal, Inngest, and Eve
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          A job is <code>{"{ name, payload }"}</code> plus a store. It does
          not checkpoint, sleep for days, or park a workflow, so{" "}
          <code>await sleep(&quot;7 days&quot;)</code> in the middle of a
          function is out of scope. If the same TypeScript function must pause
          for hours and resume, use{" "}
          <a
            href="https://temporal.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Temporal
          </a>
          {", "}
          <a
            href="https://www.inngest.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Inngest
          </a>
          {", "}or Eve, and keep DaloyJS as the HTTP API in front of it. A
          handler that enqueues the next job is a job chain. Sagas with
          compensations belong in a workflow engine.
        </p>
      </div>

      <p>
        The companion post{" "}
        <Link href={"/blog/background-jobs-after-the-http-response" as Route}>
          Background Jobs After the HTTP Response
        </Link>{" "}
        covers the design argument. This page is the reference.
      </p>

      <FlowDiagram
        title="One job, start to finish"
        numbered
        steps={[
          {
            label: "Enqueue",
            detail: "HTTP handler / cron tick / another job",
            eyebrow: "produce",
          },
          {
            label: "JobStore.put",
            detail: "durable record, idempotency key checked",
            eyebrow: "persist",
          },
          {
            label: "Claim",
            detail: "atomic lease, lockedBy = workerId",
            eyebrow: "consume",
            tone: "accent",
          },
          {
            label: "Handler runs",
            detail: "ctx: job, signal, attempt, heartbeat, log",
          },
          {
            label: "Completed",
            detail: "terminal, optional result stored",
            tone: "success",
          },
          {
            label: "Dead",
            detail: "fatal error or attempts spent",
            tone: "danger",
          },
        ]}
        caption="A retry loops from the handler back to a delayed re-claim with full-jitter backoff. If the process dies after the handler succeeded but before complete is persisted, the lease expires and another worker runs the job again. Delivery is at-least-once, so handlers must be idempotent."
      />

      <h2 id="quick-start">Quick start</h2>
      <p>
        Mount jobs with <code>app.useJobs()</code>. That creates the queue,
        optionally starts an in-process worker, and registers the
        graceful-shutdown drain. In-flight jobs get the grace period, then
        their <code>AbortSignal</code> fires and they fail back to the queue
        for another worker to claim.
      </p>
      <CodeBlock
        language="ts"
        code={`import { createApp, MemoryJobStore, jobIdempotencyKey } from "@daloyjs/core";

const app = createApp();

app.useJobs({
  // Tests / single-process dev. Production: your Redis/Postgres JobStore adapter.
  store: new MemoryJobStore(),
  handlers: {
    "email.welcome": async ({ job, signal }) => {
      const { to, locale } = job.payload as { to: string; locale: string };
      await sendWelcomeEmail(to, locale, { signal }); // your mailer
    },
  },
  startWorker: true, // this process also claims and runs jobs
});

app.post("/users", contract, async (ctx) => {
  const user = await db.insertUser(ctx.body); // commit FIRST, then enqueue
  await app.jobs!.enqueue({
    name: "email.welcome",
    payload: { userId: user.id, to: user.email, locale: user.locale },
    tenant: ctx.state.tenant,
    idempotencyKey: jobIdempotencyKey({
      tenant: ctx.state.tenant,
      name: "email.welcome",
      key: user.id, // a duplicate of this request never double-sends
    }),
  });
  return { status: 201 as const, body: user };
});`}
      />
      <p>
        Without an <code>App</code> (scripts, dedicated worker binaries,
        tests), drive the primitives directly. <code>worker.runOnce()</code>{" "}
        claims and settles one job, so tests stay deterministic without
        timers or Redis:
      </p>
      <CodeBlock
        language="ts"
        code={`import {
  createJobQueue,
  createJobWorker,
  MemoryJobStore,
} from "@daloyjs/core/jobs";

const queue = createJobQueue({ store: new MemoryJobStore() });
const worker = createJobWorker({
  queue,
  handlers: {
    "email.welcome": async ({ job }) => {
      const { to } = job.payload as { to: string };
      await sendWelcomeEmail(to, "en");
    },
  },
});

const { job, duplicate } = await queue.enqueue({
  name: "email.welcome",
  payload: { to: "ada@example.com" },
});

await worker.runOnce(); // true: claimed, ran, completed
(await queue.get(job.id))?.status; // "completed"`}
      />
      <p>
        A runnable end-to-end version of this flow (dedupe, a transient
        failure that succeeds on retry, graceful stop) ships in the repo as{" "}
        <code>examples/jobs-basic.ts</code>.
      </p>

      <h2 id="when-to-use">When to use</h2>
      <p>
        Jobs are for work that must survive the HTTP request, or the process.
        If the work fits in the request, do not enqueue.
      </p>
      <CodeBlock
        language="text"
        code={`Does the client need the result to build the HTTP response?
  YES -> do it in the handler (maybe resilientFetch). Not a job.
  NO  -> would losing this work on process crash / deploy be unacceptable?
          NO  -> in-process is fine (handler fire-and-forget or app.cron).
          YES -> can it be one named function + JSON payload, retried as a whole?
                  NO  -> workflow engine (Temporal / Inngest / Eve). Daloy stays the API.
                  YES -> JOBS (this feature).`}
      />
      <ul>
        <li>
          <strong>Now, in this request.</strong> Handler.
        </li>
        <li>
          <strong>Now, in this process, on a clock.</strong>{" "}
          <code>app.cron()</code>
        </li>
        <li>
          <strong>Eventually, even if this process dies.</strong>{" "}
          <code>jobs.enqueue</code>
        </li>
        <li>
          <strong>Same function must pause for hours and resume.</strong>{" "}
          Temporal, Inngest, or Eve. Daloy stays the HTTP API.
        </li>
      </ul>
      <p>A job is worth it when most of these hold:</p>
      <ol>
        <li>
          The HTTP response can succeed without the side effect having
          finished (email, webhook fan-out, thumbnail, search index, PDF,
          analytics).
        </li>
        <li>
          The side effect may fail transiently (SMTP 421, Stripe 429, a 503
          from Azure OpenAI) and should retry with backoff.
        </li>
        <li>
          A deploy, OOM, or rolling update must not drop the work.
        </li>
        <li>
          The unit of work is one handler, or you are willing to enqueue the
          next job at the end of this one (a job chain).
        </li>
        <li>
          Duplicate runs are safe because you pass an idempotency key through
          to the downstream API (delivery is at-least-once).
        </li>
        <li>
          The runtime is mixed: an API on Lambda/Workers cannot finish a
          two-minute PDF, but a Node worker pool can.
        </li>
      </ol>

      <h3 id="when-not-to-use">When not to use</h3>
      <table>
        <thead>
          <tr>
            <th>Situation</th>
            <th>Use instead</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Need the result in the <code>200</code> body (quote a price,
              login, GET by id)
            </td>
            <td>
              Handler, maybe with <code>responseCache</code> /{" "}
              <code>idempotency</code>
            </td>
          </tr>
          <tr>
            <td>Client retries the same POST (payments)</td>
            <td>
              <Link href="/docs/idempotency">
                <code>idempotency()</code>
              </Link>{" "}
              middleware, or both: HTTP idempotency <em>and</em> a job key
            </td>
          </tr>
          <tr>
            <td>
              Deliver <em>this</em> webhook before <code>send()</code>{" "}
              returns, few retries
            </td>
            <td>
              <Link href="/docs/webhook-delivery">
                <code>createWebhookSender()</code>
              </Link>
            </td>
          </tr>
          <tr>
            <td>
              Sweep <em>this process&apos;s</em> memory cache every 60s
            </td>
            <td>
              <code>app.cron()</code>
            </td>
          </tr>
          <tr>
            <td>Multi-replica global nightly sweep</td>
            <td>
              <code>cronEnqueue</code> → job (not raw <code>cron</code>)
            </td>
          </tr>
          <tr>
            <td>
              Human approval in two days, then continue the same function
            </td>
            <td>Temporal / Eve / Inngest</td>
          </tr>
          <tr>
            <td>
              Multi-step saga with compensations (charge, then book, then
              email, and undo the charge if book fails)
            </td>
            <td>
              Workflow engine, or an explicit job chain plus your own
              compensation jobs.
            </td>
          </tr>
          <tr>
            <td>CPU-heavy ML inference / GPU</td>
            <td>Separate service. The job can call it.</td>
          </tr>
          <tr>
            <td>Huge blobs (video files)</td>
            <td>
              Object-storage URL in the payload. The job processes the URL.
              Payloads cap at 64 KiB.
            </td>
          </tr>
          <tr>
            <td>Exactly-once banking ledger</td>
            <td>
              Database transaction + an outbox table you own. The job consumer
              is still at-least-once
            </td>
          </tr>
          <tr>
            <td>Request-scoped rate limit / concurrency</td>
            <td>
              <code>rateLimit</code> / <code>concurrencyLimit</code>
            </td>
          </tr>
          <tr>
            <td>Run the worker loop on Cloudflare Workers isolates</td>
            <td>
              You can <strong>enqueue</strong> to a remote store from Workers.
              Do not poll there in v1.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="where-it-runs">Where it runs</h2>
      <p>
        The queue is producer-only and needs no timers, so any runtime can
        enqueue. The worker is a poll loop, so it belongs where a long-lived
        process exists.
      </p>
      <table>
        <thead>
          <tr>
            <th>Environment</th>
            <th>Enqueue</th>
            <th>Worker</th>
            <th>Store</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Unit tests</td>
            <td>yes</td>
            <td>
              <code>runOnce()</code>
            </td>
            <td>Memory</td>
          </tr>
          <tr>
            <td>
              <code>daloy dev</code> single process
            </td>
            <td>yes</td>
            <td>optional in-process</td>
            <td>Memory</td>
          </tr>
          <tr>
            <td>1× Node VM, small prod</td>
            <td>yes</td>
            <td>in-process OK</td>
            <td>Redis/Postgres</td>
          </tr>
          <tr>
            <td>Kubernetes, many pods</td>
            <td>API pods</td>
            <td>dedicated worker pods</td>
            <td>Redis/Postgres</td>
          </tr>
          <tr>
            <td>Lambda / Workers</td>
            <td>yes</td>
            <td>
              <strong>separate</strong> Node service
            </td>
            <td>remote only</td>
          </tr>
          <tr>
            <td>Cloud queue already exists</td>
            <td>
              <code>put</code> adapter
            </td>
            <td>cloud consumer or Daloy worker</td>
            <td>SQS/Service Bus adapter</td>
          </tr>
        </tbody>
      </table>

      <h3 id="topology-a">A. Local dev / CI (always Memory)</h3>
      <p>
        One Node process: <code>MemoryJobStore</code> +{" "}
        <code>createJobWorker</code> + <code>runOnce()</code> in tests, or{" "}
        <code>startWorker: true</code> while developing. Use this for unit
        and integration tests. The store dies with the process, so it is not
        production-durable.
      </p>

      <h3 id="topology-b">B. Single VPS / one replica (small prod)</h3>
      <p>
        One long-lived Node process serves HTTP and runs the worker (
        <code>useJobs({"{ startWorker: true }"})</code>). That is fine when
        side effects are light and brief deploy downtime is acceptable, if
        the store is Redis or Postgres so jobs survive the restart. Do not
        run Memory in production. <code>useJobs</code> logs a warning.{" "}
        <code>strictProduction: true</code> refuses to boot. Prefer{" "}
        <code>cronEnqueue</code> over <code>cron</code> for side effects, so a
        second process cannot double-send.
      </p>

      <h3 id="topology-c">C. Kubernetes (AKS)</h3>
      <p>
        Deployment <code>api</code>: N pods, enqueue only (
        <code>startWorker: false</code>). Deployment <code>worker</code>: M
        pods, claim and run (<code>startWorker: true</code>, no public
        ingress). The store is Azure Cache for Redis or Azure Database for
        PostgreSQL through a <code>JobStore</code> adapter in your repo.
        Core does not ship that adapter. Ingress exposes only <code>api</code>.
        Workers need egress
        to the store plus SMTP, Stripe, or OpenAI. Set{" "}
        <code>terminationGracePeriodSeconds</code> above the worker&apos;s{" "}
        <code>stop(graceMs)</code> so SIGTERM drains instead of killing
        in-flight jobs.
      </p>

      <h3 id="topology-d">D. Serverless API + always-on worker</h3>
      <p>
        Vercel, Lambda, or Cloudflare handlers enqueue to a remote store,
        then the isolate dies. A Node container (Container Apps, a VM,
        Fly.io) runs the worker. Do not set <code>startWorker: true</code> on
        Lambda or Workers in v1. Isolates are the wrong place for a poll
        loop.
      </p>

      <h3 id="topology-e">E. The queue is SQS / Service Bus already</h3>
      <p>
        A <code>JobStore</code> adapter maps <code>put</code> → send message,{" "}
        <code>claim</code> → receive + visibility timeout,{" "}
        <code>complete</code> → delete, <code>fail</code> → native retry/DLQ.
        If Azure Functions or another consumer already drains the queue,
        DaloyJS can be producer-only. The worker is optional.
      </p>

      <h3 id="topology-f">F. Multi-tenant SaaS</h3>
      <p>
        Every enqueue sets <code>tenant</code> and builds its key with{" "}
        <code>jobIdempotencyKey({"{ tenant, name, key }"})</code>, so two
        tenants cannot collide on the same natural key. Share one{" "}
        <code>queue: &quot;mail&quot;</code> with the tenant field on the
        record, or partition at the broker with a per-tenant queue name when
        isolation demands it. Jobs are not HTTP, so pass{" "}
        <code>ctx.state.tenant</code> explicitly. Nothing reads it for you.
      </p>

      <div className="not-prose my-6 rounded-lg border bg-muted/30 p-4">
        <p className="text-sm leading-6 font-semibold text-foreground">
          Example: AKS + Redis layout
        </p>
        <p className="mt-1 mb-3 text-sm leading-6 text-muted-foreground">
          DaloyJS is not Azure-specific. This is the sketch teams ask for.
          Secrets come from Key Vault into env on both deployments. Workload
          identity lives in your handler (Graph, Azure OpenAI). Jobs do not
          implement Entra.
        </p>
        <CodeBlock
          language="text"
          code={`Deployment/api     replicas: N   startWorker: false   PORT 3000 (public ingress)
Deployment/worker  replicas: M   startWorker: true    no public Service
Secret             DATABASE_URL / REDIS_URL (Key Vault -> env, both deployments)
Clock              ONE K8s CronJob -> authenticated POST that enqueues,
                   or cronEnqueue on the api pods (duplicate ticks collapse
                   into one job via the per-slot idempotency key)`}
        />
      </div>

      <h2 id="delivery-semantics">Delivery is at-least-once</h2>
      <p>
        A job is delivered at least once. The worker claims a record with an
        atomic lease (<code>lockedBy</code> + <code>leaseUntil</code>), runs
        your handler, then marks it complete. If the process dies between
        &ldquo;handler succeeded&rdquo; and &ldquo;complete persisted&rdquo;,
        the lease expires and another worker runs the handler again. Two
        enqueues with the same idempotency key and a deep-equal payload
        return one job (<code>duplicate: true</code>). The same key with a
        different payload throws <code>JobIdempotencyConflictError</code>.
      </p>
      <p>
        Handlers must be idempotent. For side effects that move money or send
        messages, pass a key through to the downstream API so a duplicate run
        is a no-op there. With Stripe, that is the{" "}
        <code>Idempotency-Key</code> header. The Daloy job key and the Stripe
        key should be the same natural value.
      </p>
      <CodeBlock
        language="ts"
        code={`import { JobFatalError } from "@daloyjs/core/jobs";

const worker = createJobWorker({
  queue,
  handlers: {
    // You already returned 201 for the order; capture happens here.
    "payments.capture": async ({ job, signal }) => {
      const { orderId } = job.payload as { orderId: string };
      const order = await db.getOrder(orderId);
      if (!order) throw new JobFatalError("order vanished: " + orderId); // no retry
      await stripe.paymentIntents.create(
        { amount: order.totalCents, currency: order.currency, confirm: true },
        { idempotencyKey: orderId }, // Stripe dedupes retries of THIS job
      );
      // Forward ctx.signal to any fetch-based I/O so timeouts unwind promptly.
    },
  },
});`}
      />
      <p>
        Long-running handlers get a heartbeat: the worker extends the lease
        every <code>leaseMs / 3</code> automatically, and{" "}
        <code>ctx.heartbeat()</code> extends it manually. If the lease is
        lost (another worker fenced it), the handler&apos;s{" "}
        <code>signal</code> aborts so it stops touching the job. Keep{" "}
        <code>leaseMs</code> above your slowest expected attempt so the
        automatic heartbeat can keep the lease.
      </p>

      <h2 id="status-machine">Job status machine</h2>
      <CodeBlock
        language="text"
        code={`delayed  --(runAt <= now)----------> queued
queued   --claim--------------------> running
running  --complete-----------------> completed  (terminal)
running  --fail, attempts < max-----> delayed (runAt = now + backoff) or queued
running  --fail, attempts >= max----> dead       (terminal)
running  --JobFatalError------------> dead       (terminal)
running  --lease expired------------> queued     (attempts +1: poison handlers
                                                  cannot loop forever uncounted)
queued / delayed / running --cancel-> cancelled  (terminal)
completed / dead / cancelled: no transitions`}
      />
      <p>
        Terminal records are not deleted on the spot.{" "}
        <code>completed</code>/<code>cancelled</code> are retained 24h and{" "}
        <code>dead</code> 7d (for inspection) by default, swept lazily on
        mutating operations. A dead job keeps its <code>lastError</code>{" "}
        message. Wire <code>onDead</code> to your alerting.
      </p>

      <h2 id="api-reference">API reference</h2>
      <p>
        Everything lives at <code>@daloyjs/core/jobs</code> and is re-exported
        from <code>@daloyjs/core</code>.
      </p>

      <h3 id="api-create-job-queue">
        <code>createJobQueue(options)</code>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>store</code> (required)
            </td>
            <td></td>
            <td>
              The <code>JobStore</code> persistence backend.{" "}
              <code>MemoryJobStore</code> for tests / single process.
            </td>
          </tr>
          <tr>
            <td>
              <code>payloadMaxBytes</code>
            </td>
            <td>65536</td>
            <td>
              Max UTF-8 bytes of a serialized payload (and of a completion
              result). Jobs are not a blob store.
            </td>
          </tr>
          <tr>
            <td>
              <code>defaultQueue</code>
            </td>
            <td>
              <code>&quot;default&quot;</code>
            </td>
            <td>Partition used when enqueue omits <code>queue</code>.</td>
          </tr>
          <tr>
            <td>
              <code>defaultMaxAttempts</code>
            </td>
            <td>5</td>
            <td>Default starts before dead-letter.</td>
          </tr>
          <tr>
            <td>
              <code>defaultTimeoutMs</code>
            </td>
            <td>30000</td>
            <td>Per-attempt timeout.</td>
          </tr>
          <tr>
            <td>
              <code>defaultLeaseMs</code>
            </td>
            <td>30000</td>
            <td>Lease granted per claim.</td>
          </tr>
          <tr>
            <td>
              <code>backoff</code>
            </td>
            <td>200ms → 60s, full jitter</td>
            <td>
              <code>
                {"{ baseDelayMs?, maxDelayMs?, random? }"}
              </code>{" "}
              retry policy. <code>random</code> is injectable for tests.
            </td>
          </tr>
          <tr>
            <td>
              <code>logger</code>, <code>now</code>
            </td>
            <td></td>
            <td>Structured logger. Injectable clock for deterministic tests.</td>
          </tr>
        </tbody>
      </table>

      <h3 id="api-enqueue-options">
        <code>queue.enqueue(options)</code>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>name</code> (required)
            </td>
            <td></td>
            <td>
              Handler registry key. Charset{" "}
              <code>^[a-zA-Z][a-zA-Z0-9._:-]{"{0,127}"}$</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>payload</code> (required)
            </td>
            <td></td>
            <td>
              Plain JSON only. Prototype-pollution keys (
              <code>__proto__</code>, <code>constructor</code>,{" "}
              <code>prototype</code>) are rejected, never stripped.
            </td>
          </tr>
          <tr>
            <td>
              <code>idempotencyKey</code>
            </td>
            <td></td>
            <td>
              Unique per queue. Same key + deep-equal payload returns{" "}
              <code>{"{ job, duplicate: true }"}</code>. Different payload
              throws. Build tenant-safe keys with{" "}
              <code>jobIdempotencyKey</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>queue</code>
            </td>
            <td>
              <code>&quot;default&quot;</code>
            </td>
            <td>Named partition.</td>
          </tr>
          <tr>
            <td>
              <code>runAt</code> / <code>delayMs</code>
            </td>
            <td>now</td>
            <td>
              Absolute earliest claim time, or a relative delay (ignored when{" "}
              <code>runAt</code> is set). Future times start as{" "}
              <code>delayed</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>priority</code>
            </td>
            <td>0</td>
            <td>Claim ordering: higher first.</td>
          </tr>
          <tr>
            <td>
              <code>maxAttempts</code>
            </td>
            <td>5</td>
            <td>Starts before dead-letter.</td>
          </tr>
          <tr>
            <td>
              <code>timeoutMs</code>
            </td>
            <td>30000</td>
            <td>
              Per-attempt timeout. Aborts the handler&apos;s{" "}
              <code>signal</code>. <code>0</code> disables (dangerous).
            </td>
          </tr>
          <tr>
            <td>
              <code>leaseMs</code>
            </td>
            <td>30000</td>
            <td>Lease duration per claim.</td>
          </tr>
          <tr>
            <td>
              <code>tenant</code>
            </td>
            <td></td>
            <td>
              Tenant discriminator copied onto the record for partitioning
              and logs. This is a data partition field. It is not authorization.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Also on the queue: <code>queue.get(id)</code> reads one job,{" "}
        <code>queue.cancel(id)</code> cancels a non-terminal job.
      </p>

      <h3 id="api-create-job-worker">
        <code>createJobWorker(options)</code>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>queue</code> (required)
            </td>
            <td></td>
            <td>The <code>JobQueue</code> to claim from.</td>
          </tr>
          <tr>
            <td>
              <code>handlers</code> (required)
            </td>
            <td></td>
            <td>
              Name → handler map, frozen at construction. Unknown job names
              dead-letter as poison pills. No dynamic registration, no{" "}
              <code>import(job.name)</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>queues</code>
            </td>
            <td>
              <code>[queue.defaultQueue]</code>
            </td>
            <td>Partitions to claim from, in order.</td>
          </tr>
          <tr>
            <td>
              <code>concurrency</code>
            </td>
            <td>1</td>
            <td>Max jobs run in parallel (soft warn above 32).</td>
          </tr>
          <tr>
            <td>
              <code>pollIntervalMs</code>
            </td>
            <td>200</td>
            <td>Idle poll cadence.</td>
          </tr>
          <tr>
            <td>
              <code>workerId</code>
            </td>
            <td>random UUID</td>
            <td>
              Fencing identity written to <code>lockedBy</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>onDead</code>, <code>onComplete</code>, <code>onFail</code>
            </td>
            <td></td>
            <td>Lifecycle callbacks. Wire <code>onDead</code> to alerting.</td>
          </tr>
          <tr>
            <td>
              <code>timers</code>, <code>now</code>, <code>logger</code>
            </td>
            <td></td>
            <td>Injectable primitives, same shape as the Scheduler.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Worker methods: <code>start()</code> begins the poll loop,{" "}
        <code>stop(graceMs?)</code> drains in-flight jobs then aborts
        stragglers (they fail back to the queue), <code>runOnce()</code>{" "}
        settles one job (tests), <code>getState()</code> reports{" "}
        <code>{"{ running, inFlight, workerId }"}</code>.
      </p>

      <h3 id="api-memory-job-store">
        <code>MemoryJobStore</code>
      </h3>
      <p>
        A correct, full implementation of the SPI for tests and
        single-process apps. It is not durable across processes and is
        invisible to other replicas. <code>useJobs</code> warns when it sees
        this store with production config. Payloads are serialized and
        re-parsed with the prototype-pollution-safe parser on every read, and
        returned as deep copies, so callers cannot mutate store state.
        Options: <code>capacity</code> (10,000 jobs, overflow sweeps expired
        terminal records then throws <code>store_full</code> without evicting
        queued work), <code>retentionMs</code> (24h for
        completed/cancelled), <code>deadRetentionMs</code> (7d), and an
        injectable <code>now</code>. Adds <code>list(filter)</code> and{" "}
        <code>dump()</code> for test inspection.
      </p>

      <h3 id="api-errors">Errors</h3>
      <table>
        <thead>
          <tr>
            <th>Error</th>
            <th>Thrown when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>JobConfigError</code>
            </td>
            <td>
              Config or enqueue-time rejection, nothing persisted. Codes:{" "}
              <code>invalid_name</code>, <code>invalid_payload</code>,{" "}
              <code>payload_too_large</code>, <code>invalid_option</code>,{" "}
              <code>unknown_handler</code>, <code>store_required</code>,{" "}
              <code>store_full</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>JobIdempotencyConflictError</code>
            </td>
            <td>
              An idempotency key was reused with a different payload
              fingerprint.
            </td>
          </tr>
          <tr>
            <td>
              <code>JobFatalError</code>
            </td>
            <td>
              Throw inside a handler for permanent failure: the job
              dead-letters immediately, no retry.
            </td>
          </tr>
          <tr>
            <td>
              <code>JobTimeoutError</code>
            </td>
            <td>
              A per-attempt <code>timeoutMs</code> elapsed. Retried like any
              other throw.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="cron-vs-jobs">
        <code>cron</code> vs <code>cronEnqueue</code> vs jobs
      </h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>
              <code>app.cron()</code>
            </th>
            <th>
              <code>app.cronEnqueue()</code>
            </th>
            <th>
              <code>jobs.enqueue()</code>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Clock-driven</td>
            <td>yes</td>
            <td>yes</td>
            <td>no (you enqueue)</td>
          </tr>
          <tr>
            <td>Work runs</td>
            <td>in this process</td>
            <td>on any worker</td>
            <td>on any worker</td>
          </tr>
          <tr>
            <td>Survives restart</td>
            <td>re-fires next tick</td>
            <td>yes (job persisted)</td>
            <td>yes (job persisted)</td>
          </tr>
          <tr>
            <td>Once, cluster-wide</td>
            <td>no (per-process timers)</td>
            <td>yes (per-slot key)</td>
            <td>yes (with a key)</td>
          </tr>
          <tr>
            <td>Use for</td>
            <td>
              Process-local maintenance: cache sweeps, token refresh
            </td>
            <td>
              Global scheduled side effects: nightly reconcile, digest mail
            </td>
            <td>Side effects offloaded from a request</td>
          </tr>
        </tbody>
      </table>
      <p>
        <code>cronEnqueue</code> registers a scheduler task whose tick
        enqueues a job instead of running the side effect in-process:
      </p>
      <CodeBlock
        language="ts"
        code={`app.cronEnqueue(
  { name: "nightly-reconcile", cron: "0 2 * * *" },
  { name: "ops.reconcile", payload: {} },
);
// Every replica may tick. The derived idempotency key
// "cron:nightly-reconcile:<schedule slot>" is identical on all of them,
// so 8 ticks collapse into 1 job and exactly 1 worker runs it.
// Requires app.useJobs() first; it throws store_required at registration
// otherwise, not silently at the first tick.`}
      />
      <p>
        Sweeping <em>this</em> isolate&apos;s{" "}
        <code>MemoryResponseCacheStore</code> must stay{" "}
        <code>app.cron()</code>, because other replicas have their own
        memory. A job would run on one random worker and sweep the wrong
        process&apos;s cache.
      </p>

      <h2 id="production-stores">Production stores and the JobStore SPI</h2>
      <p>
        All durability lives behind <code>JobStore</code>. DaloyJS ships the
        SPI and the Memory implementation. Redis, Postgres, SQS, and similar
        backends are adapters in your repository, so the core keeps zero
        runtime dependencies and your queue choice stays yours. Each method
        owes this atomicity:
      </p>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Contract</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>put(job, fingerprint)</code>
            </td>
            <td>
              Insert. Idempotency key present and seen: return the existing
              job with <code>duplicate: true</code> (first writer wins, even
              if terminal). If the fingerprint differs, throw{" "}
              <code>JobIdempotencyConflictError</code>. Must be atomic.
            </td>
          </tr>
          <tr>
            <td>
              <code>claim(queue, workerId, now)</code>
            </td>
            <td>
              Atomically pick the next runnable job in this queue (highest
              priority, then oldest), set <code>running</code> + lease +
              owner, increment <code>attempts</code>. Two concurrent claims
              must never hand out the same job. <code>null</code> when idle.
            </td>
          </tr>
          <tr>
            <td>
              <code>heartbeat(id, workerId, leaseUntil, now)</code>
            </td>
            <td>
              Extend the lease while still owned. <code>false</code> means the
              lease was lost. The caller must stop touching the job.
            </td>
          </tr>
          <tr>
            <td>
              <code>complete(id, workerId, now, result)</code>
            </td>
            <td>
              Mark <code>completed</code> (terminal), storing an optional
              result. <code>false</code> when the lease was lost.
            </td>
          </tr>
          <tr>
            <td>
              <code>fail(id, workerId, error, next, now)</code>
            </td>
            <td>
              Apply <code>next</code>: requeue <code>delayed</code>/
              <code>queued</code>, or <code>dead</code> when the attempt
              budget is spent. <code>false</code> when the lease was lost.
            </td>
          </tr>
          <tr>
            <td>
              <code>cancel(id, now)</code>
            </td>
            <td>Cancel a non-terminal job. Terminal returns false.</td>
          </tr>
          <tr>
            <td>
              <code>get(id, now)</code>
            </td>
            <td>
              Read one job. Reap an expired lease lazily before the snapshot.
            </td>
          </tr>
          <tr>
            <td>
              <code>list?(filter)</code>
            </td>
            <td>
              Optional filtered listing (queue/status/name/tenant). Required
              on Memory for tests. Production adapters may omit it.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        A Redis adapter is application code. The sketch below is docs-only
        (implement <code>JobStore</code>, DaloyJS does not ship Redis):
      </p>
      <CodeBlock
        language="ts"
        code={`// src/jobs/redis-store.ts - application code, NOT shipped by DaloyJS.
// Illustrative sketch: bring your own redis client and own the atomics.
import type { EnqueueResult, Job, JobStore } from "@daloyjs/core/jobs";

export class RedisJobStore implements JobStore {
  constructor(private redis: RedisClient) {}

  async put(job: Job, fingerprint: string | null): Promise<EnqueueResult> {
    // Idempotency: SET queue:{q}:idem:{key} -> job.id NX.
    // On a hit, load the winner and compare fingerprints (conflict throws).
    // On a miss, HSET job:{id} and ZADD queue:{q} (score = runAt, priority).
    // One Lua script keeps the pair atomic.
    // ...
  }

  async claim(queue: string, workerId: string, now: number): Promise<Job | null> {
    // Lua: ZRANGEBYSCORE queue:{q} up to now -> HSET job:{id} status=running,
    // lockedBy=workerId, leaseUntil=now+leaseMs, attempts+1 -> ZREM.
    // The SET-lock equivalent: SET job:{id}:lock workerId PX leaseMs NX.
    // Also requeue records whose leaseUntil < now (lease-expired crashes).
    // ...
  }

  // heartbeat: extend PX only when the lock value is still workerId.
  // complete / fail / cancel: compare-lock, update hash, publish nothing.
  // get: HGETALL, then lazily requeue when leaseUntil < now.
}`}
      />
      <p>
        SQS / Service Bus adapters map even more directly: <code>put</code> is
        send-message, <code>claim</code> is receive with a visibility timeout,{" "}
        <code>complete</code> is delete, <code>fail</code> is the native
        redrive/DLQ policy.
      </p>

      <h2 id="recipes">Recipes</h2>
      <p>
        The recipes below cover the cases people hit first. Each names the
        job, the payload shape, the idempotency key, and the fatal-vs-retry
        split. The full list of fourteen is at the end of this section.
      </p>

      <h3 id="recipe-welcome-email">1. Welcome email after signup</h3>
      <p>
        Shown end to end in the <a href="#quick-start">quick start</a>. SMTP
        must not delay the 201. Payload is{" "}
        <code>{"{ userId, to, locale }"}</code>, never the password. Key per
        user id. Retry SMTP 4xx and timeouts. Throw{" "}
        <code>JobFatalError</code> on an unknown user or a permanent bounce.
      </p>

      <h3 id="recipe-webhook-202">2. Stripe (or any provider) webhook → 202 + job</h3>
      <p>
        Providers demand a fast 2xx and will disable endpoints that time out.
        Verify the signature, enqueue, and return 202. Entitlements and
        invoice work run in the worker.
      </p>
      <CodeBlock
        language="ts"
        code={`app.post("/webhooks/stripe", contract, async (ctx) => {
  const event = verifyStripeSignature(ctx); // your existing check, first
  await app.jobs!.enqueue({
    name: "billing.stripe_event",
    // The id and type, not the megabyte event body: the handler re-fetches
    // or reads your stored copy.
    payload: { providerEventId: event.id, type: event.type },
    idempotencyKey: jobIdempotencyKey({
      name: "billing.stripe_event",
      key: event.id, // Stripe event ids are already unique: provider retries
                     // of the webhook collapse into one job.
    }),
  });
  return { status: 202 as const, body: { received: true } };
});
// Handler: retry downstream 503s; JobFatalError on event types you refuse.`}
      />

      <h3 id="recipe-ai-202">9. LLM / Azure OpenAI batch → 202 + job id</h3>
      <p>
        A two-minute summarization cannot hold an API request, and cannot run
        on a Workers isolate at all. Return 202 with the job id and let the
        client poll a status route you write. DaloyJS mounts no{" "}
        <code>/jobs</code> HTTP API.
      </p>
      <CodeBlock
        language="ts"
        code={`app.post("/tickets/:id/summary", contract, async (ctx) => {
  const { job } = await app.jobs!.enqueue({
    name: "ai.summarize_ticket",
    payload: { ticketId: ctx.params.id }, // handler loads the text itself
    maxAttempts: 3,
    timeoutMs: 120_000,
    idempotencyKey: jobIdempotencyKey({
      name: "ai.summarize_ticket",
      key: ctx.params.id,
    }),
  });
  return { status: 202 as const, body: { jobId: job.id } };
});

// Handler: call Azure OpenAI with your credential + ctx.signal.
// Retry 429/5xx; JobFatalError on a 400 (bad prompt / policy).
// Status route (yours): GET /jobs/:id -> queue.get(id) -> { status, result }.`}
      />

      <h3 id="recipe-payment-capture">12. Idempotent payment capture off the request</h3>
      <p>
        Shown in <a href="#delivery-semantics">delivery semantics</a>. The
        order already returned 201, capture runs as a job, and the handler
        sends Stripe <code>Idempotency-Key: orderId</code> so retries of the
        job are no-ops at Stripe. The Daloy job key and the Stripe key are
        different systems. Set them to the same natural value so you never
        confuse the two.
      </p>

      <h3 id="recipe-cron-global">7. Nightly reconciliation, once, cluster-wide</h3>
      <p>
        Shown in <a href="#cron-vs-jobs">cron vs cronEnqueue</a>:{" "}
        <code>cronEnqueue</code> turns every replica&apos;s 02:00 tick into
        one idempotent enqueue. The key includes the calendar slot, so
        tonight&apos;s run never dedupes against tomorrow&apos;s.
      </p>

      <h3 id="recipe-cache-sweep">8. Process-local cache sweep</h3>
      <p>
        This stays on <code>app.cron()</code>. It sweeps <em>this</em>{" "}
        process&apos;s memory, and the other replicas sweep their own.
        Enqueueing this work would sweep one random worker&apos;s cache and
        leave the API pods dirty.
      </p>

      <h3 id="all-instances">All fourteen instances</h3>
      <ol>
        <li>
          <strong>Welcome email after <code>POST /users</code></strong>:
          payload <code>{"{ userId, to, locale }"}</code>. Key per user.
          Fatal on permanent bounce.
        </li>
        <li>
          <strong>Provider webhook processing</strong>: signature at HTTP, 202
          immediately. Payload <code>{"{ providerEventId, type }"}</code>.
          Key = provider event id.
        </li>
        <li>
          <strong>Outbound webhook that must live 24h</strong>:{" "}
          <code>webhook.deliver</code> with{" "}
          <code>{"{ url, eventType, bodyId }"}</code>. The handler calls{" "}
          <code>createWebhookSender()</code> once. <code>JobFatalError</code>{" "}
          when the sender dead-letters so you do not retry forever in two
          systems.
        </li>
        <li>
          <strong>Search reindex</strong>:{" "}
          <code>search.index_article</code> with{" "}
          <code>{"{ articleId }"}</code>. Key articleId + version (or
          last-write-wins in the handler). <code>delayMs: 500</code> coalesces
          bursts.
        </li>
        <li>
          <strong>Thumbnail / PDF / image variant</strong>:{" "}
          <code>media.derive</code> with{" "}
          <code>{"{ blobUrl, ownerId, variant }"}</code>, a URL on blob
          storage, never bytes. Fatal on unsupported MIME.
        </li>
        <li>
          <strong>Fan-out notifications</strong>: one domain event enqueues N
          jobs (<code>notify.email</code>, <code>notify.sms</code>) or one{" "}
          <code>notify.fanout</code> that enqueues children. That is a job
          chain.
        </li>
        <li>
          <strong>Nightly tenant reconciliation</strong>:{" "}
          <code>cronEnqueue</code> on 8 replicas, instead of{" "}
          <code>app.cron()</code>.
        </li>
        <li>
          <strong>Process-local cache sweep</strong>: <code>app.cron()</code>
        </li>
        <li>
          <strong>LLM batch off the API</strong>: 202 + job id. The client
          polls your status route.
        </li>
        <li>
          <strong>Graph / Entra invite user</strong>: <code>entra.invite</code>{" "}
          with <code>{"{ userId }"}</code>. Your 201 is the local user row.
          Fatal on 404 user deleted.
        </li>
        <li>
          <strong>Data export (GDPR dump)</strong>: the worker writes the zip
          to blob storage, then enqueues <code>email.export_ready</code>.
          That is a job chain.
        </li>
        <li>
          <strong>Idempotent payment capture</strong>: Stripe{" "}
          <code>Idempotency-Key</code> set to the same natural key as the job.
        </li>
        <li>
          <strong>Test suite</strong>: Memory + <code>runOnce()</code> + fake
          timers. No Redis in CI.
        </li>
        <li>
          <strong>MCP / agent tool that would time out the client</strong>:
          return a job id fast, then let the agent poll.
        </li>
      </ol>

      <h2 id="runtime-matrix">Runtime matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Runtime</th>
            <th>Enqueue</th>
            <th>Worker poll loop</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node 24+</td>
            <td>yes</td>
            <td>yes (primary)</td>
          </tr>
          <tr>
            <td>Bun</td>
            <td>yes</td>
            <td>yes</td>
          </tr>
          <tr>
            <td>Deno</td>
            <td>yes</td>
            <td>yes</td>
          </tr>
          <tr>
            <td>Cloudflare Workers</td>
            <td>
              yes, if the store is remote (KV/D1/HTTP). Memory is
              request-scoped and wrong.
            </td>
            <td>no, in v1</td>
          </tr>
          <tr>
            <td>Vercel / Lambda</td>
            <td>yes, with a remote store</td>
            <td>no. Use a separate Node worker service</td>
          </tr>
          <tr>
            <td>
              Tests (<code>node:test</code>)
            </td>
            <td>yes</td>
            <td>
              <code>runOnce()</code> + fake timers
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="security">Security model</h2>
      <table>
        <thead>
          <tr>
            <th>Threat</th>
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Prototype pollution in payloads</td>
            <td>
              Forbidden keys (<code>__proto__</code>, <code>constructor</code>
              {", "}<code>prototype</code>) rejected at enqueue and on every
              store read via the shared safe parser
            </td>
          </tr>
          <tr>
            <td>Huge-payload OOM</td>
            <td>
              <code>payloadMaxBytes</code> (64 KiB default)
            </td>
          </tr>
          <tr>
            <td>Job-name injection / path traversal</td>
            <td>Anchored charset allowlist, linear-time, ReDoS-free</td>
          </tr>
          <tr>
            <td>Tenant key injection</td>
            <td>
              Tenant grammar shared with <code>tenancy()</code>.{" "}
              <code>jobIdempotencyKey</code> builds prefixed keys.
            </td>
          </tr>
          <tr>
            <td>Handler RCE</td>
            <td>
              The registry is frozen at construction, so a job record cannot{" "}
              <code>eval</code>, <code>new Function</code>, or{" "}
              <code>import(job.name)</code>
            </td>
          </tr>
          <tr>
            <td>SSRF in handlers</td>
            <td>
              Wrap handler fetches in{" "}
              <Link href="/docs/security/fetch-guard">
                <code>fetchGuard</code>
              </Link>
            </td>
          </tr>
          <tr>
            <td>Unauthenticated <code>/jobs</code> HTTP API</td>
            <td>
              None exists. Status/polling routes are yours to mount, with your
              auth
            </td>
          </tr>
          <tr>
            <td>Memory store in prod, jobs lost</td>
            <td>
              Warning log from <code>useJobs</code>.{" "}
              <code>strictProduction: true</code> refuses to boot
            </td>
          </tr>
          <tr>
            <td>Worker runs another tenant&apos;s jobs</td>
            <td>
              <code>tenant</code> is data. Store filtering is the
              adapter&apos;s job. Memory supports{" "}
              <code>list({"{ tenant }"})</code>
            </td>
          </tr>
          <tr>
            <td>PII in logs</td>
            <td>
              Log job id, name, queue, attempts. Payloads at debug level only.
            </td>
          </tr>
          <tr>
            <td>Cross-queue claims</td>
            <td>
              <code>claim(queue)</code> only ever claims its own partition
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Config-time throws: <code>concurrency &lt; 1</code>,{" "}
        <code>maxAttempts &lt; 1</code>, <code>payloadMaxBytes &lt; 1</code>,
        a missing store, <code>cronEnqueue</code> before <code>useJobs</code>,
        a handler name outside the charset, or a duplicate{" "}
        <code>define</code>. Boot warnings: Memory in production,{" "}
        <code>startWorker</code> without handlers,{" "}
        <code>concurrency &gt; 32</code>.
      </p>

      <h2 id="comparison">Jobs next to cron, idempotency, and webhooks</h2>
      <table>
        <thead>
          <tr>
            <th>Primitive</th>
            <th>Runs where</th>
            <th>Survives restart</th>
            <th>Use for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Link href="/docs/scheduler">
                <code>app.cron()</code>
              </Link>
            </td>
            <td>this process</td>
            <td>re-fires next tick</td>
            <td>Process-local maintenance on a clock</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/idempotency">
                <code>idempotency()</code>
              </Link>
            </td>
            <td>in-request</td>
            <td>n/a</td>
            <td>Client-retried POSTs never double-apply</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/webhook-delivery">
                <code>createWebhookSender()</code>
              </Link>
            </td>
            <td>in-request</td>
            <td>no</td>
            <td>Deliver this webhook now, with a few retries</td>
          </tr>
          <tr>
            <td>
              <strong>Jobs (this page)</strong>
            </td>
            <td>any worker, any runtime</td>
            <td>yes, via the store</td>
            <td>Side effects after the HTTP response</td>
          </tr>
          <tr>
            <td>Workflow engines (Temporal / Inngest / Eve)</td>
            <td>their service</td>
            <td>yes</td>
            <td>
              Multi-step durable functions, human waits, sagas with
              compensations
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="anti-patterns">Anti-patterns</h2>
      <ol>
        <li>
          <strong>Enqueue before the DB commit.</strong> The job runs, the row
          is missing, and you get spurious retries. Commit first, then
          enqueue (or use a transactional outbox: insert the order and the
          outbox row in one SQL transaction, and let a drainer call{" "}
          <code>JobStore.put</code>).
        </li>
        <li>
          <strong>File bytes in the payload.</strong> Payloads cap at 64 KiB.
          Store the blob, enqueue the URL.
        </li>
        <li>
          <strong>
            <code>startWorker: true</code> on every API replica and a worker
            deployment, without idempotency keys.
          </strong>{" "}
          That is the duplicate-send scenario. Pick one topology per queue,
          and always set keys.
        </li>
        <li>
          <strong>
            Catch-all handler (<code>handlers[job.name] = dynamicImport</code>
            ).
          </strong>{" "}
          Forbidden. A store record must never pick the code that runs it.
          The registry is frozen at construction for this reason.
        </li>
        <li>
          <strong>Jobs as a distributed cron lock without keys.</strong>{" "}
          &ldquo;Only one nightly run in the cluster&rdquo; works because of
          the per-slot idempotency key. The queue alone does not provide that
          uniqueness. Without a key there is no uniqueness guarantee.
        </li>
        <li>
          <strong>
            Treating <code>completed</code> as exactly-once evidence for money
            movement.
          </strong>{" "}
          A completed job proves the handler finished at least once. Money
          needs the downstream idempotency key (or a ledger transaction you
          own).
        </li>
        <li>
          <strong>MemoryJobStore behind a load balancer.</strong> Each replica
          gets its own private queue. Use a shared store, or accept that jobs
          are process-local.
        </li>
      </ol>

      <h2 id="later">Not in v1</h2>
      <ul>
        <li>
          First-party <code>@daloyjs/jobs-postgres</code> / Redis adapters as
          separate packages with their own dependencies
        </li>
        <li>
          A signed job-completion HTTP callback helper (auth + idempotency)
        </li>
        <li>Recurring job definitions beyond <code>cronEnqueue</code></li>
        <li>Job metrics / OTLP export</li>
        <li>
          Cloudflare <code>waitUntil</code> run-once semantics
        </li>
        <li>Workflow engines as store backends, and batch enqueue</li>
      </ul>
      <p>
        Until those land, implement <code>JobStore</code> in your repo and
        keep the handler registry explicit. The{" "}
        <Link href={"/blog/background-jobs-after-the-http-response" as Route}>
          companion blog post
        </Link>{" "}
        covers the design argument. <code>examples/jobs-basic.ts</code> is
        the runnable reference.
      </p>
    </>
  );
}
