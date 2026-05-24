import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "secure-by-default",
  title:
    "Secure by Default: The Defaults DaloyJS Ships So You Don't Have To Remember Them",
  description:
    "A tour of the always-on defenses in the DaloyJS request path — bounded body reads, prototype-pollution-safe JSON, CRLF sanitization, path-traversal rejection, request timeouts, problem+json with prod redaction — plus the opt-in upgrades worth turning on today.",
  date: "2026-05-18",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work. Has read more pentest reports than feels emotionally healthy. Currently writing TypeScript from Norway.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS security",
    "secure by default",
    "Node.js security defaults",
    "prototype pollution",
    "CSP nonce",
    "Trusted Types",
    "CSRF double submit",
    "Fetch Metadata",
    "rate limit Redis",
    "problem+json RFC 9457",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const APP_CONSTRUCTOR = `// src/app.ts
import { App } from "@daloyjs/core";

// These two arguments are not optional middleware.
// They are constructor arguments. They are on.
export const app = new App({
  bodyLimitBytes: 1 << 20,   // default: 1 MiB
  requestTimeoutMs: 30_000,  // default: 30s, set 0 to disable
  // production: process.env.NODE_ENV === "production" (auto-detected)
});`;

const PROBLEM_JSON_BODY = `HTTP/1.1 413 Payload Too Large
content-type: application/problem+json

{
  "type": "https://daloyjs.dev/errors/payload-too-large",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "Body exceeds 1048576 bytes",
  "instance": "urn:request:01J9X8Q2..."
}`;

const PROD_REDACTED_5XX = `# Same handler. Same crash. Different NODE_ENV.

# NODE_ENV !== "production"
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "TypeError: Cannot read properties of undefined (reading 'id') at handler (src/routes/orders.ts:42:18)",
  "instance": "urn:request:01J9..."
}

# NODE_ENV === "production"
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "instance": "urn:request:01J9..."
}`;

const PROTO_POLLUTION = `// What a naïve JSON parser does with this body:
//   { "__proto__": { "isAdmin": true } }
//
// ...is hand you a brand-new admin user, system-wide. Cool!
// DaloyJS strips the dangerous keys in safeJsonParse() before
// your handler ever sees the object.

import { safeJsonParse } from "@daloyjs/core";

const dangerous = '{ "user": "alice", "__proto__": { "isAdmin": true } }';
const safe = safeJsonParse(dangerous) as { user: string };

console.log(safe.user);                 // "alice"
// @ts-expect-error — isAdmin never made it through the reviver
console.log(({} as any).isAdmin);       // undefined`;

const RATE_LIMIT_REDIS = `// src/app.ts
import { App, rateLimit } from "@daloyjs/core";
import {
  redisRateLimitStore,
  ioredisAdapter,
} from "@daloyjs/core/rate-limit-redis";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

export const app = new App();

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    trustProxyHeaders: true, // only with a sanitizing proxy in front!
    store: redisRateLimitStore({
      client: ioredisAdapter(redis),
      keyPrefix: "myapp:rl:",
      // fail-open by default; flip to fail-closed if you prefer:
      // onError: () => "block",
    }),
  }),
);`;

const SECURE_HEADERS = `// src/app.ts
import { App, secureHeaders } from "@daloyjs/core";

export const app = new App();

app.use(
  secureHeaders({
    // CSP with a per-request nonce — generated for every response.
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "https://api.example.com"],
        // 'self' + nonce; no 'unsafe-inline', no 'unsafe-eval'.
      },
      nonce: true,
    },
    // Lock down DOM sinks. Modern browsers will reject string-to-HTML
    // assignments unless they come from a Trusted Types policy.
    trustedTypes: { policies: ["default"] },
  }),
);

// In your template / RSC:
//   <script nonce={ctx.state.cspNonce}>...</script>`;

