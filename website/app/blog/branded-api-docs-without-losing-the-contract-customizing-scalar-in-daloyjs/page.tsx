import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "branded-api-docs-without-losing-the-contract-customizing-scalar-in-daloyjs",
  title:
    "Branded API Docs Without Losing the Contract: Customizing Scalar in DaloyJS",
  description:
    "DaloyJS 0.14 adds docs.scalar — a JSON-only knob that lets you theme the Scalar API reference, hide the Try-it button, drop in a brand stylesheet, and pick a layout, without forking the docs route. And because Daloy locks the spec URL to your live OpenAPI path at serialize time, the prettiest docs page in the company can't drift away from the contract.",
  date: "2026-06-07",
  readingTime: "10 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently typing this from a desk in Norway where the sun has been up since 03:42. Has personally shipped at least three custom-forked docs pages that quietly served a six-month-old spec because nobody noticed the URL was hard-coded. Has feelings about this.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Scalar API reference",
    "OpenAPI docs theming",
    "DaloyJS docs",
    "branded API docs",
    "custom CSS Scalar",
    "hide Try It button",
    "FastAPI ergonomics",
    "docs.scalar",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# The Slack thread that started this feature, only lightly fictionalised:
#
# - Marketing:  "Can the /docs page use our brand colours? It looks like
#                a stranger's house. We have a design system."
# - PM:         "Can we hide the Try-It button on prod? An enterprise
#                customer 'tested' DELETE /v1/accounts/:id last Tuesday."
# - Security:   "And the favicon. It has to come from our CDN. CSP."
# - You:        "Sure, I'll just fork the docs route."
#
# Six weeks later: there is a 200-line bespoke /docs handler that hard-codes
# the spec URL. The spec URL is "/openapi-v1.json". The new route the team
# shipped this morning is at "/openapi.json". Guess which one the docs page
# is rendering.
#
# This is the part of the job that should not be a project.`;

const BEFORE = `// src/app.ts — before. Defaults are fine, but you cannot say "and also
// hide the Try It button on prod" without leaving the constructor.
import { App } from "@daloyjs/core";

export const app = new App({
  docs: "auto",  // mounts /docs and /openapi.json, generic Scalar theme.
});`;

const AFTER = `// src/app.ts — after. New in 0.14: docs.scalar accepts any JSON-serialisable
// option the Scalar API reference understands.
import { App } from "@daloyjs/core";

export const app = new App({
  docs: {
    path: "/docs",
    openapiPath: "/openapi.json",
    ui: "scalar",
    scalar: {
      theme: "deepSpace",
      layout: "modern",
      hideTestRequestButton: process.env.NODE_ENV === "production",
      hideClientButton: false,
      hideDarkModeToggle: false,
      showOperationId: true,
      defaultOpenFirstTag: true,
      favicon: "/static/brand/favicon.svg",
      customCss: \`
        :root {
          --scalar-color-1: #0b1020;
          --scalar-color-accent: #ff6a3d;
          --scalar-font: "Inter", system-ui, sans-serif;
        }
      \`,
    },
  },
});`;

const STRIP = `// src/docs.ts — what Daloy does at serialize time. (Excerpt; the real
// code is in @daloyjs/core/src/docs.ts and the contract is enforced by
// the ScalarReferenceConfiguration type.)
//
// Everything that points Scalar at a *different* spec is stripped here,
// and 'url' is force-set to the live OpenAPI route the App is already
// serving. No matter what you pass, the rendered docs page reads the
// same spec your typed client and contract tests read.
const STRIP_RUNTIME_FIELDS = [
  "content",       // inline spec — would shadow the live route
  "sources",       // multi-spec switcher — silently picks the wrong one
  "spec",          // deprecated alias of content
  "url",           // we ALWAYS set this ourselves
  "plugins",       // functions — not JSON-serialisable
  "fetch",         // function — not JSON-serialisable
] as const;

// And these are typed as 'never' so TypeScript catches you before you
// even try. Functions can't ride along inside a data-* attribute, and
// pretending they can would be a fun footgun:
//
//   onBeforeRequest?: never;
//   generateOperationSlug?: never;
//   redirect?: never;
//   ...

const safe = stripRuntimeFields(scalar);
const finalConfig = { ...safe, url: openapiPath };  // <-- always wins
const dataAttr = \` data-configuration='\${escapeHtml(JSON.stringify(finalConfig))}'\`;`;

