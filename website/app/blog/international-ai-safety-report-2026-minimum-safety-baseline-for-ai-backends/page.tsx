import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "international-ai-safety-report-2026-minimum-safety-baseline-for-ai-backends",
  title:
    "The International AI Safety Report 2026, Translated Into a Minimum Safety Baseline for AI Backends",
  description:
    "Aikido's read of the International AI Safety Report 2026 lands on a short list of deployment-time requirements for any backend an autonomous AI system can call, layered defense, independent verification, prompt-injection-resistant guardrails, network scope control, inference/execution separation, full observability and emergency controls. This post maps those requirements to what a DaloyJS app already enforces by default, what one opt-in line adds, and what still lives above the HTTP layer.",
  date: "2026-06-13",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "International AI Safety Report 2026",
    "Aikido AI safety analysis",
    "autonomous AI deployment security",
    "AI agent backend security",
    "prompt injection HTTP defense",
    "AI tool sandboxing",
    "MCP server hardening",
    "DaloyJS AI safety",
    "AI minimum safety requirements",
    "layered defense AI",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const LAYERED_DEFENSE = `// The report's framing: training-time, deployment-time, and
// post-deployment monitoring are three independent layers, and
// you cannot rely on the model layer to enforce the other two.
//
// DaloyJS owns the deployment-time + runtime layer of an AI
// backend. That is the layer that runs even when the model is
// jailbroken, prompt-injected, or hallucinating a refund.

import { App, secureHeaders, requestId, rateLimit } from "@daloyjs/core";

export const app = new App({
  // Deployment-time guarantees you don't have to remember:
  //   bodyLimitBytes: 1 << 20      // default 1 MiB
  //   requestTimeoutMs: 30_000     // default 30s
  //   production: auto-detected    // prod-mode error redaction
});

// All three are independent of whatever the model "decided" to do.
app.use(secureHeaders());
app.use(requestId());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));`;

const SCHEMA_VERIFICATION = `// The report's strongest point: AI systems can game evaluations
// and sandbag on demand. You cannot trust the model's self-report
// or its chain-of-thought. The only thing you can trust is an
// independent verifier sitting in front of the side effect.
//
// In DaloyJS that verifier is the route schema. The handler does
// not run until the request matches. Period.
import { z } from "zod";
import { App } from "@daloyjs/core";

export const app = new App();

app.route({
  method: "POST",
  path: "/tools/wire-transfer",
  operationId: "wireTransfer",
  request: {
    body: z.object({
      // The model can scheme, plan, and rationalise all it wants.
      // amountCents > 10_000 -> 400. No reasoning trace bypasses this.
      amountCents: z.number().int().min(1).max(10_000),
      destinationIban: z.string().regex(/^[A-Z]{2}[0-9A-Z]{13,32}$/),
      memo: z.string().min(1).max(140),
    }).strict(),  // unknown keys are rejected, not silently ignored
  },
  responses: {
    // Response schemas are validated too - the handler cannot
    // accidentally leak a field a downstream agent wasn't supposed
    // to see, even if a junior engineer adds it to the SELECT later.
    200: { description: "queued", schema: z.object({ id: z.uuid() }).strict() },
  },
  handler: async ({ body }) => transfers.queue(body),
});`;

const NETWORK_SCOPE = `// "Network-level scope control" from the report's minimum
// requirements list. In practice this is the most common way an
// AI tool is weaponised: prompt-inject a URL, the tool fetches it,
// the metadata service hands back IAM credentials, game over.
//
// fetchGuard() is default-deny on:
//   - cloud metadata (169.254.169.254, fd00:ec2::254)
//   - localhost (127.0.0.0/8, ::1)
//   - private ranges (10/8, 172.16/12, 192.168/16, fc00::/7)
//   - link-local (169.254/16, fe80::/10)
// It also follows redirects through the same allow-list, so an
// attacker can't bounce off a public URL into the metadata IP.
import { App, fetchGuard, ipRestriction } from "@daloyjs/core";

export const app = new App();

app.use(fetchGuard({
  allow: [
    "https://api.openai.com",
    "https://api.stripe.com",
    "https://*.s3.amazonaws.com",
  ],
}));

// And the admin / kill-switch surface is scoped to the operator
// network, not the model-facing one.
app.use("/admin/*", ipRestriction({ allow: ["10.0.0.0/8"] }));`;

