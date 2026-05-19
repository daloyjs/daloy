import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "ai-friendly-route-metadata-machine-readable-examples-for-codegen-agents",
  title:
    "AI-Friendly Route Metadata: Machine-Readable Examples for Codegen Agents",
  description:
    "DaloyJS 0.14.1 adds an optional meta field on every route() — structured examples, extra description copy, and free-form x-* extensions — validated against your Standard Schema at build time and surfaced into OpenAPI 3.1 (examples, x-daloy-*) plus a sibling routes.json via daloy inspect --ai. Additive, non-breaking, and built so Hey API, Claude, GPT, and home-grown codegen agents can write correct call sites on the first try.",
  date: "2026-06-07",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently in Norway. Has watched a coding agent hallucinate a 3-field response body for an endpoint that returns 7, then ship the typed client. Now ships an examples block on every public route so the agent has nothing to invent.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS meta",
    "machine-readable OpenAPI examples",
    "daloy inspect --ai",
    "routes.json codegen",
    "Hey API examples",
    "LLM API context",
    "OpenAPI 3.1 x-extensions",
    "contract-first AI",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# What "the codegen agent guessed it" failure mode looks like.
#
# Prompt:  "write a fetch call that creates a book"
#
# What the agent shipped, with full confidence:
#
#   await fetch("/books", {
#     method: "POST",
#     headers: { "content-type": "application/json" },
#     body: JSON.stringify({ name: "Dune" }),   // ← field is 'title', not 'name'
#   });
#   // Response shape it invented:
#   //   { bookId: string, name: string, createdAt: string }
#   //
#   // Real response shape:
#   //   { id: string, title: string }
#
# Why? The OpenAPI doc had a schema, but no examples. The agent read
# the schema, inferred plausible field names from the operationId
# ("createBook"), invented a 'createdAt' because every API has one,
# and shipped a typed client whose types and runtime disagreed.
#
# The schema was not wrong. The schema was just not the most
# pattern-matchable artifact in the room. A single concrete example
# would have anchored the agent to the real field names.`;

const META_FIELD = `// The new optional 'meta' field on app.route(), in one place.
//
// Authored once, surfaced everywhere:
//   - OpenAPI requestBody examples
//   - OpenAPI response examples (per status code)
//   - operation-level x-daloy-examples vendor extension
//   - sibling routes.json via 'daloy inspect --ai'
//   - validated against the route's Standard Schema at build time
//
// Existing routes keep working unchanged. meta is optional everywhere.

import { App } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

const Book = z.object({
  id: z.string(),
  title: z.string(),
}).strict();

app.route({
  method: "POST",
  path: "/books",
  operationId: "createBook",
  tags: ["Books"],
  request: { body: z.object({ title: z.string().min(1) }) },
  responses: {
    201: { description: "Created", body: Book },
    400: { description: "Invalid" },
  },
  meta: {
    description: "Create a book record.",
    tags: ["AI"],
    examples: {
      happy: {
        summary: "Standard create",
        request:  { body: { title: "Dune" } },
        response: { status: 201, body: { id: "1", title: "Dune" } },
      },
      missingTitle: {
        summary: "Validation failure",
        request:  { body: { title: "" } },
        response: { status: 400 },
      },
    },
    extensions: {
      "x-codegen-hint": "books-table",
    },
  },
  handler: async ({ body }) => ({
    status: 201 as const,
    body: { id: crypto.randomUUID(), title: body.title },
  }),
});`;

const BUILD_TIME_VALIDATION = `# What 'pnpm daloy inspect --check' does to every meta.examples block.
#
# For every named example on every route, Daloy validates:
#
#   request.params  → against route.request.params  (when both exist)
#   request.query   → against route.request.query
#   request.headers → against route.request.headers
#   request.body    → against route.request.body
#
#   response.body   → against route.responses[example.response.status].body
#                     (unknown status code is itself an error)
#
# Any mismatch FAILS the contract run, which means:
#
#   - The OpenAPI doc never publishes a sample that does not match the
#     schema. The codegen agent cannot be misled by a stale example
#     because the example cannot survive a stale schema in CI.
#
#   - The example AND the schema are kept honest by the same gate.
#     There is no "examples drift" surface to monitor; it is a build
#     failure.
#
# CI gate (verbatim from the create-daloy template):
#
#   $ pnpm daloy inspect --check
#   ✓ 14 routes
#   ✓ 38 examples validated
#   ✓ no contract issues
#
# Bad example, same gate:
#
#   $ pnpm daloy inspect --check
#   ✗ POST /books · example 'happy' · response.body.id is required
#   exit 1`;

