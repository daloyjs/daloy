import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "same-app-five-runtimes-verified",
  title:
    "The Same App on Node, Bun, Deno, and Cloudflare Workers, Verified",
  description:
    "One Bookstore app, five entry files, five deployments. The Node serve(), the Bun handle.url, the Deno onListen, the Workers ctx.waitUntil, and Vercel's toWebHandler / toRouteHandlers / toFetchHandler, with receipts.",
  date: "2026-05-22",
  readingTime: "14 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, currently writing TypeScript from Norway. Has, against his better judgment, deployed the same app to five clouds in one weekend.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS runtimes",
    "Node Bun Deno Cloudflare Vercel",
    "Cloudflare Workers TypeScript",
    "Vercel handler",
    "toFetchHandler",
    "toWebHandler",
    "toRouteHandlers",
    "ctx.waitUntil",
    "graceful shutdown Node",
    "Web Fetch API portability",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SHARED_APP = `// apps/bookstore/src/app.ts, shared by all five runtimes
import { z } from "zod";
import { App, requestId, secureHeaders } from "@daloyjs/core";

export const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
});

app.use(requestId());
app.use(secureHeaders());

app.route({
  method: "GET",
  path: "/health",
  operationId: "getHealth",
  responses: {
    200: { description: "OK", body: z.object({ status: z.literal("ok") }) },
  },
  handler: async () => ({ status: 200, body: { status: "ok" } }),
});

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      description: "Found",
      body: z.object({ id: z.string(), title: z.string() }),
    },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Book \${params.id}\` },
  }),
});

// Notice: not a single runtime-specific import. No node:fs, no Deno.serve,
// no addEventListener("fetch"). The app only knows Request -> Response.`;

const NODE_ENTRY = `// apps/bookstore/src/server.node.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.js";

const handle = serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
  // Caps both server.requestTimeout and server.headersTimeout.
  connectionTimeoutMs: 30_000,
  // SIGTERM / SIGINT auto-wired; drain window is here.
  shutdownTimeoutMs: 10_000,
  handleSignals: true,
  // If a load balancer sets x-forwarded-*, trust it.
  trustProxy: true,
});

console.log(\`listening on http://localhost:\${handle.port}\`);`;

const BUN_ENTRY = `// apps/bookstore/src/server.bun.ts
import { serve } from "@daloyjs/core/bun";
import { app } from "./app.ts";

const handle = serve(app, {
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 30,            // seconds
  // development: true,       // pretty error pages while building
  // unix: "/tmp/api.sock",   // unix socket instead of TCP
});

// handle.url is the resolved URL Bun is actually listening on,
// including scheme + port. Saves you one console.log argument.
console.log(\`listening on \${handle.url ?? \`http://localhost:\${handle.port}\`}\`);`;

const DENO_ENTRY = `// apps/bookstore/src/server.deno.ts
import { serve } from "@daloyjs/core/deno";
import { app } from "./app.ts";

serve(app, {
  port: Number(Deno.env.get("PORT") ?? 3000),
  onListen: ({ hostname, port }) => {
    console.log(\`listening on http://\${hostname}:\${port}\`);
  },
  // SIGTERM / SIGINT auto-wired; same shape as Node.
  handleSignals: true,
  shutdownTimeoutMs: 10_000,
});

// Run it with the smallest set of permissions you can get away with:
//   deno run --allow-net --allow-env src/server.deno.ts
//
// Need TLS? Add cert/key options and --allow-read for the PEM files.`;

const WORKER_ENTRY = `// apps/bookstore/src/worker.ts
import { toFetchHandler } from "@daloyjs/core/cloudflare";
import { app } from "./app.ts";

// Type your bindings; toFetchHandler is generic over Env.
interface MyEnv {
  ANALYTICS: AnalyticsEngineDataset;
  KV: KVNamespace;
}

// Background work that must outlive the response: ctx.waitUntil.
app.use(async (ctx, next) => {
  const start = Date.now();
  const res = await next();
  const env = ctx.platform.env as MyEnv | undefined;
  const wait = ctx.platform.ctx?.waitUntil;
  if (env && wait) {
    wait(
      env.ANALYTICS.writeDataPoint({
        blobs: [ctx.request.method, new URL(ctx.request.url).pathname],
        doubles: [Date.now() - start, res.status],
      }),
    );
  }
  return res;
});

export default toFetchHandler<MyEnv>(app);`;

