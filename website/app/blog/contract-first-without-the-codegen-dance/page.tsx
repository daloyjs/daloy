import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "contract-first-without-the-codegen-dance",
  title:
    "Contract-First Without the Codegen Dance: OpenAPI, Typed Client, and Contract Tests From One Definition",
  description:
    "One app.route({...}) projects into generateOpenAPI(app), createClient(app), and runContractTests(app), plus pnpm gen for a Hey API typed fetch SDK your frontend can import. With pictures.",
  date: "2026-05-21",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work. Has maintained too many openapi.yaml files in too many monorepos. Currently writes TypeScript from Norway.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS contract-first",
    "OpenAPI from TypeScript",
    "Hey API openapi-ts",
    "typed fetch client",
    "contract tests TypeScript",
    "generateOpenAPI",
    "createClient DaloyJS",
    "runContractTests",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ROUTE_FILE = `// apps/api/src/routes/books.ts
import { z } from "zod";
import { app } from "../app.ts";

const Book = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  publishedYear: z.number().int().optional(),
});

const Problem = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
});

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  summary: "Fetch a book by id",
  tags: ["books"],
  request: {
    params: z.object({ id: z.string().min(1) }),
  },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found", body: Problem },
  },
  handler: async ({ params }) => {
    if (params.id === "missing") {
      return {
        status: 404,
        body: {
          type: "https://example.com/errors/not-found",
          title: "Not Found",
          status: 404,
        },
      };
    }
    return {
      status: 200,
      body: { id: params.id, title: \`Book \${params.id}\`, author: "Unknown" },
    };
  },
});`;

const PROJECTION_OPENAPI = `// apps/api/scripts/dump-openapi.ts
import { writeFileSync } from "node:fs";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { app } from "../src/app.ts";

const doc = generateOpenAPI(app, {
  info: { title: "Bookstore API", version: "1.0.0" },
  servers: [{ url: "http://localhost:3000" }],
});

writeFileSync("generated/openapi.json", JSON.stringify(doc, null, 2));`;

const OPENAPI_PEEK = `$ jq '.paths."/books/{id}".get | {operationId, responses: (.responses | keys)}' \\
    generated/openapi.json
{
  "operationId": "getBookById",
  "responses": ["200", "404"]
}`;

const PROJECTION_CLIENT = `// apps/api/tests/books.in-process.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInProcessClient } from "@daloyjs/core/client";
import { app } from "../src/app.ts";

// In-process: route the client's fetch straight into the app. No socket,
// no port, no flaky CI. Same validation, same response shape as production.
const client = createInProcessClient(app);

test("getBookById - 200 has a typed body", async () => {
  const res = await client.getBookById({ params: { id: "42" } });
  assert.equal(res.status, 200);
  if (res.status === 200) {
    // res.body is { id: string; title: string; author: string; publishedYear?: number }
    assert.equal(res.body.id, "42");
  }
});

test("getBookById - 404 has the Problem body", async () => {
  const res = await client.getBookById({ params: { id: "missing" } });
  assert.equal(res.status, 404);
  if (res.status === 404) {
    assert.equal(res.body.status, 404);
    // @ts-expect-error - title belongs to Book, not Problem
    res.body.title;
  }
});`;

const PROJECTION_CONTRACT = `// apps/api/tests/contract.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runContractTests } from "@daloyjs/core/contract";
import { app } from "../src/app.ts";

test("every route is a good citizen", async () => {
  const report = await runContractTests(app, {
    requireOperationId: true,        // default
    allowBodyOnSafeMethods: false,   // default
  });

  if (!report.ok) {
    // Pretty failure: which route, which check, which message.
    for (const issue of report.issues) {
      console.error(
        \`  ✗ \${issue.method} \${issue.path}: \${issue.message} (\${issue.code})\`,
      );
    }
  }

  assert.ok(report.ok, \`\${report.issues.length} contract issue(s) found\`);
  console.log(\`✓ \${report.checked} routes checked\`);
});`;

const PNPM_GEN_SCRIPTS = `// apps/api/package.json
{
  "scripts": {
    "gen:openapi": "tsx scripts/dump-openapi.ts",
    "gen:client":  "openapi-ts",
    "gen":         "pnpm gen:openapi && pnpm gen:client"
  }
}`;

const HEY_API_CONFIG = `// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", postProcess: ["prettier"] },
  plugins: ["@hey-api/client-fetch", "@hey-api/sdk", "@hey-api/typescript"],
});`;

