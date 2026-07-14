import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Docs UI asset integrity (SRI)",
  description:
    "DaloyJS pins version-exact Subresource Integrity (SRI) hashes on the default Scalar, Swagger UI, Redoc, and AsyncAPI assets, with validated overrides and self-hosting support.",
  path: "/docs/docs-asset-integrity",
  keywords: [
    "Subresource Integrity",
    "SRI",
    "integrity hash",
    "sha384",
    "crossorigin",
    "CDN",
    "jsDelivr",
    "Scalar",
    "Swagger UI",
    "Redoc",
    "supply chain",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Docs UI asset integrity (SRI)</h1>
      <p>
        The built-in <code>/docs</code> page renders Scalar (default), Swagger
        UI, or Redoc by loading their JavaScript and CSS bundles from the
        jsDelivr CDN. A CDN keeps the framework dependency-free and means no
        build step for the docs UI, but it also means the browser will execute
        whatever bytes the CDN serves. If a CDN asset were ever poisoned, that
        code would run in the context of your docs page.
      </p>
      <p>
        DaloyJS ships version-exact default assets with matching{" "}
        <strong>Subresource Integrity (SRI)</strong> hashes. It emits an{" "}
        <code>integrity=&quot;…&quot;</code> attribute plus a{" "}
        <code>crossorigin</code> attribute on the matching{" "}
        <code>&lt;script&gt;</code> / <code>&lt;link&gt;</code> tag, so the
        browser refuses to execute an asset whose bytes don&apos;t match the
        pinned hash. The docs UI inherits the same supply-chain posture as the
        rest of the framework.
      </p>

      <FlowDiagram
        title="SRI-pinned docs asset"
        numbered
        steps={[
          {
            label: "Version-exact CDN asset",
            detail: "@scalar/api-reference@1.62.5",
            eyebrow: "jsDelivr",
          },
          {
            label: "Pinned integrity hash",
            detail: "integrity + crossorigin",
            tone: "accent",
          },
          {
            label: "Browser hashes the bytes",
            detail: "sha384 of fetched file",
          },
          {
            label: "Bytes match: execute",
            detail: "docs UI renders",
            tone: "success",
          },
          {
            label: "Mismatch: refuse",
            detail: "poisoned asset blocked",
            tone: "danger",
          },
        ]}
        caption="DaloyJS emits an integrity and crossorigin attribute on the script or link tag for the pinned, version-exact URL. The browser hashes the downloaded bytes and refuses to execute anything that does not match, so a poisoned CDN asset never runs."
      />

      <h2 id="secure-defaults">Secure defaults</h2>
      <p>
        SRI only works against a <strong>version-pinned, byte-stable</strong>{" "}
        URL. DaloyJS therefore pins the default Scalar, Swagger UI, Redoc, and
        AsyncAPI versions together with their SHA-384 digests. The default{" "}
        <code>/docs</code> and <code>/asyncapi</code> pages are protected
        without configuration; framework releases update each URL and hash as
        one reviewed pair.
      </p>

      <h2 id="override-the-default-assets">Override the default assets</h2>
      <p>
        Use <code>assets</code> only when you want another version, another CDN,
        or self-hosting. When changing a URL, provide the digest of those exact
        bytes; a custom URL does not inherit the default asset&apos;s hash.
      </p>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";

const app = new App({
  docs: {
    assets: {
      // Override with the exact version you verified...
      scalarScriptUrl:
        "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5",
      // ...and the SRI hash of that exact file.
      scalarScriptIntegrity: "sha384-<base64-digest>",
    },
  },
});`}
      />
      <p>
        The same <code>assets</code> object works for the Swagger UI renderer,
        which loads two assets (a stylesheet and a bundle):
      </p>
      <CodeBlock
        language="ts"
        code={`const app = new App({
  docs: {
    ui: "swagger",
    assets: {
      swaggerUiCssUrl:
        "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui.css",
      swaggerUiCssIntegrity: "sha384-<css-digest>",
      swaggerUiBundleUrl:
        "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui-bundle.js",
      swaggerUiBundleIntegrity: "sha384-<bundle-digest>",
    },
  },
});`}
      />
      <p>
        Redoc loads a single standalone bundle, so it takes one URL/hash pair:
      </p>
      <CodeBlock
        language="ts"
        code={`const app = new App({
  docs: {
    ui: "redoc",
    assets: {
      redocScriptUrl:
        "https://cdn.jsdelivr.net/npm/redoc@2.5.3/bundles/redoc.standalone.js",
      redocScriptIntegrity: "sha384-<redoc-digest>",
    },
  },
});`}
      />

      <h2 id="computing-the-hash">Computing the hash</h2>
      <p>
        Download the exact pinned file and hash it. The output is exactly what
        goes into the <code>*Integrity</code> field:
      </p>
      <CodeBlock
        language="sh"
        code={`curl -sSL https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5 \\
  | openssl dgst -sha384 -binary \\
  | openssl base64 -A \\
  | sed 's/^/sha384-/'`}
      />
      <p>
        jsDelivr also surfaces a copy-paste SRI snippet on each file&apos;s
        page, which is a convenient cross-check. Re-run this whenever you bump
        the pinned version.
      </p>

      <h2 id="self-hosting-instead">Self-hosting instead</h2>
      <p>
        If your Content-Security-Policy forbids third-party CDNs, point the same{" "}
        <code>assets</code> URLs at copies you serve yourself. A custom URL may
        omit SRI (for example for same-origin assets under your control), but
        pinning a hash still adds defense in depth.
      </p>
      <CodeBlock
        language="ts"
        code={`const app = new App({
  docs: {
    assets: {
      scalarScriptUrl: "/docs-assets/scalar.js",
    },
  },
});`}
      />

      <h2 id="malformed-hashes-fail-loudly">Malformed hashes fail loudly</h2>
      <p>
        A typo in an SRI value is dangerous: browsers silently ignore an{" "}
        <em>unparseable</em> <code>integrity</code> attribute and load the asset
        anyway, giving you a false sense of protection. To prevent that, DaloyJS
        validates every hash when it builds the docs HTML. A value that
        isn&apos;t one or more space-separated <code>sha256-</code> /{" "}
        <code>sha384-</code> / <code>sha512-</code> base64 digests throws a{" "}
        <code>TypeError</code> rather than shipping an unprotected page:
        immediately from the <code>scalarHtml()</code> /{" "}
        <code>swaggerUiHtml()</code> / <code>redocHtml()</code> helpers, and on
        the auto-mounted <code>/docs</code> route as a loud <code>500</code>{" "}
        (carrying this message) the first time the page renders.
      </p>
      <CodeBlock
        language="ts"
        code={`import { scalarHtml } from "@daloyjs/core/docs";

// Throws synchronously: Invalid Subresource Integrity value: "md5-nope". ...
scalarHtml({
  specUrl: "/openapi.json",
  assets: {
    scalarScriptUrl:
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5",
    scalarScriptIntegrity: "md5-nope",
  },
});

// The same invalid hash on the auto-mounted docs route
// (new App({ docs: { assets } })) makes GET /docs fail with a 500.`}
      />

      <h2 id="low-level-helpers">Low-level helpers</h2>
      <p>
        The same options flow through the <code>scalarHtml()</code>,{" "}
        <code>swaggerUiHtml()</code>, and <code>redocHtml()</code> helpers (from
        the <code>@daloyjs/core/docs</code> subpath) if you render the docs page
        yourself. Multiple digests are supported: separate them with whitespace,
        and the strongest one the browser understands wins. The{" "}
        <code>crossOrigin</code> field defaults to{" "}
        <code>&quot;anonymous&quot;</code>; set it to{" "}
        <code>&quot;use-credentials&quot;</code> only when the asset host needs
        credentialed requests.
      </p>
      <CodeBlock
        language="ts"
        code={`import { scalarHtml } from "@daloyjs/core/docs";

const html = scalarHtml({
  specUrl: "/openapi.json",
  assets: {
    scalarScriptUrl:
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.5",
    scalarScriptIntegrity:
      "sha384-<primary> sha512-<fallback>",
    crossOrigin: "anonymous",
  },
});`}
      />
    </>
  );
}
