import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

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
        <strong>Think of it like…</strong> a corporate firewall on your office
        laptop. You can still browse the public internet, but the firewall
        won&apos;t let you dial the building&apos;s admin console at
        <code> 10.0.0.5</code>: even if a phishing email tells you to. SSRF is
        the exact same trick aimed at your server: an attacker gives your code a
        URL, hoping it&apos;ll quietly fetch your own internal admin panel or
        the cloud provider&apos;s metadata endpoint. <code>fetchGuard()</code>
        is the firewall.
      </blockquote>
      <p>
        Any handler that calls <code>fetch()</code> on a URL the user can
        influence (an avatar fetch, a webhook delivery, an &ldquo;import from
        URL&rdquo; feature, an OAuth discovery endpoint, an embed unfurler) is a
        Server-Side Request Forgery (SSRF) sink. The canonical
        exploit is{" "}
        <a href="https://www.aikido.dev/blog/how-a-startups-cloud-got-taken-over-by-a-simple-form-that-sends-an-email">
          the Aikido write-up
        </a>{" "}
        in which a contact form that emailed an avatar was redirected to{" "}
        <code>http://169.254.169.254/</code>, the AWS cloud metadata service,
        which handed back short-lived IAM credentials and pivoted into the
        startup&rsquo;s S3 buckets.
      </p>
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
        Azure / DigitalOcean <code>169.254.169.254</code>, Oracle Cloud{" "}
        <code>192.0.0.192</code>, Alibaba <code>100.100.100.200</code>).
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        code={`import { App, fetchGuard, SsrfBlockedError } from "@daloyjs/core";
import { z } from "zod";

const app = new App();
const safeFetch = fetchGuard();

app.route({
  method: "POST",
  path: "/import",
  operationId: "importFromUrl",
  request: { json: z.object({ url: z.string().url() }) },
  responses: {
    200: { description: "ok" },
    400: { description: "bad url" },
    422: { description: "refused: ssrf" },
  },
  handler: async ({ request }) => {
    const { url } = await request.json();
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
});`}
      />

      <h2>What gets blocked by default</h2>
      <ul>
        <li>
          <strong>Loopback:</strong> <code>127.0.0.0/8</code>, <code>::1</code>.
          Opt in with <code>allowLoopback: true</code> for local-dev fixtures.
        </li>
        <li>
          <strong>RFC1918 private:</strong> <code>10.0.0.0/8</code>,{" "}
          <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>. Opt in with{" "}
          <code>allowPrivate: true</code>.
        </li>
        <li>
          <strong>Link-local (covers every cloud-metadata IP):</strong>{" "}
          <code>169.254.0.0/16</code>, <code>fe80::/10</code>. Opt in with{" "}
          <code>allowLinkLocal: true</code>.
        </li>
        <li>
          <strong>IPv6 unique-local:</strong> <code>fc00::/7</code>. Opt in with{" "}
          <code>allowUniqueLocal: true</code>.
        </li>
        <li>
          <strong>Always-deny floor (no flag lifts these):</strong>{" "}
          <code>0.0.0.0/8</code>, <code>100.64.0.0/10</code> (CGNAT, Alibaba
          metadata), <code>192.0.0.0/24</code> (Oracle Cloud metadata),
          all IANA-reserved <code>TEST-NET</code> / benchmarking / docs ranges,{" "}
          <code>224.0.0.0/4</code> multicast,
          <code>240.0.0.0/4</code> reserved, broadcast{" "}
          <code>255.255.255.255</code>, IPv6 <code>::/128</code> and{" "}
          <code>ff00::/8</code>.
        </li>
        <li>
          <strong>
            Protocols other than <code>http:</code> / <code>https:</code>
          </strong>{" "}
          (<code>file:</code>, <code>data:</code>, <code>gopher:</code>,{" "}
          <code>ftp:</code>, <code>dict:</code>, <code>ldap:</code>).
        </li>
      </ul>
      <p>
        IPv4-mapped IPv6 (<code>::ffff:a.b.c.d</code>) is re-checked against the
        embedded IPv4 address, so <code>http://[::ffff:169.254.169.254]/</code>{" "}
        is rejected the same way as <code>http://169.254.169.254/</code>.
      </p>

      <h2>Redirects are re-validated at every hop</h2>
      <p>
        A common SSRF bypass is to return{" "}
        <code>302 Location: http://169.254.169.254/</code> from a public host.{" "}
        <code>fetchGuard()</code> follows redirects <strong>manually</strong>:
        it re-checks the protocol and re-resolves DNS for every Location header
        before issuing the next request. Set <code>maxRedirects: 0</code>{" "}
        to return the 3xx directly, or pass{" "}
        <code>redirect: &quot;manual&quot;</code> per call for the same effect.
      </p>

      <h2>Custom allowlists</h2>
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

      <h2>Custom DNS resolution (non-Node runtimes)</h2>
      <p>
        The default resolver uses Node&rsquo;s{" "}
        <code>node:dns/promises.lookup()</code>. On Cloudflare Workers, Deno
        without <code>--allow-net</code>, or any runtime without Node-style DNS,
        supply a resolver:
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

      <h2>Residual risk: DNS rebinding (TOCTOU)</h2>
      <p>
        The guard resolves the hostname once and validates every returned
        address, but between that resolution and the underlying TCP connect, an
        attacker who controls the authoritative DNS (TTL=0) could change the
        answer. We close this at two layers, both opt-in:
      </p>
      <ol>
        <li>
          <strong>Operator-side (recommended).</strong> Run behind a network
          policy that already blocks egress to RFC1918 / metadata IPs:
          Kubernetes <code>NetworkPolicy</code>,{" "}
          <code>step-security/harden-runner</code> in CI,{" "}
          <code>iptables -A OUTPUT -d 169.254.169.254 -j DROP</code> on the
          host. This neutralises rebinding even if the app is naive.
        </li>
        <li>
          <strong>Caller-side, Node-only.</strong> Daloy ships zero runtime
          dependencies, so we do not bundle <code>undici</code>. If you install
          it yourself, you can pin the socket to the IP you validated by
          plumbing a custom dispatcher through the existing <code>fetch</code>{" "}
          option:
          <CodeBlock
            language="ts"
            code={`import { fetchGuard } from "@daloyjs/core";
import { Agent, fetch as undiciFetch } from "undici";
import * as dns from "node:dns/promises";

const safeFetch = fetchGuard({
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

      <h2>Error shape</h2>
      <p>
        Blocked requests throw <code>SsrfBlockedError</code> with a structured{" "}
        <code>reason</code>:
      </p>
      <ul>
        <li>
          <code>protocol-not-allowed</code>: URL was <code>file:</code>,{" "}
          <code>data:</code>, etc.
        </li>
        <li>
          <code>address-not-allowed</code>: resolved IP fell in a blocked range.
        </li>
        <li>
          <code>dns-resolution-failed</code>: lookup threw or returned no
          records.
        </li>
        <li>
          <code>too-many-redirects</code>: chain exceeded{" "}
          <code>maxRedirects</code>.
        </li>
        <li>
          <code>invalid-url</code>: URL or Location header could not be parsed.
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
