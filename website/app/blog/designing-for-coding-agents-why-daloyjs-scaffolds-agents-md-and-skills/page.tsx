import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills",
  title:
    "Designing for Coding Agents: Why DaloyJS Scaffolds AGENTS.md and Skills",
  description:
    "Every project created by create-daloy ships with a short AGENTS.md and a focused .agents/skills/daloyjs-best-practices/SKILL.md. Here's why those two files matter, why they're intentionally small, and how they let Copilot, Claude Code, Cursor, Codex, and friends make safer edits in your scaffolded DaloyJS app from the first prompt.",
  date: "2026-06-06",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently in Norway. Has watched a coding agent confidently delete a security middleware because nothing in the repo told it the middleware was load-bearing. Now puts a single sentence about it in AGENTS.md, problem retired.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "AGENTS.md DaloyJS",
    "SKILL.md scaffolding",
    "Copilot Claude Code Cursor",
    "agent context repo",
    "create-daloy",
    "coding agent guardrails",
    "repo-local instructions",
    "contract-first AI",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# The "unguided coding agent" failure mode, lightly edited from real life:
#
# Prompt:  "add a GET /admin/dump that returns the db config"
#
# What the agent did, with zero pushback:
#   - Wrote a route with no operationId
#   - Did not declare a 4xx response
#   - Skipped the Zod schema entirely ("for speed")
#   - Removed app.use(rateLimit(...)) because "you said simple"
#   - Hand-edited generated/openapi.json so types would compile
#   - Pushed to a branch named "wip" and opened a PR titled "small fix"
#
# Every single one of those is a documented project convention. The
# agent didn't violate them because it's stupid. It violated them
# because the repo never told it the conventions existed.
#
# The fix is not "buy a better model". The fix is to put the
# conventions in the repo, in small focused files, where every
# agent already knows to look.`;

const AGENTS_SHAPE = `# Every project created by 'pnpm create daloy' lands with:
#
# my-app/
#   AGENTS.md                                       ← short, hot context
#   .agents/
#     skills/
#       daloyjs-best-practices/
#         SKILL.md                                  ← long, on-demand context
#   src/
#     build-app.ts                                  ← pure factory
#     index.ts                                      ← only file that opens a port
#   scripts/
#     dump-openapi.ts
#   tests/
#   generated/                                      ← machine-written; do not edit
#
# Two files, two purposes:
#
#   AGENTS.md   - always-loaded, ~50 lines. Names the conventions and
#                 points to SKILL.md for the deep dive.
#   SKILL.md    - on-demand, longer. The "how do I add a route, where
#                 do schemas live, which middleware is load-bearing"
#                 manual the agent reads when it actually needs it.
#
# That split is the entire design.`;

const AGENTS_FILE = `# AGENTS.md

A [DaloyJS](https://daloyjs.dev) Node.js REST API. **Contract-first**:
routes are defined with Zod schemas and OpenAPI 3.1 is generated from them.

- Package manager: pnpm
- Runtime: Node.js 24 LTS or Node.js 26+

## Commands

- pnpm dev / pnpm typecheck / pnpm test / pnpm gen / pnpm build

## Project shape

- src/build-app.ts  - buildApp() factory. Routes + middleware. PURE, no side effects.
- src/index.ts      - calls buildApp(), opens the port. ONLY file that listens.
- scripts/dump-openapi.ts - writes generated/openapi.json. Imports buildApp() only.
- generated/        - machine-written. Do not edit by hand.

## Core rules

1. The route definition is the contract. Method, path, schemas in one place.
2. Validate every input with Zod. .strict() on top-level objects.
3. Preserve literal types: status: 200 as const, z.literal(...) on discriminators.
4. Throw typed errors (NotFoundError, BadRequestError, ...). Never raw responses.
5. requestId(), secureHeaders(), rateLimit() are LOAD-BEARING. Do not remove.
6. Every new route ships a happy-path test AND at least one unhappy-path test.
7. After any route change: pnpm gen && pnpm typecheck && pnpm test.

For the full workflow - adding routes step-by-step, schema conventions,
testing patterns, security guidance - read
.agents/skills/daloyjs-best-practices/SKILL.md`;

