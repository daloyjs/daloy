import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-1-0-0-rc-0-first-release-candidate",
  title: "DaloyJS 1.0.0-rc.0: The First Release Candidate",
  description:
    "The beta said 'nothing changed, on purpose.' The release candidate says 'the door is now locked.' Here is what the RC means, what actually landed across the beta train (spoiler: MCP), and the short honest list of what still stands between us and 1.0.0 GA.",
  date: "2026-07-03",
  readingTime: "7 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino developer in Norway who has cut enough releases at odd hours to know the scary ones are the boring ones with a big version number.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS 1.0 release candidate",
    "DaloyJS rc.0",
    "TypeScript REST API framework",
    "secure by default framework",
    "MCP server TypeScript",
    "create-daloy",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const INSTALL = `# Scaffold a fresh project on the release candidate
pnpm create daloy@latest my-api

# Or add the core to an existing project
pnpm add @daloyjs/core

# Pin it explicitly if you like being specific
pnpm add @daloyjs/core@1.0.0-rc.0`;

const MCP = `import { App, createMcpHandler, mcpRoutes } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  // Origin is validated against DNS rebinding out of the box.
  // Add browser origins you actually trust; everything else gets 403.
  allowedOrigins: ["https://app.example.com"],
  tools: [
    {
      name: "inventory_lookup",
      description: "Look up available units by SKU.",
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string", minLength: 1 } },
        required: ["sku"],
        additionalProperties: false,
      },
      handler: async ({ sku }) => \`SKU \${sku}: 42 units\`,
    },
  ],
});

const app = new App();
for (const route of mcpRoutes("/mcp", mcp)) app.route(route);
serve(app, { port: 3001 });`;

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
            <Badge variant="outline">1.0.0 rc</Badge>
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
            A couple of weeks ago I wrote a post whose whole punchline was that{" "}
            <Link href="/blog/daloyjs-1-0-0-beta-is-here">
              the 1.0.0 beta changed nothing on purpose
            </Link>
            . Today I get to write the sequel, and the tone is different. We just
            tagged <code>1.0.0-rc.0</code>, the first release candidate. If the
            beta was me quietly hoping the API was ready, the RC is me locking
            the door and putting the key on the table.
          </p>

          <p>
            The rule for a release candidate is short and unglamorous: from here
            to the <code>1.0.0</code> GA, only bug fixes and documentation land.
            No new middleware, no new adapter, no new helper. The public API you
            see in <code>1.0.0-rc.0</code> is the public API you get in{" "}
            <code>1.0.0</code>, minus whatever bugs you help me find. That is the
            entire promise, and it is the reason an RC feels heavier to tag than
            a beta.
          </p>

          <h2>So the beta really was the freeze</h2>

          <p>
            When I said nothing changed at <code>beta.0</code>, I meant the shape
            was set. But betas <code>.1</code> through <code>.7</code> were not a
            nap. They were the part of a release where you stop building and
            start proving, and a few real things landed in that window that are
            worth calling out before the door shuts.
          </p>

          <p>
            The biggest one: DaloyJS grew a dependency-free{" "}
            <Link href="/docs/mcp">Model Context Protocol server</Link>. If you
            are building anything an AI client talks to, you can now expose
            tools, resources, and prompts over MCP Streamable HTTP from the same
            framework, with the same body limits, timeouts, auth middleware, and
            problem+json errors as any other route. It validates{" "}
            <code>Origin</code> against DNS rebinding by default, because that is
            a spec requirement and also because leaving it off is exactly the
            kind of quiet footgun this framework exists to remove.
          </p>

          <CodeBlock language="ts" code={MCP} />

          <p>
            The rest of the beta window was the unglamorous work I actually
            respect most. The Node hot path got faster (lazy request and response
            shims plus sync-first validation, which is a 21% bump on the
            full-contract benchmark and 53% on the bare echo path, with zero
            behavior change and every security check still in place). The{" "}
            <code>create-daloy</code> templates were brought into line with the
            security and contract guidance they ship with, so a freshly
            scaffolded app actually follows the patterns the docs preach. And the
            docs site itself got a navigation and hydration pass so reading it
            stops fighting you.
          </p>

          <h2>Nothing to do if you are already on the beta</h2>

          <p>
            <code>1.0.0-rc.0</code> is a version bump from <code>beta.7</code>.
            If you were on <code>^1.0.0-beta.7</code>, upgrading is a lockfile
            change and a good night&apos;s sleep. We moved{" "}
            <code>@daloyjs/core</code>, <code>create-daloy</code>, and the JSR
            package <code>@daloyjs/daloy</code> together, as always, and every{" "}
            <code>create-daloy</code> template now pins{" "}
            <code>@daloyjs/core@^1.0.0-rc.0</code>. A plain install gets you the
            RC, no dist-tag archaeology required:
          </p>

          <CodeBlock language="bash" code={INSTALL} />

          <h2>The honest part: what is between here and GA</h2>

          <p>
            I could pretend a release candidate means we are basically done. We
            are not, and the <Link href="/docs">roadmap</Link> says so out loud.
            The engineering bar is met: the API has been additive across the
            whole beta train, coverage sits around 99% lines and 92% branches,
            the supply-chain gates are green, and the benchmark suite is public.
            What is left before <code>1.0.0</code> GA is deliberately not code.
          </p>

          <p>
            Three things. I want at least three production users on file, real
            services depending on this, not a to-do app I wrote to feel good. I
            want the security disclosure process exercised at least once, because
            a policy you have never run is a policy you do not actually have. And
            I want migration guides from the frameworks people are actually
            leaving. The{" "}
            <Link href="/docs/migrating/express">Express guide</Link> is up;
            Fastify and Hono are the next writing I owe you, and the RC window is
            when I pay that debt.
          </p>

          <h2>What I want from you</h2>

          <p>
            Same ask as the beta, higher stakes. A release candidate is a bet
            that the API is right, placed in public so you can call it. The most
            useful thing you can do in the next few weeks is build a real thing
            on <code>1.0.0-rc.0</code> and find the corner I sanded wrong. Report
            the bug. Tell me the name that reads badly. Show me the adapter that
            drifts from the docs. Once GA ships, that feedback costs a
            deprecation cycle to act on. Right now it is free.
          </p>

          <p>
            If you are new here, start with{" "}
            <Link href="/blog/why-daloyjs-is-the-rest-api-framework-you-should-use-today">
              the case for using DaloyJS today
            </Link>{" "}
            and the defenses you inherit on your very first route in{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>. Then
            run <code>pnpm create daloy@latest</code> and come tell me what
            broke.
          </p>

          <p>
            Tagging a release candidate is the moment a project stops being
            &quot;almost ready&quot; and becomes &quot;prove it.&quot; That is
            the scary-in-a-good-way part, and I would rather be here nervous than
            still adding features I would have to defend forever. Thanks for being
            early. Let us go find the bugs.
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