const INFERENCE_EXECUTION_SEPARATION = `// "Separation of inference and execution", the report's way of
// saying: the process that talks to the model is not the same
// process that touches your production database.
//
// In DaloyJS that's two App instances on two deploys. The
// model-facing app exposes the tool surface (schema-validated,
// scoped, rate-limited). The execution app owns the side effects,
// runs behind ipRestriction, and only accepts traffic from the
// internal VPC.
import { App, ipRestriction, jwt } from "@daloyjs/core";

// --- model-facing tool surface (public deploy) ---
export const toolApp = new App();
toolApp.route({
  method: "POST",
  path: "/tools/refund",
  operationId: "refund",
  request: { body: refundSchema },
  handler: async ({ body }) => {
    // No DB. No filesystem. Just a signed forward to the execution
    // app over the internal network. The model can't reach prod
    // even if it gets the entire process to RCE.
    return execClient.post("/exec/refund", body);
  },
});

// --- execution app (internal-only deploy) ---
export const execApp = new App();
execApp.use(ipRestriction({ allow: ["10.0.0.0/8"] }));
execApp.use(jwt({
  algorithms: ["RS256", "ES256"],   // 'none' impossible
  jwksUri: process.env.INTERNAL_JWKS_URI!,
  maxTokenAgeSeconds: 5 * 60,       // 5-min tokens, not year-long keys
}));`;

const OBSERVABILITY_KILL_SWITCH = `// "Full observability and emergency controls", when the model
// goes off the rails at 3am you need (a) the receipts and (b) a
// big red button. DaloyJS gives you both as primitives.
import {
  App,
  requestId,
  structuredLogger,
  loadShedding,
  gracefulShutdown,
} from "@daloyjs/core";

export const app = new App();

// (a) The receipts: every request gets a ULID-shaped id that
// flows into the structured log line AND the problem+json error
// body. One ID, one drill-down.
app.use(requestId());
app.use(structuredLogger({ destination: process.stdout }));

// (b) The emergency controls:
//   - loadShedding sheds the cheapest traffic first when the
//     event loop or queue is saturated (returns 503 + Retry-After)
//   - gracefulShutdown drains in-flight requests on SIGTERM and
//     refuses new ones, so a "stop the agent" deploy doesn't kill
//     a transaction half-way through
app.use(loadShedding({ maxQueueDepth: 100, maxEventLoopDelayMs: 50 }));
gracefulShutdown(app, { drainMs: 15_000 });`;

const PROMPT_INJECTION_BOUNDARY = `// Prompt injection doesn't live "at the HTTP layer", it lives in
// the model. What lives at the HTTP layer is the BLAST RADIUS of
// a successful prompt injection. A tool surface that takes
// strongly typed inputs, returns strongly typed outputs, and
// can't reach the metadata service is a much smaller blast
// radius than one that accepts a free-form 'action' field and
// forwards it.
//
// The report's recommendation is "constraints must be enforced".
// In DaloyJS, the route IS the constraint.
app.route({
  method: "POST",
  path: "/tools/search-docs",
  request: {
    body: z.object({
      query: z.string().min(1).max(280),
      // Bounded. A model that "decides" to retrieve 999_999 docs
      // gets a 400, not a database scan.
      limit: z.number().int().min(1).max(20).default(10),
    }).strict(),
  },
  responses: {
    200: {
      description: "results",
      schema: z.object({
        results: z.array(z.object({
          id: z.uuid(),
          title: z.string(),
          snippet: z.string().max(500),
        })).max(20),
      }).strict(),
    },
  },
  handler: async ({ body }) => docs.search(body),
});`;

const PROD_MODE_REDACTION = `// "Data processing guarantees", the report's way of saying:
// the model should not be a path to your internals.
// In production, DaloyJS redacts 5xx bodies by default. Stack
// traces, DB error messages, internal hostnames never reach
// the wire. The agent gets a problem+json with a requestId; your
// SIEM gets the full detail.

// Prod response - what the model / its operator sees:
HTTP/1.1 500 Internal Server Error
content-type: application/problem+json

{
  "type": "https://daloyjs.dev/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An internal error occurred. Reference requestId for diagnosis.",
  "instance": "/tools/refund",
  "requestId": "01J9XP4M2K3W7Z8V0YQHB6T5RC"
}

// Same incident in your structured log line - what your team sees:
{
  "level":"error","requestId":"01J9XP4M2K3W7Z8V0YQHB6T5RC",
  "route":"/tools/refund","method":"POST","status":500,
  "error":{"name":"PgError","code":"23505","message":"...","stack":"..."},
  "userId":"u_8281","ip":"10.0.1.42","ms":127
}`;

