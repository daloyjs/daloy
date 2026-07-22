import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "observability-without-lock-in-structured-logs-and-otel-tracing",
  title:
    "Observability Without Lock-In: Structured Logs and OpenTelemetry-Compatible Tracing",
  description:
    "How DaloyJS gives you per-request structured logs, correlated request IDs, Server-Timing, and OpenTelemetry-shaped spans, without taking a hard dependency on @opentelemetry/api. The result is a single observability story that runs identically on Node, Bun, and Workers, with any tracer you bring.",
  date: "2026-06-03",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, writing TypeScript from Norway. Once lost an evening to a missing propagator and has been more patient with observability complaints ever since.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS observability",
    "structured logging TypeScript",
    "createLogger pino",
    "OpenTelemetry without dependency",
    "otelTracing semantic attributes",
    "Server-Timing header",
    "request id correlation",
    "edge runtime tracing",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# A real observability stack failure mode, lightly fictionalized:
#
# - "We have logs." Yes, in three different formats, one of them is
#   console.log("got here"), and none of them carry a request id.
# - "We have tracing." There's an SDK pinned in package.json. It was
#   installed in 2023. Nobody knows which spans it actually emits.
# - "We have metrics." prom-client is in two services and StatsD in
#   the third. The dashboards agree on nothing.
# - "We're going to clean it up." Yes. After this quarter. With the
#   migration. After the migration. After the next one.
#
# The lock-in problem is that every observability SDK wants to OWN your
# app: register globally, monkey-patch fetch, become the only logger.
# Then you can't run on Workers, you can't run on Edge, and you can't
# switch vendors without a rewrite. DaloyJS goes the other way:
# small contracts, your choice of implementation, zero global patching.`;

const LOGGER_BASIC = `// src/log.ts, boot a structured JSON logger.
import { createLogger } from "@daloyjs/core";

export const log = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  bindings: {
    service: "books-api",
    env: process.env.NODE_ENV ?? "development",
    region: process.env.FLY_REGION ?? process.env.AWS_REGION ?? "local",
  },
});

// One record per line, always JSON, always with level + time:
//
//   {"level":"info","time":"2026-06-03T08:42:11.108Z",
//    "service":"books-api","env":"production","region":"arn1",
//    "event":"boot","msg":"server starting"}
//
// Pipe stdout into Loki / CloudWatch / Datadog / your terminal,
// whatever. The structure is the same everywhere.`;

const LOGGER_PINO = `// Want pino in production for performance? createLogger is just one
// implementation of the Logger interface. Anything matching the shape
// works - same constructor signature, no framework changes.
import pino from "pino";
import type { Logger } from "@daloyjs/core";
import { App } from "@daloyjs/core";

// pino implements .child() and .info/.warn/.error/etc. already.
// The shape is intentionally compatible, so this just works:
const log = pino({ level: "info" }) as unknown as Logger;

const app = new App({ logger: log });

// In tests:
//   new App({ logger: false })   // -> noopLogger, silent
//   new App({ logger: noopLogger })`;

const REQUEST_ID = `// src/app.ts, request IDs are the spine of observability.
import { App, requestId, timing } from "@daloyjs/core";
import { log } from "./log.js";

const app = new App({ logger: log });

// Order matters. requestId() runs in preBody and stamps
// ctx.state.requestId + sets x-request-id on the response.
// trustIncoming defaults to false because clients can spoof headers
// unless your edge proxy strips/rewrites them.
app.use(requestId({ trustIncoming: false }));

// timing() adds Server-Timing: app;dur=12.34 so the browser DevTools
// Network tab shows your handler time without any client code.
app.use(timing());

// Inside a handler, use ctx.log (the framework already created a
// child logger bound to the request id) instead of the top-level log.
app.route({
  method: "GET",
  path: "/books",
  operationId: "listBooks",
  responses: { 200: { description: "ok" } },
  handler: async (ctx) => {
    ctx.log.info({ event: "list_books" }, "listing books");
    // ↑ every log line for this request carries requestId in the JSON
    return { status: 200, body: { items: [] } };
  },
});`;

