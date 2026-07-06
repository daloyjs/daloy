import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "rate-limiting-that-survives-multiple-instances",
  title: "Rate Limiting That Survives Multiple Instances",
  description:
    "Why the default in-memory rateLimit() is a one-instance lie behind a load balancer, how @daloyjs/core/rate-limit-redis fixes it with an atomic Lua INCR+PEXPIRE script, and the three operational levers that matter in production: fail-open vs fail-closed, Retry-After accuracy, and where to host the counter on serverless, edge, and traditional Node deploys.",
  date: "2026-06-02",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. Has watched a rate limiter fail open against a credential-stuffing botnet exactly once, which is, it turns out, the precise number of times it takes to become opinionated about this.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "rate limiting Redis Lua",
    "distributed rate limit",
    "DaloyJS rateLimit",
    "redisRateLimitStore",
    "Retry-After header",
    "fail open fail closed",
    "serverless rate limit",
    "Upstash rate limit",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# A representative production timeline, lightly edited for length:
#
# 11:02  Auto-scaler bumps the API from 2 → 6 replicas (Tuesday lunch traffic).
# 11:03  Attacker starts a credential-stuffing run at ~3,000 RPS, spread
#        across thousands of IPs via residential proxies.
# 11:04  Per-IP rate limit (100/min) does NOTHING because each IP hits a
#        different replica's in-memory counter at the same time.
# 11:05  Login endpoint backend (read-heavy on users table) starts timing out.
# 11:06  Health checks flap. Auto-scaler bumps to 12. Counters spread further.
# 11:09  Eight pages later, on-call ratchets a sledgehammer "block all
#        unauthenticated POSTs" rule into the WAF. Real users locked out.
# 11:42  Postmortem opens with one true sentence: "The rate limiter only
#        works on a single instance."
#
# Every framework's quickstart tells you to use the in-memory store. Almost
# no quickstart tells you that it lies the moment you scale past one.`;

const IN_MEM_RATE = `// What the quickstart shipped you with, fine for dev, lying in prod.
import { App, rateLimit } from "@daloyjs/core";

const app = new App();

app.use(rateLimit({
  windowMs: 60_000,                    // 1-minute fixed window
  max: 120,                            // per key, per window
  // store: undefined → MemoryStore (in-process Map<string, ...>)
}));

// What you're actually getting with N replicas behind a load balancer:
//   - Each replica keeps its own counter, in its own memory.
//   - A client routed to a fresh replica gets a fresh 120/min budget.
//   - Effective limit ≈ max * N. With N=6, your "120/min" is 720/min.
//   - Worse: the limit is non-deterministic depending on LB stickiness.
//
// This is fine on a laptop. It's a security boundary failure in prod.`;

const REDIS_BASIC = `// src/rate-limit.ts, the fix is one import and one option.
import IORedis from "ioredis";
import { rateLimit } from "@daloyjs/core";
import {
  redisRateLimitStore,
  ioredisAdapter,
} from "@daloyjs/core/rate-limit-redis";

const redis = new IORedis(process.env.REDIS_URL!, {
  // Important: short connect/operation timeouts. The rate limiter is on
  // the hot path of every request. You do NOT want a slow Redis turning
  // every API call into a 5-second pause.
  enableOfflineQueue: false,
  connectTimeout: 200,
  commandTimeout: 100,
  maxRetriesPerRequest: 1,
});

app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  store: redisRateLimitStore({
    client: ioredisAdapter(redis),
    prefix: "daloy:rl:prod:",                // namespace per env on shared Redis
  }),
}));`;

const LUA_SCRIPT = `-- @daloyjs/core/rate-limit-redis · the entire atomic script.
-- Returns {count, ttlMs}. One round trip. No races.

local current = redis.call('INCR', KEYS[1])
if current == 1 then
  -- Brand-new key: set the window TTL exactly once.
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return {current, tonumber(ARGV[1])}
end

-- Existing key: read the remaining TTL so the caller can compute resetMs.
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  -- Safety net: TTL got cleared somehow (e.g. PERSIST). Re-arm the window.
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}

-- Why Lua instead of MULTI/EXEC or two round trips?
--   1. ATOMIC. INCR + PEXPIRE happen as a single Redis-side operation, so
--      we can never end up with a counter that has no TTL and lives forever.
--   2. TTL ONLY ON THE FIRST HIT. A busy key keeps its original window
--      instead of being perpetually extended (which would silently widen
--      every limit to "windowMs after the LAST request").
--   3. ONE RTT. The window-remaining ttl is returned in the same call, so
--      Retry-After is computed without a second round trip.`;

