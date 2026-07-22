import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "plugin-lifecycle-events-for-large-team-framework-code",
  title: "Plugin Lifecycle Events for Large-Team Framework Code",
  description:
    "Why DaloyJS exposes onPluginInstalled() and onShutdown() as first-class events, and how a platform team uses them to ship observability, service registration, graceful drain, metrics flushing, and policy plugins that every route inherits, without a single import in the route files themselves.",
  date: "2026-06-04",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, now in Norway. Spent at least three of those years staring at routes that had to import the infra layer directly because the framework didn't have a place for cross-cutting concerns. Has opinions about that, apparently.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS plugin lifecycle",
    "onPluginInstalled",
    "onShutdown graceful drain",
    "platform team framework",
    "service registration plugin",
    "metrics flushing on shutdown",
    "Fastify-style register",
    "TypeScript framework architecture",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# The pattern every large-team backend eventually grows:
#
# routes/users.ts
#   import { metrics } from "../platform/metrics.js";       // ← infra import
#   import { registry } from "../platform/registry.js";     // ← infra import
#   import { tracer } from "../platform/tracing.js";        // ← infra import
#   import { drainSignal } from "../platform/drain.js";     // ← infra import
#
#   handler(ctx) {
#     metrics.inc("users.read");
#     const span = tracer.startSpan("users.read");
#     if (drainSignal.shouldRefuse()) return { status: 503, ... };
#     ...
#   }
#
# Multiply by 200 route files. Every "small" platform change is now a
# 200-file pull request. Every junior dev learns to copy-paste the
# preamble. Every audit finds three routes that forgot one of them.
#
# The fix is not "discipline". The fix is to give the platform team a
# place to hang cross-cutting concerns that's NOT inside the route
# files. That place is the plugin lifecycle.`;

const TWO_EVENTS = `// Two events, that's the whole API:
//
//   app.onPluginInstalled(listener)
//     ↑ fires once per app.register(...) call, AFTER the plugin's
//       register() (sync or async) finishes. Gets { name?, prefix }.
//
//   app.onShutdown(listener)
//     ↑ fires when app.shutdown() starts, BEFORE in-flight requests
//       drain. Gets { reason?, timeoutMs }.
//
// Plus the two you already knew about:
//
//   app.onClose(hook)             // AFTER drain - close pools, etc.
//   await app.ready()             // waits for async plugins
//
// That's the entire surface for cross-cutting platform plugins.
// Everything below is built on those four primitives.`;

const APP_REGISTER = `// What a Fastify-style register() call looks like in DaloyJS.
// The plugin is just a function that receives a SCOPED child App.
import { App } from "@daloyjs/core";
import type { Hooks } from "@daloyjs/core";

const app = new App();

app.register(
  {
    name: "users",
    register: (child) => {
      child.route({
        method: "GET",
        path: "/me",
        operationId: "getMe",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200, body: {} }),
      });
    },
  },
  {
    prefix: "/v1/users",
    tags: ["users"],
    hooks: {} satisfies Hooks,           // group-scoped middleware
  },
);

// Every register() fires onPluginInstalled exactly once, with:
//   { name: "users", prefix: "/v1/users" }
//
// Anonymous plugins (passed as a bare function) fire too, with name=undefined.`;

const REGISTRY_PLUGIN = `// platform/registry-plugin.ts, a service registration plugin.
// Run by the platform team. Routes are unaware. Operations gets a
// real-time inventory of what each pod actually serves.
import type { App } from "@daloyjs/core";
import { fetch } from "undici";

export function registrationPlugin(consul: { url: string; token: string }) {
  const installed: Array<{ name?: string; prefix: string }> = [];
  let serviceId: string | null = null;

  return (app: App) => {
    // Collect every mounted plugin without touching route code.
    app.onPluginInstalled((info) => {
      installed.push(info);
    });

    // Register on boot (after ready), deregister on shutdown.
    app.onShutdown(async ({ reason }) => {
      if (!serviceId) return;
      await fetch(\`\${consul.url}/v1/agent/service/deregister/\${serviceId}\`, {
        method: "PUT",
        headers: { "x-consul-token": consul.token },
      });
      app.log.info({ event: "deregistered", serviceId, reason });
    });

    // app.onClose runs AFTER drain - perfect for releasing
    // the registration lock if your service mesh holds one.
    app.onClose(async () => {
      // ...release any final platform resource
    });

    // The boot side: call this from your main() after await app.ready().
    return async function register(serviceName: string, address: string) {
      serviceId = \`\${serviceName}-\${crypto.randomUUID()}\`;
      const meta = Object.fromEntries(
        installed.map((p, i) => [\`plugin_\${i}\`, \`\${p.name ?? "anon"}@\${p.prefix}\`]),
      );
      await fetch(\`\${consul.url}/v1/agent/service/register\`, {
        method: "PUT",
        headers: { "x-consul-token": consul.token, "content-type": "application/json" },
        body: JSON.stringify({ ID: serviceId, Name: serviceName, Address: address, Meta: meta }),
      });
      app.log.info({ event: "registered", serviceId, plugins: installed.length });
    };
  };
}`;

