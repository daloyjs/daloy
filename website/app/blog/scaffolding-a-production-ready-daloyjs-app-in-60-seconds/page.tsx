import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "scaffolding-a-production-ready-daloyjs-app-in-60-seconds",
  title:
    "Scaffolding a Production-Ready DaloyJS App in 60 Seconds with create-daloy",
  description:
    "A tour of pnpm create daloy@latest, the interactive template + package-manager pickers, --minimal, --with-ci, the five runtime templates (Node, Bun, Deno, Workers, Vercel), the AGENTS.md + .agents/skills/daloyjs-best-practices/SKILL.md drop-in for coding agents, and the printStartupBanner() polish that ships with every scaffold.",
  date: "2026-05-27",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, currently writing TypeScript from a desk in Norway. Strongly believes that the first 60 seconds of a project decide whether it ever ships.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "create-daloy",
    "pnpm create daloy",
    "DaloyJS scaffolder",
    "node-basic template",
    "bun-basic template",
    "deno-basic template",
    "cloudflare-worker template",
    "vercel template",
    "AGENTS.md coding agents",
    "printStartupBanner",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ONE_LINER = `# The 60-second path.
pnpm create daloy@latest my-api
cd my-api
pnpm dev
# → server up at http://localhost:3000
# → /docs serving Swagger UI
# → /openapi.json serving the contract
# → secure headers, CSRF, session, rate-limit middleware preloaded`;

const FULL_FLAGS = `# Every flag, when you want them.

pnpm create daloy@latest [project-name] [options]

  --template <name>          node-basic | vercel | cloudflare-worker | bun-basic | deno-basic
                             (default: node-basic)
  --package-manager <pm>     pnpm | npm | yarn | bun       (default: pnpm)
  --list-templates           Print available templates and exit.
  --install / --no-install   Install deps after scaffolding.
                             (default: Y, except pnpm - N to respect
                             minimumReleaseAge + onlyBuiltDependencies)
  --git / --no-git           Initialize a git repository.
  --minimal                  Strip the bookstore + OpenAPI docs demo routes.
  --with-ci / --no-ci        Add hardened GitHub Actions + governance files.
                             (default: Y)
  --code-owner <owner>       CODEOWNERS owner for --with-ci, e.g. @acme/security.
  --force                    Overwrite an existing non-empty directory.
  --yes, -y                  Accept all defaults; never prompt.
  --help, -h                 Print this help.`;

const INTERACTIVE_FLOW = `$ pnpm create daloy@latest

  ✦  create-daloy - scaffold a DaloyJS project

  ?  Project name › my-api
  ?  Template
     ▸ node-basic         Traditional REST API with secure defaults and Hey API codegen
       vercel        Catch-all Vercel route with Node.js migration notes
       cloudflare-worker  Worker entrypoint with wrangler dev/deploy scripts
       bun-basic          Bun-native server with \`bun --hot\`, \`bun test\`, and Hey API codegen
       deno-basic         Deno-native server with \`deno task dev\`, \`deno test\`, and \`npm:\` imports
  ?  Package manager
     ▸ pnpm     Recommended default with the hardened pnpm workspace settings
       npm      Use the stock npm CLI with rewritten scripts and docs
       yarn     Yarn workflow with rewritten scripts and lockfile-friendly installs
       bun      Bun package manager for fast installs; runtime templates stay Bun-native
  ?  Initialize a git repository?               (Y/n)  Y
  ?  Add hardened GitHub Actions and security?  (Y/n)  Y
  ?  Install dependencies now?                  (Y/n)  N   # pnpm respects minimumReleaseAge

  ✓  Wrote 38 files
  ✓  Initialized git repo
  ✓  Wrote .github/ workflows, CODEOWNERS, SECURITY.md

  Next steps:
    cd my-api
    pnpm install                # honors the 24h release-age cooldown
    pnpm dev                    # starts the dev server on :3000
    open http://localhost:3000/docs`;

