import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";
import { UseCaseGuide } from "../../../components/use-case-guide";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Adaptive auto-ban (fail2ban-style)",
  description:
    "Temporarily ban abusive clients with autoBan(): escalating, decaying bans triggered by repeated 401/403/429 (or custom) responses, a pluggable store mirroring rateLimit(), and secure-by-default identity attribution. Zero runtime dependencies.",
  path: "/docs/auto-ban",
  keywords: [
    "auto-ban",
    "fail2ban",
    "rate limiting",
    "brute force protection",
    "autoBan",
    "escalating ban",
    "WAF",
    "abuse mitigation",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Adaptive auto-ban (fail2ban-style)</h1>
      <p>
        DaloyJS ships <code>autoBan()</code>
        {", "}a reusable, escalating, decaying ban primitive. Where{" "}
        <a href="/docs/security/websocket-login-throttle">
          <code>loginThrottle()</code>
        </a>{" "}
        only protects credential-entry routes, <code>autoBan()</code> watches{" "}
        <em>any</em> response and temporarily bans a client that trips too many
        suspicious statuses (by default <code>401</code> / <code>403</code> /{" "}
        <code>429</code>) inside a rolling window. Repeat offenders earn
        exponentially longer bans; the record decays once the client goes quiet,
        so a one-off burst is forgiven while a persistent attacker is locked out
        for progressively longer. It is dependency-free and runtime-portable.
      </p>

      <UseCaseGuide
        featureName="Adaptive auto-ban middleware"
        recommendation="Use adaptive auto-ban to defend critical authentication, sign-up, or high-cost public endpoints against automated brute-force attacks and scrapers. Do not rely on it as a primary defense for apps already shielded by edge-level web application firewalls (WAFs)."
        whenToUse={[
          "Protecting credential entry (login, password reset) and signup endpoints against dictionary/brute-force attacks.",
          "Mitigating scraping attempts on public catalog endpoints or content feeds.",
          "Limiting aggressive bot probing for vulnerable paths (e.g., searching for /.env or /wp-admin).",
        ]}
        whenNotToUse={[
          "When your hosting platform or CDN (Cloudflare, AWS WAF, Fastly) already handles IP-level rate-limiting and blocking at the edge (edge blocking is far more resource-efficient).",
          "For endpoints consumed by trusted internal clients or automated partner services sharing the same IP address (risks banning a corporate proxy).",
          "Behind proxies without configuring proper client IP attribution headers (can lead to banning all users on a shared proxy).",
        ]}
      />

      <FlowDiagram
        title="Per-request decision"
        steps={[
          {
            label: "Incoming request",
            detail: "identified by keyGenerator or trusted proxy IP",
            eyebrow: "client",
          },
          {
            label: "Already banned?",
            detail: "checked in preBody, before body I/O",
            tone: "accent",
          },
          {
            label: "Banned -> reject",
            detail: "429 + Retry-After (or 403); handler never runs",
            tone: "danger",
          },
          {
            label: "Not banned -> run",
            detail: "watch the outgoing status",
            tone: "success",
          },
          {
            label: "401 / 403 / 429 -> strike",
            detail: "maxStrikes in windowMs -> ban banMs, doubling on repeat",
            tone: "danger",
          },
        ]}
        caption="A banned client is rejected before the handler runs. Otherwise the request proceeds and its outgoing status is watched: enough suspicious statuses inside the rolling window issue an escalating ban that decays once the client goes quiet."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { autoBan } from "@daloyjs/core";

const app = createApp();

// Five 401/403/429s within 10 min -> a 15 min ban that doubles for repeat abuse.
app.use(autoBan({ trustProxyHeaders: true }));`}
      />
      <p>
        Mount it globally with <code>app.use()</code> so it observes every
        route. Because it reads the outgoing status, it counts failures produced
        by <em>any</em> downstream middleware or handler (auth rejections,
        rate-limit <code>429</code>s, your own <code>403</code>s), not just its
        own.
      </p>

      <h2 id="identity-is-mandatory">Identity is mandatory</h2>
      <p>
        <code>autoBan()</code> refuses to construct unless it can identify
        clients: pass a <code>keyGenerator</code>, set{" "}
        <code>trustProxyHeaders: true</code>, or declare{" "}
        <code>trustedHops</code>
        {". "}This is deliberate: a shared <code>&quot;global&quot;</code>{" "}
        bucket would let a single offender ban every caller at once. A request
        the key generator cannot attribute (returns <code>undefined</code>) is
        skipped: never counted, never banned.
      </p>
      <CodeBlock
        language="ts"
        code={`// Ban by authenticated user id instead of IP:
app.use(
  autoBan({
    keyGenerator: (ctx) => (ctx.state.user as { id?: string })?.id,
  }),
);`}
      />
      <h3 id="when-your-key-generator-runs">When your key generator runs</h3>
      <p>
        <code>autoBan</code> enforces in the <code>preBody</code> phase, which
        is what makes it immune to mount order (see{" "}
        <a href="/docs/response-cache#access-control-is-not-order-sensitive">
          the response-cache note
        </a>
        ). Your <code>keyGenerator</code> is called there first, before any body
        is parsed and before any <code>beforeHandle</code> middleware has run.
        Key off the request line, headers, params or query and it resolves in
        that phase, and the ban holds wherever you mount it.
      </p>
      <p>
        Some identities only exist later. The example above reads{" "}
        <code>ctx.state.user</code>
        {", "}which a <code>session()</code>-style layer populates in{" "}
        <code>beforeHandle</code>. So if the <code>preBody</code> call returns{" "}
        <code>undefined</code>
        {", "}DaloyJS calls your generator a second time in{" "}
        <code>beforeHandle</code>
        {", "}when that state exists. Without the retry such a generator
        returned <code>undefined</code> forever: no key was recorded, strike
        accounting found nothing to attribute, and the ban silently never armed.
        Requests enforced by the second attempt are order-sensitive again, since{" "}
        <code>beforeHandle</code> is the phase a <code>responseCache()</code>{" "}
        hit short-circuits — enforcing late still beats not enforcing. Returning{" "}
        <code>undefined</code> from both attempts skips the request as
        documented.
      </p>
      <p>
        <code>ctx.body</code> is not available in either phase. The option is
        typed as <code>IdentityGateContext</code>
        {", "}so reading through <code>body</code> is a compile error rather
        than a security control that quietly turns itself off at run time. The
        same type governs <code>resolveIp</code> on <code>geoBlock()</code>
        {", "}
        <code>ipRestriction()</code>
        {", "}
        <code>botGuard()</code> and <code>ipReputation()</code>.
      </p>

      <h2 id="spoof-resistant-proxy-identity">
        Spoof-resistant proxy identity
      </h2>
      <p>
        When the default key generator reads <code>X-Forwarded-For</code>, it
        keys on the <strong>rightmost</strong> entry: the one your immediate
        proxy actually appended. Attackers can prepend arbitrary entries to the
        left of that header, but they cannot touch the slots your own proxy
        chain wrote. This defeats both classic abuses of leftmost-IP keying:
        rotating a spoofed entry per attempt to evade strike accumulation, and
        spoofing a victim&apos;s address to get <em>them</em> banned.
      </p>
      <p>
        Behind more than one proxy hop (CDN &rarr; load balancer &rarr; app),
        declare the chain length with <code>trustedHops</code> so the key comes
        from the slot your outermost trusted proxy wrote:
      </p>
      <CodeBlock
        language="ts"
        code={`// Two proxies in front of Daloy: CDN -> LB -> app.
// X-Forwarded-For arrives as "client, CDN" and the client IP is 2 hops back.
app.use(autoBan({ trustedHops: 2 }));

// trustProxyHeaders: true is exactly trustedHops: 1 (single proxy in front).
// With no proxy at all, forwarded-header trust is attacker-controlled by
// definition: only enable either option behind a proxy chain you control.`}
      />
      <p>
        Two details worth knowing when you declare more than one hop. First,{" "}
        <code>X-Real-IP</code> is honoured only at <code>trustedHops: 1</code>,
        because that header carries exactly one hop of information and cannot
        express a longer chain. Past one hop, a request whose{" "}
        <code>X-Forwarded-For</code> is shorter than your declaration never
        traversed the topology you described (a request that reached your origin
        directly, skipping the CDN, for instance), so it resolves to{" "}
        <em>no identity</em> rather than to a header the caller set themselves.
      </p>
      <p>
        Resolving to no identity is right for <em>identity</em>, but discarding
        such a request is wrong for <em>abuse accounting</em>: an attacker who
        reaches your origin directly would get unlimited strikes simply by
        omitting a header. So <code>autoBan</code> falls back to the{" "}
        <strong>immediate TCP peer</strong> address, in its own{" "}
        <code>peer:</code> keyspace. The peer cannot be spoofed — it is the
        socket actually talking to your server — and in exactly the
        direct-to-origin case that produced the bypass, the peer <em>is</em> the
        attacker, so accounting becomes precise rather than absent.
      </p>
      <CodeBlock
        language="ts"
        code={`// Default. An unresolvable forwarded identity falls back to the TCP peer.
app.use(autoBan({ trustedHops: 2 }));

// Opt out: never count or ban a request whose identity cannot be resolved.
app.use(autoBan({ trustedHops: 2, onUnresolvedIdentity: "skip" }));`}
      />
      <p>
        Choose <code>&quot;skip&quot;</code> only when unresolved requests are
        known-benign and arrive from a shared address — a load balancer that
        does not always set <code>X-Forwarded-For</code>, say, where every such
        request would otherwise share that balancer&apos;s single{" "}
        <code>peer:</code> bucket and a few <code>401</code>s could ban the lot.
        Fixing the proxy configuration is the better answer. On edge runtimes
        that expose no peer socket there is nothing to attribute to, and the
        request is skipped either way. A custom <code>keyGenerator</code> owns
        its own posture: returning <code>undefined</code> still means skip.
      </p>
      <p>
        Second, <code>trustedHops</code> already implies proxy-header trust, so
        pairing it with <code>trustProxyHeaders: false</code> is a contradiction
        and throws at construction rather than silently resolving in favour of
        trust:
      </p>
      <CodeBlock
        language="ts"
        code={`// Throws: trustProxyHeaders: false contradicts trustedHops: 2.
// Drop whichever one you did not mean.
app.use(autoBan({ trustProxyHeaders: false, trustedHops: 2 }));`}
      />

      <h2 id="how-escalation-and-decay-work">
        How escalation &amp; decay work
      </h2>
      <ul>
        <li>
          Each watched response is a <strong>strike</strong>
          {". "}Strikes accumulate inside <code>windowMs</code> (default 10 min)
          and decay when the window passes.
        </li>
        <li>
          Reaching <code>maxStrikes</code> (default 5) issues a ban for{" "}
          <code>banMs</code> (default 15 min).
        </li>
        <li>
          With <code>escalate: true</code> (default) each <em>repeat</em> ban
          doubles (<code>banMs</code>
          {", "}
          <code>2×</code>
          {", "}
          <code>4×</code>
          {", "}...), capped at <code>maxBanMs</code> (default 24 h), for as
          long as the record stays alive.
        </li>
        <li>
          Once the client stops tripping statuses, the record expires and the
          escalation counter resets: the ban <strong>decays</strong>.
        </li>
      </ul>

      <h2 id="responses">Responses</h2>
      <p>
        A banned request is rejected in <code>beforeHandle</code> before the
        handler runs. By default it returns <code>429 Too Many Requests</code>{" "}
        with a <code>Retry-After</code> header and{" "}
        <code>Cache-Control: no-store</code>
        {". "}Set <code>banStatus: 403</code> for a <code>403 Forbidden</code>{" "}
        with your own <code>message</code> instead.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  autoBan({
    trustProxyHeaders: true,
    windowMs: 5 * 60_000, // 5 min strike window
    maxStrikes: 10, // 10 failures before a ban
    banMs: 30 * 60_000, // 30 min base ban
    maxBanMs: 12 * 60 * 60_000, // cap escalation at 12 h
    banStatus: 403,
    message: "Access temporarily suspended",
    watchStatuses: [401, 403, 429, 422], // also count validation failures
  }),
);`}
      />

      <h2 id="observability">Observability</h2>
      <p>
        Wire <code>onBan</code> and <code>onStrike</code> into your logger,
        alerting, or an external denylist feed:
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  autoBan({
    trustProxyHeaders: true,
    onStrike: ({ key, strikes, status }) =>
      log.debug({ key, strikes, status }, "auto-ban strike"),
    onBan: ({ key, banCount, banDurationMs }) =>
      log.warn({ key, banCount, banDurationMs }, "client banned"),
  }),
);`}
      />

      <h2 id="pluggable-store-multi-instance">
        Pluggable store (multi-instance)
      </h2>
      <p>
        The default store is in-memory and <strong>single-process</strong>
        {". "}For a horizontally-scaled deployment, implement{" "}
        <code>AutoBanStore</code> (mirroring the <code>rateLimit()</code> store
        contract) against Redis or another shared backend so a ban applies
        across every instance:
      </p>
      <CodeBlock
        language="ts"
        code={`import type { AutoBanStore, AutoBanRecord } from "@daloyjs/core/auto-ban";

const redisStore: AutoBanStore = {
  async get(key) {
    const raw = await redis.get(\`ban:\${key}\`);
    return raw ? (JSON.parse(raw) as AutoBanRecord) : undefined;
  },
  async set(key, record, ttlMs) {
    await redis.set(\`ban:\${key}\`, JSON.stringify(record), "PX", ttlMs);
  },
  async delete(key) {
    await redis.del(\`ban:\${key}\`);
  },
};

app.use(autoBan({ trustProxyHeaders: true, store: redisStore }));`}
      />
      <p>
        Implementations must treat an entry past its <code>ttlMs</code> as
        absent so bans and escalation decay automatically. To lift a ban
        manually, call <code>store.delete(key)</code>.
      </p>

      <h2 id="sharing-across-route-groups">Sharing across route groups</h2>
      <p>
        Every <code>autoBan()</code> with the same <code>groupId</code> (default{" "}
        <code>&quot;auto-ban&quot;</code>) shares one in-memory store, so a
        client banned on one group is banned on all of them, so an attacker
        can&apos;t dodge the ban by rotating endpoints.
      </p>
    </>
  );
}