const METRICS_PLUGIN = `// platform/metrics-plugin.ts, Prometheus-style metrics, flushed on shutdown.
// One platform-team file. Routes never import metrics directly.
import type { App, Hooks } from "@daloyjs/core";
import { register, Counter, Histogram } from "prom-client";

const httpRequests = new Counter({
  name: "http_requests_total",
  help: "Count of HTTP responses by status class",
  labelNames: ["method", "status_class", "plugin"],
});
const httpLatency = new Histogram({
  name: "http_request_duration_seconds",
  help: "Latency by plugin",
  labelNames: ["method", "plugin"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export function metricsPlugin(opts: { pushGatewayUrl?: string; job: string }) {
  return (app: App) => {
    // Per-plugin label is captured at install time - no global mutable state
    // racing inside hot handlers.
    const labelByPrefix = new Map<string, string>();
    app.onPluginInstalled(({ name, prefix }) => {
      labelByPrefix.set(prefix, name ?? "anon");
    });

    const hooks: Hooks = {
      beforeHandle(ctx) {
        (ctx.state as Record<string, unknown>).__metricsStart = performance.now();
      },
      onSend(res, ctx) {
        if (!ctx) return;
        const start = (ctx.state as Record<string, unknown>).__metricsStart as number;
        const url = new URL(ctx.request.url);
        const plugin = nearestPrefix(labelByPrefix, url.pathname);
        const sec = (performance.now() - start) / 1000;
        const statusClass = \`\${Math.floor(res.status / 100)}xx\`;
        httpRequests.inc({ method: ctx.request.method, status_class: statusClass, plugin });
        httpLatency.observe({ method: ctx.request.method, plugin }, sec);
      },
    };
    app.use(hooks);

    // The whole point: flush metrics on graceful shutdown, BEFORE drain.
    // We've still got network and CPU; once we start refusing requests we
    // also lose the ability to make outbound calls reliably.
    app.onShutdown(async ({ reason }) => {
      if (!opts.pushGatewayUrl) return;
      const body = await register.metrics();
      await fetch(\`\${opts.pushGatewayUrl}/metrics/job/\${opts.job}\`, {
        method: "POST",
        body,
      });
      app.log.info({ event: "metrics_pushed", reason });
    });
  };
}

function nearestPrefix(map: Map<string, string>, path: string) {
  let best: { prefix: string; label: string } = { prefix: "/", label: "root" };
  for (const [prefix, label] of map) {
    if (path.startsWith(prefix) && prefix.length > best.prefix.length) {
      best = { prefix, label };
    }
  }
  return best.label;
}`;

const SHUTDOWN_FLOW = `# What happens when app.shutdown() is called:
#
# T+0       app.shutdown(10_000, "SIGTERM") starts.
#           - this.draining = true  -> every NEW request gets
#             503 Service Unavailable + Retry-After: 5.
#           - onShutdown listeners fire IN ORDER:
#               1) metrics -> push to gateway     (last chance to send)
#               2) service registry -> deregister (so the LB stops
#                  sending us new traffic; the 503 above is a
#                  safety net for traffic already in flight)
#               3) tracing -> flush span buffer
#               4) feature flags -> snapshot decisions for debugging
#
# T+t       Drain loop polls inflight count every 25ms.
#           Waits up to timeoutMs for in-flight requests to settle.
#
# T+drained onClose hooks fire:
#               - close DB pool
#               - close redis
#               - close queue consumers
#
# T+done    Single log line: "DaloyJS shutdown complete".
#
# Both Node and Bun adapters call app.shutdown() automatically on
# SIGINT and SIGTERM. Other runtimes (Workers, Lambda) call it from
# your handler when the lifecycle event fires.`;