const LOG_OUTPUT = `// Output for one request, note the shared requestId across lines.
{"level":"info","time":"2026-06-03T08:42:11.108Z","service":"books-api",
 "requestId":"01HZQ4M8Z1F7E0SE0EH7E3WJW2","method":"GET","path":"/books",
 "msg":"request received"}

{"level":"info","time":"2026-06-03T08:42:11.110Z","service":"books-api",
 "requestId":"01HZQ4M8Z1F7E0SE0EH7E3WJW2","event":"list_books",
 "msg":"listing books"}

{"level":"info","time":"2026-06-03T08:42:11.114Z","service":"books-api",
 "requestId":"01HZQ4M8Z1F7E0SE0EH7E3WJW2","status":200,"durationMs":6,
 "msg":"request handled"}

// Server-Timing on the wire (DevTools Network tab -> Timing):
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
x-request-id: 01HZQ4M8Z1F7E0SE0EH7E3WJW2
server-timing: app;dur=5.91`;

const OTEL_BASIC = `// src/tracing.ts, bring your own OTel tracer.
// DaloyJS does NOT import @opentelemetry/api. You install it, you
// configure it, you pass the tracer in. That's the whole API surface.
import { trace } from "@opentelemetry/api";
import { App, otelTracing } from "@daloyjs/core";

// 1. Wire your OTel SDK exactly as the OTel docs say (node SDK, edge
//    SDK, sdk-trace-base + a custom exporter, etc.). DaloyJS does not
//    care which one - it never touches the global provider.
import "./otel-bootstrap.js"; // ← your code; calls trace.setGlobalTracerProvider(...)

const tracer = trace.getTracer("books-api", "1.0.0");

const app = new App({
  hooks: otelTracing({
    tracer,
    // Use your routing knowledge to template the span name instead of
    // letting it be "GET /books/abc123" (high-cardinality nightmare).
    spanName: (req) => {
      const url = new URL(req.url);
      const m = url.pathname.match(/^\\/books\\/[^/]+$/);
      return m ? \`\${req.method} /books/:id\` : \`\${req.method} \${url.pathname}\`;
    },
  }),
});`;

const OTEL_LIFECYCLE = `# The four-hook lifecycle, in order, for a single request:
#
# 1) onRequest     - starts a SERVER span and stamps HTTP semantic
#                    attributes:
#                       http.request.method, url.path, url.scheme,
#                       server.address, url.query, user_agent.original
# 2) beforeHandle  - stores the span on ctx.state.otelSpan so handlers
#                    can add events / create child spans / set custom
#                    attributes ("user.id", "tenant.id", ...).
# 3) onError       - calls span.recordException(err) and sets status
#                    to ERROR with err.message. Runs ONCE.
# 4) onSend        - sets http.response.status_code, escalates to ERROR
#                    for 5xx if onError didn't already, and calls
#                    span.end() exactly once. Even if the handler threw.
#
# Everything is delivered through the standard Hooks contract from
# src/types.ts - no monkey-patching of fetch, no async-hooks magic,
# no surprise globals. The same hooks composition you'd write by hand.`;

const SEMANTIC_ATTRS = `// Add app-specific semantic attributes inside a handler.
// Use the OTel convention names so your existing dashboards work.
import type { Context } from "@daloyjs/core";
import type { TracingSpan } from "@daloyjs/core";

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBook",
  responses: { 200: { description: "ok" } },
  handler: async (ctx) => {
    const span = (ctx.state as { otelSpan?: TracingSpan }).otelSpan;
    span?.setAttribute("http.route", "/books/:id");
    span?.setAttribute("books.id", ctx.params.id);
    span?.setAttribute("tenant.id", ctx.state.tenantId as string);

    // Bonus: tie the request id and the trace together. Anyone reading
    // logs in Datadog can jump to the matching trace in Jaeger.
    ctx.log.info({ event: "get_book", bookId: ctx.params.id });

    return { status: 200, body: { id: ctx.params.id } };
  },
});`;

