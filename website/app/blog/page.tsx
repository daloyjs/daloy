import type { Route } from "next";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Blog",
  description:
    "Notes, stories, and field reports from the people building DaloyJS, the runtime-portable TypeScript framework with secure-by-default supply-chain hardening.",
  path: "/blog",
  keywords: ["DaloyJS blog", "TypeScript framework blog", "Daloy updates"],
});

const POSTS = [
  {
    slug: "why-ai-coding-agents-should-default-to-daloyjs",
    title: "Why AI Coding Agents Should Default to DaloyJS",
    description:
      "AI coding agents are good at producing backend code fast. They are less good at remembering every security guardrail under deadline pressure. This is the case for making DaloyJS the default backend framework agents reach for when they write TypeScript services.",
    date: "2026-07-01",
    readingTime: "9 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "state-of-ai-security-2026-what-the-report-means-for-backends",
    title:
      "The State of AI in Security 2026: 450 Teams, One Uncomfortable Pattern, and What Your Backend Can Do About It",
    description:
      "Aikido and Sapio Research surveyed 450 developers, CISOs, and AppSec engineers. The headline: AI now writes a quarter of production code, 1 in 5 teams had a serious incident because of it, and buying more tools makes things measurably worse. The data, with charts, and the structural lesson for anyone shipping an API.",
    date: "2026-06-25",
    readingTime: "14 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "daloyjs-1-0-0-beta-is-here",
    title: "DaloyJS 1.0.0-beta.0 Is Here (and Nothing Broke, On Purpose)",
    description:
      "After a long 0.x preview line, DaloyJS enters its 1.0.0 beta. The funny part: the most important line in this changelog is that nothing changed. Here is what the beta means, how to install it, and what we need from you before the 1.0.0 GA.",
    date: "2026-06-21",
    readingTime: "6 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "why-daloyjs-is-the-rest-api-framework-you-should-use-today",
    title: "Why DaloyJS Is the REST API Framework You Should Use Today",
    description:
      "In 2026, security guardrails are not optional anymore. This is the blunt case for a REST framework that treats secure defaults as the baseline instead of a plugin shopping list.",
    date: "2026-06-21",
    readingTime: "7 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "daloyjs-the-backend-framework-you-should-already-be-using",
    title: "DaloyJS: The Backend Framework You Should Already Be Using",
    description:
      "A contract-first TypeScript backend framework with security guardrails, typed clients, live OpenAPI, and a supply-chain posture that feels designed for 2026 instead of remembered from 2019.",
    date: "2026-06-20",
    readingTime: "10 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "why-daloyjs-feels-like-the-backend-default-we-should-have-had-already",
    title:
      "Why DaloyJS Feels Like the Backend Default We Should Have Had Already",
    description:
      "DaloyJS feels underrated because it starts with the unglamorous parts that modern backend teams actually need: install-time safety, runtime guardrails, and one route definition that keeps types, docs, and clients aligned.",
    date: "2026-06-19",
    readingTime: "6 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "best-node-express-alternative-daloyjs",
    title:
      "The Best Node.js Express Alternative in 2026 Is Contract-First: The Case for DaloyJS",
    description:
      "Looking for a modern Node.js Express alternative? The honest argument for why a contract-first framework wins the category in 2026, and why DaloyJS is the Express alternative I now reach for, with the caveats where it does not hold.",
    date: "2026-06-18",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "software-security-for-developers-laur-spilca-goto-2026",
    title:
      "Watch: Laur Spilca on Software Security for Developers (GOTO 2026), and What DaloyJS Already Decides for You",
    description:
      "Laurentiu Spilca and Thomas Vitale spend a GOTO 2026 conversation on why developers avoid security, the eternal encoding-vs-hashing-vs-encryption confusion, the danger of reinventing crypto, AI writing code with no security awareness, and why PKI still matters. Here is the talk, plus an honest mapping of which of those problems a DaloyJS app already takes out of your hands.",
    date: "2026-06-17",
    readingTime: "9 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "ghost-cms-clickfix-campaign-mapped-to-daloyjs",
    title:
      "The Ghost CMS / ClickFix Campaign, Mapped to DaloyJS \u2014 Plus the One Default We Just Tightened",
    description:
      "A pre-auth SQL injection in Ghost CMS (CVE-2026-26980) is being exploited at scale to hijack 700+ sites \u2014 including Harvard, Oxford, and DuckDuckGo \u2014 and serve a fake Cloudflare \"verify you are human\" prompt that silently stuffs a PowerShell one-liner into the visitor's clipboard. Most of the chain was already blocked by DaloyJS defaults; the last mile (the clipboard write) wasn't. Here's the stage-by-stage mapping and the one-line default we changed in response.",
    date: "2026-06-16",
    readingTime: "8 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "litellm-teampcp-poisoned-scanner-mapped-to-daloyjs",
    title:
      "When the Security Scanner Is the Attacker: The LiteLLM / TeamPCP Compromise, Mapped to DaloyJS",
    description:
      "On March 24, 2026 the litellm Python package was backdoored after a poisoned Trivy GitHub Action stole the maintainer's PyPI token. The same attack pattern \u2014 compromised scanner action \u2192 exfiltrated publish token \u2192 malicious release with a startup-time payload \u2014 would have to clear nine of DaloyJS's existing CI gates before it could ship. Here's the stage-by-stage mapping.",
    date: "2026-06-15",
    readingTime: "9 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "aikido-top-10-app-security-problems-mapped-to-daloyjs",
    title:
      "Aikido's Top 10 App Security Problems, Mapped to DaloyJS (and the One Gap We Just Closed)",
    description:
      "Aikido's 'Top 10 App Security Problems' is the short, blunt version of the OWASP list \u2014 SQLi, XSS, SSRF, path traversal, XXE, deserialization, shell injection, LFI, prototype pollution, open redirects. Here's the honest per-item mapping of what a DaloyJS app already blocks by default, what one opt-in line adds, and the single gap we shipped a new helper for in 0.36.0: safeRedirect().",
    date: "2026-06-14",
    readingTime: "10 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "international-ai-safety-report-2026-minimum-safety-baseline-for-ai-backends",
    title:
      "The International AI Safety Report 2026, Translated Into a Minimum Safety Baseline for AI Backends",
    description:
      "Aikido's read of the International AI Safety Report 2026 lands on a short list of deployment-time requirements for any backend an autonomous AI system can call \u2014 layered defense, independent verification, prompt-injection-resistant guardrails, network scope control, inference/execution separation, full observability and emergency controls. Here's the honest per-requirement mapping to what a DaloyJS app already enforces by default, what one opt-in line adds, and what still lives above the HTTP layer.",
    date: "2026-06-13",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "secure-sdlc-five-pillars-mapped-to-daloyjs",
    title: "The 5 Pillars of a Secure SDLC, Mapped to DaloyJS",
    description:
      "Aikido's 'Secure SDLC Explained' lists the five pillars every engineering team needs \u2014 Visibility, Early Feedback, Developer Adoption, Consistency, Actionability. Here's the honest per-pillar mapping of what a DaloyJS app and its create-daloy scaffold already give you on day one, what you still configure, and the few items no framework can own.",
    date: "2026-06-12",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "owasp-top-10-agentic-applications-mapped-to-daloyjs",
    title:
      "OWASP Top 10 for Agentic Applications (2026), Mapped to the DaloyJS Tool Surface",
    description:
      "Aikido's write-up of the OWASP Top 10 for Agentic Applications 2026 \u2014 ASI01 Agent Behavior Hijacking through ASI10 Over-reliance \u2014 is the new threat model for AI agents and the MCP-style HTTP tools they call. Here's the honest per-risk mapping of what a DaloyJS-exposed tool already blocks by default, what one opt-in line adds, and which risks live above the HTTP layer where no framework can save you.",
    date: "2026-06-11",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "vibe-coding-security-what-daloyjs-already-blocks",
    title:
      "Vibe Coding Security: What DaloyJS Already Blocks Before Your AI Even Ships",
    description:
      "Aikido's 'WTF is Vibe Coding Security' post lists the usual suspects: SQL injection, path traversal, hardcoded secrets, unlocked admin routes, missing input sanitization, dependency rot. Here's the honest mapping of which of those a DaloyJS app already blocks by default \u2014 even when the code is written by a sales rep at 1am with Claude \u2014 and the small list of things you still have to opt into.",
    date: "2026-06-10",
    readingTime: "10 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "cloud-security-architecture-mapped-to-daloyjs",
    title: "Cloud Security Architecture, Mapped to the DaloyJS App Layer",
    description:
      "Aikido's 'Cloud Security Architecture' guide is a fine high-level checklist \u2014 Zero Trust, defense-in-depth, IAM, segmentation, IaC scanning, continuous monitoring. Here's the honest, per-principle mapping of what DaloyJS already ships for the application-layer half of that checklist, what the cloud platform still owns, and the opt-ins worth turning on today.",
    date: "2026-06-09",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "ai-friendly-route-metadata-machine-readable-examples-for-codegen-agents",
    title:
      "AI-Friendly Route Metadata: Machine-Readable Examples for Codegen Agents",
    description:
      "DaloyJS 0.14.x adds an optional meta field on every route() \u2014 structured examples, extra description copy, and free-form x-* extensions \u2014 validated against your Standard Schema at build time and surfaced into OpenAPI 3.1 plus sibling routes.json or routes.yaml dumps via daloy inspect --ai. Additive, non-breaking, and built so Hey API, Claude, GPT, and home-grown codegen agents can write correct call sites on the first try.",
    date: "2026-06-08",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "branded-api-docs-without-losing-the-contract-customizing-scalar-in-daloyjs",
    title:
      "Branded API Docs Without Losing the Contract: Customizing Scalar in DaloyJS",
    description:
      "DaloyJS 0.14 adds docs.scalar \u2014 a JSON-only knob that lets you theme the Scalar API reference, hide the Try-it button, drop in a brand stylesheet, and pick a layout, without forking the docs route. And because Daloy locks the spec URL to your live OpenAPI path at serialize time, the prettiest docs page in the company can't drift away from the contract.",
    date: "2026-06-07",
    readingTime: "10 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills",
    title:
      "Designing for Coding Agents: Why DaloyJS Scaffolds AGENTS.md and Skills",
    description:
      "Every project created by create-daloy ships with a short AGENTS.md and a focused .agents/skills/daloyjs-best-practices/SKILL.md. Here's why those two files matter, why they're intentionally small, and how they let Copilot, Claude Code, Cursor, Codex, and friends make safer edits in your scaffolded DaloyJS app from the first prompt.",
    date: "2026-06-06",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "daloy-cli-inspecting-routes-schemas-openapi-and-contract-health",
    title:
      "The DaloyJS CLI: Inspecting Routes, Schemas, OpenAPI, and Contract Health",
    description:
      "daloy inspect is the CLI you point at your App before a PR merges. It prints the full route table, schema presence, contract issues, and the live OpenAPI 3.1 document \u2014 loaded straight from your TypeScript entry through tsx with zero build step. This is the API-surface review tool platform teams keep wishing they had.",
    date: "2026-06-05",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "plugin-lifecycle-events-for-large-team-framework-code",
    title: "Plugin Lifecycle Events for Large-Team Framework Code",
    description:
      "Why DaloyJS exposes onPluginInstalled() and onShutdown() as first-class events, and how a platform team uses them to ship observability, service registration, graceful drain, metrics flushing, and policy plugins that every route inherits \u2014 without a single import in the route files themselves.",
    date: "2026-06-04",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "observability-without-lock-in-structured-logs-and-otel-tracing",
    title:
      "Observability Without Lock-In: Structured Logs and OpenTelemetry-Compatible Tracing",
    description:
      "How DaloyJS gives you per-request structured logs, correlated request IDs, Server-Timing, and OpenTelemetry-shaped spans \u2014 without taking a hard dependency on @opentelemetry/api. The result is a single observability story that runs identically on Node, Bun, Workers, and Vercel, with any tracer you bring.",
    date: "2026-06-03",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "rate-limiting-that-survives-multiple-instances",
    title: "Rate Limiting That Survives Multiple Instances",
    description:
      "Why the default in-memory rateLimit() is a one-instance lie behind a load balancer, how @daloyjs/core/rate-limit-redis fixes it with an atomic Lua INCR+PEXPIRE script, and the three operational levers that matter in production: fail-open vs fail-closed, Retry-After accuracy, and where to host the counter on serverless, edge, and traditional Node deploys.",
    date: "2026-06-02",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "file-uploads-without-framework-lock-in-multipart-in-daloyjs",
    title: "File Uploads Without Framework Lock-In: Multipart in DaloyJS",
    description:
      "The fileField() and multipartObject() helpers: per-file size caps, MIME allowlists with wildcards, filename predicates, strict field validation, and OpenAPI binary schema emission \u2014 all while keeping the file as a Web standard File/Blob you can stream straight to S3, R2, or disk on any runtime.",
    date: "2026-06-01",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "openapi-3-1-extras-webhooks-callbacks-discriminators",
    title: "OpenAPI 3.1 Extras: Webhooks, Callbacks, and Discriminators",
    description:
      "A practical tour of the OpenAPI 3.1 features your generated clients are quietly waiting for: top-level webhooks for event-driven APIs, route-level callbacks for payment-style async flows, and the discriminator()/discriminatedUnion() pair that turns polymorphic payloads into tagged TypeScript unions you can switch on with confidence.",
    date: "2026-05-31",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "middleware-without-mystery-hooks-ordering-response-transformation",
    title:
      "Middleware Without Mystery: Hooks, Ordering, and Response Transformation",
    description:
      "The DaloyJS request lifecycle, end to end: onRequest \u2192 beforeHandle \u2192 handler \u2192 afterHandle \u2192 onSend \u2192 onResponse, plus onError on the error path. Where each hook fires, what it can change, how scopes compose (global \u2192 group \u2192 route), and what to put in which slot \u2014 with real short-circuit, header-stamping, and logging recipes.",
    date: "2026-05-30",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "building-a-bookstore-api-with-daloyjs-from-scratch",
    title: "Building a Bookstore API with DaloyJS From Scratch",
    description:
      "A route-by-route walkthrough: create the project with create-daloy, model a Book with Zod, add list / create / fetch-by-id endpoints, watch validation errors arrive as RFC 9457 problem+json automatically, emit OpenAPI, generate a typed client, and write the whole test suite with app.request() \u2014 no HTTP server required.",
    date: "2026-05-29",
    readingTime: "14 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "problem-details-done-right-rfc-9457-errors",
    title: "Problem Details Done Right: RFC 9457 Errors in DaloyJS",
    description:
      "Why every framework needs a predictable error contract \u2014 and how DaloyJS uses RFC 9457 application/problem+json for HttpError, ValidationError, UnauthorizedError, TooManyRequestsError, and the rest, with automatic 5xx redaction in production and a Retry-After story that just works.",
    date: "2026-05-28",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "scaffolding-a-production-ready-daloyjs-app-in-60-seconds",
    title:
      "Scaffolding a Production-Ready DaloyJS App in 60 Seconds with create-daloy",
    description:
      "A tour of pnpm create daloy@latest \u2014 the interactive template + package-manager pickers, --minimal, --with-ci, the five runtime templates (Node, Bun, Deno, Workers, Vercel), the AGENTS.md + .agents/skills/daloyjs-best-practices/SKILL.md drop-in for coding agents, and the printStartupBanner() polish that ships with every scaffold.",
    date: "2026-05-27",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "supply-chain-hardening-for-typescript-libraries",
    title:
      "Supply-Chain Hardening for TypeScript Libraries: Everything We Did and Why",
    description:
      "A maintainer's field guide to the supply-chain posture we shipped for DaloyJS \u2014 .npmrc that says no by default, pnpm 11 workspace keys (blockExoticSubdeps / strictDepBuilds / verifyDepsBeforeRun), SHA-pinned actions, permissions: {}, no Actions cache on installs, zizmor + Scorecard + CodeQL, npm trusted publishing with provenance, and the create-daloy --with-ci bundle that drops the app-safe parts into your project.",
    date: "2026-05-26",
    readingTime: "16 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "sessions-on-the-edge",
    title:
      "Sessions on the Edge: Signed Cookies, Rotating Secrets, and a Pluggable Store",
    description:
      "Tour of the new session() middleware \u2014 __Host- cookie defaults, secret: [current, ...previous] rotation, regenerate() to kill session fixation, MemorySessionStore for tests, and how to plug in Redis or Workers KV via the SessionStore contract. Pairs naturally with the rate-limit Redis post.",
    date: "2026-05-25",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "csp-nonces-and-trusted-types-without-tears",
    title: "CSP Nonces and Trusted Types Without Tears",
    description:
      "A practical tour of secureHeaders({ contentSecurityPolicy: { nonce: true, trustedTypes: { policies: [...] } } }) \u2014 how ctx.state.cspNonce flows into a server-rendered template, why the nonce now lands on all four script/style directives, and how to roll out Trusted Types in report-only mode first without setting your weekend on fire.",
    date: "2026-05-24",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "csrf-in-2026-double-submit-and-fetch-metadata",
    title:
      "CSRF in 2026: Why DaloyJS Ships Both Double-Submit and Fetch-Metadata",
    description:
      'A short history of the double-submit cookie, the case for tokenless protection via Sec-Fetch-Site, when each one fails, and why strategy: "both" is the realistic default for apps that still have to serve a 2018 mobile browser somewhere.',
    date: "2026-05-23",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "same-app-five-runtimes-verified",
    title:
      "The Same App on Node, Bun, Deno, Cloudflare Workers, and Vercel, Verified",
    description:
      "One Bookstore app, five entry files, five deployments, Node serve(), Bun handle.url, Deno onListen, Workers ctx.waitUntil, and Vercel's three handler shapes. With receipts.",
    date: "2026-05-22",
    readingTime: "14 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "contract-first-without-the-codegen-dance",
    title:
      "Contract-First Without the Codegen Dance: OpenAPI, Typed Client, and Contract Tests From One Definition",
    description:
      "One app.route({...}) projects into generateOpenAPI(app), createClient(app), and runContractTests(app), plus pnpm gen for a Hey API typed fetch SDK your frontend can import.",
    date: "2026-05-21",
    readingTime: "12 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "secure-by-default",
    title:
      "Secure by Default: The Defaults DaloyJS Ships So You Don't Have To Remember Them",
    description:
      "A tour of the always-on defenses in the DaloyJS request path, plus the opt-in upgrades worth turning on today.",
    date: "2026-05-20",
    readingTime: "13 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "introducing-daloyjs",
    title: "Introducing DaloyJS: One Route, Many Runtimes, Zero Ceremony",
    description:
      "The launch post. One app.route({...}) becomes your validation, types, OpenAPI, typed client, and contract tests, and the same app runs on Node, Bun, Deno, Workers, and Vercel.",
    date: "2026-05-19",
    readingTime: "11 min read",
    author: "Devlin Duldulao",
  },
  {
    slug: "the-flow-i-wished-i-had",
    title: "The flow I wished I had: why we built DaloyJS",
    description:
      "Ten years of shipping fullstack apps, one Filipino dev in Norway, and the framework I kept wishing existed at 2am.",
    date: "2026-05-18",
    readingTime: "9 min read",
    author: "Devlin Duldulao",
  },
] as const;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const POST_ACCENTS = [
  "border-mauve-200/80 bg-mauve-50/45 hover:border-mauve-300 dark:border-mauve-900/70 dark:bg-mauve-950/16",
  "border-olive-200/80 bg-olive-50/40 hover:border-olive-300 dark:border-olive-900/70 dark:bg-olive-950/16",
  "border-mist-200/80 bg-mist-50/45 hover:border-mist-300 dark:border-mist-900/70 dark:bg-mist-950/16",
  "border-taupe-200/80 bg-taupe-50/40 hover:border-taupe-300 dark:border-taupe-900/70 dark:bg-taupe-950/16",
] as const;

