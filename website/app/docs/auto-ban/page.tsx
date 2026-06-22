import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

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
        DaloyJS ships <code>autoBan()</code>, a
        reusable, escalating, decaying ban primitive. Where{" "}
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
            detail: "checked in beforeHandle",
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

      <h2>Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { autoBan } from "@daloyjs/core";

const app = createApp();

// Five 401/403/429s within 10 min → a 15 min ban that doubles for repeat abuse.
app.use(autoBan({ trustProxyHeaders: true }));`}
      />
      <p>
        Mount it globally with <code>app.use()</code> so it observes every
        route. Because it reads the outgoing status, it counts failures produced
        by <em>any</em> downstream middleware or handler (auth rejections,
        rate-limit
        <code>429</code>s, your own <code>403</code>s), not just its own.
      </p>

      <h2>Identity is mandatory</h2>
      <p>
        <code>autoBan()</code> refuses to construct unless it can identify
        clients: pass a <code>keyGenerator</code> or set{" "}
        <code>trustProxyHeaders: true</code>. This is deliberate: a shared{" "}
        <code>&quot;global&quot;</code> bucket would let a single offender ban
        every caller at once. A request the key generator cannot attribute
        (returns <code>undefined</code>) is skipped: never counted, never
        banned.
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

      <h2>How escalation &amp; decay work</h2>
      <ul>
        <li>
          Each watched response is a <strong>strike</strong>. Strikes accumulate
          inside <code>windowMs</code> (default 10 min) and decay when the
          window passes.
        </li>
        <li>
          Reaching <code>maxStrikes</code> (default 5) issues a ban for{" "}
          <code>banMs</code> (default 15 min).
        </li>
        <li>
          With <code>escalate: true</code> (default) each <em>repeat</em> ban
          doubles (<code>banMs</code>, <code>2×</code>, <code>4×</code>, …),
          capped at <code>maxBanMs</code> (default 24 h), for as long as the
          record stays alive.
        </li>
        <li>
          Once the client stops tripping statuses, the record expires and the
          escalation counter resets: the ban <strong>decays</strong>.
        </li>
      </ul>

      <h2>Responses</h2>
      <p>
        A banned request is rejected in <code>beforeHandle</code> before the
        handler runs. By default it returns <code>429 Too Many Requests</code>{" "}
        with a <code>Retry-After</code> header and{" "}
        <code>Cache-Control: no-store</code>. Set <code>banStatus: 403</code>{" "}
        for a <code>403 Forbidden</code> with your own <code>message</code>{" "}
        instead.
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

      <h2>Observability</h2>
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

      <h2>Pluggable store (multi-instance)</h2>
      <p>
        The default store is in-memory and <strong>single-process</strong>. For
        a horizontally-scaled deployment, implement <code>AutoBanStore</code>{" "}
        (mirroring the <code>rateLimit()</code> store contract) against Redis or
        another shared backend so a ban applies across every instance:
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

      <h2>Sharing across route groups</h2>
      <p>
        Every <code>autoBan()</code> with the same <code>groupId</code> (default{" "}
        <code>&quot;auto-ban&quot;</code>) shares one in-memory store, so a
        client banned on one group is banned on all of them, so an attacker
        can&apos;t dodge the ban by rotating endpoints.
      </p>
    </>
  );
}