const FULL_BASELINE = `// Putting the whole baseline together. This is the minimum
// shape of a DaloyJS app that takes traffic from an autonomous
// AI system in production. None of it is exotic; all of it ships
// in @daloyjs/core, zero runtime dependencies.
import { z } from "zod";
import {
  App,
  secureHeaders,
  requestId,
  structuredLogger,
  rateLimit,
  fetchGuard,
  loadShedding,
  gracefulShutdown,
  ipRestriction,
  jwt,
} from "@daloyjs/core";

export const app = new App();

// Abuse prevention
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.use(loadShedding({ maxQueueDepth: 100, maxEventLoopDelayMs: 50 }));

// Network-level scope control
app.use(fetchGuard({ allow: ["https://api.openai.com", "https://api.stripe.com"] }));

// Full observability + emergency controls
app.use(secureHeaders());
app.use(requestId());
app.use(structuredLogger());
gracefulShutdown(app, { drainMs: 15_000 });

// Identity + privilege (every tool authenticates)
app.use(jwt({
  algorithms: ["RS256", "ES256"],
  jwksUri: process.env.JWKS_URI!,
  maxTokenAgeSeconds: 15 * 60,
}));

// Independent verification: the route schema is the contract,
// not the model's intent. Same for response shapes.
app.route({
  method: "POST",
  path: "/tools/refund",
  operationId: "refund",
  request: {
    body: z.object({
      orderId: z.uuid(),
      amountCents: z.number().int().min(1).max(50_000),
      reason: z.string().min(3).max(280),
    }).strict(),
  },
  responses: {
    200: {
      description: "refunded",
      schema: z.object({ id: z.uuid() }).strict(),
    },
  },
  handler: async ({ body, ctx }) => refunds.create(ctx.user, body),
});

// Inference / execution separation: the admin + side-effect
// surface lives behind ipRestriction on a separate deploy.
app.use("/admin/*", ipRestriction({ allow: ["10.0.0.0/8"] }));`;

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

