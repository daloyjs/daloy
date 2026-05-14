import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Security" };

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
} from "daloy";

app.use(requestId());           // x-request-id propagation
app.use(secureHeaders());       // CSP, HSTS, X-Frame-Options, COOP, CORP, no-sniff …
app.use(cors({                  // explicit allowlist; never * with credentials
  origin: ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST"],
}));
app.use(rateLimit({             // token bucket, per-IP by default, 429 + Retry-After
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
      <CodeBlock code={`import { bearerAuth, timingSafeEqual } from "daloy";

app.route({
  method: "POST",
  path: "/admin/purge",
  operationId: "adminPurge",
  hooks: {
    beforeHandle: [
      bearerAuth({
        validate: (token) => timingSafeEqual(token, process.env.ADMIN_TOKEN!),
        realm: "admin",
      }),
    ],
  },
  responses: { 204: { description: "ok" }, 401: { description: "denied" } },
  handler: async () => ({ status: 204 as const, body: undefined }),
});`} />

      <h2>Supply-chain</h2>
      <p>
        DaloyJS is distributed via <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a>{" "}
        for a stronger install model than npm:
      </p>
      <ul>
        <li><strong>Strict isolation</strong> — packages cannot reach phantom dependencies.</li>
        <li><strong>Content-addressable store</strong> — every byte is hashed and verified.</li>
        <li><strong>Frozen lockfile in CI</strong> — reproducible installs.</li>
        <li><strong><code>verify-store-integrity</code></strong> — corruption-detecting reads.</li>
        <li><strong><code>strict-peer-dependencies</code></strong> — no silent peer mismatches.</li>
        <li>(pnpm 10+) <strong><code>minimum-release-age=1440</code></strong> — wait 24h before installing fresh releases.</li>
        <li>(pnpm 10+) <strong><code>ignore-scripts=true</code></strong> with <code>pnpm approve-builds</code> — manual whitelist for native install scripts.</li>
      </ul>

      <CodeBlock language="ini" code={`# .npmrc
auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true`} />

      <p>Run <code>pnpm audit --prod</code> in CI and as a pre-commit hook.</p>

      <h2>Reporting a vulnerability</h2>
      <p>Please email <code>security@daloyjs.dev</code> with reproduction steps. Do not open a public issue.</p>
    </>
  );
}
