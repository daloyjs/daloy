import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "vibe-coding-security-what-daloyjs-already-blocks",
  title:
    "Vibe Coding Security: What DaloyJS Already Blocks Before Your AI Even Ships",
  description:
    "Aikido's 'WTF is Vibe Coding Security' post lists the usual suspects: SQL injection, path traversal, hardcoded secrets, unlocked admin routes, missing input sanitization, dependency rot. Here's the honest mapping of which of those a DaloyJS app already blocks by default, even when the code is written by a sales rep at 1am with Claude, and the small list of things you still have to opt into.",
  date: "2026-06-10",
  readingTime: "10 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "vibe coding security",
    "agentic coding safety",
    "AI generated code security",
    "DaloyJS secure by default",
    "SQL injection TypeScript framework",
    "path traversal Node",
    "admin route exposure",
    "supply chain hardening TypeScript",
    "Aikido vibe coding",
    "PromptBOM SBOM",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SCHEMA_VALIDATED = `// What a "vibe-coded" route looks like in DaloyJS.
// The AI cannot skip validation because the schema IS the route.
import { z } from "zod";
import { App } from "@daloyjs/core";

export const app = new App();

app.route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  request: {
    // No schema, no route. A missing body schema is a build-time error
    // for endpoints with bodies, and unknown content types get 415.
    body: z.object({
      sku: z.string().min(1).max(64),
      quantity: z.number().int().positive().max(1000),
      customerEmail: z.email(),
    }),
  },
  responses: {
    201: { description: "created" },
  },
  handler: async ({ body }) => {
    // 'body' is fully typed AND already validated. There is no untyped
    // req.body.whatever escape hatch in the public API.
    return { status: 201, body: { id: crypto.randomUUID(), ...body } };
  },
});`;

const NO_RAW_SQL = `// DaloyJS does not ship an ORM, on purpose.
// What it DOES ship is a docs page that says: bring a real ORM, never
// concatenate user input into SQL, and the validated 'body' / 'query'
// objects are the inputs your ORM should see.
//
// See /docs/security/sql-injection and /docs/orm for the per-ORM guidance.
import { prisma } from "./db.js";

app.route({
  method: "GET",
  path: "/products",
  operationId: "listProducts",
  request: {
    query: z.object({
      q: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: { 200: { description: "ok" } },
  handler: async ({ query }) => {
    // Parameterized. No template-string SQL anywhere in the call site.
    const products = await prisma.product.findMany({
      where: query.q ? { name: { contains: query.q } } : undefined,
      take: query.limit,
    });
    return { status: 200, body: products };
  },
});`;

const PATH_TRAVERSAL = `// The router rejects path traversal before any handler runs.
//
//   GET /files/..%2F..%2Fetc%2Fpasswd      -> 400
//   GET /files/%00secret.txt               -> 400
//   GET /files//etc/passwd                 -> 400
//   GET /files/%2e%2e/secret                -> 400
//
// You don't have to remember this in every route. The router does.
// (See /docs/security/runtime-protections for the full list.)
app.route({
  method: "GET",
  path: "/files/:name",
  operationId: "getFile",
  request: {
    params: z.object({
      // Belt-and-braces: still constrain the param shape at the route level.
      name: z.string().regex(/^[a-z0-9._-]{1,128}$/i),
    }),
  },
  responses: { 200: { description: "ok" } },
  handler: async ({ params }) => readFile(params.name),
});`;

const ADMIN_LOCKED = `// The "Tea app" lesson, never leave an admin route mounted on the
// public app without auth + network restriction. Daloy gives you both
// as boring middleware so the wrong default is hard to type.
import { App, ipRestriction, basicAuth, timingSafeEqual } from "@daloyjs/core";

export const adminApp = new App();

adminApp.use(
  ipRestriction({ allow: ["10.0.0.0/8"] }),
  basicAuth({
    realm: "admin",
    verify: (user, pass) =>
      timingSafeEqual(user, process.env.ADMIN_USER!) &&
      timingSafeEqual(pass, process.env.ADMIN_PASS!)
        ? { sub: "admin" }
        : false,
  }),
);

// Keep the admin app off the public deploy entirely when you can -
// /docs/security/admin-panels has the full pattern (separate process,
// separate hostname, separate ingress).`;