const POLICY_PLUGIN = `// platform/policy-plugin.ts, central tagging / enforcement.
// Use onPluginInstalled to AUDIT every plugin's mount, and fail boot
// if anything violates the platform-team policy.
import type { App } from "@daloyjs/core";

interface Policy {
  /** Plugin name -> required prefix pattern */
  prefixRules: RegExp;
  /** Plugin names that must be present in every build */
  required: string[];
  /** Plugin names that are forbidden in production */
  forbiddenInProd?: string[];
}

export function policyPlugin(policy: Policy) {
  const env = process.env.NODE_ENV ?? "development";
  const seen = new Set<string>();
  const violations: string[] = [];

  return (app: App) => {
    app.onPluginInstalled(({ name, prefix }) => {
      if (name) seen.add(name);
      if (!policy.prefixRules.test(prefix)) {
        violations.push(\`plugin \${name ?? "anon"} mounted at non-conforming prefix "\${prefix}"\`);
      }
      if (env === "production" && name && policy.forbiddenInProd?.includes(name)) {
        violations.push(\`plugin \${name} is forbidden in production\`);
      }
    });

    // Call this AFTER all app.register() calls and AFTER await app.ready().
    // Bonus: most platforms put this inside a tiny "verifyBoot()" helper
    // that the main() entry calls before serve().
    (app as App & { verifyPolicy?: () => void }).verifyPolicy = () => {
      for (const required of policy.required) {
        if (!seen.has(required)) violations.push(\`missing required plugin: \${required}\`);
      }
      if (violations.length > 0) {
        throw new Error("Policy violations:\\n  - " + violations.join("\\n  - "));
      }
      app.log.info({ event: "policy_ok", plugins: [...seen] });
    };
  };
}`;

const COMPOSE = `// src/server.ts, what main() looks like in a real platform-team app.
// Notice: NOT ONE infra import in routes/*.ts. They just declare routes.
import { App, requestId, secureHeaders, timing } from "@daloyjs/core";
import { trace } from "@opentelemetry/api";
import { otelTracing } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

import { registrationPlugin } from "./platform/registry-plugin.js";
import { metricsPlugin } from "./platform/metrics-plugin.js";
import { policyPlugin } from "./platform/policy-plugin.js";

import { usersPlugin } from "./routes/users.js";
import { ordersPlugin } from "./routes/orders.js";
import { adminPlugin } from "./routes/admin.js";

const app = new App({ hooks: otelTracing({ tracer: trace.getTracer("api") }) });

app.use(requestId());
app.use(secureHeaders());
app.use(timing());

// Platform plugins go FIRST so their onPluginInstalled listeners are
// in place when the route plugins below get installed.
const registerService = registrationPlugin({ url: process.env.CONSUL_URL!, token: process.env.CONSUL_TOKEN! });
app.register({ name: "platform.registry", register: registerService });

app.register({ name: "platform.metrics", register: metricsPlugin({ pushGatewayUrl: process.env.PROM_PUSH_URL, job: "api" }) });

const policy = policyPlugin({
  prefixRules: /^\\/v1\\//,
  required: ["users", "orders", "platform.metrics", "platform.registry"],
  forbiddenInProd: ["admin.debug"],
});
app.register({ name: "platform.policy", register: policy });

// Application plugins. Routes only know about THEIR own concerns.
app.register({ name: "users",  register: usersPlugin  }, { prefix: "/v1/users",  tags: ["users"]  });
app.register({ name: "orders", register: ordersPlugin }, { prefix: "/v1/orders", tags: ["orders"] });
if (process.env.NODE_ENV !== "production") {
  app.register({ name: "admin.debug", register: adminPlugin }, { prefix: "/__admin", tags: ["debug"] });
}

await app.ready();                              // wait for async plugins
(app as App & { verifyPolicy: () => void }).verifyPolicy();   // fail boot if violated
serve(app, { port: Number(process.env.PORT ?? 3000) });`;

