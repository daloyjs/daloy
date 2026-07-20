import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "middleware-without-mystery-hooks-ordering-response-transformation",
  title:
    "Middleware Without Mystery: Hooks, Ordering, and Response Transformation",
  description:
    "The DaloyJS request lifecycle, end to end: onRequest → preBody → validation → beforeHandle → handler → afterHandle → onSend → onResponse, plus onError on the error path. Where each hook fires and what belongs in each slot.",
  date: "2026-05-30",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    'Ten years of fullstack, currently writing TypeScript from a desk in Norway. Has explained "why is my middleware running twice" enough times to make a poster of it.',
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS hooks",
    "onRequest preBody beforeHandle afterHandle",
    "onSend onResponse onError",
    "middleware ordering",
    "request lifecycle",
    "plugin composition",
    "response transformation",
    "short-circuit middleware",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HOOKS_INTERFACE = `// @daloyjs/core, the entire Hooks interface, no surprises.
export interface Hooks {
  onRequest?:    (req: Request)                        => void | Promise<void>;
  preBody?:      (ctx: PreBodyContext)                 => void | Response | Promise<void | Response>;
  beforeHandle?: (ctx: BaseContext)                    => void | Response | Promise<void | Response>;
  afterHandle?:  (ctx: BaseContext, result: unknown)   => void | unknown | Promise<void | unknown>;
  onSend?:       (res: Response, ctx?: BaseContext)    => void | Response | Promise<void | Response>;
  onResponse?:   (res: Response)                       => void | Promise<void>;
  onError?:      (err: unknown, ctx?: BaseContext)     => void | Response | Promise<void | Response>;
}
//
// Successful request order:
//   onRequest → preBody → validation/body read → beforeHandle → handler → afterHandle → onSend → onResponse
// Error path:
//   onRequest → (anywhere it throws) → onError → onSend → onResponse`;

const LIFECYCLE_ASCII = `time ─────────────────────────────────────────────────────────────────▶

   ┌──────────┐   ┌─────────┐   ┌────────────┐   ┌──────────────┐   ┌─────────┐
   │onRequest │ → │ preBody │ → │ validation │ → │ beforeHandle │ → │ handler │ → …
   └──────────┘   └─────────┘   └────────────┘   └──────────────┘   └─────────┘
        ▲              │               │ body read            │ may return
        │              ▼ may reject    │ when declared        ▼ a Response
        │
   raw Request                                              ┌────────┐
        │                  ┌────────────┐   ┌────────────┐  │ socket │
        │              … → │   onSend   │ → │ onResponse │→ │ closes │
        │                  └────────────┘   └────────────┘  └────────┘
        │                      │ may                fire-and-forget
        │                      ▼ replace             observer
        │
        └──[ anywhere throws ]──▶  onError  ─▶  Response  ─▶  onSend  ─▶  onResponse`;

const SCOPES = `// Three scopes. Composed in this order. No magic.
const app = new App({
  hooks: { /* (1) GLOBAL - runs first, every request, every route */ },
});

app.use({  /* (2) GROUP  - runs after global, on routes registered AFTER this */ });

app.route({
  method: "GET",
  path: "/admin",
  handler: ...,
  hooks: { /* (3) ROUTE - runs last, only on THIS route */ },
});

// Each hook *kind* (onRequest, preBody, beforeHandle, etc.) composes pipeline-style:
// global onSend, then every group onSend in registration order, then route onSend.
// First one to return a new Response wins the next stage's input.`;

const SHORT_CIRCUIT = `// src/middleware/maintenance.ts, short-circuit BEFORE the handler runs.
import type { Hooks } from "@daloyjs/core";

export function maintenanceMode(opts: { enabled: () => boolean }): Hooks {
  return {
    beforeHandle(ctx) {
      if (!opts.enabled()) return;            // ← void: continue the pipeline
      if (ctx.route?.path === "/healthz") return; // ← let liveness through
      return new Response(
        JSON.stringify({
          type:   "https://daloyjs.dev/errors/service-unavailable",
          title:  "Maintenance in progress",
          status: 503,
          detail: "Back in roughly 5 minutes. Thank you for your patience.",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "300",
          },
        },
      );
    },
  };
}

// Globally:
app.use(maintenanceMode({ enabled: () => process.env.MAINTENANCE === "1" }));`;