const WHY_SMALL = `# Why is AGENTS.md ~50 lines and not 500?
#
# Every coding agent loads SOMETHING into its context on every prompt.
# The size of that "something" is a non-negotiable cost:
#
#   - Copilot / Claude Code / Cursor / Codex / Aider / continue.dev
#     all auto-discover AGENTS.md (or its older cousin .copilot/
#     instructions, .cursorrules, etc.) and prepend it to the prompt.
#
#   - Anything in AGENTS.md eats your effective context window for
#     EVERY turn. Long files dilute the model's attention; the
#     conventions that mattered get drowned by the ones that didn't.
#
#   - Long files also rot. Every doc longer than a page eventually
#     contradicts itself. Short files are fact-checkable on sight.
#
# So AGENTS.md is the "anyone editing this repo MUST know these things"
# tier. It names load-bearing files, hard-and-fast rules, and the
# commands the agent will be asked to run.
#
# Everything that the agent needs only sometimes - the recipe for
# adding a new route, the conventions around schemas, the deployment
# notes - lives in the longer SKILL.md. Agents that understand the
# skills protocol read it on demand. Agents that don't... still get
# the link in AGENTS.md and can follow it.`;

const SKILL_SHAPE = `# .agents/skills/daloyjs-best-practices/SKILL.md is structured for
# both kinds of consumers: humans reviewing in GitHub, and agents
# pattern-matching for the section they need.
#
# Structure of the file (verbatim from the scaffold):
#
#   # SKILL.md - DaloyJS best practices (Node)
#
#   ## When to use this skill
#     Bulleted list. Agents that follow the skills protocol use
#     this to decide whether the file is relevant to the prompt.
#
#   ## Core principles
#     The five contract-first rules the framework was designed for.
#
#   ## Project shape
#     Which file does what, and what NOT to import from where.
#
#   ## Commands cheat-sheet
#     Every pnpm command, with a one-line explanation. Agents copy
#     these into their shell tool calls without inventing flags.
#
#   ## Adding a route step-by-step
#   ## Schema conventions
#   ## Testing patterns
#   ## Security defaults
#   ## Deployment notes
#
# Each H2 is a self-contained chapter. The agent reads the chapter it
# needs, not the whole file, and the surrounding chapters won't drift
# its attention.`;

const SKILL_PROTOCOL = `// What "the skill protocol" actually means, in 30 lines.
//
// Different agents discover repo context with different conventions.
// DaloyJS picks the conventions with the widest blast radius:
//
//   AGENTS.md             - universal. Anthropic, GitHub Copilot, Codex,
//                           Cursor, and Aider all read it (or symlink-
//                           recognize it). Always-loaded.
//   .agents/skills/*/SKILL.md
//                         - Anthropic Skills protocol. Read on demand
//                           when the prompt matches the "When to use"
//                           section.
//
// For agents that don't speak the skill protocol, the AGENTS.md ends
// with a literal:
//
//   For the full workflow ... read
//   .agents/skills/daloyjs-best-practices/SKILL.md
//
// That one sentence routes ANY agent that can read a markdown link
// into the skill file. Including the ones that pre-date the protocol.
//
// The point: maximum signal with zero lock-in. The repo never depends
// on any one vendor's prompt format. Tomorrow's agent reads the same
// files. So does next year's.`;

