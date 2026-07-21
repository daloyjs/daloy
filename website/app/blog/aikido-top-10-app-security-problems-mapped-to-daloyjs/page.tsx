import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "aikido-top-10-app-security-problems-mapped-to-daloyjs",
  title:
    "Aikido's Top 10 App Security Problems, Mapped to DaloyJS (and the One Gap We Just Closed)",
  description:
    "Aikido's 'Top 10 App Security Problems' is the short, blunt version of the OWASP list, SQLi, XSS, SSRF, path traversal, XXE, deserialization, shell injection, LFI, prototype pollution, open redirects. Here's the honest per-item mapping of what a DaloyJS app already blocks by default, what one opt-in line adds, and how safeRedirect() closes the remaining gap.",
  date: "2026-05-24",
  readingTime: "10 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Aikido top 10 app security",
    "open redirect Node.js",
    "DaloyJS safeRedirect",
    "SSRF Node.js framework",
    "path traversal prototype pollution",
    "XSS deserialization XXE",
    "secure by default framework",
    "OWASP application security",
    "fetchGuard DaloyJS",
    "Aikido security mapped",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SAFE_REDIRECT = `// src/routes/login-callback.ts
import { safeRedirect } from "@daloyjs/core";

app.get("/login/callback", {
  acknowledgeNoResponseBodySchema: true,
  responses: { 303: {} },
}, (ctx) => {
  // \`?next=\` is attacker-controlled. Never trust it.
  const next = new URL(ctx.request.url).searchParams.get("next") ?? "/";

  return safeRedirect(next, {
    allowedPaths: ["/", "/dashboard", "/account"],
    allowedOrigins: ["https://app.example.com"],
    fallback: "/",        // bad input lands here instead of throwing
    // status defaults to 303 (See Other) - POST-redirect-GET-safe.
  });
});

// Things this refuses, by design:
//
//   /login/callback?next=//evil.com               -> protocol-relative
//   /login/callback?next=/\\evil.com               -> backslash bypass
//   /login/callback?next=javascript:alert(1)      -> scheme-not-allowed
//   /login/callback?next=https://evil.com         -> origin-not-allowed
//   /login/callback?next=/ok%0d%0aSet-Cookie:pwn  -> control characters`;

const FETCH_GUARD = `// SSRF defense at the runtime fetch boundary.
import { App, fetchGuard } from "@daloyjs/core";

export const app = new App();

app.use(fetchGuard({
  allow: ["https://api.example.com", "https://*.s3.amazonaws.com"],
  // Default-blocks 169.254.169.254 (cloud metadata),
  // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
  // ::1, fc00::/7. Redirects re-validate at every hop.
}));`;

const PROTO_SAFE = `// JSON parsing in DaloyJS strips dangerous keys before they reach
// your handler. There is no flag for this; it is the constructor.
new App();

// Posting this body:
//   { "__proto__": { "isAdmin": true }, "constructor": { "prototype": {} } }
//
// reaches your handler as:
//   { }
//
// The discarded keys are logged at debug level. The empty schema
// validation result speaks for itself - your code never sees them.`;

const PATH_TRAVERSAL = `// Path traversal payloads are rejected at the routing layer,
// before any handler runs.
//
//   GET /files/..%2F..%2Fetc%2Fpasswd   -> 400 BadRequest
//   GET /files/..%252F                  -> 400 BadRequest (double-encoded)
//   GET /files/%00../secret             -> 400 BadRequest (encoded NUL)
//
// When a handler needs to accept a *user-supplied* file path -
// download links, attachment storage - use the helpers in @daloyjs/core:
import { assertSafeRelativePath, sanitizeFilename } from "@daloyjs/core";

app.post("/upload", async (ctx) => {
  const body = await ctx.req.formData();
  const file = body.get("file") as File;
  const name = sanitizeFilename(file.name);   // strips .., /, \\, NUL, control chars
  assertSafeRelativePath(name);               // throws on any escape sequence
  // safe to join with your storage root now
});`;