const RENDERED = `<!-- The single line that lands in the browser. Yes, just one script tag
     and one data attribute. Scalar's HTML API does the rest. -->
<script
  id="api-reference"
  data-url="/openapi.json"
  data-configuration='{"theme":"deepSpace","layout":"modern","hideTestRequestButton":true,"showOperationId":true,"defaultOpenFirstTag":true,"favicon":"/static/brand/favicon.svg","customCss":":root{--scalar-color-1:#0b1020;--scalar-color-accent:#ff6a3d;}","url":"/openapi.json"}'>
</script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>`;

const TYPESCRIPT_ERROR = `// You try to be clever. TypeScript stops you.
export const app = new App({
  docs: {
    scalar: {
      theme: "deepSpace",
      onBeforeRequest: (req) => {           // <-- red squiggle here
        req.headers.set("x-debug", "1");
      },
      sources: [                            // <-- and here
        { url: "/openapi-experimental.json", title: "Beta" },
      ],
    },
  },
});

// tsc says, with the patience of an older sibling:
//
//   Type '(req: Request) => void' is not assignable to type 'never'.
//   Type '{ url: string; title: string; }[]' is not assignable to type 'never'.
//
// Translation: that field can't ride inside data-configuration. Use
// scalarHtml({ configuration }) directly on a custom route if you need it.`;

const PER_ENV = `// One pattern I use a lot: dev gets all the toys, prod gets the brand
// chrome and nothing dangerous. No NODE_ENV ifs inside the template,
// no fork of the docs route. Just two configs.
import { App, type ScalarReferenceConfiguration } from "@daloyjs/core";

const isProd = process.env.NODE_ENV === "production";

const scalar: ScalarReferenceConfiguration = isProd
  ? {
      theme: "deepSpace",
      layout: "modern",
      hideTestRequestButton: true,
      hideClientButton: true,
      showDeveloperTools: "never",
      defaultOpenFirstTag: true,
      customCss: brandCss,
    }
  : {
      theme: "kepler",
      layout: "modern",
      showDeveloperTools: "always",
      defaultOpenAllTags: true,
      expandAllResponses: true,
      persistAuth: true,
    };

export const app = new App({
  docs: { ui: "scalar", scalar },
});`;

const CUSTOM_ROUTE = `// You need a function-valued option (a plugin, an onBeforeRequest hook,
// a custom slug generator). docs.scalar can't carry those — they're not
// JSON-serialisable, and shoving a stringified function into a data-*
// attribute is the kind of thing you read about in incident reviews.
//
// Drop the auto-mount and use scalarHtml() directly. Same generator,
// same CSP, same nonce handling — just rendered by a route you control.
import { App, scalarHtml, htmlResponse } from "@daloyjs/core";

export const app = new App({ docs: false });

app.get("/docs", (ctx) => {
  // scalarHtml() takes the same configuration shape, but here you can
  // also assemble the page yourself (extra <link>, an extra <script>
  // that registers a Scalar plugin, etc).
  const html = scalarHtml({
    specUrl: "/openapi.json",
    title: "Bookstore API",
    scriptNonce: ctx.state.cspNonce,   // works with secureHeaders() CSP
    configuration: {
      theme: "deepSpace",
      layout: "modern",
      customCss: brandCss,
    },
  });
  return htmlResponse(html, { scriptNonce: ctx.state.cspNonce });
});`;

const TEST = `// tests/docs-scalar.test.ts — the regression test I copy into every
// project. Two lines, catches the next intern who hard-codes a different
// spec URL into the rendered HTML "just for debugging."
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";

test("docs page renders Scalar with our brand config", async () => {
  const res = await app.request("/docs");
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /id="api-reference"/);
  assert.match(body, /"theme":"deepSpace"/);
  assert.match(body, /"hideTestRequestButton":true/);

  // The important one. Daloy must force the live spec URL into the
  // config payload, regardless of what we passed (or didn't pass).
  assert.match(body, /"url":"\\/openapi\\.json"/);
});`;

const CHECKLIST = `# A short checklist before you ship a branded /docs page.
#
# 1) Pick a theme. There are 12. "default", "deepSpace", "kepler",
#    "moon", "saturn", "purple", "solarized", "laserwave", "alternate",
#    "mars", "bluePlanet", "none". Audition them in dev; they're free.
#
# 2) hideTestRequestButton: true in production unless the docs are
#    behind your internal SSO. The Try-It button is real fetch().
#
# 3) customCss is a string — keep it small. Two or three CSS vars
#    (--scalar-color-1, --scalar-color-accent, --scalar-font) cover
#    90% of brand work. Don't reimplement Tailwind in there.
#
# 4) Don't set 'url', 'content', 'sources', 'spec', 'plugins', or
#    'fetch'. They're either stripped or typed as 'never'. The whole
#    point is that the docs page reads the same spec your client does.
#
# 5) If you need a function-valued option, fall back to scalarHtml()
#    on a route you control. Same CSP, same nonce, same generator.
#
# 6) Snapshot test the rendered page. Two assert.match() calls is
#    enough to catch 'someone broke the brand config' for years.`;

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

