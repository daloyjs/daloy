import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloy-cli-inspecting-routes-schemas-openapi-and-contract-health",
  title:
    "The DaloyJS CLI: Inspecting Routes, Schemas, OpenAPI, and Contract Health",
  description:
    "daloy inspect is the CLI you point at your App before a PR merges. It prints the full route table, schema presence, contract issues, and the live OpenAPI 3.1 document, loaded straight from your TypeScript entry through tsx with zero build step. This is the API-surface review tool platform teams keep wishing they had.",
  date: "2026-06-05",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently in Norway. Has reviewed more pull requests where 'just adds a small endpoint' meant 'removes operationId, drops the 422 response, accidentally publishes a debug route' than he cares to count. Now everything goes through the CLI first.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "daloy inspect CLI",
    "DaloyJS route table",
    "OpenAPI contract check",
    "API review PR",
    "tsx TypeScript CLI",
    "openapi 3.1 diff CI",
    "introspect routes",
    "platform team API surface",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# A PR review you have lived through, probably more than once:
#
# - "Just a tiny endpoint, swear."
# - "Tests pass."
# - "CI is green."
#
# What the PR actually does:
#   - Adds GET /v1/orders/admin/dump   (no operationId, no auth)
#   - Removes the 422 response from POST /v1/orders
#   - Renames an operationId from "createOrder" to "create-order"
#     (every codegen consumer's import path breaks tomorrow)
#   - Marks GET /v1/orders/:id deprecated... in the PR description.
#     Not in the code.
#
# Your review took 4 minutes because the diff was 12 lines. The
# downstream pain takes 4 weeks because nobody saw the surface change.
#
# The fix is not "review harder". The fix is to put the API surface in
# front of the reviewer, in plain text, in CI, on every PR.`;

const INSPECT_BASIC = `# Run it from any DaloyJS project. Loads ./src/app.ts (or ./src/build-app.ts,
# or ./app.ts) through tsx automatically - no build step, no transpile config.
$ pnpm daloy inspect

METHOD  PATH              OPERATION ID    RESPONSES   TAGS
------  ----------------  --------------  ----------  -------
GET     /v1/books         listBooks       200,500     books
POST    /v1/books         createBook      201,422     books
GET     /v1/books/:id     getBook         200,404     books
PUT     /v1/books/:id     replaceBook     200,404,422 books
DELETE  /v1/books/:id     deleteBook      204,404     books
GET     /v1/orders        listOrders      200,500     orders

6 routes.`;

const ENTRY_LOADING = `// What the CLI looks for, in order:
//
//   ./src/app.ts        ← most common
//   ./src/app.js
//   ./src/build-app.ts  ← if you split "build" from "boot" (recommended)
//   ./src/build-app.js
//   ./app.ts
//   ./app.js
//   ./build-app.ts
//   ./build-app.js
//
// And from those modules, it picks up:
//
//   export default app
//   export const app = new App(...)
//   export function buildApp()   { return new App(...) }   // zero-arg
//   export function createApp()  { return new App(...) }   // zero-arg
//   export default buildApp
//
// TypeScript files are loaded through tsx with zero config. So your
// src/app.ts that imports zod, your route schemas, your generated
// types - all of it just works, even though no "build" ever ran.

// Need a different entry? Pass it positionally:
//
//   pnpm daloy inspect ./apps/api/src/app.ts
//
// Need a different entry shape? Refactor a tiny exporter:

// src/build-app.ts - recommended pattern for libraries with tests + CLI
import { App } from "@daloyjs/core";
import { registerRoutes } from "./routes.js";

export function buildApp(): App {
  const app = new App();
  registerRoutes(app);
  return app;
}`;

const SCHEMAS_FLAG = `# --schemas adds a B/Q/P/H column: Body / Query / Params / Headers.
# Each letter is present (B) or absent (-) per route. Great for
# spotting "I added a query param to the docs but forgot the schema"
# and "this DELETE inexplicably declares a request body".
$ pnpm daloy inspect --schemas

METHOD  PATH              OPERATION ID    B/Q/P/H  RESPONSES   TAGS
------  ----------------  --------------  -------  ----------  -------
GET     /v1/books         listBooks       -Q--     200,500     books
POST    /v1/books         createBook      B---     201,422     books
GET     /v1/books/:id     getBook         --P-     200,404     books
PUT     /v1/books/:id     replaceBook     B-P-     200,404,422 books
DELETE  /v1/books/:id     deleteBook      --P-     204,404     books
GET     /v1/orders        listOrders      -Q--     200,500     orders

6 routes.`;

