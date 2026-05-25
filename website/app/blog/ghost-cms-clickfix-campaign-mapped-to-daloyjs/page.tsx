import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "ghost-cms-clickfix-campaign-mapped-to-daloyjs",
  title:
    "The Ghost CMS / ClickFix Campaign, Mapped to DaloyJS — Plus the One Default We Just Tightened",
  description:
    "A pre-auth SQL injection in Ghost CMS (CVE-2026-26980) is being exploited at scale to hijack 700+ sites — including Harvard, Oxford, and DuckDuckGo — and serve a fake Cloudflare \"verify you are human\" prompt that silently stuffs a PowerShell one-liner into the visitor's clipboard. Most of the chain was already blocked by DaloyJS defaults; the last mile (the clipboard write) wasn't. Here's the stage-by-stage mapping and the one-line default we changed in response.",
  date: "2026-05-25",
  readingTime: "8 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Ghost CMS SQL injection",
    "CVE-2026-26980",
    "ClickFix attack",
    "navigator.clipboard.writeText",
    "Permissions-Policy clipboard-write",
    "secureHeaders defaults",
    "DaloyJS security",
    "stored XSS via admin API",
    "fake Cloudflare verify human",
    "Content-Security-Policy frame-ancestors",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DEFAULT_HEADERS = `# What 'app.use(secureHeaders())' actually sends — auto-installed on
# every App() unless you pass 'secureDefaults: false'.
content-security-policy: default-src 'self'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
permissions-policy: camera=(), microphone=(), geolocation=(), clipboard-write=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin`;

const CLIPBOARD_WRITE = `// In the Ghost CMS / ClickFix attack chain, this is the line that does
// the damage. After the visitor clicks the fake "Verify you are human"
// checkbox, the injected script silently runs:
await navigator.clipboard.writeText(
  "powershell -nop -w hidden -e <base64 blob>"
);
// The victim is then told to press Win+R, paste, and hit Enter — and
// they run the attacker's command without ever seeing a prompt.
//
// With 'permissions-policy: clipboard-write=()' set on the parent
// document, the browser rejects the call with a SecurityError before a
// single byte hits the clipboard. The same rule applies inside any
// iframe loaded into that page, because iframes can never escalate
// past the parent's Permissions-Policy.`;

const PARAMETERIZED_SQL = `// What CVE-2026-26980 looked like: a query parameter on Ghost's
// admin API was concatenated straight into a SQL string. DaloyJS
// doesn't ship its own ORM (zero runtime deps, by design), but every
// docs example uses parameterized queries. The 'website/app/docs/
// security/sql-injection' page walks through pg, postgres, better-
// sqlite3, and Prisma.
import { App } from "@daloyjs/core";
import postgres from "postgres";
import { z } from "zod";

const sql = postgres(process.env.DATABASE_URL!);
const app = new App();

app.route({
  method: "GET",
  path: "/posts/:slug",
  operationId: "getPost",
  // .strict() rejects unknown query params before the handler ever sees them.
  params: z.object({ slug: z.string().min(1).max(120).strict() }),
  responses: { 200: { description: "ok" } },
  handler: async ({ params }) => {
    // Tagged template = parameterised. The slug is bound, not interpolated.
    const rows = await sql\`select id, title from posts where slug = \${params.slug}\`;
    return { status: 200 as const, body: rows[0] ?? null };
  },
});`;

const JWT_DEFENSES = `// What lets Ghost-style "steal the admin API key, then publish posts
// with malicious JS" not work against a DaloyJS admin route.
import { createJwtVerifier } from "@daloyjs/core";

const verifier = createJwtVerifier({
  // 1. Alg allowlist — no 'alg: none', no HS256-from-RS256 confusion.
  algorithms: ["RS256"],
  // 2. JWKS rotation with kid-pinning (src/jwk.ts).
  jwksUrl: "https://idp.example.com/.well-known/jwks.json",
  // 3. RSA keys < 2048 bits refused at construction (weak_rsa_key).
  // 4. Revocation hook — point at Redis/DB; runs LAST so forged tokens
  //    never get to enumerate the blocklist.
  isRevoked: async (verified) => redis.sIsMember("revoked:jti", verified.jti),
  issuer: "https://idp.example.com/",
  audience: "https://api.example.com",
});

// 5. All bytes-vs-bytes comparisons go through timingSafeEqual (gated
//    by verify:secret-comparisons), so leaked-key timing oracles don't
//    work either.`;

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

