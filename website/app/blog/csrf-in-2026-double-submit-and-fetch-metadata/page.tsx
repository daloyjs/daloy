import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "csrf-in-2026-double-submit-and-fetch-metadata",
  title:
    "CSRF in 2026: Why DaloyJS Ships Both Double-Submit and Fetch-Metadata",
  description:
    'A short history of the double-submit cookie, the case for tokenless protection via Sec-Fetch-Site, when each one fails, and why strategy: "both" is the realistic default for apps that still have to serve a 2018 mobile browser somewhere.',
  date: "2026-05-23",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work. Has shipped at least one CSRF bug per year, on schedule, regardless of framework. Currently writes TypeScript from Norway.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "CSRF DaloyJS",
    "double-submit cookie",
    "Sec-Fetch-Site CSRF",
    "Fetch Metadata Request Headers",
    "csrf strategy both",
    "tokenless CSRF",
    "__Host- cookie prefix",
    "CSRF allowedOrigins",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DOUBLE_SUBMIT_BASIC = `// src/app.ts, classic double-submit (the 2015 way, still works)
import { App, csrf } from "@daloyjs/core";

export const app = new App();

app.use(
  csrf({
    strategy: "double-submit",
    // cookieName defaults to "__Host-daloy.csrf"
    // headerName defaults to "x-csrf-token"
  }),
);

// On safe methods (GET/HEAD/OPTIONS), the middleware ensures a fresh
// token is on the response cookie if one isn't already on the request.
// The token is also exposed on ctx.state.csrfToken for SSR templates.

app.route({
  method: "GET",
  path: "/csrf",
  operationId: "getCsrfToken",
  responses: { 200: { description: "token" } },
  handler: async ({ state }) => ({
    status: 200,
    body: { token: state.csrfToken },
  }),
});`;

const FETCH_METADATA_BASIC = `// src/app.ts, fetch-metadata (the 2026 way, no token at all)
import { App, csrf } from "@daloyjs/core";

export const app = new App();

app.use(
  csrf({
    strategy: "fetch-metadata",
    // Tell the middleware which origins are allowed when a request arrives
    // without Sec-Fetch-Site (legacy browsers) or with cross-site/same-site.
    allowedOrigins: ["https://app.example.com"],
  }),
);

// No cookie issued. No token to echo. The browser does the work.
// Sec-Fetch-Site: same-origin | none  → allow
// Sec-Fetch-Site: same-site | cross-site → must be in allowedOrigins
// Sec-Fetch-Site missing                 → Origin / Referer must be in allowedOrigins`;

const BOTH_STRATEGY = `// src/app.ts, defense-in-depth: require both
import { App, csrf, session } from "@daloyjs/core";

export const app = new App();

app.use(session({ secret: process.env.SESSION_SECRET! }));

app.use(
  csrf({
    strategy: "both",
    allowedOrigins: (origin) =>
      origin === "https://app.example.com" ||
      origin.endsWith(".previews.example.com"),
    cookieOptions: {
      sameSite: "Lax", // default; "Strict" if you don't need cross-tab logins
      secure: true,    // default; required for __Host-
      maxAgeSeconds: 60 * 60 * 8, // 8h instead of session cookie
    },
  }),
);

// On a mutating request both checks must pass:
//   1) Sec-Fetch-Site (or Origin / Referer fallback) says it's safe
//   2) The double-submit token in the header matches the cookie (timing-safe)`;

const STRATEGY_DECISION_FLOW = `# When do you reach for which strategy?

double-submit  →  You serve any browser older than ~2020,
                  OR you embed in iframes you don't control,
                  OR you have JS that already sets a header anyway.

fetch-metadata →  Your client is a modern SPA, mobile webview,
                  or a server-side fetch that you control.
                  You don't want to teach the frontend to mint tokens.

both           →  Production app, mixed clients, no real cost.
                  This is the default I reach for.`;

