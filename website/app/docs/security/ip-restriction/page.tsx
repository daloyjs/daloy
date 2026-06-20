import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "IP allow/deny lists",
  description:
    "Enforce network-layer access control with ipRestriction(): IPv4/IPv6/CIDR allow- and deny-lists that fail closed by default, with explicit opt-in for trusted proxy headers. The static counterpart to ipReputation() and geoBlock().",
  path: "/docs/security/ip-restriction",
  keywords: [
    "DaloyJS ipRestriction",
    "IP allow list",
    "CIDR deny list",
    "network access control",
    "trusted proxy IP",
    "TypeScript IP filtering",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>IP allow/deny lists</h1>
      <blockquote>
        <strong>Think of it like…</strong> a guest list at the door. Names on
        the allow list get in; names on the deny list are turned away no matter
        what — and if the bouncer can&apos;t see who you are at all, you
        don&apos;t get in either.
      </blockquote>
      <p>
        <code>ipRestriction()</code> enforces network-layer access control using
        IPv4 / IPv6 / CIDR allow- and deny-lists. It is the <em>static</em>{" "}
        counterpart to <code>ipReputation()</code> (dynamic abuse feeds) and{" "}
        <code>geoBlock()</code> (country-level compliance). On reject it throws
        a <code>ForbiddenError</code>, which DaloyJS renders as RFC 9457{" "}
        <code>application/problem+json</code> with HTTP <code>403</code>.
      </p>

      <h2>Fails closed by default</h2>
      <p>
        Web-standard <code>Request</code> objects do not expose the peer
        address, so DaloyJS <strong>fails closed</strong>: unless you tell it
        how to resolve the client IP, every request is rejected. You opt in
        either by providing a <code>resolveIp</code> function (reads adapter
        connection metadata) or by enabling <code>trustProxyHeaders</code>{" "}
        behind a proxy chain you control.
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        code={`import { App, ipRestriction, readRemoteAddress } from "@daloyjs/core";

const app = new App({ trustProxy: true });

app.use(ipRestriction({
  allow: ["10.0.0.0/8", "::1"],
  deny: ["10.6.6.0/24"],
  trustProxyHeaders: true,
}));`}
      />
      <p>
        At least one of <code>allow</code> or <code>deny</code> must be
        provided; passing neither throws at construction time.
      </p>

      <h2>How matching works</h2>
      <FlowDiagram
        title="Resolve then match (fail closed)"
        steps={[
          {
            eyebrow: "ingress",
            label: "Request",
            detail: "resolveIp / trustProxyHeaders",
          },
          {
            eyebrow: "no IP",
            label: "Cannot resolve client IP",
            detail: "fail closed to 403 ForbiddenError",
            tone: "danger",
          },
          {
            eyebrow: "deny first",
            label: "Matches a deny range?",
            detail: "deny wins, even over allow to 403",
            tone: "danger",
          },
          {
            eyebrow: "allow whitelist",
            label: "Outside the allow list?",
            detail: "not whitelisted to 403",
            tone: "danger",
          },
          {
            eyebrow: "permitted",
            label: "Allowed",
            detail: "request proceeds",
            tone: "success",
          },
        ]}
        caption="A request must first resolve to a client IP or it is rejected. Deny ranges are checked first and always win, then the allow list acts as a whitelist. Anything that is not explicitly permitted is refused with a 403."
      />
      <ul>
        <li>
          <strong>Deny wins.</strong> When both lists are supplied, the matcher
          runs deny-first then allow-otherwise. A deny match always loses to
          nothing — even an explicit allow-list entry cannot override a deny,
          matching the principle of least privilege.
        </li>
        <li>
          <strong>Allow is a whitelist.</strong> When <code>allow</code> is set,
          any peer whose address does not match an entry is rejected with{" "}
          <code>403</code>.
        </li>
        <li>
          <strong>Deny-only.</strong> With just a <code>deny</code> list,
          everything is permitted except the listed ranges.
        </li>
      </ul>

      <h2>Resolving the client IP</h2>
      <p>
        Behind a trusted proxy chain, set <code>trustProxyHeaders: true</code>{" "}
        to read <code>X-Forwarded-For</code> / <code>X-Real-IP</code>. This
        defaults to <code>false</code> because those headers are
        client-spoofable unless every request reaches DaloyJS through
        infrastructure you control. Pair it with{" "}
        <code>new App(&#123; trustProxy: true &#125;)</code> in production.
      </p>
      <CodeBlock
        language="ts"
        code={`import { readRemoteAddress } from "@daloyjs/core";

// Direct (no proxy): read the IP from adapter connection metadata.
app.use(ipRestriction({
  allow: ["203.0.113.0/24"],
  resolveIp: (ctx) => readRemoteAddress(ctx),
}));

// Behind a CDN/load balancer you control:
const app = new App({ trustProxy: true });
app.use(ipRestriction({
  deny: ["192.0.2.0/24"],
  trustProxyHeaders: true,
}));`}
      />

      <h2>Customizing the rejection</h2>
      <p>
        Override the response body with <code>message</code>. Keep it generic —
        echoing the client IP back can leak proxy topology to attackers, so the
        default message deliberately does not include it.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(ipRestriction({
  allow: ["10.0.0.0/8"],
  resolveIp: (ctx) => readRemoteAddress(ctx),
  message: "Access denied from your network.",
}));`}
      />

      <h2>When to reach for it</h2>
      <ul>
        <li>
          <strong>Internal admin surfaces</strong> reachable only from a VPN or
          office CIDR range.
        </li>
        <li>
          <strong>Partner allow-lists</strong> where a fixed set of source
          ranges may call your API.
        </li>
        <li>
          <strong>Hard blocks</strong> on a handful of known-bad ranges while
          keeping a broad allow-list. For evolving threat data, layer{" "}
          <code>ipReputation()</code> on top.
        </li>
      </ul>
    </>
  );
}