const FILTERS = `# Filters compose. Use --tag to drill into a domain, --method to focus
# on writes during a "did we break the consumer's POST contract?" review.
$ pnpm daloy inspect --tag books
$ pnpm daloy inspect --method POST
$ pnpm daloy inspect --tag orders --method DELETE --schemas

# Tip: pipe it through a pager or your favorite "diff against main" tool:
#   git stash && pnpm daloy inspect > /tmp/main.txt && git stash pop
#   pnpm daloy inspect > /tmp/branch.txt
#   diff -u /tmp/main.txt /tmp/branch.txt
#
# Now your PR description has a literal before/after of the API surface.
# I include this snippet in every API PR I open. It takes 10 seconds.`;

const CHECK_FLAG = `# --check runs the built-in contract test suite over the loaded App.
# It enforces conventions the OpenAPI spec encourages but doesn't require,
# which is exactly the place ad-hoc PRs cause downstream churn.
$ pnpm daloy inspect --check

METHOD  PATH                       OPERATION ID    RESPONSES   TAGS
------  -------------------------  --------------  ----------  -------
GET     /v1/orders/admin/dump      -               -           -
POST    /v1/orders                 createOrder     201         orders
GET     /v1/orders/:id             getOrder        200,404     orders
PUT     /v1/orders/:id             create-order    200,404,422 orders

4 routes.

Contract checks: 4 routes · 2 errors · 1 warning
  [error]   GET /v1/orders/admin/dump: Missing operationId
  [error]   GET /v1/orders/admin/dump: No responses declared
  [warning] POST /v1/orders: missing 422 response despite request body schema
  [error]   PUT /v1/orders/:id: operationId "create-order" is not a valid identifier
FAIL.

# Exit code: 1.  Wire this into CI and the bad PR can't merge.`;

const OPENAPI_FLAG = `# --openapi prints the full OpenAPI 3.1 document the App would generate.
# Same generator the website's "Try it" page uses, same generator your
# Hey API client codegen runs against. ONE source of truth.
$ pnpm daloy inspect --openapi > generated/openapi.json

# In CI, fail the build if the surface changed without a checked-in diff:
$ pnpm daloy inspect --openapi > generated/openapi.json
$ git diff --exit-code generated/openapi.json

# The reviewer now sees the JSON delta in the PR. New operationId? New
# 422 schema? New webhook? It's all in the diff. No "I forgot to mention".`;

const JSON_FLAG = `# --json gives you machine-readable output for custom tooling. The shape
# is { routes: IntrospectedRoute[], contract?: ContractReport }.
$ pnpm daloy inspect --json --check | jq '
  .contract.issues
  | group_by(.level)
  | map({ level: .[0].level, count: length, items: . })
'

[
  {
    "level": "error",
    "count": 2,
    "items": [
      { "level": "error", "route": "GET /v1/orders/admin/dump",
        "message": "Missing operationId" },
      { "level": "error", "route": "GET /v1/orders/admin/dump",
        "message": "No responses declared" }
    ]
  },
  {
    "level": "warning",
    "count": 1,
    "items": [
      { "level": "warning", "route": "POST /v1/orders",
        "message": "missing 422 response despite request body schema" }
    ]
  }
]

# Same JSON works as the input to a GitHub Action that posts a sticky
# review comment with the contract report on every PR. Boring, effective.`;

const CI_WORKFLOW = `# .github/workflows/api-review.yml, review the API surface on every PR.
name: api-review
on:
  pull_request:
    paths:
      - "src/**"
      - "package.json"
      - "pnpm-lock.yaml"

permissions:
  contents: read
  pull-requests: write

jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile

      # 1) Hard gate: contract issues fail the build.
      - run: pnpm daloy inspect --check

      # 2) Hard gate: regenerated OpenAPI must match the checked-in copy.
      #    This catches "I added a route but forgot to commit generated/".
      - run: pnpm daloy inspect --openapi > generated/openapi.json
      - run: git diff --exit-code generated/openapi.json

      # 3) Soft helper: post a route-table diff as a sticky PR comment.
      - name: route diff
        run: |
          git fetch origin "\${{ github.base_ref }}"
          git checkout "origin/\${{ github.base_ref }}" -- /tmp/base || true
          pnpm daloy inspect --schemas > /tmp/branch.txt
          git stash --keep-index >/dev/null 2>&1 || true
          git checkout "origin/\${{ github.base_ref }}" -- .
          pnpm daloy inspect --schemas > /tmp/base.txt || true
          git stash pop >/dev/null 2>&1 || true
          { echo '## Route surface diff'; echo '\\\`\\\`\\\`diff';
            diff -u /tmp/base.txt /tmp/branch.txt || true;
            echo '\\\`\\\`\\\`'; } > diff.md
      - uses: marocchino/sticky-pull-request-comment@v2
        with: { path: diff.md, header: api-surface }`;