const KEY_GENERATOR = `// Key generators decide WHAT you're limiting. Per-IP is the default; it's
// also the worst at scale (residential proxies, CGNAT, mobile carriers).
// Layer multiple limits with different keys for the boring-correct setup:
import type { BaseContext } from "@daloyjs/core";

const byIp = (ctx: BaseContext) =>
  // Only trust XFF if your reverse proxy strips and rewrites it.
  (ctx.request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "ip:unknown");

const byUser = (ctx: BaseContext) => {
  const u = ctx.state.user as { id?: string } | undefined;
  return u?.id ? "user:" + u.id : "anon:" + byIp(ctx);
};

// Aggressive global per-IP cap - coarse safety net.
app.use(rateLimit({
  windowMs: 60_000,
  max: 600,
  keyGenerator: byIp,
  store: redisRateLimitStore({ client, prefix: "rl:ip:" }),
}));

// Narrow per-user cap on sensitive endpoints. Apply via app.use() inside
// the /v1 group, or via per-route hooks. Either way, separate prefix.
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: byUser,
  store: redisRateLimitStore({ client, prefix: "rl:user:" }),
}));`;

const FAIL_OPEN_CLOSED = `// Fail-open vs fail-closed, pick deliberately, per endpoint class.
import type { RateLimitStore } from "@daloyjs/core";

// PUBLIC: fail OPEN. Better to over-serve than to take the whole site down
// because Redis hiccuped. The default.
const publicStore = redisRateLimitStore({
  client: ioredisAdapter(redis),
  prefix: "rl:pub:",
  onError: (err) => {
    log.warn({ err }, "rate-limit store unavailable; failing open");
    return "fail-open";                    // ← also the default if you omit onError
  },
});

// SENSITIVE: fail CLOSED. Login, password reset, payment-method add,
// admin actions. If we can't enforce the limit, we don't process the
// request. The framework turns the thrown error into 503 problem+json.
const sensitiveStore = redisRateLimitStore({
  client: ioredisAdapter(redis),
  prefix: "rl:sens:",
  onError: (err) => {
    log.error({ err }, "rate-limit store unavailable; failing CLOSED");
    return "fail-closed";
  },
});

// Mount them where they belong. Most APIs only need two stores total.
app.use(rateLimit({ windowMs: 60_000, max: 600, store: publicStore }));
app.register(loginPlugin, {
  prefix: "/auth",
  hooks: { ...rateLimit({ windowMs: 60_000, max: 10, store: sensitiveStore }) },
});`;

const RETRY_AFTER_WIRE = `# What a 429 looks like on the wire when the Redis store is in play:
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 37

{
  "type":   "https://daloyjs.dev/errors/too-many-requests",
  "title":  "Too Many Requests",
  "status": 429
}

# The Retry-After value is the REAL window-remaining, not a guess. The Lua
# script returns the current PTTL in milliseconds in the same round trip
# as INCR, so the middleware computes resetMs without a second hop. Your
# retry-after-aware fetch clients (the ones every team eventually writes)
# get a value they can actually trust.`;

const NODE_REDIS_VARIANT = `// node-redis v4+ users, same store, different adapter.
import { createClient } from "redis";
import {
  redisRateLimitStore,
  nodeRedisAdapter,
} from "@daloyjs/core/rate-limit-redis";

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 200 },
});
await redis.connect();

app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  store: redisRateLimitStore({
    client: nodeRedisAdapter(redis),
  }),
}));

// Using a different Redis client (Upstash REST, valkey-glide, deno-redis)?
// The store accepts any object that implements:
//
//   eval(script: string, keys: string[], args: string[]): Promise<unknown>
//
// Ten lines of glue and you're done. The atomic semantics are in the
// script, not the transport.`;

