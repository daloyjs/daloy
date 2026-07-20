import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "HTTP message signatures (RFC 9421)",
  description:
    "Sign and verify server-to-server HTTP requests with RFC 9421 HTTP Message Signatures: signMessage/verifyMessage, signRequest/verifyRequest, the httpSignatureAuth() middleware, hmac-sha256/ed25519/ecdsa/rsa-pss algorithms, mandatory algorithm allowlists, created/expires freshness windows, nonce replay defense, and RFC 9530 Content-Digest helpers. Zero runtime dependencies.",
  path: "/docs/http-signatures",
  keywords: [
    "HTTP message signatures",
    "RFC 9421",
    "Signature-Input",
    "Signature header",
    "server-to-server authentication",
    "hmac-sha256",
    "ed25519",
    "Content-Digest",
    "RFC 9530",
    "RSA 2048 modulus floor",
    "NIST SP 800-131A",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>HTTP message signatures (RFC 9421)</h1>
      <p>
        DaloyJS ships first-party <strong>HTTP Message Signatures</strong> (
        <a href="https://www.rfc-editor.org/rfc/rfc9421" rel="noreferrer">
          RFC 9421
        </a>
        ), the IETF-standard way to prove a server-to-server request came from a
        trusted peer. Where <a href="/docs/webhook-delivery">webhook HMAC</a>{" "}
        binds a signature to a request <em>body</em> and{" "}
        <a href="/docs/mtls">mTLS</a> authenticates the TLS <em>peer</em>
        {", "}
        message signatures bind a signature to a caller-chosen set of{" "}
        <strong>HTTP message components</strong> (method, path, authority,
        selected headers&hellip;) carried in the standard <code>Signature</code>{" "}
        / <code>Signature-Input</code> headers.
      </p>
      <p>
        The module is dependency-free and runtime-portable (WebCrypto only, no{" "}
        <code>node:</code> imports) and is imported from the{" "}
        <code>@daloyjs/core</code> root or the{" "}
        <code>@daloyjs/core/http-signatures</code> subpath.
      </p>

      <h2 id="secure-by-default">Secure-by-default</h2>
      <ul>
        <li>
          The verifier requires an explicit <code>algorithms</code> allowlist.
          There is no implicit &ldquo;accept any algorithm&rdquo; mode, and a
          resolved key may pin its own algorithm to defeat algorithm-confusion.
        </li>
        <li>
          <code>created</code> is required by default and the signature is
          rejected once it is older than{" "}
          <code>DEFAULT_MAX_SIGNATURE_AGE_SECONDS</code> (300s), or if{" "}
          <code>created</code> is in the future / <code>expires</code> has
          passed (outside a small clock-skew tolerance).
        </li>
        <li>
          A configurable <code>requiredComponents</code> set must be covered
          (default <code>[&quot;@method&quot;, &quot;@target-uri&quot;]</code>),
          so a peer cannot sign an empty or irrelevant component set. The
          default binds scheme, authority, path, <strong>and query</strong>; a
          path-only signature (<code>@path</code>) no longer satisfies a default
          verify, so an attacker cannot swap the query string under a signature
          that left it unbound. Pass{" "}
          <code>
            requiredComponents: [&quot;@method&quot;, &quot;@path&quot;]
          </code>{" "}
          explicitly if you deliberately sign only the path.
        </li>
        <li>
          <code>@query-param</code> refuses to sign a parameter that appears
          more than once. Signing only the first value while an app or
          intermediary reads the last value (or the full array) is a classic
          HTTP parameter-pollution differential — cover <code>@query</code> or{" "}
          <code>@target-uri</code> instead when multiple values are legitimate.
        </li>
        <li>
          Raw HMAC keys must be at least 32 bytes (RFC 7518 §3.2). SHA-1 and{" "}
          <code>alg: &quot;none&quot;</code>-style escapes do not exist.
        </li>
        <li>
          RSA keys (<code>rsa-pss-sha512</code>
          {", "}<code>rsa-v1_5-sha256</code>) must have at least a 2048-bit
          modulus. Shorter keys are refused, in parity with the JWT verifier and
          per NIST SP 800-131A (RSA under 2048 bits has been disallowed since
          2014).
        </li>
        <li>
          Optional <code>nonce</code> replay defense via an{" "}
          <code>isReplay</code> callback.
        </li>
      </ul>

      <h2 id="supported-algorithms">Supported algorithms</h2>
      <p>
        The labels map 1:1 onto the RFC 9421 HTTP Signature Algorithms registry:
      </p>
      <ul>
        <li>
          <code>hmac-sha256</code>
          {": "}symmetric shared secret (simplest to deploy).
        </li>
        <li>
          <code>ed25519</code>
          {", "}<code>ecdsa-p256-sha256</code>
          {", "}
          <code>ecdsa-p384-sha384</code>
          {": "}asymmetric (publish a public key, no shared secret).
        </li>
        <li>
          <code>rsa-pss-sha512</code>
          {", "}<code>rsa-v1_5-sha256</code>
          {": "}RSA (2048-bit modulus floor; see below).
        </li>
      </ul>

      <h2 id="verify-inbound-requests-middleware">
        Verify inbound requests (middleware)
      </h2>
      <p>
        <code>httpSignatureAuth()</code> rejects any request without a valid
        signature with a <code>401</code> (<code>Cache-Control: no-store</code>)
        and stamps the verified result on <code>ctx.state.httpSignature</code>.
      </p>
      <SequenceDiagram
        title="Sign then verify"
        participants={["Caller", "httpSignatureAuth()", "Handler"]}
        steps={[
          {
            from: "Caller",
            to: "httpSignatureAuth()",
            kind: "request",
            label: "Request with Signature / Signature-Input",
            detail: "covers @method, @path, @authority, content-digest, ...",
          },
          {
            from: "httpSignatureAuth()",
            to: "httpSignatureAuth()",
            kind: "note",
            label: "Resolve keyid -> key (alg pinned to key)",
            detail:
              "alg not in allowlist -> alg_not_allowed; key missing -> key_not_found",
          },
          {
            from: "httpSignatureAuth()",
            to: "Caller",
            kind: "note",
            label: "Forged / stale / replayed / missing component -> 401",
            detail:
              "invalid_signature, signature_stale, replay_detected, missing_required_component",
          },
          {
            from: "httpSignatureAuth()",
            to: "Handler",
            kind: "response",
            label: "Signature valid + fresh -> proceed",
            detail: "ctx.state.httpSignature = VerifySuccess",
          },
        ]}
        caption="The verifier requires an explicit algorithms allowlist, a fresh created timestamp, and a covered requiredComponents set. Any failure rejects with 401 and Cache-Control: no-store before the handler runs."
      />
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";
import { httpSignatureAuth } from "@daloyjs/core";

const app = createApp();

// Shared secret per calling service (>= 32 bytes).
const KEYS: Record<string, Uint8Array> = {
  "svc-a": new TextEncoder().encode(process.env.SVC_A_SECRET!),
};

app.use(
  httpSignatureAuth({
    algorithms: ["hmac-sha256"],
    // Pin the algorithm to the key to defeat algorithm-confusion.
    resolveKey: ({ keyid }) =>
      keyid && KEYS[keyid]
        ? { alg: "hmac-sha256", key: KEYS[keyid] }
        : undefined,
    // Default is ["@method", "@target-uri"] (binds path + query). Tighten further
    // when you need authority or specific headers covered.
    requiredComponents: ["@method", "@target-uri", "@authority"],
  }),
);

app.post(
  "/internal/charge",
  {
    responses: { 200: { description: "ok" } },
  },
  (ctx) => {
    const sig = ctx.state.httpSignature; // verified VerifySuccess
    return { status: 200, body: { caller: sig.keyid } };
  },
);`}
      />

      <h2 id="sign-an-outbound-request">Sign an outbound request</h2>
      <p>
        <code>signRequest()</code> returns a new <code>Request</code> with the{" "}
        <code>Signature</code> and <code>Signature-Input</code> headers attached
        (the original is not mutated).
      </p>
      <CodeBlock
        language="ts"
        code={`import { signRequest } from "@daloyjs/core";

const secret = new TextEncoder().encode(process.env.SVC_A_SECRET!);

const req = new Request("https://billing.internal/internal/charge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ amount: 100 }),
});

