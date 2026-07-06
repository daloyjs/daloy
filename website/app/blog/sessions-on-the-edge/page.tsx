import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "sessions-on-the-edge",
  title:
    "Sessions on the Edge: Signed Cookies, Rotating Secrets, and a Pluggable Store",
  description:
    "Tour of the new session() middleware, __Host- cookie defaults, secret: [current, ...previous] rotation, regenerate() to kill session fixation, MemorySessionStore for tests, and how to plug in Redis or Workers KV via the SessionStore contract. Pairs naturally with the rate-limit Redis post.",
  date: "2026-05-25",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. Has rotated approximately four production session secrets in his life, three of them with zero downtime, one with a very honest apology email.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS session",
    "signed session cookie",
    "session secret rotation",
    "session regenerate fixation",
    "MemorySessionStore",
    "SessionStore Redis",
    "SessionStore Workers KV",
    "__Host-daloy.sid",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SESSION_BASIC = `// src/app.ts, the smallest useful session setup
import { App, session, type SessionContext } from "@daloyjs/core";

// Add the session shape to your AppState so handlers get full typing.
declare module "@daloyjs/core" {
  interface AppState {
    session: SessionContext;
  }
}

export const app = new App();

app.use(
  session({
    secret: process.env.SESSION_SECRET!, // string OR string[]
    // Defaults you don't need to think about:
    //   cookieName:  "__Host-daloy.sid"   (host-locked, no Domain, requires secure+path:"/")
    //   sameSite:    "Lax"
    //   httpOnly:    true
    //   secure:      true
    //   ttlSeconds:  86400  (1 day)
    //   rolling:     true   (sliding expiration)
    //   saveUninitialized: false  (no cookie until something is actually written)
  }),
);`;

const SESSION_USAGE = `// src/routes/auth.ts, read and write session data
app.route({
  method: "POST",
  path: "/login",
  operationId: "login",
  body: { type: "object", properties: { username: { type: "string" } }, required: ["username"] },
  responses: { 200: { description: "ok" } },
  handler: async ({ body, state }) => {
    // ...verify credentials...
    state.session.set("userId", body.username);
    // Critical: rotate the session id on privilege change to kill fixation.
    await state.session.regenerate();
    return { status: 200, body: { ok: true } };
  },
});

app.route({
  method: "GET",
  path: "/me",
  operationId: "me",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => {
    const userId = state.session.get<string>("userId");
    if (!userId) return { status: 401, body: { error: "unauthenticated" } };
    return { status: 200, body: { userId } };
  },
});

app.route({
  method: "POST",
  path: "/logout",
  operationId: "logout",
  responses: { 204: { description: "bye" } },
  handler: async ({ state }) => {
    state.session.destroy();
    return { status: 204 };
  },
});`;

const COOKIE_ANATOMY = `// The cookie that lands in DevTools looks like this:
//
//   __Host-daloy.sid=Yv2k...QF8.h7Q9...kLm; Path=/; HttpOnly; Secure; SameSite=Lax
//
// Two halves separated by a dot:
//   sid       → 32 random bytes, base64url-encoded
//   signature → HMAC-SHA256(sid) using the FIRST configured secret
//
// On the next request the middleware splits on '.', then:
//   1. Tries every configured secret in order to verify the signature
//      (timing-safe). The session id is only "valid" if at least one signer accepts it.
//   2. If valid: load the SessionRecord from the store. If expired or missing,
//      treat as no session.
//   3. If invalid: ignore the cookie entirely. A new session is NOT minted
//      until something writes to it.`;

const ROTATION_EXAMPLE = `// .env.production, rotating a session secret in three deploys

# DEPLOY #1 (steady state): one secret, the one you've had forever.
SESSION_SECRET='a-very-long-string-at-least-16-chars-long'

# DEPLOY #2 (rotation window): NEW secret first, OLD secret second.
# All new cookies are signed with the new secret.
# All existing cookies still verify against the old secret.
# Users notice nothing.
SESSION_SECRETS='["new-secret-also-16-chars-or-more","a-very-long-string-at-least-16-chars-long"]'

# DEPLOY #3 (cleanup, after >1 ttlSeconds has passed): drop the old one.
# Any cookie still signed with the old secret naturally re-issues on next request.
SESSION_SECRETS='["new-secret-also-16-chars-or-more"]'`;