const OPENAPI_OUT = `{
  "paths": {
    "/books": {
      "post": {
        "operationId": "createBook",
        "tags": ["Books", "AI"],
        "x-codegen-hint": "books-table",
        "x-daloy-examples": {
          "happy":        { "summary": "Standard create",     "...": "..." },
          "missingTitle": { "summary": "Validation failure",  "...": "..." }
        },
        "requestBody": {
          "content": {
            "application/json": {
              "schema": { "type": "object", "properties": { "title": { "type": "string" } } },
              "examples": {
                "happy":        { "summary": "Standard create",    "value": { "title": "Dune" } },
                "missingTitle": { "summary": "Validation failure", "value": { "title": ""     } }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Book" },
                "examples": {
                  "happy": { "summary": "Standard create", "value": { "id": "1", "title": "Dune" } }
                }
              }
            }
          },
          "400": { "description": "Invalid" }
        }
      }
    }
  }
}`;

const INSPECT_AI_CMD = `# 'daloy inspect --ai' dumps the route catalog as a single JSON
# document with JSON Schema for every input + output and every
# meta.examples entry. The format every codegen tool and LLM
# system-prompt scratchpad needs.

# Write to disk for Hey API / your codegen pipeline
$ pnpm daloy inspect --ai > routes.json

# Pipe through jq to enumerate operationIds
$ pnpm daloy inspect --ai --json | jq '.routes[].operationId'

# Scope the dump with the usual filters
$ pnpm daloy inspect --ai --tag Books
$ pnpm daloy inspect --ai --method POST

# What an LLM system prompt looks like with this file inlined:
#   "You are writing TypeScript fetch calls for the Books API.
#    The full route catalog and validated examples are below in JSON.
#    Use the operationId for naming, and never invent field names
#    that are not in the request/response JSON Schemas."
#   <routes.json>`;

const ROUTES_JSON = `{
  "daloy":       { "ai": 1 },
  "generatedAt": "2026-05-19T12:00:00.000Z",
  "routeCount":  1,
  "routes": [
    {
      "method":      "POST",
      "path":        "/books",
      "operationId": "createBook",
      "tags":        ["Books", "AI"],
      "request":  { "body": { "type": "object", "properties": { "title": { "type": "string" } } } },
      "responses": {
        "201": { "description": "Created", "body": { "$ref": "#/schemas/Book" } },
        "400": { "description": "Invalid" }
      },
      "examples": {
        "happy": {
          "summary":  "Standard create",
          "request":  { "body": { "title": "Dune" } },
          "response": { "status": 201, "body": { "id": "1", "title": "Dune" } }
        }
      },
      "extensions": { "x-codegen-hint": "books-table" }
    }
  ]
}`;

const WHY_EXAMPLES = `# Why "schema + examples" beats "schema alone" for codegen agents.
#
# The schema tells the agent the SHAPE of a valid payload.
# The example tells the agent what one ACTUALLY LOOKS LIKE.
#
# These are not redundant. They serve different mental operations:
#
#   schema  →  type checker.        Catches structural errors.
#   example →  pattern matcher.     Catches semantic errors.
#
# A schema says: { id: string, title: string }.
# An example says: { id: "1", title: "Dune" } — and the agent now
# knows your ids look like short opaque strings, not UUIDs, not ints,
# not URL slugs. Every downstream call site picks up that signal.
#
# Multiply by the unhappy path:
#
#   The 'missingTitle' example pins exactly which validation rule
#   fires on an empty string. The agent generating a form-validation
#   client now writes the right client-side guard FIRST, not after
#   the user files a bug.
#
# Multiply by extensions:
#
#   x-codegen-hint: "books-table" is a free-form lane for your own
#   conventions. SDK builders, OpenAPI overlays, and prompt templates
#   read it. Daloy does not interpret it — it just preserves it.`;

