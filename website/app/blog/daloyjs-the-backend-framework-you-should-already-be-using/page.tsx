import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-the-backend-framework-you-should-already-be-using",
  title: "DaloyJS: The Backend Framework You Should Already Be Using",
  description:
    "A contract-first TypeScript backend framework with security guardrails, typed clients, live OpenAPI, and a supply-chain posture that feels designed for 2026 instead of remembered from 2019.",
  date: "2026-06-20",
  readingTime: "10 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Writes backend code, reviews too many pentest reports, and remains unconvinced that production should be a trust fall.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS backend framework",
    "contract first TypeScript",
    "OpenAPI typed client",
    "secure headers rate limit request id",
    "pnpm supply chain controls",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const MINIMAL_APP = `import { z } from "zod";
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

const NPMRC = `ignore-scripts=true
minimum-release-age=1440
prefer-frozen-lockfile=true
verify-store-integrity=true
strict-peer-dependencies=true`;

const TYPED_CLIENT = `import { createClient } from "@daloyjs/core/client";

const client = createClient(app, { baseUrl: "http://localhost:3000" });

const result = await client.getBookById({ params: { id: "1" } });

if (result.status === 200) {
  console.log(result.body.title);
}`;

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
            <Badge variant="outline">Contract-first</Badge>
            <Badge variant="outline">Supply chain</Badge>
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
            A friend of mine once shipped a small Express API, went to sleep,
            and woke up to a server that had spent the night losing a fight with
            a gradually inflating request body. The service had no body cap or
            meaningful timeout, so memory use kept climbing. He is a competent
            developer. He was also busy. Those two facts coexist all the time.
          </p>

          <p>
            That is why DaloyJS stands out. It bundles the things teams usually
            forget: typed contracts, OpenAPI, docs, client generation, and a
            security posture that does not depend on whether somebody had
            enough coffee before opening the middleware docs.
          </p>

          <h2>The shape of a safer default</h2>

          <p>
            A minimal DaloyJS app already looks like a production-minded
            starting point instead of a tutorial you are meant to harden later.
            Validation lives beside the handler, the route is a contract, and
            the common defenses are present without begging for plugins.
          </p>

          <CodeBlock language="ts" code={MINIMAL_APP} />

          <p>
            That single file gives you strong request typing, route-level
            validation, rate limiting, secure headers, request IDs, and a live
            OpenAPI document. The nice part is not that these capabilities
            exist. Most ecosystems have them. The nice part is that they stop
            being six separate decisions.
          </p>

          <h2>Security you get before you ask for it</h2>

          <p>
            DaloyJS is opinionated in the correct direction. Body limits,
            prototype-pollution-safe parsing, path traversal rejection, response
            hardening, and request timeout behavior are part of the framework
            story. You can still add the more specialized network controls when
            you need them, but the baseline no longer starts at zero.
          </p>

          <p>
            That matters more in 2026 because the average backend is no longer
            written only by backend specialists. AI coding agents, copy-paste,
            and deadline math have made &quot;I meant to secure it later&quot;
            one of the most common architectural styles on the internet.
          </p>

          <h2>The supply-chain part is unusually sane</h2>

          <p>
            The scaffolded pnpm defaults are some of the most practical parts of
            the whole package. They do not try to turn you into a full-time
            security program. They just remove several easy ways to get hurt.
          </p>

          <CodeBlock language="ini" code={NPMRC} />

          <p>
            The 24-hour release-age delay is especially good. Most npm malware
            campaigns are found fast, because the attackers are greedy and the
            ecosystem is noisy. Waiting one day before you install a fresh
            version is one of those rare controls that is both boring and sharp.
            My favorite category of engineering decision.
          </p>

          <h2>The contract-first workflow is the actual quality-of-life win</h2>

          <p>
            Security gets the headline, but the contract-first model is what
            makes the day-to-day experience good. One route definition feeds the
            handler types, OpenAPI, docs, and client surface. Less drift, fewer
            duplicated truths, and fewer meetings where everybody stares at an
            outdated YAML file like it personally betrayed them.
          </p>

          <CodeBlock language="ts" code={TYPED_CLIENT} />

          <p>
            If you have ever maintained a frontend and a backend that disagreed
            about whether a field was optional, you already know why this is a
            better deal.
          </p>

          <h2>What I would start with on a new service</h2>

          <p>
            DaloyJS is solving the least glamorous problems first: install-time
            safety, runtime defaults, contract drift, typed clients, and
            portable execution. None of that is a flashy conference demo, but it
            is exactly what makes teams faster once the demo is over and actual
            maintenance begins.
          </p>

          <p>
            If you want to go further down this rabbit hole, start with{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              the contract-first post
            </Link>
            and{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              the supply-chain hardening write-up
            </Link>
            {". "}Both explain why the boring parts are doing most of the work.
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