const signed = await signRequest(req, {
  // Default is ["@method", "@target-uri"]; add content-type / authority as needed.
  components: ["@method", "@target-uri", "@authority", "content-type"],
  alg: "hmac-sha256",
  key: secret,
  keyid: "svc-a",
});

await fetch(signed);`}
      />

      <h2 id="bind-the-body-with-content-digest-rfc-9530">
        Bind the body with Content-Digest (RFC 9530)
      </h2>
      <p>
        Message signatures cover headers and derived components, not the body.
        To bind the body, compute a <code>Content-Digest</code> header with{" "}
        <code>contentDigest()</code>
        {", "}include <code>content-digest</code> in the covered components,
        and re-check it on the receiving side with{" "}
        <code>verifyContentDigest()</code>.
      </p>
      <CodeBlock
        language="ts"
        code={`import { contentDigest, signRequest, verifyContentDigest } from "@daloyjs/core";

const body = JSON.stringify({ amount: 100 });
const digest = await contentDigest(body); // "sha-256=:<base64>:"

const req = new Request("https://billing.internal/charge", {
  method: "POST",
  headers: { "content-type": "application/json", "content-digest": digest },
  body,
});
const signed = await signRequest(req, {
  components: ["@method", "@path", "content-digest"],
  alg: "hmac-sha256",
  key: secret,
  keyid: "svc-a",
});

