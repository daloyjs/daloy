import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";
import { UseCaseGuide } from "../../../components/use-case-guide";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Response caching",
  description:
    "Cache rendered response bodies server-side with the built-in, dependency-free responseCache() middleware: cache-key + TTL, Cache-Control orchestration (s-maxage/max-age), stale-while-revalidate, request directives, and a pluggable ResponseCacheStore mirroring SessionStore.",
  path: "/docs/response-cache",
  keywords: [
    "response cache",
    "server-side cache",
    "HTTP caching",
    "DaloyJS responseCache",
    "stale-while-revalidate",
    "Cache-Control",
    "s-maxage",
    "ResponseCacheStore",
    "cache key",
    "TTL",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Response caching</h1>
      <p>
        A hot read endpoint often renders the same response over and over while
        nothing has changed. Re-running the handler (and its database or
        upstream calls) each time is pure waste. The{" "}
        <code>responseCache()</code> middleware stores rendered response bodies
        and replays them for matching requests, so the handler is{" "}
        <em>not invoked at all</em> while a cached representation is fresh.
      </p>
      <p>
        It completes (and does not overlap with) the two caching-adjacent
        helpers DaloyJS already ships. <code>etag()</code> answers conditional{" "}
        <code>GET</code>s with <code>304 Not Modified</code> but still runs the
        handler to produce the body it hashes; <code>compression()</code>{" "}
        shrinks the bytes on the wire but caches nothing.{" "}
        <code>responseCache()</code> caches the <strong>body</strong>.
      </p>
      <p>
        It is <strong>built-in and dependency-free</strong>
        {", "}built on the Web-standard <code>Request</code>/
        <code>Response</code>
        {", "}so it runs unchanged on Node, Bun, Deno, and Cloudflare Workers.
      </p>

      <UseCaseGuide
        featureName="Response caching middleware"
        recommendation="Use server-side response caching for public, high-read, and computationally expensive GET/HEAD endpoints. Credentialed requests bypass the cache by default. To cache personalized responses, identify the caller with principal() so each one gets its own entry instead of sharing yours."
        whenToUse={[
          "Public, non-personalized read endpoints (e.g., product lists, public profiles, configuration feeds).",
          "Handlers that perform expensive database operations, complex calculations, or third-party API fetches.",
          "GET or HEAD endpoints with high request volumes where responses change infrequently.",
          "Personalized reads, ONLY with a principal() that names the caller so the key partitions per user.",
        ]}
        whenNotToUse={[
          "Personalized, user-specific data without a principal(). The request bypasses the cache, so you gain nothing and should not reach for the middleware.",
          "Mutative requests (POST, PUT, PATCH, DELETE) which perform side-effects.",
          "Real-time data feeds (e.g., live stock prices, chat messages) where any latency is unacceptable.",
          "Endpoints that carry high-entropy security tokens in headers or response bodies.",
        ]}
      />

      <h2 id="quick-start">Quick start</h2>
      <p>
        Mount <code>responseCache()</code> ahead of the read routes whose
        rendered bodies are safe to reuse for a short window. By default only{" "}
        <code>GET</code> / <code>HEAD</code> responses with status{" "}
        <code>200</code> are cached.
      </p>
      <p>
        One ordering rule: if the app also uses <code>rateLimit()</code> or{" "}
        <code>loginThrottle()</code>, register the limiter{" "}
        <strong>before</strong> the cache. A cache hit is returned from{" "}
        <code>beforeHandle</code> and ends the hook chain, so a limiter mounted
        behind the cache never counts the requests the cache serves and the
        declared budget is effectively unlimited. In production that order{" "}
        <a href="/docs/security/boot-guards#8-stored-response-mounted-ahead-of-a-request-budget">
          refuses to boot
        </a>
        .
      </p>
      <CodeBlock
        code={`import { App, responseCache } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

// Reuse rendered bodies for 30 seconds.
app.use(responseCache({ ttlSeconds: 30 }));

app.get(
  "/products",
  {
    operationId: "listProducts",
    responses: {
      200: { description: "ok", body: z.array(z.object({ id: z.string() })) },
    },
  },
  async () => {
    const products = await db.listProducts(); // skipped on a fresh cache hit
    return { status: 200 as const, body: products };
  },
);`}
        language="ts"
      />
      <p>
        Each response the cache handles carries an <code>X-Cache</code> marker (
        <code>HIT</code>
        {", "}
        <code>MISS</code>
        {", "}or <code>STALE</code>), plus an <code>Age</code> header on a hit,
        so caches and clients can observe the outcome. A request that bypasses
        the cache entirely (a non-GET/HEAD method, an <code>Authorization</code>{" "}
        header, or a request <code>Cache-Control: no-store</code>) passes
        through unmarked.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <p>For an eligible request the middleware derives a cache key and:</p>

      <BranchDiagram
        title="Three cache outcomes"
        source={{
          eyebrow: "request",
          label: "Eligible GET/HEAD, derive cache key",
          detail: "method + path + query (+ varyHeaders)",
        }}
        branches={[
          {
            eyebrow: "fresh",
            label: "HIT",
            detail: "stored body served, handler skipped",
            tone: "success",
          },
          {
            eyebrow: "within SWR window",
            label: "STALE",
            detail: "stale served now, one background refresh",
            tone: "accent",
          },
          {
            eyebrow: "no entry",
            label: "MISS",
            detail: "handler runs, cacheable response stored",
            tone: "muted",
          },
        ]}
        caption="A handled request's response carries an X-Cache marker (HIT, STALE, or MISS). A request that bypasses the cache (non-GET/HEAD, an Authorization header, or Cache-Control: no-store) carries none. On a fresh hit the handler is never invoked. STALE requires a revalidate callback and serves the old body immediately while a single de-duplicated refresh repopulates the entry."
      />

      <ul>
        <li>
          Fresh hit
          {": "}the stored response is served and the handler does <em>not</em>{" "}
          run (<code>X-Cache: HIT</code>).
        </li>
        <li>
          Stale hit within the SWR window (requires <code>revalidate</code>):
          the stale response is served immediately (<code>X-Cache: STALE</code>)
          while a single, de-duplicated background refresh repopulates the
          cache.
        </li>
        <li>
          Miss
          {": "}the handler runs and a cacheable response is stored (
          <code>X-Cache: MISS</code>).
        </li>
      </ul>

      <h2 id="cache-control-orchestration">Cache-Control orchestration</h2>
      <p>
        Freshness is derived from the response&rsquo;s own{" "}
        <code>Cache-Control</code> when present (<code>s-maxage</code> wins over{" "}
        <code>max-age</code>), falling back to the configured{" "}
        <code>ttlSeconds</code>
        {". "}Responses are <strong>never</strong> cached when they:
      </p>
      <ul>
        <li>
          carry <code>Cache-Control: no-store</code>
          {", "}
          <code>private</code>
          {", "}or <code>no-cache</code>.
        </li>
        <li>
          include a <code>Set-Cookie</code> header (per-user / credentialed
          responses must not be shared);
        </li>
        <li>
          fail <code>cacheableStatus</code> (default: only <code>200</code>), or
        </li>
        <li>
          exceed <code>maxBodyBytes</code> (1&nbsp;MiB by default).
        </li>
      </ul>
      <p>On the request side:</p>
      <ul>
        <li>
          <code>Cache-Control: no-store</code> bypasses the cache entirely (no
          read, no write).
        </li>
        <li>
          <code>Cache-Control: no-cache</code> bypasses the read but still
          refreshes the stored entry. This is exactly what the background
          stale-while-revalidate refresh uses, which makes revalidation
          recursion-safe.
        </li>
      </ul>

      <h2 id="stale-while-revalidate">stale-while-revalidate</h2>
      <p>
        With <code>staleWhileRevalidateSeconds</code> plus a{" "}
        <code>revalidate</code> callback (typically wired to{" "}
        <code>app.fetch</code>), a stale-but-recent entry is served immediately
        while a single background refresh runs. The refresh request carries{" "}
        <code>Cache-Control: no-cache</code> so it bypasses the cached read and
        repopulates the entry without recursing.
      </p>
      <CodeBlock
        code={`const app = new App();

app.use(
  responseCache({
    ttlSeconds: 30,             // serve fresh for 30s
    staleWhileRevalidateSeconds: 300, // then serve stale up to 5 min while refreshing
    revalidate: (req) => app.fetch(req),
  }),
);`}
        language="ts"
      />

      <h2 id="options">Options</h2>
      <CodeBlock
        code={`app.use(
  responseCache({
    // Freshness lifetime when the response has no s-maxage/max-age. Default: 60.
    ttlSeconds: 60,
    // Extra seconds a stale entry may be served while refreshing. Default: 0.
    staleWhileRevalidateSeconds: 0,
    // Background refresh callback; required to enable SWR.
    revalidate: (req) => app.fetch(req),
    // Methods eligible for caching. Default: GET, HEAD.
    methods: ["GET", "HEAD"],
    // Which response statuses are cacheable. Default: status === 200.
    cacheableStatus: (status) => status === 200,
    // Request headers whose values partition the cache (e.g. localization).
    varyHeaders: ["accept-language"],
    // Identify the caller so credentialed responses cache per principal
    // instead of bypassing. Return null for anonymous.
    principal: (ctx) => ctx.state.session?.get("userId") ?? null,
    // Cache credentialed requests only when responses are shareable. Boolean
    // sets both Authorization and Cookie; an object controls them separately.
    cacheAuthenticatedRequests: false,
    // Custom cache key BODY; the tenant/principal partition is applied around it.
    // Return null to skip caching this request.
    keyGenerator: (ctx) => new URL(ctx.request.url).pathname,
    // Largest response body buffered + stored. Default: 1 MiB.
    maxBodyBytes: 1_048_576,
    // Response header marking the outcome. Set to null to disable. Default: "x-cache".
    statusHeaderName: "x-cache",
    // Share one in-memory store across mounts with the same id.
    groupId: "catalog",
  }),
);`}
        language="ts"
      />

      <h2 id="pluggable-stores">Pluggable stores</h2>
      <p>
        The default <code>MemoryResponseCacheStore</code> is process-local,
        perfect for tests and single-instance deployments. For a multi-instance
        or serverless fleet, supply a shared backend by implementing{" "}
        <code>ResponseCacheStore</code>
        {". "}The contract mirrors <code>SessionStore</code> and the rate-limit
        store. Entries whose <code>staleUntil</code> is in the past should be
        treated as missing.
      </p>
      <CodeBlock
        code={`import type { ResponseCacheStore, CachedResponse } from "@daloyjs/core";

const redisResponseCacheStore: ResponseCacheStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as CachedResponse) : null;
  },
  async set(key, entry, ttlMs) {
    await redis.set(key, JSON.stringify(entry), "PX", ttlMs);
  },
  async delete(key) {
    await redis.del(key);
  },
};

app.use(responseCache({ store: redisResponseCacheStore }));`}
        language="ts"
      />

      <h2 id="cache-key-and-isolation">
        Cache key and cross-principal isolation
      </h2>
      <p>
        A shared response cache is only as safe as its key. Anything that varies
        the response but <em>not</em> the key becomes a cross-principal
        disclosure (CWE-524): the next caller of the same URL receives the
        previous caller&apos;s private body, with a perfectly normal-looking{" "}
        <code>x-cache: HIT</code>. DaloyJS is fail-closed on every principal
        dimension the framework can see.
      </p>
      <div className="not-prose my-6 overflow-x-auto rounded-lg border border-border bg-muted/30 p-4">
        <pre className="text-xs leading-relaxed">
          <code>{`cache key = [ tenant partition ] [ principal partition ] method + effective request URI + varyHeaders
             │                    │                          │
             │                    │                          └─ scheme + authority + path + query  (RFC 9111 §4)
             │                    └─ principal(ctx), when supplied
             └─ ctx.state.tenant, folded in automatically by tenancy()

            + [ secondary key ] ─── the request's values for the fields the
                                    response's own Vary header names (RFC 9111 §4.1)

Authorization or Cookie present, and neither handled nor identified?  →  bypass the cache entirely`}</code>
        </pre>
      </div>
      <h3 id="the-authority-is-part-of-the-key">
        The authority is part of the key
      </h3>
      <p>
        The key is built from the <strong>effective request URI</strong>{" "}
        (scheme, authority, path, and query) per RFC&nbsp;9111&nbsp;§4. One
        process serving several hostnames (vanity domains,
        subdomain-per-customer, staging alongside production) therefore never
        shares an entry across them. A key covering only path and query would
        silently mix them.
      </p>
      <h3 id="credentials-fail-closed">Credentials fail closed</h3>
      <p>
        Requests carrying <code>Authorization</code> <strong>or</strong>{" "}
        <code>Cookie</code> bypass the shared cache entirely
        (RFC&nbsp;9111&nbsp;§3.5). <code>Cookie</code> counts because a session
        cookie is the single most common way a response becomes private. A
        cache that only knew about <code>Authorization</code> would happily
        serve one logged-in user&apos;s page to the next visitor.
      </p>
      <p>
        Rather than losing the cache on authenticated routes, name the
        caller with <code>principal</code>. The id is folded into the key, so
        each principal gets their own entry and hits still work:
      </p>
      <CodeBlock
        code={`app.use(
  responseCache({
    ttlSeconds: 30,
    // Return a stable id, never the raw credential. null means anonymous.
    principal: (ctx) => ctx.state.session?.get<string>("userId") ?? null,
  }),
);

// Genuinely shareable content behind a gate? Opt in per header instead.
app.use(
  responseCache({
    // e.g. a public endpoint that receives unrelated analytics cookies, but
    // must still never cache a bearer-authenticated response.
    cacheAuthenticatedRequests: { cookie: true },
  }),
);`}
        language="ts"
      />
      <p>
        A <code>principal</code> that returns <code>null</code> for a request
        that <em>does</em> carry credentials is treated as &quot;cannot identify
        this caller&quot;, and the request bypasses the cache rather than
        sharing one anonymous entry among authenticated users. Declaring the
        credential in <code>varyHeaders</code> also counts as handling it, since
        its value then partitions the key by itself.
      </p>
      <h3 id="declared-variants-are-honoured">
        Declared variants are honoured
      </h3>
      <p>
        A response&apos;s own <code>Vary</code> header is the origin telling the
        cache which request headers its content depends on, and DaloyJS honours
        it as a <strong>secondary key</strong> (RFC&nbsp;9111&nbsp;§4.1) with no
        configuration. This matters because middleware you already mount emits{" "}
        <code>Vary</code> for you: <code>cors()</code> adds{" "}
        <code>Vary: Origin</code> alongside the reflected{" "}
        <code>Access-Control-Allow-Origin</code>, and <code>compression()</code>{" "}
        adds <code>Vary: Accept-Encoding</code> alongside{" "}
        <code>Content-Encoding</code>. A cache that ignored those would serve
        one caller&apos;s allowed origin (or their gzipped bytes) to the next.
      </p>
      <p>
        Each distinct set of values is stored as its own variant, so several
        variants of one URL stay warm at the same time rather than evicting one
        another. A response carrying <code>Vary: *</code> declares itself
        unreusable and is never stored.
      </p>
      <p>
        <code>varyHeaders</code> remains useful and is additive: it partitions{" "}
        <em>before</em> the handler runs, which is what you want when the
        response does not declare <code>Vary</code> itself but you know it
        depends on a header anyway.
      </p>
      <h3 id="tenants-partition-automatically">
        Tenants partition automatically
      </h3>
      <p>
        When <code>tenancy()</code> has resolved a tenant for the request, that
        tenant is folded into the cache key with no wiring on your part, and
        the partition is applied <em>around</em> a custom{" "}
        <code>keyGenerator</code> too, so a hand-written generator cannot
        accidentally widen it. A caller that resolves to no tenant is kept in
        its own partition rather than sharing the resolved ones.
      </p>
      <p>
        Ordering still matters, and it is enforced rather than merely
        documented: because the key is built in <code>beforeHandle</code>, a{" "}
        <code>responseCache()</code> mounted <em>ahead of</em>{" "}
        <code>tenancy()</code> would run before the tenant exists in{" "}
        <code>ctx.state</code>. In production that combination{" "}
        <strong>refuses to boot</strong> (see{" "}
        <a href="/docs/security/boot-guards">boot guards</a>) instead of quietly
        serving one tenant&apos;s data to another. Register{" "}
        <code>tenancy()</code> first.
      </p>

      <h3 id="access-control-is-not-order-sensitive">
        Access control is not order-sensitive
      </h3>
      <p>
        A cache hit returns a response from <code>beforeHandle</code>, which
        ends the hook chain. Any gate running in that <em>same</em> phase could
        therefore be skipped by a hit above it. That is why the network-identity
        gates (<code>geoBlock()</code>
        {", "}
        <code>ipRestriction()</code>
        {", "}
        <code>botGuard()</code>
        {", "}
        <code>autoBan()</code> and <code>ipReputation()</code>) run in{" "}
        <code>preBody</code>
        {", "}which always precedes <code>beforeHandle</code>. They hold whether
        you mount them above or below the cache. Authentication (
        <code>bearerAuth()</code>
        {", "}
        <code>basicAuth()</code>
        {", "}
        <code>clientCertAuth()</code>) runs in <code>preBody</code> for the same
        reason.
      </p>
      <p>
        This matters for a hand-written gate: a custom guard in{" "}
        <code>beforeHandle</code> <em>can</em> be preempted by a cache hit
        mounted ahead of it. Put your own access-control checks in{" "}
        <code>preBody</code> too, or register them before the cache.
      </p>

      <h2 id="security-notes">Other security notes</h2>
      <ul>
        <li>
          Responses carrying <code>Set-Cookie</code> or{" "}
          <code>Cache-Control: private | no-store | no-cache</code> are never
          stored, the same skip posture as <code>etag()</code>.
        </li>
        <li>
          Only <code>200 OK</code> is cached unless you widen{" "}
          <code>cacheableStatus</code>
          {", "}so error pages do not poison the cache.
        </li>
        <li>
          Stored bodies are capped by <code>maxBodyBytes</code> to bound memory
          growth from large replies, and <code>MemoryResponseCacheStore</code>{" "}
          is bounded on both entry count (<code>maxEntries</code>, default
          10,000) and retained body bytes (<code>maxBytes</code>, default
          64&nbsp;MiB). Both limits are needed: expiry-based pruning alone
          cannot bound a burst of requests for distinct URLs, because every
          entry in it is unexpired for the whole TTL.
        </li>
        <li>
          Use <code>varyHeaders</code> (or a custom <code>keyGenerator</code>)
          to partition the cache whenever the response depends on a request
          header such as <code>Accept-Language</code> without saying so in{" "}
          <code>Vary</code>.
        </li>
        <li>
          Hop-by-hop headers (<code>Connection</code>,{" "}
          <code>Transfer-Encoding</code>, <code>TE</code>, …) and the{" "}
          <code>X-Request-Id</code> correlation id are stripped before an entry
          is stored, so a cached reply never replays another request&apos;s
          trace id or corrupts message framing. Add a custom correlation header
          to <code>excludeHeaders</code>.
        </li>
        <li>
          Partition components are length-prefixed, so a principal or tenant id
          containing the key delimiter cannot be crafted to collide with another
          partition (cache-key injection).
        </li>
      </ul>
    </>
  );
}