const PLATFORM_FLOW = `# What boot looks like in the logs of a single replica:
#
# 08:00:00.001  level=info  msg="DaloyJS booting"
# 08:00:00.043  event=registered     serviceId=api-2cf...  plugins=5
# 08:00:00.044  event=policy_ok      plugins=["users","orders","platform.metrics","platform.registry","platform.policy"]
# 08:00:00.051  msg="DaloyJS listening on :3000"
#
# What graceful shutdown looks like:
#
# 08:42:11.001  msg="SIGTERM received"
# 08:42:11.002  event=metrics_pushed reason=SIGTERM
# 08:42:11.004  event=deregistered   serviceId=api-2cf...  reason=SIGTERM
# 08:42:11.005  msg="draining"  inflight=12
# 08:42:11.731  msg="closed db pool"
# 08:42:11.732  msg="closed redis"
# 08:42:11.733  inflight=0  msg="DaloyJS shutdown complete"
#
# The whole sequence is composable. Add a plugin -> its listener slots
# into onPluginInstalled and onShutdown alongside everyone else's.`;

const TESTING_PLUGINS = `// tests/platform-plugins.test.ts, verify the wiring without a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "@daloyjs/core";

test("onPluginInstalled fires once per register, in order", async () => {
  const app = new App({ logger: false });
  const events: Array<{ name?: string; prefix: string }> = [];

  app.onPluginInstalled((e) => { events.push(e); });

  app.register({ name: "users",  register: () => {} }, { prefix: "/v1/users"  });
  app.register({ name: "orders", register: () => {} }, { prefix: "/v1/orders" });
  app.register(() => {}, { prefix: "/anon" });                // anonymous plugin

  await app.ready();

  assert.deepEqual(events, [
    { name: "users",  prefix: "/v1/users"  },
    { name: "orders", prefix: "/v1/orders" },
    { name: undefined, prefix: "/anon" },
  ]);
});

test("onShutdown runs BEFORE onClose; both run on app.shutdown()", async () => {
  const app = new App({ logger: false });
  const order: string[] = [];

  app.onShutdown(async () => { order.push("shutdown"); });
  app.onClose(async () => { order.push("close"); });

  await app.shutdown(50, "test");
  assert.deepEqual(order, ["shutdown", "close"]);
});`;

const CHECKLIST = `# Platform plugin pre-flight checklist.
#
# 1) Name every platform plugin. Anonymous plugins are fine for
#    application code, but platform-team plugins always have names
#    so policy / audit can enforce presence.
#
# 2) Register platform plugins BEFORE application ones. onPluginInstalled
#    listeners installed later don't retroactively fire for earlier
#    register() calls.
#
# 3) await app.ready() between register() and serve(). Otherwise async
#    plugins (database pool, feature-flag fetch) may not be initialized
#    when the first request arrives.
#
# 4) Pick a side: onShutdown for "do something while we're still
#    healthy" (push metrics, deregister, flush spans). onClose for
#    "release resources we already paid for" (pool.end(), file
#    handles).
#
# 5) Keep listeners idempotent. SIGTERM can arrive twice in container
#    shutdown sequences; both onShutdown and onClose are guarded
#    internally but YOUR listeners should be too.
#
# 6) Don't make app code import platform code. The whole point is that
#    routes/users.ts knows only about "users". If a route is reaching
#    for the metrics registry directly, you've leaked the platform
#    boundary; pull the concern into a plugin.
#
# 7) Log listener errors. The framework catches and logs them already;
#    your listeners should add structured fields so operations can
#    tell metrics-flush failures apart from registry-deregister failures
#    in a noisy postmortem.`;

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

