import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";
import { UseCaseGuide } from "../../../../components/use-case-guide";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Compression middleware",
  description:
    "Daloy adds portable response compression with CompressionStream, BREACH-aware skip rules, safe cache headers, and ETag handling.",
  path: "/docs/security/compression",
  keywords: [
    "compression middleware",
    "CompressionStream",
    "BREACH guard",
    "Vary Accept-Encoding",
    "weak ETag",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Compression middleware</h1>
      <blockquote>
        <strong>Think of it like…</strong> vacuum-sealing parcels for shipping:
        smaller, cheaper, faster to deliver. But you never vacuum-seal anything
        with a return address visible through the wrap (cookies, auth headers,
        CSRF tokens), because a thief watching the loading dock could measure
        the bulge and figure out what&apos;s inside. That&apos;s the BREACH
        attack, and that&apos;s why the middleware skips compression on
        sensitive headers and small responses by default.
      </blockquote>
      <p>
        Daloy ships a focused compression slice: a first-party{" "}
        <code>compression()</code> middleware that uses the web-standard{" "}
        <code>CompressionStream</code> API instead of a Node-only compression
        package.
      </p>

      <UseCaseGuide
        featureName="Compression middleware"
        recommendation="Use compression when serving large text-based responses (HTML, JSON, SVG) directly to clients without an intermediate CDN or reverse proxy doing it for you. Do not compress small responses or payloads that are already compressed (like images or PDFs)."
        whenToUse={[
          "Serving large, text-heavy responses (HTML, JSON, XML, SVG) over 1KB in size.",
          "Direct-to-origin API traffic that bypasses caching CDNs or API gateways.",
          "Deploying to serverless environments (like AWS Lambda, Deno Deploy, or Cloudflare Workers) that do not compress origin responses by default.",
        ]}
        whenNotToUse={[
          "When a CDN (such as Cloudflare, Fastly, or Vercel Edge) or reverse proxy (NGINX) fronting the app is already configured to compress responses (doing it in the application wastefully consumes CPU).",
          "For response payloads under 1KB, where compression overhead makes the response larger or yields negligible gains.",
          "For binary or pre-compressed content types (PNG, JPEG, PDF, ZIP, WOFF2), which are already optimized.",
        ]}
      />

      <CodeBlock
        code={`import { App, compression } from "@daloyjs/core";

const app = new App({ env: "production" });

app.use(compression());
`}
        language="ts"
      />

      <h2 id="what-it-compresses">What it compresses</h2>
      <p>
        The middleware negotiates <code>br</code>
        {", "}<code>gzip</code>
        {", "}and <code>deflate</code> from the request{" "}
        <code>Accept-Encoding</code>
        header and the runtime codecs available through{" "}
        <code>CompressionStream</code>
        {". "}Runtime support is probed once and cached. If the platform has no
        supported codec, the middleware becomes a silent no-op instead of
        breaking older runtimes.
      </p>
      <p>
        The default <code>minimumSize</code> is <code>1024</code> bytes. Small
        responses are left alone, and Daloy also checks the compressed byte
        length after encoding. If compression made the payload larger, the
        original response is kept.
      </p>

      <h2 id="memory-bound">Memory bound for large responses</h2>
      <p>
        Compressing a response means buffering its bytes in memory first. To
        keep a single large (or unknown-and-growing) response from forcing
        unbounded heap growth, the middleware only compresses bodies up to{" "}
        <code>maxCompressibleBytes</code>
        {", "}which defaults to <code>1_048_576</code> (1&nbsp;MiB). Anything
        larger is sent <strong>uncompressed</strong> rather than buffered. When
        a response declares a <code>Content-Length</code> above the cap it is
        skipped immediately, without buffering a single byte; streamed responses
        are read up to the cap and released untouched if they exceed it.
      </p>
      <p>
        This is a deliberate trade-off: it spends bandwidth and latency on very
        large responses to protect the origin&apos;s memory. Large responses are
        usually already-compressed media (skipped anyway) or belong behind a
        CDN. If you serve large, highly compressible payloads from the origin
        and can afford the heap, raise the cap:
      </p>
      <CodeBlock
        code={`app.use(
  compression({
    // Compress bodies up to 8 MiB; larger responses stream uncompressed.
    maxCompressibleBytes: 8 * 1024 * 1024,
  }),
);`}
        language="ts"
      />
      <p>
        <code>maxCompressibleBytes</code> must be a positive integer no larger
        than <code>2**31 - 1</code>
        {", "}and must be greater than or equal to <code>minimumSize</code>;
        violating either is refused at construction.
      </p>

      <h2 id="application-vs-cdn-or-proxy">
        Application vs. CDN or reverse proxy
      </h2>
      <p>
        A response only needs to be compressed once. Choose the layer closest to
        the client that reliably supports the encodings and content types you
        need:
      </p>
      <ul>
        <li>
          <strong>No CDN or reverse-proxy compression:</strong> register{" "}
          <code>compression()</code> globally. Daloy&apos;s skip rules still
          decide whether each individual response should be compressed.
        </li>
        <li>
          <strong>CDN or reverse proxy already compresses responses:</strong>{" "}
          let that layer handle compression so the application does not spend
          CPU compressing the same traffic at the origin.
        </li>
      </ul>
      <p>
        Do not assume every hosting platform enables compression automatically.
        Send a request with <code>Accept-Encoding: br, gzip</code> and check the
        response for <code>Content-Encoding</code>
        {". "}If some traffic can bypass the CDN or proxy, decide whether those
        direct origin responses also need application-level compression.
      </p>

      <h2 id="security-skip-rules">Security skip rules</h2>
      <p>
        Compression can become an oracle when secrets and attacker-controlled
        bytes share the same compressed response. Daloy keeps those guards built
        in rather than asking every app to remember the same list.
      </p>
      <FlowDiagram
        title="BREACH-aware skip decision"
        steps={[
          {
            eyebrow: "onSend",
            label: "Response ready",
            detail: "negotiate br / gzip / deflate",
          },
          {
            eyebrow: "secrets",
            label: "Set-Cookie / Authorization / session cookie?",
            detail: "skip, send identity",
            tone: "danger",
          },
          {
            eyebrow: "not worth it",
            label: "Below minimumSize or already encoded?",
            detail: "skip, keep original",
            tone: "muted",
          },
          {
            eyebrow: "safe",
            label: "Compress the body",
            detail: "GET / HEAD, 2xx, text-like content",
            tone: "success",
          },
        ]}
        caption="Responses that mix secrets with attacker-influenced bytes (Set-Cookie, Authorization, session/CSRF cookies) are never compressed, which closes the BREACH oracle. Tiny, already-encoded, or already-compressed payloads are skipped too. Vary: Accept-Encoding is still added either way."
      />
      <ul>
        <li>
          Skips responses with <code>Set-Cookie</code>.
        </li>
        <li>
          Skips requests with <code>Authorization</code>.
        </li>
        <li>
          Skips requests carrying session, CSRF, XSRF, <code>__Host-</code>
          {", "}or <code>__Secure-</code> cookies.
        </li>
        <li>
          Skips any response that already has <code>Content-Encoding</code>.
        </li>
        <li>
          Skips non-<code>GET</code> / non-<code>HEAD</code> requests and
          non-2xx responses.
        </li>
        <li>
          Skips already-compressed content types such as images, video, audio,
          archives, fonts, WebAssembly, and PDFs. <code>image/svg+xml</code> is
          carved back in because it is XML text.
        </li>
      </ul>

      <h2 id="cache-and-etag-behavior">Cache and ETag behavior</h2>
      <p>
        Every response that reaches <code>compression()</code> gets{" "}
        <code>Vary: Accept-Encoding</code> appended (de-duplicated against any
        existing <code>Vary</code> value), even when Daloy decides not to
        compress that specific response. That keeps downstream caches keyed by
        the negotiation surface from the first response onward, so a cache
        can&apos;t serve a gzipped body to a client that only advertised{" "}
        <code>identity</code>.
      </p>
      <p>
        If a compressed response already has a strong ETag such as{" "}
        <code>&quot;abc&quot;</code>
        {", "}Daloy downgrades it to <code>W/&quot;abc&quot;</code>
        {". "}The ETag was computed over the upstream body, not the compressed
        wire bytes, so a weak validator is the honest one, RFC 9110 §8.8.1
        requires strong validators to be byte-equal to the representation on the
        wire, and the wire bytes change per encoding.
      </p>

      <h2 id="interaction-with-etag">
        Interaction with <code>etag()</code>
      </h2>
      <p>
        <code>compression()</code> and <code>etag()</code> are safe to combine
        in either order. Both run as <code>onSend</code> hooks:
      </p>
      <ul>
        <li>
          <strong>
            If <code>etag()</code> runs first
          </strong>{" "}
          it sets a strong ETag over the uncompressed body.{" "}
          <code>compression()</code> then encodes the body and downgrades the
          strong ETag to weak so the validator stays consistent with what
          actually leaves the server.
        </li>
        <li>
          <strong>
            If <code>compression()</code> runs first
          </strong>{" "}
          it encodes the body. <code>etag()</code> then hashes the
          already-compressed bytes, which is also valid, the strong tag still
          byte-matches the wire bytes the client receives.
        </li>
      </ul>
      <p>
        Either way, conditional <code>GET</code>s using{" "}
        <code>If-None-Match</code> stay correct across <code>br</code>
        {", "}
        <code>gzip</code>
        {", "}<code>deflate</code>
        {", "}and <code>identity</code> clients because the{" "}
        <code>Vary: Accept-Encoding</code> header forces per-encoding cache
        keys. You don&apos;t have to manage the weak/strong downgrade yourself,
        even if you set <code>ETag</code> manually from a route handler,{" "}
        <code>compression()</code> performs the downgrade for you on the way
        out.
      </p>

      <h2 id="no-compression-level-knob">No compression level knob</h2>
      <p>
        <code>CompressionStream</code> uses the runtime default. Daloy refuses
        any <code>compressLevel</code> option at construction, including{" "}
        <code>6</code>
        {", "}because exposing the knob invites expensive level-9 compression
        for tiny byte savings under load.
      </p>

      <CodeBlock
        code={`app.use(compression({
  minimumSize: 2 * 1024,
  encodings: ["gzip"],
  authCookieNames: ["tenant-auth"],
  excludeContentTypes: ["application/x-parquet"],
}));`}
        language="ts"
      />

      <h2 id="ordering">Ordering</h2>
      <p>
        Register <code>compression()</code> after middleware that may add{" "}
        <code>Set-Cookie</code>
        {", "}<code>Content-Encoding</code>
        {", "}or <code>ETag</code> headers. Daloy runs <code>onSend</code>{" "}
        hooks in registration order, so the compression hook should see the
        final response headers before it decides whether to encode the body.
      </p>
    </>
  );
}