const WHAT_NOT_TO_INCLUDE = `# What the scaffold INTENTIONALLY does not put in AGENTS.md:
#
#   ✘  Copy-pasted package READMEs. The agent has internet access (or
#      its training set already covers @daloyjs/core). Don't relitigate.
#
#   ✘  Long architectural rationale. AGENTS.md is "what to do",
#      not "why the framework exists". Rationale belongs in the docs.
#
#   ✘  Long lists of TS gotchas. tsc itself is the source of truth
#      for type errors. AGENTS.md should not lie about types.
#
#   ✘  Per-developer preferences ("Always use arrow functions").
#      Those go in .editorconfig / eslint config / prettier config,
#      where they are mechanically enforced. Agents follow tools, not
#      hopes.
#
#   ✘  Anything that lives in package.json. Package manager, runtime,
#      and scripts are already there. AGENTS.md names them, then trusts
#      the agent to read package.json for details.
#
# Every line that survives in AGENTS.md earned its slot by being:
#   - load-bearing (removing it would break the API surface), and
#   - unobvious from reading the file tree alone.`;

const ROUTE_EDIT_EXAMPLE = `// What a coding agent SHOULD do after reading AGENTS.md + SKILL.md.
// Prompt: "add a GET /v1/books/:id endpoint that returns a Book by id".
//
// 1. Open src/build-app.ts (AGENTS.md said: routes live here).
// 2. Add a Zod schema for the response (rule 2 in AGENTS.md).
// 3. Register the route with operationId, request schema, AND a 404
//    response (rules 1 + 4: throw NotFoundError on miss).
// 4. Use z.literal() / "as const" so codegen narrows (rule 3).
// 5. Add a tests/books.test.ts with one happy path AND one 404 path
//    (rule 6).
// 6. Run pnpm gen && pnpm typecheck && pnpm test (rule 7).
//
// The "right" diff, by repo convention:
import { NotFoundError, z } from "@daloyjs/core";

const Book = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
}).strict();                                            // rule 2

app.route({
  method: "GET",
  path: "/v1/books/:id",
  operationId: "getBook",                               // rule 1
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "ok", body: Book },             // rule 3
    404: { description: "not found" },                  // rule 4
  },
  handler: async (ctx) => {
    const book = await loadBook(ctx.params.id);
    if (!book) throw new NotFoundError("book not found");
    return { status: 200 as const, body: book };       // rule 3
  },
});

// ↑ Notice: zero load-bearing middleware removed (rule 5).
// Notice: generated/openapi.json NEVER edited by hand - pnpm gen
//         writes it from buildApp() (project shape rule).`;

const CARRYING_OVER = `# Want this in your existing (non-scaffolded) DaloyJS project? Copy
# four files. Total: about 200 lines of prose.
#
$ mkdir -p .agents/skills/daloyjs-best-practices
$ cp node_modules/create-daloy/templates/node-basic/AGENTS.md ./
$ cp node_modules/create-daloy/templates/node-basic/_agents/skills/daloyjs-best-practices/SKILL.md \\
    .agents/skills/daloyjs-best-practices/SKILL.md
$ cp node_modules/create-daloy/templates/node-basic/.github/copilot-instructions.md \\
    .github/copilot-instructions.md
$ cp node_modules/create-daloy/templates/node-basic/.cursorrules ./
#
# Tune AGENTS.md to YOUR repo. Two changes that matter most:
#
#   1) The "Core rules" section. Add anything load-bearing in YOUR
#      codebase - "the admin plugin must never auto-mount in prod",
#      "do not edit src/legacy/*", "audit logs go through audit.ts".
#
#   2) The "Project shape" section. Name your domain folders and what
#      lives in them. This single section saves more PR review time
#      than every other agent customization combined.`;

const WHY_THIS_HELPS = `# What concretely changes when AGENTS.md + SKILL.md are present.
#
# Before (no agent files):
#   Prompt: "add a search endpoint"
#   Diff: 18 files, 600 LOC, removes one middleware, edits
#         generated/openapi.json by hand, no tests, no contract gate.
#
# After (scaffolded agent files):
#   Prompt: "add a search endpoint"
#   Diff:  2 files (src/build-app.ts + tests/search.test.ts), 60 LOC,
#          generated/openapi.json untouched (pnpm gen rewrites it),
#          requestId/secureHeaders/rateLimit untouched, happy +
#          unhappy paths covered, operationId present, 422 declared.
#
# This is not theoretical. It's the difference I see on PR-by-PR
# basis in scaffolded vs unscaffolded teams. The agent isn't smarter.
# The repo is just clearer about what "right" looks like.`;