const FAILURE_MATRIX = `// What gets rejected, and how, under each strategy.
// (All rejections are 403 Forbidden, RFC 9457 problem+json.)

// strategy: "double-submit"
//   POST /pay without x-csrf-token header     → 403 (no token)
//   POST /pay with header but no cookie        → 403 (no cookie)
//   POST /pay with mismatched header & cookie  → 403 (timing-safe mismatch)
//   GET  /pay from any origin                  → allowed (safe method)

// strategy: "fetch-metadata"
//   POST /pay, Sec-Fetch-Site: same-origin     → allowed
//   POST /pay, Sec-Fetch-Site: none            → allowed (e.g. address bar)
//   POST /pay, Sec-Fetch-Site: cross-site, Origin allowlisted → allowed
//   POST /pay, Sec-Fetch-Site: cross-site, Origin not listed  → 403
//   POST /pay, no Sec-Fetch-Site (legacy), Origin or Referer allowlisted → allowed
//   POST /pay, no Sec-Fetch-Site, no Origin, no Referer → 403

// strategy: "both"
//   POST /pay, fetch-metadata passes, double-submit fails → 403
//   POST /pay, double-submit passes, fetch-metadata fails → 403
//   POST /pay, both pass → allowed`;

const CONSTRUCTION_TIME = `// These all throw at app boot, not at request time, not in prod under load.
// You find out before your container reports "ready".

csrf({ strategy: "tripple-submit" });
// Error: csrf(): strategy must be "double-submit", "fetch-metadata", or "both".

csrf({ cookieName: "csrf token" });
// Error: csrf(): cookieName is not a valid cookie name.

csrf({ cookieName: "csrf", cookieOptions: { sameSite: "lax" as never } });
// Error: csrf(): cookieOptions.sameSite must be "Strict", "Lax", or "None".

csrf({ cookieOptions: { path: "api" } });
// Error: csrf(): cookieOptions.path must start with "/".

csrf({ cookieOptions: { secure: false } });
// Error: csrf(): "__Host-" cookie names require secure: true, path: "/", and no domain.

csrf({ cookieOptions: { sameSite: "None", secure: false } });
// Error: csrf(): cookieOptions.sameSite: "None" requires secure: true.`;

const FRONTEND_USAGE = `// apps/web/lib/csrf-fetch.ts, one helper, every mutation goes through it.
function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\\]\\\\\\/+^]/g, "\\\\$&") + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";

  const headers = new Headers(init.headers);
  if (!isSafe) {
    const token = readCookie("__Host-daloy.csrf");
    if (token) headers.set("x-csrf-token", token);
  }

  return fetch(input, { ...init, headers, credentials: "include" });
}`;

const RFC_QUIRK = `# A common surprise from the RFC:
# Sec-Fetch-Site can be "none" - that's NOT a placeholder, it means
# the request originated from a top-level browser action with no document
# context (typing the URL into the address bar, clicking a bookmark, a
# server-initiated redirect, etc.). It IS safe by definition.
#
# So this is the correct allow rule:
#   Sec-Fetch-Site: "same-origin" → allow
#   Sec-Fetch-Site: "none"        → allow
#   anything else                  → check the allowlist`;

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
 * EditorFrame - VS Code-style chrome around a code sample, kept local to
 * this post so the file is self-contained.
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
 * StrategyCard - short summary box for each of the three strategies.
 */
