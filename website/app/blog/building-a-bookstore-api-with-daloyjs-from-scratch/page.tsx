import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "building-a-bookstore-api-with-daloyjs-from-scratch",
  title: "Building a Bookstore API with DaloyJS From Scratch",
  description:
    "A route-by-route walkthrough: create the project with create-daloy, model a Book with Zod, add list / create / fetch-by-id endpoints, watch validation errors arrive as RFC 9457 problem+json automatically, emit OpenAPI, generate a typed client, and write the whole test suite with app.request() — no HTTP server required.",
  date: "2026-05-20",
  readingTime: "14 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. This is the walkthrough I wish someone had handed me on day one — bookmark it and send it to the next new hire.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS tutorial",
    "bookstore API",
    "create-daloy",
    "Zod schema route",
    "app.request testing",
    "generateOpenAPI",
    "Hey API typed client",
    "RFC 9457 validation errors",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SCAFFOLD = `# Pick a template once, never write this glue again.
pnpm create daloy@latest bookstore-api \\
  --template node-basic \\
  --minimal \\
  --yes

cd bookstore-api
pnpm install
pnpm dev
# ─→ listening on http://localhost:3000
# ─→ API docs       http://localhost:3000/docs
# ─→ OpenAPI JSON   http://localhost:3000/openapi.json
# ─→ Health         http://localhost:3000/healthz`;

const PROJECT_TREE = `bookstore-api/
├─ src/
│  ├─ build-app.ts        # pure factory: \`buildApp(): App\`
│  ├─ index.ts            # serve(app, { port })
│  └─ routes/
│     └─ books.ts         # <- everything we build today
├─ tests/
│  └─ books.test.ts       # node:test + app.request()
├─ scripts/
│  └─ dump-openapi.ts     # writes generated/openapi.json
├─ openapi-ts.config.ts   # Hey API codegen config
├─ AGENTS.md              # rules of the road for coding agents
└─ package.json`;

const SCHEMAS = `// src/routes/books.ts
import { z } from "zod";

/**
 * The on-the-wire shape of a Book.
 * Used in route responses and the GET /books list.
 */
export const Book = z.object({
  id:        z.string().uuid(),
  title:     z.string().min(1).max(200),
  author:    z.string().min(1).max(120),
  publishedAt: z.string().date(),       // "YYYY-MM-DD"
  pages:     z.number().int().positive(),
  tags:      z.array(z.string()).default([]),
});

/**
 * Payload for POST /books — server assigns the id, so it's omitted here.
 * Note how \`tags\` is optional but the response always has the default array.
 */
export const CreateBook = Book.omit({ id: true }).extend({
  tags: z.array(z.string()).optional(),
});

export type BookT       = z.infer<typeof Book>;
export type CreateBookT = z.infer<typeof CreateBook>;`;

const STORE = `// src/routes/books.ts (continued)
//
// A real app uses Prisma, Drizzle, or whatever you brought from your last
// project. For the tutorial we keep an in-memory Map so the focus stays
// on the framework, not the database.
import { randomUUID } from "node:crypto";

const store = new Map<string, BookT>();

// Seed two rows so GET /books has something to return on first boot.
for (const seed of [
  { title: "Noli Me Tangere",  author: "José Rizal",   publishedAt: "1887-03-21", pages: 351, tags: ["classic"] },
  { title: "El Filibusterismo", author: "José Rizal", publishedAt: "1891-09-18", pages: 280, tags: ["classic"] },
]) {
  const id = randomUUID();
  store.set(id, { id, tags: [], ...seed });
}`;

const REGISTER = `// src/routes/books.ts (continued)
import {
  type App,
  NotFoundError,
} from "@daloyjs/core";

/**
 * Mount every book-related route on the given app.
 * Pure function on purpose — keeps build-app.ts small and lets tests
 * spin up a fresh App with just these routes if they want to.
 */
export function registerBookRoutes(app: App) {
  list(app);
  getById(app);
  create(app);
}`;