function EventCard({
  event,
  fires,
  children,
}: {
  event: string;
  fires: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {event}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">
          Fires:{" "}
          <span className="font-normal text-muted-foreground">{fires}</span>
        </p>
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
            <Badge variant="outline">Architecture</Badge>
            <Badge variant="outline">Platform</Badge>
            <Badge variant="outline">Lifecycle</Badge>
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
            Devlin again, writing from Norway with the late-spring sun doing
            that thing where it pretends it&apos;s 4 p.m. when it&apos;s
            actually 9 p.m. This post is about a small, boring API surface that
            solves a very large, very expensive problem: how do platform teams
            ship cross-cutting concerns (observability, registration, graceful
            drain, policy) without making every route file import the infra
            layer?
          </p>

          <p>
            Two callbacks. That&apos;s the answer. Two callbacks and the
            discipline to put the platform code in plugins instead of inside
            routes.
          </p>

          <h2>The shape of the problem</h2>

          <EditorFrame
            files={["routes/users.ts (the bad version)"]}
            activeFile="routes/users.ts (the bad version)"
            status="four infra imports · multiplied by 200 route files · this is what burnout looks like"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <p>
            Every team I&apos;ve worked with eventually wrote this preamble in
            every route. Every team then wrote a wiki page telling new joiners
            to remember the preamble. Every team then had an audit finding three
            months later because three routes had forgotten part of the
            preamble. The framework should make the wiki page unnecessary.
          </p>

          <h2>The whole API, on one screen</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="two new events · two you already knew · that's it"
          >
            <CodeBlock language="ts" code={TWO_EVENTS} />
          </EditorFrame>

          <EventCard
            event="onPluginInstalled"
            fires="once per app.register(), after register() resolves"
          >
            Receives <code>{`{ name?, prefix }`}</code> where{" "}
            <code>prefix</code> is the effective mount path after parent and
            group prefixes are applied. Async plugin? The listener fires when
            its promise settles. Anonymous plugin? <code>name</code> is{" "}
            <code>undefined</code>.
          </EventCard>
          <EventCard
            event="onShutdown"
            fires="when app.shutdown() begins, BEFORE drain"
          >
            Receives <code>{`{ reason?, timeoutMs }`}</code>
            {". "}The right place to push metrics, deregister from service
            discovery, and flush span buffers, everything that needs the network
            to still work.
          </EventCard>
          <EventCard event="onClose" fires="AFTER in-flight requests drain">
            Use for releasing resources you paid for at boot:{" "}
            <code>pool.end()</code>
            {", "}redis disconnect, queue consumer stop. Errors are caught and
            logged so one bad cleanup doesn&apos;t take down the rest.
          </EventCard>
          <EventCard
            event="await app.ready()"
            fires="resolves when all async plugins finish"
          >
            Sync plugins also push observer promises here, so it&apos;s always
            safe to call. Standard pattern:{" "}
            <code>register -&gt; ready -&gt; serve</code>.
          </EventCard>

          <h2>What a register() call actually looks like</h2>

          <EditorFrame
            files={["src/server.ts"]}
            activeFile="src/server.ts"
            status="Fastify-style register · scoped child App · prefix + tags + group hooks"
          >
            <CodeBlock language="ts" code={APP_REGISTER} />
          </EditorFrame>

          <h2>A service-registration plugin in 40 lines</h2>

          <EditorFrame
            files={["platform/registry-plugin.ts"]}
            activeFile="platform/registry-plugin.ts"
            status="register at boot · deregister on shutdown · expose plugin inventory as service metadata"
          >
            <CodeBlock language="ts" code={REGISTRY_PLUGIN} />
          </EditorFrame>

          <p>
            Read it twice. The whole &quot;deregister cleanly before the load
            balancer realizes we&apos;re going away&quot; behavior is a single{" "}
            <code>onShutdown</code> handler. Operations gets the deregistration
            in their logs at the exact moment SIGTERM arrives, and no in-flight
            request gets a connection-reset because we&apos;re still answering
            until drain completes.
          </p>

          <h2>A metrics plugin that flushes before drain</h2>

          <EditorFrame
            files={["platform/metrics-plugin.ts"]}
            activeFile="platform/metrics-plugin.ts"
            status="Prometheus counter/histogram · plugin label captured at install · push-gateway flush on shutdown"
          >
            <CodeBlock language="ts" code={METRICS_PLUGIN} />
          </EditorFrame>

          <p>
            The clever bit: <code>onPluginInstalled</code> lets us capture the{" "}
            <code>plugin</code> label at install time instead of looking it up
            on the hot path. The metric label is correct (and stable), and the
            request handler does a hash-map lookup, not a router replay.
          </p>

          <h2>The full shutdown sequence</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="onShutdown -> 503-new-requests -> drain -> onClose · in that order, every time"
          >
            <CodeBlock language="bash" code={SHUTDOWN_FLOW} />
          </EditorFrame>

          <p>
            That ordering is non-negotiable on purpose. If you push metrics{" "}
            <em>after</em> drain, half the time the metrics never get pushed
            because your container runtime SIGKILLs you mid-flush. If you
            deregister <em>after</em> drain, you get a 30-second window where
            the load balancer is still routing fresh traffic to a server
            that&apos;s already saying 503. <code>onShutdown</code> exists
            exactly to give you the early window.
          </p>

          <h2>A policy plugin that fails boot</h2>

          <EditorFrame
            files={["platform/policy-plugin.ts"]}
            activeFile="platform/policy-plugin.ts"
            status="audit every install · required plugins · prefix conventions · forbidden in prod"
          >
            <CodeBlock language="ts" code={POLICY_PLUGIN} />
          </EditorFrame>

          <p>
            Boot-time policy is the cheapest possible enforcement: zero runtime
            cost, zero false positives, fails fast at CI time. Every platform
            team I&apos;ve seen graduate from &quot;wiki page everyone
            forgets&quot; to &quot;real platform&quot; does some version of
            this.
          </p>

          <h2>Composing it all in main()</h2>

          <EditorFrame
            files={["src/server.ts"]}
            activeFile="src/server.ts"
            status="platform plugins FIRST · then app plugins · ready -> verifyPolicy -> serve"
          >
            <CodeBlock language="ts" code={COMPOSE} />
          </EditorFrame>

          <p>
            Note carefully: <code>routes/users.ts</code>
            {", "}
            <code>routes/orders.ts</code>
            {", "}
            <code>routes/admin.ts</code> have <em>zero</em> imports from{" "}
            <code>platform/*</code>
            {". "}The metrics show up, the registration happens, the policy
            fires, all without a single line in the route files knowing any of
            that exists. That is the entire point.
          </p>

          <h2>What the logs say</h2>

          <EditorFrame
            files={["stdout"]}
            activeFile="stdout"
            status="boot · steady state · graceful shutdown · 8 lines tell the whole story"
          >
            <CodeBlock language="bash" code={PLATFORM_FLOW} />
          </EditorFrame>

          <h2>Testing platform plugins</h2>

          <EditorFrame
            files={["tests/platform-plugins.test.ts"]}
            activeFile="tests/platform-plugins.test.ts"
            status="node:test · no network · verify ordering + arguments"
          >
            <CodeBlock language="ts" code={TESTING_PLUGINS} />
          </EditorFrame>

          <h2>The pre-flight checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="seven items · pin to the team wiki next to your deploy runbook"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Put platform policy in plugins</h2>

          <p>
            The number of large-team backend codebases I&apos;ve seen with
            cross-cutting infrastructure imports leaking into route files
            is&hellip; depressing. The fix is structural, not motivational. Give
            the platform team a place to put their concerns. Make that place
            inert from the perspective of application code. DaloyJS does that
            with two callbacks (<code>onPluginInstalled</code>
            {", "}
            <code>onShutdown</code>), two cleanup hooks (<code>onClose</code>
            {", "}
            <code>app.ready()</code>), and a Fastify-shaped{" "}
            <code>register()</code> that scopes everything.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/blog/middleware-without-mystery-hooks-ordering-response-transformation">
              middleware lifecycle
            </Link>{" "}
            post for the per-request hooks the metrics plugin uses, the{" "}
            <Link href="/blog/observability-without-lock-in-structured-logs-and-otel-tracing">
              observability post
            </Link>{" "}
            for the tracing piece that fits into the same shutdown sequence, and
            the{" "}
            <Link href="/blog/same-app-five-runtimes-verified">
              five-runtimes post
            </Link>{" "}
            for why the platform plugins above run identically on Node, Bun,
            Workers, and Lambda.
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
                href="/blog/observability-without-lock-in-structured-logs-and-otel-tracing"
                className="underline underline-offset-4"
              >
                Observability post
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