const NOSQL_GUARD = `// Mongo / NoSQL operator injection, \\$ne, \\$gt, \\$where as object
// values - is a one-liner refusal in DaloyJS.
import { assertNoMongoOperators } from "@daloyjs/core";

app.post("/users/login", async (ctx) => {
  const body = await ctx.req.json();
  assertNoMongoOperators(body); // throws on { password: { $ne: null } } etc.
  // proceed with your authenticator
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

type ItemStatus = "default" | "opt-in" | "n/a" | "gap-closed";

const STATUS_COPY: Record<ItemStatus, { label: string; tone: string }> = {
  default: { label: "On by default", tone: "default" },
  "opt-in": { label: "One opt-in line", tone: "secondary" },
  "n/a": { label: "Not applicable", tone: "outline" },
  "gap-closed": { label: "Gap closed", tone: "destructive" },
};

function ThreatCard({
  num,
  threat,
  status,
  framework,
  user,
}: {
  num: number;
  threat: string;
  status: ItemStatus;
  framework: string;
  user: string;
}) {
  const meta = STATUS_COPY[status];
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">
          #{num}
        </Badge>
        <span className="text-base font-semibold">{threat}</span>
        <Badge
          variant={
            meta.tone === "default"
              ? "default"
              : meta.tone === "secondary"
                ? "secondary"
                : meta.tone === "destructive"
                  ? "destructive"
                  : "outline"
          }
        >
          {meta.label}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You still own
        </dt>
        <dd className="text-muted-foreground">{user}</dd>
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
            <Badge variant="outline">Field report</Badge>
            <Badge variant="default">Gap closed</Badge>
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
            A reader pinged me with{" "}
            <a
              href="https://www.aikido.dev/blog/app-security-problems-top-10"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aikido&apos;s &quot;Top 10 App Security Problems&quot; post
            </a>{" "}
            and the same question I get every time one of these lists makes the
            rounds: <em>are we doing anything about this?</em> It&apos;s a fair
            question. The post is a no-nonsense run-down, SQL/NoSQL injection,
            XSS, SSRF, path traversal, XXE, deserialization, shell injection,
            LFI, prototype pollution, open redirects. The basics. The stuff
            that&apos;s been on every top-10 list since 2007 and still ships in
            production CVEs every week.
          </p>

          <p>
            I went down the list with our framework open in another window. The
            honest result: <strong>nine out of ten are already covered</strong>
            {", "}
            most of them by default, a couple with a single opt-in line. One,{" "}
            <em>open redirects</em>
            {": "}was a real gap. So I shipped the
            <code>safeRedirect()</code> helper you will see below.
          </p>

          <p>
            Below is the per-item map. No marketing voice, no &quot;trust us,
            we&apos;re secure.&quot; Just what the constructor gives you, what
            you opt into, and what stays your problem.
          </p>

          <h2>#1: SQL &amp; NoSQL injection</h2>

          <ThreatCard
            num={1}
            threat="SQL / NoSQL injection"
            status="opt-in"
            framework="Standard Schema validation (Zod / Valibot / ArkType) with .strict() rejects unknown keys at the request boundary. assertNoMongoOperators() refuses $-prefixed keys in user bodies. CI gate verify:no-encoded-payloads catches base64-blob injection at PR time."
            user="Use a parameterized query / prepared statement library (postgres.js, mysql2, Prisma), DaloyJS isn't an ORM and never builds query strings for you."
          />

          <p>
            The injection itself happens at your database driver, not at the
            HTTP layer, so this is half-shared. What DaloyJS does is make the
            two classic Mongo-flavored payloads impossible to pass through the
            request boundary unnoticed:
          </p>

          <CodeBlock language="ts" code={NOSQL_GUARD} />

          <p>
            For SQL, the framework&apos;s contribution is that validated input
            comes out as the type you declared. A schema that expects{" "}
            <code>email: z.email()</code> will not let{" "}
            <code>email = &quot; OR 1=1 --&quot;</code> reach your handler
            looking like a string. You still have to call the driver correctly,
            but you don&apos;t get to claim you concatenated a string
            &quot;because the type system told you to.&quot;
          </p>

          <h2>#2: Cross-site scripting (XSS)</h2>

          <ThreatCard
            num={2}
            threat="Reflected & stored XSS"
            status="default"
            framework="secureHeaders() (on the moment you call it) emits a strict CSP with per-request nonces and Trusted Types. JSON responses ship with X-Content-Type-Options: nosniff. The built-in /docs HTML page uses escapeHtml() on every interpolation."
            user="Sanitize HTML you intentionally render (DOMPurify, sanitize-html). DaloyJS is an API framework, when you do render markup, use the right escaper."
          />

          <p>
            The default response shape is JSON. JSON does not execute. The risk
            window is your dynamic HTML routes, your SSR layer, and your
            front-end framework, and Daloy&apos;s job there is to make sure the
            browser&apos;s defenses (CSP, Trusted Types, nosniff) are{" "}
            <em>on</em> by the time you start rendering. They are.
          </p>

          <h2>#3: Server-side request forgery (SSRF)</h2>

          <ThreatCard
            num={3}
            threat="SSRF (cloud metadata, internal pivot)"
            status="opt-in"
            framework="fetchGuard() wraps globalThis.fetch with an allow-list and a default block list covering 169.254.169.254 (AWS/GCP metadata), 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7. Redirects are followed manually with re-validation at every hop."
            user="Add the explicit allow-list of upstream hostnames your service may call. One line."
          />

          <CodeBlock language="ts" code={FETCH_GUARD} />

          <p>
            This is the one I&apos;m proudest of, because the most-quoted SSRF
            CVEs of the last five years, Capital One, Shopify, plenty of others
            , would have failed against a re-validating fetch wrapper.
            Daloy&apos;s does re-validate every hop. A 302 to 169.254.169.254 is
            just as dead as a direct one.
          </p>

          <h2>#4: Path traversal</h2>

          <ThreatCard
            num={4}
            threat="Path traversal (../, encoded, double-encoded)"
            status="default"
            framework="The router rejects encoded traversal sequences (..%2F, %252F, NUL bytes) before any handler runs. assertSafeRelativePath() and sanitizeFilename() are exported for the rare handler that legitimately accepts paths."
            user="Don't store secrets in /public or /static. Don't roll your own static file server."
          />

          <CodeBlock language="ts" code={PATH_TRAVERSAL} />

          <h2>#5: XML external entity (XXE)</h2>

          <ThreatCard
            num={5}
            threat="XXE / XInclude"
            status="n/a"
            framework="DaloyJS does not parse XML. There is no built-in XML body parser to misconfigure. SAML, SOAP, and similar payloads are a dedicated library's job."
            user="If you must parse XML (SAML auth flows, legacy SOAP), pick a parser that disables external DTD resolution by default, fast-xml-parser, libxmljs2 with the explicit option, or xmldom with documented hardening."
          />

          <p>
            The cleanest defense against XXE is not parsing XML. Daloy
            doesn&apos;t. If your domain forces you to, the framework
            doesn&apos;t silently help, which is the right kind of unhelpful.
          </p>

          <h2>#6: Insecure deserialization</h2>

          <ThreatCard
            num={6}
            threat="Insecure deserialization (cookies, bodies, RPC)"
            status="default"
            framework="Bodies are JSON-only. The JSON parser strips __proto__ / constructor / prototype keys before validation. Cookies default to __Host- prefix + HttpOnly + SameSite=Lax. Session payloads are MAC'd (timing-safe verify) and rotate signing keys cleanly."
            user="Don't accept Java-style serialized blobs, BSON from untrusted sources, or YAML !!js/function tags. If you do, validate the shape with a Standard Schema before touching it."
          />

          <CodeBlock language="ts" code={PROTO_SAFE} />

          <h2>#7: Shell / command injection</h2>

          <ThreatCard
            num={7}
            threat="Shell & command injection"
            status="default"
            framework="The framework never spawns a shell. The CI gate verify:no-remote-exec refuses curl|sh-style installers in dependencies. verify:no-vulnerable-sandboxes blocks vm2-class libraries. The Aikido article's own recommendation, child_process.execFile() with array args, is the pattern we point you at in /docs/security/command-injection."
            user="If your handler needs to run a binary, use execFile() with an args array. Never spawn('sh', ['-c', userInput])."
          />

          <h2>#8: Local file inclusion (LFI)</h2>

          <ThreatCard
            num={8}
            threat="LFI (require()/import of user-supplied paths)"
            status="default"
            framework="Same primitives as #4 (assertSafeRelativePath, sanitizeFilename) plus the structural fact that DaloyJS has no dynamic-template loader, no eval(), no Function() constructor pattern, and no require(userInput) anywhere on the request path."
            user="Don't write your own template loader that dynamically resolves user-supplied paths. If you must, use an allow-list."
          />

          <h2>#9: Prototype pollution</h2>

          <ThreatCard
            num={9}
            threat="Prototype pollution"
            status="default"
            framework="The body parser, query parser, and cookie parser all strip __proto__ / constructor / prototype keys. isForbiddenObjectKey() is exported so middleware authors can do the same. Stripped keys are logged at debug level, silent removal would let the bug hide."
            user="Don't write your own deep-merge helper. If you need one, lodash >=4.17.21 with the patched merge is fine."
          />

          <h2>#10: Open redirects</h2>

          <ThreatCard
            num={10}
            threat="Open redirects (?next=, ?returnTo=, ?redirect_uri=)"
            status="gap-closed"
            framework="safeRedirect(target, { allowedPaths, allowedOrigins, fallback }) refuses //evil.com, /\\evil.com, javascript:, control-character response-splitting, off-origin absolute URLs, and unparseable input. Defaults to 303 + Cache-Control: no-store."
            user="Pass the explicit allow-list. The helper will not let you publish a redirect helper with no allow-list and no fallback, that combination throws OpenRedirectBlockedError at use time."
          />

          <p>
            This is the one I had to actually ship. Without the helper, a Daloy
            redirect looked something like this:
          </p>

          <CodeBlock
            language="ts"
            code={`// Fine if \`next\` is a hard-coded string,