const SERVERLESS_GUIDANCE = `# Where to host the counter, runtime by runtime.

# Long-lived Node / Bun behind a load balancer:
# - Managed Redis or ElastiCache, with rate-limit traffic on a separate
#   logical DB or cluster from your hot-path caches.
# - Set commandTimeout aggressively (≤ 100ms). Failing open is better than
#   a request-time stall, but only if you've measured.

# Cloudflare Workers:
# - Use Upstash Redis REST or KV. The store contract is the same; provide
#   your own "eval-like" wrapper that POSTs the script (or returns a
#   precomputed result for KV). Fewer features than full Redis, but you
#   already paid for "no cold start", and counters are eventually consistent.
# - For request-rate clamping at the edge BEFORE your Worker boots, layer
#   the platform-native rate limiter (Cloudflare Rules) above your app.

# Vercel / Vercel Functions:
# - Same story as Workers - Upstash is the obvious pick because it's the
#   only one that gives sub-50ms p99 over HTTP from every region.
# - For Functions (Node runtime), a normal managed Redis works if it's
#   geographically close to the function region.

# AWS Lambda:
# - Redis must be inside the VPC, or use Upstash REST. Cold-start latency
#   matters a lot - keep the client OUTSIDE the handler closure so it's
#   reused across warm invocations.

# Same App, every runtime: one store, one prefix. Adapt the transport.`;

const TEST_RATE = `// tests/rate-limit.test.ts, verify the limit, end to end, without Redis.
// The in-memory store is perfect for tests; only the production wiring
// changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, rateLimit } from "@daloyjs/core";

test("returns 429 + Retry-After once the budget is gone", async () => {
  const app = new App();
  app.use(rateLimit({ windowMs: 60_000, max: 3 }));
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200, body: { ok: true } }),
  });

  for (let i = 0; i < 3; i++) {
    const ok = await app.request("/ping");
    assert.equal(ok.status, 200);
  }
  const blocked = await app.request("/ping");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("content-type"), "application/problem+json");
  // Retry-After is in whole seconds, ceil of the remaining window.
  assert.match(blocked.headers.get("retry-after") ?? "", /^\\d+$/);
});`;

const CHECKLIST = `# Pre-flight checklist before shipping the Redis store to prod.
#
# 1) Pick a prefix per environment AND per limit class.
#    "daloy:rl:prod:ip:"     -- safety-net IP cap
#    "daloy:rl:prod:user:"   -- per-user app limit
#    "daloy:rl:prod:auth:"   -- sensitive (login/reset)
#
# 2) Aggressive client timeouts. connectTimeout ≤ 200ms,
#    commandTimeout ≤ 100ms. Disable offlineQueue. The hot path cannot
#    afford to wait for a flaky Redis.
#
# 3) Two stores: fail-open for the public limit, fail-closed for the
#    sensitive one. Wire both onError handlers into your structured
#    logger so the SRE on call sees the degradation in real time.
#
# 4) Layer multiple limits, not one giant one. Per-IP, per-user, and
#    per-route-class with different windows. Each gets its own prefix.
#
# 5) Monitor the store. Track rate-limit-error-rate as a SLI; alert when
#    fail-open kicks in for more than a few seconds.
#
# 6) Trust XFF only if your reverse proxy strips and rewrites it. Else
#    the limiter is bypassable by anyone willing to set a header.
#
# 7) Cap the IP key cardinality. crypto.subtle.digest("SHA-256", ip) and
#    truncate. Otherwise a botnet with millions of IPs OOMs your Redis.
#
# 8) Don't share Redis with hot caches if you can help it. Or do, but
#    keep capacity for both. Eviction of a counter mid-window is a real
#    bug that's been the subject of more than one postmortem I've read.`;

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