const CSRF_BOTH = `// src/app.ts
import { App, csrf, session } from "@daloyjs/core";

export const app = new App();

app.use(session({ secret: process.env.SESSION_SECRET! }));

app.use(
  csrf({
    // "double-submit" | "fetch-metadata" | "both"
    strategy: "both",
    // double-submit cookie defaults to "__Host-daloy.csrf"
    // header defaults to "x-csrf-token"
    allowedOrigins: ["https://app.example.com"],
  }),
);

// In a route handler:
app.route({
  method: "GET",
  path: "/csrf-token",
  operationId: "getCsrfToken",
  responses: { 200: { description: "Token" } },
  handler: async ({ state }) => ({
    status: 200,
    body: { token: state.csrfToken },
  }),
});`;

const BASIC_AUTH = `// src/admin.ts
import { basicAuth, timingSafeEqual } from "@daloyjs/core";

// Use timingSafeEqual — never raw string ===.
app.use(
  "/admin",
  basicAuth({
    realm: "admin",
    verify: (user, pass) => {
      const okUser = timingSafeEqual(user, process.env.ADMIN_USER!);
      const okPass = timingSafeEqual(pass, process.env.ADMIN_PASS!);
      // Always run both comparisons. Returning a user object stamps
      // ctx.state.user; returning false sends 401 + WWW-Authenticate.
      return okUser && okPass ? { sub: "admin" } : false;
    },
  }),
);`;