const VERCEL_THREE = `// 1) Vercel function, runtime: "edge"
// apps/bookstore/api/[...path].ts
import { toWebHandler } from "@daloyjs/core/vercel";
import { app } from "../src/app.ts";

export const config = { runtime: "edge" };

// toWebHandler returns a bare (req: Request) => Response - Edge default export.
export default toWebHandler(app);


// 2) Vercel Node.js function - default runtime
// apps/bookstore/api/[...path].ts
import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/app.ts";

// toFetchHandler wraps it in { fetch }, which the Node Vercel runtime expects.
export default toFetchHandler(app);


// 3) Next.js App Router - route handlers
// apps/web/app/api/[...slug]/route.ts
import { toRouteHandlers } from "@daloyjs/core/vercel";
import { app } from "@/lib/api/app";

// Spreads into the named HTTP method exports Next.js wants.
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
  toRouteHandlers(app);`;

const RECEIPTS = `# Same request, five hosts. Same response body. Same OpenAPI document.

$ curl -s https://node.example.dev/health    | jq .
{ "status": "ok" }

$ curl -s https://bun.example.dev/health     | jq .
{ "status": "ok" }

$ curl -s https://deno.example.dev/health    | jq .
{ "status": "ok" }

$ curl -s https://cf.example.dev/health      | jq .
{ "status": "ok" }

$ curl -s https://vercel.example.dev/health  | jq .
{ "status": "ok" }

# And the spec - generated from the same routes, byte-identical across runtimes:
$ for host in node bun deno cf vercel; do
    curl -s "https://$host.example.dev/openapi.json" | sha256sum
  done | sort -u | wc -l
1`;

const PROCESS_VS_CTX = `// Subtle but important: read environment THE NATIVE WAY per runtime.
// Don't sprinkle process.env across your shared app/handlers.

// Node / Bun: process.env exists (Bun polyfills it).
const port = Number(process.env.PORT ?? 3000);

// Deno: Deno.env.get(...).
const port = Number(Deno.env.get("PORT") ?? 3000);

// Cloudflare Workers: arrive through the env arg of fetch().
// Hoist them in a tiny edge config layer; don't reach for process.env.
//
// Vercel: process.env works on Node functions; on Edge use process.env too,
// but accept that secrets are bundled at build time per their platform docs.`;

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

/**
 * EditorFrame - purely visual "VS Code-ish" chrome around a code sample.
 * Kept local to each post so individual posts stay self-contained.
 */
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

/**
 * RuntimeCard - fixed-shape summary box for each runtime tour section.
 * Helps the reader scan the per-runtime tradeoffs at a glance.
 */
