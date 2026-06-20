import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "OWASP API Security Top 10 mapping",
  description:
    "How DaloyJS addresses each item in the OWASP API Security Top 10 (2023), what the core enforces, which middleware to enable, and what stays your responsibility.",
  path: "/docs/security/owasp-api-top-10",
  keywords: [
    "OWASP API Security Top 10",
    "API security checklist",
    "BOLA Node.js",
    "SSRF protection",
    "DaloyJS security mapping",
    "broken object level authorization",
    "broken function level authorization",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>OWASP API Security Top 10 mapping</h1>
      <blockquote>
        <strong>Think of it like…</strong> the fire marshal&apos;s inspection
        checklist. Each item is a known way buildings burn down; this page maps
        every item to the equivalent fire-safety feature already installed in
        the framework, sprinklers, fire doors, smoke alarms, so you can point
        at the actual hardware instead of writing &quot;we&apos;ll get to
        it&quot; on the form.
      </blockquote>
      <p>
        The{" "}
        <a
          href="https://owasp.org/API-Security/editions/2023/en/0x11-t10/"
          target="_blank"
          rel="noreferrer"
        >
          OWASP API Security Top 10 (2023)
        </a>{" "}
        is the canonical checklist for what attackers actually exploit against
        HTTP APIs. This page maps every item to the Daloy primitive, middleware,
        or boot guard that addresses it &mdash; including the cross-cutting best
        practices called out in the{" "}
        <a
          href="https://www.aikido.dev/blog/api-security-guide"
          target="_blank"
          rel="noreferrer"
        >
          Aikido 2025 API security guide
        </a>{" "}
        (encryption, validation, rate limiting, logging, inventory, third-party
        API safety).
      </p>
      <p>
        Daloy&apos;s posture is <strong>secure-by-default</strong>: dangerous
        choices are refused at construction or boot, the rest is one documented
        call away. Items marked <em>your responsibility</em> are the ones no
        framework can decide for you (business-logic authorization, data
        sensitivity classification, threat modelling).
      </p>

      <LayerStack
        title="Where each item is handled"
        flow="down"
        layers={[
          {
            title: "Refused at construction or boot",
            detail: "the dangerous choice never makes it to runtime",
            tone: "success",
            items: [
              "cors origin: '*'",
              "weak session secret",
              "HS* under 32 bytes",
              "session() without csrf()",
            ],
          },
          {
            title: "Enforced per request by core + middleware",
            detail: "one documented call away",
            tone: "accent",
            items: [
              "bearerAuth() / jwk()",
              "requireScopes()",
              "rateLimit()",
              "fetchGuard()",
              "secureHeaders()",
            ],
          },
          {
            title: "Still your responsibility",
            detail: "decisions no framework can make for you",
            items: [
              "object ownership checks",
              "data classification",
              "abuse threat modelling",
            ],
          },
        ]}
        caption="The OWASP API Top 10 splits cleanly across three layers in Daloy: choices refused before runtime, controls one call away, and the business-logic decisions only your code can make. The mapping table below walks each item through these layers."
      />

      <h2>The mapping</h2>
      <table>
        <thead>
          <tr>
            <th>OWASP API risk</th>
            <th>What Daloy gives you</th>
            <th>Still your job</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>
                API1 &mdash; Broken Object Level Authorization (BOLA)
              </strong>
              . Attacker swaps an <code>id</code> in the URL to read someone
              else&apos;s record.
            </td>
            <td>
              Per-route auth via <code>bearerAuth()</code> /{" "}
              <code>basicAuth()</code> / <code>requireScopes()</code>; typed{" "}
              <code>ctx.state.auth</code> contract so the handler always knows
              who the caller is; Standard Schema params let you validate ID
              shape; <code>onAuthSuccess</code> hooks for attaching tenant/user
              context.
            </td>
            <td>
              The actual <code>resource.ownerId === auth.userId</code> check
              inside the handler. No framework can know your ownership model.
              See <a href="/docs/auth">Authentication</a>.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API2 &mdash; Broken Authentication</strong>
            </td>
            <td>
              <code>createJwtSigner()</code> / <code>createJwtVerifier()</code>{" "}
              with <code>alg</code>-discipline and mandatory <code>exp</code>;{" "}
              <code>jwk()</code> JWKS middleware (asymmetric-only);{" "}
              <code>
                bearerAuth({"{"} verify {"}"})
              </code>
              ; <code>basicAuth()</code> with UTF-8 credential decoding and
              construction-time validation; <code>passwordHash</code> /{" "}
              <code>passwordVerify</code> at <code>@daloyjs/core/hashing</code>;{" "}
              <code>session()</code> with <code>__Host-</code> cookie +
              HMAC-SHA256; <code>loginThrottle()</code>;{" "}
              <code>wsRateLimit()</code>; <code>rotateSession()</code>;{" "}
              <code>Cache-Control: no-store</code> baked into{" "}
              <code>UnauthorizedError</code> / <code>ForbiddenError</code> /{" "}
              <code>TooManyRequestsError</code>. Refuse-to-boot on weak session
              secrets and short HS-JWT keys.
            </td>
            <td>
              Pick the right identity provider (see{" "}
              <a href="/docs/auth">Auth integrations</a>) and rotate
              secrets/keys on a schedule.
            </td>
          </tr>
          <tr>
            <td>
              <strong>
                API3 &mdash; Broken Object Property Level Authorization
              </strong>{" "}
              (excessive data exposure + mass assignment).
            </td>
            <td>
              Contract-first <code>app.route()</code> with <code>request</code>{" "}
              <em>and</em> <code>responses</code> schemas (Zod / Valibot /
              ArkType / TypeBox). Only fields you declare in the response schema
              are emitted &mdash; undeclared fields a handler returns (a stray{" "}
              <code>passwordHash</code>, a spread ORM row) are stripped at
              serialization, not just flagged. Only fields you declare in the
              request schema reach your handler. Surfaced in OpenAPI so
              reviewers can audit every payload.
            </td>
            <td>
              Author response schemas that omit internal fields. Don&apos;t
              spread raw ORM rows into responses. Stripping only runs when a{" "}
              <code>2xx</code> response declares a <code>body</code> schema, so{" "}
              <code>daloy doctor</code> emits{" "}
              <code>audit.response.bodySchema</code> (and a dev-mode boot
              warning) for any success response that has none.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API4 &mdash; Unrestricted Resource Consumption</strong>
            </td>
            <td>
              Body-size cap (default 1 MiB, <code>Content-Length</code> checked
              first &rarr; <code>413</code>); per-route{" "}
              <code>request.timeout</code>; <code>rateLimit()</code> with{" "}
              <code>groupId</code> shared buckets;{" "}
              <code>@daloyjs/core/rate-limit-redis</code> for multi-instance
              deploys; <code>loadShedding()</code>; <code>ipRestriction()</code>{" "}
              with CIDR-aware allow/deny; multipart per-field size caps and MIME
              allowlist; <code>compression()</code> with BREACH-aware skips and
              <code>minimumSize</code> + negative-ratio guard;{" "}
              connection-draining shutdown.
            </td>
            <td>
              Pick numeric limits that match your traffic budget. Run a
              Redis-backed limiter when you have more than one process.
            </td>
          </tr>
          <tr>
            <td>
              <strong>
                API5 &mdash; Broken Function Level Authorization (BFLA)
              </strong>
            </td>
            <td>
              <code>requireScopes()</code> with RFC-6750 challenge and
              per-request aggregation; per-route middleware via{" "}
              <code>combine</code> (<code>every</code> / <code>some</code> /{" "}
              <code>except</code>) so admin actions are explicit, not implicit;{" "}
              <code>internal: true</code> route flag (<code>404</code> via{" "}
              <code>app.fetch</code>, dispatched only via{" "}
              <code>app.inject</code>); namespace-protected decorators prevent
              accidental privilege bleed across plugins.
            </td>
            <td>
              Define your scope/role catalog and apply{" "}
              <code>requireScopes()</code> to every admin or destructive route.
            </td>
          </tr>
          <tr>
            <td>
              <strong>
                API6 &mdash; Unrestricted Access to Sensitive Business Flows
              </strong>
            </td>
            <td>
              <code>
                rateLimit({"{"} groupId {"}"})
              </code>{" "}
              to share a bucket across related endpoints (checkout, refund,
              transfer); <code>loginThrottle()</code> for credential stuffing;{" "}
              <code>wsRateLimit()</code> for socket abuse; <code>csrf()</code> +
              Fetch-Metadata enforcement to refuse cross-origin state-changing
              requests by default.
            </td>
            <td>
              Threat-model the abuse case &mdash; coupon stacking, repeated
              transfers, mass account creation &mdash; and group the limiter
              accordingly.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API7 &mdash; Server-Side Request Forgery (SSRF)</strong>
            </td>
            <td>
              <code>fetchGuard()</code> wraps the global <code>fetch</code> and
              refuses requests to loopback, RFC1918, link-local (including every
              documented cloud metadata IP &mdash; AWS / Azure / DigitalOcean{" "}
              <code>169.254.169.254</code>, Oracle <code>192.0.0.192</code>,
              Alibaba <code>100.100.100.200</code>), and IPv6 unique-local.
              Throws <code>SsrfBlockedError</code> with a reason code so
              handlers can surface a clean <code>422</code>. See{" "}
              <a href="/docs/security/fetch-guard">SSRF guard</a>.
            </td>
            <td>
              Use <code>safeFetch</code> for <em>every</em> outbound call whose
              URL is influenced by user input.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API8 &mdash; Security Misconfiguration</strong>
            </td>
            <td>
              <code>secureHeaders()</code> auto-applied (CSP with nonce +
              Trusted Types, HSTS, frame-defense); <code>Server</code> and{" "}
              <code>X-Powered-By</code> stripped; duplicate <code>Host</code> /{" "}
              <code>Content-Length</code> rejected; <code>safeJsonParse</code>{" "}
              strips <code>__proto__</code> / <code>constructor</code> /{" "}
              <code>prototype</code>; header injection / response splitting
              guards; path-traversal rejection; per-route <code>accepts</code>{" "}
              content-type opt-in; cross-origin state-changing requests refused
              with <code>403</code> unless <code>cors()</code> allows;{" "}
              <code>cors()</code> <code>methods: [&quot;*&quot;]</code> refused
              at construction and default <code>allowMethods</code> narrowed to{" "}
              <code>[GET, HEAD, POST]</code>; CSP report receiver refuses non-
              <code>application/json</code> and bodies over 64 KiB;
              refuse-to-boot in production on{" "}
              <code>
                cors({"{"} origin: &quot;*&quot;{"}"})
              </code>
              , weak session secrets, unconfigured <code>X-Forwarded-*</code>,
              missing <code>csrf()</code> alongside <code>session()</code> with
              state-changing routes, and unauthenticated health endpoints
              without explicit acknowledgement. Run <code>daloy doctor</code>{" "}
              and <code>daloy doctor --audit-defaults</code> in CI. See{" "}
              <a href="/docs/security/secure-defaults">Secure-by-default</a> and{" "}
              <a href="/docs/security/boot-guards">Boot guards</a>.
            </td>
            <td>
              Set{" "}
              <code>
                app({"{"} behindProxy {"}"})
              </code>{" "}
              correctly for your deployment and keep TLS termination configured
              upstream.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API9 &mdash; Improper Inventory Management</strong>
            </td>
            <td>
              OpenAPI 3.1 generated from your routes (single source of truth, no
              annotations); <code>GET /openapi.json</code> +{" "}
              <code>GET /openapi.yaml</code>; <code>daloy inspect</code> for
              routes / dead routes / missing <code>operationId</code>;{" "}
              <code>daloy inspect --ai</code> dump for agents and audit tooling;
              typed client codegen via Hey API (<code>pnpm gen</code>) so
              downstream consumers track the same contract.
            </td>
            <td>
              Decommission old API versions instead of leaving them mounted.
              Treat shadow endpoints &mdash; the ones no route file defines
              &mdash; as bugs.
            </td>
          </tr>
          <tr>
            <td>
              <strong>API10 &mdash; Unsafe Consumption of APIs</strong>
            </td>
            <td>
              <code>fetchGuard()</code> for outbound calls (blocks SSRF pivots
              through third-party redirects);{" "}
              <code>verifyWebhookSignature()</code> /{" "}
              <code>signWebhookPayload()</code> at{" "}
              <code>@daloyjs/core/hashing</code> for HMAC-verified inbound
              webhooks (<code>sha256=</code>-prefixed only); Standard Schema
              validation on third-party response bodies so a compromised vendor
              can&apos;t inject unexpected fields; request timeouts so a slow
              upstream can&apos;t exhaust your event loop.
            </td>
            <td>
              Pin the vendor URL list, set <code>fetchGuard()</code> options to
              match your egress policy, and validate every external payload like
              it were user input.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Cross-cutting best practices</h2>
      <p>
        The Aikido guide also calls out general defences that aren&apos;t in the
        Top 10 list but matter for any API. Here&apos;s where Daloy addresses
        each.
      </p>
      <table>
        <thead>
          <tr>
            <th>Practice</th>
            <th>Daloy</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Encryption in transit</td>
            <td>
              HSTS via <code>secureHeaders()</code>; <code>__Host-</code> /{" "}
              <code>__Secure-</code> cookies refused over plain HTTP;
              refuse-to-boot if behind a proxy you haven&apos;t declared.
            </td>
          </tr>
          <tr>
            <td>Input validation and schema enforcement</td>
            <td>
              Standard Schema (Zod 4 / Valibot / ArkType / TypeBox) on{" "}
              <code>request.params</code> / <code>query</code> /{" "}
              <code>headers</code> / <code>json</code> / <code>form</code> /{" "}
              <code>multipart</code>; rejected requests turn into RFC 9457
              problem+json.
            </td>
          </tr>
          <tr>
            <td>Output validation (no surprise fields)</td>
            <td>
              <code>responses</code> schemas validated per status code;
              mismatched payloads fail loudly in dev and are stripped in prod.
            </td>
          </tr>
          <tr>
            <td>Rate limiting and throttling</td>
            <td>
              <code>rateLimit()</code>,{" "}
              <code>
                rateLimit({"{"} groupId {"}"})
              </code>
              , <code>loginThrottle()</code>, <code>wsRateLimit()</code>,{" "}
              <code>@daloyjs/core/rate-limit-redis</code>.
            </td>
          </tr>
          <tr>
            <td>Logging without leaks</td>
            <td>
              Structured pluggable logger with default redaction of common
              secret keys (<code>authorization</code>, <code>password</code>,{" "}
              <code>token</code>, <code>cookie</code>, ...); request-id
              propagation; <code>requestId()</code> trust-default audit.
            </td>
          </tr>
          <tr>
            <td>Error handling without info leak</td>
            <td>
              RFC 9457 problem+json with prod-mode redaction; stack traces never
              leave the process in production;{" "}
              <code>
                httpError({"{"} res {"}"})
              </code>{" "}
              refuses state-mutating headers.
            </td>
          </tr>
          <tr>
            <td>Health checks without DoS amplification</td>
            <td>
              <code>app.healthcheck()</code> / <code>app.readinesscheck()</code>{" "}
              with optional bearer-token auth and per-IP rate limit;
              refuse-to-boot in production without explicit{" "}
              <code>acknowledgeUnauthenticated: true</code>.
            </td>
          </tr>
          <tr>
            <td>Supply-chain hardening</td>
            <td>
              <code>ignore-scripts=true</code>,{" "}
              <code>minimum-release-age=1440</code>, SHA-pinned actions, CodeQL
              + Opengrep, OpenSSF Scorecard, npm trusted publishing with
              provenance, SBOM. See{" "}
              <a href="/docs/security/supply-chain">Supply-chain security</a>.
            </td>
          </tr>
          <tr>
            <td>Zero-trust posture between services</td>
            <td>
              JWT / JWKS verification helpers, scheme-aware{" "}
              <code>ctx.state.auth</code> typed contract, namespace-protected
              decorators, plugin <code>dependencies: string[]</code>{" "}
              refuse-to-boot.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>What no framework can do for you</h2>
      <ul>
        <li>
          <strong>Business-logic abuse:</strong> only your code knows whether a
          sequence of valid API calls amounts to fraud. Threat-model the
          workflow.
        </li>
        <li>
          <strong>Object-level authorization:</strong> Daloy enforces{" "}
          <em>who</em> can call a route; <em>which</em> records they can touch
          is application logic.
        </li>
        <li>
          <strong>Data classification:</strong> deciding which fields are
          sensitive is a product decision. Daloy keeps unwanted fields out if
          you list them in the response schema.
        </li>
        <li>
          <strong>Penetration testing:</strong> automated scanners catch common
          issues; a human tester catches logic chains. Run both on a schedule.
        </li>
      </ul>

      <h2>Verify your posture</h2>
      <ul>
        <li>
          <code>daloy doctor</code> &mdash; deployment-config posture checks.
        </li>
        <li>
          <code>daloy doctor --audit-defaults</code> &mdash; live
          secure-by-default audit.
        </li>
        <li>
          <code>pnpm verify:parity-audits</code> &mdash; static gates that fail
          CI if a secure default is regressed.
        </li>
        <li>
          <code>pnpm verify:governance-audits</code> &mdash; release- workflow
          rotation and governance floor.
        </li>
        <li>
          <code>daloy inspect</code> &mdash; route inventory, dead routes,
          missing <code>operationId</code>s.
        </li>
      </ul>

      <p>
        Report a vulnerability via GitHub&apos;s private advisory at{" "}
        <a
          href="https://github.com/daloyjs/daloy/security/advisories/new"
          target="_blank"
          rel="noreferrer"
        >
          github.com/daloyjs/daloy/security/advisories/new
        </a>
        .
      </p>
    </>
  );
}