const ROTATION_WIRING = `// src/app.ts, wire the array form
const secrets = JSON.parse(process.env.SESSION_SECRETS ?? "[]") as string[];

if (secrets.length === 0) {
  // Fallback to the single-secret env so the rotation path is optional.
  secrets.push(process.env.SESSION_SECRET!);
}

app.use(session({ secret: secrets }));
// The first entry signs new cookies.
// Every entry verifies incoming cookies.
// Drop entries after at least one full ttlSeconds window has elapsed.`;

const REGENERATE_FIXATION = `// Why regenerate() exists: session fixation in one paragraph.
//
// Attacker visits /, gets handed a session id S in a cookie.
// Attacker tricks the victim into using S (subdomain cookie injection,
// physical access to the device, an XSS that writes document.cookie, etc).
// Victim logs in. Server happily promotes S to "authenticated".
// Attacker, still holding S, is now logged in as the victim.
//
// Mitigation: after ANY privilege change (login, MFA step-up, password
// change, role assumption), call regenerate(). The middleware:
//   1. Issues a brand-new random session id S'
//   2. Carries data over (or drops it if you pass { keepData: false })
//   3. Destroys S on the server side
//   4. Sets the new cookie on the response
//
// The attacker's S is now garbage. Fixation killed.

await state.session.regenerate();                      // carry data
await state.session.regenerate({ keepData: false });   // fresh start`;

const MEMORY_STORE_TESTS = `// tests/auth.test.ts, using MemorySessionStore in tests
import { describe, it, expect, beforeEach } from "vitest";
import { App, session, MemorySessionStore } from "@daloyjs/core";

const store = new MemorySessionStore();

const app = new App().use(
  session({
    secret: "x".repeat(32),
    store,
    cookieOptions: { secure: false }, // tests over http://localhost
    cookieName: "test.sid",            // __Host- requires https; relax for tests
  }),
);

beforeEach(() => {
  store.clear(); // wipe between tests
});

it("creates exactly one record per login", async () => {
  // ... drive the app through .request() ...
  expect(store.size()).toBe(1);
});`;

const SESSION_STORE_INTERFACE = `// The entire contract. Three required methods, one optional.
//
// Sync OR async - return values or promises. The middleware awaits everything.

export interface SessionStore {
  get(sid: string): SessionRecord | null | Promise<SessionRecord | null>;
  set(sid: string, record: SessionRecord): void | Promise<void>;
  destroy(sid: string): void | Promise<void>;
  /** Optional fast-path; falls back to set() when omitted. */
  touch?(sid: string, expiresAt: number): void | Promise<void>;
}

export interface SessionRecord {
  data: Record<string, unknown>;
  expiresAt: number; // ms since epoch
}`;

const REDIS_STORE = `// src/stores/redis-session-store.ts, production-grade Redis adapter
import type { SessionStore, SessionRecord } from "@daloyjs/core";
import type { Redis } from "ioredis";

export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sess:",
  ) {}

  async get(sid: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(this.prefix + sid);
    if (!raw) return null;
    const rec = JSON.parse(raw) as SessionRecord;
    if (rec.expiresAt <= Date.now()) {
      // Race-safe: a TTL on Redis usually beats us to it, but belt-and-braces.
      await this.redis.del(this.prefix + sid);
      return null;
    }
    return rec;
  }

  async set(sid: string, record: SessionRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await this.redis.set(this.prefix + sid, JSON.stringify(record), "EX", ttlSeconds);
  }

  async destroy(sid: string): Promise<void> {
    await this.redis.del(this.prefix + sid);
  }

  // Optional: avoid rewriting the whole record on every read when rolling: true.
  async touch(sid: string, expiresAt: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    await this.redis.expire(this.prefix + sid, ttlSeconds);
  }
}

// Wire it up:
// app.use(session({
//   secret: secrets,
//   store: new RedisSessionStore(new Redis(process.env.REDIS_URL!)),
// }));`;