const LIST_ROUTE = `// src/routes/books.ts (continued)
function list(app: App) {
  app.route({
    method: "GET",
    path: "/books",
    operationId: "listBooks",
    tags: ["Books"],
    request: {
      // Query params are validated and coerced — the handler sees real numbers.
      query: z.object({
        limit:  z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
        tag:    z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Paginated list of books",
        body: z.object({
          items: z.array(Book),
          total: z.number().int().nonnegative(),
        }),
      },
    },
    handler: async ({ query }) => {
      const all = [...store.values()];
      const filtered = query.tag
        ? all.filter((b) => b.tags.includes(query.tag!))
        : all;
      const items = filtered.slice(query.offset, query.offset + query.limit);
      return { status: 200, body: { items, total: filtered.length } };
    },
  });
}`;

const GET_BY_ID = `// src/routes/books.ts (continued)
function getById(app: App) {
  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      200: { description: "Found",     body: Book },
      404: { description: "Not found" /* problem+json — framework adds it */ },
    },
    handler: async ({ params }) => {
      const book = store.get(params.id);
      if (!book) throw new NotFoundError(\`No book with id \${params.id}\`);
      return { status: 200, body: book };
    },
  });
}`;

const CREATE_ROUTE = `// src/routes/books.ts (continued)
function create(app: App) {
  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    request: { body: CreateBook },
    responses: {
      201: {
        description: "Created",
        body: Book,
        headers: {
          location: { schema: z.string(), description: "URI of the new book" },
        },
      },
      // No 422 entry needed — the framework registers one automatically for
      // any route with a validated request, pointing at ProblemDetails.
    },
    handler: async ({ body }) => {
      const id = randomUUID();
      const created: BookT = { id, tags: [], ...body };
      store.set(id, created);
      return {
        status: 201,
        body: created,
        headers: { location: \`/books/\${id}\` },
      };
    },
  });
}`;

const VALIDATION_RESPONSE = `# POST /books with an obviously bad body:
curl -sS -X POST http://localhost:3000/books \\
  -H 'content-type: application/json' \\
  -d '{ "title": "", "pages": -3, "publishedAt": "yesterday" }' | jq .

# HTTP/1.1 422 Unprocessable Entity
# Content-Type: application/problem+json
{
  "type":   "https://daloyjs.dev/errors/validation",
  "title":  "Request validation failed",
  "status": 422,
  "detail": "Invalid body",
  "errors": [
    { "path": "title",       "message": "String must contain at least 1 character(s)" },
    { "path": "author",      "message": "Required" },
    { "path": "publishedAt", "message": "Invalid date" },
    { "path": "pages",       "message": "Number must be greater than 0" }
  ]
}
# You did not write a single line for this. Schema + framework. Done.`;

const BUILD_APP = `// src/build-app.ts — wire the routes onto the app.
import {
  App,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";

import { registerBookRoutes } from "./routes/books.js";

export function buildApp(): App {
  const app = new App({
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 5_000,
    production: process.env.NODE_ENV === "production",
    docs: true,                         // /docs, /openapi.json, /openapi.yaml
    openapi: {
      servers: [{ url: \`http://localhost:\${process.env.PORT ?? 3000}\` }],
    },
  });

  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  registerBookRoutes(app);
  return app;
}

export default buildApp;`;

const ENTRY = `// src/index.ts — boot the HTTP listener. The only file that does I/O.
import { serve } from "@daloyjs/core/node";
import { printStartupBanner } from "@daloyjs/core/banner";
import { buildApp } from "./build-app.js";

const app  = buildApp();
const port = Number(process.env.PORT ?? 3000);

serve(app, { port });

const url = \`http://localhost:\${port}\`;
printStartupBanner({
  name: "Bookstore API",
  url,
  runtime: "Node.js",
  links: [
    { label: "API docs",     url: \`\${url}/docs\` },
    { label: "OpenAPI JSON", url: \`\${url}/openapi.json\` },
    { label: "Health",       url: \`\${url}/healthz\` },
  ],
});`;

