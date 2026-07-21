import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "csp-nonces-and-trusted-types-without-tears",
  title: "CSP Nonces and Trusted Types Without Tears",
  description:
    "A practical tour of secureHeaders({ contentSecurityPolicy: { nonce: true, trustedTypes: { policies: [...] } } }), how ctx.state.cspNonce flows into a server-rendered template, why the nonce now lands on all four script/style directives, and how to roll out Trusted Types in report-only mode first without setting your weekend on fire.",
  date: "2026-05-24",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, currently writing TypeScript from Norway. Has at some point shipped a CSP that broke the login page. We don't talk about it.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "CSP nonce DaloyJS",
    "secureHeaders contentSecurityPolicy",
    "Trusted Types rollout",
    "require-trusted-types-for",
    "script-src-elem nonce",
    "style-src-elem nonce",
    "Content-Security-Policy-Report-Only",
    "ctx.state.cspNonce",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const NONCE_BASIC = `// src/app.ts, turn on per-request CSP nonces
import { App, secureHeaders } from "@daloyjs/core";

export const app = new App();

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      nonce: true,
      directives: {
        "default-src": "'self'",
        "script-src": "'self'",
        "script-src-elem": "'self'",
        "style-src": "'self'",
        "style-src-elem": "'self'",
        "img-src": "'self' data:",
        "connect-src": "'self'",
        "frame-ancestors": "'none'",
        "base-uri": "'none'",
        "object-src": "'none'",
      },
    },
  }),
);

// On every request:
//   1. A fresh 128-bit base64url nonce is generated
//   2. It is stashed on ctx.state.cspNonce for your templates
//   3. 'nonce-<value>' is appended to script-src, script-src-elem,
//      style-src, and style-src-elem - but only because those
//      directives are declared above. The nonce never appears in a
//      directive you didn't ask for.`;

const SSR_TEMPLATE = `// src/routes/home.ts, pipe the nonce into the rendered HTML
import { app } from "../app.ts";

app.route({
  method: "GET",
  path: "/",
  operationId: "home",
  responses: { 200: { description: "home" } },
  handler: async ({ state }) => {
    const nonce = state.cspNonce!; // populated by secureHeaders()
    const html = renderHome(nonce);
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: html,
    };
  },
});

function renderHome(nonce: string): string {
  // No template lib for the demo. In real life this is the one place I
  // happily reach for handlebars/eta/whatever - anywhere you'd write an
  // inline <script> or <style>, attach nonce="\${nonce}".
  return \`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hello CSP</title>
    <style nonce="\${nonce}">
      body { font: 16px/1.5 system-ui; padding: 2rem; }
    </style>
  </head>
  <body>
    <h1>Hello from a nonce-guarded page</h1>
    <script nonce="\${nonce}">
      // Inline scripts only run if the nonce matches. An XSS payload
      // injected later cannot guess this nonce.
      console.log("nonce was honored");
    </script>
  </body>
</html>\`;
}`;

const FOUR_DIRECTIVES = `// What the response header looks like in DevTools:
//
// content-security-policy:
//   default-src 'self';
//   script-src 'self' 'nonce-Yz3kQ2vV7uO9k_o5cQk1zw';
//   script-src-elem 'self' 'nonce-Yz3kQ2vV7uO9k_o5cQk1zw';
//   style-src 'self' 'nonce-Yz3kQ2vV7uO9k_o5cQk1zw';
//   style-src-elem 'self' 'nonce-Yz3kQ2vV7uO9k_o5cQk1zw';
//   img-src 'self' data:;
//   connect-src 'self';
//   frame-ancestors 'none';
//   base-uri 'none';
//   object-src 'none'
//
// One nonce, four directives. The browser uses script-src-elem and
// style-src-elem for <script src="..."> / <link rel="stylesheet"> tags
// and falls back to script-src / style-src for inline. We append to all
// four so a single nonce attribute on <script nonce> or <style nonce>
// just works regardless of which directive the browser consults.`;