const KV_STORE = `// src/stores/kv-session-store.ts, Cloudflare Workers KV adapter
import type { SessionStore, SessionRecord } from "@daloyjs/core";
import type { KVNamespace } from "@cloudflare/workers-types";

export class KvSessionStore implements SessionStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly prefix = "sess:",
  ) {}

  async get(sid: string): Promise<SessionRecord | null> {
    const rec = await this.kv.get<SessionRecord>(this.prefix + sid, "json");
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      await this.kv.delete(this.prefix + sid);
      return null;
    }
    return rec;
  }

  async set(sid: string, record: SessionRecord): Promise<void> {
    // KV expirationTtl is in seconds. Minimum 60s on Workers KV.
    const ttlSeconds = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await this.kv.put(this.prefix + sid, JSON.stringify(record), { expirationTtl: ttlSeconds });
  }

  async destroy(sid: string): Promise<void> {
    await this.kv.delete(this.prefix + sid);
  }

  // KV doesn't expose a cheap "extend TTL" - fall back to set(). The middleware
  // does that automatically when touch() is omitted.
}

// In your Workers entry:
// app.use(session({
//   secret: [env.SESSION_SECRET],
//   store: new KvSessionStore(env.SESSION_KV),
// }));`;

const CHECKLIST = `# Production checklist (the list I run through before every launch):

[ ] secret is ≥ 32 random bytes, sourced from a secrets manager
[ ] secret is the ARRAY form, even with one entry - rotation is now a config change
[ ] cookieName stays __Host-daloy.sid in production (require https)
[ ] regenerate() is called on EVERY privilege change (login, MFA step-up,
    password reset, role assumption, impersonation)
[ ] destroy() is called on logout AND on account deletion
[ ] saveUninitialized stays false unless you have a cookie consent banner
    that explicitly allows it
[ ] store is NOT MemorySessionStore in production (it doesn't survive a
    restart and doesn't share across processes - the only acceptable
    Memory store is for tests)
[ ] ttlSeconds is short enough that a leaked cookie expires before your
    customer notices it leaked (we use 8h for staff, 30d for shoppers)
[ ] cookieOptions.maxAgeSeconds matches ttlSeconds when you want the
    cookie to die WITH the server record (otherwise the cookie outlives
    the record and you serve 401s with a still-present cookie)`;

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
 * StoreCard - short summary card for each pluggable store.
 */