const SCOPE_NOTES = `# What 'meta' deliberately is — and is not.
#
# It IS:
#   - Optional per-route. Existing routes need zero changes.
#   - A documentation + codegen-aid surface. Examples are validated,
#     so they cannot lie about the schema, but they do NOT replace
#     the schema. The schema remains the single source of truth.
#   - Free-form on the 'extensions' lane. Keys without an 'x-' prefix
#     are auto-prefixed for OpenAPI spec compliance.
#   - Surface-stable across runtimes. The same code emits the same
#     OpenAPI on Node, Bun, Deno, Workers, and Vercel Edge.
#
# It IS NOT:
#   - A runtime mock. Examples are validated at build time and
#     emitted into docs. They do not get returned by the handler.
#     If you want a mock server, that is a separate tool reading
#     'routes.json' or the OpenAPI doc — not a Daloy feature.
#   - A way to override the route schema. If 'response.status: 201'
#     in your example does not exist in 'responses', that is a hard
#     error — not a permissive cast.
#   - Limited to JSON. The schema-aware validator runs against any
#     Standard Schema (Zod, Valibot, ArkType, TypeBox); the example
#     payload is whatever your schema accepts.
#   - A new author surface. It is one optional field on the same
#     'route()' call you were already writing. No new file, no new
#     concept, no new build step.`;

const CARRYING_OVER = `# Adopting it on an existing route, in 6 lines.

  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBook",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "ok", body: Book },
      404: { description: "not found" },
    },
+   meta: {
+     examples: {
+       happy:    { request: { params: { id: "1" } },
+                   response: { status: 200, body: { id: "1", title: "Dune" } } },
+       notFound: { request: { params: { id: "missing" } },
+                   response: { status: 404 } },
+     },
+   },
    handler: async (ctx) => { /* ... */ },
  });

# Run the contract gate. The build either passes or names the bad
# example. Then 'pnpm gen' picks up the new examples on Hey API's
# next codegen pass — your typed client gets enriched docstrings
# for free.
#
$ pnpm daloy inspect --check
$ pnpm gen`;

const WHY_THIS_HELPS = `# Concretely: what changes for the codegen agent.
#
# Before (schema only):
#   Agent reads OpenAPI schema for POST /books.
#   Agent picks plausible field names from operationId.
#   Agent invents a 'createdAt' because every API has one.
#   Agent ships a typed client whose runtime doesn't match its types.
#   PR review catches it. Maybe.
#
# After (schema + validated examples + routes.json):
#   Agent reads OpenAPI schema AND the example { title: "Dune" }.
#   Agent uses the exact field name 'title'.
#   Agent reads the validated response example and knows ids are
#   short strings, not UUIDs, and there is NO 'createdAt' field.
#   Agent writes the test using the 'missingTitle' example for the
#   400 path, because that example told it which validation rule
#   fires on empty input.
#   PR review checks the handler, not the fetch call.
#
# Not theoretical. This is the diff I see on PRs where the agent
# had a routes.json in its context vs the ones where it didn't.`;

const CHECKLIST = `# Pre-flight: is your route 'meta'-ready?
#
# 1) Every public route has at least one 'happy' example.
#    [ ] request shape matches the schema
#    [ ] response.status is a key in 'responses'
#    [ ] 'pnpm daloy inspect --check' is green
#
# 2) State-changing routes also have at least one unhappy example.
#    [ ] one 400/422 validation example
#    [ ] one 401/403 if auth is required (no body needed)
#    [ ] one 404 for resource-by-id routes
#
# 3) 'routes.json' is wired into a build artifact.
#    [ ] pnpm script: "ai:dump": "daloy inspect --ai > routes.json"
#    [ ] file is consumed by Hey API or an LLM system prompt
#    [ ] CI re-runs the dump and fails on unchecked drift
#
# 4) Examples are kept honest by the contract gate.
#    [ ] CI runs 'pnpm daloy inspect --check' on every PR
#    [ ] no skip flag exists in the project
#
# 5) Extensions are intentional, not noisy.
#    [ ] every x-* key is documented in the README
#    [ ] no x-* key duplicates an OpenAPI standard field`;

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

