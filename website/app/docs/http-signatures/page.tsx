import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "HTTP message signatures (RFC 9421)",
  description:
    "Sign and verify server-to-server HTTP requests with RFC 9421 HTTP Message Signatures — signMessage/verifyMessage, signRequest/verifyRequest, the httpSignatureAuth() middleware, hmac-sha256/ed25519/ecdsa/rsa-pss algorithms, mandatory algorithm allowlists, created/expires freshness windows, nonce replay defense, and RFC 9530 Content-Digest helpers. Zero runtime dependencies.",
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
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>HTTP message signatures (RFC 9421)</h1>
      <p>
        As of <strong>0.37.0</strong> DaloyJS ships first-party{" "}
        <strong>HTTP Message Signatures</strong> (
        <a href="https://www.rfc-editor.org/rfc/rfc9421" rel="noreferrer">
          RFC 9421
        </a>
        ) — the IETF-standard way to prove a server-to-server request came from
        a trusted peer. Where{" "}
        <a href="/docs/webhook-delivery">webhook HMAC</a> binds a signature to a
        request <em>body</em> and <a href="/docs/mtls">mTLS</a> authenticates
        the TLS <em>peer</em>, message signatures bind a signature to a
        caller-chosen set of <strong>HTTP message components</strong> (method,
        path, authority, selected headers&hellip;) carried in the standard{" "}
        <code>Signature</code> / <code>Signature-Input</code> headers.
      </p>
      <p>
        The module is dependency-free and runtime-portable (WebCrypto only, no{" "}
        <code>node:</code> imports) and is imported from the{" "}
        <code>@daloyjs/core</code> root or the{" "}
        <code>@daloyjs/core/http-signatures</code> subpath.
      </p>

      <h2>Secure-by-default</h2>
      <ul>
        <li>
          The verifier requires an explicit{" "}
          <code>algorithms</code> allowlist — there is no implicit
          &ldquo;accept any algorithm&rdquo; mode, and a resolved key may pin
          its own algorithm to defeat algorithm-confusion.
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
          (default <code>[&quot;@method&quot;, &quot;@path&quot;]</code>), so a
          peer cannot sign an empty or irrelevant component set.
        </li>
        <li>
          Raw HMAC keys must be at least 32 bytes (RFC 7518 §3.2). SHA-1 and{" "}
          <code>alg: &quot;none&quot;</code>-style escapes do not exist.
        </li>
        <li>
          Optional <code>nonce</code> replay defense via an{" "}
          <code>isReplay</code> callback.
        </li>
      </ul>

      <h2>Supported algorithms</h2>
      <p>
        The labels map 1:1 onto the RFC 9421 HTTP Signature Algorithms registry:
      </p>
      <ul>
        <li>
          <code>hmac-sha256</code> — symmetric shared secret (simplest to
          deploy).
        </li>
        <li>
          <code>ed25519</code>, <code>ecdsa-p256-sha256</code>,{" "}
          <code>ecdsa-p384-sha384</code> — asymmetric (publish a public key, no
          shared secret).
        </li>
        <li>
          <code>rsa-pss-sha512</code>, <code>rsa-v1_5-sha256</code> — RSA.
        </li>
      </ul>

      <h2>Verify inbound requests (middleware)</h2>
      <p>
        <code>httpSignatureAuth()</code> rejects any request without a valid
        signature with a <code>401</code> (<code>Cache-Control: no-store</code>)
        and stamps the verified result on <code>ctx.state.httpSignature</code>.
      </p>
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
    requiredComponents: ["@method", "@path", "@authority"],
  }),
);

app.route({
  method: "POST",
  path: "/internal/charge",
  responses: { 200: { description: "ok" } },
  handler: (ctx) => {
    const sig = ctx.state.httpSignature; // verified VerifySuccess
    return { status: 200, body: { caller: sig.keyid } };
  },
});`}
      />

      <h2>Sign an outbound request</h2>
      <p>
        <code>signRequest()</code> returns a new <code>Request</code> with the{" "}
        <code>Signature</code> and <code>Signature-Input</code> headers
        attached (the original is not mutated).
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
  components: ["@method", "@authority", "@path", "content-type"],
  alg: "hmac-sha256",
  key: secret,
  keyid: "svc-a",
});

await fetch(signed);`}
      />

      <h2>Bind the body with Content-Digest (RFC 9530)</h2>
      <p>
        Message signatures cover headers and derived components, not the body.
        To bind the body, compute a <code>Content-Digest</code> header with{" "}
        <code>contentDigest()</code>, include <code>content-digest</code> in the
        covered components, and re-check it on the receiving side with{" "}
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

      <h2>Low-level sign / verify</h2>
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

      <h2>Rejection reasons</h2>
      <p>
        <code>verifyMessage()</code> / <code>verifyRequest()</code> never throw
        on a forged or malformed signature — they return{" "}
        <code>{`{ valid: false, reason }`}</code> with a stable code such as{" "}
        <code>invalid_signature</code>, <code>signature_stale</code>,{" "}
        <code>created_in_future</code>, <code>signature_expired</code>,{" "}
        <code>missing_created</code>, <code>missing_required_component</code>,{" "}
        <code>alg_not_allowed</code>, <code>alg_mismatch</code>,{" "}
        <code>key_not_found</code>, <code>replay_detected</code>,{" "}
        <code>tag_mismatch</code>, or <code>malformed_signature_headers</code>.
        They throw only on a programming error (an empty{" "}
        <code>algorithms</code> allowlist, or WebCrypto being unavailable).
      </p>
    </>
  );
}
