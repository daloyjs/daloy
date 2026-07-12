import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-1-0-0-beta-is-here",
  title: "DaloyJS 1.0.0-beta.0 Is Here (and Nothing Broke, On Purpose)",
  description:
    "After a long 0.x preview line, DaloyJS enters its 1.0.0 beta. The funny part: the most important line in this changelog is that nothing changed. Here is what the beta means, how to install it, and what we need from you before the 1.0.0 stable release.",
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
    "DaloyJS 1.0 beta",
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

# Pin it explicitly if you like being specific
npm i @daloyjs/core@1.0.0-beta.0`;

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
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Release</Badge>
            <Badge variant="outline">1.0.0 beta</Badge>
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
            DaloyJS just crossed a line I have been quietly nervous about for
            months. We tagged <code>1.0.0-beta.0</code>. The framework that
            spent its whole life as a <code>0.x</code> preview is now in beta for
            its first major release.
          </p>

          <p>
            And here is the part that feels like a punchline: the single most
            important line in this changelog is that nothing changed. No new
            middleware. No new adapter. No clever helper I will write three blog
            posts about. If you were on <code>0.44.0</code> yesterday,{" "}
            <code>1.0.0-beta.0</code> is the exact same code with a braver
            version number.
          </p>

          <h2>So why bother tagging it?</h2>

          <p>
            Because a version number is a promise, and I finally felt okay making
            this one. During <code>0.x</code> the deal was simple and a little
            rude: any minor release could break you. That is normal for a young
            framework. You move fast, you rename things, you apologize in the
            changelog. It is also exhausting for anyone trying to build something
            real on top of you.
          </p>

          <p>
            <code>1.0.0-beta.0</code> flips that deal. The public API is
            feature-complete and stable for the 1.0 line. From{" "}
            <code>1.0.0</code> onward we follow SemVer like adults: no breaking
            changes in a <code>1.x</code> minor, and deprecations get at least
            one minor cycle of warning before anything disappears. The beta is me
            saying I think we are ready, then handing it to you to prove me wrong
            before the stable release.
          </p>

          <h2>Wait, nothing changed, really?</h2>

          <p>
            Really. But that does not mean nothing happened. The work that earned
            the <code>1.0</code> happened across the entire <code>0.x</code> run:
            the secure-by-default request path, the contract-first route that
            generates OpenAPI plus a typed client, the multi-runtime adapters,
            the supply-chain hardening, the SSRF guard, the auth and rate-limit
            and webhook pieces, all of it. Beta day is not when the features
            arrive. It is when I stop adding features and start defending the
            shape of what is already there.
          </p>

          <p>
            Your existing app still looks like this, because of course it does:
          </p>

          <CodeBlock language="ts" code={ROUTE} />

          <h2>How to get it</h2>

          <p>
            We published <code>1.0.0-beta.0</code> to the <code>latest</code> tag
            on npm and to JSR, in lockstep across{" "}
            <code>@daloyjs/core</code>, <code>create-daloy</code>, and{" "}
            <code>@daloyjs/daloy</code>. So a plain install gets you the beta with
            no special incantation:
          </p>

          <CodeBlock language="bash" code={INSTALL} />

          <p>
            Quick aside, because I almost did the clever thing here. The instinct
            with a beta is to hide it behind a <code>beta</code> dist-tag so that
            a normal <code>npm i</code> keeps handing people the last stable
            release. That is the responsible move when you have users who did not
            ask to be guinea pigs. We do not have that problem yet. We have the
            opposite problem: zero users to surprise, and a lot of people to win
            over. Parking the beta in a corner where nobody trips over it would
            have been the cautious choice and also the useless one. So it goes to{" "}
            <code>latest</code>. Come trip over it.
          </p>

          <h2>What I actually want from you</h2>

          <p>
            A beta is not a victory lap, it is a request for evidence. The best
            possible outcome for the next few weeks is that someone builds a real
            thing on <code>1.0.0-beta.0</code> and finds the rough edge I missed.
            File the bug. Tell me the API name that reads wrong. Show me the
            adapter that behaves differently than the docs claim. That is the
            entire point of shipping a beta instead of just tagging{" "}
            <code>1.0.0</code> and praying.
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
            One small, slightly emotional note to close on. Tagging a{" "}
            <code>1.0</code> beta, even a boring one, is the part of a project
            where it stops being a thing I am tinkering with and starts being a
            thing other people are allowed to depend on. That is terrifying in
            the good way. Thanks for being early.
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
