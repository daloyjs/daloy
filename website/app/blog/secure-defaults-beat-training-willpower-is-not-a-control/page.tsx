import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "secure-defaults-beat-training-willpower-is-not-a-control",
  title:
    "Willpower Is Not a Security Control: Secure Defaults Beat Training, and AI Does Not Fix That",
  description:
    "Tanya Janca's DevSecStation episode on secure defaults matches why I built DaloyJS the way I did: security on by default, insecure paths explicit and effortful. Login with JWT is not enough, and telling an AI to build an API does not make the easy path safe.",
  date: "2026-08-02",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "secure defaults",
    "DevSecStation Tanya Janca",
    "SheHacksPurple",
    "willpower is not a security control",
    "secure by default backend",
    "AI generated API security",
    "JWT is not authorization",
    "DaloyJS secureDefaults",
    "explicit opt out security",
    "developer security training",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const EXPRESS_COPY_PASTE = `// A very normal Monday. New service. Copy the last one.
// Training said "validate input" and "don't leave CORS open."
// The ticket said "ship by EOD." Guess which voice wins.
import express from "express";

const app = express();
app.use(express.json()); // unlimited body by default
app.use(cors({ origin: "*" })); // works in the demo
app.post("/users/:id/plan", async (req, res) => {
  // Auth middleware somewhere. Token is valid. Ship it.
  const updated = await db.user.update({
    where: { id: req.params.id },
    data: req.body, // mass assignment says hi
  });
  res.json(updated); // passwordHash comes free
});

// Nobody "ignored security." They followed the path that was already there.`;

const DALOY_DEFAULT_PATH = `// Same feature, but the path of least resistance is the guarded one.
// Progressive shorthand: app.post(path, contract, handler).
// Unknown keys die with 400. Response fields you did not declare cannot leave.
// Handlers return { status, body }; response contracts use body:, not schema:.
import { z } from "zod";
import { App, jwk, rateLimit } from "@daloyjs/core";

// secureHeaders, body limit, request timeout, cross-origin write guard,
// prod error redaction: already on. You did not remember them. Good.
export const app = new App()
  .use(rateLimit({ windowMs: 60_000, max: 60 }))
  .use(
    jwk({
      algorithms: ["EdDSA", "ES256"],
      jwks: process.env.JWKS_URL!,
      issuer: "https://auth.example.com/",
      audience: "billing-api",
    }),
  )
  .post(
    "/users/:id/plan",
    {
      operationId: "updateUserPlan",
      request: {
        params: z.object({ id: z.uuid() }).strict(),
        body: z
          .object({
            plan: z.enum(["free", "pro", "team"]),
            seatCount: z.number().int().min(1).max(500),
          })
          .strict(),
      },
      responses: {
        200: {
          description: "updated",
          body: z
            .object({
              id: z.uuid(),
              plan: z.enum(["free", "pro", "team"]),
              seatCount: z.number().int(),
            })
            .strict(),
        },
      },
    },
    async ({ params, body, state }) => {
      // Auth passed. That only means "who." Resource checks still live here
      // or in the repository. A valid JWT is not a free pass to every row.
      const updated = await billing.setPlanForCaller(state.user, params.id, body);
      return { status: 200 as const, body: updated };
    },
  );`;

const EXPLICIT_OPT_OUT = `// Accidental insecure should be hard.
// secureDefaults: false in production refuses to construct
// unless you also pass acknowledgeInsecureDefaults: true.
// That second flag is the "I am doing this on purpose" signature.

import { App } from "@daloyjs/core";

// Migration escape hatch: loud at boot, logged, effortful on purpose.
export const app = new App({
  secureDefaults: false,
  acknowledgeInsecureDefaults: true, // required in production
});

// Prefer a narrow opt-out when you only need one door open:
export const app2 = new App({
  secureHeaders: false, // CDN injects its own headers
  // everything else stays on
});

// MCP tools are public only when you say so at the call site.
// mcpRoutes("/mcp", handler, { public: true }) is deliberate.`;

