import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-1-0-0-beta-is-here",
  title: "DaloyJS Is in Beta (and Nothing Broke, on Purpose)",
  description:
    "After a long public preview, DaloyJS enters beta. The key line in this changelog is that the runtime did not change. This post covers what the beta means, how to install it, and what we need from you before the stable release.",
  date: "2026-06-21",
  readingTime: "6 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino developer in Norway who has shipped enough 'small' version bumps at 2am to respect the boring ones.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS beta",
    "DaloyJS release",
    "TypeScript REST API framework",
    "secure by default framework",
    "create-daloy",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const INSTALL = `# Scaffold a fresh project on the beta
pnpm create daloy@latest my-api

# Or add the core to an existing project
npm i @daloyjs/core
pnpm add @daloyjs/core

# npm works too
npm i @daloyjs/core`;

const ROUTE = `app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: {
    200: { description: "OK", body: z.object({ status: z.literal("ok") }) },
  },
  handler: async () => ({ status: 200, body: { status: "ok" } }),
});`;

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
            <Badge variant="outline">Release</Badge>
            <Badge variant="outline">Beta</Badge>
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
            DaloyJS just crossed a line I have been nervous about for months. We
            tagged the beta. The framework that spent its whole life in public
            preview is now being tested as a stable foundation for production
            applications.
          </p>

          <p>
            The key line in this changelog is that the runtime did not change.
            The beta adds no middleware, adapter, or helper. If you used the
            final preview release yesterday, this is the same code with a braver
            version label.
          </p>

          <h2>Why the beta tag matters</h2>

          <p>
            A stable API is a promise, and I finally felt ready to make this
            one. During preview the deal was simple and a little rude: public
            APIs could still move. That is normal for a young framework. You
            move fast, you rename things, you apologize in the changelog. It is
            also exhausting for anyone trying to build something real.
          </p>

          <p>
            The beta flips that deal. The public API is feature-complete and
            stable. From the stable release onward we follow SemVer like adults:
            minor releases do not introduce breaking changes, and deprecations
            get at least one minor cycle of warning before anything disappears.
            The beta is me saying I think we are ready, then handing it to you
            to prove me wrong before the stable release.
          </p>

          <h2>What changed during preview</h2>

          <p>
            The work that earned a stable release happened across the entire
            public preview: the secure-by-default request path, the
            contract-first route that generates OpenAPI plus a typed client, the
            multi-runtime adapters, the supply-chain hardening, the SSRF guard,
            the auth and rate-limit and webhook pieces, all of it. Beta day
            starts the work of defending the shape that preview releases
            established.
          </p>

          <p>
            Your existing app still looks like this, because of course it does:
          </p>

          <CodeBlock language="ts" code={ROUTE} />

          <h2>How to get it</h2>

          <p>
            We published the beta to the <code>latest</code> tag on npm and to
            JSR, in lockstep across <code>@daloyjs/core</code>
            {", "}
            <code>create-daloy</code>
            {", "}and <code>@daloyjs/daloy</code>
            {". "}So a plain install gets you the beta with no special
            incantation:
          </p>

          <CodeBlock language="bash" code={INSTALL} />

          <p>
            Quick aside, because I almost did the clever thing here. The
            instinct with a beta is to hide it behind a <code>beta</code>{" "}
            dist-tag so that a normal <code>npm i</code> keeps handing people
            the last stable release. That is the responsible move when you have
            users who did not ask to be guinea pigs. We do not have that problem
            yet. We have the opposite problem: zero users to surprise, and a lot
            of people to win over. Parking the beta in a corner where nobody
            trips over it would have been the cautious choice and also the
            useless one. So it goes to <code>latest</code>
            {". "}Come trip over it.
          </p>

          <h2>What I actually want from you</h2>

          <p>
            A beta asks for evidence from real projects. The best possible
            outcome for the next few weeks is that someone builds a real thing
            on the beta and finds the rough edge I missed. File the bug. Tell me
            the API name that reads wrong. Show me the adapter that behaves
            differently than the docs claim. That is the entire point of
            shipping a beta instead of just tagging a stable release and
            praying.
          </p>

          <p>
            If you want the full picture before you dive in, the{" "}
            <Link href="/blog/why-daloyjs-is-the-rest-api-framework-you-should-use-today">
              case for using DaloyJS today
            </Link>{" "}
            covers the why, and{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link> covers
            the defenses you inherit on the very first route. Then go run{" "}
            <code>pnpm create daloy@latest</code> and report back.
          </p>

          <p>
            Tagging a beta, even a boring one, is the part of a project where it
            stops being a thing I am tinkering with and starts being a thing
            other people are allowed to depend on. Dependency is real now, and I
            want the production reports. Thanks for being early.
          </p>

          <div className="not-prose mt-10 rounded-2xl border bg-muted/35 p-5">
            <p className="text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">
                About the author:
              </span>{" "}
              {POST.authorBio}
            </p>
          </div>
        </div>
      </article>
    </main>
  );
}
