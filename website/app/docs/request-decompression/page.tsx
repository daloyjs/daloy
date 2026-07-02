import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Inbound request-decompression bomb guard",
  description:
    "Accept compressed request bodies safely with requestDecompression(): inflate gzip/deflate uploads behind a decompression-bomb guard with an absolute-size cap and an expansion-ratio cap enforced during inflation. Core is safe by omission. Zero runtime dependencies.",
  path: "/docs/request-decompression",
  keywords: [
    "request decompression",
    "requestDecompression",
    "decompression bomb",
    "zip bomb",
    "gzip bomb",
    "Content-Encoding",
    "gzip",
    "deflate",
    "bodyLimitBytes",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Inbound request-decompression bomb guard</h1>
      <p>
        DaloyJS core deliberately does <strong>not</strong> decompress request
        bodies. It is <em>safe by omission</em>. A{" "}
        <code>Content-Encoding: gzip</code> request body is read as-is, and a
        schema parse simply fails on the compressed bytes. The moment you
        inflate attacker-supplied bytes, though, you inherit the classic{" "}
        <strong>decompression bomb</strong> (a.k.a. &quot;zip bomb&quot;): a few
        kilobytes of crafted gzip can expand to gigabytes and blow straight past{" "}
        <code>bodyLimitBytes</code>, which only ever sees the small compressed
        payload.
      </p>
      <p>
        DaloyJS ships{" "}
        <code>requestDecompression()</code>, the opt-in middleware that adds
        request decompression <strong>with the bomb guard baked in</strong>. It
        inflates the body with two independent caps enforced <em>during</em>{" "}
        inflation, so a bomb is aborted long before it is fully materialised in
        memory.
      </p>

      <FlowDiagram
        title="onRequest decompression"
        numbered
        steps={[
          {
            label: "Compressed body",
            detail: "Content-Encoding: gzip",
            eyebrow: "inbound",
          },
          {
            label: "Bound compressed input",
            detail: "maxCompressedBytes",
          },
          {
            label: "Inflate with caps",
            detail: "maxDecompressedBytes / maxRatio",
            tone: "accent",
          },
          {
            label: "Inflated body to app",
            detail: "fits bodyLimitBytes",
            tone: "success",
          },
          {
            label: "Bomb tripped a cap",
            detail: "413 DecompressionBombError",
            tone: "danger",
          },
        ]}
        caption="The middleware caps the compressed upload first, then inflates with two caps enforced during inflation. Either cap crossing cancels the stream mid-inflate and rejects with 413, so the full bomb is never materialised."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { App, requestDecompression } from "@daloyjs/core";

const app = new App();

// Register globally so it runs before schema-body validation.
app.use(requestDecompression({
  maxDecompressedBytes: 1024 * 1024, // inflated body never exceeds 1 MiB
  maxCompressedBytes: 64 * 1024,     // reject compressed uploads over 64 KiB
  maxRatio: 50,                      // and never expand more than 50x
}));`}
      />
      <p>
        The middleware runs in the <code>onRequest</code> phase, before the
        per-request context (and therefore before schema-body validation) is
        built, and stashes the inflated bytes on the request so the
        framework&apos;s own body reader transparently sees the decompressed
        payload. That means it works for both schema-validated bodies{" "}
        <em>and</em> handlers that read the raw body themselves.
      </p>

      <h2 id="the-two-caps">The two caps</h2>
      <p>
        A single absolute byte cap is not enough on its own: a small payload can
        stay under it yet still amplify wildly.{" "}
        <code>requestDecompression()</code> enforces both, during inflation:
      </p>
      <ul>
        <li>
          <code>maxDecompressedBytes</code> (<strong>required</strong>): the
          inflated body may never exceed this many bytes. Inflation aborts the
          moment output crosses this value. There is no &quot;unlimited&quot;
          mode. Set this at or below your <code>bodyLimitBytes</code> so the
          inflated payload still fits the body the rest of the app expects.
        </li>
        <li>
          <code>maxRatio</code> (default <code>100</code>): the inflated size
          may never exceed <code>compressedBytes * maxRatio</code>, catching
          small-but-explosive payloads that would stay under the absolute cap in
          isolation.
        </li>
      </ul>
      <p>
        Crossing either cap aborts inflation and rejects the request with{" "}
        <code>413 Payload Too Large</code> (a{" "}
        <code>DecompressionBombError</code>). The reader is cancelled
        mid-stream, so the full bomb is never materialised.
      </p>

      <h2 id="bounding-the-compressed-input">Bounding the compressed input</h2>
      <p>
        <code>maxCompressedBytes</code> (default <code>1048576</code> / 1 MiB)
        caps the <em>compressed</em> upload before a single byte is inflated. An
        oversized compressed body is rejected with <code>413</code> without
        inflating anything.
      </p>

      <h2 id="supported-encodings">Supported encodings</h2>
      <p>
        Built on the web-standard <code>DecompressionStream</code>, so the same
        line works on Node, Bun, Deno, Cloudflare Workers, and Vercel. Only{" "}
        <code>gzip</code> and <code>deflate</code> are accepted (the encodings{" "}
        <code>DecompressionStream</code> implements consistently across
        runtimes).
        <strong> Brotli is intentionally excluded</strong>: it is not part of
        the Compression Streams spec and is unavailable on most runtimes.
        Restrict the allowlist with <code>encodings</code>:
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(requestDecompression({
  maxDecompressedBytes: 512 * 1024,
  encodings: ["gzip"], // accept gzip only; deflate uploads get a 415
}));`}
      />

      <h2 id="error-responses">Error responses</h2>
      <ul>
        <li>
          <code>413</code>: a decompression bomb tripped either cap, or the
          compressed upload exceeded <code>maxCompressedBytes</code>.
        </li>
        <li>
          <code>415</code>: an unknown, non-allowlisted, runtime-unsupported,
          or <strong>layered</strong> (<code>gzip, gzip</code>) encoding.
          Layered encodings are a classic nested-bomb vector and are refused
          rather than inflated recursively. The response carries an{" "}
          <code>Accept-Encoding</code> header listing the allowed encodings.
        </li>
        <li>
          <code>400</code>: a malformed / truncated compressed stream. Refusing
          (rather than treating a malformed body as empty) prevents
          request-smuggling-style desync with any downstream parser.
        </li>
      </ul>
      <p>
        Requests without a <code>Content-Encoding</code> (or with{" "}
        <code>identity</code>) pass through untouched, and <code>GET</code> /{" "}
        <code>HEAD</code> requests are never decompressed, so bodyless and
        uncompressed traffic pays nothing.
      </p>

      <h2 id="observability">Observability</h2>
      <p>
        Pass <code>onBomb</code> to record rejected bombs (it fires before the{" "}
        <code>413</code> is thrown). It receives the structured{" "}
        <code>DecompressionBombInfo</code>: the encoding, compressed size,
        inflated bytes produced before the abort, and which cap tripped (
        <code>&quot;absolute&quot;</code> or <code>&quot;ratio&quot;</code>):
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(requestDecompression({
  maxDecompressedBytes: 1024 * 1024,
  onBomb: (info) => {
    metrics.increment("request.decompression.bomb", {
      encoding: info.encoding,
      reason: info.reason,
    });
  },
}));`}
      />

      <h2 id="low-level-helper">Low-level helper</h2>
      <p>
        <code>decompressRequestBody(compressed, encoding, opts)</code> is
        exported for custom flows that read raw bytes themselves. It inflates
        with the exact same bomb-resistant semantics and the same caps.
      </p>

      <h2 id="relationship-to-bodylimitbytes">
        Relationship to <code>bodyLimitBytes</code>
      </h2>
      <p>
        <code>bodyLimitBytes</code> caps the body the app reads, which, with
        this guard installed, is the <em>inflated</em> payload. Keep{" "}
        <code>maxDecompressedBytes</code> at or below{" "}
        <code>bodyLimitBytes</code> so a request that survives the bomb guard
        still fits the limit the rest of the stack assumes. Without this
        middleware, <code>bodyLimitBytes</code> only ever sees the compressed
        bytes, which is exactly why an unguarded decompression step is
        dangerous.
      </p>
    </>
  );
}