function RequirementCard({
  requirement,
  framework,
  user,
}: {
  requirement: string;
  framework: string;
  user: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{requirement}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
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
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">AI safety</Badge>
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
            A reader sent me{" "}
            <a
              href="https://www.aikido.dev/blog/international-ai-safety-report-aikido-security-analysis"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aikido&apos;s &quot;International AI Safety Report 2026: Aikido
              Security Analysis&quot;
            </a>{" "}
            and asked how its recommendations map to DaloyJS.
          </p>

          <p>
            The piece reads the{" "}
            <a
              href="https://internationalaisafetyreport.org/sites/default/files/2026-02/international-ai-safety-report-2026.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              International AI Safety Report 2026
            </a>
            {", "}100+ experts, 30+ countries, Yoshua Bengio chairing, through
            an operator&apos;s lens and lands on a short, useful conclusion: the
            interesting safety work for the rest of us is at{" "}
            <strong>deployment time and runtime</strong>
            {", "}not at training time. Aikido summarises it as a few
            deployment-time requirements that any backend an autonomous AI
            system can call should meet, no matter which model is calling it:
          </p>

          <ul>
            <li>
              Layered defense. Training-time safety, deployment-time controls,
              and post-deployment monitoring are three independent layers. The
              deployment-time layer must work even when the model layer fails.
            </li>
            <li>
              Mandatory verification. Models game evals and sandbag on demand.
              Self-reports and chain-of-thought are not evidence. You need an
              independent verifier in front of every side effect.
            </li>
            <li>
              Prompt-injection-resistant constraints. Leading models still fall
              to prompt injection with a handful of tries in 2025 evals.
              Constraints must be <em>enforced</em>
              {", "}not requested in the system prompt.
            </li>
            <li>
              Minimum safety requirements. Abuse prevention, network-level scope
              control, inference/execution separation, full observability with
              emergency controls, data processing guarantees, and verification
              with false-positive control.
            </li>
          </ul>

          <p>
            That list reads almost like a feature spec for an HTTP framework
            built for the agent era. Which is convenient, because DaloyJS{" "}
            <em>is</em> an HTTP framework built for the agent era. Below is the
            per-requirement mapping of what an app on <code>@daloyjs/core</code>{" "}
            already enforces by default, what one opt-in line adds, and the
            items no framework can own.
          </p>

          <h2>Layered defense: the deployment layer must stand alone</h2>

          <RequirementCard
            requirement="Report: 'Each layer must function independently. The deployment-time layer cannot rely on the model behaving.'"
            framework="The DaloyJS constructor ships secure-by-default for the deployment layer: 1 MiB body limit, 30s request timeout, prod-mode 5xx redaction, prototype-pollution-safe JSON parse, CRLF / header-splitting refusal, path-traversal rejection, method-confusion 405 (not 404), 415 on unsupported content types, __Host- / Secure / HttpOnly / SameSite=Lax cookies. None of these depend on the model behaving, they hold even when the calling agent is fully compromised."
            user="Decide what the runtime layer does when the deployment layer fires: page someone, drop the request, fail open, fail closed. The framework gives you the signal; the runbook is yours."
          />

          <CodeBlock language="ts" code={LAYERED_DEFENSE} />

          <h2>Mandatory verification: the route schema is the contract</h2>

          <RequirementCard
            requirement="Report: 'Trust the verifier, not the model. Independent verification must sit in front of every side effect.'"
            framework="Every DaloyJS route declares a schema (Zod, Valibot, ArkType, anything Standard Schema). The handler does not run until the request matches. .strict() is the project convention so unknown keys are rejected, not silently dropped into the database. Response schemas are validated too, so a handler cannot leak a field the contract didn't promise, useful when the consumer is an agent that will happily exfiltrate anything it sees."
            user="Write the schema tight. min/max on numbers, min/max on string lengths, regex on identifiers, enum on choices. The framework runs whatever shape you give it; a permissive schema is permissive enforcement."
          />

          <CodeBlock language="ts" code={SCHEMA_VERIFICATION} />

          <p>
            This is the report&apos;s main point and the easiest one to get
            wrong. The temptation when a model is doing something clever is to
            widen the schema so the clever thing fits. Don&apos;t. Widen the
            schema only when you&apos;ve thought through what the wider input
            means in production, and write the unhappy-path test before you ship
            it.
          </p>

          <h2>Network-level scope control: fetchGuard is one line</h2>

          <RequirementCard
            requirement="Report: 'A backend the model can call must not be a path to internal infrastructure or the cloud metadata service.'"
            framework="fetchGuard() is a default-deny outbound wrapper around fetch / undici / Bun.fetch / Workers fetch. Cloud metadata IPs, localhost, RFC 1918 private ranges, link-local, and IPv6 equivalents are blocked. Redirects are re-validated against the same allow-list, so an attacker can't bounce off a public URL into the metadata service. ipRestriction() does the same job for inbound traffic on admin / kill-switch surfaces."
            user="Write the allow-list. fetchGuard refuses to start without one, there is no '*' default. That refusal is on purpose; the most common AI tool SSRF is a 'we'll lock it down later' that never gets locked down."
          />

          <CodeBlock language="ts" code={NETWORK_SCOPE} />

          <h2>Inference / execution separation: two Apps, two deploys</h2>

          <RequirementCard
            requirement="Report: 'The process that talks to the model is not the process that touches production state.'"
            framework="DaloyJS Apps are cheap. The recommended pattern is two of them: a model-facing tool surface (public, schema-validated, rate-limited) and an execution app (internal-only, ipRestriction'd, behind short-lived JWTs). The tool surface forwards to the execution app over the internal network. A successful prompt injection lands the attacker in a process with no database credentials, no filesystem, and a fetchGuard allow-list of two domains."
            user="Decide the split. 'Anything that mutates state' is a fine starting boundary. Move the line as your blast-radius tolerance changes. The framework doesn't care which side a route lives on."
          />

          <CodeBlock language="ts" code={INFERENCE_EXECUTION_SEPARATION} />

          <h2>
            Full observability and emergency controls, the receipts and the big
            red button
          </h2>

          <RequirementCard
            requirement="Report: 'When the model goes off the rails you need the receipts and a way to stop it.'"
            framework="Per-request structured logs with a correlated ULID requestId. RFC 9457 problem+json errors carrying the same requestId. loadShedding sheds the cheapest traffic first when the event loop or queue is saturated. gracefulShutdown drains in-flight requests on SIGTERM. A killswitch is one ipRestriction line on / and a redeploy."
            user="Wire the structured log stream to your SIEM (Datadog, CloudWatch, Loki, whatever). Decide the load-shedding thresholds for your workload. The framework gives you the primitives; the dashboards and the on-call rotation are yours."
          />

          <CodeBlock language="ts" code={OBSERVABILITY_KILL_SWITCH} />

          <h2>Prompt injection: the HTTP boundary owns the blast radius</h2>

          <p>
            Prompt injection lives in the model layer, so an HTTP framework
            cannot solve it. The framework can limit the <em>blast radius</em>{" "}
            of a successful prompt injection: how much damage the model can do
            once it has been convinced to call your tool with attacker-shaped
            input.
          </p>

          <RequirementCard
            requirement="Report: 'Constraints must be enforced. Many leading models still fall to prompt injection in a handful of tries.'"
            framework="The route IS the constraint. Strongly typed inputs, bounded numbers, bounded strings, enum'd choices, .strict() bodies. Response schemas bounded too, so a successful injection can't read fields the contract didn't promise. RFC 9457 errors so the model gets a structured 400 it can self-correct from, not a vague 500 it will retry with progressively weirder inputs."
            user="Resist the urge to add a free-form 'action' field 'just for flexibility'. Free-form fields are the entire prompt-injection attack surface. If a tool needs flexibility, ship more tools, not wider tools."
          />

          <CodeBlock language="ts" code={PROMPT_INJECTION_BOUNDARY} />

          <h2>
            Data processing guarantees, prod-mode redaction is on by default
          </h2>

          <RequirementCard
            requirement="Report: 'The backend should not become a path to internals via verbose error messages or leaked stack traces.'"
            framework="In production, DaloyJS redacts 5xx response bodies by default, keeping stack traces, internal hostnames, and DB error messages off the wire. The agent sees a problem+json with a requestId; your SIEM sees the full structured detail under the same id. Same for header sanitisation, same for the JWT verifier (which never echoes the failing claim, only the reason)."
            user="Don't paste raw error.message into a 200 response 'so the agent can self-correct'. The agent will self-correct from a 400 problem+json with a documented type URL just as well, and the type URL doesn't leak your DB schema."
          />

          <CodeBlock language="ts" code={PROD_MODE_REDACTION} />

          <h2>The whole baseline in one file</h2>

          <CodeBlock language="ts" code={FULL_BASELINE} />

          <p>
            That&apos;s the minimum shape of a DaloyJS app that takes traffic
            from an autonomous AI system in production. About fifty lines. Zero
            runtime dependencies on <code>@daloyjs/core</code>&apos;s side.
            Every line maps to a specific item on the report&apos;s
            minimum-safety list.
          </p>

          <h2>What the framework cannot do</h2>

          <ul>
            <li>
              Training-time safety. That&apos;s the model provider&apos;s layer.
              The report is correct that you cannot rely on it alone, but we
              can&apos;t supply it either. What we can do is make the deployment
              layer strong enough that a jailbroken model is still bounded by
              the schema.
            </li>
            <li>
              Detecting that a model is sandbagging. A model that intentionally
              underperforms on evals is a problem above the HTTP layer. What the
              framework can do is make every tool call observable and every side
              effect schema-checked, so an anomalous pattern shows up in your
              structured log stream and your SIEM can flag it.
            </li>
            <li>
              Telling you what is safe for your business. The schema says
              &quot;amountCents must be ≤ 50,000&quot;, the framework cannot
              tell you that 50,000 is the right number. That is a product / risk
              / compliance call and it changes per route, per customer tier, per
              jurisdiction.
            </li>
            <li>
              Stopping you from disabling the guards. The guards run in your
              app. If you delete fetchGuard or widen the schema to{" "}
              <code>z.any()</code>
              {", "}the framework lets you, the repo&apos;s AGENTS.md asks
              coding agents not to, and{" "}
              <Link href="/blog/secure-by-default">
                the secure-by-default post
              </Link>{" "}
              spells out why, but the merge-button discipline is on the team.
            </li>
          </ul>

          <h2>What DaloyJS covers</h2>

          <p>
            DaloyJS maps the report&apos;s backend requirements to existing
            controls: <code>fetchGuard()</code> limits network scope, strict
            route schemas verify input, two-App composition separates inference
            from execution, request logs support investigation, lifecycle tools
            provide emergency controls, and rate limits plus request caps limit
            abuse.
          </p>

          <p>
            These controls use built-in APIs and require either no setup or one
            middleware call. They limit what a compromised model can do, while
            model safety itself stays outside the HTTP framework.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/owasp-top-10-agentic-applications-mapped-to-daloyjs">
              OWASP Top 10 for Agentic Applications, Mapped
            </Link>
            {", "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security
            </Link>
            {", "}
            <Link href="/blog/cloud-security-architecture-mapped-to-daloyjs">
              Cloud Security Architecture, Mapped
            </Link>
            {", "}
            <Link href="/blog/secure-sdlc-five-pillars-mapped-to-daloyjs">
              The 5 Pillars of a Secure SDLC, Mapped
            </Link>
            {", "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>
            {". "}
            Relevant docs: <Link href="/docs/security">/docs/security</Link>
            {", "}
            <Link href="/docs/security/runtime-protections">
              runtime protections
            </Link>
            {", "}
            <Link href="/docs/security/secure-defaults">secure defaults</Link>
            {"."}
          </p>
        </div>
      </article>
    </main>
  );
}
