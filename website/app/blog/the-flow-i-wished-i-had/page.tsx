import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "the-flow-i-wished-i-had",
  title: "The flow I wished I had: why we built DaloyJS",
  description:
    "Ten years of shipping fullstack apps, one Filipino dev in Norway, and the framework I kept wishing existed at 2am.",
  date: "2026-05-18",
  readingTime: "9 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino dev living in Norway. Spends summers debugging, winters debugging; only the lighting changes.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS overview",
    "why DaloyJS",
    "contract-first TypeScript framework",
    "runtime-portable framework story",
    "TypeScript backend framework",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HELLO_DALOY = `import { z } from "zod";
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1 << 20, requestTimeoutMs: 5_000 });

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: z.object({ id: z.string(), title: z.string() }) },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Book \${params.id}\` },
  }),
});

serve(app, { port: 3000 });`;

const OLD_WAY = `// validation lives here
const BookParams = z.object({ id: z.string() });

// the route lives here, but the types are "any" again
app.get("/books/:id", async (req, res) => {
  const { id } = BookParams.parse(req.params);
  const book = await getBook(id);
  res.json(book); // 200? 404? who knows. swagger.yaml says 200.
});

// the openapi spec lives in another file
// the client SDK is generated from yet another file
// the contract tests live in QA's heart`;

const TYPED_CLIENT = `import { createClient } from "./generated/client/index.js";

const api = createClient({ baseUrl: "http://localhost:3000" });

// status is a discriminated union, body is narrowed per status.
const result = await api.getBookById({ params: { id: "42" } });

if (result.status === 200) {
  console.log(result.body.title); // string - typed.
} else {
  console.log("not found"); // 404 branch, also typed.
}`;