const AUTH_BEFORE = `// src/middleware/require-role.ts, a per-route authorization gate.
// Built-in header/certificate authentication runs earlier in preBody, before
// upload I/O. Authorization that needs validated identity/input belongs in
// beforeHandle, where short-circuiting still prevents the handler and DB work.

export function requireRole(role: string): Hooks {
  return {
    beforeHandle(ctx) {
      const user = ctx.state.session?.user;
      if (!user)               throw new UnauthorizedError("Sign in first");
      if (!user.roles?.includes(role))
                               throw new ForbiddenError(\`Need role: \${role}\`);
    },
  };
}

app.route({
  method: "DELETE",
  path: "/admin/users/:id",
  handler: deleteUser,
  hooks: { ...requireRole("admin") },   // ← scoped to THIS route only
});`;

const AFTER_HANDLE = `// afterHandle, transform the handler's return value before serialization.
// Use sparingly. 95% of the time you should just shape the body in the handler.
// Real use case: redact PII from a generic search response across many routes.

export function redactEmail(): Hooks {
  return {
    afterHandle(ctx, result) {
      if (!ctx.route?.path.startsWith("/v1/search")) return; // narrow scope
      // result is whatever the handler returned: { status, body, headers? }.
      // Return a new value, or undefined to leave it alone.
      const shaped = result as { status: number; body: Array<{ email?: string }> };
      return {
        ...shaped,
        body: shaped.body.map((row) =>
          row.email ? { ...row, email: row.email.replace(/(?<=.).(?=[^@]*?@)/g, "*") } : row,
        ),
      };
    },
  };
}`;

const ON_SEND_HEADERS = `// onSend, the right place to stamp response headers on EVERY response,
// including the ones produced by error paths and OPTIONS preflights.

export function stampServerTiming(): Hooks {
  return {
    beforeHandle(ctx) {
      ctx.state._startedAt = performance.now();
    },
    onSend(res, ctx) {
      // Mutate in place - no need to return a new Response.
      const elapsed = performance.now() - (ctx?.state._startedAt ?? 0);
      res.headers.set("server-timing", \`app;dur=\${elapsed.toFixed(1)}\`);
      res.headers.set("x-request-id", ctx?.requestId ?? "unknown");
    },
  };
}

app.use(stampServerTiming());

// You can also REPLACE the response by returning a new one:
//   onSend(res) {
//     if (res.status !== 401) return;
//     return new Response(res.body, {
//       status: 401,
//       headers: { ...Object.fromEntries(res.headers), "www-authenticate": "Bearer" },
//     });
//   }`;

const ON_RESPONSE_OBS = `// onResponse, fire-and-forget observer. Cannot change anything.
// This is your logging/metrics/audit slot. By design it cannot accidentally
// break the response because the bytes are already in flight.

export function accessLog(): Hooks {
  return {
    onResponse(res) {
      // \`res\` is the SAME response the client received.
      logger.info(
        {
          status: res.status,
          contentType: res.headers.get("content-type"),
          bytes: res.headers.get("content-length"),
        },
        "http",
      );
    },
  };
}

// Same place is perfect for metrics:
//   metrics.histogram("http_response_status").observe(res.status);
//   metrics.counter("http_responses_total").inc({ status: res.status });`;

const ON_ERROR = `// onError, runs on the error path before the response is serialized.
// Return a Response to take over rendering; return nothing to fall through to
// the framework's default RFC 9457 serialization (which is what you usually want).

app.use({
  onError(err, ctx) {
    // 1. Always log. The framework will not double-log.
    ctx?.log.error(
      {
        err,
        requestId: ctx.requestId,
        route: ctx.route?.operationId,
      },
      "unhandled",
    );

    // 2. Translate a specific upstream library error into a domain HttpError.
    if (err instanceof PaymentGatewayTimeout) {
      return new ServiceUnavailableError("Payments are slow right now").toResponse();
    }

    // 3. Anything else: fall through. The framework wraps unknown errors as
    //    InternalError and serializes them as problem+json with the right
    //    production redaction baked in.
  },
});`;