function StrategyCard({
  name,
  tag,
  good,
  bad,
}: {
  name: string;
  tag: string;
  good: readonly string[];
  bad: readonly string[];
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-semibold tracking-tight">{name}</h4>
        <Badge variant="outline" className="font-mono">
          {tag}
        </Badge>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            holds up against
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {good.map((g) => (
              <li key={g} className="flex gap-2">
                <span aria-hidden className="text-emerald-500">
                  ✓
                </span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            breaks under
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {bad.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden className="text-amber-500">
                  !
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
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
            Hi, I&apos;m Devlin. Ten years of fullstack work. I have, at some
            point, written every CSRF bug a person can write. The classic{" "}
            <code>
              &lt;img src=&quot;https://your-bank/transfer?amount=...&quot;&gt;
            </code>{" "}
            from the early 2010s. The &quot;we forgot to send the token from the
            new mobile app&quot; from the mid 2010s. The &quot;we set
            <code> SameSite=None</code> for the iframe and then forgot to set
            <code> Secure</code>&quot; one from a year I don&apos;t want to
            name. So when the team sat down to decide what CSRF should look like
            in DaloyJS, my entire request was: please make it unsurprising.
          </p>

          <p>
            This post is the result. We ship two strategies, the classic
            <em> double-submit cookie</em> and the modern{" "}
            <em>Fetch-Metadata</em> check, and a third option,{" "}
            <code>strategy: &quot;both&quot;</code>, that runs both of them. I
            want to walk through why, when each one fails, and why
            &quot;both&quot; is the boring grown-up default for most production
            apps in 2026.
          </p>

          <h2>A two-minute history of CSRF defenses</h2>

          <p>
            CSRF exists because the browser cheerfully attaches your cookies to
            any cross-origin request, including ones the attacker tricks your
            tab into making. The defense lineage roughly goes:
          </p>

          <ol>
            <li>
              <strong>Synchronizer tokens</strong> (2005-ish), server stamps a
              token into a hidden form field, server keeps it in session,
              compares on submit. Works, but requires server-side state and dies
              the moment you have a stateless API.
            </li>
            <li>
              <strong>Double-submit cookie</strong> (2010s), server sets a
              random token in a cookie, frontend echoes it back as a header (or
              hidden field). The browser&apos;s same-origin policy prevents an
              attacker page from reading the cookie, so the echo proves the
              request came from a page that <em>could</em> read it. Stateless,
              framework-friendly. This is what the JS world ran on for a decade.
            </li>
            <li>
              <strong>SameSite cookies</strong> (2017-2020), browsers started
              defaulting cookies to <code>SameSite=Lax</code>, which actually
              eliminates the most naive CSRF without any application code.
              Great, but partial: <code>Lax</code> still allows top-level{" "}
              <code>GET</code> navigations, and apps that need cross-site
              cookies (third-party widgets, SSO) have to opt out.
            </li>
            <li>
              <strong>Fetch Metadata Request Headers</strong> (2020+), the
              browser itself starts telling the server{" "}
              <em>where this request came from</em>, via{" "}
              <code>Sec-Fetch-Site</code>, <code>Sec-Fetch-Mode</code>,{" "}
              <code>Sec-Fetch-Dest</code>. With one rule, &quot;reject mutating
              requests whose <code>Sec-Fetch-Site</code> isn&apos;t{" "}
              <code>same-origin</code> or <code>none</code>&quot;, you can ditch
              the token entirely on modern browsers.
            </li>
          </ol>

          <p>
            All four defenses still exist in the wild. They are not mutually
            exclusive. They protect against slightly different threat models.
            That&apos;s why we ship two of them and let you run them together.
          </p>

          <h2>Strategy 1: double-submit, the way we&apos;ve always done it</h2>

          <p>
            Three lines. The middleware mints a 32-byte URL-safe token, sets it
            as <code>__Host-daloy.csrf</code>, and on any mutating method it
            requires the request to echo the same value in{" "}
            <code>x-csrf-token</code>. The comparison is timing-safe.
          </p>

          <EditorFrame
            files={["src/app.ts", "src/routes/csrf.ts"]}
            activeFile="src/app.ts"
            status="csrf · double-submit · cookie=__Host-daloy.csrf"
          >
            <CodeBlock language="ts" code={DOUBLE_SUBMIT_BASIC} />
          </EditorFrame>

          <StrategyCard
            name="double-submit cookie"
            tag='strategy: "double-submit"'
            good={[
              "Browsers from before Sec-Fetch-Site shipped",
              "Server-rendered forms (token in a hidden input)",
              "iframes you don't control, as long as JS can read the cookie",
              "Apps where every fetch already goes through one helper",
            ]}
            bad={[
              "Frontends that forget to set the header (this is the #1 bug)",
              "JS-less workflows, no cookie reader, no echo",
              "XSS, if an attacker can read your cookies, this falls",
              "Cookieless API clients (mobile apps, server-to-server)",
            ]}
          />

          <p>
            The single most common bug with double-submit is forgetting to send
            the header from the frontend. That bug isn&apos;t actually a CSRF
            vulnerability, it just looks like one to users, who cheerfully
            report &quot;the save button is broken&quot; on a Friday afternoon.
            The fix is to centralize: one <code>csrfFetch()</code> helper, every
            mutation goes through it.
          </p>

          <EditorFrame
            files={["apps/web/lib/csrf-fetch.ts"]}
            activeFile="apps/web/lib/csrf-fetch.ts"
            status="every POST/PUT/PATCH/DELETE goes through here"
          >
            <CodeBlock language="ts" code={FRONTEND_USAGE} />
          </EditorFrame>

          <h2>Strategy 2: fetch-metadata, the way browsers want to help</h2>

          <p>
            Here is the part that I genuinely think is underrated. Every modern
            browser, on every request, sends a <code>Sec-Fetch-Site</code>{" "}
            header that tells you, definitively, whether the request is
            same-origin or cross-site. <strong>The browser</strong> tells you.
            The attacker page cannot forge it; it&apos;s on the list of
            forbidden response headers, the user&apos;s browser puts it there,
            end of story.
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="csrf · fetch-metadata · no cookie issued"
          >
            <CodeBlock language="ts" code={FETCH_METADATA_BASIC} />
          </EditorFrame>

          <StrategyCard
            name="fetch-metadata"
            tag='strategy: "fetch-metadata"'
            good={[
              "Any modern browser (Chrome 76+, Firefox 90+, Safari 16.4+)",
              "Native fetch from SPAs / mobile webviews / Workers",
              "Server-to-server clients you own (you set the allowlist)",
              "JS-less server-rendered forms, yes, really; same-origin POST still says so",
            ]}
            bad={[
              "Cross-origin SSO redirects that go through your endpoint mid-flow",
              "Truly legacy browsers (you fall back to Origin / Referer)",
              "Server-to-server calls from clients you don't control (no Sec-Fetch-Site)",
            ]}
          />

          <p>
            There is a quirk in the spec that surprises everyone the first time,
            including me:
          </p>

          <CodeBlock language="bash" code={RFC_QUIRK} />

          <p>
            We allow <code>same-origin</code> and <code>none</code>, fall back
            to <code>allowedOrigins</code> for everything else, and on legacy
            browsers (no <code>Sec-Fetch-Site</code> at all) we check
            <code> Origin</code> and then <code>Referer</code> against the same
            allowlist. That last step is the one that keeps your support
            engineer from getting paged about &quot;my Android 9 device
            can&apos;t check out&quot;.
          </p>

          <h2>The allowedOrigins story</h2>

          <p>
            <code>allowedOrigins</code> is the only configuration that matters
            once you pick fetch-metadata. It accepts a string array or a
            predicate, and it is used in three different places:
          </p>

          <ul>
            <li>
              When <code>Sec-Fetch-Site</code> is <code>same-site</code> or
              <code> cross-site</code>: usually because of a subdomain or a user
              opening your site via a partner, we check the request&apos;s
              <code> Origin</code> against the allowlist.
            </li>
            <li>
              When <code>Sec-Fetch-Site</code> is missing entirely (legacy
              browser, some embedded webviews), we check <code>Origin</code>{" "}
              first, and if that&apos;s also missing we fall back to the origin
              of the <code>Referer</code> URL.
            </li>
            <li>
              Predicates are how you handle wildcards like preview deployments,
              where you can&apos;t enumerate origins ahead of time:
            </li>
          </ul>

          <CodeBlock
            language="ts"
            code={`csrf({
  strategy: "fetch-metadata",
  allowedOrigins: (origin) =>
    origin === "https://app.example.com" ||
    origin.endsWith(".previews.example.com"),
});`}
          />

          <p>
            One rule for predicates: keep them <em>small</em> and{" "}
            <em>readable</em>. The instant your predicate looks like a regex
            engine, you have introduced a different CSRF vector, the one where a
            future engineer misreads it.
          </p>

          <h2>Strategy 3: both, the realistic production default</h2>

          <p>
            Most apps I&apos;ve shipped in the last three years have ended up
            here, and not because we couldn&apos;t pick a side. The reason is
            simple, the two strategies are <em>cheap</em> to run together, and
            they fail in different ways:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="csrf · both · fail-on-either"
          >
            <CodeBlock language="ts" code={BOTH_STRATEGY} />
          </EditorFrame>

          <p>
            Together they act as a 2-of-2: a CSRF attempt would need to (a) defeat the
            browser&apos;s <code>Sec-Fetch-Site</code> reporting <em>and</em>{" "}
            (b) read the <code>__Host-</code> cookie from your origin to mirror
            it back. The first is essentially &quot;break the browser&quot;; the
            second is &quot;break the same-origin policy or already own your
            DOM&quot;. Either of those means you have considerably larger
            problems than CSRF.
          </p>

          <StrategyCard
            name="both"
            tag='strategy: "both"'
            good={[
              "Production apps with mixed-modernity clients",
              "Multi-tenant subdomains with shared cookies",
              "Apps that already have a csrfFetch helper, no cost to add",
            ]}
            bad={[
              "Pure server-to-server APIs with no browser involvement (use bearer auth instead)",
              "Tiny demos where double-clicking 'send' is the entire frontend",
            ]}
          />

          <h2>When each one fails, in one screen</h2>

          <p>
            This is the cheat sheet I keep in a comment at the top of the
            middleware setup, because I forget the exact rules every six months
            and I do not enjoy re-reading specs:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="cheat sheet · 403 = always RFC 9457 problem+json"
          >
            <CodeBlock language="ts" code={FAILURE_MATRIX} />
          </EditorFrame>

          <h2>Construction-time validation: find out at boot, not at 3am</h2>

          <p>
            One of my favorite quiet features of the CSRF middleware is that
            most of the validation runs{" "}
            <em>
              when you call <code>csrf()</code>
            </em>
            , not when a request arrives. A typo in the strategy string, a
            cookie name with a space, a <code>__Host-</code> cookie without
            <code> secure: true</code>, a <code>SameSite=None</code> without
            <code> Secure</code>: every one of these throws at app boot, with a
            message that tells you exactly what to fix:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="(each line throws synchronously at startup)"
          >
            <CodeBlock language="ts" code={CONSTRUCTION_TIME} />
          </EditorFrame>

          <p>
            This is one of those things you only appreciate after you&apos;ve
            shipped a CSRF config bug to production and had it manifest as
            &quot;every fifth user gets a 403 but only on Tuesdays&quot;.
            Failing at boot is the only acceptable failure mode for security
            middleware configuration. If it boots, it&apos;s configured.
          </p>

          <h2>Picking a strategy: the actually-short version</h2>

          <CodeBlock language="bash" code={STRATEGY_DECISION_FLOW} />

          <p>
            If you only take one line away from this post:{" "}
            <code>strategy: &quot;both&quot;</code> is the safest default that
            doesn&apos;t cost anything extra, and the <code>__Host-</code>{" "}
            cookie prefix does half the security work for free. Set both, sleep
            better.
          </p>

          <h2>The honest part</h2>

          <p>
            CSRF, as a class, is mostly a solved problem in 2026, between
            <code> SameSite=Lax</code> defaults, Fetch-Metadata reporting, and
            double-submit being two lines away, the surviving bugs are almost
            always configuration bugs (a cookie set without <code>Secure</code>,
            an <code>allowedOrigins</code> that happens to match every preview
            deploy ever, a frontend that forgot to call the helper). What we
            tried to do with this middleware is make those configuration bugs
            throw at boot instead of leaking into production. The strategies
            themselves are well-trodden ground. The <em>fail fast</em> part is
            what I&apos;m proudest of.
          </p>

          <p>
            If you want the full surface area, the{" "}
            <Link href="/docs/security/csrf">CSRF docs</Link> have every option
            and an end-to-end example with a session. The{" "}
            <Link href="/docs/security">security overview</Link> walks through
            how this fits with <code>secureHeaders()</code> and sessions.
          </p>

          <p>
            Thanks for reading. Now go look at your frontend&apos;s
            <code> fetch</code> helper and make sure every mutation actually
            goes through it. Don&apos;t ask me why I know to suggest that.
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
                href="/docs/security/csrf"
                className="underline underline-offset-4"
              >
                Read the CSRF docs
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