const MINIMAL_VS_DEMO = `# What you get out of the box

  WITHOUT --minimal (the default)        |   WITH --minimal
  -------------------------------------- + --------------------------------------
  src/app.ts                              |   src/app.ts
    + buildApp()                          |     + buildApp()
    + secureHeaders, csrf, session,       |     + secureHeaders, csrf, session,
      rateLimit, cors, requestId,         |       rateLimit, cors, requestId,
      tracing, logger                     |       tracing, logger
                                          |
  src/routes/                             |   src/routes/
    + books.ts        (CRUD bookstore)    |     + health.ts   (GET /healthz)
    + authors.ts      (relationships)     |
    + reviews.ts      (rating validation) |
    + health.ts       (GET /healthz)      |
                                          |
  src/schemas/                            |   src/schemas/
    + book.ts, author.ts, review.ts       |     (empty - add your own)
                                          |
  tests/                                  |   tests/
    + books.test.ts, authors.test.ts      |     + health.test.ts
                                          |
  openapi.json on /openapi.json           |   openapi.json on /openapi.json
  Swagger UI on /docs                     |   Swagger UI on /docs

The bookstore demo exists to show every contract-first pattern at once
(validation, relationships, errors, pagination, testing). When you've read
it twice, --minimal strips it so you can start your own app cleanly.`;

const RUNTIME_TEMPLATES = `# Same app shape, five entry files.

node-basic/src/index.ts          → \`serve()\` from @daloyjs/core/node
bun-basic/src/index.ts           → Bun.serve(handle.url) with \`bun --hot\`
deno-basic/main.ts               → Deno.serve(handle.url) with deno.json tasks
cloudflare-worker/src/index.ts   → export default { fetch: handle.fetch }
vercel/api/[...path].ts     → export const config = { runtime: "edge" }

The buildApp() in src/app.ts is byte-identical across all five templates.
That is on purpose - and it's the same property the "Same App on Five
Runtimes" post explored. Pick the one that matches where you deploy today;
you can copy the buildApp() to a different template tomorrow without
touching a single route or schema file.`;

const AGENTS_DROPIN = `# my-api/ (relevant excerpts)

AGENTS.md                              # short, opinionated, agent-facing
.agents/
  skills/
    daloyjs-best-practices/
      SKILL.md                         # the full workflow (~600 lines)
src/
  app.ts                               # buildApp() with secure defaults
  routes/
    health.ts                          # GET /healthz
.github/
  copilot-instructions.md              # points at AGENTS.md
  workflows/
    ci.yml          codeql.yml         deploy.yml
    zizmor.yml      scorecard.yml      vuln-scan.yml
    container-scan.yml                 dast.yml
  dependabot.yml
  CODEOWNERS
SECURITY.md
.npmrc                                 # ignore-scripts, minimum-release-age, ...
pnpm-workspace.yaml                    # blockExoticSubdeps, strictDepBuilds, ...
package.json`;

const AGENTS_MD_EXCERPT = `# AGENTS.md (excerpt)

A [DaloyJS](https://daloyjs.dev) Node.js REST API. **Contract-first**:
every route declares its method, path, body, params, and response schemas
inline; OpenAPI, validation, types, and a typed fetch SDK fall out of that
single declaration. Do not introduce parallel schema sources.

## Quick rules

1. Routes live in src/routes/<resource>.ts and register themselves on the
   shared \`app\`.
2. Schemas are JSON Schema objects, NOT zod (zod stays on the frontend if
   you want it).
3. Every mutating route requires a session OR an explicit \`csrf({ ... })\`
   bypass with a reason.
4. Throw typed errors (NotFoundError, BadRequestError, ...) from
   @daloyjs/core - never return raw error responses.

For the full workflow - adding routes step-by-step, schema conventions,
testing patterns, security guidance, and deployment notes - read
.agents/skills/daloyjs-best-practices/SKILL.md.`;

const STARTUP_BANNER = `// src/index.ts, what pnpm dev actually prints
import { serve } from "@daloyjs/core/node";
import { printStartupBanner } from "@daloyjs/core";
import { buildApp } from "./app.js";

const app = buildApp();
const { url } = await serve(app, { port: Number(process.env.PORT ?? 3000) });

printStartupBanner({
  name: "my-api",
  version: process.env.npm_package_version,
  url,
  runtime: \`Node.js \${process.version}\`,
  links: [
    { label: "Docs",   url: \`\${url}/docs\` },
    { label: "OpenAPI", url: \`\${url}/openapi.json\` },
    { label: "Health", url: \`\${url}/healthz\` },
  ],
});`;

const BANNER_OUTPUT = `╭───────────────────────────────────────────────────────────╮
│  ✦  my-api  - v0.1.0  · Node.js v24.10.0                   │
│                                                            │
│  ➜  Local    http://localhost:3000                         │
│  ➜  Docs     http://localhost:3000/docs                    │
│  ➜  OpenAPI  http://localhost:3000/openapi.json            │
│  ➜  Health   http://localhost:3000/healthz                 │
╰───────────────────────────────────────────────────────────╯

# Adapts to your terminal automatically:
#   NO_COLOR=1 strips ANSI
#   DALOY_ASCII=1 (or non-UTF8 LANG) falls back to ASCII glyphs
#   Non-TTY (CI, piping to a file) drops the colors`;