// open-redirect bait if it came from a query parameter.
return new Response(null, {
  status: 302,
  headers: { Location: next },
});`}
          />

          <p>
            That puts a load-bearing security decision on the developer at the
            <em>latest</em> moment in the stack. We have a verb for that:{" "}
            <em>insecure default</em>
            {". "}So I wrote the missing helper, and gave it the only defaults
            that make sense, refuse on bad input, fallback if you ask for one,
            no implicit allow-list:
          </p>

          <CodeBlock language="ts" code={SAFE_REDIRECT} />

          <p>
            The helper is a small, self-contained module, no framework
            internals, no dependency on <code>App</code> or <code>Context</code>
            {". "}You can use it from a handler, from a hook, from a custom
            adapter, even from a script. The validation rules are tested in{" "}
            <code>tests/safe-redirect.test.ts</code> and cover every bypass the
            article mentions plus a few it doesn&apos;t: backslash-prefixed
            paths, CR/LF response-splitting payloads, scheme spoofing,
            unparseable absolute URLs, and unsafe fallbacks (yes, the helper
            also refuses a fallback that is itself an open-redirect bait).
          </p>

          <h2>The honest scoreboard</h2>

          <p>
            Against Aikido&apos;s top 10: nine were already covered, one (#10)
            was a real gap and now isn&apos;t. The shared-responsibility line
            stays where it always was, the framework gives you the primitives
            and the defaults, and you don&apos;t get to claim you were
            &quot;just writing a redirect handler&quot; anymore.
          </p>

          <p>
            If you&apos;re upgrading, <code>safeRedirect</code> is exported from
            the package root:
          </p>

          <CodeBlock
            language="ts"
            code={`import {
  safeRedirect,
  OpenRedirectBlockedError,
  // types
  type SafeRedirectOptions,
  type SafeRedirectStatus,
  type SafeRedirectBlockReason,
} from "@daloyjs/core";`}
          />

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>
            {", "}
            <Link href="/blog/cloud-security-architecture-mapped-to-daloyjs">
              Cloud Security Architecture, Mapped to DaloyJS</Link>
            {", "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security</Link>
            {", "}
            <Link href="/blog/csrf-in-2026-double-submit-and-fetch-metadata">
              CSRF in 2026</Link>
            {". "}Or jump straight to{" "}
            <Link href="/docs/security/fetch-guard">
              /docs/security/fetch-guard
            </Link>{" "}
            and{" "}
            <Link href="/docs/security/owasp-api-top-10">
              /docs/security/owasp-api-top-10</Link>
            {"."}
          </p>
        </div>
      </article>
    </main>
  );
}
