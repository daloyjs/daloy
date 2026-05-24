import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "introducing-daloyjs",
  title: "Introducing DaloyJS: One Route, Many Runtimes, Zero Ceremony",
  description:
    "The launch post. One app.route({...}) becomes your validation, types, OpenAPI, typed client, and contract tests — and the same app runs on Node, Bun, Deno, Workers, and Vercel Edge.",
  date: "2026-05-18",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, currently writing TypeScript from a flat in Norway. Has strong opinions about contracts and weak opinions about the weather.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Introducing DaloyJS",
    "DaloyJS launch",
    "TypeScript framework",
    "contract-first framework",
    "OpenAPI TypeScript",
    "Node Bun Deno Cloudflare Workers Vercel Edge",
    "typed client SDK",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HELLO_DALOY = `// src/app.ts
import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";

export const app = new App({
  bodyLimitBytes: 1 << 20,   // 1 MiB
  requestTimeoutMs: 5_000,   // 5s
});

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  summary: "Fetch a book by id",
  request: {
    params: z.object({ id: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "Found",
      body: z.object({ id: z.string(), title: z.string() }),
    },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    if (params.id === "missing") {
      return { status: 404 };
    }
    return {
      status: 200,
      body: { id: params.id, title: \`Book \${params.id}\` },
    };
  },
});`;

const SERVE_NODE = `// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app";

serve(app, { port: 3000 });`;

const OPENAPI_CURL = `# the spec is generated from the route, not the other way around
curl http://localhost:3000/openapi.json | jq '.paths."/books/{id}".get.operationId'
# "getBookById"`;

const TYPED_CLIENT = `// scripts/smoke.ts
import { app } from "../src/app";
import { createInProcessClient } from "@daloyjs/core/client";

const api = createInProcessClient(app);

// 1) Happy path — body is narrowed to { id: string; title: string }
const ok = await api.getBookById({ params: { id: "42" } });
if (ok.status === 200) {
  console.log(ok.body.title.toUpperCase()); // ✅ string method, fully typed
}

// 2) Unhappy path — TS knows there's no body to read
const miss = await api.getBookById({ params: { id: "missing" } });
if (miss.status === 404) {
  // miss.body // ❌ TS error: Property 'body' does not exist on type { status: 404 }
}`;

const RUNTIMES = `// node
import { serve } from "@daloyjs/core/node";
serve(app, { port: 3000 });

// bun
import { serve } from "@daloyjs/core/bun";
serve(app, { port: 3000 });

// deno
import { serve } from "@daloyjs/core/deno";
serve(app, { port: 3000 });

// cloudflare workers
import { toFetch } from "@daloyjs/core/fetch";
export default { fetch: toFetch(app) };

// vercel edge / any Web Fetch runtime
import { toFetch } from "@daloyjs/core/fetch";
export const GET = toFetch(app);`;

const CONTRACT_TEST = `// tests/books.contract.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInProcessClient } from "@daloyjs/core/client";
import { app } from "../src/app";

const api = createInProcessClient(app);

test("getBookById returns a typed 200", async () => {
  const res = await api.getBookById({ params: { id: "42" } });
  assert.equal(res.status, 200);
  if (res.status === 200) {
    assert.equal(res.body.id, "42");
    assert.match(res.body.title, /^Book/);
  }
});

test("getBookById returns 404 for missing id", async () => {
  const res = await api.getBookById({ params: { id: "missing" } });
  assert.equal(res.status, 404);
});`;