const WITH_CI_FILES = `# pnpm create daloy@latest my-api --with-ci
# adds, on top of the application files:

.github/
  workflows/
    ci.yml            # pnpm install --frozen-lockfile --ignore-scripts; typecheck; test; verify lockfile
    codeql.yml        # TS/JS static analysis
    deploy.yml        # manual-only app deployment starter
    scorecard.yml     # weekly OpenSSF Scorecard
    zizmor.yml        # workflow lint on every push/PR
    vuln-scan.yml     # checks for known vulnerabilities
    container-scan.yml # runs Trivy scans on your dockerfile
  dependabot.yml      # weekly bumps, grouped per ecosystem
  CODEOWNERS          # assigns ownership to the repo owner 
SECURITY.md           # disclosure policy + supported versions
scripts/
  verify-lockfile-sources.mjs # catches non-npm registry / git / tarball drift`;

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

/**
 * TemplateCard - concise card for each runtime template.
 */
function TemplateCard({
  name,
  tag,
  blurb,
  entrypoint,
}: {
  name: string;
  tag: string;
  blurb: string;
  entrypoint: string;
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-semibold tracking-tight">{name}</h4>
        <Badge variant="outline" className="font-mono">
          {tag}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-3 inline-flex rounded-md border bg-background px-2.5 py-1 font-mono text-xs">
        {entrypoint}
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
            <Badge variant="outline">Getting started</Badge>
            <Badge variant="outline">Scaffolder</Badge>
            <Badge variant="outline">DX</Badge>
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
            Hi, Devlin. Ten years of fullstack, currently in Norway. I have
            spent a frankly embarrassing amount of my career on the first sixty
            seconds of a project, the part where you go from{" "}
            <em>I have an idea</em> to{" "}
            <em>
              I have a running server with tests, types, OpenAPI, and a CI
              pipeline</em>
            {". "}When that first sixty seconds is awkward, the project never
            happens. When it feels good, you keep going.
          </p>

          <p>
            <code>create-daloy</code> is the scaffolder we shipped to make those
            sixty seconds feel good for DaloyJS. This post is the grand tour:
            every template, every flag, the AGENTS.md drop-in for coding agents,
            and the cosmetic-but-important
            <code>printStartupBanner()</code> that tells you the dev server is
            alive. Then, at the end, I&apos;ll hand you off to the
            contract-first post for the next sixty seconds, wiring up the typed
            client.
          </p>

          <h2>The 60-second path</h2>

          <EditorFrame
            files={["~/code · zsh"]}
            activeFile="~/code · zsh"
            status="default template · default package manager · sensible defaults"
          >
            <CodeBlock language="bash" code={ONE_LINER} />
          </EditorFrame>

          <p>
            That&apos;s the entire story for most people. One command. You get
            an HTTP server, an OpenAPI document, Swagger UI, hardened security
            middleware preloaded (CSRF, sessions, secure headers, rate limit), a
            sensible folder structure, and a CI pipeline that&apos;s pinned and
            sandboxed. The scaffolder is opinionated <em>for</em> you so you can
            start making the opinionated decisions about your <em>own</em> app.
          </p>

          <h2>The interactive flow, when you don&apos;t pass arguments</h2>

          <p>
            If you skip the project name, <code>create-daloy</code> walks you
            through a tiny terminal wizard, template picker, package manager
            picker, git/CI yes-or-no. Arrow keys, enter, done. It&apos;s the
            part I personally use most because I always forget which template ID
            maps to Workers vs Vercel.
          </p>

          <EditorFrame
            files={["~/code · zsh · interactive"]}
            activeFile="~/code · zsh · interactive"
            status="arrow keys to pick · ✓ to confirm · ↩ for default"
          >
            <CodeBlock language="bash" code={INTERACTIVE_FLOW} />
          </EditorFrame>

          <p>
            One detail worth pointing out: when the package manager is{" "}
            <code>pnpm</code>
            {", "}<code>--install</code> defaults to <em>N</em>
            {". "}
            That&apos;s on purpose. The scaffolded project ships a{" "}
            <code>.npmrc</code> with <code>minimum-release-age=1440</code> and a{" "}
            <code>pnpm-workspace.yaml</code> with{" "}
            <code>blockExoticSubdeps: true</code> and{" "}
            <code>strictDepBuilds: true</code>
            {". "}The first install needs to <em>honor those</em>
            {", "}not race past them. So we let you <code>cd</code> in, look at
            the files, and run <code>pnpm install</code> deliberately. Five
            seconds slower; way fewer surprises.
          </p>

          <h2>The full flag surface</h2>

          <EditorFrame
            files={["pnpm create daloy@latest --help"]}
            activeFile="pnpm create daloy@latest --help"
            status="--help · all flags · sensible defaults already chosen"
          >
            <CodeBlock language="bash" code={FULL_FLAGS} />
          </EditorFrame>

          <h2>--minimal vs the bookstore demo</h2>

          <p>
            By default the scaffold drops in a small <em>bookstore</em> API,
            books, authors, reviews, that exercises every contract-first pattern
            we want you to copy: nested resources, JSON Schema validation,
            pagination, typed errors, integration tests. Read it twice, then
            either delete the routes by hand or pass <code>--minimal</code> and
            start from a single <code>/healthz</code> route.
          </p>

          <EditorFrame
            files={["FILES.md"]}
            activeFile="FILES.md"
            status="bookstore demo on the left · --minimal on the right"
          >
            <CodeBlock language="bash" code={MINIMAL_VS_DEMO} />
          </EditorFrame>

          <h2>The five runtime templates</h2>

          <p>
            DaloyJS is runtime-portable, and the scaffolder is where that
            promise becomes a directory you can <code>cd</code> into. The{" "}
            <code>buildApp()</code> in <code>src/app.ts</code> is byte-identical
            across every template, the only thing that changes is the entrypoint
            file that hands a <code>Request</code> to that app:
          </p>

          <EditorFrame
            files={["TEMPLATES.md"]}
            activeFile="TEMPLATES.md"
            status="same buildApp() · five different entrypoints"
          >
            <CodeBlock language="bash" code={RUNTIME_TEMPLATES} />
          </EditorFrame>

          <TemplateCard
            name="node-basic"
            tag="--template node-basic"
            blurb="Default. Long-lived Node process, classic REST API shape, Hey API codegen wired in. Pick this when you're deploying to a normal container, a VM, or a Node-on-rails platform."
            entrypoint="serve(app), from @daloyjs/core/node"
          />
          <TemplateCard
            name="bun-basic"
            tag="--template bun-basic"
            blurb="Bun-native. Uses bun --hot for dev, bun test for testing, and the same buildApp() handed to Bun.serve(). Fast cold start, identical handler code."
            entrypoint="Bun.serve({ fetch: handle.url })"
          />
          <TemplateCard
            name="deno-basic"
            tag="--template deno-basic"
            blurb="Deno-native. deno.json with tasks, npm: imports for @daloyjs/core, no node_modules. The only template with no package.json, which is exactly the point."
            entrypoint="Deno.serve(handle.url)"
          />
          <TemplateCard
            name="cloudflare-worker"
            tag="--template cloudflare-worker"
            blurb="Workers entrypoint with wrangler dev / wrangler deploy scripts and an env-typed config. Pairs with the KV session store from the sessions post."
            entrypoint="export default { fetch: handle.fetch }"
          />
          <TemplateCard
            name="vercel"
            tag="--template vercel"
            blurb="Catch-all api/[...path].ts that delegates to a single buildApp(). Comes with a short migration note covering Vercel's three handler shapes."
            entrypoint='export const config = { runtime: "edge" }'
          />

          <h2>The AGENTS.md drop-in (for the agent in the room)</h2>

          <p>
            One of the things I personally enjoy about the 2026 ecosystem is
            that <em>every</em> project also has, in practice, a coding agent
            looking at it, Copilot, Cursor, Claude Code, the JetBrains
            assistant, whatever you like. The scaffolder ships them their own
            briefing document so they don&apos;t have to guess at your
            conventions:
          </p>

          <EditorFrame
            files={["my-api/ · file tree"]}
            activeFile="my-api/ · file tree"
            status="AGENTS.md is for the agent · README.md is for the human"
          >
            <CodeBlock language="bash" code={AGENTS_DROPIN} />
          </EditorFrame>

          <p>
            <code>AGENTS.md</code> is short and opinionated, it&apos;s the
            two-page summary every agent should read first. The real meat is in{" "}
            <code>.agents/skills/daloyjs-best-practices/SKILL.md</code>
            {", "}which is the full ~600-line workflow doc: how to add a route,
            schema conventions, the testing recipe, security defaults,
            deployment notes per runtime. An agent that follows it produces code
            that looks like the rest of the codebase, which is the only kind of
            agent output that ages well.
          </p>

          <EditorFrame
            files={["my-api/AGENTS.md"]}
            activeFile="my-api/AGENTS.md"
            status="short · opinionated · agent-facing"
          >
            <CodeBlock language="bash" code={AGENTS_MD_EXCERPT} />
          </EditorFrame>

          <h2>printStartupBanner(): small but important</h2>

          <p>
            The boring truth about devtools is that the moment you trust them is
            the moment they tell you something useful within a second of
            starting. <code>printStartupBanner()</code> is a zero-dependency
            helper in <code>@daloyjs/core</code> that replaces the inevitable{" "}
            <code>console.log(&quot;listening on...&quot;)</code> with something
            every scaffolded template uses:
          </p>

          <EditorFrame
            files={["src/index.ts"]}
            activeFile="src/index.ts"
            status="auto-detects color · ASCII fallback · works in CI"
          >
            <CodeBlock language="ts" code={STARTUP_BANNER} />
          </EditorFrame>

          <EditorFrame
            files={["~/code/my-api · pnpm dev"]}
            activeFile="~/code/my-api · pnpm dev"
            status="that's the thing you'll see at 9:03am every weekday"
          >
            <CodeBlock language="bash" code={BANNER_OUTPUT} />
          </EditorFrame>

          <p>
            Auto-detects TTY + <code>NO_COLOR</code> + <code>FORCE_COLOR</code>
            {", "}
            falls back to ASCII glyphs in non-UTF-8 terminals, looks like a log
            line in CI. You can&apos;t see this kind of polish in a screenshot,
            but you feel it every morning.
          </p>

          <h2>--with-ci: the production-day-zero bundle</h2>

          <p>
            Every flag in <code>create-daloy</code> has a default I&apos;d argue
            for in a code review.{" "}
            <strong>
              <code>--with-ci</code> defaults to yes.
            </strong>{" "}
            That&apos;s the application-safe supply-chain-hardening posture from
            yesterday&apos;s post (<Link href="/blog/supply-chain-hardening-for-typescript-libraries">Supply-Chain Hardening for TypeScript Libraries</Link>) dropped into your repo without you typing a single workflow line.
            The library publish workflow stays out because this scaffold is an
            app, not an npm package release train:
          </p>

          <EditorFrame
            files={[".github/ · scaffolded contents"]}
            activeFile=".github/ · scaffolded contents"
            status="--with-ci · the app-safe posture in one flag"
          >
            <CodeBlock language="bash" code={WITH_CI_FILES} />
          </EditorFrame>

          <p>
            Pass <code>--code-owner @your-team/security</code> and CODEOWNERS
            gets that team on every workflow file, small detail, big payoff the
            first time someone tries to PR a change to <code>ci.yml</code> or{" "}
            <code>deploy.yml</code>.
          </p>

          <h2>Where to go next</h2>

          <p>
            You now have a running server, a contract, security middleware, and
            a CI pipeline. The next sixty seconds is the typed-client handoff,
            running <code>pnpm gen</code>
            {", "}importing the SDK in your frontend, getting compile-time
            errors when your route changes shape. That&apos;s the entire subject
            of{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              Contract-First Without the Codegen Dance</Link>
            {". "}Read it next.
          </p>

          <p>
            If you&apos;d rather see how the same <code>buildApp()</code>{" "}
            deploys to all five runtimes, and what the differences feel like in
            practice, the{" "}
            <Link href="/blog/same-app-five-runtimes-verified">
              Same App on Five Runtimes
            </Link>{" "}
            post is the other natural follow-up. The{" "}
            <Link href="/docs/scaffolder">scaffolder docs</Link> have the full
            template reference and the full flag list, in case you want to grep
            for something specific.
          </p>

          <p>
            Thanks for reading. The most flattering thing you can do is run{" "}
            <code>pnpm create daloy@latest</code> right now and tell me what
            felt awkward. Friction logs are the only kind of feedback I actually
            act on.
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
                href="/docs/scaffolder"
                className="underline underline-offset-4"
              >
                Read the scaffolder docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/contract-first-without-the-codegen-dance"
                className="underline underline-offset-4"
              >
                Next: wire up the typed client
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
