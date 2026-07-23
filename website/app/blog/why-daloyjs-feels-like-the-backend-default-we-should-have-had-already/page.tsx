import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "why-daloyjs-feels-like-the-backend-default-we-should-have-had-already",
  title:
    "Why DaloyJS Feels Like the Backend Default We Should Have Had Already",
  description:
    "DaloyJS starts with the unglamorous parts modern backend teams actually need: install-time safety, runtime guardrails, and one route definition that keeps types, docs, and clients aligned.",
  date: "2026-06-19",
  readingTime: "6 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Has shipped enough backends to know that the scary part is usually not routing. It is everything around routing.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS default backend",
    "runtime guardrails",
    "contract first backend",
    "typed OpenAPI TypeScript",
    "supply chain safe defaults",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SAMPLE_APP = `import { z } from "zod";
import { App, requestId, secureHeaders, rateLimit } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  bodyLimitBytes: 1 << 20,
  requestTimeoutMs: 5_000,
});

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

const SAFETY_DEFAULTS = `ignore-scripts=true
minimum-release-age=1440
verify-store-integrity=true
strict-peer-dependencies=true`;

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
            <Badge variant="outline">Opinion</Badge>
            <Badge variant="outline">Defaults</Badge>
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
            I have shipped enough backends to know that most teams do not lose
            sleep because routing is hard. They lose sleep because security gets
            treated like a side quest. Someone wires up an API, adds a database,
            maybe a queue if they are feeling brave, and ships it with the
            confidence of a person assembling furniture from one blurry photo.
            Sometimes that works. Then Monday happens.
          </p>

          <p>
            DaloyJS feels like the backend default we should have had already
            because it starts with the right assumptions: developers are busy,
            AI agents are now part of the toolchain, and attackers are not
            waiting politely for everybody to finish the tutorial.
          </p>

          <h2>The boring controls are the good controls</h2>

          <p>
            The supply-chain part matters more than people like to admit.
            Attackers are using LLMs to scale package impersonation, dependency
            reconnaissance, and workflow abuse. Ship a sane set of defaults
            instead of becoming a security monk.
          </p>

          <CodeBlock language="ini" code={SAFETY_DEFAULTS} />

          <p>
            Those lines prevent extremely annoying incidents. I trust boring
            controls more than dramatic postmortems.
          </p>

          <h2>Runtime guardrails should be part of the framework story</h2>

          <p>
            I also like that DaloyJS treats security as product behavior instead
            of a lecture. The framework is explicit about CSRF, IP restriction,
            SSRF guardrails, open redirect handling, login throttling, and other
            defensive layers I have watched teams discover only after reading a
            report with the phrase &quot;proof of concept&quot; in it.
          </p>

          <p>
            It also keeps the core development flow readable. One route
            definition becomes validation, types, OpenAPI 3.1, docs, and typed
            clients. That means fewer places for truth to drift and fewer
            moments where the code says one thing while the generated docs say
            something charmingly fictional.
          </p>

          <CodeBlock language="ts" code={SAMPLE_APP} />

          <h2>What it prioritizes first</h2>

          <p>
            DaloyJS is solving the unglamorous problems first: install-time
            safety, runtime guardrails, contract-first design, and deploy-time
            discipline. That is useful. I would rather have a framework that
            removes common failure modes than one that gives me a tenth way to
            name a router group.
          </p>

          <p>
            If I were starting a new REST API today, I would want the framework
            to assume people are busy and production is real. DaloyJS is one of
            the few that feels built around that premise. Less drama, fewer
            surprises, and ideally fewer meetings about how a suspicious package
            ended up in the lockfile.
          </p>

          <p>
            For the more detailed versions of this argument, read{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>
            and{" "}
            <Link href="/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds">
              the scaffolding post
            </Link>
            {". "}They make the practical case better than any slogan can.
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