const PNPM_GEN_RUN = `$ pnpm gen
> apps/api gen
> pnpm gen:openapi && pnpm gen:client

✓ wrote generated/openapi.json
✓ wrote generated/client/index.ts
✓ wrote generated/client/sdk.gen.ts
✓ wrote generated/client/client.gen.ts
✓ wrote generated/client/types.gen.ts`;

const FRONTEND_USAGE = `// apps/web/app/books/[id]/page.tsx
import { notFound } from "next/navigation";
import { client, getBookById } from "@/api-client";

client.setConfig({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
});

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data, error, response } = await getBookById({ path: { id } });

  if (response.status === 404) notFound();
  if (error) throw error;

  return (
    <article>
      <h1>{data.title}</h1>
      <p className="text-muted-foreground">by {data.author}</p>
      {data.publishedYear ? <p>{data.publishedYear}</p> : null}
    </article>
  );
}`;

const DIFF_DEMO = `// One change in the route file...
- 200: { description: "Found", body: Book },
+ 200: { description: "Found", body: Book.extend({ rating: z.number().min(0).max(5) }) },

// ...and immediately, without writing types or running codegen by hand:
//
//   - generated/openapi.json gains \`rating\` in the 200 schema
//   - createClient(app) narrows res.body to include rating
//   - the contract test still passes (operationId, response set unchanged)
//   - the frontend's getBookById() refuses to compile until you render it
//
// That last bullet is the reason this workflow matters.`;

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
 * EditorFrame - a purely visual "VS Code-ish" chrome around a code sample.
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
 * ProjectionStep - numbered card with arrow-like header used to walk the
 * reader through "the route projects into N things". Adds a bit of visual
 * structure to the long middle section.
 */
