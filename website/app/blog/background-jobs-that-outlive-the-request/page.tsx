import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "background-jobs-that-outlive-the-request",
  title:
    "Background Jobs That Outlive the Request: Why DaloyJS Grew a Queue, Not a Workflow Engine",
  description:
    "HTTP handlers should return. Side effects should survive deploys. This post is the why, when, and where of the DaloyJS queue-agnostic job interface, and why we did not embed Temporal, Inngest, or Eve.",
  date: "2026-08-28",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "background jobs TypeScript",
    "queue-agnostic job interface",
    "DaloyJS jobs",
    "job idempotency key",
    "cron vs queue",
    "at-least-once delivery",
    "JobStore SPI",
    "not a workflow engine",
    "AKS worker pods",
    "serverless enqueue",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: { "@type": "Person", name: POST.author },
  publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/blog/${POST.slug}`,
  },
  url: `${SITE_URL}/blog/${POST.slug}`,
};

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Architecture</Badge>
            <Badge variant="outline">Feature deep-dive</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {POST.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            {POST.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{POST.author}</span>
            <span aria-hidden>·</span>
            <span>{POST.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={POST.date}>
              {dateFormatter.format(new Date(POST.date))}
            </time>
            <span aria-hidden>·</span>
            <span>{POST.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">
          <h2>The deploy that ate the welcome email</h2>

          <p>
            Some years ago I shipped a <code>POST /users</code> that sent the
            welcome email inline. SMTP, right there in the handler, between the{" "}
            <code>INSERT</code> and the <code>201</code>. It worked in dev. It
            worked in staging. It worked in production for months, right up
            until a routine rolling deploy terminated the pod in the 400
            milliseconds between &ldquo;user row committed&rdquo; and
            &ldquo;SMTP done&rdquo;. No exception anywhere. The user existed;
            the email did not. I found out because a customer emailed support
            to ask where their welcome email was, which remains my least
            favorite monitoring system.
          </p>

          <CodeBlock
            language="ts"
            code={`// The version that bites you at 2am.
app.post("/users", contract, async (ctx) => {
  const user = await db.insertUser(ctx.body);
  await sendWelcomeEmail(user.email); // inline: slow, and a deploy can eat it
  return { status: 201 as const, body: user };
});`}
          />

          <p>
            The cron variant of the same bug is funnier, in retrospect. A
            later job, eight replicas on AKS, and a nightly invoice task
            implemented as an in-process timer. Eight pods, eight timers,
            eight copies of the same invoice email. The accountant noticed
            before we did. Again: least favorite monitoring system.
          </p>

          <p>
            The fix we shipped that week was the classic one: a database row
            that said &ldquo;invoice run for date X&rdquo; with a unique
            constraint, so only one pod could claim the slot. It worked. It
            was also the third time in my career I had hand-rolled exactly
            that table. Every team I have been on eventually builds a tiny,
            slightly wrong job queue out of SQL and hope, and every one of
            those teams would rather have had the real thing.
          </p>

          <p>
            Both bugs have one root cause: I was doing work that needed to
            outlive the HTTP request (or run exactly once across a fleet)
            inside a process that makes no such promise. An HTTP handler is a
            great place to answer a request. It is a terrible place to keep a
            promise.
          </p>

          <h2>Why DaloyJS grew a queue</h2>

          <p>
            The roadmap has named a &ldquo;queue-agnostic background-job
            interface&rdquo; for a while, and the Scheduler&apos;s own JSDoc
            already pointed at a queue that did not exist yet. The shape was
            never in doubt, only the timing: enqueue JSON, persist it behind a
            store interface, let a leased worker run it with retries, and keep
            every durable backend outside the framework.
          </p>

          <p>
            DaloyJS 1.3.0 ships that shape. <code>createJobQueue</code>,{" "}
            <code>createJobWorker</code>, <code>MemoryJobStore</code>, and the{" "}
            <code>JobStore</code> SPI at <code>@daloyjs/core/jobs</code>, plus{" "}
            <code>app.useJobs()</code> and <code>app.cronEnqueue()</code> on
            the <code>App</code>. It is fully additive:{" "}
            <code>app.cron()</code> is untouched, nothing auto-starts, and the
            dependency count is still zero. The fixed version of the hook
            story looks like this:
          </p>

          <CodeBlock
            language="ts"
            code={`import { createApp, MemoryJobStore, jobIdempotencyKey } from "@daloyjs/core";

