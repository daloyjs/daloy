import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "background-jobs-after-the-http-response",
  title: "Background Jobs After the HTTP Response",
  description:
    "A rolling deploy killed a welcome email I sent from POST /users. DaloyJS 1.3.0 adds a job queue so the HTTP handler can return and the email still goes out. Reach for Temporal, Inngest, or Eve if the function has to pause for hours and resume.",
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
          <h2>A rolling deploy ate the welcome email</h2>

          <p>
            Some years ago I shipped a <code>POST /users</code> that sent the
            welcome email inline. SMTP sat in the handler, between the{" "}
            <code>INSERT</code> and the <code>201</code>. It worked in dev, in
            staging, and in production for months, until a routine rolling
            deploy terminated the pod in the 400 milliseconds between
            &ldquo;user row committed&rdquo; and &ldquo;SMTP done&rdquo;. No
            exception anywhere. The user existed. The email did not. I found
            out because a customer emailed support to ask where their welcome
            email was, which remains my least favorite monitoring system.
          </p>

          <CodeBlock
            language="ts"
            code={`// Inline SMTP. A deploy can eat the email.
app.post("/users", contract, async (ctx) => {
  const user = await db.insertUser(ctx.body);
  await sendWelcomeEmail(user.email); // inline: slow, and a deploy can eat it
  return { status: 201 as const, body: user };
});`}
          />

          <p>
            A later job had the same shape. Eight replicas on AKS, a nightly
            invoice task implemented as an in-process timer. Eight pods, eight
            timers, eight copies of the same invoice email. The accountant
            noticed before we did.
          </p>

          <p>
            That week we shipped a database row that said &ldquo;invoice run
            for date X&rdquo; with a unique constraint, so only one pod could
            claim the slot. It worked. It was also the third time in my career
            I had hand-rolled that table. Every team I have been on eventually
            builds a slightly wrong job queue out of SQL and hope, and every
            one of those teams would rather have had the real thing.
          </p>

          <p>
            I was doing work that needed to outlive the HTTP request, or run
            exactly once across a fleet, inside a process that does not
            promise either of those things. An HTTP handler can answer a
            request. Sending mail, capturing a payment, or firing a nightly
            invoice from inside it still ties that work to a process that can
            die mid-flight.
          </p>

          <h2>What 1.3.0 ships</h2>

          <p>
            The roadmap has named a queue-agnostic background-job interface
            for a while, and the Scheduler&apos;s own JSDoc already pointed at
            a queue that did not exist yet. The intended API was enqueue JSON,
            persist it behind a store interface, let a leased worker run it
            with retries, and keep durable backends outside the framework.
          </p>

          <p>
            DaloyJS 1.3.0 ships that. <code>createJobQueue</code>,{" "}
            <code>createJobWorker</code>, <code>MemoryJobStore</code>, and the{" "}
            <code>JobStore</code> SPI live at <code>@daloyjs/core/jobs</code>.{" "}
            <code>app.useJobs()</code> and <code>app.cronEnqueue()</code> sit
            on the <code>App</code>. <code>app.cron()</code> is untouched,
            nothing auto-starts, and the dependency count is still zero. The
            handler that used to send mail inline now looks like this:
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
            The handler can return as soon as the row is committed and the
            job is enqueued. The job record lives in the store, so a rolling
            deploy can kill the HTTP pod and the email still goes out.
          </p>

          <p>
            I have also tried returning the 201 and letting the work trail
            behind on a <code>setTimeout</code>, a detached promise, or{" "}
            <code>ctx.waitUntil</code> on serverless. A deploy still eats the
            work, a 421 from SMTP disappears, a retried POST sends two emails,
            and you cannot tell whether the job ran without grep.
            Fire-and-forget is fine for metrics. For anything a user would
            miss, persist it.
          </p>

          <h2>Where a workflow engine still belongs</h2>

          <p>
            Temporal, Inngest, Vercel Workflow, and Eve let a function
            checkpoint itself, sleep for seven days, wait for a human to click
            approve, and resume as if nothing happened. That combination of
            durable execution, deterministic replay, and parked workflows is
            the right tool for multi-step sagas with compensations and
            human-in-the-loop waits.
          </p>

          <p>
            Replay semantics also come with versioning rules, a sandbox, and a
            mental model that slowly takes over the codebase around it. For
            DaloyJS that would break three promises I am not willing to break:
            zero runtime dependencies, portability across Node, Bun, Deno,
            Workers, and Lambda, and a frozen 1.x API surface. I have been
            doing this long enough to know which boss fights to skip, and
            reimplementing deterministic replay is one of them.
          </p>

          <p>
            A Daloy job is <code>{"{ name, payload }"}</code> plus a store. If
            the same TypeScript function must pause for hours and resume, use
            Temporal, Inngest, or Eve, and keep DaloyJS as the HTTP API in
            front of it. That keeps the framework small enough to audit.
          </p>

          <h2>When a job is the right tool</h2>

          <p>
            Jobs are for work that must survive the request, or the process.
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
                  YES -> JOBS.`}
          />

          <p>
            A job is worth it when the response can succeed before the side
            effect finishes (email, thumbnails, search indexing, analytics),
            when the side effect fails transiently and deserves backoff (SMTP
            421, Stripe 429, a 503 from your model provider), when a deploy
            must not drop the work, and when a duplicate run is safe because
            you pass an idempotency key downstream. The list of things that
            should stay out of the queue:
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
                <td>Blob URL in the payload (payloads cap at 64 KiB)</td>
              </tr>
            </tbody>
          </table>

          <h2>Where the worker runs</h2>

          <p>
            Enqueueing needs no timers, so it works on all the runtimes
            DaloyJS supports, including a 50ms Workers isolate. The worker is
            a poll loop, so it belongs wherever a long-lived process exists.
            The layouts I actually see:
          </p>

          <ul>
            <li>
              <strong>Tests and local dev.</strong>{" "}
              <code>MemoryJobStore</code>, <code>worker.runOnce()</code>, fake
              timers. CI does not need Redis.
            </li>
            <li>
              <strong>One VPS, small production.</strong> HTTP and worker in
              the same process (<code>startWorker: true</code>), but the store
              is Redis or Postgres so jobs survive the restart. Memory in
              production logs a loud warning.{" "}
              <code>strictProduction: true</code> refuses to boot.
            </li>
            <li>
              <strong>Kubernetes.</strong> An <code>api</code> deployment that
              enqueues (<code>startWorker: false</code>) and a{" "}
              <code>worker</code> deployment that claims (
              <code>startWorker: true</code>, no public ingress). This is the
              AKS shape. N API pods behind Entra, M worker pods with egress to
              Redis/Postgres, SMTP, Stripe, and Azure OpenAI. The store
              adapter lives in your repo, not in core.
            </li>
            <li>
              <strong>Serverless API plus an always-on worker.</strong>{" "}
              Vercel, Lambda, or Cloudflare handlers enqueue to a remote
              store. A Node container somewhere else runs the loop. Do not set{" "}
              <code>startWorker: true</code> on an isolate in v1.
            </li>
            <li>
              <strong>You already have SQS or Service Bus.</strong> Implement{" "}
              <code>JobStore</code> over it (<code>put</code> is send,{" "}
              <code>claim</code> is receive with a visibility timeout,{" "}
              <code>complete</code> is delete, <code>fail</code> is native
              redrive). If your cloud consumer already drains the queue,
              DaloyJS is producer-only and the worker is optional.
            </li>
            <li>
              <strong>Multi-tenant SaaS.</strong> Pass{" "}
              <code>ctx.state.tenant</code> explicitly and build keys with{" "}
              <code>jobIdempotencyKey({"{ tenant, name, key }"})</code>, so
              two tenants never collide on the same natural key.
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
            Give the worker a chance to finish. <code>stop(graceMs)</code>{" "}
            waits for in-flight jobs, then aborts the stragglers&apos;{" "}
            <code>AbortSignal</code> so they unwind and fail back to the queue
            for someone else to claim. On Kubernetes, set{" "}
            <code>terminationGracePeriodSeconds</code> above that grace
            period, or the kubelet will SIGKILL mid-heartbeat and you will
            rediscover how leases work at an inconvenient hour.
          </p>

          <h2>Recipes I actually use</h2>

          <p>
            <strong>Stripe webhook, answered in time.</strong> Providers want
            a fast 2xx and will disable endpoints that time out. Verify the
            signature, enqueue, return 202. The heavy entitlement work happens
            in the worker, and Stripe&apos;s own retries collapse into one job
            because the event id is the key.
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
            is the fix for the eight-invoice story. Keep the scheduler as the
            clock, but let the tick enqueue instead of execute. Every replica
            fires at 02:00. The derived key is identical on all of them, so
            eight ticks become one job.
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
            Sweeping <em>this</em> process&apos;s memory cache stays{" "}
            <code>app.cron()</code>. A job would run on one random worker and
            sweep the wrong process&apos;s cache, which is a polite way of
            doing nothing.
          </p>

          <p>
            <strong>Payment capture off the request.</strong> The order
            already returned 201. Capture runs as a job. The handler passes
            the same natural key to Stripe so a duplicate run is a no-op at
            the only place where duplicates cost money.
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
            Those are two different systems with the same value. The Daloy job
            key stops duplicate producers. The Stripe key stops duplicate
            charges. You need both. Setting them to the same natural id is the
            easiest way to never confuse them.
          </p>

          <p>
            <strong>LLM work after the HTTP response.</strong> A two-minute
            summarization cannot hold an API request, and on Workers it
            cannot even finish. Return 202 with the job id and let the client
            poll a status route you write. DaloyJS mounts no{" "}
            <code>/jobs</code> HTTP API, so the status route and its auth are
            yours.
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
            <strong>Keep PDFs out of the payload.</strong> Payloads cap at 64
            KiB on purpose. Enqueue{" "}
            <code>{"{ blobUrl, ownerId, variant }"}</code> and let the handler
            pull the bytes from blob storage. That keeps the queue and the
            Redis bill small.
          </p>

          <h2>How this sits next to the rest of the framework</h2>

          <ul>
            <li>
              <Link href="/docs/idempotency">
                <code>idempotency()</code>
              </Link>{" "}
              stops the retried POST from double-inserting the order. The job
              key stops the double email after the 201.
            </li>
            <li>
              <code>createWebhookSender()</code> keeps its in-call retries for
              the common case. When delivery must outlive the day, call it{" "}
              <em>inside</em> a <code>webhook.deliver</code> job handler.
            </li>
            <li>
              <Link href="/docs/scheduler">
                <code>app.cron()</code>
              </Link>{" "}
              stays the right tool for process-local maintenance.{" "}
              <code>cronEnqueue</code> takes over the moment the tick&apos;s
              work is a global side effect.
            </li>
            <li>
              <code>tenancy()</code> flows through explicitly. Jobs are not
              HTTP, so nothing reads the tenant for you.
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

          <p>
            <code>fetchGuard()</code> still wraps any handler fetch to a URL
            a user could influence. A job that POSTs to a stored webhook URL
            has the same SSRF exposure as a request that does. The guard does
            not care which one it protects.
          </p>

          <h2>Delivery is at-least-once</h2>

          <p>
            If the process dies after your handler succeeded but before the
            completion is persisted, the lease expires and another worker runs
            the handler again. That is the price of not losing work, and
            honest queues all pay it. Leases stay honest two ways. The worker
            heartbeats every <code>leaseMs / 3</code> automatically, and a
            long handler can call <code>ctx.heartbeat()</code> itself. If the
            lease is lost anyway, the handler&apos;s <code>AbortSignal</code>{" "}
            fires so it stops touching a job it no longer owns.
          </p>

          <p>
            The enqueue idempotency key collapses retried POSTs and eight cron
            replicas into one job. If a lease expires and a second worker runs
            the handler, your handler has to be idempotent, which usually
            means passing a key to the downstream API, as in the Stripe
            capture above. A <code>completed</code> status means the handler
            finished at least once. The Stripe key is what stops a second
            charge if the handler runs again. If your handler is not
            idempotent, the queue will find out at 3am and tell you through
            your accountant.
          </p>

          <p>
            The full tables, the status machine, the Redis adapter sketch, and
            all fourteen recipes are in{" "}
            <Link href={"/docs/jobs" as Route}>the jobs docs</Link>.{" "}
            <code>examples/jobs-basic.ts</code> shows dedupe and retries end
            to end. If you are new here,{" "}
            <Link href={"/docs/getting-started" as Route}>
              /docs/getting-started
            </Link>{" "}
            is the front door.
          </p>
        </div>
      </article>
    </main>
  );
}