const ORDERING_EXAMPLE = `// Watch the order. The console output is the easiest way to internalize it.
const app = new App({
  hooks: {
    onRequest:    () => console.log("[1] global  onRequest"),
    preBody:      () => console.log("[2] global  preBody"),
    beforeHandle: () => console.log("[4] global  beforeHandle"),
    afterHandle:  () => console.log("[8] global  afterHandle"),
    onSend:       () => console.log("[10] global onSend"),
    onResponse:   () => console.log("[12] global onResponse"),
  },
});

app.use({
  preBody:      () => console.log("[3] group   preBody"),
  beforeHandle: () => console.log("[5] group   beforeHandle"),
  afterHandle:  () => console.log("[9] group   afterHandle"),
  onSend:       () => console.log("[11] group   onSend"),
});

app.route({
  method: "GET",
  path: "/x",
  handler: async () => {
    console.log("[7] handler runs");
    return { status: 200, body: { ok: true } };
  },
  hooks: {
    beforeHandle: () => console.log("[6] route   beforeHandle"),
  },
});

// $ curl http://localhost:3000/x
// [1] global  onRequest
// [2] global  preBody
// [3] group   preBody
// [4] global  beforeHandle
// [5] group   beforeHandle
// [6] route   beforeHandle
// [7] handler runs
// [8] global  afterHandle
// [9] group   afterHandle
// [10] global onSend
// [11] group  onSend
// [12] global onResponse`;

const PLUGIN_COMPOSITION = `// src/plugins/observability.ts, encapsulated plugin.
// Routes/hooks registered inside \`register\` are scoped to the child app.
import type { App, Hooks } from "@daloyjs/core";

export const observability = {
  name: "observability",
  register(child: App) {
    child.use(stampServerTiming());
    child.use(accessLog());

    // You can mount routes too - they get the prefix from the parent's call.
    child.route({
      method: "GET",
      path: "/metrics",
      operationId: "metrics",
      responses: { 200: { description: "Prometheus exposition" } },
      handler: async () => ({
        status: 200,
        body: await metrics.render(),
        headers: { "content-type": "text/plain; version=0.0.4" },
      }),
    });
  },
};

// Mount it like this:
app.register(observability, {
  prefix: "/_ops",            // every route inside lives under /_ops
  hooks: { /* extra hooks just for this plugin's scope */ },
  auth: false,                // turn off global auth inside the plugin
});`;

const RECIPE_TABLE = `# What goes where, print this out, tape it to your monitor.

onRequest      ↳ stuff that needs the raw Request (TLS termination metadata,
                 conditional request decoding). No context yet. Cannot decide.

preBody        ↳ CHEAP PERIMETER AUTH. Raw params/query/headers, body undefined.
                 Reject bearer/basic/JWK/mTLS failures before upload I/O.

beforeHandle   ↳ VALIDATED-INPUT AUTHZ. WAF. IDEMPOTENCY. RATE LIMITING.
                 Anything that needs parsed schemas before the handler runs.

handler        ↳ your code. Nothing else.

afterHandle    ↳ shape transformations that span MANY routes (PII redaction,
                 envelope wrapping). 95% of the time, just shape it in the handler.

onSend         ↳ response HEADERS for every response (success + error + OPTIONS).
                 Server-Timing, X-Request-Id, Strict-Transport-Security, CSP, …

onResponse     ↳ FIRE-AND-FORGET observers. Logging. Metrics. Audit events.
                 Cannot change the response. This is by design.

onError        ↳ translate framework-foreign errors into HttpError subclasses,
                 log once, fall through to the default problem+json serializer.`;