function StoreCard({
  name,
  good,
  watchFor,
}: {
  name: string;
  good: string;
  watchFor: string;
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="text-base font-semibold tracking-tight">{name}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            good for
          </div>
          <p className="mt-1 text-sm">{good}</p>
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            watch for
          </div>
          <p className="mt-1 text-sm">{watchFor}</p>
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
            <Badge variant="outline">Sessions</Badge>
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
            Hi, Devlin. Ten years of fullstack, currently in Norway, currently
            holding a coffee. Sessions are one of those features where the spec
            is ten lines, the security writeups are a thousand lines, and every
            framework solves them slightly differently. The new{" "}
            <code>session()</code> middleware in DaloyJS is what happened when
            we sat down and said:{" "}
            <em>
              okay, but what would session management look like if you
              didn&apos;t have to remember anything
            </em>
            ?
          </p>

          <p>
            Short version: signed cookies with <code>__Host-daloy.sid</code>{" "}
            defaults, multi-secret rotation built in, a{" "}
            <code>regenerate()</code> that does the fixation-safe dance for you,
            a <code>MemorySessionStore</code> for tests, and a three-method{" "}
            <code>SessionStore</code> interface so Redis, Workers KV,
            Postgres, any of them, is twenty lines.
          </p>

          <h2>The smallest useful setup</h2>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="session · __Host-daloy.sid · Lax · HttpOnly · Secure"
          >
            <CodeBlock language="ts" code={SESSION_BASIC} />
          </EditorFrame>

          <p>
            That&apos;s the whole opt-in. Every default I picked is the one
            I&apos;d argue for in a code review. <code>__Host-</code> forces
            host-locked cookies (no <code>Domain</code> attribute, requires{" "}
            <code>Secure</code> and <code>Path=/</code>), which neutralizes an
            entire class of subdomain cookie injection.{" "}
            <code>SameSite=Lax</code> blocks the cross-site CSRF attack on
            navigation. <code>HttpOnly</code> takes the cookie off the table for
            JavaScript, which means an XSS bug can do a lot of harm but not{" "}
            <em>specifically</em> steal your session token.
          </p>

          <h2>Reading and writing session data</h2>

          <EditorFrame
            files={["src/routes/auth.ts"]}
            activeFile="src/routes/auth.ts"
            status="POST /login · GET /me · POST /logout"
          >
            <CodeBlock language="ts" code={SESSION_USAGE} />
          </EditorFrame>

          <p>
            The API is intentionally boring: <code>get</code>, <code>set</code>,{" "}
            <code>delete</code>, <code>destroy</code>, <code>regenerate</code>.
            The interesting part is what the middleware does between your
            handler returning and the response going out, if you wrote
            anything, it persists to the store and re-issues the cookie; if you
            didn&apos;t, <code>saveUninitialized: false</code> means no cookie
            at all, which keeps your privacy banner&apos;s job small.
          </p>

          <h2>What&apos;s actually in the cookie</h2>

          <EditorFrame
            files={["chrome://devtools · Application · Cookies"]}
            activeFile="chrome://devtools · Application · Cookies"
            status="format: <sid>.<HMAC-SHA256 base64url>"
          >
            <CodeBlock language="bash" code={COOKIE_ANATOMY} />
          </EditorFrame>

          <p>
            One thing worth pointing out: the cookie carries the session id,{" "}
            <em>not</em> the session data. Everything you call <code>set</code>{" "}
            on lives in the store. The cookie is a tiny tamper-evident pointer.
            This is why &quot;the store&quot; is pluggable and why you can
            change backends without invalidating cookies (the signature still
            checks out; the new backend just has no record for that id, which is
            treated as &quot;no session&quot;).
          </p>

          <h2>Rotating secrets without invalidating sessions</h2>

          <p>
            This is the feature I wish every web framework had built in, because
            doing it badly is how teams end up never rotating session secrets at
            all. Here&apos;s the entire mechanism:
          </p>

          <ul>
            <li>
              <code>secret</code> accepts a string <em>or</em> an array.
            </li>
            <li>
              The <strong>first</strong> entry in the array is used to{" "}
              <em>sign</em> new cookies.
            </li>
            <li>
              <strong>Every</strong> entry is tried, in order, to{" "}
              <em>verify</em> incoming cookies (timing-safe).
            </li>
            <li>
              Each secret must be a non-empty string of at least 16 characters, 
              the middleware throws at construction if not.
            </li>
          </ul>

          <p>
            Which lines up to a three-deploy rotation with literally zero user
            impact:
          </p>

          <EditorFrame
            files={[".env.production"]}
            activeFile=".env.production"
            status="rotation via array, no logged-out users"
          >
            <CodeBlock language="bash" code={ROTATION_EXAMPLE} />
          </EditorFrame>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="wire the array form"
          >
            <CodeBlock language="ts" code={ROTATION_WIRING} />
          </EditorFrame>

          <p>
            Two days after deploy #2, every active cookie has been re-issued
            with the new secret (the middleware automatically re-signs on any
            session write, and <code>rolling: true</code> means a touch is a
            write). Deploy #3 is then safe and uneventful, which is how you want
            security work to feel.
          </p>

          <h2>regenerate(): the one line that kills session fixation</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="state.session.regenerate() · use it on EVERY privilege change"
          >
            <CodeBlock language="ts" code={REGENERATE_FIXATION} />
          </EditorFrame>

          <p>
            I&apos;ve seen this bug in production three times in my career, and
            zero of those times was the team intentionally not calling an
            equivalent of <code>regenerate</code>. They all forgot. So{" "}
            <code>regenerate()</code> is a single method that is impossible to
            use wrong, and the docs and the type hint both nudge you to call it
            on privilege change. I am genuinely a little proud of how small this
            API turned out.
          </p>

          <h2>MemorySessionStore: fast tests, never production</h2>

          <p>
            The default store is <code>MemorySessionStore</code>. It&apos;s a{" "}
            <code>Map</code> with TTL handling and two test helpers (
            <code>clear()</code>, <code>size()</code>) on top. It is{" "}
            <em>fantastic</em> for tests because it&apos;s synchronous, has no
            network, and is observable. It is <em>not</em> for production
            because the moment you have two processes (or your serverless
            platform scales horizontally), sessions stop being sticky.
          </p>

          <EditorFrame
            files={["tests/auth.test.ts"]}
            activeFile="tests/auth.test.ts"
            status="MemorySessionStore · clear() between tests · size() for assertions"
          >
            <CodeBlock language="ts" code={MEMORY_STORE_TESTS} />
          </EditorFrame>

          <h2>The SessionStore contract</h2>

          <p>
            Three required methods. One optional. That&apos;s the entire surface
            a store has to implement to be production-ready:
          </p>

          <EditorFrame
            files={["@daloyjs/core · session.ts"]}
            activeFile="@daloyjs/core · session.ts"
            status="3 required + 1 optional · sync or async"
          >
            <CodeBlock language="ts" code={SESSION_STORE_INTERFACE} />
          </EditorFrame>

          <p>
            Sync or async. <code>touch()</code> is a perf hint for{" "}
            <code>rolling: true</code>: if your backend has a cheap &quot;just
            extend the TTL&quot; operation (like Redis <code>EXPIRE</code>),
            implement it; if not, omit it and the middleware will fall back to{" "}
            <code>set()</code>. That&apos;s the whole contract. No transactions,
            no advisory locks, no cooperation with the cookie layer, that all
            stays inside the middleware.
          </p>

          <h2>A Redis store in twenty lines</h2>

          <p>
            This is the one I reach for the most. Pairs naturally with the{" "}
            <Link href="/blog/the-flow-i-wished-i-had">
              rest of the toolkit
            </Link>{" "}
, particularly the Redis-backed rate limiter, which can share the
            same connection pool.
          </p>

          <EditorFrame
            files={["src/stores/redis-session-store.ts"]}
            activeFile="src/stores/redis-session-store.ts"
            status="ioredis · TTL on SET EX · touch() via EXPIRE"
          >
            <CodeBlock language="ts" code={REDIS_STORE} />
          </EditorFrame>

          <StoreCard
            name="Redis"
            good="Multi-process Node, Bun, or Deno deployments behind a load balancer. Pairs with rate-limit Redis. Atomic EXPIRE means touch() is essentially free."
            watchFor="One Redis = one failure domain. Use a replica or accept that a Redis outage logs everyone out. Don't store huge payloads in the session, keep it to IDs."
          />

          <h2>A Workers KV store, similar shape</h2>

          <EditorFrame
            files={["src/stores/kv-session-store.ts"]}
            activeFile="src/stores/kv-session-store.ts"
            status="Cloudflare Workers KV · expirationTtl min 60s"
          >
            <CodeBlock language="ts" code={KV_STORE} />
          </EditorFrame>

          <StoreCard
            name="Workers KV"
            good="Edge deployments where you want session reads close to the user. Eventually consistent, but for sessions that's fine, you're reading your own writes by sid."
            watchFor="Workers KV has a 60s minimum expirationTtl and eventually-consistent global propagation. Don't use it for sub-second auth flows; do use it for long-lived sessions."
          />

          <h2>Pre-launch checklist</h2>

          <p>
            This is the list I literally paste into pull requests when someone
            wires sessions into a new app. Steal it.
          </p>

          <EditorFrame
            files={["CHECKLIST.md"]}
            activeFile="CHECKLIST.md"
            status="steal this · paste it in your launch PR"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>One paragraph of honest caveats</h2>

          <p>
            Signed cookie sessions are not magic. If an attacker gets your
            session secret, they can mint any session id they want, that&apos;s
            why the secret lives in a real secrets manager and gets rotated. If
            an attacker gets a user&apos;s cookie via TLS-stripping on a
            misconfigured subdomain, the signature won&apos;t save you, 
            that&apos;s why <code>__Host-</code> + <code>Secure</code> are
            non-negotiable defaults. And if your store backend goes down, your
            users log out, that&apos;s why we picked an interface that supports
            a replica or a fallback layer if you need one.
          </p>

          <p>
            What this middleware <em>does</em> get right is the unglamorous
            stuff: it makes the safe path the easy path, the rotation path a
            config change, and the &quot;swap backends&quot; path a twenty-line
            file. That&apos;s what I wanted ten years ago and kept not having.
          </p>

          <h2>Where to go next</h2>

          <p>
            The reference for <code>session()</code> options, including all
            cookie defaults and the full <code>SessionContext</code> surface, is
            in the <Link href="/docs/security/session">session docs</Link>. If
            you&apos;re also wiring Redis for rate limiting, the{" "}
            <Link href="/docs/security/rate-limit-redis">
              rate-limit Redis docs
            </Link>{" "}
            show how to share the connection. And the{" "}
            <Link href="/docs/security">security overview</Link> stitches
            sessions, CSRF, CSP, and headers into one mental model.
          </p>

          <p>
            Thanks for reading. Now go check your <code>SESSION_SECRET</code> is
            at least 32 bytes. I will wait. (If it is the word{" "}
            <code>secret</code>, I will not judge, but I will worry.)
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
                href="/docs/security/session"
                className="underline underline-offset-4"
              >
                Read the session docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/docs/security/rate-limit-redis"
                className="underline underline-offset-4"
              >
                Rate-limit Redis docs
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