const SESSION_EXAMPLE = `// src/app.ts
import { App, session } from "@daloyjs/core";

export const app = new App();

app.use(
  session({
    // Provide MORE than one to rotate signing keys without logging users out.
    secret: [process.env.SESSION_SECRET_CURRENT!, process.env.SESSION_SECRET_PREVIOUS!],
    // cookieName defaults to "__Host-daloy.sid" (HttpOnly, Secure, SameSite=Lax, Path=/)
    ttlSeconds: 60 * 60 * 8, // 8 hours, rolling
  }),
);

// In a handler:
app.route({
  method: "POST",
  path: "/login",
  operationId: "login",
  responses: { 204: { description: "OK" } },
  handler: async ({ state }) => {
    state.session.set("uid", "user_42");
    await state.session.regenerate(); // rotate sid on privilege change
    return { status: 204 };
  },
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

/**
 * EditorFrame — purely visual "VS Code-ish" chrome around a code sample.
 * Same component used in the launch post, kept local to the page so each
 * post stays self-contained and easy to delete if it ages badly.
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
 * DefenseCard — compact, scannable summary box used between sections so a
 * security-minded reader can skim. Uses Tailwind + the same tokens as the
 * rest of the site.
 */
function DefenseCard({
  name,
  trigger,
  status,
  on,
}: {
  name: string;
  trigger: string;
  status: string;
  on: "always" | "opt-in";
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium text-foreground">
          {name}
        </span>
        <Badge variant={on === "always" ? "default" : "outline"}>
          {on === "always" ? "always on" : "opt-in"}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {status}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{trigger}</p>
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
            Hi, I&apos;m Devlin. Ten years of fullstack work, half of those
            spent reading pentest reports and quietly thinking, &quot;we already{" "}
            <em>knew</em> that one&quot;. Most security incidents I&apos;ve had
            a hand in cleaning up were not exotic. They were not a 0-day in a
            cryptography library. They were a body limit that nobody set, a JSON
            parser that happily accepted <code>__proto__</code>, a response
            timeout that didn&apos;t exist, or a stack trace cheerfully being
            shipped to an attacker as <code>application/json</code>.
          </p>

          <p>
            So when we sat down to design DaloyJS, we made a rule and stuck to
            it:{" "}
            <strong>
              the boring, well-understood defenses must be on by default
            </strong>
            . You should be able to type <code>new App()</code> with empty
            arguments and already be in a place where most of the OWASP
            &quot;low effort, high impact&quot; checklist is satisfied before
            you write a single route.
          </p>

          <p>
            This post is the tour. Part one is the always-on stuff — the
            defenses the framework enforces whether you remembered to ask for
            them or not. Part two is the opt-in upgrades that are worth turning
            on today, in five lines each. Coffee in Oslo is expensive, so
            I&apos;ll be quick.
          </p>

          <h2>The empty constructor is already a security policy</h2>

          <p>
            Before we even tour the defenses individually, look at the smallest
            possible app and notice what&apos;s implicit:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="● src/app.ts — secure-by-default"
          >
            <CodeBlock language="ts" code={APP_CONSTRUCTOR} />
          </EditorFrame>

          <p>
            Two named arguments. The rest is invisible — and intentional. The
            framework is, at this point, already enforcing six different things
            for you. Let&apos;s walk them.
          </p>

          <h2>Part 1 — Always on, no flag required</h2>

          <h3>1. Bounded body reads</h3>

          <DefenseCard
            name="bodyLimitBytes"
            on="always"
            status="413 Payload Too Large"
            trigger="Default 1 MiB cap. Checked against Content-Length first (fail-fast), then enforced again while streaming bytes (defense-in-depth). No, you cannot trick it with a missing or lying Content-Length."
          />

          <p>
            Body size limits are the most boring of all the boring defenses,
            which is exactly why so many production apps forget them. The
            classic version of this bug is &quot;an attacker uploads a
            multi-gigabyte JSON body and your event loop falls over while V8
            tries to parse it&quot;. Or even simpler: your memory bill goes up,
            silently, because nobody capped it.
          </p>

          <p>
            DaloyJS caps every body at <code>bodyLimitBytes</code> (default 1
            MiB), and the response when you go over is an{" "}
            <code>application/problem+json</code> document — not a stack trace,
            not an HTML page, not a string with the literal word{" "}
            <code>undefined</code> in it:
          </p>

          <CodeBlock language="http" code={PROBLEM_JSON_BODY} />

          <h3>2. Prototype-pollution-safe JSON</h3>

          <DefenseCard
            name="safeJsonParse()"
            on="always"
            status="400 on invalid JSON, dangerous keys silently stripped"
            trigger="A JSON reviver removes __proto__, constructor, and prototype from every nested object before your handler runs. Yes, even when the attacker hides it under five levels of arrays."
          />

          <p>
            Prototype pollution is the bug that keeps making serious headlines,
            mostly because the JSON parser in most apps is the absolutely
            unmodified browser one, and the browser one does not care that{" "}
            <code>__proto__</code> is a magical key in JavaScript. DaloyJS
            installs a reviver in front of every JSON parse, and it strips the
            three keys you don&apos;t want walking into your object graph:
          </p>

          <EditorFrame
            files={["src/security.ts", "scripts/proto-test.ts"]}
            activeFile="scripts/proto-test.ts"
            status="✓ node --test — 1 passing (proto-pollution blocked)"
          >
            <CodeBlock language="ts" code={PROTO_POLLUTION} />
          </EditorFrame>

          <p>
            If the body is malformed JSON, you get a generic{" "}
            <code>400 Bad Request</code> with the message{" "}
            <code>&quot;Invalid JSON&quot;</code>. You do not get a parser error
            message that describes your internal parser&apos;s mood. We
            don&apos;t give attackers free oracles.
          </p>

          <h3>3. CRLF and header sanitization</h3>

          <DefenseCard
            name="sanitizeHeaderName / sanitizeHeaderValue"
            on="always"
            status="throws at middleware construction"
            trigger="CR, LF, and NUL bytes cannot enter a response header. The check runs when you build middleware like basicAuth(), csrf(), or session() — so injection attempts fail loudly at boot, not silently in prod."
          />

          <p>
            Response-splitting attacks aren&apos;t the front page of OWASP
            anymore because frameworks finally started sanitizing headers — but
            only some frameworks, and only on some paths. We do it everywhere a
            header is constructed from configuration: cookie names, realms,
            paths, domains. If your config contains <code>\\r\\n</code> by
            accident — say, because a yaml file was pasted weird — your app
            refuses to start. That&apos;s a feature.
          </p>

          <h3>4. Path-traversal rejection in the router</h3>

          <DefenseCard
            name="Router.find()"
            on="always"
            status="404 Not Found"
            trigger="Paths containing /../, trailing /.., or // are rejected before any handler runs. Static-file middlewares built on top of the router inherit this for free."
          />

          <p>
            You can argue all day whether your framework should be normalizing
            paths or whether your reverse proxy should — but in practice both of
            you should, because you don&apos;t know which one of you is going to
            be misconfigured next quarter. We reject the obvious traversal
            shapes at routing time. It costs you nothing and removes a whole
            category of &quot;oops, we served /etc/passwd&quot; stories.
          </p>

          <h3>5. Request timeouts</h3>

          <DefenseCard
            name="requestTimeoutMs"
            on="always"
            status="408 Request Timeout"
            trigger="Default 30s. Set 0 to disable (please don't). Handlers can read ctx.request.signal — a real AbortSignal — to cancel downstream fetches and DB queries cleanly."
          />

          <p>
            The vast majority of slow-loris-shaped attacks aren&apos;t even
            attacks. They&apos;re a buggy mobile client on a 2G connection in a
            tunnel, holding open one of your sockets for nine minutes. A
            per-request timeout is a load-shedding tool first and a security
            tool second, and either way you want it on. Default is 30 seconds,
            which is generous enough for real work and tight enough that you
            won&apos;t accidentally exhaust a connection pool.
          </p>

          <h3>6. problem+json with production redaction</h3>

          <DefenseCard
            name="problem+json (RFC 9457)"
            on="always"
            status="content-type: application/problem+json"
            trigger="All errors serialize to a stable, machine-readable shape: { type, title, status, detail?, instance? }. In production, the detail field is stripped from 5xx responses so stack traces do not leak."
          />

          <p>
            Here&apos;s the same 500 from the same handler, dev versus prod,
            side by side. The difference is one environment variable:
          </p>

          <CodeBlock language="bash" code={PROD_REDACTED_5XX} />

          <p>
            The <code>instance</code> field is a request URN, which means your
            on-call engineer can grep for it in logs without the user ever being
            shown anything sensitive. The dev version keeps the stack because
            dev you wants to know. Prod you doesn&apos;t leak.
          </p>

          <h2>Part 2 — Opt-in upgrades worth turning on today</h2>

          <p>
            These don&apos;t live in the default constructor because they are
            policy decisions, not safety nets. But every one of them is a single
            import and three lines of configuration. There&apos;s no reason not
            to.
          </p>

          <h3>secureHeaders() — CSP nonce + Trusted Types</h3>

          <DefenseCard
            name="secureHeaders()"
            on="opt-in"
            status="adds CSP, HSTS, X-Frame-Options, COOP/CORP, Referrer-Policy, Permissions-Policy"
            trigger="Default CSP is default-src 'self'; frame-ancestors 'none'. Pass nonce: true to mint a per-request nonce, exposed as ctx.state.cspNonce. Trusted Types is one flag."
          />

          <p>
            If your app renders any HTML at all — even one server-rendered
            template, even one error page — you want CSP, and you want it with a
            real nonce, not the <code>unsafe-inline</code> escape hatch that
            half the internet runs on. Here&apos;s how you get the strict
            version, with Trusted Types on top to harden DOM sinks against XSS:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="● CSP: strict · nonce: per-request · trusted-types: on"
          >
            <CodeBlock language="ts" code={SECURE_HEADERS} />
          </EditorFrame>

          <p>
            The nonce is generated using WebCrypto on every request, so the same
            code works on Node, Bun, Deno, Workers, and Vercel Edge without a
            polyfill. The first time I turned this on in a real app I found four
            scripts I didn&apos;t know were inline. That is what CSP is{" "}
            <em>for</em>.
          </p>

          <h3>csrf() — double-submit and Fetch-Metadata, together</h3>

          <DefenseCard
            name="csrf()"
            on="opt-in"
            status="403 Forbidden on failure"
            trigger="Three strategies: double-submit (cookie + header, timing-safe compared), fetch-metadata (Sec-Fetch-Site with Origin/Referer fallback), or both. Cookie defaults to __Host-daloy.csrf with SameSite=Lax + Secure."
          />

          <p>
            CSRF is one of those topics where the &quot;right&quot; answer keeps
            moving. Five years ago it was &quot;double-submit, please&quot;.
            Today modern browsers send <code>Sec-Fetch-Site</code> which lets
            you reject cross-origin writes without any token at all. The
            reasonable production answer is: do both, because legacy clients
            exist and defense-in-depth is free:
          </p>

          <EditorFrame
            files={["src/app.ts", "src/routes/csrf.ts"]}
            activeFile="src/app.ts"
            status="csrf strategy=both · cookie=__Host-daloy.csrf"
          >
            <CodeBlock language="ts" code={CSRF_BOTH} />
          </EditorFrame>

          <p>
            The cookie name uses the <code>__Host-</code> prefix on purpose. It
            forces <code>Secure</code>, no <code>Domain=</code>, and{" "}
            <code>Path=/</code> — three rules that the browser enforces for you
            instead of trusting you to remember. We like making the browser do
            our job.
          </p>

          <h3>basicAuth() — when you just need a wall in front of /admin</h3>

          <DefenseCard
            name="basicAuth()"
            on="opt-in"
            status="401 + WWW-Authenticate"
            trigger="Bring your own verify() and use timingSafeEqual on both fields. Returning an object stamps ctx.state.user; returning false yields 401."
          />

          <p>
            Not every internal endpoint deserves a full OAuth pipeline. Some of
            them just need a wall, the kind your reverse proxy used to provide.{" "}
            <code>basicAuth()</code> is for those:
          </p>

          <EditorFrame
            files={["src/admin.ts"]}
            activeFile="src/admin.ts"
            status="401 unless both user and pass match (constant time)"
          >
            <CodeBlock language="ts" code={BASIC_AUTH} />
          </EditorFrame>

          <p>
            The two important details are the order of operations and the
            comparison function. <strong>Always</strong> run both comparisons,
            and <strong>always</strong> use <code>timingSafeEqual</code> — not
            because someone is going to time-attack your admin panel from across
            the planet, but because writing security code with <code>===</code>{" "}
            is how you develop unfortunate habits that follow you into other
            systems.
          </p>

          <h3>
            session() — signed cookies, key rotation, GDPR-friendly defaults
          </h3>

          <DefenseCard
            name="session()"
            on="opt-in"
            status="cookie: __Host-daloy.sid · HttpOnly · Secure · SameSite=Lax"
            trigger="HMAC-SHA256 signed. Pass an array of secrets to rotate signing keys without logging users out. saveUninitialized defaults to false so no cookie is set until the session actually has data."
          />

          <p>
            The session middleware has one parameter you must provide — a
            signing secret — and it accepts an array so you can rotate without a
            flag day. The default cookie shape is opinionated, in the way I wish
            more frameworks were:
          </p>

          <EditorFrame
            files={["src/app.ts", "src/routes/login.ts"]}
            activeFile="src/app.ts"
            status="session: __Host-daloy.sid · rolling · 8h"
          >
            <CodeBlock language="ts" code={SESSION_EXAMPLE} />
          </EditorFrame>

          <p>
            Notice <code>state.session.regenerate()</code> on login. Rotating
            the session ID at any privilege boundary kills session fixation
            outright. The default in-memory store is fine for development; for
            production, swap in your Redis/KV store of choice through the same{" "}
            <code>SessionStore</code> interface.
          </p>

          <h3>rateLimit() — with a real Redis store for multi-instance apps</h3>

          <DefenseCard
            name="rateLimit() + redisRateLimitStore"
            on="opt-in"
            status="429 Too Many Requests + Retry-After"
            trigger="Standard X-RateLimit-* headers on every response. The Redis store uses an atomic Lua script for INCR + PEXPIRE so two instances cannot race past the limit. Fail-open by default, fail-closed if you prefer."
          />

          <p>
            In-memory rate limits are a lie the moment you have two app
            instances behind a load balancer. The right move is a shared store,
            and the right shared store for &quot;count things in a window&quot;
            is Redis with atomic operations:
          </p>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="rate-limit · store: redis · 120 req / 60s"
          >
            <CodeBlock language="ts" code={RATE_LIMIT_REDIS} />
          </EditorFrame>

          <p>
            Two details worth pausing on. First, <code>trustProxyHeaders</code>{" "}
            is <code>false</code> by default — because if you turn it on without
            a sanitizing proxy in front, an attacker can spoof{" "}
            <code>x-forwarded-for</code> and rate-limit themselves into
            invisibility. Second, the Redis adapter is <em>fail-open</em> by
            default: if Redis is down, requests are allowed through. That&apos;s
            the right choice for most apps (you don&apos;t want a Redis blip to
            take you offline), but you can flip it to fail-closed with one
            option if you&apos;d rather block on uncertainty.
          </p>

          <h2>The defaults table, for the busy reader</h2>

          <p>
            If you only remember one section of this post, remember this one.
          </p>

          <div className="not-prose my-6 overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Defense</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Default</th>
                  <th className="px-4 py-3 font-medium">Failure</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-4 py-2 font-mono">bodyLimitBytes</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">1 MiB</td>
                  <td className="px-4 py-2 font-mono">413</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">safeJsonParse</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">
                    strips __proto__/constructor/prototype
                  </td>
                  <td className="px-4 py-2 font-mono">400</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">header sanitization</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">no CR/LF/NUL in headers</td>
                  <td className="px-4 py-2 font-mono">throws at boot</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">path traversal</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">rejects /../, /.., //</td>
                  <td className="px-4 py-2 font-mono">404</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">requestTimeoutMs</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">30s</td>
                  <td className="px-4 py-2 font-mono">408</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">problem+json</td>
                  <td className="px-4 py-2">always on</td>
                  <td className="px-4 py-2">5xx detail redacted in prod</td>
                  <td className="px-4 py-2 font-mono">RFC 9457</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">secureHeaders()</td>
                  <td className="px-4 py-2">opt-in</td>
                  <td className="px-4 py-2">strict CSP + HSTS + COOP/CORP</td>
                  <td className="px-4 py-2">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">csrf()</td>
                  <td className="px-4 py-2">opt-in</td>
                  <td className="px-4 py-2">
                    double-submit, fetch-metadata, or both
                  </td>
                  <td className="px-4 py-2 font-mono">403</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">basicAuth()</td>
                  <td className="px-4 py-2">opt-in</td>
                  <td className="px-4 py-2">timing-safe verify callback</td>
                  <td className="px-4 py-2 font-mono">401</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">session()</td>
                  <td className="px-4 py-2">opt-in</td>
                  <td className="px-4 py-2">
                    __Host- cookie, HMAC-SHA256, key rotation
                  </td>
                  <td className="px-4 py-2">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono">rateLimit() + Redis</td>
                  <td className="px-4 py-2">opt-in</td>
                  <td className="px-4 py-2">atomic Lua, fail-open</td>
                  <td className="px-4 py-2 font-mono">429</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>The honest part</h2>

          <p>
            None of this makes your app un-hackable. There is no constructor
            argument for &quot;please make my business logic correct&quot;, and
            if there was, I&apos;d have shipped one to my younger self by
            registered mail. What these defaults <em>do</em> get you is the
            comfort of knowing that the <strong>boring</strong> bugs — the ones
            we have collectively known about for fifteen years, the ones that
            show up on every pentest report under &quot;Medium&quot; because the
            auditor is tired — those are already handled. Your brain is free to
            spend its limited budget on the actually-hard parts of your product.
          </p>

          <p>
            If you want to go deeper, the{" "}
            <Link href="/docs/security">security docs</Link> have the full
            surface area and the threat-model notes. And if you find a gap,
            please tell us — <code>SECURITY.md</code> in the repo has a real
            disclosure address, not a contact form that forwards to{" "}
            <code>/dev/null</code>.
          </p>

          <p>
            Thanks for reading. Now go set <code>NODE_ENV=production</code> in
            staging and watch your error responses get politely quiet.
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
