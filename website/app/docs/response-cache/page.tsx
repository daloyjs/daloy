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
        <code>responseCache()</code> is the missing third piece: it caches the{" "}
        <strong>body</strong>.
      </p>
      <p>
        It is <strong>built-in and dependency-free</strong>
        {", "}built on the Web-standard <code>Request</code>/
        <code>Response</code>
        {", "}so it runs unchanged on Node, Bun, Deno, and Cloudflare Workers.
      </p>

      <UseCaseGuide
        featureName="Response caching middleware"
        recommendation="Use server-side response caching for public, high-read, and computationally expensive GET/HEAD endpoints. Never cache personalized, authenticated, or mutative requests, as this risks leaking sensitive session details between users."
        whenToUse={[
          "Public, non-personalized read endpoints (e.g., product lists, public profiles, configuration feeds).",
          "Handlers that perform expensive database operations, complex calculations, or third-party API fetches.",
          "GET or HEAD endpoints with high request volumes where responses change infrequently.",
        ]}
        whenNotToUse={[
          "Personalized, user-specific data (e.g., /me, dashboard, checkout pages, billing history) to prevent cross-user data leakage.",
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
        Each response the cache handles carries an <code>X-Cache</code> marker (<code>HIT</code>
        {", "}<code>MISS</code>
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
        caption="A handled request's response carries an X-Cache marker (HIT, STALE, or MISS); a request that bypasses the cache (non-GET/HEAD, an Authorization header, or Cache-Control: no-store) carries none. On a fresh hit the handler is never invoked. STALE requires a revalidate callback and serves the old body immediately while a single de-duplicated refresh repopulates the entry."
      />

      <ul>
        <li>
          <strong>Fresh hit</strong>
          {": "}the stored response is served and the handler does <em>not</em>{" "}
          run (<code>X-Cache: HIT</code>).
        </li>
        <li>
          <strong>Stale hit within the SWR window</strong> (requires{" "}
          <code>revalidate</code>): the stale response is served immediately (<code>X-Cache: STALE</code>) while a single, de-duplicated background
          refresh repopulates the cache.
        </li>
        <li>
          <strong>Miss</strong>
          {": "}the handler runs and a cacheable response is stored (<code>X-Cache: MISS</code>).
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
          {", "}<code>private</code>
          {", "}or <code>no-cache</code>;
        </li>
        <li>
          include a <code>Set-Cookie</code> header (per-user / credentialed
          responses must not be shared);
        </li>
        <li>
          fail <code>cacheableStatus</code> (default: only <code>200</code>); or
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
    // Cache Authorization-bearing requests only when responses are shareable.
    cacheAuthenticatedRequests: false,
    // Custom cache key; return null to skip caching this request.
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
        store; entries whose <code>staleUntil</code> is in the past should be
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

      <h2 id="security-notes">Security notes</h2>
      <ul>
        <li>
          Credentialed and per-user responses are never shared by default:
          anything carrying <code>Set-Cookie</code> or{" "}
          <code>Cache-Control: private | no-store | no-cache</code> is skipped,
          the same skip posture as <code>etag()</code>.
        </li>
        <li>
          <strong>
            Requests carrying an <code>Authorization</code> header bypass the
            cache entirely (CWE-524, RFC&nbsp;9111&nbsp;§3.5).
          </strong>{" "}
          A shared cache keyed on method + path + query does not include the
          credential, so caching an authenticated response would serve one
          user&apos;s private data to the next caller of the same resource. Set{" "}
          <code>cacheAuthenticatedRequests: true</code> only for content that is
          genuinely shareable across principals, and pair it with{" "}
          <code>varyHeaders: [&quot;authorization&quot;]</code> (or a custom{" "}
          <code>keyGenerator</code>) so distinct callers cannot collide.
        </li>
        <li>
          Only <code>200 OK</code> is cached unless you widen{" "}
          <code>cacheableStatus</code>
          {", "}so error pages do not poison the cache.
        </li>
        <li>
          Stored bodies are capped by <code>maxBodyBytes</code> to bound memory
          growth from large replies.
        </li>
        <li>
          Use <code>varyHeaders</code> (or a custom <code>keyGenerator</code>)
          to partition the cache whenever the response depends on a request
          header such as <code>Accept-Language</code>.
        </li>
      </ul>
    </>
  );
}
