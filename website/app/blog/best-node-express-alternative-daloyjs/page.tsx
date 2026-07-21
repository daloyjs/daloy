import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "best-node-express-alternative-daloyjs",
  title:
    "The Best Node.js Express Alternative in 2026 Is Contract-First: The Case for DaloyJS",
  description:
    "Looking for a modern Node.js Express alternative? The honest argument for why a contract-first framework wins the category in 2026, and why DaloyJS is the Express alternative I now reach for, with the caveats where it does not hold.",
  date: "2026-06-18",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, most of it on top of Express. Has shipped, inherited, and rewritten more Node APIs than is healthy. Currently writes TypeScript from Norway.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Node.js Express alternative",
    "Express alternative",
    "best Express alternative 2026",
    "Express vs DaloyJS",
    "contract-first TypeScript framework",
    "Fastify alternative",
    "Hono alternative",
    "Elysia alternative",
    "secure by default API framework",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ROUTE_EXAMPLE = `import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const Book = z.object({ id: z.string(), title: z.string(), author: z.string() });

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    const found = await db.books.find(params.id);
    if (!found) throw new NotFoundError(\`No book \${params.id}\`);
    return { status: 200, body: found };
  },
});

serve(app, { port: 3000 });`;

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
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Express alternative</Badge>
            <Badge variant="outline">Contract-first</Badge>
            <Badge variant="outline">Opinion</Badge>
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
            Every &quot;best Express alternative&quot; listicle gives you the
            same shortlist: Fastify for maturity, Hono for the edge, Elysia for
            Bun. They are all defensible picks, and I have shipped production
            code on all three. But the listicles almost always evaluate the
            wrong axis. They benchmark requests per second and count GitHub
            stars, when the thing that actually decides whether an Express
            alternative was a good choice is something far less photogenic: how
            much of your API&apos;s <em>truth</em> the framework derives for
            you, and how much of your security perimeter it owns by default.
          </p>

          <p>
            I have spent about ten years building and inheriting Node services,
            currently from Norway, and I want to make a specific, falsifiable
            argument: in 2026, the best Node.js Express alternative for a new
            service is a contract-first one, and the strongest contract-first
            option in the TypeScript ecosystem right now is DaloyJS. This is the
            case for that claim, including the parts where it does not hold.
          </p>

          <h2>The axis everyone benchmarks is the one that matters least</h2>
          <p>
            Express is not slow, and neither are its alternatives. For the
            overwhelming majority of services, your bottleneck is a database
            round trip, a downstream API, or your own N+1 query, not the router.
            So when a framework&apos;s pitch leads with throughput, it is
            answering a question almost nobody&apos;s production incident was
            actually about.
          </p>
          <p>
            The questions your incidents <em>are</em> about: why did the docs
            say <code>title</code> when the API returns <code>name</code>? Why
            did a 2GB request body take down a pod? Why did{" "}
            <code>__proto__</code> in a JSON payload poison an object three
            layers deep? Why did a user-supplied URL in a webhook config reach
            the cloud metadata endpoint? None of those are throughput problems.
            All of them are <em>contract</em> and <em>default-posture</em>{" "}
            problems. That is the axis a serious Express alternative has to win
            on.
          </p>

          <h2>Why &quot;contract-first&quot; is the real category</h2>
          <p>
            Express&apos;s design center is one sentence from its own docs: an
            Express app is &quot;essentially a series of middleware function
            calls.&quot; That model is structurally ignorant of your API. The
            pipeline does not know what a route accepts or returns.{" "}
            <code>req.body</code> is <code>any</code>
            {". "}There is no contract anywhere in the architecture, so there
            is nothing to validate against, generate docs from, derive types
            from, or build a client out of. Every one of those becomes a
            hand-maintained artifact, and hand-maintained artifacts drift. Not
            because your team is undisciplined, but because the architecture
            gave the contract no canonical home.
          </p>
          <p>
            Contract-first inverts that. DaloyJS makes one route definition the
            source of truth and derives everything downstream from it:
          </p>

          <CodeBlock language="ts" code={ROUTE_EXAMPLE} />

          <p>
            That one object is the validation rule, the type source, the OpenAPI
            3.1 operation, and the input to the generated typed client (<code>pnpm gen</code>
            {", "}wrapping Hey API). The dependency arrow is reversed: the docs
            depend on the route, mechanically, with no human in the loop to
            forget. Rename a field and the spec, the client types, and the
            frontend call site all move or refuse to compile. This is the
            FastAPI insight, finally brought to TypeScript without the
            decorator-metaprogramming circus.
          </p>
          <p>
            Fastify approximates this with JSON Schema and type providers.
            Elysia approximates it with end-to-end typed handlers. Both are
            good. DaloyJS goes further by treating the OpenAPI document and the
            generated SDK as first-class, derived outputs rather than community
            plugins you assemble.
          </p>

          <h2>The part that should decide it: defaults</h2>
          <p>
            Write the real security checklist for an internet-facing HTTP API.
            The honest version: body-size caps, request and handler timeouts,
            prototype-pollution-safe parsing, CRLF and header-injection
            rejection, path-traversal defense, real 405s, 5xx redaction in
            production, JWT algorithm allowlists, constant-time credential
            comparison, SSRF guards on outbound fetches, secure headers, sane
            CORS, CSRF, rate limiting, and the supply chain that installs all of
            it.
          </p>
          <p>
            Now be honest about how much of that each Express alternative gives
            you <em>before you configure anything</em>
            {". "}Express: almost none. Fastify: some, the rest via plugins you
            must know to add. Hono and Elysia: most of it opt-in. DaloyJS makes
            it the default, and the project&apos;s contributor rules explicitly
            treat <em>weakening a guard to make a test pass</em> as a bug.
          </p>
          <p>
            Why this matters in 2026 specifically: a large and growing share of
            backend code is written by AI assistants, and an AI agent implements
            exactly the security you can name and not one guard you cannot. The
            Supabase and Aikido write-up on secure-by-default development
            compressed it into a sentence I keep quoting: &quot;If you tell an
            AI to make something work, it might remove the very security checks
            that protect you.&quot; Starting from a framework where the
            checklist is the default flips the burden: you have to consciously
            remove protection rather than consciously remember to add it. That
            is the property I want from an Express alternative in the
            agentic-coding era, and it is the one the throughput benchmarks
            never measure.
          </p>

          <h2>The supply-chain footnote that is not a footnote</h2>
          <p>
            <code>@daloyjs/core</code> has zero runtime dependencies. After
            living through a dependency-confusion scare and a postinstall-script
            incident, I read that number as a security property, not a vanity
            metric. Fewer transitive packages is a smaller attack surface and a
            more auditable install. Express pulls a tree. Most alternatives pull
            a smaller but non-trivial one. Zero is a different category.
          </p>

          <h2>Where the argument breaks (because it does)</h2>
          <p>I would not trust this post if it did not have this section.</p>
          <ul>
            <li>
              <strong>Ecosystem.</strong> Express has fifteen years of
              middleware for everything. If you need a niche integration that
              exists only as Express middleware, you are porting it.
            </li>
            <li>
              <strong>Familiarity and hiring.</strong> Every Node engineer knows
              Express. DaloyJS is new, so there is a small onboarding curve
              around the route-as-object and return-don&apos;t-mutate model.
            </li>
            <li>
              <strong>Maturity.</strong> Fastify has years of battle-testing and
              a huge production footprint. &quot;New and principled&quot; is not
              the same as &quot;proven at your scale.&quot;
            </li>
            <li>
              <strong>Raw minimalism.</strong> If you want a bare router with
              nothing opinionated, Hono is lighter. DaloyJS is opinionated on
              purpose.
            </li>
          </ul>

          <h2>The claim, restated</h2>
          <p>
            The best Node.js Express alternative in 2026 is not the fastest
            router or the one with the most stars. It is the one that makes your
            API contract a derived artifact instead of a maintained one, and
            makes the security checklist a default you must consciously weaken
            instead of homework you must consciously remember. On those two
            axes, contract-first wins the category, and DaloyJS is the strongest
            contract-first option in TypeScript today, with the caveat that
            Fastify is the safer pick if maturity outranks everything else for
            you.
          </p>
          <p>
            I stopped starting new services on Express not because it is bad,
            but because I got tired of being the human whose job was to remember
            the things the framework decided were my problem. After ten years, I
            would rather the framework remembered them, and made me file a PR to
            forget.
          </p>
          <p>
            If you have an existing Express app and want the mechanics rather
            than the argument, read the{" "}
            <Link href="/docs/migrating/express">
              complete Express to DaloyJS migration guide</Link>
            {". "}This post is the why. That guide is the how.
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
                href="/docs/migrating/express"
                className="underline underline-offset-4"
              >
                Migrate from Express to DaloyJS
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