const AI_PROMPT_ILLUSION = `// What people type into a coding agent:
//   "Build a REST API with JWT auth for a todo app."
//
// What they usually get:
//   - login endpoint that issues a token
//   - middleware that checks the signature
//   - handlers that trust req.body and req.params.id
//   - CORS wide open so the SPA "just works"
//   - no response schema, no body limit, no rate limit
//
// The demo passes. The board sees a login screen.
// Alice still reads Bob's todos by changing the id.
// Training called that IDOR. The agent called it done.`;

const FLIP_ONE_DEFAULT = `# Tanya's "one thing" exercise, applied to a backend repo.
# Pick one. Flip it. Leave a comment so future-you does not undo it.

# 1) CI that always runs security-ish gates
pnpm typecheck && pnpm test
pnpm verify:no-lifecycle-scripts
pnpm verify:known-dep-names
pnpm verify:lockfile

# 2) Template that starts with validation and auth hooks, not a bare router

# 3) Config that does not ship with origin: "*" "for now"

# 4) Scripts that refuse plaintext secrets in env files committed to git`;

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
            <Badge variant="outline">Opinion</Badge>
            <Badge variant="outline">Field note</Badge>
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
            I listened to{" "}
            <a
              href="https://www.devsecstation.com/2602204/episodes/19503769-secure-defaults-beat-secure-training"
              target="_blank"
              rel="noopener noreferrer"
            >
              Secure Defaults Beat Secure Training
            </a>{" "}
            on Tanya Janca&apos;s{" "}
            <a
              href="https://www.devsecstation.com/2602204"
              target="_blank"
              rel="noopener noreferrer"
            >
              DevSecStation
            </a>{" "}
            podcast (SheHacksPurple, Season 1 Episode 8) and got that mix of
            relief and irritation. Relief that someone said the quiet part out
            loud. Irritation that I have been living the same story for twelve
            years and still watch teams answer it with another slide deck.
          </p>

          <p>
            Her sticky-note line:{" "}
            <strong>the easiest path is often the insecure one</strong>.
            Developers usually care. They are also busy. Training leans on
            memory and willpower. Defaults shape what people do when nobody is
            watching. In live systems, defaults win.
          </p>

          <p>
            That is why DaloyJS looks the way it does. Security starts on.
            Turning pieces off is explicit, sometimes two flags, and often loud
            at boot. Annual training is still useful. Tanya teaches it for a
            living, and she is careful about that: training helps when it
            explains the why. Alone, under deadline pressure, it loses to
            copy-paste.
          </p>

          <div className="not-prose my-8 rounded-xl border border-primary/30 bg-primary/[0.04] p-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Disclosure:</strong> I help
              build{" "}
              <a
                href="https://daloyjs.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                DaloyJS
              </a>
              , a contract-first TypeScript backend framework with secure
              defaults and zero runtime dependencies. This post is a reaction to
              Tanya&apos;s episode and a design note for why the framework
              behaves this way. Steal the idea even if you never install the
              package.
            </p>
          </div>

          <h2>A normal developer day</h2>

          <p>
            Tanya&apos;s story is painfully ordinary. You are juggling tickets.
            You spin up a service. You copy config from the last repo. You leave
            the settings because they work. Nothing feels wrong. You did not
            skip security training on purpose. You followed the path that was
            already paved.
          </p>

          <p>
            Insecure defaults almost never feel like a decision. They feel like
            progress. I have shipped that shape more times than I want to admit,
            usually in Express or a thin wrapper around it, usually with a valid
            JWT middleware and a board demo that looked fine:
          </p>

          <CodeBlock language="ts" code={EXPRESS_COPY_PASTE} />

          <p>
            The annual training PDF said all the right things. The path of least
            resistance said ship. Willpower is a terrible control when the build
            is green and the product manager is in the doorway.
          </p>

          <h2>Login is not a security program</h2>

          <p>
            A lot of teams treat &quot;we have JWT auth&quot; as the finish
            line. Authentication tells you who called. It still leaves open
            whether that caller may touch this row, write these fields, or see
            that hash. I wrote a longer post on that gap (
            <Link href="/blog/your-jwt-is-valid-and-your-api-is-still-vulnerable">
              Your JWT Is Valid and Your API Is Still Vulnerable
            </Link>
            ). Alice&apos;s token is valid, Bob&apos;s id is in the URL, and the
            handler still returns Bob&apos;s data.
          </p>

          <p>
            That bug survives training because every tutorial shows the same
            shape: verify the token, then <code>findById(params.id)</code>.
            Scoping the query to the principal, validating the body, and
            clamping the response stays extra work unless the framework and the
            template make that the default motion of writing a route.
          </p>

          <h2>AI multiplies whatever path you leave open</h2>

          <p>
            People assume a coding agent will remember the OWASP list better
            than a tired human. Sometimes it recites the list. Then it still
            generates the same handler the training data saw a million times:
          </p>

          <CodeBlock language="ts" code={AI_PROMPT_ILLUSION} />

          <p>
            Telling an AI to &quot;build a secure API&quot; is still training,
            only with a shorter attention span. The model optimizes for the demo
            that compiles. If your framework and scaffold treat unbounded
            bodies, open CORS, mass assignment, and missing response schemas as
            normal, the agent will reproduce normal. I covered what DaloyJS
            already blocks in a vibe-coding workflow in{" "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security
            </Link>
            . The design lesson is simpler:{" "}
            <strong>
              AI multiplies whatever default path you leave in the repo
            </strong>
            . It does not install judgment for free.
          </p>

          <h2>Training for the why, defaults for Friday at 5</h2>

          <p>
            Tanya ranks the approaches the same way I have seen them fail in
            production. Annual training alone (slides, quizzes, forgotten by the
            next sprint) barely moves anything. Training plus &quot;please
            remember&quot; helps a little and still depends on willpower. The
            combination that works is training that explains the why, plus
            defaults that make the secure option automatic, so people know why
            they should not rip the guard out and the system does not need them
            to be heroes at 5 p.m. on a Friday.
          </p>

          <p>
            You can keep tools usable. You just pave the road people will take
            under pressure, and make that road the safe one.
          </p>

          <h2>What defaults look like in a backend framework</h2>

          <p>
            When I say DaloyJS is secure by default, I mean the boring stuff is
            armed when you write <code>new App()</code>: body size limits,
            request timeouts, prototype-pollution-safe JSON parsing, secure
            response headers, cross-origin write protection unless you register{" "}
            <code>cors()</code>, production error redaction, and boot guards for
            footguns like weak secrets, unauthenticated MCP routes without an
            explicit public flag, or session without CSRF on state changes. The
            full tour lives in{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link> and{" "}
            <Link href="/docs/security/secure-defaults">the docs</Link>.
          </p>

          <p>
            The route shape does the same job. The contract is the gate before
            the handler. You do not wait for a reviewer to catch a missing
            comment:
          </p>

          <CodeBlock language="ts" code={DALOY_DEFAULT_PATH} />

          <p>
            On the third coffee you still do not need to remember unknown body
            keys, leaking extra response fields, unlimited payloads, or silent
            missing headers. An AI can still write a bad repository query.
            Defaults will not replace resource authorization or threat modeling.
            They remove the class of bugs that only exist because the framework
            shrugged.
          </p>

          <h2>Opt-out should be explicit, and a little annoying</h2>

          <p>
            Tanya&apos;s practical advice is the design rule I care about most
            in DaloyJS: make the secure option automatic, and make the insecure
            option take explicit choice and effort.
          </p>

          <CodeBlock language="ts" code={EXPLICIT_OPT_OUT} />

          <p>
            In production, <code>secureDefaults: false</code> without{" "}
            <code>acknowledgeInsecureDefaults: true</code> throws at
            construction. Even outside production, the framework logs every
            surface that flag disabled. Per-feature opt-outs exist so you can
            open one window without burning the house down. MCP routes need auth
            unless you pass <code>public: true</code>. Insecure should not look
            identical to the happy path in code review.
          </p>

          <p>
            If a junior (or an agent) can disable your security posture by
            deleting one line that looks like a style preference, you do not
            have a control. You have a suggestion.
          </p>

          <h2>Do Tanya&apos;s one thing, even if you never touch DaloyJS</h2>

          <p>
            Her homework is better than any framework pitch: change one default
            in one active repo. Config that ships insecure &quot;for later.&quot;
            CI without composition analysis. A template that skips validation. A
            script that assumes secrets live in plaintext. Flip it so secure is
            automatic and insecure is effortful. Leave a comment so future you
            does not undo it while cleaning &quot;noise.&quot;
          </p>

          <CodeBlock language="bash" code={FLIP_ONE_DEFAULT} />

          <p>
            You will not fix the company today. You will protect every future
            change that copies that path. That is also why a framework-level
            default beats a wiki page titled Security Checklist.
          </p>

          <h2>Defaults still leave work on the table</h2>

          <p>
            You still need threat modeling when a feature moves money or
            identity. You still need resource-level authorization (the
            JWT-valid-but-still-broken problem). You still need encryption and
            key management for sensitive data at rest, human review on scary
            migrations and permission changes, and training that teaches why so
            people do not proudly delete the guard.
          </p>

          <p>
            Defaults handle the recurring boring failures: the ones that show up
            because someone was rushing and the template was friendly. AI makes
            those failures cheaper to produce at volume. Frameworks and
            scaffolds that keep the insecure path frictionless will lose harder
            in 2026 than they did in 2019.
          </p>

          <h2>Why I keep building it this way</h2>

          <p>
            I write backends, not board decks. I got tired of reading the same
            pentest findings after teams completed the same annual training.
            Developers cared. The default path was a trap, and everyone was
            busy.
          </p>

          <p>
            So DaloyJS starts with contract-first routes, schemas that run
            before handlers, secure headers and limits without a plugin shopping
            list, boot guards that fail closed, and opt-outs that leave a paper
            trail. If that sounds heavy-handed, good. Security that depends on
            everyone having a perfect day is already broken.
          </p>

          <p>
            Tanya said it cleaner than I usually do: when you change a default
            so it is secure, you protect every future change that touches that
            code. Training can explain why. Systems have to make it stick.
          </p>

          <div className="not-prose my-8 rounded-xl border bg-muted/30 p-6">
            <p className="text-base font-semibold text-foreground">
              Listen, then flip one default
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                <a
                  href="https://www.devsecstation.com/2602204/episodes/19503769-secure-defaults-beat-secure-training"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  DevSecStation: Secure Defaults Beat Secure Training
                </a>{" "}
                (Tanya Janca / SheHacksPurple)
              </li>
              <li>
                <a
                  href="https://shehackspurple.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  shehackspurple.ca
                </a>
              </li>
              <li>
                Related here:{" "}
                <Link href="/blog/secure-by-default">
                  Secure by Default (feature tour)
                </Link>
                {", "}
                <Link href="/blog/your-jwt-is-valid-and-your-api-is-still-vulnerable">
                  JWT valid, API still vulnerable
                </Link>
                {", "}
                <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
                  Vibe coding security
                </Link>
              </li>
              <li>
                <Link href="/docs/security/secure-defaults">
                  Docs: secure-by-default
                </Link>
                {" · "}
                <Link href="/docs/security/secure-defaults-enforcement">
                  Enforcement and escape hatches
                </Link>
              </li>
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Scaffold with the boring guards already on:
            </p>
            <div className="mt-3">
              <CodeBlock
                language="bash"
                code="pnpm create daloy@latest my-api"
              />
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}