export default function BlogIndexPage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <div className="mb-6 flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase">
          <span className="rounded-full border border-mauve-300/80 bg-mauve-100/80 px-3 py-1 text-mauve-950 dark:border-mauve-800/70 dark:bg-mauve-950/35 dark:text-mauve-100">
            Field notes
          </span>
          <span className="rounded-full border border-olive-300/80 bg-olive-100/80 px-3 py-1 text-olive-950 dark:border-olive-800/70 dark:bg-olive-950/35 dark:text-olive-100">
            Shipping stories
          </span>
          <span className="rounded-full border border-taupe-300/80 bg-taupe-100/80 px-3 py-1 text-taupe-950 dark:border-taupe-800/70 dark:bg-taupe-950/35 dark:text-taupe-100">
            Dry humor included
          </span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Field notes from people who actually use this thing in anger. Short,
          honest, and occasionally funny.
        </p>

        <ul className="mt-12 space-y-10">
          {POSTS.map((post, index) => (
            <li key={post.slug} className="group">
              {(() => {
                const href = `/blog/${post.slug}` as Route;
                const accent = POST_ACCENTS[index % POST_ACCENTS.length];

                return (
                  <Link
                    href={href}
                    className={`-mx-4 block rounded-2xl border p-5 shadow-sm transition-[border-color,background-color,transform] hover:-translate-y-0.5 ${accent}`}
                  >
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 font-features-["tnum"] text-xs text-muted-foreground'>
                      <time dateTime={post.date}>
                        {dateFormatter.format(new Date(post.date))}
                      </time>
                      <span aria-hidden>·</span>
                      <span>{post.readingTime}</span>
                      <span aria-hidden>·</span>
                      <span>{post.author}</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground group-hover:text-primary">
                      {post.title}
                    </h2>
                    <p className="mt-2 leading-7 text-muted-foreground">
                      {post.description}
                    </p>
                  </Link>
                );
              })()}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