function StageCard({
  stage,
  ghost,
  daloyjs,
}: {
  stage: string;
  ghost: string;
  daloyjs: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{stage}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          What happened in Ghost
        </dt>
        <dd>{ghost}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS posture
        </dt>
        <dd className="text-muted-foreground">{daloyjs}</dd>
      </dl>
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
            <Badge variant="outline">Stored XSS</Badge>
            <Badge variant="outline">Social engineering</Badge>
            <Badge variant="outline">Incident mapping</Badge>
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
            Same question, different week. A reader sent over{" "}
            <a
              href="https://www.bleepingcomputer.com/news/security/ghost-cms-sql-injection-flaw-exploited-in-large-scale-clickfix-campaign/"
              target="_blank"
              rel="noopener noreferrer"
            >
              BleepingComputer&apos;s write-up of the Ghost CMS / ClickFix
              campaign
            </a>{" "}
            and asked:{" "}
            <em>are we doing anything about this — and if not, can we?</em> I
            love that question because it forces me to actually look at the
            framework instead of telling myself nice stories about it. So I
            looked. The answer was &quot;mostly yes, but there was one default I
            hadn&apos;t closed&quot; — which is a polite way of saying I missed
            it. This post is the stage-by-stage mapping plus the one-line change
            I shipped to
            <code> secureHeaders()</code> after I stopped feeling embarrassed.
          </p>

          <p>
            Short version of the incident, for context: XLab researchers found a
            campaign exploiting{" "}
            <a
              href="https://nvd.nist.gov/vuln/detail/CVE-2026-26980"
              target="_blank"
              rel="noopener noreferrer"
            >
              CVE-2026-26980
            </a>{" "}
            — a pre-auth SQL injection in Ghost CMS 3.24.0 → 6.19.0 — across
            more than <strong>700 domains</strong>, including Harvard, Oxford,
            Auburn, and DuckDuckGo. Ghost shipped the fix in 6.19.1 back on
            February&nbsp;19, 2026. Three months later, plenty of sites were
            still on the vulnerable version. I&apos;ve been the person who
            didn&apos;t patch in time before. It happens to everyone exactly
            once before they automate it.
          </p>

          <p>The attack chain has five distinct stages:</p>

          <ol>
            <li>
              <strong>SQLi</strong> — read arbitrary rows from the Ghost
              database, including the <strong>admin API keys</strong>.
            </li>
            <li>
              <strong>Privilege escalation via stolen API key</strong> — use the
              admin key to log into the admin API as a manager.
            </li>
            <li>
              <strong>Stored XSS</strong> — inject <code>&lt;script&gt;</code>{" "}
              tags into published articles.
            </li>
            <li>
              <strong>Fake Cloudflare iframe</strong> — overlay a &quot;Verify
              you are human&quot; prompt loaded from attacker infrastructure.
            </li>
            <li>
              <strong>ClickFix clipboard stuffing</strong> — when the visitor
              clicks the fake checkbox, silently call{" "}
              <code>navigator.clipboard.writeText()</code> with a PowerShell
              payload and instruct the victim to paste it into Win+R.
            </li>
          </ol>

          <p>
            DaloyJS isn&apos;t a CMS — it&apos;s an HTTP framework — so stages 1
            and 2 only matter for users who build a Ghost-shaped app on top of
            Daloy. Stages 3, 4, and 5 matter for <em>any</em> HTML surface Daloy
            serves. Here&apos;s how each stage maps to what was already in the
            box, and the one default we tightened in response to stage 5.
          </p>

          <h2>Stage 1 — Pre-auth SQL injection</h2>

          <StageCard
            stage="Database read via injection"
            ghost="A query parameter on a public Ghost endpoint was concatenated into a SQL string. Unauthenticated attackers could dump arbitrary tables, including 'mobiledoc_revisions' and the row holding admin API keys."
            daloyjs="DaloyJS doesn't ship an ORM (zero runtime deps in @daloyjs/core), but every docs example uses parameterised queries — pg tagged templates, postgres.js, better-sqlite3 prepared statements, or Prisma. 'website/app/docs/security/sql-injection' walks through each, and explicitly calls out the 'knex.raw(`${input}`)' template-literal footgun. The Standard Schema .strict() validator on params/query/body rejects unknown shapes before the handler runs, which removes the 'unexpected JSON in a query param' attack surface that often leads to SQLi in the first place."
          />

          <CodeBlock language="typescript" code={PARAMETERIZED_SQL} />

          <h2>Stage 2 — Stolen admin API key</h2>

          <StageCard
            stage="Privilege escalation via leaked credential"
            ghost="Ghost's admin API keys were sitting in the table the SQLi could read, and the API verified them with a non-constant-time string compare. Once stolen, the keys gave full management access — create users, edit themes, publish posts."
            daloyjs="Every bytes-vs-bytes comparison in the framework goes through 'timingSafeEqual' — enforced by 'verify:secret-comparisons' at publish time, so we structurally can't reintroduce the bug. JWT verification ships an algorithm allowlist (no 'alg: none', no HS256-vs-RS256 confusion), a 2048-bit RSA floor ('weak_rsa_key'), JWKS rotation with kid-pinning, and an 'isRevoked' hook that runs LAST so forged tokens never enumerate the blocklist. The 'assertStrongSecret' guard refuses weak HMAC secrets at boot."
          />

          <CodeBlock language="typescript" code={JWT_DEFENSES} />

          <h2>Stage 3 — Stored XSS via admin API</h2>

          <StageCard
            stage="Injected <script> on every article view"
            ghost="With the admin key in hand, attackers edited live articles and embedded a lightweight loader script. Because Ghost renders post bodies as HTML, the script ran in the site's own origin on every page view."
            daloyjs="The default 'content-security-policy: default-src \\'self\\'; frame-ancestors \\'none\\'' refuses inline scripts and cross-origin script sources out of the box. The CSP nonce + Trusted Types path ('csp-nonces-and-trusted-types-without-tears' blog post) lets you serve necessary inline scripts without 'unsafe-inline'. 'frame-ancestors \\'none\\'' blocks the page from being embedded by an attacker, and the dual-knob refuse-to-boot guard in secureHeaders() refuses to construct if you disable BOTH X-Frame-Options AND frame-ancestors at once. For user-generated HTML specifically, the response-body schema validator + .strict() on body params + 'isForbiddenObjectKey' parser guard reduce the surface where unsanitised HTML can sneak in."
          />

          <h2>Stage 4 — Fake Cloudflare iframe overlay</h2>

          <StageCard
            stage="Cross-origin iframe loaded over the article"
            ghost="The injected loader fetched a second-stage script that built an iframe pointing at the attacker's 'verify-you-are-human' page and overlaid it on top of the article."
            daloyjs="The default CSP 'frame-ancestors none' stops attacker pages from embedding YOUR Daloy app. The mirror — stopping YOUR Daloy app from embedding attacker pages — is a one-line opt-in: pass a 'frame-src' allowlist (e.g. just 'self') in secureHeaders() contentSecurityPolicy directives. Combined with COOP: same-origin and CORP: same-origin (both defaults), this neutralises the cross-window communication channel the overlay needs."
          />

          <h2>Stage 5 — ClickFix clipboard stuffing</h2>

          <StageCard
            stage="navigator.clipboard.writeText() called silently"
            ghost="When the visitor clicks the fake 'Verify you are human' checkbox (which counts as user activation), the page silently calls navigator.clipboard.writeText() with a base64-encoded PowerShell one-liner, then displays 'Press Win+R, paste, hit Enter'. Most victims paste without reading. I would probably paste without reading on a bad day too."
            daloyjs="This is the gap I missed. CSP doesn't cover the Clipboard API — it controls WHERE script can come from, not WHAT script can do once it's running. The right defence is the Permissions-Policy header, and 'clipboard-write' has been in the spec for years. I just hadn't put it in the default string. Now I have: secureHeaders() ships 'clipboard-write=()' alongside the existing camera/microphone/geolocation denials. Override only if your HTML surface legitimately needs 'Copy' buttons."
          />

          <CodeBlock language="javascript" code={CLIPBOARD_WRITE} />

          <h2>The new default, in full</h2>

          <CodeBlock language="text" code={DEFAULT_HEADERS} />

          <p>
            The only changed line is the <code>permissions-policy</code> one;
            everything else has been the default for releases. With{" "}
            <code>clipboard-write=()</code> in place, even if attacker JS slips
            past your CSP and runs in your origin, calling{" "}
            <code>navigator.clipboard.writeText()</code> throws a{" "}
            <code>SecurityError</code> before a single byte hits the clipboard.
            Iframes inherit the parent&apos;s Permissions-Policy and can never
            escalate past it, so the &quot;fake Cloudflare iframe&quot; from
            stage 4 also can&apos;t fall back to writing its own clipboard if it
            ever managed to load.
          </p>

          <p>
            If your app is a CMS, an admin UI, or anything else where users
            click &quot;Copy&quot; buttons, opt back in explicitly — the
            override fully replaces the default (no merging), so be deliberate:
          </p>

          <CodeBlock
            language="typescript"
            code={`import { secureHeaders } from "@daloyjs/core";

app.use(secureHeaders({
  // Keep the camera/mic/geo denials, allow clipboard-write to self.
  permissionsPolicy:
    "camera=(), microphone=(), geolocation=(), clipboard-write=(self)",
}));`}
          />

          <h2>What this attack would have needed to do on a DaloyJS app</h2>

          <ol>
            <li>
              Hand-roll a SQL string with user input — the docs example uses
              parameterised queries, and <code>.strict()</code> schemas reject
              the unexpected-shape inputs that often start SQLi.
            </li>
            <li>
              Compare the stolen admin key with <code>===</code> instead of{" "}
              <code>timingSafeEqual</code> — blocked by{" "}
              <code>verify:secret-comparisons</code> at publish time.
            </li>
            <li>
              Render attacker HTML without CSP — the default{" "}
              <code>default-src &apos;self&apos;</code> + Trusted Types path
              refuses inline + cross-origin scripts.
            </li>
            <li>
              Let attacker iframes load — opt in to <code>frame-src</code>{" "}
              allowlist; <code>frame-ancestors &apos;none&apos;</code> already
              stops the inverse (your page being embedded).
            </li>
            <li>
              Allow <code>navigator.clipboard.writeText()</code> from injected
              JS — blocked by the new{" "}
              <code>permissions-policy: clipboard-write=()</code> default.
            </li>
          </ol>

          <h2>What you should do in your own DaloyJS app</h2>

          <ul>
            <li>
              Update to the release that ships this default and don&apos;t
              override <code>permissionsPolicy</code> unless you genuinely need
              clipboard write. The override fully replaces the default, so
              re-list the camera/mic/geo denials if you set your own string.
            </li>
            <li>
              For HTML routes that render user-generated content (comments,
              wikis, articles), turn on the CSP nonce + Trusted Types path (see
              the{" "}
              <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
                CSP nonces post
              </Link>
              ) and serve user HTML with a sanitiser like <code>DOMPurify</code>{" "}
              on the server.
            </li>
            <li>
              Use parameterised queries everywhere. The{" "}
              <Link href="/docs/security/sql-injection">
                SQL injection page
              </Link>{" "}
              shows the four common drivers and the one template-literal footgun
              to avoid.
            </li>
            <li>
              If you mint admin API keys, run them through{" "}
              <code>timingSafeEqual</code> on every check and put a short-lived
              JWT on top with the algorithm allowlist + revocation hook.
              Long-lived shared secrets that compare with <code>===</code> are
              exactly what made the Ghost compromise so destructive.
            </li>
          </ul>

          <h2>The honest answer to the original question</h2>

          <p>
            <em>
              Are we doing anything to protect ourselves and the users of our
              framework against the Ghost CMS / ClickFix campaign?
            </em>{" "}
            Stages 1 through 4 were already covered — parameterised queries in
            every docs example, <code>timingSafeEqual</code> + JWT alg allowlist
            + revocation hook, CSP <code>default-src &apos;self&apos;</code>{" "}
            with the Trusted-Types path, and{" "}
            <code>frame-ancestors &apos;none&apos;</code>. Stage 5 — the silent
            clipboard write that makes the whole social engineering trick land —
            wasn&apos;t. So I changed the default. Add{" "}
            <code>clipboard-write=()</code> to the Permissions-Policy string,
            write the regression test, document the override pattern, ship it.
          </p>

          <p>
            That&apos;s the whole job of secure-by-default in my head: when the
            threat model moves, the default moves with it, and apps that already
            trust the framework inherit the fix on the next dependency bump
            without reading a CVE or running a migration script. If you have to
            read a security blog before your app is safe, the framework already
            failed you. I&apos;d rather feel a little dumb for missing this one
            line than ship a framework that quietly leaves it to you.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
              CSP nonces and Trusted Types without tears
            </Link>
            ,{" "}
            <Link href="/blog/aikido-top-10-app-security-problems-mapped-to-daloyjs">
              Aikido top 10 mapped to DaloyJS
            </Link>
            ,{" "}
            <Link href="/blog/litellm-teampcp-poisoned-scanner-mapped-to-daloyjs">
              LiteLLM / TeamPCP mapped to DaloyJS
            </Link>
            , <Link href="/blog/secure-by-default">Secure by default</Link>.
            Relevant docs: <Link href="/docs/security">/docs/security</Link>,{" "}
            <Link href="/docs/security/sql-injection">SQL injection</Link>.
          </p>
        </div>
      </article>
    </main>
  );
}