const QUICKSTART = `pnpm create daloy@latest my-api
cd my-api
pnpm dev

# in another tab
curl http://localhost:3000/openapi.json | jq '.info.title'
# "my-api"`;

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
 * EditorFrame — a purely visual "VS Code-ish" chrome around a code sample.
 * Adds traffic-light dots, a fake tab bar, and an optional status strip.
 * This is decoration, not a real editor; it's just a nicer way to anchor a
 * code snippet visually in a long-form post.
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
            <Badge variant="outline">Launch</Badge>
            <Badge variant="outline">Announcement</Badge>
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
            Hi, I&apos;m Devlin. I&apos;ve been writing fullstack web apps for
            about ten years — long enough to have shipped to production using
            Express, Koa, Hapi, NestJS, Fastify, and Hono, and long enough to
            have written the same little &quot;just a tiny wrapper&quot; library
            around all of them, six times, in three different jobs. I live in
            Norway now, where the sun sets at 11pm in May and the coffee costs
            about as much as a small server. Today I want to introduce you to
            the framework I&apos;ve been working on, the one I quietly wished
            existed every one of those six times.
          </p>

          <p>
            It&apos;s called <strong>DaloyJS</strong>. The pitch fits on one
            line:
          </p>

          <blockquote>
            <strong>One route. Many runtimes. Zero ceremony.</strong>
          </blockquote>

          <p>
            Translated into engineering: a single{" "}
            <code>app.route(&#123;...&#125;)</code> call is the source of truth
            for <em>validation</em>, <em>TypeScript types</em>,<em> OpenAPI</em>
            , the <em>typed client</em>, and your <em>contract tests</em>. And
            that same <code>app</code> runs on Node, Bun, Deno, Cloudflare
            Workers, and Vercel Edge — the same file, no rewrites, no
            &quot;works on my Node version&quot; magic.
          </p>

          <p>
            If that paragraph already made you go &quot;wait, really?&quot;, the
            rest of this post is the proof. With code. In a fake editor, because
            I&apos;ve been told my blog posts are easier to read when they look
            a bit more like an IDE and a bit less like a wall of grey.
          </p>

          <h2>The smallest end-to-end example that actually means something</h2>

          <p>
            I&apos;m going to define a single route, start a server, hit{" "}
            <code>/openapi.json</code>, and then call the same route through the
            typed client — without a network in the middle, because the typed
            client knows it&apos;s the same process. Four things, one source of
            truth, no codegen step. Let&apos;s go.
          </p>

          <h3>Step 1 — Define the route</h3>

          <p>
            Open your editor. (I&apos;m going to draw mine for you, so we look
            at the same thing.)
          </p>

          <EditorFrame
            files={["src/app.ts", "src/server.ts", "scripts/smoke.ts"]}
            activeFile="src/app.ts"
            status="● src/app.ts — saved"
          >
            <CodeBlock language="ts" code={HELLO_DALOY} />
          </EditorFrame>

          <p>
            Things to notice before we move on, because they look small but
            aren&apos;t:
          </p>

          <ul>
            <li>
              <code>request</code> and <code>responses</code> use{" "}
              <a
                href="https://github.com/standard-schema/standard-schema"
                rel="noreferrer"
                target="_blank"
              >
                Standard Schema
              </a>
              . I used Zod here, but you can swap in Valibot or ArkType without
              changing the framework. The schema isn&apos;t a decoration —
              it&apos;s the validator, the OpenAPI body, <em>and</em> the
              TypeScript type of <code>params</code> inside <code>handler</code>
              .
            </li>
            <li>
              The handler&apos;s return type is a discriminated union of every
              status you declared. Forget to handle a status? The compiler will
              tell you. Try to return a body for <code>404</code> when you
              didn&apos;t declare one? Also a compile error. This is the part
              that quietly removes about a third of the bugs I&apos;ve shipped
              in the last decade.
            </li>
            <li>
              <code>bodyLimitBytes</code> and <code>requestTimeoutMs</code> are
              constructor arguments, not optional middlewares you forgot to
              register at 4pm on a Friday. Security defaults are on. You opt{" "}
              <em>out</em>, not in.
            </li>
          </ul>

          <h3>Step 2 — Serve it (on Node, for now)</h3>

          <EditorFrame
            files={["src/app.ts", "src/server.ts", "scripts/smoke.ts"]}
            activeFile="src/server.ts"
            status="▶ pnpm dev — listening on :3000"
          >
            <CodeBlock language="ts" code={SERVE_NODE} />
          </EditorFrame>

          <p>
            That&apos;s the whole server. <code>serve</code> is the Node
            adapter; we&apos;ll swap it in a minute. Run it:
          </p>

          <CodeBlock language="bash" code={`pnpm dev`} />

          <h3>Step 3 — Hit /openapi.json (the spec was free)</h3>

          <p>
            You did not write an OpenAPI document. You did not run a codegen.
            You did not maintain a YAML file in a folder called{" "}
            <code>openapi/</code> that your team agreed to update and then
            quietly stopped updating around sprint 4. The spec is just… there:
          </p>

          <CodeBlock language="bash" code={OPENAPI_CURL} />

          <p>
            This is, I think, the moment where most people stop and reload the
            URL in a browser. Go ahead. The whole document is consistent with
            the route by construction, not by convention.{" "}
            <Link href="/docs">The docs</Link> explain how to customize{" "}
            <code>info</code>, tags, servers, and security schemes, but the
            default is: open your browser, see your API.
          </p>

          <h3>Step 4 — Call it through the typed in-process client</h3>

          <p>
            Now for the part that, the first time I saw it work, made me say a
            word I will not type here because my mother reads this blog.
            We&apos;re going to call the route{" "}
            <em>without going through HTTP</em>. Same app object, same
            validation, same response shape — just no socket in the middle.
            Perfect for tests, scripts, and anywhere you want speed without
            spinning up a server.
          </p>

          <EditorFrame
            files={["src/app.ts", "src/server.ts", "scripts/smoke.ts"]}
            activeFile="scripts/smoke.ts"
            status="✓ tsc --noEmit — 0 errors"
          >
            <CodeBlock language="ts" code={TYPED_CLIENT} />
          </EditorFrame>

          <p>
            Read the comments carefully — that{" "}
            <code>if (ok.status === 200)</code> branch is a real discriminated
            union. Inside it, TypeScript narrows <code>ok.body</code> to{" "}
            <code>&#123; id: string; title: string &#125;</code>. Outside of it,{" "}
            <code>ok.body</code> doesn&apos;t exist as far as the compiler is
            concerned. You get this without writing types, without a codegen
            step, and without keeping a hand-written client in sync. It just
            comes from the route.
          </p>

          <p>
            (If you do want a real over-the-wire fetch SDK to ship to a separate
            frontend repo, you also get that — run <code>pnpm gen</code> and you
            get a typed fetch client off the generated OpenAPI. The in-process
            one above is what I reach for in tests.)
          </p>

          <h2>Same app, five runtimes, one file changed</h2>

          <p>
            Here is where I usually have to convince people I&apos;m not lying.
            The <code>app</code> object you defined above never imported a
            runtime. It only knows about <code>Request</code> in and{" "}
            <code>Response</code> out. The runtime quirks live in adapters at
            the edges, where they belong. So when your platform changes —
            because your CFO discovered Cloudflare, or your team migrated to
            Bun, or your boss said the word &quot;edge&quot; in a meeting — you
            change exactly <em>one import</em>.
          </p>

          <EditorFrame
            files={[
              "src/server.node.ts",
              "src/server.bun.ts",
              "src/server.deno.ts",
              "src/worker.ts",
              "app/api/route.ts",
            ]}
            activeFile="src/server.node.ts"
            status="5 entrypoints · 1 app"
          >
            <CodeBlock language="ts" code={RUNTIMES} />
          </EditorFrame>

          <p>
            That is the entire diff between running on a Node container and
            running on a Cloudflare Worker. Your route file does not change.
            Your tests do not change. Your OpenAPI does not change. I&apos;ve
            done this migration in real apps. It used to take a week. Now it
            takes a coffee, which in Norway, to be fair, is still expensive.
          </p>

          <h2>
            Contract tests come for free, because the contract is the route
          </h2>

          <p>
            One of my favourite side effects of having a single source of truth
            is that &quot;contract testing&quot; stops being a separate
            initiative with its own Confluence page. You just write a test
            against the typed client, and if the contract drifts, the compiler
            screams before the test even runs.
          </p>

          <EditorFrame
            files={["tests/books.contract.test.ts"]}
            activeFile="tests/books.contract.test.ts"
            status="node --test · 2 passing"
          >
            <CodeBlock language="ts" code={CONTRACT_TEST} />
          </EditorFrame>

          <p>
            Notice that the test imports the same <code>app</code> as the
            server. There is no mocked schema, no parallel type definition, no
            re-derived response shape. If someone changes the route&apos;s 200
            body to remove <code>title</code>, this test fails to compile. Not
            fails to run — fails to <em>compile</em>. That&apos;s the bug being
            caught at the earliest possible moment in the lifecycle, which is
            roughly nine months earlier than I usually catch them.
          </p>

          <h2>What &quot;zero ceremony&quot; actually means</h2>

          <p>
            I want to be specific about the &quot;zero ceremony&quot; part,
            because every framework on Earth claims it and most of them are
            being a little optimistic. Here&apos;s what we mean, concretely:
          </p>

          <ul>
            <li>
              <strong>No decorators</strong>, no <code>reflect-metadata</code>,
              no &quot;please enable experimental TS flags&quot;. Routes are
              objects. Handlers are functions. If you can read JavaScript, you
              can read this.
            </li>
            <li>
              <strong>No separate OpenAPI file</strong> to maintain. The spec is
              generated; you customize it, you don&apos;t author it.
            </li>
            <li>
              <strong>No separate client repo</strong> to keep in sync. The
              in-process client is one import. The generated fetch SDK is one
              command.
            </li>
            <li>
              <strong>No security checklist to remember.</strong> Body limits,
              request timeouts, prototype-pollution-safe JSON parsing,
              path-traversal rejection, and 5xx redaction in production are
              defaults. <code>secureHeaders()</code>, <code>rateLimit()</code>,{" "}
              <code>requestId()</code>, CSRF, sessions, and tracing are
              first-party — same repo, same release cadence, same test suite.
            </li>
            <li>
              <strong>No runtime lock-in.</strong> Same app, five adapters.
            </li>
          </ul>

          <h2>What this post is anchoring</h2>

          <p>
            This is the launch post, and every later post on this blog will
            point back here, because everything we build sits on this one idea:
            the route is the contract, and the contract is the route. The next
            posts will dig into specific pieces — the typed client in depth,
            running on Cloudflare Workers in production, how we keep the supply
            chain hardened with pnpm and SHA-pinned actions, OpenTelemetry
            without a 60-page setup doc — but they all assume the example you
            just read.
          </p>

          <h2>Try it in two minutes</h2>

          <p>
            You can try this in less time than it takes my espresso machine to
            warm up. (Mine is slow. Yours is probably fine.)
          </p>

          <CodeBlock language="bash" code={QUICKSTART} />

          <p>
            Then open <Link href="/docs/getting-started">Getting started</Link>,
            poke at <code>/openapi.json</code>, change one field in the route
            and watch the typed client complain at you in red squiggles. If
            something breaks, please tell me — the only way a framework earns
            the right to exist is by surviving other people&apos;s real code.
          </p>

          <h2>The honest part</h2>

          <p>
            DaloyJS is not magic, it is not going to make you a better developer
            overnight, and it is definitely not going to make my coffee any
            cheaper. What it <em>is</em> is the framework I would have wanted
            ten years ago, eight years ago, five years ago, and last Thursday.
            It removes a stack of recurring, boring, soul-eroding problems — the
            kind that cost you a Saturday at 2am — so you can spend your energy
            on the actually interesting parts of your product. That&apos;s the
            whole promise. One route, many runtimes, zero ceremony.
          </p>

          <p>
            Thanks for reading. Go write a route. I&apos;ll be in Oslo, watching
            the sun refuse to set, very politely.
          </p>

          <p>— Devlin</p>
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
                href="/docs/getting-started"
                className="underline underline-offset-4"
              >
                Read the quickstart
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