// On the receiver, after httpSignatureAuth() verified the signature:
const raw = await request.text();
if (!(await verifyContentDigest(request.headers.get("content-digest") ?? "", raw))) {
  throw new Error("body does not match its signed digest");
}`}
      />

      <h2 id="low-level-sign-verify">Low-level sign / verify</h2>
      <p>
        <code>signMessage()</code> and <code>verifyMessage()</code> work with
        plain method/URL/headers when you are not inside a request/response
        object.
      </p>
      <CodeBlock
        language="ts"
        code={`import { signMessage, verifyMessage } from "@daloyjs/core";

const sig = await signMessage({
  method: "GET",
  url: "https://api.example.com/me",
  headers: { host: "api.example.com" },
  components: ["@method", "@path", "@authority"],
  alg: "ed25519",
  key: privateKey, // CryptoKey | Uint8Array | JsonWebKey
  keyid: "ed-1",
});

const result = await verifyMessage({
  method: "GET",
  url: "https://api.example.com/me",
  headers: {
    host: "api.example.com",
    "signature-input": sig.signatureInput,
    signature: sig.signature,
  },
  algorithms: ["ed25519"],
  resolveKey: () => ({ alg: "ed25519", key: publicKey }),
});

if (!result.valid) {
  // result.reason is a stable machine-readable code, e.g. "invalid_signature",
  // "signature_stale", "alg_not_allowed", "missing_required_component".
  throw new Error(result.reason);
}`}
      />

      <h2 id="rejection-reasons">Rejection reasons</h2>
      <p>
        <code>verifyMessage()</code> / <code>verifyRequest()</code> never throw
        on a forged or malformed signature. They return{" "}
        <code>{`{ valid: false, reason }`}</code> with a stable code such as{" "}
        <code>invalid_signature</code>
        {", "}<code>signature_stale</code>
        {", "}
        <code>created_in_future</code>
        {", "}<code>signature_expired</code>
        {", "}
        <code>missing_created</code>
        {", "}<code>missing_required_component</code>
        {", "}
        <code>alg_not_allowed</code>
        {", "}<code>alg_mismatch</code>
        {", "}
        <code>key_not_found</code>
        {", "}<code>replay_detected</code>
        {", "}
        <code>tag_mismatch</code>
        {", "}or <code>malformed_signature_headers</code>
        {". "}
        They throw only on a programming error (an empty <code>
          algorithms
        </code>{" "}
        allowlist, or WebCrypto being unavailable).
      </p>
    </>
  );
}