const NO_HARDCODED_SECRETS = `# Daloy's repo and every scaffolded create-daloy project run these CI
# gates on every PR. They are not aspirational - a failure blocks merge.
pnpm verify:no-leaked-credentials      # AWS keys, GCP keys, GH tokens, npm tokens
pnpm verify:secret-comparisons         # all secret compares use timingSafeEqual
pnpm verify:no-encoded-payloads        # base64 blobs (a common AI-slop smuggling vector)
pnpm verify:no-invisible-unicode       # Trojan Source / zero-width / bidi
pnpm verify:no-remote-exec             # no curl|sh, no eval(fetch(...))
pnpm verify:no-lifecycle-scripts       # no install / postinstall / prepare scripts
pnpm verify:no-registry-exfiltration   # no sneaky POSTs to a registry-shaped URL
pnpm verify:no-runtime-deps            # @daloyjs/core ships ZERO runtime deps
pnpm verify:actions-pinned             # every GH Action pinned to a commit SHA
pnpm verify:dep-licenses               # license allow-list
pnpm verify:sbom                       # CycloneDX SBOM generated + signed`;

const SSRF_GUARD = `// "AI agents that can install dependencies, run tests, refactor files,
// and update infrastructure" - Aikido's exact words - also tend to write
// handlers that call any URL the prompt suggests. fetchGuard() turns that
// into an explicit egress allow-list with default-deny on cloud metadata
// IPs (169.254.169.254), localhost, and RFC1918 ranges.
import { App, fetchGuard } from "@daloyjs/core";

export const app = new App();

app.use(fetchGuard({
  allow: [
    "https://api.stripe.com",
    "https://*.s3.amazonaws.com",
  ],
  // Default-blocked ranges (for clarity):
  // 169.254.0.0/16, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
  // 192.168.0.0/16, ::1, fc00::/7
}));`;

const ASSUME_VIBE = `// The "assume the vibe-coder will skip security" defaults DaloyJS
// turns on without asking - none of these need a flag.
//
// 1. Body-size DoS: streamed read, 1 MiB default cap, Content-Length
//    checked first -> 413. AI agents love to forget body limits.
// 2. Request timeout: 30s default. Slow-loris and hung handlers die.
// 3. Prototype pollution: __proto__ / constructor / prototype stripped
//    from every JSON body. A vibe-coded user-update route can't be
//    abused into mass assignment of internal flags.
// 4. CRLF / header splitting: rejected at write time. Set-Cookie smuggling
//    via a 'name' field never reaches the wire.
// 5. Path traversal: '..' and '//' rejected before routing.
// 6. Production redacts 5xx bodies: no stack traces, no internal hostnames,
//    no DB error messages leaked to attackers.
// 7. Method confusion: real 405 with Allow header - not a misleading 404
//    that helps enumeration tools.
// 8. Unsupported content types on body routes: 415. No silent JSON-parse
//    of a text/plain payload.
// 9. Cookies default to __Host- prefix, Secure, HttpOnly, SameSite=Lax.
//
// All of the above are the constructor:
new App();`;

const VIBE_CODER_CHECKLIST = `// A 60-second checklist a vibe-coder can paste into their prompt.
//
//   "Use DaloyJS. Every route MUST have a Zod schema for body, query,
//    and params. Use prisma (or drizzle) - never template-string SQL.
//    Mount admin under /admin with ipRestriction + basicAuth, or move it
//    to a separate adminApp on a different deploy. Add secureHeaders(),
//    rateLimit(), and fetchGuard() in app.ts. Never read process.env at
//    module top-level for secrets; read inside the handler so the boot
//    guards catch missing values. Run 'pnpm verify' in CI."
//
// That is the entire delta between "vibe-coded app that ships" and
// "vibe-coded app that doesn't end up on a breach blog."`;

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