const CHECKLIST = `# Pre-flight: is your repo ready for coding agents?
#
# 1) AGENTS.md exists at the repo root.
#    [ ] Lists package manager and runtime.
#    [ ] Lists the commands the agent is allowed to run.
#    [ ] Names load-bearing files ("only file that opens a port").
#    [ ] Names load-bearing middleware ("requestId/secureHeaders are
#         load-bearing, do not remove").
#    [ ] Ends with a link to the longer SKILL.md.
#
# 2) .agents/skills/<name>/SKILL.md exists and is chapter-organized.
#    [ ] "When to use this skill" section at the top.
#    [ ] One H2 per concern (routes, schemas, tests, security, ...).
#    [ ] Each H2 is independently readable.
#
# 3) Conventions are enforced where possible.
#    [ ] eslint config catches the rules AGENTS.md names.
#    [ ] CI runs pnpm daloy inspect --check (see the CLI post).
#    [ ] generated/ is .gitignored OR gated by git diff --exit-code.
#
# 4) Agent files stay short.
#    [ ] AGENTS.md is one screen of prose, not three.
#    [ ] SKILL.md sections are paragraphs, not essays.
#    [ ] Per-developer style goes in tooling, not docs.
#
# 5) Forward-compat: don't lock yourself to one vendor's prompt format.
#    [ ] AGENTS.md is the source of truth.
#    [ ] .copilot-instructions / .cursorrules just import / link to it.
#    [ ] Agents that don't speak any protocol still get the link.`;

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
          Size:{" "}
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
            <Badge variant="outline">Developer Experience</Badge>
            <Badge variant="outline">Coding Agents</Badge>
            <Badge variant="outline">Scaffolding</Badge>
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
            Devlin here again. I want to do something a little forward-looking
            this time and talk about a part of the DaloyJS scaffolding that
            almost nobody notices on first install: every project created by{" "}
            <code>pnpm create daloy</code> ships with two specific files for
            coding agents. One short, one long. They&apos;re why your Copilot,
            Claude Code, Cursor, Codex, or continue.dev session starts behaving
            sensibly inside a DaloyJS project from the first prompt instead of
            the tenth.
          </p>

          <h2>The failure mode this fixes</h2>

          <EditorFrame
            files={["incident.md"]}
            activeFile="incident.md"
            status="every line happened in a real PR I reviewed · 0/10 stars"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <p>
            None of this is the model&apos;s fault, by the way. The agent did
            the most plausible thing it could imagine from the prompt and the
            file tree. The repo simply never told it which middleware was
            load-bearing, which file was the single source of truth, or that{" "}
            <code>generated/openapi.json</code> is machine-written.
          </p>

          <h2>What the scaffold actually drops in</h2>

          <EditorFrame
            files={["my-app/ (post-scaffold)"]}
            activeFile="my-app/ (post-scaffold)"
            status="two files · two tiers · zero per-vendor lock-in"
          >
            <CodeBlock language="bash" code={AGENTS_SHAPE} />
          </EditorFrame>

          <TierCard tier="AGENTS.md" size="≈ 50 lines · always loaded">
            The hard-and-fast rules every editor (human or otherwise) must know
            before changing a line: package manager, runtime, load-bearing files
            and middleware, the seven core rules, and a link to{" "}
            <code>SKILL.md</code>. Pinned to the repo root because every modern
            coding agent auto-discovers it there.
          </TierCard>
          <TierCard
            tier=".agents/skills/.../SKILL.md"
            size="longer · on-demand"
          >
            The chapter-organized manual: when to use this skill, core
            principles, project shape, commands, route recipes, schema
            conventions, testing patterns, security defaults, and deployment
            notes. Agents that speak the Anthropic Skills protocol load it when
            the prompt matches the &quot;When to use&quot; section; agents that
            don&apos;t follow the link from AGENTS.md.
          </TierCard>

          <h2>The actual AGENTS.md (annotated)</h2>

          <EditorFrame
            files={["my-app/AGENTS.md"]}
            activeFile="my-app/AGENTS.md"
            status="taken verbatim from packages/create-daloy/templates/node-basic"
          >
            <CodeBlock language="bash" code={AGENTS_FILE} />
          </EditorFrame>

          <p>
            Notice what this file does <em>not</em> contain: no ASCII-art
            architecture diagram, no copy-pasted
            <code>@daloyjs/core</code> README, no list of every TS gotcha. It
            says: here&apos;s where things live, here are the seven
            non-negotiable rules, and here&apos;s where to read the manual.
            That&apos;s it.
          </p>

          <h2>Why &quot;short&quot; is the whole design</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="every agent pays for context with attention · short files punch harder"
          >
            <CodeBlock language="bash" code={WHY_SMALL} />
          </EditorFrame>

          <h2>The SKILL.md structure</h2>

          <EditorFrame
            files={[".agents/skills/.../SKILL.md (outline)"]}
            activeFile=".agents/skills/.../SKILL.md (outline)"
            status="chapter per concern · independently readable · the agent reads the chapter it needs"
          >
            <CodeBlock language="bash" code={SKILL_SHAPE} />
          </EditorFrame>

          <h2>The &quot;skill protocol&quot;, briefly</h2>

          <EditorFrame
            files={["explainer.ts"]}
            activeFile="explainer.ts"
            status="vendor-neutral · the link in AGENTS.md is the universal fallback"
          >
            <CodeBlock language="ts" code={SKILL_PROTOCOL} />
          </EditorFrame>

          <h2>What we deliberately leave out</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="five anti-patterns · every line in AGENTS.md earned its slot"
          >
            <CodeBlock language="bash" code={WHAT_NOT_TO_INCLUDE} />
          </EditorFrame>

          <h2>
            What &quot;the agent did the right thing&quot; actually looks like
          </h2>

          <EditorFrame
            files={["src/build-app.ts (right diff)"]}
            activeFile="src/build-app.ts (right diff)"
            status="2 files · 60 LOC · all seven AGENTS.md rules respected"
          >
            <CodeBlock language="ts" code={ROUTE_EDIT_EXAMPLE} />
          </EditorFrame>

          <h2>Adding this to an existing project</h2>

          <EditorFrame
            files={["terminal"]}
            activeFile="terminal"
            status="four files · ~200 lines of prose · tune the two sections that matter"
          >
            <CodeBlock language="bash" code={CARRYING_OVER} />
          </EditorFrame>

          <h2>Concretely, what changes</h2>

          <EditorFrame
            files={["before-vs-after.md"]}
            activeFile="before-vs-after.md"
            status="not theoretical · the diff I see in real PRs"
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
            The boring secret of working well with coding agents is the same
            boring secret of working well with new human joiners: write down the
            load-bearing conventions, keep them short, link to the deeper manual
            when one is needed, and enforce what you can in tooling. DaloyJS
            just makes sure the scaffold gives you a head start on all four.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds">
              create-daloy scaffolding post
            </Link>{" "}
            for what else lands in your project on day one, the{" "}
            <Link href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health">
              CLI inspector post
            </Link>{" "}
            for the contract gate that pairs with rule 7 of AGENTS.md, and the{" "}
            <Link href="/blog/plugin-lifecycle-events-for-large-team-framework-code">
              plugin lifecycle post
            </Link>{" "}
            for the policy plugin that mechanically enforces the
            &quot;don&apos;t remove load-bearing middleware&quot; rule from the
            framework side.
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