const TESTS = `// tests/books.test.ts — node:test + app.request(). No port. No flakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/build-app.ts";

test("GET /books returns the seeded items", async () => {
  const app = buildApp();
  const res = await app.request("/books");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, 2);
  assert.equal(body.items[0].title, "Noli Me Tangere");
});

test("POST /books creates and round-trips through GET /books/:id", async () => {
  const app = buildApp();
  const create = await app.request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Po-on",
      author: "F. Sionil José",
      publishedAt: "1984-01-01",
      pages: 379,
      tags: ["classic", "rosales-saga"],
    }),
  });
  assert.equal(create.status, 201);
  const location = create.headers.get("location")!;
  assert.match(location, /^\\/books\\/[0-9a-f-]{36}$/);

  const created = await create.json();
  const fetched = await app.request(location);
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), created);
});

test("POST /books returns RFC 9457 422 on a bad body", async () => {
  const app = buildApp();
  const res = await app.request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "", pages: -3, publishedAt: "yesterday" }),
  });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get("content-type"), "application/problem+json");

  const problem = await res.json();
  assert.equal(problem.type, "https://daloyjs.dev/errors/validation");
  const fields = problem.errors.map((e: { path: string }) => e.path).sort();
  assert.deepEqual(fields, ["author", "pages", "publishedAt", "title"]);
});

test("GET /books/:id returns 404 problem+json for unknown id", async () => {
  const app = buildApp();
  const res = await app.request("/books/00000000-0000-0000-0000-000000000000");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
});`;

const RUN_TESTS = `pnpm test
# > node --test --import=tsx tests/**/*.test.ts
#
# ✔ GET /books returns the seeded items (8.4ms)
# ✔ POST /books creates and round-trips through GET /books/:id (12.1ms)
# ✔ POST /books returns RFC 9457 422 on a bad body (5.9ms)
# ✔ GET /books/:id returns 404 problem+json for unknown id (3.2ms)
#
# ℹ tests 4
# ℹ pass 4
# ℹ fail 0`;

const DUMP_OPENAPI = `// scripts/dump-openapi.ts — single source of truth for the spec.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateOpenAPI } from "@daloyjs/core";
import { buildApp } from "../src/build-app.ts";

const app = buildApp();
const spec = generateOpenAPI(app, {
  info: { title: "Bookstore API", version: "0.1.0" },
});

const out = "generated/openapi.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec, null, 2) + "\\n");
console.log("Wrote", out);`;

const GEN_CLIENT = `# Step 1: dump the spec from the live route table.
pnpm gen:openapi
# ─→ Wrote generated/openapi.json

# Step 2: run Hey API codegen against the spec.
pnpm gen
# ─→ generated/client/sdk.gen.ts
# ─→ generated/client/types.gen.ts
# ─→ generated/client/client.gen.ts

# The two scripts are also chained on CI as \`pnpm gen:all\`.`;

const USE_CLIENT = `// apps/web/lib/books.ts — frontend consumer of the typed client.
import { client, listBooks, createBook, getBookById } from "@/generated/client";

client.setConfig({ baseUrl: process.env.NEXT_PUBLIC_API_URL });

export async function fetchFirstPage() {
  const { data, error } = await listBooks({
    query: { limit: 10, offset: 0 },     // ← typed; required keys complained-about
  });
  if (error) throw new Error(error.title);
  return data;                            // ← { items: Book[]; total: number }
}

export async function addBook(input: Parameters<typeof createBook>[0]["body"]) {
  const { data, error } = await createBook({ body: input });
  if (error) {
    // \`error\` is ProblemDetails — autocompletes type/title/detail/status.
    if (error.status === 422) {
      // error.errors is { path; message }[] — straight into react-hook-form.
      return { ok: false as const, fieldIssues: error.errors ?? [] };
    }
    throw new Error(error.title);
  }
  return { ok: true as const, book: data };
}`;