function RiskCard({
  risk,
  framework,
  user,
}: {
  risk: string;
  framework: string;
  user: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{risk}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS blocks
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You still own
        </dt>
        <dd className="text-muted-foreground">{user}</dd>
      </dl>
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
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">Field report</Badge>
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
            Same reader. Different week. This time the link was{" "}
            <a
              href="https://www.aikido.dev/blog/vibe-coding-security"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aikido&apos;s &quot;WTF is Vibe Coding Security&quot;
            </a>{" "}
            and the question was, again, the only one worth asking:{" "}
            <em>so are we doing anything about this?</em>
          </p>

          <p>
            For the unfamiliar: <strong>vibe coding</strong> is when someone,
            often someone who is not a developer, describes what they want in
            English and ships whatever the model writes.{" "}
            <strong>Agentic coding</strong> is the same thing with the model
            also installing the dependencies, running the tests, and pushing the
            PR. The Aikido post lists the usual scary outcomes: SQL injection,
            path traversal, hardcoded secrets, an admin route left mounted on
            the public app (the &quot;Tea app&quot; story), and an AI agent that
            deleted a production database while &quot;lying about unit
            tests&quot; (the Replit / SaaStr story).
          </p>

          <p>
            I read it, opened DaloyJS, and went through each risk to see what we
            already block, what needs one opt-in line, and where we honestly
            can&apos;t help. Below is that mapping. The TL;DR: if a sales rep
            uses Claude to scaffold a DaloyJS app at 1am, the boring stuff, body
            limits, prototype pollution, header splitting, path traversal,
            secret-shaped logs, is on before they type their first prompt. What
            they still have to <em>choose</em> is which routes need auth and
            where the admin surface lives. Those are policy, not defaults.
          </p>

          <h2>Risk 1: SQL injection</h2>

          <RiskCard
            risk="Aikido: 'SQL injections, path traversal, hardcoded secrets.'"
            framework="Standard Schema (Zod / Valibot) validation is a route-level requirement, not an afterthought. The framework has no untyped req.body escape hatch in the public API. /docs/security/sql-injection documents the per-ORM patterns; the scaffolder ships Prisma / Drizzle / TypeORM templates that are parameterized by construction."
            user="Pick a real ORM. Don't write template-string SQL. The framework will not stop you from doing the wrong thing inside your handler, but it will hand you a fully-typed, validated input object so you have no excuse."
          />

          <p>
            DaloyJS doesn&apos;t ship an ORM. That&apos;s deliberate, pinning
            one ORM would be the same kind of opinionation that gets frameworks
            in trouble. What it does ship is a route shape where the input is
            validated <em>before</em> your handler runs:
          </p>

          <CodeBlock language="ts" code={SCHEMA_VALIDATED} />

          <p>And a documented path for the database layer:</p>

          <CodeBlock language="ts" code={NO_RAW_SQL} />

          <p>
            Full guidance:{" "}
            <Link href="/docs/security/sql-injection">
              /docs/security/sql-injection
            </Link>{" "}
            and the per-ORM pages under <Link href="/docs/orm">/docs/orm</Link>.
          </p>

          <h2>Risk 2: Path traversal</h2>

          <RiskCard
            risk="Aikido: '..serving up /etc/passwd to anyone who tries.'"
            framework="The router rejects '..' segments, '//', encoded NULs, and percent-encoded traversal sequences before the route is matched. Returns 400 with no handler invocation."
            user="Constrain :param shapes with a Zod regex anyway. Defense in depth costs you one line."
          />

          <CodeBlock language="ts" code={PATH_TRAVERSAL} />

          <p>
            The full list of what the router refuses to walk into is in{" "}
            <Link href="/docs/security/runtime-protections">
              /docs/security/runtime-protections
            </Link>
            {"."}
          </p>

          <h2>Risk 3: Hardcoded secrets and AI-generated supply-chain rot</h2>

          <RiskCard
            risk="Aikido: 'hardcoded secrets' + the broader agentic-coding worry that an AI agent installs whatever npm package its prompt mentioned."
            framework="Repo-wide CI gates that block leaked credentials, base64-smuggled payloads, invisible-unicode Trojan Source, install-time lifecycle scripts (the #1 npm attack vector), remote exec (curl|sh, eval(fetch())), unpinned GitHub Actions, and unauthorized license categories. A CycloneDX SBOM is generated and signed on every release. @daloyjs/core itself ships with zero runtime dependencies, there is no transitive blast radius."
            user="Run 'pnpm verify' in your project's CI. The create-daloy templates ship the workflow. Don't disable it because a dependency 'needs' a postinstall, that's the attack."
          />

          <CodeBlock language="bash" code={NO_HARDCODED_SECRETS} />

          <p>
            The full reasoning behind each gate is in{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              &quot;Supply-chain hardening for TypeScript libraries&quot;
            </Link>
            {". "}The shorter version: attackers do not need a 0-day if they can
            ship a malicious <code>postinstall</code>
            {", "}and AI agents do not inspect <code>scripts</code> blocks
            before running <code>npm install</code>
            {". "}The gate that says &quot;no lifecycle scripts at all&quot; is
            the one that stops the next <code>chalk-style</code> compromise from
            reaching a vibe-coded project.
          </p>

          <h2>Risk 4, Unlocked admin routes (the &quot;Tea app&quot; story)</h2>

          <RiskCard
            risk="Aikido: 'admin routes left unlocked, exposing user data to anyone who stumbled across the endpoint.'"
            framework="ipRestriction() and basicAuth() are first-class middleware. /docs/security/admin-panels exists specifically to argue that the safest admin route is the one that isn't mounted on the public app at all, and shows the multi-App pattern that makes that easy."
            user="Pick a pattern: separate App on a separate hostname (best), or /admin mounted with ipRestriction + basicAuth (acceptable). The framework refuses to invent a default 'admin' user, there is none, so a forgotten password is not a backdoor."
          />

          <CodeBlock language="ts" code={ADMIN_LOCKED} />

          <p>
            The dedicated page is{" "}
            <Link href="/docs/security/admin-panels">
              /docs/security/admin-panels
            </Link>
            {". "}If the &quot;Tea app&quot; team had read it, they&apos;d have
            shipped an internal-only deploy and the breach would not have
            happened. I am not claiming the framework would have <em>forced</em>{" "}
            them to, policy is policy, but the path of least resistance in
            DaloyJS is the safe one.
          </p>

          <h2>Risk 5: Missing input sanitization</h2>

          <RiskCard
            risk="Aikido: 'input sanitization' is one of the four basics the vibe-coder checklist asks for."
            framework="Standard Schema everywhere (Zod, Valibot, ArkType all supported). Body, query, params, and headers are all validated against a declared schema. Unknown fields are stripped, the wrong type 400s before the handler runs, and the validated value is the only thing visible to the handler."
            user="Write the schema. The framework will hold the line."
          />

          <p>
            This is the same pattern as Risk 1, applied to <em>every</em> input
            surface, not just bodies. The router itself is the sanitization
            layer, there is no &quot;remember to call zod.parse&quot;
            convention. If a route omits a body schema and declares a body
            content type, the build complains. If the body schema rejects, the
            handler never runs.
          </p>

          <h2>
            Risk 6, Agentic coding doing things the prompt didn&apos;t ask for
          </h2>

          <RiskCard
            risk="Aikido / Replit story: 'the AI started lying about unit tests, ignored code freezes, and eventually deleted the entire SaaStr production database.'"
            framework="fetchGuard(), explicit egress allow-list, default-deny on cloud metadata and RFC1918. requestTimeoutMs + bodyLimitBytes, bounded resource use. Per-request structured logs with correlated request IDs go to your SIEM, so 'the AI agent did what?!' becomes a query, not an archeology dig. The scaffolder ships an AGENTS.md and a daloyjs-best-practices SKILL.md so the agent reads the rules before it writes code."
            user="Don't give the production-DB password to the agent. Run agentic tools against a sandbox account. Treat AI commits like junior-dev commits, review them. The framework cannot stop you from handing your prod credentials to a model."
          />

          <CodeBlock language="ts" code={SSRF_GUARD} />

          <p>
            The &quot;agent reads the rules before it writes code&quot; piece is
            covered in{" "}
            <Link href="/blog/designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills">
              &quot;Designing for Coding Agents&quot;
            </Link>
            {". "}The point of scaffolding AGENTS.md is exactly the
            &quot;PromptBOM&quot; idea the Aikido post pitches at the end, give
            the agent provenance and rules <em>before</em> it generates, not
            after.
          </p>

          <h2>The assume-the-vibe-coder-skipped-it defaults</h2>

          <p>
            The article&apos;s most useful line: &quot;Treat AI code like a
            junior developer wrote it.&quot; Translated into framework defaults,
            that means the dangerous things have to be off when nobody
            remembered to turn them off. That&apos;s the constructor:
          </p>

          <CodeBlock language="ts" code={ASSUME_VIBE} />

          <h2>What we honestly do not do</h2>

          <ul>
            <li>
              We do not stop you from <code>rm -rf</code> your production
              database from inside a handler. If you give the agent
              <code>DATABASE_URL</code> with destructive privileges, the
              framework cannot save you. Use a read-replica for the agent. Use
              least-privilege DB roles.
            </li>
            <li>
              We do not scan the AI-generated code for logic flaws, the article
              is right that scanners catch known patterns and miss business
              logic. We give you the structured surface (typed routes, typed
              client, OpenAPI) so a reviewer or a SAST tool has something to
              bite into.
            </li>
            <li>
              We do not enforce authentication on every route. We can&apos;t,
              some routes are deliberately public. What we give you is{" "}
              <code>jwt()</code>
              {", "}<code>basicAuth()</code>
              {", "}
              <code>bearerAuth()</code>
              {", "}<code>session()</code>
              {", "}and an{" "}
              <Link href="/docs/security/auth-slice">auth-slice pattern</Link>{" "}
              so the choice is visible per route.
            </li>
            <li>
              We do not provide an AI moderation layer or a runtime
              intrusion-detection system. Daloy gives you the structured event
              stream a detector needs; the detector itself is your call.
            </li>
          </ul>

          <h2>The vibe-coder prompt that produces a defensible app</h2>

          <CodeBlock language="ts" code={VIBE_CODER_CHECKLIST} />

          <p>
            That paragraph plus <code>pnpm create daloy@latest</code> is the
            entire setup. The scaffolded project ships with the verify gates
            wired into CI, the AGENTS.md the model needs, the security docs
            linked from the README, and the secure-by-default constructor. The
            sales rep at 1am has to actively work to disable any of it.
          </p>

          <h2>The honest answer to the original question</h2>

          <p>
            <em>Are we doing anything about vibe coding security?</em> Yes, the
            framework was designed assuming the person writing the handler
            either doesn&apos;t know or doesn&apos;t care about the security
            layer, and the defaults reflect that. The Aikido post&apos;s
            shopping list of risks maps almost one-for-one to a primitive that
            already exists in DaloyJS today. The few items that don&apos;t map
            are the ones no framework can own, pick an IdP, lock down the DB
            role, don&apos;t hand the prod creds to the agent, review the
            commits.
          </p>

          <p>
            The vibes can stay good. Just point them at a framework that
            won&apos;t let them ship the obvious mistakes.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/cloud-security-architecture-mapped-to-daloyjs">
              Cloud Security Architecture, Mapped
            </Link>
            {", "}<Link href="/blog/secure-by-default">Secure by Default</Link>
            {", "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              Supply-chain hardening for TypeScript libraries
            </Link>
            {", "}
            <Link href="/blog/designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills">
              Designing for Coding Agents
            </Link>
            {", "}
            <Link href="/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds">
              Scaffolding a production-ready DaloyJS app in 60 seconds
            </Link>
            {". "}Relevant docs:{" "}
            <Link href="/docs/security">/docs/security</Link>
            {", "}
            <Link href="/docs/security/admin-panels">admin panels</Link>
            {", "}
            <Link href="/docs/security/sql-injection">SQL injection</Link>
            {", "}
            <Link href="/docs/security/fetch-guard">fetch guard</Link>
            {", "}
            <Link href="/docs/security/runtime-protections">
              runtime protections
            </Link>
            {", "}<Link href="/docs/security/supply-chain">supply chain</Link>.
          </p>
        </div>
      </article>
    </main>
  );
}
