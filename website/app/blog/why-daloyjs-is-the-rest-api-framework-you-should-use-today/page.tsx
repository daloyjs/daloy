import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "why-daloyjs-is-the-rest-api-framework-you-should-use-today",
  title: "Why DaloyJS Is the REST API Framework You Should Use Today",
  description:
    "In 2026, security guardrails are not optional anymore. This is the blunt case for a REST framework that treats secure defaults as the baseline instead of a plugin shopping list.",
  date: "2026-06-06",
  readingTime: "7 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino developer in Norway, still suspicious of frameworks that make security sound like an optional weekend hobby.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS REST API framework",
    "secure by default framework",
    "TypeScript REST API security",
    "pnpm supply chain hardening",
    "zero runtime dependencies",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const LOGIN_ROUTE = `app.route({
  method: "POST",
  path: "/login",
  operationId: "login",
  request: {
    body: z.object({ email: z.string().email(), password: z.string() })
  },
  responses: {
    200: { description: "OK", body: z.object({ token: z.string() }) },
    401: { description: "Unauthorized" },
  },
  handler: async ({ body }) => {
    const user = await db.users.findByEmail(body.email);
    if (!user || !timingSafeEqual(user.passwordHash, hash(body.password))) {
      return { status: 401, body: { error: "Invalid credentials" } };
    }
    return { status: 200, body: { token: createToken(user) } };
  }
});`;

const HARDENED_NPMRC = `ignore-scripts=true
minimum-release-age=1440
verify-store-integrity=true`;

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
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">REST APIs</Badge>
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
            In 2026, shipping a backend without security guardrails is not just
            optimistic. It is negligent. Attackers now have LLMs helping them
            scan CI pipelines, manifests, network config, and package trees at a
            speed that used to require a team and a lot of caffeine. The bad
            news is obvious. The worse news is that many developers are still
            shipping APIs like it is 2018 and good vibes count as a threat
            model.
          </p>

          <p>
            That is the context where DaloyJS makes sense. It is a TypeScript
            REST framework that assumes most people will not read a 300-item
            security checklist before lunch. Instead of making the safe path a
            scavenger hunt through middleware docs, it bakes the boring but
            necessary protections into the framework itself.
          </p>

          <h2>The real problem is not routing</h2>

          <p>
            Routing is not the hard part. The hard part is remembering every
            defensive control that should sit around the route. Body limits,
            timeout handling, secure headers, safe parsing, path traversal
            rejection, timing-safe comparisons, and a supply chain that is not
            one typo away from sadness. Most frameworks let you add those one by
            one. In real projects, under deadline, that translates to maybe
            later. Then maybe never.
          </p>

          <p>
            DaloyJS takes the opposite stance: if the framework knows a safe
            default, it should ship it. That is a much better bet for the era of
            AI-generated boilerplate and accidental production deployments.
          </p>

          <h2>What you get on the first route</h2>

          <p>
            Every route definition inherits protections that usually show up as
            separate packages in other stacks. The point is not that any one of
            them is revolutionary. The point is that they are present before the
            first incident report.
          </p>

          <ul>
            <li>Body-size limits to stop easy memory abuse.</li>
            <li>Prototype-pollution-safe JSON parsing.</li>
            <li>Path traversal guards that reject suspicious segments.</li>
            <li>Request timeouts so hung handlers do not camp forever.</li>
            <li>
              Secure headers without a separate helmet-shaped shopping trip.
            </li>
            <li>Timing-safe comparison helpers for tokens and secrets.</li>
          </ul>

          <CodeBlock language="ts" code={LOGIN_ROUTE} />

          <p>
            That snippet is not interesting because it is fancy. It is
            interesting because the validation, error surface, and a chunk of
            the hardening story are already attached to the route definition. I
            like boring code when the boring code survives contact with the
            public internet.
          </p>

          <h2>Supply chain hardening should not be extra credit</h2>

          <p>
            DaloyJS also extends the secure-by-default mindset past the request
            path. The scaffold leans on pnpm defaults that make supply chain
            attacks materially harder to land. No, this will not solve every
            problem. Yes, it blocks a very stupid number of avoidable ones.
          </p>

          <CodeBlock language="ini" code={HARDENED_NPMRC} />

          <p>
            `ignore-scripts=true` closes the door on a whole class of lifecycle
            script nonsense. `minimum-release-age=1440` gives the ecosystem a
            day to notice when a freshly published package turns out to be a
            small crime scene. `verify-store-integrity=true` makes sure the bits
            you install are the bits you meant to install. None of this is
            glamorous. It is still better than explaining to your manager why an
            innocent `pnpm install` had opinions about crypto wallets.
          </p>

          <h2>Zero runtime dependencies matters</h2>

          <p>
            One of DaloyJS&apos;s more underrated properties is that the core
            keeps a zero-runtime-dependency posture. That reduces the transitive
            tree, the audit surface, and the number of maintainers you are
            trusting by accident. In a world where one compromised maintainer
            account can cause a very bad week for a lot of strangers, smaller
            trees are not aesthetic minimalism. They are risk reduction.
          </p>

          <h2>The baseline changed</h2>

          <p>
            I do not think frameworks get credit for restraint, but they should.
            The strongest argument for DaloyJS is not that it gives you one more
            clever abstraction. It is that it quietly removes a pile of security
            chores that too many teams keep forgetting. If you are building REST
            APIs in 2026, that is not a nice-to-have. That is the baseline.
          </p>

          <p>
            If you want the deeper background on the default protections, start
            with <Link href="/blog/secure-by-default">Secure by Default</Link>.
            If you want the origin story,{" "}
            <Link href="/blog/the-flow-i-wished-i-had">the launch story</Link>
            is where the sleep deprivation becomes autobiographical.
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