const NO_OTEL_SDK = `// You can use otelTracing() WITHOUT installing @opentelemetry/api.
// The framework only depends on the small TracingTracer/TracingSpan
// interfaces. Roll your own collector - useful on Workers, in tests,
// or for emitting OTLP HTTP directly from an edge function.
import { App, otelTracing } from "@daloyjs/core";
import type { TracingTracer, TracingSpan } from "@daloyjs/core";

const collected: object[] = [];

const tinyTracer: TracingTracer = {
  startSpan(name, options) {
    const startedAt = Date.now();
    const attrs: Record<string, unknown> = { ...(options?.attributes ?? {}) };
    let status: { code: number; message?: string } = { code: 0 };

    const span: TracingSpan = {
      setAttribute(k, v) { attrs[k] = v; },
      setAttributes(o) { Object.assign(attrs, o); },
      setStatus(s) { status = s; },
      recordException(err) {
        attrs["exception.type"] = (err as Error)?.name ?? "Error";
        attrs["exception.message"] = (err as Error)?.message ?? String(err);
      },
      end() {
        collected.push({ name, durationMs: Date.now() - startedAt, status, attrs });
        // Ship to your OTLP endpoint, console, KV, whatever:
        // fetch("https://otlp-http.example/v1/traces", { ... })
      },
    };
    return span;
  },
};

const app = new App({ hooks: otelTracing({ tracer: tinyTracer }) });`;

const PARENT_CONTEXT = `// W3C traceparent propagation, bring your own propagator.
// DaloyJS deliberately does NOT import a propagator (they pull in
// the OTel context API and aren't edge-safe in every runtime).
// Pass any function that returns the parent context you want.
import { propagation, ROOT_CONTEXT } from "@opentelemetry/api";

const app = new App({
  hooks: otelTracing({
    tracer,
    contextFromRequest: (req) => {
      // Build a header carrier from the Web Request:
      const carrier: Record<string, string> = {};
      req.headers.forEach((v, k) => { carrier[k] = v; });
      return propagation.extract(ROOT_CONTEXT, carrier);
    },
  }),
});

// Now upstream services that already started a trace (your gateway,
// a frontend RUM library, another service) get the child-of relation
// recorded automatically, with no per-handler code.`;

const CUSTOM_EXPORTER = `// otelTracing() is just hooks. You can compose your own exporter at
// the same layer - wrap startSpan to also push to your sink, or wrap
// otelTracing's onSend hook to also emit a log line.
import { otelTracing } from "@daloyjs/core";
import type { Hooks } from "@daloyjs/core";

const tracing = otelTracing({ tracer });

const tracingWithAccessLog: Hooks = {
  ...tracing,
  onSend(res, ctx) {
    tracing.onSend?.(res, ctx);             // keep span termination
    if (!ctx) return;
    ctx.log.info({
      event: "access",
      status: res.status,
      method: ctx.request.method,
      path: new URL(ctx.request.url).pathname,
    });
  },
};

app.use(tracingWithAccessLog);`;

const TESTING = `// tests/observability.test.ts, verify spans without a real backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, otelTracing } from "@daloyjs/core";
import type { TracingTracer } from "@daloyjs/core";

test("emits one SERVER span per request with HTTP attributes", async () => {
  const spans: Array<{ name: string; attrs: Record<string, unknown>; status: number }> = [];

  const tracer: TracingTracer = {
    startSpan(name, options) {
      const attrs = { ...(options?.attributes ?? {}) } as Record<string, unknown>;
      let statusCode = 0;
      return {
        setAttribute(k, v) { attrs[k] = v; },
        setStatus(s) { statusCode = s.code; },
        recordException() {},
        end() { spans.push({ name, attrs, status: statusCode }); },
      };
    },
  };

  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200, body: { ok: true } }),
  });

  const res = await app.request("/ping");
  assert.equal(res.status, 200);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.name, "GET /ping");
  assert.equal(spans[0]!.attrs["http.request.method"], "GET");
  assert.equal(spans[0]!.attrs["http.response.status_code"], 200);
});`;