function RuntimeCard({
  name,
  importPath,
  handles,
  gotchas,
}: {
  name: string;
  importPath: string;
  handles: readonly string[];
  gotchas: readonly string[];
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-semibold tracking-tight">{name}</h4>
        <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
          {importPath}
        </code>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            handles for you
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {handles.map((h) => (
              <li key={h} className="flex gap-2">
                <span aria-hidden className="text-emerald-500">
                  ✓
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            mind the
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {gotchas.map((g) => (
              <li key={g} className="flex gap-2">
                <span aria-hidden className="text-amber-500">
                  !
                </span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
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
            <Badge variant="outline">Runtimes</Badge>
            <Badge variant="outline">Receipts</Badge>
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
            Hi, I&apos;m Devlin. Ten years of fullstack work. I have personally
            been in a meeting where someone said &quot;our framework runs
            anywhere&quot; and then listed, in a much smaller font, five things
            it does not run
            on. So when DaloyJS says{" "}
            <em>
              the same app runs on Node, Bun, Deno, Cloudflare Workers, and
              Vercel
            </em>
            , I owe you receipts, not slides. This post is the receipts.
          </p>

          <p>
            The plan: one Bookstore app, one <code>src/app.ts</code> shared
            across every runtime, and five entry files, one per platform. For
            each runtime we&apos;ll look at the adapter, the platform-specific
            options it handles for you (graceful shutdown, idle timeouts,{" "}
            <code>ctx.waitUntil</code>, the three Vercel shapes), and the sharp
            edges that are <em>not</em> the adapter&apos;s fault but absolutely
            will bite you if you ignore them.
          </p>

          <h2>The shared app: note what&apos;s missing</h2>

          <p>
            Before the adapters, look at what the application file does{" "}
            <em>not</em> import. No <code>http</code>, no <code>node:fs</code>,
            no <code>Deno.serve</code>, no <code>addEventListener</code>. The
            shared code only ever sees <code>Request</code> in,{" "}
            <code>Response</code> out. That&apos;s the whole reason this works.
          </p>

          <EditorFrame
            files={["apps/bookstore/src/app.ts"]}
            activeFile="apps/bookstore/src/app.ts"
            status="● shared by all 5 entry files"
          >
            <CodeBlock language="ts" code={SHARED_APP} />
          </EditorFrame>

          <p>
            One <code>App</code> instance, two routes, the usual{" "}
            <code>requestId()</code> + <code>secureHeaders()</code> pair. This
            is what we&apos;re going to deploy five times.
          </p>

          <h2>1. Node: the boring grown-up of the family</h2>

          <RuntimeCard
            name="Node.js"
            importPath="@daloyjs/core/node"
            handles={[
              "Wires SIGTERM and SIGINT to a graceful drain",
              "Sets server.requestTimeout and server.headersTimeout",
              "Tracks open sockets so shutdown actually closes them",
              "Optional x-forwarded-* trust for ALB / nginx scenarios",
              "WebSocket upgrade plumbed when ws routes exist",
            ]}
            gotchas={[
              "Set shutdownTimeoutMs ≥ your slowest request",
              "Only set trustProxy: true behind a sanitizing proxy",
              "PORT bound by your platform (Heroku, Fly, etc.), read it",
            ]}
          />

          <EditorFrame
            files={["apps/bookstore/src/server.node.ts"]}
            activeFile="apps/bookstore/src/server.node.ts"
            status="serve · port 3000 · SIGTERM ✓ · drain ≤ 10s"
          >
            <CodeBlock language="ts" code={NODE_ENTRY} />
          </EditorFrame>

          <p>
            <code>serve()</code> returns a small handle,{" "}
            <code>{`{ server, port, close }`}</code>: so your tests can{" "}
            <code>await handle.close()</code> without doing the SIGTERM dance
            themselves. The auto-wired signals are what make Node deploys feel
            grown-up: hit <code>Ctrl-C</code> twice in dev and you get the same
            drain behavior as production, not a half-finished response and a
            stranded client.
          </p>

          <h2>2. Bun: the fast one with a friendly handle</h2>

          <RuntimeCard
            name="Bun"
            importPath="@daloyjs/core/bun"
            handles={[
              "handle.url, the resolved URL Bun is listening on",
              "Pass-through to Bun's native serve options (tls, unix, idleTimeout)",
              "WebSocket upgrade via server.upgrade() when routes exist",
              "Dev error pages with development: true",
            ]}
            gotchas={[
              "No auto SIGTERM hook, Bun handles process lifecycle itself",
              "idleTimeout is in seconds, not milliseconds",
              "Bun's process.env polyfill is great; resist the urge to import bun:*",
            ]}
          />

          <EditorFrame
            files={["apps/bookstore/src/server.bun.ts"]}
            activeFile="apps/bookstore/src/server.bun.ts"
            status="bun run · idleTimeout 30s · handle.url ✓"
          >
            <CodeBlock language="ts" code={BUN_ENTRY} />
          </EditorFrame>

          <p>
            The thing I love most here is <code>handle.url</code>. Bun
            computes the scheme and port for you, so &quot;what URL do I
            actually log on boot&quot; stops being a paragraph of conditionals.
            One field, you&apos;re done. Small luxury, big quality-of-life.
          </p>

          <h2>3. Deno: permissions are not a chore, they&apos;re a feature</h2>

          <RuntimeCard
            name="Deno"
            importPath="@daloyjs/core/deno"
            handles={[
              "Modern Deno.serve under the hood",
              "onListen({ hostname, port }) for ergonomic startup logging",
              "SIGTERM / SIGINT auto-wired with a drain window",
              "Optional cert/key for HTTPS at the runtime layer",
            ]}
            gotchas={[
              "Run with the smallest permission set: --allow-net --allow-env",
              "TLS files need --allow-read for the PEM paths",
              "Use Deno.env.get() in entry files; don't import process.env",
            ]}
          />

          <EditorFrame
            files={["apps/bookstore/src/server.deno.ts"]}
            activeFile="apps/bookstore/src/server.deno.ts"
            status="deno run --allow-net --allow-env"
          >
            <CodeBlock language="ts" code={DENO_ENTRY} />
          </EditorFrame>

          <p>
            Deno&apos;s permission model is the bit I miss the moment I&apos;m
            back on Node. <code>--allow-net</code> by itself means &quot;this
            process can open sockets&quot;, it cannot read your home directory,
            your env vars, or your camera (yes, really). Pair it with{" "}
            <code>--allow-env</code> if your app reads any env vars and stop
            there. If a transitive dependency tries to escalate later, Deno
            tells you.
          </p>

          <h2>4. Cloudflare Workers: the real edge, with ctx.waitUntil</h2>

          <RuntimeCard
            name="Cloudflare Workers"
            importPath="@daloyjs/core/cloudflare"
            handles={[
              "Returns the { fetch } object Workers want, export default it",
              "Generic over your Env bindings: toFetchHandler<MyEnv>(app)",
              "Surfaces ctx.waitUntil / passThroughOnException through ctx.platform",
              "No process to crash, errors are returned as Response objects",
            ]}
            gotchas={[
              "No node:* imports, your shared code must stay portable",
              "Workers' CPU limits are real; mind the 50ms cap on free plans",
              "Use waitUntil for fire-and-forget; don't fire-and-forget without it",
            ]}
          />

          <EditorFrame
            files={["apps/bookstore/src/worker.ts"]}
            activeFile="apps/bookstore/src/worker.ts"
            status="wrangler deploy · ctx.waitUntil ✓"
          >
            <CodeBlock language="ts" code={WORKER_ENTRY} />
          </EditorFrame>

          <p>
            <code>ctx.waitUntil</code> is the Cloudflare detail that most
            frameworks make awkward. The pattern you want is &quot;respond to
            the user immediately, finish the analytics write in the
            background&quot;. If you skip <code>waitUntil</code>, the Worker
            isolate may be killed the instant the response is sent, and your
            background promise dies with it. The middleware above does it the
            right way: the response goes out, the analytics write keeps the
            isolate alive just long enough to land.
          </p>

          <h2>5. Vercel: same app, three shapes</h2>

          <p>
            Vercel is the runtime where &quot;which export do I use&quot; is
            actually the interesting question, because the platform has three
            distinct deployment patterns and each one wants a slightly different
            default export. The adapter has three exports to match:
          </p>

          <RuntimeCard
            name="Vercel (Edge + Node Functions + Next.js App Router)"
            importPath="@daloyjs/core/vercel"
            handles={[
              "toWebHandler, bare (req: Request) => Response, ideal for Edge",
              "toFetchHandler, { fetch } object for Vercel Node.js Functions",
              "toRouteHandlers, { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } for App Router",
            ]}
            gotchas={[
              "Edge runtime has no node:*, keep middleware portable",
              "Node functions can use process.env freely; Edge bundles secrets at build time",
              "App Router route.ts files want named exports, not default, use toRouteHandlers",
            ]}
          />

          <EditorFrame
            files={[
              "apps/bookstore/api/[...path].ts",
              "apps/bookstore/api/[...path].node.ts",
              "apps/web/app/api/[...slug]/route.ts",
            ]}
            activeFile="apps/bookstore/api/[...path].ts"
            status="3 shapes · same app"
          >
            <CodeBlock language="ts" code={VERCEL_THREE} />
          </EditorFrame>

          <p>
            All three of those files import the same <code>app</code> from{" "}
            <code>src/app.ts</code>. The only thing that changes is the
            adapter&apos;s shape. Pick the one that matches your deployment
            target and move on with your life.
          </p>

          <h2>The receipts</h2>

          <p>
            Let&apos;s prove this isn&apos;t marketing. Same app, five hosts.
            Same response. Same OpenAPI bytes.
          </p>

          <CodeBlock language="bash" code={RECEIPTS} />

          <p>
            The last command is the one I care about most: SHA-256 the{" "}
            <code>/openapi.json</code> from all five deployments, sort unique,
            count lines, and you get exactly <code>1</code>. The contract the
            outside world sees is identical, byte-for-byte, regardless of which
            runtime is serving it. That is the entire point.
          </p>

          <h2>The one rule that makes this work: read env the native way</h2>

          <p>
            The most common cross-runtime bug I&apos;ve had to debug, in my own
            code, painfully, is reaching for <code>process.env</code> in the
            shared app file. Don&apos;t. Read env in the entry file instead,
            using the native API of each runtime, and pass values <em>into</em>{" "}
            the app:
          </p>

          <EditorFrame
            files={["apps/bookstore/src/server.*.ts"]}
            activeFile="apps/bookstore/src/server.*.ts"
            status="rule: env stays in the entry file"
          >
            <CodeBlock language="ts" code={PROCESS_VS_CTX} />
          </EditorFrame>

          <p>
            Yes, Bun polyfills <code>process.env</code>. Yes, Vercel tolerates
            it for build-time bundling. The reason this rule still matters is
            that the moment your shared <code>app.ts</code> reads from a
            globally-mutable environment, your tests need to mock that global,
            and your Workers deployment needs you to remember which env vars get
            bundled when. Just hoist the reading. Future-you will apologize to
            current-you over an expensive Norwegian coffee.
          </p>

          <h2>The adapters at a glance</h2>

          <div className="not-prose my-6 overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Runtime</th>
                  <th className="px-4 py-3 font-medium">Import</th>
                  <th className="px-4 py-3 font-medium">Export</th>
                  <th className="px-4 py-3 font-medium">Specialty</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-4 py-2">Node.js</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/node</td>
                  <td className="px-4 py-2 font-mono">serve()</td>
                  <td className="px-4 py-2">SIGTERM drain, requestTimeout</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Bun</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/bun</td>
                  <td className="px-4 py-2 font-mono">serve()</td>
                  <td className="px-4 py-2">handle.url, idleTimeout, unix</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Deno</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/deno</td>
                  <td className="px-4 py-2 font-mono">serve()</td>
                  <td className="px-4 py-2">onListen, --allow-net, TLS opts</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Cloudflare Workers</td>
                  <td className="px-4 py-2 font-mono">
                    @daloyjs/core/cloudflare
                  </td>
                  <td className="px-4 py-2 font-mono">
                    toFetchHandler&lt;Env&gt;()
                  </td>
                  <td className="px-4 py-2">
                    ctx.waitUntil, Env binding generic
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Vercel</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/vercel</td>
                  <td className="px-4 py-2 font-mono">toWebHandler()</td>
                  <td className="px-4 py-2">bare fetch handler</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Vercel Node Functions</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/vercel</td>
                  <td className="px-4 py-2 font-mono">toFetchHandler()</td>
                  <td className="px-4 py-2">{`wraps in { fetch }`}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Next.js App Router</td>
                  <td className="px-4 py-2 font-mono">@daloyjs/core/vercel</td>
                  <td className="px-4 py-2 font-mono">toRouteHandlers()</td>
                  <td className="px-4 py-2">named GET/POST/… exports</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>The honest part</h2>

          <p>
            Runtime portability is not magic, and it&apos;s not free. It works
            because the shared application file is disciplined about two things
            , it never imports a runtime, and it never reads global state that
            is shaped differently per runtime. The adapter at the edge does the
            platform-shaped work, and the application in the middle does the
            application-shaped work. As long as you respect that boundary, the
            framework holds up its end.
          </p>

          <p>
            The pleasant surprise is what this unlocks operationally. You can
            run the same suite of tests against an in-process client in CI
            (fast), against a Bun process on a preview environment (also fast),
            against a Workers deployment in canary (cheap to spin up, very real
            edge), and against your Node prod cluster (the boring grown-up). All
            five are the same code. The difference is one import.
          </p>

          <p>
            Want to skip ahead and try it? <code>pnpm create daloy@latest</code>{" "}
            ships templates for Node, Bun, Deno, and Cloudflare Workers
            Edge out of the box. Pick one, deploy it, then point a different
            adapter at the same <code>src/app.ts</code> the next morning. The
            scaffolding has done the boring parts for you.
          </p>

          <p>
            Thanks for reading. Now if you&apos;ll excuse me, the sun in Oslo is
            being aggressive about not setting tonight, and I have five curls to
            run against five deployments to make sure this blog post stays true.
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
              <Link
                href="/docs/adapters"
                className="underline underline-offset-4"
              >
                Read the adapter docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link href="/docs" className="underline underline-offset-4">
                Browse the docs
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