function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

function OptionCard({
  name,
  what,
  children,
}: {
  name: string;
  what: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {name}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">{what}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Docs UI</Badge>
            <Badge variant="outline">OpenAPI</Badge>
            <Badge variant="outline">DX</Badge>
            <Badge variant="outline">0.14</Badge>
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
            Hi, Devlin again. I want to talk about a small feature that lands in{" "}
            <code>@daloyjs/core@0.14.0</code> with a deceptively boring name:{" "}
            <code>docs.scalar</code>. It is one new option on the App
            constructor. It is also the difference between &quot;our docs page
            looks like everyone else&apos;s docs page&quot; and &quot;our docs
            page looks like the rest of our product, and the Try-It button is
            off in prod, and the spec it&apos;s reading is still the live
            one.&quot;
          </p>

          <p>
            That last clause is the one I want you to remember. The whole reason
            this option exists in the shape it does is to give you theming
            without giving you a footgun.
          </p>

          <h2>The Slack thread that started it</h2>

          <EditorFrame
            files={["slack · #api-team"]}
            activeFile="slack · #api-team"
            status="ten years of this exact thread, every company, every framework"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <p>
            Every team I&apos;ve been on eventually hits a moment where the
            generated docs page is &quot;close, but&quot;. Close, but the
            colours are wrong. Close, but Try-It should be gone in prod. Close,
            but the favicon. So someone forks the route, copies the HTML out of
            the framework&apos;s source, and now there&apos;s a two-hundred-line
            bespoke handler with a hard-coded spec URL that nobody touches for
            two years. I have shipped that handler. I&apos;ve also been the next
            person trying to fix it. Neither was fun.
          </p>

          <h2>Before and after</h2>

          <EditorFrame
            files={["src/app.ts · before"]}
            activeFile="src/app.ts · before"
            status="defaults only · no theming · no way to hide Try-It in prod"
          >
            <CodeBlock language="ts" code={BEFORE} />
          </EditorFrame>

          <EditorFrame
            files={["src/app.ts · after (0.14)"]}
            activeFile="src/app.ts · after (0.14)"
            status="docs.scalar accepts the JSON-serialisable Scalar config · zero new files"
          >
            <CodeBlock language="ts" code={AFTER} />
          </EditorFrame>

          <p>
            That&apos;s it. One option. <code>docs.scalar</code> takes any
            JSON-serialisable Scalar API reference configuration and forwards it
            into the page. Theme, layout, brand CSS, favicon, the Try-It toggle,
            sidebar density, &quot;open the first tag by default&quot; &mdash;
            all the knobs Scalar already supports.
          </p>

          <h2>The options I actually reach for</h2>

          <p>
            There are about forty fields on{" "}
            <code>ScalarReferenceConfiguration</code>. I&apos;m not going to
            list all of them &mdash; the type ships with your IDE, and Scalar
            keeps the canonical reference. But these are the ones I set in
            almost every project, in roughly this order:
          </p>

          <OptionCard name="theme" what="pick one of the twelve presets.">
            My usual two: <code>&quot;deepSpace&quot;</code> for prod (looks
            grown-up, ships with great defaults),{" "}
            <code>&quot;kepler&quot;</code> for staging (so you can tell at a
            glance which environment you&apos;re on). The free debugging hint is
            worth it.
          </OptionCard>
          <OptionCard
            name="customCss"
            what="a string of CSS that overrides Scalar tokens."
          >
            Keep it tiny. Two or three CSS variables (
            <code>--scalar-color-1</code>, <code>--scalar-color-accent</code>,{" "}
            <code>--scalar-font</code>) and you&apos;ve matched your brand. The
            attribute is HTML-escaped for you, so quotes and angle brackets
            inside the CSS are safe.
          </OptionCard>
          <OptionCard
            name="hideTestRequestButton"
            what="kill the Try-It button. In prod. Always."
          >
            Unless your docs are behind internal SSO, the Try-It button performs
            real <code>fetch</code> calls against the live API. I&apos;ve seen
            someone &quot;test&quot; <code>DELETE</code> against production
            once. It is a story I tell new hires.
          </OptionCard>
          <OptionCard
            name="layout"
            what={'"modern" or "classic" — sidebar vs. accordion.'}
          >
            <code>&quot;modern&quot;</code> for public consumer-facing docs,{" "}
            <code>&quot;classic&quot;</code> for internal docs where engineers
            want to skim a long page with <kbd>⌘F</kbd>. Pick by audience, not
            by taste.
          </OptionCard>
          <OptionCard
            name="defaultOpenFirstTag"
            what="open the first tag group on load."
          >
            Saves a click. Pair with <code>defaultOpenAllTags: true</code> in
            dev so you can ctrl-F the whole API, and leave it off in prod so the
            page actually loads fast.
          </OptionCard>
          <OptionCard
            name="showDeveloperTools"
            what={'"always" | "localhost" | "never".'}
          >
            Set to <code>&quot;never&quot;</code> in prod. The dev tools panel
            is great when you&apos;re debugging the docs page itself, slightly
            confusing for an enterprise customer.
          </OptionCard>
          <OptionCard
            name="favicon"
            what="a URL string for the docs page favicon."
          >
            Use a path your CSP already allows, e.g.{" "}
            <code>/static/brand/favicon.svg</code> from your own origin.
            Don&apos;t hot-link a CDN you haven&apos;t added to{" "}
            <code>img-src</code>.
          </OptionCard>

          <h2>The design decision: JSON only, and Daloy wins the URL fight</h2>

          <p>
            Scalar&apos;s configuration object supports a lot of things. Some of
            them aren&apos;t safe to ship over an HTML data attribute, and some
            of them would let you accidentally point the docs page at a
            different spec than the one your typed client and contract tests are
            reading. Daloy takes a strong opinion on both.
          </p>

          <EditorFrame
            files={["src/docs.ts · serialiser"]}
            activeFile="src/docs.ts · serialiser"
            status="strip runtime fields · force url=openapiPath · then JSON.stringify"
          >
            <CodeBlock language="ts" code={STRIP} />
          </EditorFrame>

          <p>
            Two things to notice. First, the fields that would change which spec
            the page reads (<code>content</code>, <code>sources</code>,{" "}
            <code>spec</code>, <code>url</code>) are stripped at serialise time
            and <code>url</code> is then re-set to whatever{" "}
            <code>openapiPath</code> your App is serving. You literally cannot
            ship a docs page that reads a stale or alternate spec. I know,
            because I tried.
          </p>

          <p>
            Second, the function-valued fields (<code>onBeforeRequest</code>,{" "}
            <code>plugins</code>, <code>generateOperationSlug</code>, friends)
            are typed as <code>never</code> in the public type. They can&apos;t
            ride along inside a data attribute &mdash; functions don&apos;t
            survive <code>JSON.stringify</code> &mdash; and pretending they can
            would be a footgun with great UX and terrible debuggability.
            TypeScript stops you up front:
          </p>

          <EditorFrame
            files={["src/app.ts · with red squiggles"]}
            activeFile="src/app.ts · with red squiggles"
            status="tsc says no · earlier is better than at 03:00 in production"
          >
            <CodeBlock language="ts" code={TYPESCRIPT_ERROR} />
          </EditorFrame>

          <h2>What actually lands in the browser</h2>

          <EditorFrame
            files={["devtools · Elements · /docs"]}
            activeFile="devtools · Elements · /docs"
            status="one script tag · one data-configuration JSON blob · url always present, always live"
          >
            <CodeBlock language="html" code={RENDERED} />
          </EditorFrame>

          <p>
            That&apos;s the entire mechanism. Scalar&apos;s HTML API reads{" "}
            <code>data-configuration</code> at boot, merges it with anything you
            set via other data attributes, and renders. The reason this looks
            suspiciously simple is because it <em>is</em> suspiciously simple
            &mdash; the value of <code>docs.scalar</code> isn&apos;t in the
            rendering, it&apos;s in the contract we hold around what can and
            can&apos;t go in that JSON.
          </p>

          <h2>The pattern I copy into every project: per-env config</h2>

          <EditorFrame
            files={["src/app.ts · two configs, one constructor"]}
            activeFile="src/app.ts · two configs, one constructor"
            status="dev gets the toys · prod gets the brand chrome · no NODE_ENV ifs in templates"
          >
            <CodeBlock language="ts" code={PER_ENV} />
          </EditorFrame>

          <p>
            This is the smallest version of a pattern I&apos;ve been writing for
            years in five different frameworks. Two objects, one ternary, zero
            forks of the docs route. The dev variant turns on every convenience
            (open everything, persist auth, dev tools always), the prod variant
            turns off everything that could surprise a customer and adds the
            brand stylesheet. Same App, same route, same spec.
          </p>

          <h2>The escape hatch: when JSON isn&apos;t enough</h2>

          <p>
            About once a year I genuinely do want a Scalar plugin or a custom
            slug generator. Those are functions; they can&apos;t cross the JSON
            boundary. <code>docs.scalar</code> won&apos;t let me, and
            that&apos;s correct. But Daloy doesn&apos;t leave me stuck &mdash;
            the same generator that powers the auto-mount is exported as{" "}
            <code>scalarHtml()</code>, and I can mount my own route:
          </p>

          <EditorFrame
            files={["src/app.ts · custom /docs route"]}
            activeFile="src/app.ts · custom /docs route"
            status="docs: false · scalarHtml({ configuration }) · same CSP, same nonce, full control"
          >
            <CodeBlock language="ts" code={CUSTOM_ROUTE} />
          </EditorFrame>

          <p>
            Now I own the route, but I&apos;m still using the framework&apos;s
            HTML generator and the same CSP-friendly <code>htmlResponse()</code>{" "}
            helper. If you&apos;ve already wired up{" "}
            <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
              CSP nonces via secureHeaders()
            </Link>
            , the nonce flows through automatically &mdash; pass{" "}
            <code>ctx.state.cspNonce</code> into both calls and the script tag
            is allow-listed.
          </p>

          <h2>The regression test I always write</h2>

          <p>
            One thing I&apos;ve learned the hard way: branded docs config is
            exactly the kind of thing that decays silently. Six months from now
            someone refactors the App, deletes the <code>scalar</code> block by
            accident, and nobody notices because the page still loads. Write the
            boring snapshot test once, never think about it again:
          </p>

          <EditorFrame
            files={["tests/docs-scalar.test.ts"]}
            activeFile="tests/docs-scalar.test.ts"
            status="three asserts · catches brand-drift, Try-It-flag-drift, spec-URL-drift"
          >
            <CodeBlock language="ts" code={TEST} />
          </EditorFrame>

          <p>
            Notice the last assertion. That&apos;s the one that makes me sleep
            at night. It pins the fact that the page&apos;s configuration block
            carries the live spec URL &mdash; the same one your typed client,
            your contract tests, and your{" "}
            <Link href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health">
              daloy inspect
            </Link>{" "}
            output all read. If anyone ever finds a way to make the docs page
            point somewhere else, this test fails first.
          </p>

          <h2>The shipping checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="paste into your team's docs-PR template, walk away"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            The honest reason this feature took the shape it did: I wanted
            FastAPI-style ergonomics for the docs page &mdash; one option, in
            the constructor, no second mental model &mdash; without the
            FastAPI-style outcome where a year later someone has forked the
            template and the docs are silently rendering last quarter&apos;s
            spec. JSON-only forces the API to stay declarative. Force-setting{" "}
            <code>url</code> means the prettiest <code>/docs</code> page in the
            company physically cannot lie to your customers about what the API
            does. Everything else is just themes.
          </p>

          <p>
            Upgrade with <code>pnpm add @daloyjs/core@^0.14.0</code> (and{" "}
            <code>pnpm create daloy@latest</code> if you&apos;re scaffolding
            fresh &mdash; the templates now ship pinned to <code>^0.14.0</code>
            ). Then add five lines under <code>docs</code>, ship the brand
            audit, and go do something more interesting.
          </p>

          <p>
            Closest neighbors: the{" "}
            <Link href="/blog/openapi-3-1-extras-webhooks-callbacks-discriminators">
              OpenAPI 3.1 extras post
            </Link>{" "}
            for what the underlying spec can express, the{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              contract-first post
            </Link>{" "}
            for why &quot;one source of truth&quot; is the whole game, and the{" "}
            <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
              CSP nonces post
            </Link>{" "}
            if you&apos;re mounting a custom <code>/docs</code> route under a
            strict policy.
          </p>

          <p>— Devlin</p>
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
                href="/docs/openapi"
                className="underline underline-offset-4"
              >
                Read the OpenAPI docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health"
                className="underline underline-offset-4"
              >
                daloy inspect post
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
