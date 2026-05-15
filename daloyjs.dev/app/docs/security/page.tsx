import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Security",
  description:
    "DaloyJS is secure by default: strict body limits, request timeouts, secure headers, rate limiting, supply-chain hardening, and production-safe errors.",
  path: "/docs/security",
  keywords: ["DaloyJS security", "secure HTTP defaults", "rate limiting", "secure headers", "OWASP TypeScript"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Security</h1>
      <p>
        Bad defaults are bugs. DaloyJS ships hardened defaults so you can&apos;t accidentally ship an
        attack surface.
      </p>

      <h2>What&apos;s on by default</h2>
      <table>
        <thead><tr><th>Threat</th><th>Default behavior</th></tr></thead>
        <tbody>
          <tr><td>Body-size DoS</td><td>Streamed read, hard cap (default 1 MiB), Content-Length checked first → 413.</td></tr>
          <tr><td>Prototype pollution</td><td><code>safeJsonParse</code> strips <code>__proto__</code>, <code>constructor</code>, <code>prototype</code> via reviver.</td></tr>
          <tr><td>Header / response splitting</td><td><code>sanitizeHeaderName</code> / <code>sanitizeHeaderValue</code> reject CRLF + NUL.</td></tr>
          <tr><td>Path traversal</td><td>Router rejects <code>..</code> segments and <code>{"//"}</code> before walking.</td></tr>
          <tr><td>Slow-loris / hung handlers</td><td><code>requestTimeoutMs</code> aborts handlers (default 30s); Node adapter sets timeouts.</td></tr>
          <tr><td>Unsupported content types</td><td>Routes with body schemas reject non-allowed content-types → 415.</td></tr>
          <tr><td>Method confusion</td><td>Real <strong>405</strong> with <code>Allow</code> header — never a misleading 404.</td></tr>
          <tr><td>Information disclosure (5xx)</td><td>Production mode strips <code>detail</code> from 5xx problem+json automatically.</td></tr>
          <tr><td>Credential timing attacks</td><td><code>timingSafeEqual()</code> for tokens & signatures.</td></tr>
          <tr><td>Request correlation</td><td>Cryptographic <code>randomId()</code> request id on every response.</td></tr>
        </tbody>
      </table>

      <h2>Security middleware</h2>
      <CodeBlock code={`import {
  requestId,
  secureHeaders,
  cors,
  rateLimit,
  bearerAuth,
  timing,
} from "@daloyjs/core";

app.use(requestId());           // x-request-id propagation
app.use(secureHeaders());       // CSP, HSTS, X-Frame-Options, COOP, CORP, no-sniff …
app.use(cors({                  // explicit allowlist; never * with credentials
  origin: ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST"],
}));
app.use(rateLimit({             // global by default; add keyGenerator or trusted proxy headers for per-client limits
  windowMs: 60_000,
  max: 120,
}));
app.use(timing());              // Server-Timing header for observability`} />

      <h2><code>secureHeaders()</code> defaults</h2>
      <CodeBlock language="text" code={`content-security-policy: default-src 'self'; frame-ancestors 'none'
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
x-xss-protection: 0`} />

      <h2>Auth</h2>
      <CodeBlock code={`import { bearerAuth, timingSafeEqual } from "@daloyjs/core";

app.route({
  method: "POST",
  path: "/admin/purge",
  operationId: "adminPurge",
  hooks: bearerAuth({
    validate: (token) => timingSafeEqual(token, process.env.ADMIN_TOKEN!),
    realm: "admin",
  }),
  responses: { 204: { description: "ok" }, 401: { description: "denied" } },
  handler: async () => ({ status: 204 as const, body: undefined }),
});`} />

      <h2>Supply-chain</h2>
      <p>
        DaloyJS is distributed via <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a>{" "}
        for a stronger install model than npm, and the project&apos;s own CI/CD pipeline is hardened against
        the cache-poisoning, maintainer-phishing, and OIDC token-abuse patterns seen in recent npm incidents.
      </p>
      <ul>
        <li><strong>Strict isolation</strong> — packages cannot reach phantom dependencies.</li>
        <li><strong>Content-addressable store</strong> — every byte is hashed and verified.</li>
        <li><strong>Frozen lockfile in CI</strong> with <code>--ignore-scripts</code> — reproducible installs without transitive lifecycle execution.</li>
        <li><strong><code>verify-store-integrity</code></strong> — corruption-detecting reads.</li>
        <li><strong><code>strict-peer-dependencies</code></strong> — no silent peer mismatches.</li>
        <li><strong><code>minimum-release-age=1440</code></strong> — wait 24h before installing fresh releases.</li>
        <li><strong><code>ignore-scripts=true</code></strong> with explicit <code>pnpm.onlyBuiltDependencies</code> — reviewed allowlist for native install scripts.</li>
        <li><strong>SHA-pinned GitHub Actions</strong> — CI/CD actions are pinned to immutable commits, not mutable tags.</li>
        <li><strong>Protected npm publishing</strong> — tag-only release workflow, protected environment approval, OIDC trusted publishing, and <code>--provenance</code>.</li>
      </ul>

      <h2>Trusted proxies and rate limiting</h2>
      <p>
        DaloyJS no longer trusts <code>X-Forwarded-For</code> or <code>X-Real-IP</code> by default when deriving a
        rate-limit key. Those headers are client-spoofable unless your reverse proxy strips and rewrites them.
        The default limiter is therefore global until you provide an explicit <code>keyGenerator</code> or opt in
        to <code>trustProxyHeaders: true</code> behind a trusted proxy.
      </p>

      <h2>Self-hosted docs assets</h2>
      <p>
        The built-in docs helpers no longer force a jsDelivr-shaped CSP. You can self-host the Swagger UI or Scalar
        assets, add a nonce to the bootstrap script, and emit a same-origin CSP for your docs route.
      </p>
      <CodeBlock code={`import {
  swaggerUiHtml,
  htmlResponse,
} from "@daloyjs/core/docs";

const nonce = crypto.randomUUID();
const html = swaggerUiHtml({
  specUrl: "/openapi.json",
  scriptNonce: nonce,
  assets: {
    swaggerUiCssUrl: "/docs-assets/swagger-ui.css",
    swaggerUiBundleUrl: "/docs-assets/swagger-ui.js",
  },
});

return htmlResponse(html, {
  assetOrigins: [],
  scriptNonce: nonce,
  allowInlineStyles: false,
});`} />

      <CodeBlock language="ini" code={`# .npmrc
ignore-scripts=true
minimum-release-age=1440
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
provenance=true`} />

      <p>
        For the full CI/CD and maintainer playbook, read <a href="/docs/security/supply-chain">Supply-chain security</a>.
        Run <code>pnpm audit --prod</code> in CI and before release.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Use GitHub&apos;s private vulnerability reporting at{" "}
        <a href="https://github.com/daloyjs/daloy/security/advisories/new" target="_blank" rel="noreferrer">github.com/daloyjs/daloy/security/advisories/new</a>{" "}
        with reproduction steps. Do not open a public issue with exploit details.
      </p>
    </>
  );
}