const TRUSTED_TYPES_ENFORCED = `// src/app.ts, enforce Trusted Types alongside the nonce
import { App, secureHeaders } from "@daloyjs/core";

export const app = new App();

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      nonce: true,
      trustedTypes: {
        // These are the only policy names allowed to call
        // trustedTypes.createPolicy(...) in the browser.
        policies: ["app-default", "dompurify"],
      },
      directives: {
        "default-src": "'self'",
        "script-src": "'self'",
        "script-src-elem": "'self'",
        "style-src": "'self'",
        "style-src-elem": "'self'",
        "frame-ancestors": "'none'",
        "base-uri": "'none'",
        "object-src": "'none'",
      },
    },
  }),
);

// Emits, in addition to the nonce:
//   require-trusted-types-for 'script';
//   trusted-types app-default dompurify
//
// Now any innerHTML / outerHTML / document.write / new Function(...) /
// setTimeout(string) call from JS throws unless the string was minted
// by trustedTypes.createPolicy("app-default", {...}).createHTML(...).`;

const APP_DEFAULT_POLICY = `// apps/web/src/trusted-types.ts, the one place HTML becomes HTML
import DOMPurify from "dompurify";

// Required: browsers only let you create a policy whose name appears
// in the trusted-types directive we just sent from the server.
const sanitizer = window.trustedTypes!.createPolicy("app-default", {
  createHTML(input: string) {
    return DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: true });
  },
  createScript() {
    throw new Error("app-default does not mint scripts");
  },
  createScriptURL(url: string) {
    const allowed = new URL(url, location.origin);
    if (allowed.origin !== location.origin) {
      throw new Error("app-default blocked cross-origin script URL: " + url);
    }
    return url;
  },
});

export function setHtml(target: Element, html: string): void {
  // Without Trusted Types this is a normal string and it works.
  // With Trusted Types enforced, browsers reject the assignment unless
  // the right-hand side is a TrustedHTML - which is what sanitizer.createHTML returns.
  target.innerHTML = sanitizer.createHTML(html);
}`;

const REPORT_ONLY_ROLLOUT = `// src/app.ts, roll out Trusted Types in report-only mode FIRST
import { App, secureHeaders, type Hooks } from "@daloyjs/core";

export const app = new App();

// Step 1: keep your existing enforced CSP (with the nonce) exactly as it is.
app.use(
  secureHeaders({
    contentSecurityPolicy: {
      nonce: true,
      directives: {
        "default-src": "'self'",
        "script-src": "'self'",
        "script-src-elem": "'self'",
        "style-src": "'self'",
        "style-src-elem": "'self'",
        "frame-ancestors": "'none'",
        "base-uri": "'none'",
        "object-src": "'none'",
        "report-uri": "/__csp-report",
      },
    },
  }),
);

// Step 2: add a SECOND header - Content-Security-Policy-Report-Only - that
// turns on Trusted Types in observe-only mode. Browsers will fire reports
// to /__csp-report instead of breaking the page.
const trustedTypesObserve: Hooks = {
  onResponse(res) {
    if (!res.headers.has("content-security-policy-report-only")) {
      res.headers.set(
        "content-security-policy-report-only",
        "require-trusted-types-for 'script'; " +
          "trusted-types app-default dompurify; " +
          "report-uri /__csp-report",
      );
    }
  },
};
app.use(trustedTypesObserve);

// Step 3: a tiny endpoint to collect the violation reports.
app.route({
  method: "POST",
  path: "/__csp-report",
  operationId: "cspReport",
  responses: { 204: { description: "noted" } },
  handler: async ({ request, log }) => {
    const report = await request.json().catch(() => null);
    log.warn({ kind: "csp-violation", report }, "CSP violation report");
    return { status: 204 };
  },
});`;

const PROMOTE_TO_ENFORCED = `// Step 4 (later, after the report stream is quiet), flip to enforced.
// Move the trustedTypes block into the main secureHeaders() call, drop the
// report-only middleware, keep the report-uri so genuine bypasses keep
// telling you about themselves.

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      nonce: true,
      trustedTypes: { policies: ["app-default", "dompurify"] },
      directives: {
        "default-src": "'self'",
        "script-src": "'self'",
        "script-src-elem": "'self'",
        "style-src": "'self'",
        "style-src-elem": "'self'",
        "frame-ancestors": "'none'",
        "base-uri": "'none'",
        "object-src": "'none'",
        "report-uri": "/__csp-report",
      },
    },
  }),
);`;