const DEV_HINT = `# Bonus: daloy dev. Same entry-loading logic, but starts your runnable
# entry (./src/server.ts, ./src/main.ts, ...) under the host runtime's
# native watch mode. No nodemon, no per-runtime config:
#
#   Node:  node --import tsx --watch <entry>
#   Bun:   bun --hot <entry>
#   Deno:  deno run --watch --allow-net --allow-env --allow-read <entry>
#
$ pnpm daloy dev
daloy dev: node → node --import tsx --watch ./src/server.ts

# Force a different runtime from a package.json script:
$ daloy dev --runtime bun ./src/server.ts
$ daloy dev --runtime deno ./src/server.ts

# Same App, every runtime - see the five-runtimes post for the receipts.`;

const CHECKLIST = `# Pre-merge API-review checklist (copy into your PR template).
#
# 1) Routes table reviewed.
#    [ ] pnpm daloy inspect --schemas
#    [ ] Any new routes have an operationId.
#    [ ] Any new routes declare 2xx AND 4xx responses.
#    [ ] B/Q/P/H column matches what the docs claim.
#
# 2) Contract gates passed.
#    [ ] pnpm daloy inspect --check  → exit 0
#    [ ] CI runs the same command on every PR.
#
# 3) OpenAPI diff committed.
#    [ ] pnpm daloy inspect --openapi > generated/openapi.json
#    [ ] git diff --exit-code generated/openapi.json
#    [ ] If diff exists: include it in the PR body so consumers see it.
#
# 4) Filters used during review.
#    [ ] --tag <domain>  → focused review per area owner
#    [ ] --method POST   → focused review on writes
#
# 5) Don't trust your eyes. The CLI surface is the source of truth.
#    Diff against main is one bash one-liner away. Use it.`;

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