function TierCard({
  tier,
  size,
  children,
}: {
  tier: string;
  size: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {tier}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">
          Surfaces:{" "}
          <span className="font-normal text-muted-foreground">{size}</span>
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Release</Badge>
            <Badge variant="outline">OpenAPI 3.1</Badge>
            <Badge variant="outline">Codegen Agents</Badge>
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
            Devlin here. <code>@daloyjs/core@0.14.1</code> shipped to npm today
            and it adds one optional field to <code>app.route()</code> called{" "}
            <code>meta</code>. That single field carries structured{" "}
            <em>examples</em>, extra <em>description</em> copy, and a{" "}
            <em>free-form extensions</em> bag — all of it validated against your
            Standard Schema at build time and surfaced into the OpenAPI 3.1
            document <em>and</em> a sibling <code>routes.json</code> via{" "}
            <code>daloy inspect --ai</code>. The whole release is additive and
            non-breaking: every existing route keeps working with zero changes.
            This is the &quot;AI-friendly route metadata&quot; milestone from
            the roadmap, and it is the last pre-1.0 milestone before the
            secure-by-default initiative takes over.
          </p>

          <h2>The failure mode this fixes</h2>

          <EditorFrame
            files={["incident.md"]}
            activeFile="incident.md"
            status="every codegen agent that ever read an OpenAPI doc · 0/10 stars"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <p>
            None of this is the agent&apos;s fault either. It read the schema.
            It picked the most plausible field names from the
            <code>operationId</code>. It invented a <code>createdAt</code>
            because that&apos;s what most APIs return. The schema was right but
            not <em>specific enough</em> to anchor the model to the real field
            names. One concrete example would have changed every decision
            downstream.
          </p>

          <h2>What landed in 0.14.1</h2>

          <EditorFrame
            files={["src/build-app.ts"]}
            activeFile="src/build-app.ts"
            status="one new optional field on route() · everything else unchanged"
          >
            <CodeBlock language="ts" code={META_FIELD} />
          </EditorFrame>

          <TierCard
            tier="meta.examples"
            size="OpenAPI requestBody/response examples · routes.json · validated in CI"
          >
            Named record of{" "}
            <code>
              {`{ summary?, description?, request?: { params?, query?, headers?, body? }, response?: { status, body?, headers? } }`}
            </code>{" "}
            pairs. Every field is optional individually; pass only the parts you
            want documented. Both sides — request and response — are
            schema-checked at build time.
          </TierCard>
          <TierCard
            tier="meta.description / meta.tags"
            size="OpenAPI operation description + tags"
          >
            Augment the route-level fields of the same name. Route-level values
            win when both are set; tags are de-duplicated and concatenated, so
            you can keep transport tags on the route and audience tags (
            <code>AI</code>, <code>Public</code>, <code>Internal</code>) on the
            meta block.
          </TierCard>
          <TierCard
            tier="meta.extensions"
            size="OpenAPI Operation Object x-* keys"
          >
            Free-form bag emitted onto the OpenAPI operation. Keys without an{" "}
            <code>x-</code> prefix are prefixed automatically for spec
            compliance, so <code>codegen-hint</code> becomes{" "}
            <code>x-codegen-hint</code>. Daloy does not interpret these — it
            preserves them so your downstream tooling can.
          </TierCard>

          <h2>Build-time validation, not vibes-based docs</h2>

          <EditorFrame
            files={["ci.log"]}
            activeFile="ci.log"
            status="schema and examples kept honest by the same gate"
          >
            <CodeBlock language="bash" code={BUILD_TIME_VALIDATION} />
          </EditorFrame>

          <p>
            This is the single most important property of the feature. There is
            no &quot;examples drift&quot; surface to monitor, because a stale
            example fails the contract run before the OpenAPI doc is even
            published. The docs and the schema can never be out of sync with
            each other, because they are both gated by the same{" "}
            <code>pnpm daloy inspect --check</code> command — the one the
            scaffolded{" "}
            <Link href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health">
              CLI inspector
            </Link>{" "}
            already runs in CI.
          </p>

          <h2>What lands in OpenAPI 3.1</h2>

          <EditorFrame
            files={["generated/openapi.json"]}
            activeFile="generated/openapi.json"
            status="Swagger UI, Scalar, and Hey API all read these without extra wiring"
          >
            <CodeBlock language="json" code={OPENAPI_OUT} />
          </EditorFrame>

          <p>
            The named examples land on every relevant slot of the OpenAPI 3.1
            spec — <code>requestBody.content.*.examples</code>,{" "}
            <code>responses.*.content.*.examples</code>, and the operation-level{" "}
            <code>x-daloy-examples</code> vendor extension for tools that want
            the full structured shape including the response status code. That
            last one is why the docstrings on the{" "}
            <Link href="/docs/typed-client">Hey API typed client</Link> start
            showing your real example values on the next <code>pnpm gen</code>{" "}
            run.
          </p>

          <h2>
            <code>daloy inspect --ai</code> dumps the whole catalog
          </h2>

          <EditorFrame
            files={["terminal"]}
            activeFile="terminal"
            status="flat JSON · no Daloy runtime coupling · feeds any codegen"
          >
            <CodeBlock language="bash" code={INSPECT_AI_CMD} />
          </EditorFrame>

          <EditorFrame
            files={["routes.json"]}
            activeFile="routes.json"
            status="every route, every input schema, every output schema, every example"
          >
            <CodeBlock language="json" code={ROUTES_JSON} />
          </EditorFrame>

          <p>
            The dump is intentionally a flat JSON file with no DaloyJS runtime
            coupling. Feed it to{" "}
            <Link href="/docs/typed-client">Hey API codegen</Link> as a sibling
            artifact so the generated SDK&apos;s docstrings carry your examples.
            Drop it into an LLM system prompt for &quot;write me a fetch call
            that hits the books endpoint&quot;. Or pipe it into your own Python
            / Go / Postman generator — every field is plain JSON.
          </p>

          <h2>
            Why &quot;schema + examples&quot; beats &quot;schema alone&quot;
          </h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="schema → type checker · example → pattern matcher · different jobs"
          >
            <CodeBlock language="bash" code={WHY_EXAMPLES} />
          </EditorFrame>

          <h2>The scope, on purpose</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="docs + codegen aid · NOT a runtime mock · NOT a schema override"
          >
            <CodeBlock language="bash" code={SCOPE_NOTES} />
          </EditorFrame>

          <h2>Adopting it on an existing route</h2>

          <EditorFrame
            files={["src/build-app.ts (diff)"]}
            activeFile="src/build-app.ts (diff)"
            status="6 added lines · happy + unhappy example · contract gate stays green"
          >
            <CodeBlock language="diff" code={CARRYING_OVER} />
          </EditorFrame>

          <h2>Concretely, what changes for the agent</h2>

          <EditorFrame
            files={["before-vs-after.md"]}
            activeFile="before-vs-after.md"
            status="not theoretical · the diff I see in PRs where routes.json is in context"
          >
            <CodeBlock language="bash" code={WHY_THIS_HELPS} />
          </EditorFrame>

          <h2>The pre-flight checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="five sections · paste into the README under 'Working with AI agents'"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            The whole point of contract-first is that <em>one</em> route
            definition becomes your validation, your types, your OpenAPI doc,
            your typed client, and your contract tests. With <code>meta</code>,
            that same single route definition also becomes the structured
            context a codegen agent needs to write the call site correctly on
            the first try — and the validator that refuses to let any of those
            artifacts drift apart in CI. No new files, no new build step, no new
            vendor lock-in. Just one optional field on the call you were already
            writing.
          </p>

          <p>
            <code>@daloyjs/core@0.14.1</code> and{" "}
            <code>create-daloy@0.8.1</code> are on npm now. New projects pick up
            the field automatically; existing projects can adopt it one route at
            a time without changing anything else.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/docs/ai-metadata">
              AI-friendly route metadata docs
            </Link>{" "}
            page for the full surface reference, the{" "}
            <Link href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health">
              CLI inspector post
            </Link>{" "}
            for the contract gate that keeps the examples honest, the{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              contract-first post
            </Link>{" "}
            for how the typed client picks the examples up, and the{" "}
            <Link href="/blog/designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills">
              AGENTS.md + skills post
            </Link>{" "}
            for the prose-side context that pairs with this machine-readable
            one.
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
                href="/docs/ai-metadata"
                className="underline underline-offset-4"
              >
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health"
                className="underline underline-offset-4"
              >
                CLI inspector post
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
