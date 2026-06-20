import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "GeoIP / geo-blocking",
  description:
    "Allow or deny traffic by country with geoBlock() — bring your own MaxMind reader or read an edge country header (CF-IPCountry, CloudFront-Viewer-Country, x-vercel-ip-country). No bundled GeoIP database, zero runtime dependencies, fail-closed allow-lists.",
  path: "/docs/geo-block",
  keywords: [
    "GeoIP",
    "geo-blocking",
    "geoBlock",
    "country block",
    "MaxMind",
    "CF-IPCountry",
    "ISO 3166",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>GeoIP / geo-blocking</h1>
      <p>
        As of <strong>0.37.0</strong> DaloyJS ships <code>geoBlock()</code> — a
        country allow/deny middleware that maps the client IP to a country and
        rejects (or logs) traffic from countries you don&apos;t serve. It is the
        compliance/abuse counterpart to <code>ipRestriction()</code> and{" "}
        <code>ipReputation()</code>.
      </p>
      <ul>
        <li>
          <strong>No bundled database</strong> — Daloy ships no GeoIP data and
          adds no runtime dependency. You supply the IP&nbsp;→&nbsp;country
          mapping (a MaxMind reader, an <code>ip2location</code> reader, your
          own table) <em>or</em> read a country header injected by your edge.
        </li>
        <li>
          <strong>Two strategies, pick one</strong> —{" "}
          <code>lookupCountry(ip)</code> when you own the lookup, or{" "}
          <code>resolveCountry(ctx)</code> when an upstream already attached the
          country.
        </li>
        <li>
          <strong>Fail-closed allow-lists</strong> — when an <code>allow</code>{" "}
          list is configured, an <em>unknown</em> country is rejected by default
          (it&apos;s not on the list). Deny-only configurations fail open. Both
          are overridable with <code>allowUnknownCountry</code>.
        </li>
        <li>
          <strong>Reuses trusted-proxy IP resolution</strong> — the same{" "}
          <code>X-Forwarded-For</code> / <code>X-Real-IP</code> handling (off by
          default, opt in with <code>trustProxyHeaders</code>) as the other
          network guards.
        </li>
      </ul>

      <FlowDiagram
        title="Country decision"
        steps={[
          {
            label: "Resolve country",
            detail: "lookupCountry(ip) or resolveCountry(ctx) header",
            eyebrow: "request",
          },
          {
            label: "On deny list?",
            detail: "a deny match always wins (least privilege)",
            tone: "danger",
          },
          {
            label: "Allow list set + not listed?",
            detail: "only listed countries pass",
            tone: "danger",
          },
          {
            label: "Unknown country?",
            detail: "allow-list -> blocked (fail closed); deny-only -> allowed",
            tone: "accent",
          },
          {
            label: "Permitted -> handler",
            detail: "country stamped on ctx.state.geo",
            tone: "success",
          },
        ]}
        caption="Deny is evaluated first, then the allow-list gate. An unresolved country fails closed when an allow-list is configured and fails open for deny-only setups, both overridable with allowUnknownCountry. A blocked request returns 403 without echoing the country."
      />

      <h2>Strategy 1 — bring your own IP → country lookup</h2>
      <p>
        Use any GeoIP reader as an operator dependency. Daloy resolves the
        client IP and hands it to <code>lookupCountry</code>; return an ISO
        3166-1 alpha-2 code (or nothing when the IP can&apos;t be mapped).
      </p>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { geoBlock } from "@daloyjs/core";
import maxmind, { type CountryResponse } from "maxmind"; // your dependency, not Daloy's

const app = createApp();

const reader = await maxmind.open<CountryResponse>("./GeoLite2-Country.mmdb");

app.use(
  geoBlock({
    // Block sanctioned/embargoed regions, allow everyone else.
    deny: ["KP", "IR", "SY", "CU"],
    // Only trust X-Forwarded-For when a proxy you control sets it.
    trustProxyHeaders: true,
    lookupCountry: (ip) => reader.get(ip)?.country?.iso_code,
  }),
);`}
      />

      <h2>Strategy 2 — read an edge-injected country header</h2>
      <p>
        If your app runs behind a CDN or platform that already geolocates the
        request, skip the IP lookup entirely and read the header. No proxy-trust
        configuration is needed because you are not parsing{" "}
        <code>X-Forwarded-For</code> yourself.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  geoBlock({
    // Allow-list: only these countries may reach the app.
    allow: ["US", "CA", "GB", "DE", "FR"],
    resolveCountry: (ctx) => ctx.request.headers.get("cf-ipcountry"),
  }),
);`}
      />

      <h2>Deployment-platform country headers</h2>
      <p>
        Most edges expose the resolved country as a request header, which makes{" "}
        <code>resolveCountry</code> a one-liner. Common values:
      </p>
      <CodeBlock
        language="ts"
        code={`// Cloudflare (Workers / proxied):      CF-IPCountry
geoBlock({ allow, resolveCountry: (c) => c.request.headers.get("cf-ipcountry") });

// AWS CloudFront:                       CloudFront-Viewer-Country
geoBlock({ allow, resolveCountry: (c) => c.request.headers.get("cloudfront-viewer-country") });

// Vercel:                               x-vercel-ip-country
geoBlock({ allow, resolveCountry: (c) => c.request.headers.get("x-vercel-ip-country") });

// Fastly (configured VCL):              Fastly-Geo-Country / a header you set
geoBlock({ allow, resolveCountry: (c) => c.request.headers.get("fastly-geo-country") });`}
      />
      <p>
        On platforms that do <em>not</em> inject a country header (a bare Node /
        Bun / Deno deployment, or a VPS), use <strong>Strategy 1</strong> with a
        local MaxMind database and <code>trustProxyHeaders</code> matched to
        your proxy chain. Cloudflare&apos;s <code>CF-IPCountry</code> can also
        be <code>XX</code> (unknown) or <code>T1</code> (Tor) — those are
        treated as an unknown country unless you list them explicitly.
      </p>

      <h2>Allow-list vs. deny-list semantics</h2>
      <ul>
        <li>
          <strong>deny</strong> — listed countries are always rejected; a deny
          match wins over an allow match (least privilege).
        </li>
        <li>
          <strong>allow</strong> — when non-empty, only listed countries pass;
          everything else (including an unresolved country) is rejected.
        </li>
        <li>
          <strong>both</strong> — deny is evaluated first, then the allow-list
          gate.
        </li>
      </ul>
      <p>
        Country codes are case-insensitive and validated at construction — a
        typo like <code>&quot;USA&quot;</code> throws immediately rather than
        silently never matching.
      </p>

      <h2>Unknown countries</h2>
      <p>
        When the country can&apos;t be resolved (no IP, no mapping, empty
        header), the default is:
      </p>
      <ul>
        <li>
          <strong>allow-list configured</strong> → <em>blocked</em> (fail
          closed).
        </li>
        <li>
          <strong>deny-only</strong> → <em>allowed</em> (fail open).
        </li>
      </ul>
      <p>
        Override either way with <code>allowUnknownCountry</code>.
      </p>

      <h2>Monitoring before enforcing</h2>
      <p>
        Roll out safely with <code>mode: &quot;log&quot;</code>: requests are
        never blocked, but <code>onBlock</code> fires for every would-be block
        so you can measure impact first.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  geoBlock({
    allow: ["US", "CA"],
    mode: "log", // observe only — nothing is blocked yet
    resolveCountry: (c) => c.request.headers.get("cf-ipcountry"),
    onBlock: (d) => {
      // d.reason: "denied_country" | "not_in_allowlist" | "unknown_country"
      console.warn("geo would-block", d.reason, d.country, d.ip);
    },
  }),
);`}
      />

      <h2>Reading the country downstream</h2>
      <p>
        For allowed requests, the resolved country is stamped on{" "}
        <code>ctx.state.geo</code> (rename with <code>stateKey</code>), so
        handlers can localise or audit without a second lookup.
      </p>
      <CodeBlock
        language="ts"
        code={`app.get("/pricing", (ctx) => {
  const country = (ctx.state.geo as { country?: string } | undefined)?.country;
  return { status: 200 as const, body: { currency: country === "GB" ? "GBP" : "USD" } };
});`}
      />

      <h2>Rejection response</h2>
      <p>
        A blocked request throws <code>ForbiddenError</code>, rendered as RFC
        9457 <code>application/problem+json</code> with HTTP <code>403</code>{" "}
        and <code>Cache-Control: no-store</code>. The default message (
        <code>&quot;Access from your region is not permitted&quot;</code>) is
        configurable via <code>message</code> and deliberately does not echo the
        country or IP back to the client.
      </p>

      <h2>Security notes</h2>
      <ul>
        <li>
          Geo-blocking is a <strong>compliance / abuse-reduction</strong> tool,
          not an authentication control. VPNs and proxies defeat it; pair it
          with real auth.
        </li>
        <li>
          Only set <code>trustProxyHeaders</code> when every request reaches
          Daloy through a proxy chain you control — otherwise{" "}
          <code>X-Forwarded-For</code> is attacker-spoofable.
        </li>
        <li>
          Keep your GeoIP database current; stale data misclassifies reassigned
          ranges.
        </li>
      </ul>
    </>
  );
}