const ANTIPATTERNS = `# Three patterns that look smart but bite you in production:

# 1) Mutating ctx.state in onResponse. Too late! The response is already gone.
#    Put state changes in beforeHandle / afterHandle. Put OBSERVATION in onResponse.

# 2) Doing auth in afterHandle. The handler already ran. Header/certificate auth
#    belongs in preBody; authorization that needs validated input in beforeHandle.

# 3) Catching errors in beforeHandle to "swallow" them. The framework already
#    does graceful error → problem+json conversion. Trust it. If you need to
#    REWRITE the error, do it in onError. If you need to PREVENT it, do it in
#    beforeHandle with a short-circuit Response or a thrown HttpError.`;

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
  name,
  step,
  signature,
  canReturn,
  description,
}: {
  name: string;
  step: string;
  signature: string;
  canReturn: string;
  description: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {step}
        </Badge>
        <code className="font-mono text-sm font-semibold">{name}</code>
        <code className="text-[11px] text-muted-foreground sm:text-xs">
          {signature}
        </code>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 font-mono text-xs tracking-wide text-muted-foreground uppercase">
        can return → {canReturn}
      </p>
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
            <Badge variant="outline">Internals</Badge>
            <Badge variant="outline">DX</Badge>
            <Badge variant="outline">Middleware</Badge>
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
            Hi, Devlin. Ten years of fullstack, currently in Norway, currently
            re-reading my own &quot;why is this middleware running twice&quot;
            Slack threads from 2018, 2021, and 2024, every framework, same
            question, same shrug. So here is the post I wish someone had pinned
            in the channel: every DaloyJS lifecycle hook, in order, with a
            one-sentence rule for what belongs in each one.
          </p>

          <p>
            The good news: there are six hooks. The better news: they fire in
            the order they appear in the code, in the order you registered them,
            in three nested scopes (global → group → route). No adapter shim, no
            &quot;extends&quot; chain, no hidden re-entry. You read the file,
            you know what happens.
          </p>

          <h2>The whole API in one screen</h2>

          <EditorFrame
            files={["@daloyjs/core · types.ts"]}
            activeFile="@daloyjs/core · types.ts"
            status="six hooks · two phases · zero hidden ones"
          >
            <CodeBlock language="ts" code={HOOKS_INTERFACE} />
          </EditorFrame>

          <h2>The lifecycle, drawn</h2>

          <EditorFrame
            files={["docs/lifecycle.txt"]}
            activeFile="docs/lifecycle.txt"
            status="hot path top · error path bottom · happens in one tick"
          >
            <CodeBlock language="bash" code={LIFECYCLE_ASCII} />
          </EditorFrame>

          <h2>Each hook, with the one-line rule</h2>

          <HookCard
            step="1"
            name="onRequest"
            signature="(req: Request) => void | Promise<void>"
            canReturn="nothing (observer over the raw Request)"
            description={
              <>
                Fires before any context is built. You see the raw{" "}
                <code>Request</code>
                {". "}Use this for things that need the untouched body or
                headers, TLS hints, conditional decode of the raw byte stream.
              </>
            }
          />
          <HookCard
            step="2"
            name="preBody"
            signature="(ctx: PreBodyContext) => void | Response"
            canReturn="a Response before request-body I/O"
            description={
              <>
                Fires after routing with raw params, query, and headers, while{" "}
                <code>ctx.body</code> is guaranteed to be undefined. This is the
                perimeter slot for cheap bearer, basic, JWK, API-key, and mTLS
                authentication that should reject an upload before reading it.
              </>
            }
          />
          <HookCard
            step="3"
            name="beforeHandle"
            signature="(ctx) => void | Response"
            canReturn="a Response to short-circuit the handler"
            description={
              <>
                This hook sees schema-validated input and any parsed body. Put
                body-aware authorization, WAF inspection, idempotency, and
                validated-identity rate limits here. Return a{" "}
                <code>Response</code> here and the handler never runs. Throw an{" "}
                <code>HttpError</code> here and the framework turns it into RFC
                9457 problem+json for you.
              </>
            }
          />
          <HookCard
            step="4"
            name="handler"
            signature="(ctx) => { status; body; headers? }"
            canReturn="the result, always"
            description={
              <>
                Your code. Nothing else lives here. If you find yourself writing
                &quot;middleware-ish&quot; logic at the top of a handler,
                that&apos;s a sign it wants to be a hook.
              </>
            }
          />
          <HookCard
            step="5"
            name="afterHandle"
            signature="(ctx, result) => void | unknown"
            canReturn="a transformed result"
            description={
              <>
                Transform the handler&apos;s return value <em>before</em> the
                framework serializes and validates it. Use sparingly. Reach for
                it when the transformation spans many routes, global PII
                redaction, envelope wrapping. For a single endpoint, just shape
                the body in the handler.
              </>
            }
          />
          <HookCard
            step="6"
            name="onSend"
            signature="(res: Response, ctx?) => void | Response"
            canReturn="a replacement Response (or mutate headers in place)"
            description={
              <>
                Fires after the <code>Response</code> is built, on{" "}
                <strong>every</strong> response (success, error, OPTIONS
                preflight). This is the right place to stamp universal headers:{" "}
                <code>X-Request-Id</code>
                {", "}<code>Server-Timing</code>
                {", "}security headers. Mutate <code>res.headers</code> in
                place, or return a brand-new <code>Response</code> to replace it
                entirely.
              </>
            }
          />
          <HookCard
            step="7"
            name="onResponse"
            signature="(res: Response) => void | Promise<void>"
            canReturn="nothing (the response already left)"
            description={
              <>
                Fire-and-forget observer. By design, it cannot change the
                response, the bytes are already on the wire. This is your
                logging, metrics, and audit-event slot. Safe to put slow stuff
                here (within reason); it won&apos;t block the client.
              </>
            }
          />
          <HookCard
            step="!"
            name="onError"
            signature="(err, ctx?) => void | Response"
            canReturn="a Response to take over rendering"
            description={
              <>
                Runs on the error path before serialization. Log once, translate
                library-foreign errors into your own <code>HttpError</code>{" "}
                subclasses, then fall through to the default problem+json
                serializer (which already does production redaction, see the{" "}
                <Link href="/blog/problem-details-done-right-rfc-9457-errors">
                  RFC 9457 errors post
                </Link>
                ).
              </>
            }
          />

          <h2>Three scopes, composed</h2>

          <p>
            Each kind of hook can be registered at three levels. They compose
            pipeline-style: global runs first, then group, then route. Same hook
            kind at the same level composes in registration order. That&apos;s
            it. There is no &quot;priority&quot; field.
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="global → group (app.use) → route (route.hooks)"
          >
            <CodeBlock language="ts" code={SCOPES} />
          </EditorFrame>

          <h2>Watch the order in your terminal</h2>

          <p>
            If you don&apos;t internalize one other thing from this post,
            internalize this snippet. It&apos;s the fastest way to lock the
            ordering into your fingers:
          </p>

          <EditorFrame
            files={["scripts/lifecycle-demo.ts"]}
            activeFile="scripts/lifecycle-demo.ts"
            status="run it · read the numbers · keep it in muscle memory"
          >
            <CodeBlock language="ts" code={ORDERING_EXAMPLE} />
          </EditorFrame>

          <h2>Recipe 1: Short-circuit with beforeHandle</h2>

          <p>
            The maintenance-window pattern, written once, applied globally, with
            an escape hatch for the liveness probe so your orchestrator
            doesn&apos;t kill the pod while you&apos;re fixing things:
          </p>

          <EditorFrame
            files={["src/middleware/maintenance.ts"]}
            activeFile="src/middleware/maintenance.ts"
            status="return a Response → handler never runs → RFC 9457 503 + Retry-After"
          >
            <CodeBlock language="ts" code={SHORT_CIRCUIT} />
          </EditorFrame>

          <EditorFrame
            files={["src/middleware/require-role.ts"]}
            activeFile="src/middleware/require-role.ts"
            status="throw HttpError → framework serializes problem+json for free"
          >
            <CodeBlock language="ts" code={AUTH_BEFORE} />
          </EditorFrame>

          <h2>Recipe 2: Stamp headers with onSend</h2>

          <p>
            Server-Timing on every response, including errors and preflights.
            Notice the pattern: stash the start time in <code>ctx.state</code>{" "}
            from <code>beforeHandle</code>
            {", "}read it from <code>onSend</code>
            {". "}
            Mutate the response headers in place, no need to return a new{" "}
            <code>Response</code>
            {": "}
          </p>

          <EditorFrame
            files={["src/middleware/server-timing.ts"]}
            activeFile="src/middleware/server-timing.ts"
            status="mutate res.headers in place · ctx.requestId on every response"
          >
            <CodeBlock language="ts" code={ON_SEND_HEADERS} />
          </EditorFrame>

          <h2>Recipe 3: Log with onResponse</h2>

          <p>
            Anything that you&apos;d call <em>observation</em> belongs in{" "}
            <code>onResponse</code>
            {". "}The framework guarantees you can&apos;t accidentally break
            the request from here, which is exactly the constraint you want
            around log lines that someone added at 3 a.m. on a Friday.
          </p>

          <EditorFrame
            files={["src/middleware/access-log.ts"]}
            activeFile="src/middleware/access-log.ts"
            status="fire-and-forget · cannot mutate · cannot replace"
          >
            <CodeBlock language="ts" code={ON_RESPONSE_OBS} />
          </EditorFrame>

          <h2>Recipe 4: Translate errors with onError</h2>

          <EditorFrame
            files={["src/middleware/error-translation.ts"]}
            activeFile="src/middleware/error-translation.ts"
            status="log once · translate vendor errors · fall through for everything else"
          >
            <CodeBlock language="ts" code={ON_ERROR} />
          </EditorFrame>

          <h2>Recipe 5: Transform with afterHandle (carefully)</h2>

          <EditorFrame
            files={["src/middleware/redact-email.ts"]}
            activeFile="src/middleware/redact-email.ts"
            status="cross-cutting transform · narrow scope by route path"
          >
            <CodeBlock language="ts" code={AFTER_HANDLE} />
          </EditorFrame>

          <h2>Plugins: hooks + routes, encapsulated</h2>

          <p>
            For anything you&apos;d ship as a unit, a metrics endpoint plus its{" "}
            <code>onResponse</code> observer, a sessions store plus its{" "}
            <code>beforeHandle</code> reader, use <code>app.register()</code>
            {". "}
            Inside the plugin you get a child <code>App</code> whose hooks and
            routes are scoped to the mount point. The plugin can ship its own
            prefix, its own hooks, and its own auth defaults without leaking
            into the parent app:
          </p>

          <EditorFrame
            files={["src/plugins/observability.ts"]}
            activeFile="src/plugins/observability.ts"
            status="encapsulated plugin · prefix-scoped · own hooks"
          >
            <CodeBlock language="ts" code={PLUGIN_COMPOSITION} />
          </EditorFrame>

          <h2>The cheat sheet</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="tape this to your monitor · seriously"
          >
            <CodeBlock language="bash" code={RECIPE_TABLE} />
          </EditorFrame>

          <h2>The three patterns I keep deleting in code review</h2>

          <EditorFrame
            files={["ANTIPATTERNS.md"]}
            activeFile="ANTIPATTERNS.md"
            status="bookmark · re-read every six months"
          >
            <CodeBlock language="bash" code={ANTIPATTERNS} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            Middleware in DaloyJS is one interface, <code>Hooks</code>
            {", "}with six method slots. Three scopes, composed in a fixed
            order. One side-channel for errors. That is the whole machine. Once
            the mental model clicks, you stop asking <em>where does this go</em>{" "}
            and start asking <em>which scope</em>
            {": "}which is a far more interesting question, and one whose
            answer you can usually argue about in a Slack thread without anyone
            getting hurt.
          </p>

          <p>
            For the surrounding pieces:{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              RFC 9457 errors
            </Link>{" "}
            is the contract <code>onError</code> serializes into;{" "}
            <Link href="/blog/sessions-on-the-edge">sessions</Link> is the most
            common <code>beforeHandle</code> consumer you&apos;ll write; and the{" "}
            <Link href="/blog/building-a-bookstore-api-with-daloyjs-from-scratch">
              bookstore tutorial
            </Link>{" "}
            shows the whole pipeline running against a real route table.
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
                href="/blog/building-a-bookstore-api-with-daloyjs-from-scratch"
                className="underline underline-offset-4"
              >
                Bookstore tutorial
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