const RUNTIME_NOTES = `# Runtime-by-runtime observability checklist.
#
# Node / Bun (long-lived):
# - createLogger to stdout, ship via fluent-bit / vector / your agent.
# - @opentelemetry/sdk-node + the OTLP exporter you prefer.
# - requestId({ trustIncoming: true }) ONLY if your reverse proxy
#   strips and rewrites x-request-id.
#
# Cloudflare Workers:
# - createLogger writes via console.log (the Workers runtime captures
#   it). Logpush ships to R2/S3/Splunk.
# - For tracing: roll a small TracingTracer that POSTs to an OTLP/HTTP
#   collector (or directly to vendor APIs like Honeycomb). The "no OTel
#   SDK" example above is the template.
# - Inherit traceparent via contextFromRequest - propagation only needs
#   reading the header; you can do that without the OTel propagator.
#
# Vercel / Functions:
# - Same as Workers for Edge runtime. For Node functions, the standard
#   @opentelemetry/sdk-node works if the cold-start budget allows.
# - Vercel's Observability tab already reads structured stdout JSON.
#
# AWS Lambda:
# - createLogger to stdout (CloudWatch). Add bindings: { aws_request_id }.
# - @opentelemetry/sdk-node + the Lambda layer the OTel project ships,
#   or roll a tiny tracer + flush at the end of each invocation.
#
# Same App, every runtime: same Logger, same TracingTracer interface,
# different transports. The framework never assumes which one.`;

const CHECKLIST = `# Pre-flight observability checklist for any service.
#
# 1) requestId() at the top of the chain. trustIncoming=false unless
#    your edge proxy validates and rewrites the header.
# 2) createLogger with bindings: { service, env, region, version }.
#    Use ctx.log inside handlers, not the top-level instance.
# 3) timing() so the Network tab shows handler latency without
#    instrumentation in the frontend.
# 4) otelTracing({ tracer, spanName }) - TEMPLATE the span name. Raw
#    URLs are the most common source of cardinality explosions in
#    every observability bill on earth.
# 5) Wire contextFromRequest to your propagator. A trace that starts
#    at the frontend and ends in the database is the only kind worth
#    paying for.
# 6) Record exceptions and stamp http.response.status_code. The
#    framework does this for you - just verify in dev.
# 7) Tie logs to traces. Stamp the trace id on every log line; jump
#    from a log entry to the matching span in your UI of choice.
# 8) Keep the SDK out of @daloyjs/core. The portability story dies
#    the day you accept a hard dep on @opentelemetry/api.`;

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

function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