function FlagCard({
  flag,
  use,
  children,
}: {
  flag: string;
  use: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {flag}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">{use}</p>
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
            <Badge variant="outline">Tooling</Badge>
            <Badge variant="outline">CLI</Badge>
            <Badge variant="outline">CI</Badge>
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
            Hi, Devlin again. I want to talk about the CLI command that has
            saved me more pull-request meetings than any other tool in this
            framework: <code>daloy inspect</code>
            {". "}The whole premise is small and a little stubborn, the
            reviewer should see the API surface in plain text, before the merge,
            on every PR. Not after. Not next sprint. Now.
          </p>

          <h2>The PR review that taught me to write this post</h2>

          <EditorFrame
            files={["postmortem-but-it's-a-12-line-diff.md"]}
            activeFile="postmortem-but-it's-a-12-line-diff.md"
            status="every line is something I've shipped or merged · 0/10 stars do not recommend"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <h2>The default command, the route table</h2>

          <EditorFrame
            files={["terminal"]}
            activeFile="terminal"
            status="zero config · loads src/app.ts through tsx · prints aligned columns"
          >
            <CodeBlock language="bash" code={INSPECT_BASIC} />
          </EditorFrame>

          <p>
            What the table tells you in one glance: how many routes exist, what
            their operationIds are, which status codes each one declares, and
            what tags they belong to. Three of the four things downstream
            consumers actually care about, visible without scrolling.
          </p>

          <h2>Entry loading, the TypeScript-first way</h2>

          <EditorFrame
            files={["src/build-app.ts"]}
            activeFile="src/build-app.ts"
            status="App default-export · or buildApp()/createApp() factory · TS loaded through tsx"
          >
            <CodeBlock language="ts" code={ENTRY_LOADING} />
          </EditorFrame>

          <p>
            The two patterns I use the most: a default export for tiny apps, and
            a zero-arg <code>buildApp()</code> factory for anything that has
            tests (the factory makes it trivial to spin up a fresh App per
            test). Both work, the CLI scans named exports as a fallback, no
            config required.
          </p>

          <h2>The flags, one at a time</h2>

          <FlagCard flag="--schemas" use="add the B/Q/P/H column.">
            Body / Query / Params / Headers. Each is <code>B</code>/
            <code>Q</code>/<code>P</code>/<code>H</code> if present,{" "}
            <code>-</code> if missing. This is the column I look at when the
            diff says &quot;added a query param&quot;, it tells me whether the
            param has a real schema or just a doc string.
          </FlagCard>
          <FlagCard flag="--tag <tag>" use="filter to one domain.">
            Pair with <code>--schemas</code> when you&apos;re reviewing a domain
            owner&apos;s area. The route owner sees the relevant rows only; the
            rest of the surface stays out of the way.
          </FlagCard>
          <FlagCard flag="--method <method>" use="filter to one verb.">
            Most regressions happen on writes. Running{" "}
            <code>--method POST</code> at the end of a review is a cheap second
            pass that has caught me at least once a quarter.
          </FlagCard>
          <FlagCard
            flag="--check"
            use="run the contract suite, exit 1 on errors."
          >
            Missing operationIds, missing responses, schemas declared without a
            corresponding response status, invalid identifier casing. Wire it
            into CI and a bad PR can&apos;t merge.
          </FlagCard>
          <FlagCard flag="--openapi" use="print the full OpenAPI 3.1 document.">
            The exact same generator the docs UI and your Hey API codegen use.
            Pipe to <code>generated/openapi.json</code>
            {", "}
            <code>git diff --exit-code</code>
            {", "}done, your CI now blocks PRs that change the surface without
            checking in the new spec.
          </FlagCard>
          <FlagCard
            flag="--json"
            use="machine-readable output for custom tooling."
          >
            Shape: <code>{`{ routes, contract? }`}</code>
            {". "}Pipe to <code>jq</code>
            {", "}parse with a tiny script, or feed into a GitHub Action that
            posts a sticky review comment.
          </FlagCard>

          <EditorFrame
            files={["terminal · --schemas"]}
            activeFile="terminal · --schemas"
            status="B/Q/P/H presence column"
          >
            <CodeBlock language="bash" code={SCHEMAS_FLAG} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · filters + diff trick"]}
            activeFile="terminal · filters + diff trick"
            status="--tag · --method · before/after diff in 4 commands"
          >
            <CodeBlock language="bash" code={FILTERS} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · --check"]}
            activeFile="terminal · --check"
            status="contract gate · exit code 1 on errors · the CI hard gate"
          >
            <CodeBlock language="bash" code={CHECK_FLAG} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · --openapi"]}
            activeFile="terminal · --openapi"
            status="full 3.1 doc · feed into git diff --exit-code in CI"
          >
            <CodeBlock language="bash" code={OPENAPI_FLAG} />
          </EditorFrame>

          <EditorFrame
            files={["terminal · --json + jq"]}
            activeFile="terminal · --json + jq"
            status="grouped contract issues · ready to render in a sticky PR comment"
          >
            <CodeBlock language="bash" code={JSON_FLAG} />
          </EditorFrame>

          <h2>The CI workflow I copy into every project</h2>

          <EditorFrame
            files={[".github/workflows/api-review.yml"]}
            activeFile=".github/workflows/api-review.yml"
            status="three steps · two hard gates · one sticky comment with the diff"
          >
            <CodeBlock language="bash" code={CI_WORKFLOW} />
          </EditorFrame>

          <p>
            Two hard gates (<code>--check</code> + OpenAPI diff) and one soft
            helper (sticky PR comment with the route-table diff against{" "}
            <code>main</code>). The hard gates do the policing. The soft helper
            does the persuading.
          </p>

          <h2>Bonus: daloy dev, same entry-loading logic</h2>

          <EditorFrame
            files={["terminal · daloy dev"]}
            activeFile="terminal · daloy dev"
            status="node tsx --watch / bun --hot / deno run --watch · auto-detected · --runtime to override"
          >
            <CodeBlock language="bash" code={DEV_HINT} />
          </EditorFrame>

          <p>
            Same auto-detection logic as the inspector. The CLI looks at{" "}
            <code>globalThis.process.versions</code> and picks the native watch
            flag for whichever runtime the CLI itself is running under. From a
            package.json script you can force a specific runtime with{" "}
            <code>--runtime</code> so npm scripts don&apos;t accidentally pin
            you to Node.
          </p>

          <h2>The pre-merge checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="paste into PULL_REQUEST_TEMPLATE.md and walk away"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            Most of what goes wrong with a public API surface goes wrong
            quietly. An operationId drifts, a response disappears, a debug route
            ships to prod, and nobody hears a thing. The whole reason{" "}
            <code>daloy inspect</code> exists is to turn &quot;quietly&quot;
            into &quot;loudly, in the PR, before the merge button.&quot;
            That&apos;s it. No magic, no sprawling tool, one binary, one entry
            file, six flags. Wire it into CI once and never lose a quarter to
            surface drift again.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/blog/openapi-3-1-extras-webhooks-callbacks-discriminators">
              OpenAPI 3.1 extras post
            </Link>{" "}
            for the spec features <code>--openapi</code> emits, the{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              contract-first post
            </Link>{" "}
            for the route definitions that feed the inspector, and the{" "}
            <Link href="/blog/plugin-lifecycle-events-for-large-team-framework-code">
              plugin lifecycle post
            </Link>{" "}
            for the policy plugin you can pair with <code>--check</code> for
            double enforcement.
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
                href="/blog/plugin-lifecycle-events-for-large-team-framework-code"
                className="underline underline-offset-4"
              >
                Plugin lifecycle post
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