const RUNTIME_PORTABLE = `// node
import { serve } from "@daloyjs/core/node";
serve(app, { port: 3000 });

// bun
import { serve } from "@daloyjs/core/bun";
serve(app, { port: 3000 });

// cloudflare worker
import { toFetch } from "@daloyjs/core/fetch";
export default { fetch: toFetch(app) };

// Vercel / any Web Fetch runtime
import { toFetch } from "@daloyjs/core/fetch";
export const GET = toFetch(app);`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: {
    "@type": "Person",
    name: POST.author,
  },
  publisher: {
    "@type": "Organization",
    name: "DaloyJS",
    url: SITE_URL,
  },
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
            <Badge variant="outline">Overview</Badge>
            <Badge variant="outline">Story</Badge>
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
            I&apos;m Devlin, a Filipino developer who has been writing fullstack
            web apps for a little over ten years, and who now does it from a
            small flat in Norway where the sun, depending on the season, either
            refuses to set or refuses to show up. I drink a lot of coffee.
            I&apos;ve also shipped a lot of bad APIs, which is the more relevant
            credential here.
          </p>

          <p>
            This post is the long answer to a question I keep getting:{" "}
            <em>another</em> TypeScript web framework, really? Why? My short
            answer is: yes, really, because after a decade of Express, then Koa,
            then Fastify, then Nest, then Hono, then writing my own &quot;just a
            tiny layer&quot; libraries six different times, I got tired of the
            same three problems. So we built DaloyJS to solve them. That&apos;s
            the pitch.
          </p>

          <p>
            Okay fine, longer version below. Bring coffee. Or in my case, a very
            expensive Norwegian cup of something that costs more than my first
            PC mouse.
          </p>

          <h2>The three problems that wouldn&apos;t go away</h2>

          <p>
            In ten years of fullstack work, across startups, consultancies, and
            one bank that shall remain nameless, the same three problems kept
            showing up:
          </p>

          <ol>
            <li>
              <strong>The contract always drifts.</strong> The route definition,
              the Zod (or Joi, or Yup, or class-validator) schema, the OpenAPI
              YAML, the frontend types, and the client SDK are five different
              files that pretend to agree with each other. They don&apos;t. They
              never do. The QA team finds out first. The customer finds out
              second.
            </li>
            <li>
              <strong>Security defaults are opt-in.</strong> Body limits,
              request timeouts, prototype-pollution-safe JSON, path-traversal
              rejection, 5xx redaction in prod, all of these are &quot;just add
              this middleware&quot;. Which means in real codebases, under
              deadline, with three Jira tickets open, they are just&hellip; not
              there.
            </li>
            <li>
              <strong>The runtime is a prison.</strong> You picked Express in
              2018. Now it&apos;s 2026, your CFO wants Cloudflare Workers
              because the bill is scary, and your code physically cannot run
              there. You rewrite. Again.
            </li>
          </ol>

          <p>
            None of these are new complaints. What&apos;s new is that the
            JavaScript ecosystem finally has the pieces to fix them properly,
            Standard Schema, OpenAPI 3.1, the Web Fetch API as a portable
            runtime contract, OpenTelemetry semantic conventions, pnpm with
            proper supply-chain controls. The pieces exist. They just
            weren&apos;t assembled in one place with one opinion. So we did
            that. And we called it <Link href="/about-the-name">Daloy</Link>,
            which means <em>flow</em> in Tagalog, because everything flows from
            one contract.
          </p>

          <h2>
            The &quot;before&quot; picture (you&apos;ve written this code)
          </h2>

          <p>
            Here&apos;s the shape of code I&apos;ve been writing, and reading in
            PRs, for years. You will recognize it. You probably wrote some this
            week.
          </p>

          <CodeBlock language="ts" code={OLD_WAY} />

          <p>
            Look at all those places where truth can hide. The schema knows what
            a valid request looks like. The handler knows what statuses it
            returns. The YAML file knows what the
            <em> world </em> is told it returns. The generated client knows what
            the YAML said two sprints ago. None of them are checked against each
            other. The compiler is happily humming along, oblivious, like me
            eating lunch while my deploy is failing in another tab.
          </p>

          <h2>The &quot;after&quot; picture: one route, one truth</h2>

          <p>
            Here&apos;s the same idea in DaloyJS. One route definition. The
            validation, the response shape, the OpenAPI operation, the typed
            client method, and the contract test all come from this single
            object. If it compiles, they agree.
          </p>

          <CodeBlock language="ts" code={HELLO_DALOY} />

          <p>
            A few things to notice, because they matter more than they look:
          </p>

          <ul>
            <li>
              <code>request</code> and <code>responses</code> use{" "}
              <a
                href="https://github.com/standard-schema/standard-schema"
                rel="noreferrer"
                target="_blank"
              >
                Standard Schema
              </a>
              , so you can bring Zod, Valibot, ArkType, whatever you want. I
              used Zod here because Zod is what I have muscle memory for. Use
              what makes you happy.
            </li>
            <li>
              <code>operationId</code> is what becomes the method name on your
              typed client. Give it a verb-y name now and your frontend devs
              will mention you in a positive review someday.
            </li>
            <li>
              <code>bodyLimitBytes</code> and <code>requestTimeoutMs</code> are
              arguments to <code>App</code>, not optional middleware you forgot
              to add. The core enforces them. If a 5xx happens in production,
              the body is redacted by default, not leaked.
            </li>
            <li>
              <code>secureHeaders()</code>, <code>rateLimit()</code>,{" "}
              <code>requestId()</code> are first-party. They live in the same
              repo, they get the same tests, they ship on the same release
              cadence. No more &quot;oh that package is unmaintained since
              2021&quot;.
            </li>
          </ul>

          <h2>The typed client: my favorite part, honestly</h2>

          <p>
            Run <code>pnpm gen</code> and you get a real fetch-based SDK,
            generated from the real OpenAPI spec, which was generated from the
            real route. No hand-written types. No &quot;let me ping the backend
            dev to ask what 422 returns&quot;. The frontend sees this:
          </p>

          <CodeBlock language="ts" code={TYPED_CLIENT} />

          <p>
            That <code>if (result.status === 200)</code> branch is a real
            discriminated union. TypeScript will yell at you, in red, in your
            editor, before you even reach for <code>git commit</code>, if you
            try to read <code>result.body.title</code> from the 404 branch. This
            is the part where I quietly celebrate and pretend it was always this
            simple.
          </p>

          <h2>Runtime portability without the PowerPoint slides</h2>

          <p>
            I&apos;ve been burned by &quot;runs everywhere&quot; promises
            before. So I&apos;ll just show you. The same <code>app</code> from
            the example above runs in all of these:
          </p>

          <CodeBlock language="ts" code={RUNTIME_PORTABLE} />

          <p>
            The core only ever sees <code>Request</code> in,{" "}
            <code>Response</code> out. Adapters live at the edges where the
            runtime quirks live. That means when your CFO discovers Cloudflare
            Workers next quarter, your team changes <em>one import</em>, not the
            shape of your application. Beautiful. Boring. Both, simultaneously.
          </p>

          <h2>What we&apos;re actually solving, in plain words</h2>

          <p>
            If I had to put DaloyJS on a single index card and tape it to my
            monitor, here&apos;s what it would say:
          </p>

          <blockquote>
            One contract per route. Security on by default. The same app on
            Node, Bun, Deno, Cloudflare, and Vercel. A typed client that&apos;s
            actually typed. Tracing, streaming, and sessions that don&apos;t
            need a PhD. And a supply chain you can sleep through the night with.
          </blockquote>

          <p>
            That&apos;s the whole product. Everything in the{" "}
            <Link href="/docs">docs</Link> is a consequence of that index card.
          </p>

          <h2>
            What it is <em>not</em>
          </h2>

          <p>
            I have to say this part too, because frameworks get oversold and
            then we all end up sad on Hacker News.
          </p>

          <ul>
            <li>
              It is not a frontend framework. Use Next.js, React, Remix, Astro,
              htmx, whatever. DaloyJS is the API on the other side of the wire.
            </li>
            <li>
              It is not magical. There is no decorator party, no metadata
              reflector, no dependency-injection container that needs a 40-page
              chapter. If it looks like a function, it&apos;s a function.
            </li>
            <li>
              It is not trying to replace your ORM, your queue, your auth
              provider, or your email vendor. We have{" "}
              <Link href="/docs/orm">adapters and guides</Link> for those,
              because in real life you&apos;re going to use Prisma, or Drizzle,
              or whatever your team already loves.
            </li>
            <li>
              It is not <em>finished</em>. Software never is. But it&apos;s 320
              of 320 tests passing, 100% line and function coverage, strict
              TypeScript 6, and shipping. That is, in my experience, much better
              than &quot;done&quot;.
            </li>
          </ul>

          <h2>Why I, personally, kept showing up</h2>

          <p>
            Ten years in, the bugs that still wake me up are not the clever
            ones. They&apos;re the dumb ones. A status code that the docs lied
            about. A payload field that turned into <code>null</code> without
            anyone noticing. A
            middleware that &quot;everyone uses&quot; that wasn&apos;t wired up
            in the prod build. A deploy that worked in Node 20 and exploded in a
            Worker because someone reached for <code>process.env</code> like it
            was 2015.
          </p>

          <p>
            DaloyJS is, very honestly, the framework I wanted to hand my younger
            self when he was crying into his keyboard at 2am Manila time trying
            to figure out why staging returned HTML for a JSON endpoint. (It was
            an nginx error page. It is always an nginx error page.) It
            won&apos;t make you a better developer, and it definitely won&apos;t
            make the coffee in Oslo cheaper. But it will, I hope, take a small
            pile of recurring problems off your desk so you can go solve the
            actually interesting ones.
          </p>

          <h2>Try it in five minutes</h2>

          <p>
            If you&apos;ve read this far, you should just try it. Five minutes.
            Worst case, you close the tab and we&apos;re still friends.
          </p>

          <CodeBlock
            language="bash"
            code={`pnpm create daloy@latest my-api
cd my-api
pnpm dev`}
          />

          <p>
            Then read <Link href="/docs/getting-started">Getting started</Link>,
            poke at the generated OpenAPI, and let me know what breaks.
            Especially let me know what breaks. A framework only earns the right
            to exist by surviving other people&apos;s real code.
          </p>

          <p>
            Thanks for reading. Now if you&apos;ll excuse me, the sun in Norway
            just set at 11pm, and I still have not emotionally accepted that as
            a normal thing.
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
                href="/docs/getting-started"
                className="underline underline-offset-4"
              >
                Read the quickstart
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