const app = createApp();

app.useJobs({
  store: new MemoryJobStore(), // production: your Redis/Postgres JobStore
  handlers: {
    "email.welcome": async ({ job, signal }) => {
      const { to } = job.payload as { to: string };
      await sendWelcomeEmail(to, { signal });
    },
  },
  startWorker: true,
});

app.post("/users", contract, async (ctx) => {
  const user = await db.insertUser(ctx.body); // commit first, then enqueue
  await app.jobs!.enqueue({
    name: "email.welcome",
    payload: { to: user.email },
    idempotencyKey: jobIdempotencyKey({
      name: "email.welcome",
      key: user.id, // a retried POST never double-sends
    }),
  });
  return { status: 201 as const, body: user };
});`}
          />

          <p>
            The handler now answers in milliseconds. The email survives the
            deploy, because the job record, not the process, carries the
            promise.
          </p>

          <p>
            To be fair to past me, there is a seductive middle option: return
            the 201 and let the work trail behind on a{" "}
            <code>setTimeout</code>, a detached promise, or{" "}
            <code>ctx.waitUntil</code> on serverless. It feels like a queue.
            It is not one. There is no persistence (a deploy still eats the
            work), no retry policy (a 421 from SMTP is simply gone), no
            idempotency (a retried POST sends two emails), and no visibility
            (you cannot answer &ldquo;did that job run?&rdquo; without grep
            and prayer). Fire-and-forget is fine for metrics. For anything a
            user would miss, it is a rumor, not a system.
          </p>

          <h2>Why we did not build a workflow engine</h2>

          <p>
            Temporal, Inngest, Vercel Workflow, and Eve answer a bigger
            question: what if a function could checkpoint itself, sleep for
            seven days, wait for a human to click approve, and resume as if
            nothing happened? Durable execution, deterministic replay, parked
            workflows. Genuinely impressive technology, and genuinely the
            right tool for multi-step sagas with compensations and
            human-in-the-loop waits.
          </p>

          <p>
            It is also a commitment. Replay semantics come with versioning
            rules, a sandbox, and a mental model that slowly swallows the
            codebase around it. For DaloyJS specifically it would break three
            promises I am not willing to break: zero runtime dependencies,
            portability across Node, Bun, Deno, Workers, and Lambda, and a
            frozen 1.x API surface. I have been doing this long enough to know
            which boss fights to skip. Reimplementing deterministic replay is
            one of them.
          </p>

          <p>
            So the line is drawn honestly. A Daloy job is{" "}
            <code>{"{ name, payload }"}</code> plus a store. If the same
            TypeScript function must pause for hours and resume, use Temporal,
            Inngest, or Eve, and keep DaloyJS as the HTTP API in front of it.
            That is not a limitation we are embarrassed about; it is the
            boundary that keeps the framework small enough to audit.
          </p>

          <h2>When to reach for jobs (and when not to)</h2>

          <p>
            The product truth is one sentence: jobs are for work that must
            survive the request and/or the process. If the work fits in the
            request, do not enqueue. The tree:
          </p>

          <CodeBlock
            language="text"
            code={`Does the client need the result to build the HTTP response?
  YES -> do it in the handler (maybe resilientFetch). Not a job.
  NO  -> would losing this work on process crash / deploy be unacceptable?
          NO  -> in-process is fine (handler fire-and-forget or app.cron).
          YES -> can it be one named function + JSON payload, retried as a whole?
                  NO  -> workflow engine (Temporal / Inngest / Eve). Daloy stays the API.
                  YES -> JOBS.`}
          />

          <p>
            A job earns its keep when the response can succeed before the side
            effect finishes (email, thumbnails, search indexing, analytics),
            when the side effect fails transiently and deserves backoff (SMTP
            421, Stripe 429, a 503 from your model provider), when a deploy
            must not drop the work, and when a duplicate run is safe because
            you pass an idempotency key downstream. The &ldquo;please do not
            enqueue this&rdquo; list is just as important:
          </p>

          <table>
            <thead>
              <tr>
                <th>Situation</th>
                <th>Use instead</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Result needed in the 200 body</td>
                <td>The handler itself</td>
              </tr>
              <tr>
                <td>Client retries the same POST (payments)</td>
                <td>
                  <Link href="/docs/idempotency">
                    <code>idempotency()</code>
                  </Link>
                  {", "}or both layers
                </td>
              </tr>
              <tr>
                <td>Deliver this webhook before the response returns</td>
                <td>
                  <code>createWebhookSender()</code>
                </td>
              </tr>
              <tr>
                <td>Sweep this process&apos;s memory cache</td>
                <td>
                  <code>app.cron()</code>
                </td>
              </tr>
              <tr>
                <td>Human approval in two days, then resume</td>
                <td>Temporal / Inngest / Eve</td>
              </tr>
              <tr>
                <td>Saga with compensations</td>
                <td>
                  Workflow engine, or explicit job chain plus your own
                  compensation jobs
                </td>
              </tr>
              <tr>
                <td>Video files and other huge blobs</td>
                <td>Blob URL in the payload; payloads cap at 64 KiB</td>
              </tr>
            </tbody>
          </table>

          <h2>Where it runs</h2>

          <p>
            The split that matters: enqueueing needs no timers, so it works on
            every runtime DaloyJS supports, including a 50ms Workers isolate.
            The worker is a poll loop, so it belongs wherever a long-lived
            process exists. Six topologies fall out of that:
          </p>

          <ul>
            <li>
              <strong>Tests and local dev</strong>:{" "}
              <code>MemoryJobStore</code>, <code>worker.runOnce()</code>, fake
              timers. No Redis in CI, ever.
            </li>
            <li>
              <strong>One VPS, small production</strong>: HTTP and worker in
              the same process (<code>startWorker: true</code>), but the store
              is Redis or Postgres so jobs survive the restart. Memory in
              production gets you a loud warning;{" "}
              <code>strictProduction: true</code> refuses to boot.
            </li>
            <li>
              <strong>Kubernetes</strong>: an <code>api</code> deployment that
              enqueues (<code>startWorker: false</code>) and a{" "}
              <code>worker</code> deployment that claims (
              <code>startWorker: true</code>, no public ingress). This is the
              AKS shape: N API pods behind Entra, M worker pods with egress to
              Redis/Postgres, SMTP, Stripe, and Azure OpenAI. The store
              adapter lives in your repo, not in core.
            </li>
            <li>
              <strong>Serverless API + always-on worker</strong>: Vercel,
              Lambda, or Cloudflare handlers enqueue to a remote store; a Node
              container somewhere else runs the loop. Never{" "}
              <code>startWorker: true</code> on an isolate in v1.
            </li>
            <li>
              <strong>You already have SQS / Service Bus</strong>: implement{" "}
              <code>JobStore</code> over it (<code>put</code> is send,{" "}
              <code>claim</code> is receive with a visibility timeout,{" "}
              <code>complete</code> is delete, <code>fail</code> is native
              redrive). If your cloud consumer already drains the queue,
              DaloyJS is producer-only and the worker is optional.
            </li>
            <li>
              <strong>Multi-tenant SaaS</strong>: pass{" "}
              <code>ctx.state.tenant</code> explicitly and build keys with{" "}
              <code>jobIdempotencyKey({"{ tenant, name, key }"})</code>, so
              two tenants can never collide on the same natural key.
            </li>
          </ul>

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
                <td>Single dev process</td>
                <td>yes</td>
                <td>optional in-process</td>
                <td>Memory</td>
              </tr>
              <tr>
                <td>1x Node VM, small prod</td>
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
                <td>separate Node service</td>
                <td>remote only</td>
              </tr>
              <tr>
                <td>Cloud queue exists</td>
                <td>
                  <code>put</code> adapter
                </td>
                <td>cloud consumer or Daloy worker</td>
                <td>SQS/Service Bus adapter</td>
              </tr>
            </tbody>
          </table>

          <p>
            Whichever topology you pick, give the worker a chance to finish
            gracefully. <code>stop(graceMs)</code> waits for in-flight jobs,
            then aborts the stragglers&apos; <code>AbortSignal</code> so they
            unwind and fail back to the queue for someone else to claim. On
            Kubernetes, set <code>terminationGracePeriodSeconds</code> above
            that grace period, or the kubelet will SIGKILL mid-heartbeat and
            you will rediscover how leases work at an inconvenient hour.
          </p>

          <h2>Recipes I actually use</h2>

          <p>
            <strong>Stripe webhook, answered in time.</strong> Providers want
            a fast 2xx and will disable endpoints that time out. Verify the
            signature, enqueue, return 202; the heavy entitlement work happens
            in the worker, and Stripe&apos;s own retries collapse into one job
            because the event id is the key:
          </p>

          <CodeBlock
            language="ts"
            code={`app.post("/webhooks/stripe", contract, async (ctx) => {
  const event = verifyStripeSignature(ctx); // your existing check, first
  await app.jobs!.enqueue({
    name: "billing.stripe_event",
    payload: { providerEventId: event.id, type: event.type }, // id, not the event body
    idempotencyKey: jobIdempotencyKey({
      name: "billing.stripe_event",
      key: event.id,
    }),
  });
  return { status: 202 as const, body: { received: true } };
});`}
          />

          <p>
            <strong>Nightly reconciliation, once, cluster-wide.</strong> This
            is the fix for my eight-invoice story. Keep the scheduler as the
            clock, but let the tick enqueue instead of execute. Every replica
            fires at 02:00; the derived key is identical on all of them, so
            eight ticks become one job:
          </p>

          <CodeBlock
            language="ts"
            code={`app.cronEnqueue(
  { name: "nightly-reconcile", cron: "0 2 * * *" },
  { name: "ops.reconcile", payload: {} },
);
// Idempotency key per schedule slot: duplicate ticks collapse,
// exactly one worker runs it, and a dead worker's lease just
// requeues it somewhere else.`}
          />

          <p>
            The counter-example matters just as much: sweeping{" "}
            <em>this</em> process&apos;s memory cache stays{" "}
            <code>app.cron()</code>. A job would run on one random worker and
            sweep the wrong process&apos;s cache, which is a very polite way
            of doing nothing.
          </p>

          <p>
            <strong>Payment capture off the request.</strong> The order
            already returned 201; capture runs as a job; the handler passes
            the same natural key to Stripe so a duplicate run is a no-op at
            the only place where duplicates cost money:
          </p>

          <CodeBlock
            language="ts"
            code={`"payments.capture": async ({ job }) => {
  const { orderId } = job.payload as { orderId: string };
  const order = await db.getOrder(orderId);
  if (!order) throw new JobFatalError("order vanished: " + orderId); // no retry
  await stripe.paymentIntents.create(
    { amount: order.totalCents, currency: order.currency, confirm: true },
    { idempotencyKey: orderId }, // Stripe dedupes retries of THIS job
  );
},`}
          />

          <p>
            Note the two different systems with the same value: the Daloy job
            key stops duplicate <em>producers</em>; the Stripe key stops
            duplicate <em>charges</em>. You need both, and setting them to the
            same natural id is the easiest way to never confuse them.
          </p>

          <p>
            <strong>LLM work that outlives the request.</strong> A two-minute
            summarization cannot hold an API request, and on Workers it
            cannot even finish. Return 202 with the job id and let the client
            poll a status route you write (DaloyJS mounts no{" "}
            <code>/jobs</code> HTTP API; your routes, your auth):
          </p>

          <CodeBlock
            language="ts"
            code={`app.post("/tickets/:id/summary", contract, async (ctx) => {
  const { job } = await app.jobs!.enqueue({
    name: "ai.summarize_ticket",
    payload: { ticketId: ctx.params.id }, // the handler loads the text itself
    maxAttempts: 3,
    timeoutMs: 120_000,
    idempotencyKey: jobIdempotencyKey({
      name: "ai.summarize_ticket",
      key: ctx.params.id,
    }),
  });
  return { status: 202 as const, body: { jobId: job.id } };
});
// Handler: retry 429/5xx from Azure OpenAI; JobFatalError on a 400.`}
          />

          <p>
            <strong>And a plea: do not put PDFs in the payload.</strong>{" "}
            Payloads cap at 64 KiB on purpose. A job is a pointer to work, not
            the work itself: enqueue{" "}
            <code>{"{ blobUrl, ownerId, variant }"}</code> and let the handler
            pull the bytes from blob storage. Your queue (and your Redis bill)
            will thank you.
          </p>

          <h2>It composes with the security story you already have</h2>

          <p>
            The job interface does not sit next to the rest of DaloyJS; it
            sits underneath the same patterns:
          </p>

          <ul>
            <li>
              <Link href="/docs/idempotency">
                <code>idempotency()</code>
              </Link>{" "}
              stops the retried POST from double-inserting the order. The job
              key stops the double email after the 201. Different layers, same
              trick, and they pair well.
            </li>
            <li>
              <code>createWebhookSender()</code> keeps its in-call retries for
              the common case; when delivery must outlive the day, call it{" "}
              <em>inside</em> a <code>webhook.deliver</code> job handler.
            </li>
            <li>
              <Link href="/docs/scheduler">
                <code>app.cron()</code>
              </Link>{" "}
              stays the right tool for process-local maintenance;{" "}
              <code>cronEnqueue</code> takes over the moment the tick&apos;s
              work is a global side effect.
            </li>
            <li>
              <code>tenancy()</code> flows through explicitly. Jobs are not
              HTTP, so nothing reads the tenant for you:
            </li>
          </ul>

          <CodeBlock
            language="ts"
            code={`await app.jobs!.enqueue({
  name: "email.welcome",
  payload: { to: user.email },
  tenant: ctx.state.tenant, // copied onto the record for partitioning + logs
  idempotencyKey: jobIdempotencyKey({
    tenant: ctx.state.tenant,
    name: "email.welcome",
    key: user.id,
  }),
});`}
          />

          <ul>
            <li>
              <code>fetchGuard()</code> still wraps any handler fetch to a
              URL a user could influence. A job that POSTs to a stored webhook
              URL has the same SSRF exposure as a request that does; the guard
              does not care which one it protects.
            </li>
          </ul>

          <h2>At-least-once, said out loud</h2>

          <p>
            Delivery is at-least-once. If the process dies after your handler
            succeeded but before the completion is persisted, the lease
            expires and another worker runs the handler again. That is not a
            flaw we forgot to document; it is the price of not losing work,
            and every honest queue pays it. Leases are kept honest two ways:
            the worker heartbeats every <code>leaseMs / 3</code>{" "}
            automatically, and a long handler can call{" "}
            <code>ctx.heartbeat()</code> itself. If the lease is lost anyway,
            the handler&apos;s <code>AbortSignal</code> fires so it stops
            touching a job it no longer owns.
          </p>

          <p>
            The division of labor: duplicate <em>producers</em> (retried POST,
            eight cron replicas) are absorbed by the enqueue idempotency key.
            Duplicate <em>consumers</em> (lease expiry, two workers racing) are
            absorbed by your handler being idempotent, which usually means
            passing a key to the downstream API, as in the Stripe capture
            above. A <code>completed</code> status proves the handler finished
            at least once. It does not prove the charge happened exactly once;
            the Stripe key does. If your handler is not idempotent, the queue
            will find out at 3am and tell you through your accountant.
          </p>

          <h2>What shipped, in one breath</h2>

          <p>
            <code>JobStore</code>, the persistence SPI where all durability
            lives (Redis, Postgres, SQS adapters are application code).{" "}
            <code>MemoryJobStore</code>, a correct implementation of that SPI
            for tests and single-process apps. <code>createJobQueue</code>{" "}
            for validate, serialize, dedupe, enqueue, get, cancel.{" "}
            <code>createJobWorker</code> with atomic claims, leases,
            heartbeats every <code>leaseMs / 3</code>, retries with
            full-jitter backoff (200ms to 60s, five attempts by default),
            dead letters, and a graceful drain on shutdown.{" "}
            <code>app.useJobs()</code>, <code>app.jobs</code>,{" "}
            <code>app.jobWorker</code>, and <code>app.cronEnqueue()</code> on
            the App. <code>jobIdempotencyKey()</code> for tenant-safe keys,
            and four error classes led by <code>JobFatalError</code> for
            &ldquo;do not retry this, ever&rdquo;. The full tables, the status
            machine, the Redis adapter sketch, and all fourteen recipes are in{" "}
            <Link href="/docs/jobs">the docs</Link>.
          </p>

          <h2>The shape of it</h2>

          <p>
            Daloy remains the HTTP framework. The job interface is how side
            effects leave the request without leaving your security story:
            validated payloads with the same pollution guards, charset-checked
            names, a handler registry frozen at construction so a queue record
            can never pick the code that runs it, and no storage dependency
            smuggled into your supply chain.
          </p>

          <p>
            Start with <Link href="/docs/jobs">/docs/jobs</Link> for the
            reference, run <code>examples/jobs-basic.ts</code> to see dedupe
            and retries work end to end, and if you are new here,{" "}
            <Link href="/docs/getting-started">/docs/getting-started</Link> is
            the front door. Your handlers will get faster, your deploys will
            stop eating emails, and your accountant will stop being your
            monitoring system.
          </p>
        </div>
      </article>
    </main>
  );
}
