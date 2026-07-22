import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "mTLS / client-certificate auth",
  description:
    "Authenticate clients by TLS certificate with clientCertAuth(): verified-chain enforcement, subject/issuer/fingerprint/SAN allow-lists, validity-window checks, native Node TLS, and trusted-proxy header parsing (Envoy XFCC, nginx). Zero runtime dependencies.",
  path: "/docs/mtls",
  keywords: [
    "mTLS",
    "mutual TLS",
    "client certificate authentication",
    "clientCertAuth",
    "zero trust",
    "service-to-service",
    "X-Forwarded-Client-Cert",
    "XFCC",
    "SPIFFE",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>mTLS / client-certificate auth</h1>
      <p>
        DaloyJS ships <code>clientCertAuth()</code>
        {", "}a middleware that authenticates a request by its{" "}
        <strong>TLS client certificate</strong>
        {", "}
        the standard answer to &ldquo;prove this internal call came from a
        trusted peer&rdquo; in zero-trust / service-to-service deployments. It
        is dependency-free and runtime-portable, with two certificate sources:
      </p>
      <ul>
        <li>
          Native TLS
          {": "}when the runtime terminates TLS itself, the Node adapter reads
          the peer certificate off the socket and attaches it to the request
          (lazily, so plain requests pay nothing).
        </li>
        <li>
          Forwarded by a trusted proxy
          {": "}when TLS is terminated upstream (Envoy, nginx, HAProxy, Traefik,
          a cloud load balancer), the middleware parses the verified identity
          the proxy forwards in request headers (Envoy{" "}
          <code>X-Forwarded-Client-Cert</code> or operator-named structured
          headers).
        </li>
      </ul>

      <SequenceDiagram
        title="Certificate verification"
        participants={["Peer", "TLS terminator", "clientCertAuth()", "Handler"]}
        steps={[
          {
            from: "Peer",
            to: "TLS terminator",
            kind: "request",
            label: "TLS handshake presents client certificate",
            detail:
              "native socket, or forwarded by a trusted proxy (XFCC / structured headers)",
          },
          {
            from: "TLS terminator",
            to: "clientCertAuth()",
            kind: "request",
            label:
              "Normalized ClientCertificate (subject, issuer, fingerprint, SANs, verified)",
            detail: "read lazily; plain requests pay nothing",
          },
          {
            from: "clientCertAuth()",
            to: "Peer",
            kind: "note",
            label:
              "No certificate -> 401; unverified / allow-list miss / expired -> 403",
            detail: "403 never echoes which check failed",
          },
          {
            from: "clientCertAuth()",
            to: "Handler",
            kind: "response",
            label: "Verified + allow-listed -> proceed",
            detail:
              "ctx.state.clientCertificate stamped for downstream + audit",
          },
        ]}
        caption="The TLS layer verifies the chain; clientCertAuth() then enforces requireVerified, the subject/issuer/fingerprint/SAN allow-lists, the validity window, and any custom verify() hook in preBody. Anything that fails is rejected before request-body I/O or the handler."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { clientCertAuth } from "@daloyjs/core";

const app = createApp();

// Only peers whose certificate was issued by our internal CA and whose
// SPIFFE ID is on the allow-list may reach these routes.
app.use(
  clientCertAuth({
    allowIssuerCNs: ["acme-internal-ca"],
    allowSANs: ["URI:spiffe://acme/svc-a"],
  }),
);

app.post(
  "/internal/charge",
  {
    responses: { 200: { description: "ok" } },
  },
  (ctx) => {
    const cert = ctx.state.clientCertificate; // the accepted ClientCertificate
    return { status: 200, body: { caller: cert.subjectCN } };
  },
);`}
      />
      <p>
        On success the accepted{" "}
        <a href="#the-clientcertificate">
          <code>ClientCertificate</code>
        </a>{" "}
        is stamped on <code>ctx.state.clientCertificate</code> (configurable via{" "}
        <code>stateKey</code>) for downstream handlers and audit logging.
      </p>

      <h2 id="rejection-semantics">Rejection semantics</h2>
      <ul>
        <li>
          No certificate presented &rarr; <code>401</code>{" "}
          <code>application/problem+json</code> with{" "}
          <code>Cache-Control: no-store</code>.
        </li>
        <li>
          Unverified chain, failed allow-list, expired, or custom-rejected{" "}
          &rarr; <code>403</code> (the response never echoes certificate
          details, to avoid leaking which check failed).
        </li>
      </ul>

      <h2 id="native-tls-node">Native TLS (Node)</h2>
      <p>
        When the peer socket is a TLS socket presenting a client certificate,
        the Node adapter normalizes it (subject, issuer, fingerprint, SANs,
        validity window, and whether the chain was <em>verified</em>) and
        attaches it to the request. The read is deferred behind a lazy thunk, so
        only routes actually guarded by <code>clientCertAuth()</code> pay for
        it, and plain HTTP requests pay nothing. Run your Node server with{" "}
        <code>requestCert: true</code> and a configured CA so the runtime
        verifies the chain.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  clientCertAuth({
    // requireVerified defaults to true: refuse any cert the TLS layer
    // did not cryptographically verify against the configured CA.
    allowFingerprints: [process.env.PEER_FINGERPRINT!],
  }),
);`}
      />

      <h2 id="behind-a-tls-terminating-proxy">
        Behind a TLS-terminating proxy
      </h2>
      <p>
        When a proxy terminates TLS, it forwards the verified client identity in
        request headers. Because those headers are spoofable by anything that
        can reach the app directly, the header path is opt-in: only enable it
        when the app is <em>exclusively</em> reachable through the terminating
        proxy.
      </p>
      <h3 id="envoy-x-forwarded-client-cert">
        Envoy (X-Forwarded-Client-Cert)
      </h3>
      <CodeBlock
        language="ts"
        code={`app.use(
  clientCertAuth({
    header: { format: "xfcc" }, // default header: x-forwarded-client-cert
    allowSANs: ["URI:spiffe://acme/svc-a"],
  }),
);`}
      />
      <h3 id="nginx-haproxy-traefik-structured-headers">
        nginx / HAProxy / Traefik (structured headers)
      </h3>
      <p>
        For proxies that forward parsed fields in separate headers, name each
        header. The <code>verify</code> header lets the middleware require the
        proxy&apos;s own verification result (nginx{" "}
        <code>$ssl_client_verify === &quot;SUCCESS&quot;</code>):
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(
  clientCertAuth({
    header: {
      format: "structured",
      subjectDN: "x-ssl-client-s-dn",
      issuerDN: "x-ssl-client-i-dn",
      fingerprint: "x-ssl-client-fingerprint",
      verify: "x-ssl-client-verify", // value must equal verifySuccessValue ("SUCCESS")
    },
    allowIssuerCNs: ["acme-internal-ca"],
  }),
);`}
      />
      <div className="my-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-semibold">
          Structured headers need a verification header
        </p>
        <p className="mt-2">
          When you use <code>format: &quot;structured&quot;</code> without a{" "}
          <code>verify</code> header, the middleware has no proof the terminator
          actually validated the certificate chain. The subject / issuer / SAN
          headers alone could be spoofed by anything that reaches the app
          directly. It therefore treats such a certificate as{" "}
          <strong>unverified</strong>
          {", "}and the default <code>requireVerified: true</code> rejects the
          request with <code>403</code>
          {". "}Configure the <code>verify</code> header (as above) so the
          identity carries a validation result. Only if your proxy genuinely
          cannot forward one, and the app is reachable <em>exclusively</em>{" "}
          through it, set <code>requireVerified: false</code> to accept
          identity-only headers. Keep a strict <code>behindProxy</code> posture
          if you do.
        </p>
      </div>

      <h2 id="allow-lists-and-checks">Allow-lists &amp; checks</h2>
      <ul>
        <li>
          <code>requireVerified</code> (default <code>true</code>): refuse any
          certificate the TLS terminator did not verify.
        </li>
        <li>
          <code>allowSubjectCNs</code> / <code>allowIssuerCNs</code>
          {": "}exact CN match.
        </li>
        <li>
          <code>allowFingerprints</code>
          {": "}SHA-256 fingerprint match in <strong>constant time</strong>{" "}
          (colons/spaces and case are ignored, so a value copied from{" "}
          <code>openssl</code> works as-is).
        </li>
        <li>
          <code>allowSANs</code>
          {": "}at least one Subject Alternative Name must match (as{" "}
          <code>TYPE:value</code> like <code>URI:spiffe://acme/svc-a</code>
          {", "}or as a bare value).
        </li>
        <li>
          <code>checkValidity</code> (default <code>true</code>): reject
          certificates outside their <code>[notBefore, notAfter]</code> window
          when known (belt-and-braces for header-forwarded certs).
        </li>
        <li>
          <code>verify(cert, ctx)</code>
          {": "}a custom async hook run last; returning <code>false</code>{" "}
          rejects with <code>403</code>.
        </li>
      </ul>

      <h2 id="the-clientcertificate">
        The <code>ClientCertificate</code>
      </h2>
      <p>Whatever the source, handlers receive one normalized shape:</p>
      <CodeBlock
        language="ts"
        code={`interface ClientCertificate {
  subjectDN?: string;        // "CN=svc-a,OU=payments,O=acme"
  subjectCN?: string;        // "svc-a"
  issuerDN?: string;
  issuerCN?: string;
  serialNumber?: string;
  fingerprint256?: string;   // uppercase hex, no separators
  subjectAltNames: string[]; // ["URI:spiffe://acme/svc-a", "DNS:svc-a.internal"]
  notBefore?: Date;
  notAfter?: Date;
  verified: boolean;         // did the TLS terminator verify the chain?
  pem?: string;              // when the proxy forwarded it (XFCC Cert=)
}`}
      />
      <p>
        The building blocks are exported from <code>@daloyjs/core/mtls</code>{" "}
        too: <code>parseForwardedClientCert()</code> (Envoy XFCC),{" "}
        <code>normalizePeerCertificate()</code> (Node{" "}
        <code>getPeerCertificate()</code> shape), and{" "}
        <code>setClientCertificate()</code> /{" "}
        <code>getClientCertificate()</code> for custom adapters.
      </p>
    </>
  );
}