function ProjectionStep({
  index,
  title,
  from,
  to,
  children,
}: {
  index: number;
  title: string;
  from: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <section className="not-prose my-10 rounded-xl border bg-muted/20 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-sm font-semibold">
          {index}
        </span>
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {from}
        </Badge>
        <span aria-hidden className="text-muted-foreground">
          -&gt;
        </span>
        <Badge className="font-mono">{to}</Badge>
      </div>
      <div className="mt-4 space-y-4 text-sm leading-7 text-foreground">
        {children}
      </div>
    </section>
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
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Contract-first</Badge>
            <Badge variant="outline">Show, don&apos;t tell</Badge>
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
            Hi, I&apos;m Devlin. Ten years of fullstack work. I have, in my
            career, personally maintained a hand-written{" "}
            <code>openapi.yaml</code> in a monorepo, and I have personally been
            the reason it was three sprints out of date. I&apos;ve also been the
            person who shipped a frontend that called <code>POST /book</code>{" "}
            when the backend had renamed it to <code>POST /books</code> the week
            before. So when I tell you the codegen dance is a real problem,
            please understand: I am one of the dancers.
          </p>

          <p>
            The <Link href="/blog/introducing-daloyjs">launch post</Link>{" "}
            promised you that <em>one</em>{" "}
            <code>app.route(&#123;...&#125;)</code> call is the source of truth
            for validation, types, OpenAPI, the typed client, and contract
            tests. This post walks one route into OpenAPI, the typed client, and
            contract tests. We&apos;re going to define a single route, project
            it into all three artifacts on disk and in tests, then run{" "}
            <code>pnpm gen</code> and use the typed SDK from a separate Next.js
            frontend. The route remains the source, so there is no YAML copy to
            edit or version separately.
          </p>

          <h2>The one route</h2>

          <p>
            This file is the entire input. Everything that follows derives from
            it and changes only when the route changes. That is what
            &quot;single source of truth&quot; means in practice.
          </p>

          <EditorFrame
            files={["apps/api/src/routes/books.ts", "apps/api/src/app.ts"]}
            activeFile="apps/api/src/routes/books.ts"
            status="● apps/api/src/routes/books.ts, saved"
          >
            <CodeBlock language="ts" code={ROUTE_FILE} />
          </EditorFrame>

          <p>
            One route, two declared responses (<code>200</code> and{" "}
            <code>404</code>), each with a real Zod schema. Hold that file in
            your head, we&apos;ll come back to it three times.
          </p>

          <h2>Three projections, one input</h2>

          <ProjectionStep
            index={1}
            title="generateOpenAPI(app), the spec is a function of the routes"
            from="app.route({...})"
            to="generated/openapi.json"
          >
            <p>
              The registered routes produce the OpenAPI document as a pure
              function. Call <code>generateOpenAPI(app, ...)</code>
              {", "}get a fully-formed RFC 3.1 document back, write it wherever
              you want it.
            </p>

            <EditorFrame
              files={["apps/api/scripts/dump-openapi.ts"]}
              activeFile="apps/api/scripts/dump-openapi.ts"
              status="tsx scripts/dump-openapi.ts ✓ wrote 14 KB"
            >
              <CodeBlock language="ts" code={PROJECTION_OPENAPI} />
            </EditorFrame>

            <p>
              The proof is one <code>jq</code> away:
            </p>

            <CodeBlock language="bash" code={OPENAPI_PEEK} />

            <p>
              The <code>operationId</code> on the route became the{" "}
              <code>operationId</code> in the spec. The set of declared
              responses became the set of documented responses. There is no
              second list to update.
            </p>
          </ProjectionStep>

          <ProjectionStep
            index={2}
            title="createInProcessClient(app), the typed client lives in the same monorepo"
            from="app.route({...})"
            to="ClientFor<App>"
          >
            <p>
              <code>createInProcessClient&lt;A extends App&gt;(app)</code>{" "}
              returns an object keyed by every <code>operationId</code> you
              defined, with full input/output type narrowing per status. The
              classic use for it is &quot;in-process integration tests&quot;:
              requests traverse <code>app.fetch</code> automatically, giving you
              a real end-to-end test without a socket:
            </p>

            <EditorFrame
              files={[
                "apps/api/tests/books.in-process.test.ts",
                "apps/api/src/routes/books.ts",
              ]}
              activeFile="apps/api/tests/books.in-process.test.ts"
              status="✓ node --test, 2 passing"
            >
              <CodeBlock language="ts" code={PROJECTION_CLIENT} />
            </EditorFrame>

            <p>
              The two things I want you to notice in that snippet are also the
              two things I celebrate every time I see them at work. First, the{" "}
              <code>res.body</code> inside the <code>200</code> branch is
              narrowed to the <code>Book</code> shape, not the union of every
              declared response, the actual <code>200</code> one. Second, the{" "}
              <code>@ts-expect-error</code> comment in the
              <code>404</code> branch <em>passes</em>
              {": "}trying to read <code>title</code> from a{" "}
              <code>Problem</code> is a compile error, by construction.
            </p>
          </ProjectionStep>

          <ProjectionStep
            index={3}
            title="runContractTests(app), the guardrails you forgot to write"
            from="app.route({...})"
            to="{ ok, checked, issues }"
          >
            <p>
              <code>runContractTests(app, opts)</code> walks every registered
              route and checks the boring rules that turn into 3am bugs: every
              route has a unique <code>operationId</code>
              {", "}every route declares at least one response, declared{" "}
              <code>examples</code> validate against their declared schema, and
              safe methods don&apos;t carry request bodies unless you explicitly
              allow it.
            </p>

            <EditorFrame
              files={["apps/api/tests/contract.test.ts"]}
              activeFile="apps/api/tests/contract.test.ts"
              status="✓ 12 routes checked, all clean"
            >
              <CodeBlock language="ts" code={PROJECTION_CONTRACT} />
            </EditorFrame>

            <p>
              This is the test I add first to every new project, before any
              feature tests. It catches the &quot;oh, two routes accidentally
              share an <code>operationId</code> because copy-paste&quot; bug
              that ruins your generated SDK before it&apos;s even generated.
              Cheap to add; costly when you skip it.
            </p>
          </ProjectionStep>

          <h2>The codegen dance, but the dance is one command</h2>

          <p>
            The three projections above stay in your repo. For consumers in
            another repo, team, or language, <code>pnpm gen</code> produces the
            client artifacts. It uses two scripts and one parent script:
          </p>

          <EditorFrame
            files={["apps/api/package.json", "openapi-ts.config.ts"]}
            activeFile="apps/api/package.json"
            status="scripts.gen = gen:openapi && gen:client"
          >
            <CodeBlock language="json" code={PNPM_GEN_SCRIPTS} />
          </EditorFrame>

          <p>
            <code>gen:openapi</code> calls the dump script you already saw.{" "}
            <code>gen:client</code> hands that JSON to{" "}
            <a href="https://heyapi.dev" target="_blank" rel="noreferrer">
              Hey API&apos;s
            </a>{" "}
            <code>@hey-api/openapi-ts</code> via this tiny config:
          </p>

          <EditorFrame
            files={["openapi-ts.config.ts"]}
            activeFile="openapi-ts.config.ts"
            status="hey-api · plugins: client-fetch, sdk, typescript"
          >
            <CodeBlock language="ts" code={HEY_API_CONFIG} />
          </EditorFrame>

          <p>Generate the client:</p>

          <CodeBlock language="bash" code={PNPM_GEN_RUN} />

          <p>
            One command replaces the old Java invocation, language flags, Docker
            wrapper, and post-processing script. <code>generated/client/</code>{" "}
            is a real, typed, tree-shakeable fetch SDK that you can import from
            anywhere you can import TypeScript.
          </p>

          <h2>Using it from a separate Next.js frontend</h2>

          <p>
            The frontend completes the loop. It lives in a different app (
            <code>apps/web</code> in a monorepo, or a totally separate repo with
            the client published to a registry, your call). It imports the
            generated SDK and calls it like any other module. Pay attention to
            the call shape, <code>path</code> for path params,{" "}
            <code>{`{ data, error, response }`}</code> destructure for results:
          </p>

          <EditorFrame
            files={[
              "apps/web/app/books/[id]/page.tsx",
              "apps/web/api-client/index.ts",
            ]}
            activeFile="apps/web/app/books/[id]/page.tsx"
            status="next 16 · server component · typed"
          >
            <CodeBlock language="tsx" code={FRONTEND_USAGE} />
          </EditorFrame>

          <p>
            That is a Next.js 16 server component, with shadcn-style classes,
            calling a typed SDK that was generated from a Zod schema on the
            other side of the monorepo. <code>data.title</code> is a{" "}
            <code>string</code>. <code>data.publishedYear</code> is a{" "}
            <code>number | undefined</code>
            {". "}If the backend renames <code>title</code> to <code>name</code>
            {", "}this file refuses to compile, and the frontend developer finds
            out before the PR even opens, not after the user complains.
          </p>

          <h2>The diff that doesn&apos;t exist</h2>

          <p>Change one field in the route and watch what moves on its own.</p>

          <EditorFrame
            files={["apps/api/src/routes/books.ts"]}
            activeFile="apps/api/src/routes/books.ts"
            status="◐ src/routes/books.ts, modified"
          >
            <CodeBlock language="diff" code={DIFF_DEMO} />
          </EditorFrame>

          <p>
            The route diff is two lines. Your <code>openapi.yaml</code>
            {", "}client types, contract tests, frontend imports, and
            &quot;types package&quot; stay at <em>zero lines</em>
            {", "}because those files don&apos;t exist as separate truths
            anymore. Commit the route change and run <code>pnpm gen</code> to
            regenerate the SDK.
          </p>

          <h2>The four-step checklist for new projects</h2>

          <p>
            If you&apos;re bootstrapping a contract-first stack today, this is
            the order I&apos;d do it in, having now done it more times than I
            care to admit:
          </p>

          <ol>
            <li>
              Write the smallest route with real <code>request</code> and{" "}
              <code>responses</code> schemas. Don&apos;t hand-roll types
              anywhere.
            </li>
            <li>
              Add the contract test (<code>runContractTests(app)</code>) before
              any feature test. It costs nothing and catches the bugs that hurt
              the most.
            </li>
            <li>
              Add the in-process client test (
              <code>createInProcessClient(app)</code>). You now have integration
              coverage without a server.
            </li>
            <li>
              Wire <code>pnpm gen</code> and import the generated SDK in your
              frontend. Delete any hand-written API client. (This is the
              dopamine part.)
            </li>
          </ol>

          <h2>Limits</h2>

          <p>
            Code generation has had a bad reputation in the JS world for a long
            time, and it earned that reputation. Most pipelines were brittle,
            slow, and produced types that looked like they were translated from
            another language by someone who didn&apos;t want to be there. The
            workflow works because three mature pieces line up: Standard Schema
            lets the route own validation <em>and</em> types, OpenAPI 3.1 is the
            lingua franca for handing that to the outside world, and Hey API
            takes that spec and produces a typed fetch SDK that doesn&apos;t
            look like a translation. We just connected them.
          </p>

          <p>
            If you want to go deeper, the{" "}
            <Link href="/docs/typed-client">typed client docs</Link>
            {", "}the <Link href="/docs/openapi">OpenAPI docs</Link>
            {", "}and the <Link href="/docs/testing">testing docs</Link> each
            cover one of these three projections in detail. Or run{" "}
            <code>pnpm create daloy@latest</code>
            {", "}point <code>pnpm gen</code> at it, and watch the dance turn
            into a single key press.
          </p>

          <p>
            Go delete a hand-written API client.
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
                href="/docs/typed-client"
                className="underline underline-offset-4"
              >
                Read the typed-client docs
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