function ModeCard({
  mode,
  use,
  children,
}: {
  mode: string;
  use: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {mode}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">
          Use for:{" "}
          <span className="font-normal text-muted-foreground">{use}</span>
        </p>
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
            <Badge variant="outline">Production</Badge>
            <Badge variant="outline">Redis</Badge>
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
            nursing a particular kind of opinion you only earn by watching an
            in-memory rate limiter fail in production exactly once. Spoiler: the
            limiter doesn&apos;t look broken in the metrics. The metrics look{" "}
            <em>fine</em>. The login endpoint is on fire, the SREs are confused,
            and somebody in the postmortem says the sentence everyone is
            thinking: <em>oh, it only works on a single instance.</em>
          </p>

          <p>
            This is the post that turns that quickstart-shaped &quot;120 per
            minute, in memory&quot; into something that actually enforces 120
            per minute across all your replicas, all your regions, and all your
            cold starts. It covers the default store and why it lies behind a
            load balancer, the Redis store DaloyJS ships, the small atomic Lua
            script that does the actual work, the two operational levers you
            must decide on (fail-open vs fail-closed; what your key actually
            is), and deployment guidance per runtime.
          </p>

          <h2>How the in-memory store fails, in 12 lines</h2>

          <EditorFrame
            files={["postmortem.md"]}
            activeFile="postmortem.md"
            status="real shape · names changed · happens more often than anyone admits"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="MemoryStore · per-process · lies behind any load balancer"
          >
            <CodeBlock language="ts" code={IN_MEM_RATE} />
          </EditorFrame>

          <p>
            The arithmetic is brutal: with N replicas and a uniform load
            balancer, the effective limit is <code>max × N</code>. The{" "}
            <em>variance</em> of that limit is worse: as your autoscaler scales
            up under attack, the gates open wider, not narrower. This is fine on
            a laptop. It is a security boundary failure in production.
          </p>

          <h2>The fix is one import</h2>

          <EditorFrame
            files={["src/rate-limit.ts"]}
            activeFile="src/rate-limit.ts"
            status="@daloyjs/core/rate-limit-redis · ioredis adapter · prefix per env"
          >
            <CodeBlock language="ts" code={REDIS_BASIC} />
          </EditorFrame>

          <p>
            That&apos;s the whole change. Same <code>rateLimit()</code>{" "}
            middleware, same <code>windowMs</code> and <code>max</code>, just a
            different store. Every replica now reads and writes the same
            counter. The interesting bits are <em>inside</em> the store, and
            interesting in the &quot;fewer than 15 lines of Lua&quot; sense,
            which is the way I like my interesting bits.
          </p>

          <h2>The atomic Lua script, in full</h2>

          <EditorFrame
            files={["@daloyjs/core/rate-limit-redis · SCRIPT"]}
            activeFile="@daloyjs/core/rate-limit-redis · SCRIPT"
            status="INCR + PEXPIRE in one server-side operation · returns {count, ttlMs}"
          >
            <CodeBlock language="bash" code={LUA_SCRIPT} />
          </EditorFrame>

          <p>The three things to remember about that script:</p>

          <ul>
            <li>
              <strong>Atomic.</strong> If <code>INCR</code> succeeded but{" "}
              <code>PEXPIRE</code> didn&apos;t, you&apos;d have a counter that
              lives forever and silently turns the limit into &quot;all
              requests, forever&quot;. Lua running on the server makes that race
              impossible.
            </li>
            <li>
              <strong>TTL only on the first hit.</strong> Re-arming the window
              every request makes the budget reset only when the client stops
              calling, exactly the opposite of what you want. The conditional{" "}
              <code>if current == 1</code> is the whole game.
            </li>
            <li>
              <strong>Single round trip.</strong> Returning the current{" "}
              <code>PTTL</code> in the same call lets the middleware produce an
              accurate <code>Retry-After</code> without a second hop. Two-RTT
              rate limiting is what people mean when they say &quot;Redis is
              slow&quot; (it isn&apos;t; their limiter is just over-talkative).
            </li>
          </ul>

          <h2>The two levers that matter in production</h2>

          <p>Two questions, both worth thinking about before you ship:</p>

          <ModeCard
            mode="fail-open"
            use="public reads, marketing pages, analytics ingest"
          >
            If Redis is unreachable, allow the request and log the degradation.
            Better to over-serve briefly than to take the site down because your
            limiter&apos;s store is having a moment. This is the DaloyJS
            default.
          </ModeCard>
          <ModeCard
            mode="fail-closed"
            use="login, password reset, payment add, admin"
          >
            If Redis is unreachable, refuse the request. The framework
            propagates the error and the consumer gets a 5xx problem+json.
            Choose this for endpoints where one missed limit is worse than a
            brief outage.
          </ModeCard>

          <EditorFrame
            files={["src/rate-limit.ts"]}
            activeFile="src/rate-limit.ts"
            status="onError → 'fail-open' | 'fail-closed' · log either way"
          >
            <CodeBlock language="ts" code={FAIL_OPEN_CLOSED} />
          </EditorFrame>

          <h2>Pick your key, then keep picking</h2>

          <p>
            A single per-IP cap is a starting point, not a finished answer.
            Modern abuse traffic spreads across thousands of IPs on residential
            proxy networks; your job is to layer cheap wide limits with narrow
            expensive ones. Two stores, two prefixes, two key generators:
          </p>

          <EditorFrame
            files={["src/rate-limit.ts"]}
            activeFile="src/rate-limit.ts"
            status="byIp safety-net · byUser narrow cap · different prefixes"
          >
            <CodeBlock language="ts" code={KEY_GENERATOR} />
          </EditorFrame>

          <h2>What the 429 actually looks like</h2>

          <EditorFrame
            files={["HTTP/1.1 429"]}
            activeFile="HTTP/1.1 429"
            status="application/problem+json + accurate Retry-After (seconds)"
          >
            <CodeBlock language="bash" code={RETRY_AFTER_WIRE} />
          </EditorFrame>

          <p>
            The body is the same{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              RFC 9457 problem+json
            </Link>{" "}
            every other DaloyJS error response uses, so your frontend error
            helper handles it the same way it handles a 422. The{" "}
            <code>Retry-After</code> value is the real <code>PTTL</code> from
            Redis, not a guess, which is the difference between a backoff that
            works and one that thunders.
          </p>

          <h2>node-redis, Upstash, valkey: the same store</h2>

          <EditorFrame
            files={["src/rate-limit.ts"]}
            activeFile="src/rate-limit.ts"
            status="nodeRedisAdapter · or roll your own, 10 lines of glue"
          >
            <CodeBlock language="ts" code={NODE_REDIS_VARIANT} />
          </EditorFrame>

          <p>
            The transport is decoupled on purpose. The whole{" "}
            <code>RedisCommands</code> contract is a single{" "}
            <code>eval(script, keys, args)</code> method. ioredis, node-redis,
            Upstash&apos;s REST client, Deno&apos;s redis, valkey-glide, all map
            onto it in a handful of lines. The interesting work lives in the Lua
            script, not the wire.
          </p>

          <h2>Per-runtime hosting guidance</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="long-lived Node · Workers · Lambda"
          >
            <CodeBlock language="bash" code={SERVERLESS_GUIDANCE} />
          </EditorFrame>

          <p>
            The portability story here is the same as for the rest of the
            framework (see the{" "}
            <Link href="/blog/same-app-five-runtimes-verified">
              five-runtimes post
            </Link>
            ): the contract is Web-standard-shaped, so you swap the transport
            per environment and keep the app code identical.
          </p>

          <h2>Testing without a Redis</h2>

          <EditorFrame
            files={["tests/rate-limit.test.ts"]}
            activeFile="tests/rate-limit.test.ts"
            status="node:test + in-memory store + app.request() · sub-second"
          >
            <CodeBlock language="ts" code={TEST_RATE} />
          </EditorFrame>

          <h2>The pre-flight checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="eight items · tape to the wall next to your runbook"
          >
            <CodeBlock language="bash" code={CHECKLIST} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            Two things make a production-grade rate limiter: an atomic counter
            that all your replicas share, and a deliberate choice about what
            happens when the counter is unreachable. DaloyJS ships the first as
            a 15-line Lua script in <code>@daloyjs/core/rate-limit-redis</code>,
            and exposes the second as a single <code>onError</code> callback.
            That&apos;s the whole API. The rest is operational discipline,
            multiple keys, namespaced prefixes, aggressive timeouts, and the
            checklist above is the version of that discipline I trust myself to
            follow at 2 a.m. on a Tuesday.
          </p>

          <p>
            Closest neighbors in spirit: the{" "}
            <Link href="/blog/secure-by-default">secure-by-default</Link> post
            for the surrounding security defaults you already have, the{" "}
            <Link href="/blog/sessions-on-the-edge">sessions</Link> post for the
            other piece of the &quot;works on every runtime&quot; puzzle, and
            the{" "}
            <Link href="/blog/middleware-without-mystery-hooks-ordering-response-transformation">
              middleware lifecycle
            </Link>{" "}
            post for where exactly the limiter fires in the request pipeline.
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
              <Link href="/docs" className="underline underline-offset-4">
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/secure-by-default"
                className="underline underline-offset-4"
              >
                Secure-by-default post
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
