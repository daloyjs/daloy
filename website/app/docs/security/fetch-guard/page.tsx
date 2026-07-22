import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";
import { UseCaseGuide } from "../../../../components/use-case-guide";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "SSRF guard (fetchGuard)",
  description:
    "Wrap user-controlled outbound fetch() with fetchGuard() to block SSRF to RFC1918, loopback, link-local, and every documented cloud-metadata IP.",
  path: "/docs/security/fetch-guard",
  keywords: [
    "DaloyJS SSRF",
    "fetchGuard",
    "cloud metadata 169.254.169.254",
    "SSRF protection Node.js",
    "outbound fetch allowlist",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>
        SSRF guard (<code>fetchGuard</code>)
      </h1>
      <blockquote>
        <code>fetchGuard()</code> blocks private, loopback, link-local, and
        cloud metadata targets before an outbound request is sent. It checks
        redirects again so a public URL cannot bounce the request into an
        internal network.
      </blockquote>
      <p>
        Any handler that calls <code>fetch()</code> on a URL the user can
        influence (an avatar fetch, a webhook delivery, an &ldquo;import from
        URL&rdquo; feature, an OAuth discovery endpoint, an embed unfurler) is a
        Server-Side Request Forgery (SSRF) sink. The canonical exploit is{" "}
        <a href="https://www.aikido.dev/blog/how-a-startups-cloud-got-taken-over-by-a-simple-form-that-sends-an-email">
          the Aikido write-up
        </a>{" "}
        in which a contact form that emailed an avatar was redirected to{" "}
        <code>http://169.254.169.254/</code>
        {", "}the AWS cloud metadata service, which handed back short-lived IAM
        credentials and pivoted into the startup&rsquo;s S3 buckets.
      </p>

      <UseCaseGuide
        featureName="SSRF guard (fetchGuard)"
        recommendation="Use fetchGuard to wrap outbound fetch calls that request user-controlled, dynamic URLs (such as avatar URLs, webhook endpoints, or url imports). Never wrap requests going to hardcoded, static internal services or known, trusted third-party APIs."
        whenToUse={[
          "Fetching resources (avatars, images, attachments) directly from user-supplied URLs.",
          "Calling user-configured webhooks or callbacks from your application backend.",
          "Parsing arbitrary links or URLs for rich embed previews ('unfurling').",
        ]}
        whenNotToUse={[
          "Making static outbound API requests to known, trusted external services (e.g. Stripe, SendGrid) where URLs are entirely controlled by your code.",
          "Communicating with internal microservices, databases, or mesh endpoints (where private IP spaces like 10.0.0.x are expected and must be accessible).",
          "High-performance proxying where you explicitly intend to relay traffic to arbitrary destinations and DNS resolution is cached separately.",
        ]}
      />
      <FlowDiagram
        title="What every guarded fetch goes through"
        steps={[
          {
            eyebrow: "url",
            label: "Check protocol",
            detail: "http: / https: only",
            tone: "danger",
          },
          {
            eyebrow: "dns",
            label: "Resolve hostname",
            detail: "to one or more IPs",
          },
          {
            eyebrow: "ip",
            label: "Match deny ranges",
            detail: "RFC1918, loopback, 169.254.x",
            tone: "danger",
          },
          {
            eyebrow: "safe",
            label: "Dispatch request",
            detail: "redirects re-validated per hop",
            tone: "success",
          },
        ]}
        caption="A request only leaves the box after the protocol, the resolved IPs, and every redirect Location pass the deny floor. Anything that resolves to an internal or metadata address throws SsrfBlockedError instead of being sent."
      />
      <p>
        <code>fetchGuard()</code> wraps the global <code>fetch</code> and
        refuses to dispatch a request whose target resolves to a dangerous
        internal address, including every documented cloud metadata IP (AWS /
        Azure / DigitalOcean <code>169.254.169.254</code>
        {", "}Oracle Cloud <code>192.0.0.192</code>
        {", "}Alibaba <code>100.100.100.200</code>).
      </p>

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        code={`import { App, fetchGuard, SsrfBlockedError } from "@daloyjs/core";
import { z } from "zod";

const app = new App();
const safeFetch = fetchGuard();

app.post(
  "/import",
  {
    operationId: "importFromUrl",
    request: { body: z.object({ url: z.url() }) },
    responses: {
      200: { description: "ok" },
      422: { description: "bad url or refused: ssrf" },
    },
  },
  async ({ body }) => {
    const { url } = body;
    try {
      const upstream = await safeFetch(url);
      const body = await upstream.text();
      return { status: 200 as const, body };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return { status: 422 as const, body: { reason: err.reason } };
      }
      throw err;
    }
  },
);`}
      />

      <h2 id="what-gets-blocked-by-default">What gets blocked by default</h2>
      <ul>
        <li>
          Loopback: <code>127.0.0.0/8</code>
          {", "}
          <code>::1</code>
          {". "}
          Opt in with <code>allowLoopback: true</code> for local-dev fixtures.
        </li>
        <li>
          RFC1918 private: <code>10.0.0.0/8</code>
          {", "}
          <code>172.16.0.0/12</code>
          {", "}
          <code>192.168.0.0/16</code>
          {". "}Opt in with <code>allowPrivate: true</code>.
        </li>
        <li>
          Link-local (covers every cloud-metadata IP):{" "}
          <code>169.254.0.0/16</code>
          {", "}
          <code>fe80::/10</code>
          {". "}Opt in with <code>allowLinkLocal: true</code>.
        </li>
        <li>
          IPv6 unique-local: <code>fc00::/7</code>
          {". "}Opt in with <code>allowUniqueLocal: true</code>.
        </li>
        <li>
          Always-deny floor (no flag lifts these): <code>0.0.0.0/8</code>
          {", "}
          <code>100.64.0.0/10</code> (CGNAT, Alibaba metadata),{" "}
          <code>192.0.0.0/24</code> (Oracle Cloud metadata), all IANA-reserved{" "}
          <code>TEST-NET</code> / benchmarking / docs ranges,{" "}
          <code>224.0.0.0/4</code> multicast,
          <code>240.0.0.0/4</code> reserved, broadcast{" "}
          <code>255.255.255.255</code>
          {", "}IPv6 <code>::/128</code> and <code>ff00::/8</code>.
        </li>
        <li>
          Protocols other than <code>http:</code> / <code>https:</code> (
          <code>file:</code>
          {", "}
          <code>data:</code>
          {", "}
          <code>gopher:</code>
          {", "}
          <code>ftp:</code>
          {", "}
          <code>dict:</code>
          {", "}
          <code>ldap:</code>).
        </li>
      </ul>
      <p>
        IPv4-mapped IPv6 (<code>::ffff:a.b.c.d</code>) is re-checked against the
        embedded IPv4 address, so <code>http://[::ffff:169.254.169.254]/</code>{" "}
        is rejected the same way as <code>http://169.254.169.254/</code>.
      </p>

      <h2 id="redirects-are-re-validated-at-every-hop">
        Redirects are re-validated at every hop
      </h2>
      <p>
        A common SSRF bypass is to return{" "}
        <code>302 Location: http://169.254.169.254/</code> from a public host.{" "}
        <code>fetchGuard()</code> follows redirects <strong>manually</strong>
        {": "}
        it re-checks the protocol and re-resolves DNS for every Location header
        before issuing the next request. Set <code>maxRedirects: 0</code> to
        return the 3xx directly, or pass{" "}
        <code>redirect: &quot;manual&quot;</code> per call for the same effect.
      </p>

      <h2 id="custom-allowlists">Custom allowlists</h2>
      <CodeBlock
        code={`const safeFetch = fetchGuard({
  // IP / CIDR allowlist (overrides the deny defaults).
  allowAddresses: ["198.51.100.0/24", "2001:db8::/32"],
  // Hostname allowlist (skips DNS check entirely; useful for known internal services).
  allowHosts: ["api.example.com", "billing.internal"],
  // Extra deny matchers on top of the floor.
  denyAddresses: ["10.6.6.0/24"],
  // Permit loopback for local-dev fixtures only.
  allowLoopback: process.env.NODE_ENV !== "production",
});`}
      />

      <h2 id="custom-dns-resolution-non-node-runtimes">
        Custom DNS resolution (non-Node runtimes)
      </h2>
      <p>
        The default resolver uses Node&rsquo;s{" "}
        <code>node:dns/promises.lookup()</code>
        {". "}On Cloudflare Workers, Deno without <code>--allow-net</code>
        {", "}or any runtime without Node-style DNS, supply a resolver:
      </p>
      <CodeBlock
        code={`const safeFetch = fetchGuard({
  resolve: async (host) => {
    const res = await fetch(\`https://cloudflare-dns.com/dns-query?name=\${host}&type=A\`, {
      headers: { accept: "application/dns-json" },
    });
    const json = (await res.json()) as { Answer?: Array<{ data: string }> };
    return (json.Answer ?? []).map((a) => a.data);
  },
});`}
      />

      <h2 id="dns-pinning-pinDns">
        DNS pinning (<code>pinDns</code>)
      </h2>
      <p>
        On Node-like runtimes, <code>fetchGuard()</code> defaults{" "}
        <code>pinDns: true</code> when you do not supply a custom{" "}
        <code>fetch</code>
        {". "}For <code>http:</code> requests the socket is then opened through{" "}
        <code>node:http</code> against the exact IP that passed validation,
        while the original <code>Host</code> header is preserved. That closes
        the classic DNS-rebinding (TOCTOU) window for the highest value target:
        cloud metadata at <code>http://169.254.169.254</code>.
      </p>
      <CodeBlock
        language="ts"
        code={`// Default on Node: pinDns is on (http: only).
const safeFetch = fetchGuard();

// Opt out if you need the underlying fetch to own DNS (rare).
const unpinned = fetchGuard({ pinDns: false });

// Custom fetch owns its socket path: pinDns stays off unless you set it.
const custom = fetchGuard({
  fetch: myInstrumentedFetch,
  pinDns: true, // only if you also want the node:http pin path for http:
});`}
      />
      <p>
        <code>https:</code> is intentionally not pinned by this knob (TLS SNI /
        certificate validation needs the hostname path). Pass{" "}
        <code>pinDns: false</code> on Workers and other edge runtimes only if
        you had forced it on; the default is already off when{" "}
        <code>process.versions.node</code> is absent.
      </p>

      <h2 id="residual-risk-dns-rebinding-toctou">
        Residual risk: DNS rebinding (TOCTOU)
      </h2>
      <p>
        After <code>pinDns</code>
        {", "}the remaining residual is mainly <code>https:</code> rebinding and
        non-Node runtimes without a pin path. Close those with operator egress
        controls, and optionally a custom undici dispatcher for TLS upstreams:
      </p>
      <ol>
        <li>
          Operator-side (recommended). Run behind a network policy that already
          blocks egress to RFC1918 / metadata IPs: Kubernetes{" "}
          <code>NetworkPolicy</code>
          {", "}
          <code>step-security/harden-runner</code> in CI,{" "}
          <code>iptables -A OUTPUT -d 169.254.169.254 -j DROP</code> on the
          host. This neutralises rebinding even if the app is naive.
        </li>
        <li>
          Caller-side, Node-only, for <code>https:</code>. Daloy ships zero
          runtime dependencies, so we do not bundle <code>undici</code>
          {". "}If you install it yourself, you can pin the TLS socket to the IP
          you validated by plumbing a custom dispatcher through the existing{" "}
          <code>fetch</code> option:
          <CodeBlock
            language="ts"
            code={`import { fetchGuard } from "@daloyjs/core";
import { Agent, fetch as undiciFetch } from "undici";
import * as dns from "node:dns/promises";

const safeFetch = fetchGuard({
  // pinDns stays off when a custom fetch is supplied unless you force it.
  fetch: async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const { address, family } = await dns.lookup(url.hostname, { verbatim: true });
    const dispatcher = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, address, family) },
    });
    return undiciFetch(input, { ...init, dispatcher });
  },
});`}
          />
          The socket connects to the pre-resolved IP; TLS SNI and certificate
          validation still use the original hostname.
        </li>
      </ol>
      <p>
        <code>fetchGuard()</code> remains defense-in-depth on top of these
        controls.
      </p>

      <h2 id="error-shape">Error shape</h2>
      <p>
        Blocked requests throw <code>SsrfBlockedError</code> with a structured{" "}
        <code>reason</code>
        {": "}
      </p>
      <ul>
        <li>
          <code>protocol-not-allowed</code>
          {": "}URL was <code>file:</code>
          {", "}
          <code>data:</code>
          {", "}etc.
        </li>
        <li>
          <code>address-not-allowed</code>
          {": "}resolved IP fell in a blocked range.
        </li>
        <li>
          <code>dns-resolution-failed</code>
          {": "}lookup threw or returned no records.
        </li>
        <li>
          <code>too-many-redirects</code>
          {": "}chain exceeded <code>maxRedirects</code>.
        </li>
        <li>
          <code>credentials-in-url</code>
          {": "}the URL carried userinfo (<code>http://user@host/</code>), a
          classic SSRF obfuscation. The credentials are stripped from the URL
          recorded on the error.
        </li>
        <li>
          <code>invalid-url</code>
          {": "}URL or Location header could not be parsed.
        </li>
      </ul>
      <p>
        Network failures from the underlying <code>fetch</code> (DNS timeouts,
        TLS errors, connection refused) bubble through unchanged so your retry
        logic can distinguish &ldquo;Daloy refused&rdquo; from &ldquo;the
        upstream is sad.&rdquo;
      </p>
    </>
  );
}