const SCRIPTS_BLOCK = `// package.json — the muscle memory commands.
{
  "scripts": {
    "dev":          "tsx watch src/index.ts",
    "build":        "tsc -p tsconfig.json",
    "start":        "node --enable-source-maps dist/index.js",
    "test":         "node --test --import=tsx 'tests/**/*.test.ts'",
    "typecheck":    "tsc -p tsconfig.json --noEmit",
    "gen:openapi":  "tsx scripts/dump-openapi.ts",
    "gen":          "openapi-ts",
    "gen:all":      "pnpm gen:openapi && pnpm gen"
  }
}`;

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

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-4 flex gap-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-sm font-semibold">
        {step}
      </div>
      <div className="min-w-0 flex-1">
        <p className="leading-tight font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
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
            <Badge variant="outline">Tutorial</Badge>
            <Badge variant="outline">Getting started</Badge>
            <Badge variant="outline">Bookstore</Badge>
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
            Hi, Devlin again. Ten years of fullstack, currently in Norway, and
            the post I get asked for most often is some version of{" "}
            <em>just show me what a real route looks like, end to end.</em> So
            this is that post. We build the canonical Bookstore API — list
            books, fetch one by id, create one, validate the input, ship the
            docs, generate a typed client, and write tests that run faster than
            your dev server boots. By the end of this you could plausibly hand
            someone a Slack link and say <em>read this first</em>.
          </p>

          <p>
            One promise up front: every code snippet in here is a thing you can
            actually paste. No pseudocode, no &quot;left as an exercise for the
            reader&quot;. The whole tutorial is the equivalent of a single
            afternoon of work — most of which the scaffolder does for you while
            you go get a coffee.
          </p>

          <h2>The seven steps, at a glance</h2>

          <StepCard step={1} title="Scaffold with create-daloy">
            One command. You pick the runtime and the package manager; the tool
            drops AGENTS.md, OpenAPI plumbing, and the test harness on disk.
          </StepCard>
          <StepCard step={2} title="Model the Book with Zod">
            A single schema is the source of truth: validation, response body,
            OpenAPI types, and the typed client all read from it.
          </StepCard>
          <StepCard step={3} title="Add the three routes">
            <code>GET /books</code>, <code>GET /books/:id</code>,{" "}
            <code>POST /books</code>. Throw, don&apos;t return.
          </StepCard>
          <StepCard step={4} title="Watch validation errors arrive for free">
            The framework auto-emits RFC 9457 problem+json with a{" "}
            <code>errors</code> array. You wrote zero lines for this.
          </StepCard>
          <StepCard step={5} title="Mount docs and serve">
            <code>/docs</code>, <code>/openapi.json</code>, and{" "}
            <code>/openapi.yaml</code> come up automatically when{" "}
            <code>docs: true</code>.
          </StepCard>
          <StepCard step={6} title="Generate the typed client">
            <code>pnpm gen:openapi</code> dumps the spec, <code>pnpm gen</code>{" "}
            turns it into a fully typed <code>fetch</code> SDK.
          </StepCard>
          <StepCard step={7} title="Test everything with app.request()">
            No port, no fetch, no flakes. Same App you ship.
          </StepCard>

          <h2>Step 1 — Scaffold</h2>

          <EditorFrame
            files={["terminal · zsh"]}
            activeFile="terminal · zsh"
            status="create-daloy 0.x · template node-basic · minimal demo"
          >
            <CodeBlock language="bash" code={SCAFFOLD} />
          </EditorFrame>

          <p>
            <code>--minimal</code> strips the example bookstore routes from the
            template so we can rebuild them ourselves — pedagogy over
            convenience. (If you skip <code>--minimal</code>, the template gives
            you a working <code>/books/:id</code> route out of the box. Both
            paths are fine.)
          </p>

          <EditorFrame
            files={["tree · bookstore-api"]}
            activeFile="tree · bookstore-api"
            status="what just landed on disk"
          >
            <CodeBlock language="bash" code={PROJECT_TREE} />
          </EditorFrame>

          <h2>Step 2 — Model the Book</h2>

          <p>
            Open <code>src/routes/books.ts</code> (create it if you used{" "}
            <code>--minimal</code>) and start with the schema. The single most
            important habit in DaloyJS:{" "}
            <strong>
              the Zod schema is the source of truth for everything
            </strong>{" "}
            — validation, response shape, OpenAPI, and the generated TypeScript
            types. Write it once.
          </p>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="one schema · validation + OpenAPI + types"
          >
            <CodeBlock language="ts" code={SCHEMAS} />
          </EditorFrame>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="in-memory store — swap for Prisma later"
          >
            <CodeBlock language="ts" code={STORE} />
          </EditorFrame>

          <h2>Step 3 — Register the routes</h2>

          <p>
            Three little functions, each calling <code>app.route(...)</code>. We
            keep them on a single registration function so{" "}
            <code>build-app.ts</code> stays tidy.
          </p>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="single entry point · easy to test in isolation"
          >
            <CodeBlock language="ts" code={REGISTER} />
          </EditorFrame>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="GET /books · query validated & coerced · paginated"
          >
            <CodeBlock language="ts" code={LIST_ROUTE} />
          </EditorFrame>

          <p>
            That <code>z.coerce.number()</code> is the small kindness that fixes
            the <em>every framework on earth</em> bug of handlers receiving{" "}
            <code>&quot;20&quot;</code> when they asked for <code>20</code>.
            Schema-first means schema-once.
          </p>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="GET /books/:id · throw NotFoundError — never return 404 by hand"
          >
            <CodeBlock language="ts" code={GET_BY_ID} />
          </EditorFrame>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="POST /books · 201 + Location · 422 auto-registered"
          >
            <CodeBlock language="ts" code={CREATE_ROUTE} />
          </EditorFrame>

          <h2>Step 4 — Free validation errors</h2>

          <p>
            Send a deliberately wrong body and watch what comes back. You did
            not write any of this response — the schema and the framework
            conspired to produce it.
          </p>

          <EditorFrame
            files={["terminal · curl"]}
            activeFile="terminal · curl"
            status="application/problem+json · errors[] keyed by field path"
          >
            <CodeBlock language="bash" code={VALIDATION_RESPONSE} />
          </EditorFrame>

          <p>
            For the long version of why this matters and how to consume it on
            the frontend, see the{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              Problem Details post
            </Link>
            . For now, the punchline is: every wrong-shaped request your API
            will ever see returns the same document shape. The frontend code
            that handles it is one helper, total.
          </p>

          <h2>Step 5 — Wire it onto the App and serve</h2>

          <EditorFrame
            files={["src/build-app.ts"]}
            activeFile="src/build-app.ts"
            status="pure factory · imported by serve, tests, and the OpenAPI dumper"
          >
            <CodeBlock language="ts" code={BUILD_APP} />
          </EditorFrame>

          <EditorFrame
            files={["src/index.ts"]}
            activeFile="src/index.ts"
            status="the ONLY file in src/ that does I/O"
          >
            <CodeBlock language="ts" code={ENTRY} />
          </EditorFrame>

          <p>
            Run <code>pnpm dev</code> and visit{" "}
            <code>http://localhost:3000/docs</code> — Scalar renders your three
            routes, complete with the Zod-derived schemas, the <code>422</code>{" "}
            problem+json response, and a working <em>Try it</em> panel. You did
            not write a single line of documentation; you wrote a schema and
            three handlers, and the docs fell out the other side.
          </p>

          <h2>Step 6 — Generate the typed client</h2>

          <EditorFrame
            files={["scripts/dump-openapi.ts"]}
            activeFile="scripts/dump-openapi.ts"
            status="dumps the SAME spec /openapi.json serves at runtime"
          >
            <CodeBlock language="ts" code={DUMP_OPENAPI} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · zsh"]}
            activeFile="terminal · zsh"
            status="two commands · one chained script (gen:all)"
          >
            <CodeBlock language="bash" code={GEN_CLIENT} />
          </EditorFrame>

          <p>
            Now switch hats and pretend you&apos;re the frontend team. The
            generated SDK gives you typed function calls for every route, typed
            bodies, typed responses, and — crucially — a typed{" "}
            <code>error</code> field shaped like <code>ProblemDetails</code>.
            Autocomplete owns the rest.
          </p>

          <EditorFrame
            files={["apps/web/lib/books.ts"]}
            activeFile="apps/web/lib/books.ts"
            status="frontend code · zero hand-written request types"
          >
            <CodeBlock language="ts" code={USE_CLIENT} />
          </EditorFrame>

          <h2>Step 7 — Test it (without booting a server)</h2>

          <p>
            <code>app.request(url, init?)</code> is the same App your production
            server wraps, but called in-process. No port, no
            <code> fetch</code>, no &quot;wait for the dev server to be
            ready&quot;. Faster than your test runner&apos;s spinner.
          </p>

          <EditorFrame
            files={["tests/books.test.ts"]}
            activeFile="tests/books.test.ts"
            status="node:test · zero external deps · runs in milliseconds"
          >
            <CodeBlock language="ts" code={TESTS} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · zsh"]}
            activeFile="terminal · zsh"
            status="four tests · happy + unhappy paths · CI-ready"
          >
            <CodeBlock language="bash" code={RUN_TESTS} />
          </EditorFrame>

          <h2>The muscle-memory scripts</h2>

          <p>
            For when you forget which command does what (you will, I certainly
            do):
          </p>

          <EditorFrame
            files={["package.json"]}
            activeFile="package.json"
            status="all the scripts in one place · paste into your README"
          >
            <CodeBlock language="json" code={SCRIPTS_BLOCK} />
          </EditorFrame>

          <h2>What just happened</h2>

          <p>
            We modeled a domain in Zod. We declared three routes. We got
            validation, 404 handling, RFC 9457 problem+json, an OpenAPI
            document, a Scalar UI, and a fully typed fetch SDK — and we never
            had to write the &quot;glue&quot; that usually fills the first
            thousand lines of a Node project. The tests run without a port. The
            frontend client is generated from the same schema the server uses to
            validate. The error shape is standardized, so the helper that
            consumes it is <em>one</em> function.
          </p>

          <p>If you want to keep going from here:</p>

          <ul>
            <li>
              Swap the in-memory <code>Map</code> for Prisma — see the{" "}
              <Link href="/docs/orm/prisma">Prisma guide</Link>.
            </li>
            <li>
              Add auth and per-route rate limits — the{" "}
              <Link href="/blog/secure-by-default">secure-by-default</Link> post
              covers the defaults you already have.
            </li>
            <li>
              Move the same code to Cloudflare Workers, Bun, Deno, or Vercel
              Edge with no rewrite — the{" "}
              <Link href="/blog/same-app-five-runtimes-verified">
                five-runtimes
              </Link>{" "}
              post shows the proof.
            </li>
            <li>
              Sessions and CSRF for the cookie-based parts of your frontend —
              the <Link href="/blog/sessions-on-the-edge">sessions</Link> and{" "}
              <Link href="/blog/csrf-in-2026-double-submit-and-fetch-metadata">
                CSRF
              </Link>{" "}
              posts have the receipts.
            </li>
          </ul>

          <p>
            That&apos;s the tour. If you send this to a new hire and they get
            stuck on step <em>n</em>, file an issue — I&apos;ll fix the post,
            not the framework.
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
              <Link href="/docs" className="underline underline-offset-4">
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/problem-details-done-right-rfc-9457-errors"
                className="underline underline-offset-4"
              >
                RFC 9457 errors post
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
