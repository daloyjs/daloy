import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Security",
  description:
    "DaloyJS ships core-enforced security guardrails plus first-party middleware for secure headers, rate limits, CORS, CSRF, sessions, and supply-chain hardening.",
  path: "/docs/security",
  keywords: [
    "DaloyJS security",
    "secure HTTP defaults",
    "rate limiting",
    "secure headers",
    "OWASP TypeScript",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Security</h1>
      <p>
        Bad defaults are bugs. DaloyJS separates core-enforced guardrails from
        first-party security middleware so the dangerous things are blocked by
        default and the deployment-specific things stay explicit.
      </p>

      <h2>What the core enforces</h2>
      <p>
        These checks happen in <code>App</code> or the runtime adapter itself.
        Applications get them without calling any middleware.
      </p>
      <table>
        <thead>
          <tr>
            <th>Threat</th>
            <th>Built-in behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Body-size DoS</td>
            <td>
              Streamed read, hard cap (default 1 MiB), Content-Length checked
              first → 413.
            </td>
          </tr>
          <tr>
            <td>Prototype pollution</td>
            <td>
              <code>safeJsonParse</code> strips <code>__proto__</code>,{" "}
              <code>constructor</code>, <code>prototype</code> via reviver.
            </td>
          </tr>
          <tr>
            <td>Header / response splitting</td>
            <td>
              <code>sanitizeHeaderName</code> / <code>sanitizeHeaderValue</code>{" "}
              reject CRLF + NUL.
            </td>
          </tr>
          <tr>
            <td>Path traversal</td>
            <td>
              Router rejects <code>..</code> segments and <code>{"//"}</code>{" "}
              before walking.
            </td>
          </tr>
          <tr>
            <td>Slow-loris / hung handlers</td>
            <td>
              <code>requestTimeoutMs</code> aborts handlers (default 30s); Node
              adapter sets timeouts.
            </td>
          </tr>
          <tr>
            <td>Unsupported content types</td>
            <td>
              Routes with body schemas reject non-allowed content-types → 415.
            </td>
          </tr>
          <tr>
            <td>Method confusion</td>
            <td>
              Real <strong>405</strong> with <code>Allow</code> header — never a
              misleading 404.
            </td>
          </tr>
          <tr>
            <td>Information disclosure (5xx)</td>
            <td>
              Production mode strips <code>detail</code> from 5xx problem+json
              automatically.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>First-party security middleware</h2>
      <p>
        These are part of DaloyJS and documented together, but they stay
        explicit because CSP, CORS, rate-limit keys, session secrets, and CSRF
        rollout are deployment decisions.
      </p>
      <CodeBlock
        code={`import {
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
app.use(timing());              // Server-Timing header for observability`}
      />

      <p>
        The official starters wire these in for you: Node, Bun, and Deno enable
        <code>secureHeaders()</code>, <code>requestId()</code>, and{" "}
        <code>rateLimit()</code>; Cloudflare Worker and Vercel Edge enable{" "}
        <code>secureHeaders()</code> and
        <code>requestId()</code> plus tighter edge-friendly body and timeout
        limits.
      </p>

      <h2>Recommended by deployment target</h2>
      <p>
        Start with the middleware below unless you have a concrete reason not
        to. The point is not to hide policy behind a boolean flag; it is to make
        the risky choices explicit and consistent.
      </p>
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Recommended baseline</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node / Bun / Deno API</td>
            <td>
              <code>requestId()</code>, <code>secureHeaders()</code>,{" "}
              <code>rateLimit()</code>, and <code>cors()</code> when the API is
              cross-origin.
            </td>
          </tr>
          <tr>
            <td>Cloudflare Workers</td>
            <td>
              <code>requestId()</code> and <code>secureHeaders()</code> by
              default; use <code>cors()</code> only when needed, and prefer an
              external/shared limiter over the in-memory default when traffic
              spans many isolates.
            </td>
          </tr>
          <tr>
            <td>Vercel Edge</td>
            <td>
              <code>requestId()</code> and <code>secureHeaders()</code> by
              default; add <code>cors()</code> only when needed, and use a
              shared limiter if you need durable counters across regions.
            </td>
          </tr>
          <tr>
            <td>Cookie-authenticated app</td>
            <td>
              Add <code>session()</code> plus <code>csrf()</code> on top of the
              baseline so mutating routes are protected against cross-site form
              and fetch attacks.
            </td>
          </tr>
          <tr>
            <td>Behind a trusted reverse proxy</td>
            <td>
              Keep the baseline, then configure <code>rateLimit()</code> with an
              explicit <code>keyGenerator</code> or set{" "}
              <code>trustProxyHeaders: true</code> only after the proxy strips
              and rewrites forwarding headers.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>
        <code>csrf()</code> for state-changing routes
      </h2>
      <p>
        Use{" "}
        <a href="/docs/security/csrf">
          <code>csrf()</code>
        </a>{" "}
        to protect mutating endpoints. Two strategies are supported:
      </p>
      <ul>
        <li>
          <strong>Double-submit cookie</strong> (default) &mdash; sets a token
          cookie on safe requests, requires the same value on the{" "}
          <code>x-csrf-token</code> header for unsafe methods, and rejects
          mismatches with a timing-safe <strong>403</strong>.
        </li>
        <li>
          <strong>Fetch Metadata</strong> (
          <code>strategy: &quot;fetch-metadata&quot;</code>) - tokenless
          protection that relies on the modern <code>Sec-Fetch-Site</code>{" "}
          header. No cookie round-trip; no HTML rendering coupling. Recommended
          for new browser-facing apps.
        </li>
      </ul>
      <CodeBlock
        code={`import { csrf } from "@daloyjs/core";

// Classic double-submit cookie (default).
app.use(csrf());

// Tokenless Fetch-Metadata protection (recommended for browser-facing apps).
app.use(csrf({
  strategy: "fetch-metadata",
  allowedOrigins: ["https://app.example.com"],
}));`}
      />

      <h2>
        <code>secureHeaders()</code> defaults
      </h2>
      <CodeBlock
        language="text"
        code={`content-security-policy: default-src 'self'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
permissions-policy: camera=(), microphone=(), geolocation=(), clipboard-write=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin`}
      />

      <p>
        If you need a different CSP, want to disable HSTS in local development,
        or need a looser permissions policy, pass options to{" "}
        <code>secureHeaders()</code> explicitly. The legacy{" "}
        <code>X-XSS-Protection: 0</code> header is opt-in via{" "}
        <code>xssProtection: true</code> for deployments that want to explicitly
        disable old browser XSS filters.
      </p>

      <h3>CSP with per-request nonces &amp; Trusted Types</h3>
      <p>
        <code>secureHeaders()</code> can build the CSP from a directive map and
        inject a fresh <strong>per-request nonce</strong> into{" "}
        <code>script-src</code>, <code>script-src-elem</code>,{" "}
        <code>style-src</code>, and <code>style-src-elem</code>, plus emit{" "}
        <code>require-trusted-types-for &apos;script&apos;</code> for runtime
        DOM XSS hardening. The nonce is exposed at{" "}
        <code>ctx.state.cspNonce</code> so handlers can render it into{" "}
        <code>&lt;script nonce=&quot;...&quot;&gt;</code> tags.
      </p>
      <CodeBlock
        code={`import { secureHeaders } from "@daloyjs/core";
import { htmlResponse } from "@daloyjs/core/docs";

app.use(secureHeaders({
  contentSecurityPolicy: {
    directives: {
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self'",
      "img-src": ["'self'", "data:"],
    },
    nonce: true,
    trustedTypes: { policies: ["default"] },
  },
}));

app.route({
  method: "GET",
  path: "/page",
  operationId: "page",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => htmlResponse(\`
    <!doctype html>
    <script nonce="\${state.cspNonce}">
      // inline bootstrap is allowed only via this fresh nonce
    </script>
  \`),
});`}
      />

      <h2>Auth</h2>
      <CodeBlock
        code={`import { bearerAuth, basicAuth, timingSafeEqual } from "@daloyjs/core";

// Bearer (opaque tokens, JWT verified via your own \`validate\`).
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
});

// Basic auth (RFC 7617).
app.use(basicAuth({
  realm: "books-api",
  verify: (user, pass) =>
    timingSafeEqual(user, "admin") &&
    timingSafeEqual(pass, process.env.ADMIN_PASSWORD ?? ""),
}));`}
      />

      <h2>SQL injection</h2>
      <p>
        Daloy doesn&apos;t ship a database driver, but the HTTP boundary it{" "}
        <em>does</em> own (strict Zod schemas, hardened JSON parser, body-size
        caps) shrinks the surface that reaches your repository layer. See{" "}
        <a href="/docs/security/sql-injection">SQL injection</a> for the safe
        vs. unsafe patterns per ORM (Prisma, Drizzle, Kysely, raw drivers), an
        allowlisting recipe for dynamic <code>ORDER BY</code>, and the grep
        rules the maintainers use to catch regressions.
      </p>

      <h2>Command injection</h2>
      <p>
        DaloyJS&apos;s runtime is <code>child_process</code>-free by CI gate, so
        the framework itself cannot shell out. See{" "}
        <a href="/docs/security/command-injection">Command injection</a> for the
        safe shape of a handler that does need to invoke an external program (
        <code>execFile</code> + argv array, never{" "}
        <code>exec(`cmd ${"${input}"}`)</code>), the Windows <em>BatBadBut</em>{" "}
        footgun, and the grep rules to keep new bugs out at PR time.
      </p>

      <h2>Admin panels</h2>
      <p>
        Building an admin or customer-success surface on top of DaloyJS? See{" "}
        <a href="/docs/security/admin-panels">Secure admin panels</a> for the
        recommended pattern: <code>internal: true</code> routes,{" "}
        <code>ipRestriction()</code>, strict CSP with per-request nonces,
        per-admin authentication, login-throttle <code>rateLimit()</code>
        groups, and structured audit logging &mdash; mapped one-to-one to
        Aikido&apos;s public &quot;secure admin panel&quot; checklist.
      </p>

      <h2>Supply-chain</h2>
      <p>
        DaloyJS is distributed via{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
          pnpm
        </a>{" "}
        for a stricter install model. Scaffolded pnpm apps inherit the
        install-time controls, while DaloyJS&apos;s own repository and the
        optional GitHub Actions bundle add CI/CD controls against the
        cache-poisoning, maintainer-phishing, and OIDC token-abuse patterns seen
        in recent npm incidents.
      </p>
      <ul>
        <li>
          <strong>Strict isolation</strong> — packages cannot reach phantom
          dependencies.
        </li>
        <li>
          <strong>Content-addressable store</strong> — every byte is hashed and
          verified.
        </li>
        <li>
          <strong>Frozen lockfile in CI</strong> with{" "}
          <code>--ignore-scripts</code> — reproducible installs without
          transitive lifecycle execution.
        </li>
        <li>
          <strong>
            <code>verify-store-integrity</code>
          </strong>{" "}
          — corruption-detecting reads.
        </li>
        <li>
          <strong>
            <code>strict-peer-dependencies</code>
          </strong>{" "}
          — no silent peer mismatches.
        </li>
        <li>
          <strong>
            <code>minimum-release-age=1440</code>
          </strong>{" "}
          — wait 24h before installing fresh releases.
        </li>
        <li>
          <strong>
            <code>ignore-scripts=true</code>
          </strong>{" "}
          with explicit <code>pnpm.onlyBuiltDependencies</code> — reviewed
          allowlist for native install scripts.
        </li>
        <li>
          <strong>SHA-pinned GitHub Actions</strong> — the optional generated
          GitHub workflows pin third-party actions to immutable commits, not
          mutable tags.
        </li>
        <li>
          <strong>Protected DaloyJS npm publishing</strong> — the
          framework&apos;s own packages use a tag-only release workflow,
          protected environment approval, OIDC trusted publishing, and{" "}
          <code>--provenance</code>.
        </li>
      </ul>
      <p>
        If your generated app lives outside GitHub, carry over the portable
        parts directly and translate the GitHub workflow rules to your CI host.
        The framework cannot enforce branch protection or runner egress in a
        private GitLab, Bitbucket, Azure DevOps, or on-prem installation.
      </p>

      <h2>Trusted proxies and rate limiting</h2>
      <p>
        DaloyJS no longer trusts <code>X-Forwarded-For</code> or{" "}
        <code>X-Real-IP</code> by default when deriving a rate-limit key. Those
        headers are client-spoofable unless your reverse proxy strips and
        rewrites them. The default limiter is therefore global until you provide
        an explicit <code>keyGenerator</code> or opt in to{" "}
        <code>trustProxyHeaders: true</code> behind a trusted proxy.
      </p>
      <p>
        For credential-entry routes, use{" "}
        <a href="/docs/security/websocket-login-throttle">
          <code>loginThrottle()</code>
        </a>{" "}
        across <code>/login</code>, OTP, and password-reset routes, and{" "}
        <code>wsRateLimit()</code> on related WebSocket upgrades. Both helpers
        can spend from the same <code>groupId</code> bucket.
      </p>

      <h2>Self-hosted docs assets</h2>
      <p>
        The built-in docs helpers no longer force a jsDelivr-shaped CSP. You can
        self-host the Swagger UI or Scalar assets, add a nonce to the bootstrap
        script, and emit a same-origin CSP for your docs route.
      </p>
      <CodeBlock
        code={`import {
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
});`}
      />

      <CodeBlock
        language="ini"
        code={`# .npmrc
ignore-scripts=true
minimum-release-age=1440
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
provenance=true`}
      />

      <p>
        For the full CI/CD and maintainer playbook, read{" "}
        <a href="/docs/security/supply-chain">Supply-chain security</a>. Run{" "}
        <code>pnpm audit --prod</code> in CI and before release.
      </p>

      <h2>OWASP API Security Top 10 mapping</h2>
      <p>
        For a per-item walkthrough of how Daloy addresses every entry in the{" "}
        <a
          href="https://owasp.org/API-Security/editions/2023/en/0x11-t10/"
          target="_blank"
          rel="noreferrer"
        >
          OWASP API Security Top 10 (2023)
        </a>{" "}
        &mdash; plus the cross-cutting best practices (encryption, validation,
        rate limiting, logging, inventory, third-party API safety) &mdash; read{" "}
        <a href="/docs/security/owasp-api-top-10">OWASP API Top 10 mapping</a>.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Use GitHub&apos;s private vulnerability reporting at{" "}
        <a
          href="https://github.com/daloyjs/daloy/security/advisories/new"
          target="_blank"
          rel="noreferrer"
        >
          github.com/daloyjs/daloy/security/advisories/new
        </a>{" "}
        with reproduction steps. Do not open a public issue with exploit
        details.
      </p>
    </>
  );
}