function HookCard({
  hook,
  purpose,
  children,
}: {
  hook: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {hook}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">{purpose}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

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
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Observability</Badge>
            <Badge variant="outline">OpenTelemetry</Badge>
            <Badge variant="outline">Production</Badge>
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
          <p>
            Devlin here. Most observability stacks I&apos;ve inherited follow
            the same pattern: somebody pinned an SDK in 2023, it grew global
            side effects, and now nobody can move the service off Node 18
            because the SDK&apos;s instrumentation hooks don&apos;t work on the
            new runtime. The cost of cleaning that up is &quot;next
            quarter&quot; forever. The whole reason DaloyJS keeps its
            observability story small is so you never have to write that
            sentence again.
          </p>

          <p>
            This post covers the four moving parts: <code>createLogger()</code>{" "}
            for structured JSON logs, <code>requestId()</code> for correlation,{" "}
            <code>timing()</code> for the free Server-Timing header, and{" "}
            <code>otelTracing()</code> for OpenTelemetry-shaped spans without a
            hard dependency on <code>@opentelemetry/api</code>
            {". "}Everything composes through the same{" "}
            <Link href="/blog/middleware-without-mystery-hooks-ordering-response-transformation">
              hooks lifecycle
            </Link>
            {", "}which is the only contract you need to understand to extend
            any of it.
          </p>

          <h2>Why this post exists</h2>

          <EditorFrame
            files={["postmortem-but-it's-the-tooling.md"]}
            activeFile="postmortem-but-it's-the-tooling.md"
            status="every fullstack team has this list, written or unwritten"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <h2>Structured logs in three lines</h2>

          <EditorFrame
            files={["src/log.ts"]}
            activeFile="src/log.ts"
            status="JSON to stdout · bindings on every line · child loggers for free"
          >
            <CodeBlock language="ts" code={LOGGER_BASIC} />
          </EditorFrame>

          <p>
            The default <code>createLogger</code> is intentionally tiny: JSON to
            stdout, level threshold, bindings merged into every record, and a{" "}
            <code>child(bindings)</code> method that returns a new logger with
            extra fields baked in. That last bit is the magic ingredient, the
            framework uses it to give every request its own logger pre-bound to
            the request id.
          </p>

          <p>For pino in production, the shape is intentionally compatible:</p>

          <EditorFrame
            files={["src/log.ts"]}
            activeFile="src/log.ts"
            status="pino · winston · noopLogger · anything matching the Logger interface"
          >
            <CodeBlock language="ts" code={LOGGER_PINO} />
          </EditorFrame>

          <h2>Request IDs are the spine</h2>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="requestId() + timing() + ctx.log child logger"
          >
            <CodeBlock language="ts" code={REQUEST_ID} />
          </EditorFrame>

          <p>What you get on the wire and in the log stream:</p>

          <EditorFrame
            files={["stdout · network response"]}
            activeFile="stdout · network response"
            status="every log line carries requestId · x-request-id mirrored on response"
          >
            <CodeBlock language="bash" code={LOG_OUTPUT} />
          </EditorFrame>

          <p>
            Two things to highlight. First, <code>trustIncoming: false</code> is
            the safe default, clients can send any header they want, and
            accepting an arbitrary id from the public internet lets them collide
            with (or impersonate) other requests in your log stream. Second,{" "}
            <code>timing()</code> writes the standard <code>Server-Timing</code>{" "}
            header so Chrome and Firefox DevTools surface handler latency in the
            Network tab with zero frontend code. Free observability is the best
            kind.
          </p>

          <h2>OpenTelemetry without the hard dependency</h2>

          <p>
            Here&apos;s the part most frameworks get wrong:{" "}
            <code>otelTracing()</code> is shaped like the{" "}
            <code>@opentelemetry/api</code> tracer, but the framework does not
            import it. The contract is two small interfaces in{" "}
            <code>src/tracing.ts</code>
            {": "}
            <code>TracingTracer</code> and <code>TracingSpan</code>
            {": "}and any object that fits them works. You install the OTel SDK
            in <em>your</em> <code>package.json</code>
            {", "}
            configure it in <em>your</em> bootstrap, and pass the tracer in. The
            portability story survives.
          </p>

          <EditorFrame
            files={["src/tracing.ts"]}
            activeFile="src/tracing.ts"
            status="tracer comes from your OTel SDK · spanName templated to keep cardinality sane"
          >
            <CodeBlock language="ts" code={OTEL_BASIC} />
          </EditorFrame>

          <h2>The four-hook lifecycle</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="onRequest · preBody · beforeHandle · onError · onSend"
          >
            <CodeBlock language="bash" code={OTEL_LIFECYCLE} />
          </EditorFrame>

          <HookCard
            hook="onRequest"
            purpose="Start the SERVER span, stamp HTTP attributes."
          >
            Uses OTel semantic conventions: <code>http.request.method</code>
            {", "}
            <code>url.path</code>
            {", "}
            <code>url.scheme</code>
            {", "}
            <code>server.address</code>
            {", "}
            <code>url.query</code>
            {", "}
            <code>user_agent.original</code>
            {". "}Your dashboards work without translation.
          </HookCard>
          <HookCard
            hook="beforeHandle"
            purpose="Expose the span on ctx.state.otelSpan."
          >
            The <code>stateKey</code> is configurable. Default is{" "}
            <code>otelSpan</code>
            {". "}Handlers add events / child spans / custom attributes here.
          </HookCard>
          <HookCard hook="onError" purpose="recordException() + ERROR status.">
            Runs exactly once. The error is captured as a structured exception
            event with name and message, ready for your APM to group on.
          </HookCard>
          <HookCard hook="onSend" purpose="status_code, 5xx escalation, end().">
            <code>span.end()</code> fires exactly once per request even if the
            handler threw. WeakMap-keyed by Request so it&apos;s safe across
            async boundaries.
          </HookCard>

          <h2>Adding your own semantic attributes</h2>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="OTel naming conventions · tie request id and trace together in logs"
          >
            <CodeBlock language="ts" code={SEMANTIC_ATTRS} />
          </EditorFrame>

          <h2>The escape hatch: no OTel SDK at all</h2>

          <p>
            The interfaces really are tiny. You can ship traces from a Worker
            without installing a single OTel package:
          </p>

          <EditorFrame
            files={["src/tracing.ts"]}
            activeFile="src/tracing.ts"
            status="hand-rolled TracingTracer · 30 lines · runs on any runtime with fetch"
          >
            <CodeBlock language="ts" code={NO_OTEL_SDK} />
          </EditorFrame>

          <h2>Parent-context propagation, your way</h2>

          <EditorFrame
            files={["src/tracing.ts"]}
            activeFile="src/tracing.ts"
            status="contextFromRequest · use the propagator of your choice · headers are just headers"
          >
            <CodeBlock language="ts" code={PARENT_CONTEXT} />
          </EditorFrame>

          <p>
            If you do not need the OTel propagator, read
            <code>traceparent</code> from the headers and return a minimal
            parent context object. The framework does not care what shape the
            parent context has; it passes it through to <code>startSpan</code>{" "}
            unchanged.
          </p>

          <h2>Composing exporters and access logs</h2>

          <EditorFrame
            files={["src/tracing.ts"]}
            activeFile="src/tracing.ts"
            status="otelTracing returns Hooks · wrap them like any other hook"
          >
            <CodeBlock language="ts" code={CUSTOM_EXPORTER} />
          </EditorFrame>

          <h2>Testing observability without a backend</h2>

          <EditorFrame
            files={["tests/observability.test.ts"]}
            activeFile="tests/observability.test.ts"
            status="node:test + in-memory tracer + app.request() · fast and deterministic"
          >
            <CodeBlock language="ts" code={TESTING} />
          </EditorFrame>

          <h2>Per-runtime notes</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="Node · Workers · Lambda"
          >
            <CodeBlock language="bash" code={RUNTIME_NOTES} />
          </EditorFrame>

          <p>
            Same story as the rest of the framework (see the{" "}
            <Link href="/blog/same-app-five-runtimes-verified">
              five-runtimes post
            </Link>
            ): one app, swap the transport per environment, keep the handler
            code identical.
          </p>

          <h2>The pre-flight checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="eight items · pin it next to the runbook"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Keep the telemetry boundary small</h2>

          <p>
            Observability is one of those areas where the bad decisions are
            invisible until you try to leave them. DaloyJS&apos;s answer is to
            keep every contract small enough that &quot;leaving&quot; is just
            &quot;swap one tiny implementation for another&quot;:{" "}
            <code>Logger</code> is seven methods, <code>TracingTracer</code> is
            one method, <code>Hooks</code> is the same lifecycle every other
            middleware uses. No globals to fight, no SDK to bribe, no runtime to
            leave behind.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              RFC 9457 errors post
            </Link>{" "}
            for what gets recorded on the span when handlers throw, the{" "}
            <Link href="/blog/rate-limiting-that-survives-multiple-instances">
              rate-limit post
            </Link>{" "}
            for the other &quot;tiny pluggable contract&quot; story, and the{" "}
            <Link href="/blog/middleware-without-mystery-hooks-ordering-response-transformation">
              middleware lifecycle
            </Link>{" "}
            post for the hooks that make all of this possible.
          </p>

          <p>Devlin</p>
        </div>

        <Separator className="my-12" />

        <footer className="not-prose">
          <div className="rounded-xl border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">{POST.author}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {POST.authorBio}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href="/docs" className="underline underline-offset-4">
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/rate-limiting-that-survives-multiple-instances"
                className="underline underline-offset-4"
              >
                Rate-limit post
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link href="/blog" className="underline underline-offset-4">
                More posts
              </Link>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}
