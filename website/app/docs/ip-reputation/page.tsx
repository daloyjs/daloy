import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "IP reputation / dynamic denylist feed",
  description:
    "Wire pluggable abuse feeds (Tor exit lists, Spamhaus DROP, cloud-abuse ranges) into your app with ipReputation(): periodic refresh, fail-open semantics, and the same SSRF-grade CIDR matcher as ipRestriction(). Zero runtime dependencies.",
  path: "/docs/ip-reputation",
  keywords: [
    "IP reputation",
    "denylist",
    "ipReputation",
    "Spamhaus DROP",
    "Tor exit list",
    "threat intel",
    "WAF",
    "fail-open",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>IP reputation / dynamic denylist feed</h1>
      <p>
        DaloyJS ships <code>ipReputation()</code>.
        Where <code>ipRestriction()</code> enforces a <em>static</em> allow/deny
        list compiled once at startup, <code>ipReputation()</code> wires{" "}
        <strong>pluggable, periodically-refreshed abuse feeds</strong> (Tor
        exit lists, Spamhaus DROP, cloud-abuse ranges, or your own threat
        intelligence) into the request path without a redeploy.
      </p>
      <ul>
        <li>
          <strong>Pluggable feeds</strong>: any source that yields IP / CIDR
          strings. <code>urlFeed()</code> ships for the common case (fetch a
          newline / Spamhaus-DROP-style list over HTTP).
        </li>
        <li>
          <strong>Periodic refresh</strong>: the denylist reloads on an
          <code>unref</code>&apos;d timer so stale ranges expire and new ones
          are picked up automatically.
        </li>
        <li>
          <strong>Fail-open</strong>: a denylist is additive defense, never the
          only gate. If a feed can&apos;t be loaded (initial or refresh),
          traffic is <em>not</em> blocked: the last-known-good list is retained.
          A feed outage never takes your app down.
        </li>
      </ul>
      <p>
        It reuses the same SSRF-grade CIDR matcher as{" "}
        <code>ipRestriction()</code>, is dependency-free, and runs on every
        supported runtime.
      </p>

      <FlowDiagram
        title="Request against the denylist"
        steps={[
          {
            label: "Resolve client IP",
            detail: "socket value, or X-Forwarded-For when trustProxyHeaders",
            eyebrow: "request",
          },
          {
            label: "Match the compiled CIDR set",
            detail: "same SSRF-grade matcher as ipRestriction()",
            tone: "accent",
          },
          {
            label: "Listed -> block",
            detail: "log mode never blocks; only fires onMatch",
            tone: "danger",
          },
          {
            label: "Not listed / unresolved IP -> allow",
            detail: "feed outage retains last-known-good; fail-open",
            tone: "success",
          },
        ]}
        caption="The denylist is periodically refreshed from pluggable feeds. Reputation is layered defense, so a failed load or an unresolvable IP never blocks traffic: it retains the last-known-good list and lets the request through."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { ipReputation, urlFeed } from "@daloyjs/core";

const app = createApp();

const reputation = ipReputation({
  // Trust the proxy that fronts your app to set X-Forwarded-For.
  trustProxyHeaders: true,
  feeds: [
    urlFeed("https://www.spamhaus.org/drop/drop.txt", { name: "spamhaus-drop" }),
    urlFeed("https://check.torproject.org/torbulkexitlist", { name: "tor-exit" }),
  ],
  refreshIntervalMs: 60 * 60_000, // hourly
});

app.use(reputation.hooks);

// Release the refresh timer on graceful shutdown.
process.on("SIGTERM", () => reputation.stop());`}
      />

      <h2 id="wiring-abuse-feeds">Wiring abuse feeds</h2>
      <p>
        A feed is anything implementing <code>IpReputationFeed</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`interface IpReputationFeed {
  name: string;
  fetch(signal?: AbortSignal): Promise<readonly string[]>;
}`}
      />
      <p>
        <code>urlFeed()</code> covers the common case. It fetches the URL,
        understands the Spamhaus-DROP-style{" "}
        <code>{"<cidr> ; <annotation>"}</code> format, and skips <code>#</code>,{" "}
        <code>;</code>, and <code>{"//"}</code> comment lines. Lines that
        aren&apos;t valid IPs/CIDRs are skipped, so a partially-malformed feed
        still loads its good rows.
      </p>
      <CodeBlock
        language="ts"
        code={`// Custom feed backed by your own threat-intel store.
const internalFeed: IpReputationFeed = {
  name: "internal-blocklist",
  async fetch() {
    const rows = await db.query("SELECT cidr FROM blocked_ranges");
    return rows.map((r) => r.cidr);
  },
};

const reputation = ipReputation({
  feeds: [internalFeed],
  trustProxyHeaders: true,
});`}
      />

      <h2 id="fail-open-semantics">Fail-open semantics</h2>
      <p>
        Reputation is layered defense, so an unavailable feed must never block
        legitimate traffic:
      </p>
      <ul>
        <li>
          A failed <strong>initial</strong> load leaves an empty (permissive)
          denylist, so requests flow.
        </li>
        <li>
          A failed <strong>refresh</strong> keeps the previous, last-known-good
          entries for that feed; the other feeds are unaffected.
        </li>
        <li>
          An <strong>unresolvable client IP</strong> is treated as not-listed.
        </li>
      </ul>
      <p>
        Observe feed health with <code>onError</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`const reputation = ipReputation({
  feeds: [urlFeed("https://example.com/blocklist.txt")],
  trustProxyHeaders: true,
  onError: (err, feedName) => {
    metrics.increment("ip_reputation.feed_error", { feed: feedName });
    logger.warn({ err, feedName }, "reputation feed refresh failed");
  },
});`}
      />

      <h2 id="monitor-mode">Monitor mode</h2>
      <p>
        Roll a new feed out in <code>&quot;log&quot;</code> mode first to
        measure what it would block before you enforce it:
      </p>
      <CodeBlock
        language="ts"
        code={`const reputation = ipReputation({
  feeds: [urlFeed("https://example.com/new-feed.txt")],
  trustProxyHeaders: true,
  mode: "log", // never blocks; only fires onMatch
  onMatch: ({ ip, feeds }) => {
    logger.info({ ip, feeds }, "would-block (monitor mode)");
  },
});`}
      />

      <h2 id="manual-refresh-and-introspection">Manual refresh &amp; introspection</h2>
      <p>
        <code>ipReputation()</code> returns a controller you can drive directly:
      </p>
      <CodeBlock
        language="ts"
        code={`const reputation = ipReputation({
  feeds: [urlFeed("https://example.com/blocklist.txt")],
  refreshIntervalMs: 0,   // disable the timer; refresh on your own schedule
  loadOnStart: false,     // defer the first load
});

await reputation.refresh();          // force a reload now
await reputation.ready;              // resolves after the first load attempt
reputation.size;                     // number of compiled entries
reputation.has("203.0.113.7");       // probe without side effects`}
      />

      <h2 id="custom-ip-resolution">Custom IP resolution</h2>
      <p>
        By default the client IP is resolved from the socket-supplied value; set{" "}
        <code>trustProxyHeaders: true</code> to read{" "}
        <code>X-Forwarded-For</code> / <code>X-Real-IP</code> (only behind a
        proxy you trust to overwrite them), or pass your own{" "}
        <code>resolveIp</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`const reputation = ipReputation({
  feeds: [urlFeed("https://example.com/blocklist.txt")],
  resolveIp: (ctx) => ctx.request.headers.get("cf-connecting-ip") ?? undefined,
});`}
      />

      <h2 id="security-notes">Security notes</h2>
      <ul>
        <li>
          <strong>Defense in depth.</strong> A denylist complements (never
          replaces) authentication, rate limiting, and{" "}
          <code>ipRestriction()</code> allowlists.
        </li>
        <li>
          <strong>Trust your feeds.</strong> A compromised feed can deny
          legitimate clients. Prefer reputable sources and watch{" "}
          <code>onError</code> / match volume.
        </li>
        <li>
          <strong>SSRF.</strong> <code>urlFeed()</code> uses the platform{" "}
          <code>fetch</code>; pass an SSRF-guarded <code>fetchImpl</code> if
          feed URLs are operator-configurable.
        </li>
      </ul>
    </>
  );
}