const COMMON_PITFALLS = `# Pitfalls I have stepped on so you don't have to:

1. "My nonce isn't being added!"
   You didn't declare script-src / style-src in your directives map.
   The middleware only appends 'nonce-...' to directives that already
   exist - that's intentional (no surprise directives) but it bites you
   the first time. Add the four src directives.

2. "It works in dev but not in prod."
   Your dev server is using Vite/Webpack-dev-server with an inline
   <style> or eval()-based HMR. Either disable HMR's inline styles in
   dev, or scope secureHeaders() to non-dev environments via
   process.env.NODE_ENV === "production".

3. "TT broke our analytics snippet."
   Of course it did. Wrap the snippet in its own policy
   ("analytics") and add it to the policies array. Each vendor that
   uses innerHTML gets its own narrow policy - that's the point.

4. "Reports keep mentioning eval."
   Trusted Types enforcement covers setTimeout(string), new Function,
   document.write, innerHTML, outerHTML, and friends. Each one is a
   one-line refactor; the report tells you exactly the file and line.

5. "I added trustedTypes: true but nothing changed in the page."
   Open DevTools → Network → Response Headers and check that
   require-trusted-types-for 'script' is present. If not, your app is
   probably returning early without going through the middleware
   (a manual Response somewhere upstream). The middleware only sets the
   header when one isn't already set, by design.`;

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

/**
 * EditorFrame - VS Code-style chrome around a code sample.
 */
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

/**
 * RolloutStep - numbered card for the report-only rollout.
 */
function RolloutStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="not-prose my-4 flex gap-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-sm font-medium">
        {step}
      </div>
      <div>
        <div className="text-base font-semibold tracking-tight">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

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
            <Badge variant="outline">Deep dive</Badge>
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
            Hi, Devlin again. Ten years of fullstack, currently writing
            TypeScript from a quiet desk in Norway, and today I want to talk
            about the security headers that everyone agrees are important and
            absolutely nobody enjoys configuring:{" "}
            <strong>CSP with per-request nonces</strong> and{" "}
            <strong>Trusted Types</strong>.
          </p>

          <p>
            I&apos;ve set CSP up the bad way before. I shipped{" "}
            <code>script-src &apos;unsafe-inline&apos;</code> in production for
            almost two years on one project because removing it required a real
            refactor and there was always &quot;next quarter&quot;. What we
            shipped in <code>secureHeaders()</code> is an attempt to make the{" "}
            <em>good</em> way only slightly more typing than the bad way.
            Let&apos;s walk through it.
          </p>

          <h2>The 30-second mental model</h2>

          <p>
            CSP nonces let inline scripts and styles run <em>only</em> if they
            carry a per-response random token that an XSS payload cannot guess.
            Trusted Types upgrades the browser&apos;s sink APIs (<code>innerHTML</code>
            {", "}<code>setTimeout</code> with strings,
            <code>document.write</code>) so they refuse plain strings, anything
            dangerous has to come from a named, registered policy. Together they
            shrink the XSS attack surface from &quot;anywhere in your
            bundle&quot; to &quot;the three lines in{" "}
            <code>trusted-types.ts</code> where you call
            <code>createPolicy</code>&quot;.
          </p>

          <h2>Step one: turn on the nonce</h2>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="secureHeaders · nonce=true · 16 bytes · base64url"
          >
            <CodeBlock language="ts" code={NONCE_BASIC} />
          </EditorFrame>

          <p>
            Three things to notice. First, you pass the object form of{" "}
            <code>contentSecurityPolicy</code>
            {": "}that&apos;s what tells the middleware to rebuild the CSP
            header per request instead of caching a static string. Second,{" "}
            <code>nonce: true</code> is the entire opt-in. The middleware
            generates a 128-bit base64url nonce using WebCrypto, stashes it on{" "}
            <code>ctx.state.cspNonce</code>
            {", "}and appends <code>&apos;nonce-&lt;value&gt;&apos;</code> to
            your <code>script-src</code> and friends.
          </p>

          <p>
            Third, and this is the one that bit me the first time: the nonce is
            appended <em>only to directives you already declared</em>
            {". "}If your config has no <code>style-src</code>
            {", "}the middleware will <em>not</em> invent one for you.
            That&apos;s deliberate, secure headers should never silently broaden
            your policy, but it means you need to spell those directives out
            yourself if you want to use a nonce on them. Which leads us
            to&hellip;
          </p>

          <h2>Why the nonce now lands on four directives, not two</h2>

          <p>
            In older CSP guides you&apos;ll see &quot;just add the nonce to{" "}
            <code>script-src</code> and <code>style-src</code>&quot;. That was
            true in CSP 2. In CSP 3, the browser also consults
            <code>script-src-elem</code> and <code>style-src-elem</code>{" "}
            specifically for <em>element-based</em> loads,{" "}
            <code>&lt;script src=...&gt;</code> and{" "}
            <code>&lt;link rel=&quot;stylesheet&quot;&gt;</code>
            {": "}and falls back to the older directives if they aren&apos;t
            present. The wrinkle is that if you declare both pairs and only
            nonce the non-
            <code>-elem</code> ones, the browser uses the more specific
            directive and ignores the nonce.
          </p>

          <p>
            So we append to all four. The result, viewed in DevTools, looks like
            this:
          </p>

          <EditorFrame
            files={["chrome://devtools · Network · Headers"]}
            activeFile="chrome://devtools · Network · Headers"
            status="content-security-policy · one nonce · four directives"
          >
            <CodeBlock language="bash" code={FOUR_DIRECTIVES} />
          </EditorFrame>

          <p>
            One nonce attribute on your <code>&lt;script&gt;</code> or{" "}
            <code>&lt;style&gt;</code> tag works regardless of which directive
            the browser ends up consulting. You don&apos;t have to think about
            it again.
          </p>

          <h2>Step two: pipe the nonce into your template</h2>

          <p>
            The middleware does its job. Your handler reads{" "}
            <code>ctx.state.cspNonce</code> and attaches it to every inline{" "}
            <code>&lt;script&gt;</code> and <code>&lt;style&gt;</code>
            {". "}The shape of the handler is the same whether you&apos;re
            using a template engine or just template literals like this demo:
          </p>

          <EditorFrame
            files={["src/routes/home.ts", "src/app.ts"]}
            activeFile="src/routes/home.ts"
            status="GET / · text/html · nonce honored in inline <style> and <script>"
          >
            <CodeBlock language="ts" code={SSR_TEMPLATE} />
          </EditorFrame>

          <p>
            If you forget the nonce on a tag, that tag silently does not
            execute, which is exactly what you want, but is also why you&apos;ll
            briefly hate yourself the first time a footer analytics snippet
            stops working. Open the console, you&apos;ll see a clean CSP
            violation message naming the directive. Add the nonce, refresh,
            done.
          </p>

          <h2>Step three: turn on Trusted Types: enforced</h2>

          <p>
            CSP keeps XSS payloads from <em>running</em> as scripts. Trusted
            Types keeps them from being <em>injected as HTML</em> in the first
            place. The opt-in is one extra block:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="require-trusted-types-for 'script' · trusted-types app-default dompurify"
          >
            <CodeBlock language="ts" code={TRUSTED_TYPES_ENFORCED} />
          </EditorFrame>

          <p>
            On the browser side you create a policy with one of the names you
            just authorized. Anywhere in the app that touches{" "}
            <code>innerHTML</code> goes through the policy:
          </p>

          <EditorFrame
            files={["apps/web/src/trusted-types.ts"]}
            activeFile="apps/web/src/trusted-types.ts"
            status="window.trustedTypes.createPolicy('app-default', ...)"
          >
            <CodeBlock language="ts" code={APP_DEFAULT_POLICY} />
          </EditorFrame>

          <p>
            The shape is intentional. You have <em>one</em> place where raw
            strings become trusted HTML. That one place gets aggressive review
            and a sanitizer. Every other call site in the codebase either uses
            that helper or gets caught by the browser at runtime. Auditing
            &quot;where does HTML come from&quot; goes from a grep across a
            monorepo to one file.
          </p>

          <h2>
            The hard part: rolling Trusted Types out without taking production
            down
          </h2>

          <p>
            Honest moment: if you flip <code>trustedTypes</code> on enforced
            from day one in a real app, you will break things. Not because
            Trusted Types is wrong, but because every framework, every
            third-party widget, and at least one ancient utility someone wrote
            in 2019 will have an <code>innerHTML</code> in it somewhere.
            Don&apos;t do that. Roll out in report-only mode first.
          </p>

          <p>
            The CSP spec gives us a beautiful escape hatch, a parallel header
            called <code>Content-Security-Policy-Report-Only</code>
            {". "}The browser evaluates it exactly like the enforced policy,
            but instead of blocking violations it sends them to a{" "}
            <code>report-uri</code>
            {". "}
            DaloyJS doesn&apos;t ship a built-in toggle for this (yet), but
            it&apos;s a six-line custom hook on top of the existing middleware:
          </p>

          <RolloutStep
            step={1}
            title="Keep your enforced CSP exactly as-is"
            description="The nonce and the rest of the policy stay enforced. You do not weaken anything during the rollout, you add an observation layer on top."
          />
          <RolloutStep
            step={2}
            title="Add a second Content-Security-Policy-Report-Only header"
            description="Put only the Trusted Types directives in it. Browsers evaluate report-only headers independently, so a TT violation will be reported but the page still works."
          />
          <RolloutStep
            step={3}
            title="Collect the reports somewhere boring"
            description="A POST endpoint that logs to your existing logger. Read the report stream for a week. Each entry tells you the file, line, and which sink was used."
          />
          <RolloutStep
            step={4}
            title="Refactor each call site through a Trusted Types policy"
            description="One PR at a time. Watch the report rate drop. When it's flat for a few days, promote the policy to enforced."
          />

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="report-only · second header · POST /__csp-report collects reports"
          >
            <CodeBlock language="ts" code={REPORT_ONLY_ROLLOUT} />
          </EditorFrame>

          <p>
            And the flip to enforced, once the report stream is quiet, is
            mechanical, move the <code>trustedTypes</code> block into the main{" "}
            <code>secureHeaders()</code> call and delete the report-only hook:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="trustedTypes promoted to enforced · report-uri stays"
          >
            <CodeBlock language="ts" code={PROMOTE_TO_ENFORCED} />
          </EditorFrame>

          <p>
            I&apos;d keep the <code>report-uri</code> on forever. Genuine
            attempts to bypass your policy, including legitimate-looking ones
            from a future engineer who didn&apos;t know about the policy, are
            now telemetry, not silent failures.
          </p>

          <h2>Pitfalls (a.k.a. the bugs I personally have shipped)</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="learn from my mistakes, not your incidents"
          >
            <CodeBlock language="bash" code={COMMON_PITFALLS} />
          </EditorFrame>

          <h2>A short sanity check on threat model</h2>

          <p>
            CSP nonces and Trusted Types are XSS defenses, not magic. They do
            nothing for SSRF, nothing for SQL injection, nothing for an attacker
            who gets your <code>SESSION</code> cookie because{" "}
            <code>Secure</code> wasn&apos;t set on a staging environment. Use
            them <em>in addition to</em> the rest of the boring stuff, output
            encoding, prepared statements, sane cookie flags, not{" "}
            <em>instead of</em>.
          </p>

          <p>
            But once you have them on, you get a property that&apos;s very hard
            to get any other way: a future XSS bug in your codebase has to land
            specifically in the one file that calls <code>createPolicy</code> to
            be exploitable. That&apos;s a shockingly large blast-radius
            reduction for what amounts to a config object and a one-time
            refactor.
          </p>

          <h2>Where to go next</h2>

          <p>
            The full options surface for <code>secureHeaders()</code> is in the{" "}
            <Link href="/docs/security">security docs</Link>
            {", "}which also show how this fits with CSRF, sessions, and the
            rest of the defenses. If you want to see the actual generator,
            it&apos;s a small file: open <code>src/middleware.ts</code> and
            search for <code>buildCspHeader</code>
            {": "}it&apos;s about thirty lines.
          </p>

          <p>
            Thanks for reading. Now go grep your codebase for{" "}
            <code>.innerHTML =</code>
            {". "}Whatever the number is, it&apos;s either smaller than you
            fear or much, much larger. Both outcomes are useful information.
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
                href="/docs/security"
                className="underline underline-offset-4"
              >
                Read the security docs
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
