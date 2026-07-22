import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title:
    "Compliance posture (SOC 2, ISO 27001, HIPAA, GDPR, PCI-DSS, NIS2, EU CRA, DORA, UK CSR Bill)",
  description:
    "How DaloyJS's built-in security primitives map to the technical controls expected by the major cloud-compliance frameworks, including DORA (EU Regulation 2022/2554) and the UK Cyber Security and Resilience Bill. The framework can't certify your deployment, but it can stop you from failing the easy audit findings.",
  path: "/docs/security/compliance",
  keywords: [
    "DaloyJS compliance",
    "SOC 2 Node.js framework",
    "ISO 27001 Annex A controls",
    "HIPAA technical safeguards",
    "GDPR Article 32",
    "PCI-DSS v4 software controls",
    "NIS2 Article 21",
    "EU CRA",
    "DORA Regulation 2022/2554",
    "DORA technical requirements",
    "ICT third-party risk",
    "UK Cyber Security and Resilience Bill",
    "NCSC CAF",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Compliance posture</h1>
      <blockquote>
        This page maps DaloyJS controls to SOC 2, ISO 27001, HIPAA, GDPR, PCI,
        NIS2, and DORA requirements. Use it as evidence guidance, then confirm
        the final scope with your auditor or legal team.
      </blockquote>
      <p>
        DaloyJS is a backend framework, not a managed service, so it cannot
        certify your deployment for SOC 2, ISO 27001, HIPAA, GDPR, PCI-DSS,
        NIS2, DORA, or the UK Cyber Security and Resilience Bill on its own.
        What it <em>can</em> do is provide the technical controls each of those
        frameworks expects from the application layer so that the controls live
        in source code where they are reviewed, tested, and version-pinned,
        rather than in a checklist that drifts away from production.
      </p>
      <p>
        This page maps DaloyJS&apos;s built-in primitives to the control
        families auditors actually ask about. The mapping is informational, not
        a legal opinion: organizational controls (employee training, vendor
        management, physical security, access reviews) remain the
        operator&apos;s responsibility.
      </p>

      <h2 id="shared-technical-controls">Shared technical controls</h2>
      <p>
        Most frameworks ask for the same handful of application-layer controls
        under different names. DaloyJS ships them by default.
      </p>
      <LayerStack
        title="The application-layer controls auditors keep asking about"
        flow="down"
        layers={[
          {
            title: "Transport & headers",
            detail: "secure-by-default HTTP boundary",
            tone: "accent",
            items: ["secureHeaders()", "HSTS", "CSP nonce"],
          },
          {
            title: "Authn, authz & crypto",
            detail: "identity tied to every request",
            items: [
              "session()",
              "bearerAuth()",
              "JWT alg allowlist",
              "timingSafeEqual",
            ],
          },
          {
            title: "Input validation & abuse control",
            detail: "bad input rejected before the handler",
            items: [
              ".strict() schemas",
              "safeJsonParse",
              "rateLimit()",
              "fetchGuard()",
            ],
          },
          {
            title: "Audit logging & supply chain",
            detail: "evidence trail for the dossier",
            tone: "success",
            items: ["requestId + logs", "log redaction", "provenance", "SBOM"],
          },
        ]}
        caption="The same four control families show up in SOC 2, ISO 27001, HIPAA, GDPR, PCI, NIS2, DORA, and the UK CSR Bill under different names. The table below maps each framework's clause to the DaloyJS primitive that satisfies it."
      />
      <table>
        <thead>
          <tr>
            <th>Control family</th>
            <th>DaloyJS primitive</th>
            <th>Where to read more</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Secure transport &amp; secure headers</td>
            <td>
              <code>secureHeaders()</code> (HSTS, CSP, COOP, CORP, X-Frame,
              no-sniff, Referrer-Policy).
            </td>
            <td>
              <a href="/docs/security/secure-defaults">Secure-by-default</a>
            </td>
          </tr>
          <tr>
            <td>Authentication &amp; session integrity</td>
            <td>
              Signed-cookie <code>session()</code> with key rotation;
              first-party JWT/JWK helpers; <code>bearerAuth()</code>.
            </td>
            <td>
              <a href="/docs/security/session">Sessions</a>
              {", "}
              <a href="/docs/auth">Authentication</a>
            </td>
          </tr>
          <tr>
            <td>Authorization at the route boundary</td>
            <td>
              Per-route middleware composition; <code>ipRestriction()</code> for
              admin slices; auth-slice pattern for internal endpoints.
              Object-level checks (BOLA / IDOR) stay in the application&apos;s
              ownership rules; the framework carries the authenticated principal
              into the handler so those checks can run against the record being
              touched.
            </td>
            <td>
              <a href="/docs/security/admin-panels">Secure admin panels</a>
              {", "}
              <a href="/docs/security/auth-slice">Auth slice</a>
              {", "}
              <a href="/docs/security/resource-authorization">
                Resource authorization
              </a>
            </td>
          </tr>
          <tr>
            <td>Input validation &amp; injection defense</td>
            <td>
              Zod/Valibot schemas on every body, query, and param; router
              rejects
              <code>..</code> and <code>{`//`}</code>;{" "}
              <code>safeJsonParse</code> strips prototype-pollution keys;
              SQL/command-injection guards documented for ORMs and shells.
            </td>
            <td>
              <a href="/docs/security/sql-injection">SQL injection</a>
              {", "}
              <a href="/docs/security/command-injection">Command injection</a>
            </td>
          </tr>
          <tr>
            <td>CSRF &amp; cross-origin policy</td>
            <td>
              <code>csrf()</code> with double-submit cookie or Fetch Metadata;
              explicit <code>cors()</code> allowlist (no <code>*</code> with
              credentials).
            </td>
            <td>
              <a href="/docs/security/csrf">CSRF protection</a>
            </td>
          </tr>
          <tr>
            <td>Rate limiting &amp; abuse control</td>
            <td>
              In-memory <code>rateLimit()</code> for single-instance;
              Redis-backed limiter for multi-instance; load shedding;
              login-throttle pattern for auth endpoints.
            </td>
            <td>
              <a href="/docs/security/rate-limit-redis">Rate limit (Redis)</a>
              {", "}
              <a href="/docs/security/websocket-login-throttle">
                WebSocket + login throttle
              </a>
            </td>
          </tr>
          <tr>
            <td>SSRF / outbound network controls</td>
            <td>
              <code>fetchGuard()</code> blocks private IPs, link-local,
              metadata-service ranges, non-http(s) schemes, and credentials in
              the URL (<code>credentials-in-url</code>). On Node,{" "}
              <code>pinDns</code> defaults to <code>true</code> for{" "}
              <code>http:</code> so the validated IP is pinned for the socket
              (reduces DNS-rebinding TOCTOU on that path).
            </td>
            <td>
              <a href="/docs/security/fetch-guard">SSRF guard (fetchGuard)</a>
            </td>
          </tr>
          <tr>
            <td>Resource-exhaustion DoS</td>
            <td>
              Streamed body reads with hard caps; <code>requestTimeoutMs</code>;
              compression bomb protection; multipart limits.
            </td>
            <td>
              <a href="/docs/security/runtime-protections">
                Runtime protections
              </a>
              {", "}
              <a href="/docs/security/compression">Compression</a>
            </td>
          </tr>
          <tr>
            <td>Audit logging &amp; PII handling</td>
            <td>
              Structured logger with request-id correlation; default key
              redaction (<code>DEFAULT_REDACT_KEYS</code>) for known secret/PII
              keys; JWT-like and opaque-token value scrubbing;{" "}
              <code>sanitizeUrlForLog</code> (
              <code>SENSITIVE_URL_QUERY_KEYS</code>) strips secret-bearing query
              params and userinfo from request URLs bound into log records;
              opt-in redaction for application-specific fields.
            </td>
            <td>
              <a href="/docs/logging">Logging</a>
              {", "}
              <a href="/docs/tracing">Tracing</a>
            </td>
          </tr>
          <tr>
            <td>Cryptography</td>
            <td>
              <code>hashing</code> helpers, timing-safe secret comparison,
              first-party JWT/JWK with algorithm allow-listing (no{" "}
              <code>alg: none</code>), HMAC webhook verification with
              algorithm-prefix parsing.
            </td>
            <td>
              <a href="/docs/security/secure-defaults">Secure-by-default</a>
            </td>
          </tr>
          <tr>
            <td>Software supply chain</td>
            <td>
              Zero runtime deps; npm provenance (<code>--provenance</code>);
              SBOM published per release; <code>create-daloy</code> ships
              <code>ignore-scripts=true</code> and{" "}
              <code>minimum-release-age</code>; CI is SHA-pinned and{" "}
              <code>harden-runner</code>-gated.
            </td>
            <td>
              <a href="/docs/security/supply-chain">Supply-chain security</a>
            </td>
          </tr>
          <tr>
            <td>Vulnerability handling SLA</td>
            <td>
              Published CVSS-keyed patch SLA (48h critical, 7d high, 30d medium,
              90d low) with GHSA evidence trail.
            </td>
            <td>
              <a
                href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md"
                target="_blank"
                rel="noreferrer"
              >
                SECURITY.md
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="soc-2-trust-services-criteria-2017-with-2022-points-of-focus">
        SOC 2 (Trust Services Criteria, 2017 with 2022 points of focus)
      </h2>
      <p>
        SOC 2 maps to the Trust Services Criteria. DaloyJS contributes mostly to
        the <strong>Security (Common Criteria)</strong> category and partially
        to Availability and Confidentiality. Privacy and Processing Integrity
        also get coverage when you turn the schemas into binding contracts.
      </p>
      <ul>
        <li>
          CC6.1 / CC6.6: logical access &amp; boundary protection. Use{" "}
          <code>secureHeaders()</code>
          {", "}
          <code>cors()</code>
          {", "}
          <code>session()</code>
          {", "}
          <code>bearerAuth()</code>
          {", "}and <code>ipRestriction()</code> on admin routes.
        </li>
        <li>
          CC6.7: data in transit. HSTS via <code>secureHeaders()</code>; TLS
          termination is the platform&apos;s responsibility.
        </li>
        <li>
          CC6.8: protection against malicious software. Supply-chain hardening
          (no runtime deps, provenance, SBOM,
          <code>ignore-scripts</code>
          {", "}SHA-pinned actions, lockfile-source verification).
        </li>
        <li>
          CC7.1 / CC7.2: monitoring &amp; anomaly detection. Structured JSON
          logs with request-id correlation; Server-Timing for latency
          monitoring; OpenTelemetry integration documented under{" "}
          <a href="/docs/tracing">Tracing</a>.
        </li>
        <li>
          CC7.4: incident response. Published <code>SECURITY.md</code>
          {", "}GHSA evidence pattern, and CVSS-keyed patch SLA.
        </li>
        <li>
          A1.2: availability. Rate limiting, load shedding, request timeouts,
          body-size caps, graceful shutdown hooks.
        </li>
      </ul>

      <h2 id="iso-iec-27001-2022-annex-a">ISO/IEC 27001:2022 (Annex A)</h2>
      <p>
        Picking the 2022 revision (rather than 2013/2017) is the safer call for
        new certifications, because it adds explicit controls for secure coding,
        threat intelligence, web filtering, and configuration management that
        DaloyJS already covers out of the box. The mapping below is the short
        version your auditor can use as evidence for the application-layer
        controls.
      </p>
      <ul>
        <li>
          A.5.7 Threat intelligence
          {": "}OpenSSF Scorecard, OSV-Scanner, CodeQL, Dependabot, and the
          published GHSA advisory flow feed the framework&apos;s own intel loop;
          downstream apps inherit the same signals through{" "}
          <code>create-daloy --with-ci</code>.
        </li>
        <li>
          A.5.23 Information security for use of cloud services
          {": "}runtime-parity audits keep behavior identical across Node, Bun,
          Deno, and Cloudflare Workers so the cloud provider is a deployment
          choice, not a security trade-off.
        </li>
        <li>
          A.5.30 ICT readiness for business continuity
          {": "}
          graceful shutdown, health endpoints, and lifecycle hooks (see{" "}
          <a href="/docs/security/lifecycle-health">Lifecycle &amp; health</a>).
        </li>
        <li>
          A.8.7 Protection against malware
          {": "}supply-chain controls listed above.
        </li>
        <li>
          A.8.8 Management of technical vulnerabilities
          {": "}the SLA table in SECURITY.md, GHSA flow, OpenSSF Scorecard,
          CodeQL, Dependabot.
        </li>
        <li>
          A.8.9 Configuration management
          {": "}secure defaults are enforced at boot (
          <a href="/docs/security/secure-defaults-enforcement">
            secureDefaults enforcement
          </a>
          ), not just documented.
        </li>
        <li>
          A.8.15 Logging
          {": "}structured logger, request-id correlation, PII redaction.
        </li>
        <li>
          A.8.16 Monitoring activities
          {": "}Server-Timing headers, OpenTelemetry spans, and the
          structured-log pipeline give downstream SIEM/observability tools the
          signals they need; rate-limit rejections, schema-validation failures,
          and JWT rejections all surface as discrete log events with a stable
          request-id.
        </li>
        <li>
          A.8.23 Web filtering
          {": "}
          <code>fetchGuard()</code> enforces an egress allow-list pattern from
          inside the app.
        </li>
        <li>
          A.8.24 Use of cryptography
          {": "}algorithm allow-listing on JWT/JWK; HMAC with algorithm-prefix
          parsing; timing-safe comparisons.
        </li>
        <li>
          A.8.25 Secure development lifecycle:{" "}
          <code>create-daloy --with-ci</code> ships CodeQL, Scorecard, zizmor,
          Dependabot, CODEOWNERS, and a <code>SECURITY.md</code> template.
        </li>
        <li>
          A.8.26 Application security requirements
          {": "}input validation through Zod/Valibot; OpenAPI contract
          enforcement before any handler runs.
        </li>
        <li>
          A.8.28 Secure coding
          {": "}documented patterns for SQL injection, command injection, SSRF,
          CSRF, prototype pollution.
        </li>
        <li>
          A.8.32 Change management
          {": "}SHA-pinned GitHub Actions (verified by{" "}
          <code>verify:actions-pinned</code>), a 24h{" "}
          <code>minimum-release-age</code> cooldown on dependencies,
          provenance-signed npm publishes, and the verify-* CI gates listed in{" "}
          <code>AGENTS.md</code> make every framework change an auditable,
          reviewable event.
        </li>
      </ul>

      <h2 id="hipaa-security-rule-45-cfr-164-312">
        HIPAA Security Rule (45 CFR § 164.312)
      </h2>
      <p>
        HIPAA cares about Protected Health Information (PHI) handled by Covered
        Entities and Business Associates. DaloyJS contributes to the{" "}
        <em>Technical Safeguards</em>
        {": "}
      </p>
      <ul>
        <li>
          § 164.312(a) Access Control
          {": "}unique user identification via session/JWT subject claim;
          automatic logoff via session TTL; encryption at the cookie layer with
          signed and rotated keys.
        </li>
        <li>
          § 164.312(b) Audit Controls
          {": "}structured logs with request-id, route, status, latency, and
          user-id (when authenticated) so a downstream log pipeline can satisfy
          retention and tamper-evidence requirements (those still need to be
          configured at the log sink).
        </li>
        <li>
          § 164.312(c) Integrity
          {": "}HMAC for webhook payloads; signed sessions; ETag/Last-Modified
          for optimistic concurrency on PHI mutations.
        </li>
        <li>
          § 164.312(d) Person or Entity Authentication
          {": "}
          first-party authentication helpers; tested integrations with AWS
          Cognito, Microsoft Entra ID, Auth0, Okta, and Clerk.
        </li>
        <li>
          § 164.312(e) Transmission Security
          {": "}HSTS and secure cookies by default; the actual TLS terminator
          (load balancer, CDN, platform) is out of the framework&apos;s scope.
        </li>
        <li>
          Practical PHI hygiene. Add field-level redaction in the logger for any
          field that carries PHI; do not log request bodies on PHI routes; keep
          the <code>session()</code> cookie <code>httpOnly</code> and{" "}
          <code>sameSite</code> (default behavior).
        </li>
      </ul>

      <h2 id="gdpr-regulation-2016-679">GDPR (Regulation 2016/679)</h2>
      <p>
        GDPR is risk-based; Article 32 (&ldquo;security of processing&rdquo;)
        and Article 25 (&ldquo;data protection by design and by default&rdquo;)
        are where the framework helps most.
      </p>
      <ul>
        <li>
          Article 5(1)(f) integrity &amp; confidentiality
          {": "}
          secure headers, signed sessions, schema-validated inputs, structured
          logs with redaction.
        </li>
        <li>
          Article 25 data protection by design and by default
          {": "}
          secure-by-default body limits, request timeouts, content-type
          allow-listing, and CSRF/cors defaults; the auditor sees that the
          insecure paths are <em>opt-in</em>
          {", "}not the other way around.
        </li>
        <li>
          Article 30 records of processing
          {": "}OpenAPI is generated from the routes themselves, which gives a
          machine-readable inventory of every endpoint that touches personal
          data. Pair it with a tagging convention (e.g.{" "}
          <code>x-daloy-data-classes: [&quot;email&quot;, &quot;ip&quot;]</code>
          ) so the same spec answers ROPA questions.
        </li>
        <li>
          Article 32 security of processing
          {": "}the &ldquo;Shared technical controls&rdquo; table above is the
          short answer for the application layer; pseudonymization, encryption
          at rest, and key management still live at the data store.
        </li>
        <li>
          Article 33 breach notification (within 72 hours)
          {": "}the request-id and structured-log primitives make it possible to
          reconstruct affected sessions; the published CVSS-keyed patch SLA lets
          controllers describe the &ldquo;measures taken&rdquo; section of their
          breach notification with real numbers rather than aspirations.
        </li>
        <li>
          Logging PII responsibly. The logger&apos;s default redaction (
          <code>DEFAULT_REDACT_KEYS</code> via{" "}
          <code>createLogger({"{ redact }"})</code>) already masks well-known
          secret keys (passwords, tokens, API keys). Request URLs written by the
          framework go through <code>sanitizeUrlForLog</code> so OAuth codes,
          access tokens, and signed-URL signatures in query strings do not land
          in durable logs under the field name <code>url</code>
          {". "}Extend the redaction list for application-specific PII fields
          and never log raw request bodies on routes that process personal data.
        </li>
      </ul>

      <h2 id="pci-dss-v4-0-software-side-controls">
        PCI-DSS v4.0 (software-side controls)
      </h2>
      <p>
        DaloyJS&apos;s payments documentation already calls out the SAQ scope
        consequences of touching a Primary Account Number (PAN) directly. The
        framework helps with the software-side requirements of v4.0:
      </p>
      <ul>
        <li>
          Req 2 secure configurations
          {": "}secure-by-default headers, content-type allow-listing, and the
          boot guards that fail-closed on insecure config.
        </li>
        <li>
          Req 4 strong cryptography in transit
          {": "}HSTS via <code>secureHeaders()</code>.
        </li>
        <li>
          Req 6.2 secure software development
          {": "}schema-validated inputs, prototype-pollution-safe JSON parsing,
          header sanitization, path-traversal-safe router, prepared-statement
          guidance for every ORM in{" "}
          <a href="/docs/security/sql-injection">SQL injection</a>.
        </li>
        <li>
          Req 6.3 manage vulnerabilities
          {": "}SECURITY.md SLA, GHSA evidence, dependency-graph monitoring.
        </li>
        <li>
          Req 6.4 protect public-facing web applications
          {": "}CSRF, secure headers, rate limiting, request-id correlation.
        </li>
        <li>
          Req 8 strong authentication
          {": "}first-party session/JWT helpers with algorithm allow-listing.
        </li>
        <li>
          Req 10 log and monitor
          {": "}structured logs with per-request correlation IDs; the retention
          and tamper-evidence obligations live at the log sink.
        </li>
        <li>
          SAQ scope. The strongest control here is{" "}
          <em>not seeing the PAN at all</em>
          {". "}The payments docs (Stripe, Braintree, Authorize.Net, Square)
          document the redirect, hosted checkout, and hosted-fields patterns
          that keep you in SAQ-A or SAQ-A-EP rather than SAQ-D.
        </li>
      </ul>

      <h2 id="nis2-directive-eu-2022-2555-and-the-eu-cra">
        NIS2 (Directive (EU) 2022/2555) and the EU CRA
      </h2>
      <p>
        NIS2 Article 21 lists the cybersecurity risk-management measures
        essential and important entities must adopt. The Cyber Resilience Act
        adds analogous obligations on the vendor side. Both increasingly show up
        as upstream patch-SLA clauses in procurement.
      </p>

      <h3 id="are-you-in-scope-nis2-self-assessment">
        Are you in scope? (NIS2 self-assessment)
      </h3>
      <p>
        DaloyJS itself is open-source framework software and is not a regulated
        entity. NIS2 obligations attach to the operator running the service, not
        to the framework author. So the first question for any team building on
        Daloy is whether the directive applies to <em>them</em>
        {". "}Aikido&apos;s{" "}
        <a
          href="https://www.aikido.dev/blog/nis2-who-is-affected"
          target="_blank"
          rel="noreferrer"
        >
          &ldquo;NIS2: Who is affected?&rdquo;
        </a>{" "}
        write-up summarizes the sector and size tests; the checklist below is
        the operator-friendly version, oriented around the workloads people
        actually build with this framework.
      </p>
      <p>
        You are likely in scope if <strong>all three</strong> of the following
        are true:
      </p>
      <ol>
        <li>
          You operate in the EU. NIS2 applies to entities providing services{" "}
          <em>in</em> the Union, even when the entity itself is established
          outside the EU (Article 26 establishment rules apply for cloud, data
          centers, CDN, managed services, MSSPs, online marketplaces, online
          search, social networks, and DNS providers).
        </li>
        <li>
          Your sector is named in Annex I or Annex II.{" "}
          <em>Annex I (essential, &ldquo;high criticality&rdquo;)</em> covers
          energy, transport, banking, financial market infrastructure, health,
          drinking water, waste water, digital infrastructure (IXPs, DNS, TLDs,
          cloud computing, data center services, CDN, trust services, electronic
          communications), ICT service management (B2B, including MSPs and
          MSSPs), and public administration.{" "}
          <em>Annex II (important, &ldquo;other critical&rdquo;)</em> covers
          postal &amp; courier, waste management, manufacture and distribution
          of chemicals, food production/processing/distribution, manufacturing
          (medical devices, computers/electronics, electrical equipment,
          machinery, motor vehicles, other transport equipment), digital
          providers (online marketplaces, online search engines, social
          networks), and research organisations.
        </li>
        <li>
          You meet the size threshold (medium-sized or larger per the EU
          2003/361 SME definition): <strong>&ge; 50 staff</strong> or{" "}
          <strong>&gt; &euro;10 million</strong> annual turnover <em>or</em>{" "}
          balance sheet. Smaller entities can also be pulled in regardless of
          size when they are a sole provider in a member state, when a
          disruption would have a significant impact on public safety / security
          / health, when they are a qualified trust service provider, TLD name
          registry, DNS service provider, or public electronic communications
          provider, or when the member state has designated them as critical
          under Article 2(2). Public administration entities are in scope under
          separate Article 2(2)(f) rules.
        </li>
      </ol>
      <p>
        The two tiers carry different penalty caps and supervisory regimes:{" "}
        <strong>essential entities</strong> face up to{" "}
        <strong>&euro;10 M or 2% of global annual turnover</strong> (whichever
        is higher) and ex-ante supervision; <strong>important entities</strong>{" "}
        face up to <strong>&euro;7 M or 1.4% of global annual turnover</strong>{" "}
        and ex-post supervision. Article 20 also makes{" "}
        <strong>management bodies personally accountable</strong> for approving
        the risk-management measures and undergoing cybersecurity training. That
        is the clause that has been generating the most attention, because the
        responsibility cannot be delegated to the security team. Member-state
        transposition deadline was <strong>17 October 2024</strong>; most member
        states have since published national laws with their own registration
        and reporting portals (the national CSIRT and the single-entry point
        under Article 23(4)).
      </p>
      <p>
        If you concluded you are in scope, the Article 21 measure list below
        plus the EU CRA evidence pack further down are what you point your own
        auditor at for the framework layer. Most workloads built on Daloy land
        in Annex I &ldquo;digital infrastructure&rdquo; (cloud / data center /
        CDN), Annex I &ldquo;ICT service management&rdquo; (MSP / MSSP), or
        Annex II &ldquo;digital providers&rdquo; (online marketplace / search /
        social network). The technical controls in this page were built
        specifically so a team in those sectors does not have to reconstruct the
        framework-layer evidence from scratch.
      </p>

      <h3 id="article-21-risk-management-measures-framework-layer-mapping">
        Article 21 risk-management measures (framework-layer mapping)
      </h3>
      <ul>
        <li>
          Article 20 governance (management body approves the risk-management
          measures and undergoes cybersecurity training)
          {": "}an organizational obligation on the consumer (cannot be
          delegated to the security team). The framework layer makes the
          underlying evidence reviewable: every guardrail listed below lives in
          source and is enforced by <code>pnpm verify:*</code>
          {", "}so the management body can be shown version-pinned, auditable
          proof rather than a slide deck.
        </li>
        <li>
          Article 21(2)(a) policies on risk analysis and security of information
          systems
          {": "}the secure-by-default baseline plus the boot-guard enforcement.
        </li>
        <li>
          Article 21(2)(b) incident handling
          {": "}SECURITY.md publishes the response targets, escalation contacts,
          and GHSA evidence format.
        </li>
        <li>
          Article 21(2)(d) supply-chain security
          {": "}npm provenance, SBOM, SHA-pinned third-party Actions,
          lockfile-source verification, <code>ignore-scripts</code> by default
          in scaffolded projects.
        </li>
        <li>
          Article 21(2)(e) security in network and information systems
          acquisition, development, and maintenance
          {": "}the CI bundle from <code>create-daloy --with-ci</code> turns
          CodeQL, Scorecard, zizmor, Dependabot, and CODEOWNERS on out of the
          box.
        </li>
        <li>
          Article 21(2)(g) basic cyber hygiene practices
          {": "}
          documented patterns for sessions, CSRF, SSRF, SQL/command injection,
          and admin-panel hardening; opinionated runtime protections.
        </li>
        <li>
          Article 21(2)(h) use of cryptography
          {": "}algorithm allow-listing, timing-safe comparisons, HMAC algorithm
          prefix parsing.
        </li>
        <li>
          Article 23 incident reporting (24 h early warning, 72 h notification,
          1-month final report to the national CSIRT or competent authority)
          {": "}this is the consumer&apos;s obligation, but the framework ships
          the technical substrate: per-request structured logs with correlated
          request IDs, OpenTelemetry-shaped spans, and plugin lifecycle hooks
          (rate-limit, auth-failure, SSRF-block, body-limit, timeout,{" "}
          <code>onShutdown</code>) suitable for feeding the regulator-facing
          notification pipeline within the statutory window.
        </li>
        <li>
          EU CRA upstream patch SLA
          {": "}the CVSS-keyed table in <code>SECURITY.md</code> is written
          specifically so downstream procurement can quote it verbatim.
        </li>
      </ul>

      <h3 id="eu-cyber-resilience-act-regulation-eu-2024-2847">
        EU Cyber Resilience Act (Regulation (EU) 2024/2847)
      </h3>
      <p>
        The{" "}
        <a
          href="https://eur-lex.europa.eu/eli/reg/2024/2847/oj"
          target="_blank"
          rel="noreferrer"
        >
          Cyber Resilience Act
        </a>{" "}
        places binding obligations on the manufacturer of any &ldquo;product
        with digital elements&rdquo; sold into the EU. DaloyJS itself is free
        open-source software (the CRA exempts non-commercial OSS development
        from manufacturer liability under Recital 16 / Article 3(18)), but a
        downstream commercial product that integrates <code>@daloyjs/core</code>{" "}
        inherits the obligation to demonstrate Annex I conformity for the
        integrated framework. The full requirement-by-requirement evidence pack
        lives in{" "}
        <a
          href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md#eu-cyber-resilience-act-cra-mapping"
          target="_blank"
          rel="noreferrer"
        >
          <code>
            SECURITY.md &rarr; &ldquo;EU Cyber Resilience Act mapping&rdquo;
          </code>
        </a>
        {"; "}the table below is the operator-friendly summary.
      </p>
      <p>
        The two deadlines that matter for downstream consumers:{" "}
        <strong>2026-09-11</strong> (24-hour reporting of actively exploited
        vulnerabilities to ENISA and the national CSIRT, CRA Article 14) and{" "}
        <strong>2027-12-11</strong> (full Annex I conformity before a product
        may bear the CE mark, CRA Article 13). DaloyJS commits upstream to both.
      </p>
      <table>
        <thead>
          <tr>
            <th>CRA requirement</th>
            <th>DaloyJS evidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Annex I (1)(a), no known exploitable vulnerabilities on release
            </td>
            <td>
              <code>pnpm audit --audit-level=high</code> in CI and pre-publish;
              daily <code>pnpm audit --prod</code> against <code>main</code>;
              zero runtime deps in <code>@daloyjs/core</code>.
            </td>
          </tr>
          <tr>
            <td>Annex I (1)(b), secure-by-default configuration</td>
            <td>
              Body cap (1 MiB), 30 s request timeout,{" "}
              <code>secureHeaders()</code>
              {", "}
              <code>fetchGuard()</code> default-denying SSRF against
              cloud-metadata IPs, prototype-pollution stripping in every parser,
              real <code>405</code>
              {", "}problem+json 5xx detail redaction in production. Scaffolded
              projects inherit <code>ignore-scripts=true</code> +{" "}
              <code>minimum-release-age=1440</code>.
            </td>
          </tr>
          <tr>
            <td>
              Annex I (1)(c), security updates independent of feature updates
            </td>
            <td>
              SemVer patch releases are reserved for security and regression
              fixes; consumers pinned with <code>^@daloyjs/core</code> get
              patches via <code>pnpm update</code> or Dependabot without code
              changes.
            </td>
          </tr>
          <tr>
            <td>Annex I (1)(d), authentication and access control</td>
            <td>
              First-party <code>bearerAuth</code>
              {", "}
              <code>basicAuth</code>
              {", "}
              <code>jwk()</code> (PS256 / RS256 / ES256 / EdDSA, JWKS rotation
              with <code>kid</code> pinning), signed-cookie{" "}
              <code>session()</code>
              {", "}
              <code>timingSafeEqual()</code>; the{" "}
              <code>pnpm verify:secret-comparisons</code> gate rejects every
              short-circuiting comparison against header-derived values.
            </td>
          </tr>
          <tr>
            <td>
              Annex I (1)(h), resilience against and mitigation of DoS attacks
            </td>
            <td>
              Core body cap, per-handler timeouts, first-party{" "}
              <code>rateLimit()</code> with optional Redis store,{" "}
              <code>loadShedding()</code> for concurrency caps, multipart
              per-field byte cap. Network-layer DoS is the operator&apos;s WAF /
              CDN.
            </td>
          </tr>
          <tr>
            <td>
              Annex I (1)(j), limit attack surface and external interfaces
            </td>
            <td>
              Tarball whitelist (<code>dist/</code> + <code>bin/</code> +{" "}
              <code>README.md</code>); no template engine, no string-eval, no
              shell helper in core; <code>pnpm verify:no-remote-exec</code>{" "}
              refuses <code>child_process</code> / <code>vm</code> /{" "}
              <code>eval</code> / <code>new Function</code> / remote dynamic{" "}
              <code>import()</code> in <code>src/**</code>.
            </td>
          </tr>
          <tr>
            <td>
              Annex I Part II (2)(1), SBOM in a commonly used, machine-readable
              format covering at least top-level dependencies
            </td>
            <td>
              Every published tarball ships <code>dist/sbom.cdx.json</code>{" "}
              (CycloneDX 1.5) and <code>dist/sbom.spdx.json</code> (SPDX 2.3);
              generated by <code>scripts/generate-sbom.ts</code> and locked at
              release time by <code>pnpm verify:sbom</code>.
            </td>
          </tr>
          <tr>
            <td>
              Annex I Part II (2)(2), remediate vulnerabilities without delay
            </td>
            <td>
              CVSS-keyed upstream patch SLA: <strong>48 h</strong> Critical,{" "}
              <strong>7 d</strong> High, <strong>30 d</strong> Medium,{" "}
              <strong>90 d</strong> Low, measured from triage.
            </td>
          </tr>
          <tr>
            <td>
              Annex I Part II (2)(4), public disclosure of fixed vulnerabilities
            </td>
            <td>
              Every confirmed vulnerability is published as a{" "}
              <a
                href="https://github.com/daloyjs/daloy/security/advisories"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Security Advisory
              </a>{" "}
              with a CVE requested through GitHub&apos;s CNA, carrying the
              Discovered / Patch available / Fix deployed timestamps NIS2 and
              CRA conformity dossiers expect.
            </td>
          </tr>
          <tr>
            <td>
              Annex I Part II (2)(5), policy on coordinated vulnerability
              disclosure (CVD)
            </td>
            <td>
              Discoverable at{" "}
              <a
                href="https://daloyjs.dev/.well-known/security.txt"
                target="_blank"
                rel="noreferrer"
              >
                <code>https://daloyjs.dev/.well-known/security.txt</code>
              </a>{" "}
              (RFC 9116); points at the GitHub private-disclosure form and back
              at <code>SECURITY.md</code>
              {". "}Disclosure rotation is named in{" "}
              <code>SECURITY-CONTACTS.md</code> and tested quarterly
              (audit-gated by <code>pnpm verify:governance-audits</code>).
            </td>
          </tr>
          <tr>
            <td>Annex I Part II (2)(7), secure update distribution</td>
            <td>
              npm over HTTPS with <code>--provenance</code> Sigstore
              attestations bound to the <code>release.yml</code> workflow run on
              the Rekor transparency log; consumers can verify the provenance
              without trusting any vendor portal.
            </td>
          </tr>
          <tr>
            <td>
              Article 14, 24-hour reporting of actively exploited
              vulnerabilities to ENISA
            </td>
            <td>
              From 2026-09-11 the maintainer rotation triages actively-exploited
              reports best-effort within 24 h and files the early-warning
              notification with ENISA via the Single Reporting Platform,
              followed by a 72 h CVSS / scope update, even when a patch is not
              yet available. See the{" "}
              <a
                href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md#article-14--24-hour-reporting-of-actively-exploited-vulnerabilities-and-severe-incidents"
                target="_blank"
                rel="noreferrer"
              >
                full Article 14 notification chain
              </a>{" "}
              in <code>SECURITY.md</code>.
            </td>
          </tr>
          <tr>
            <td>
              Article 13(8), declared support period (regulatory floor: 5 years)
            </td>
            <td>
              DaloyJS commits to a{" "}
              <strong>minimum 5-year security-update support period</strong> for
              every stable major release line, measured from that line&apos;s
              first stable release.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>
          This mapping is informational and is not a legal opinion. A downstream
          conformity assessment for a CE-marked product remains the
          integrator&apos;s responsibility; the evidence above exists so the
          framework layer of that dossier does not have to be reconstructed from
          scratch.
        </em>
      </p>

      <h2 id="uk-cyber-security-and-resilience-bill-csr-bill">
        UK Cyber Security and Resilience Bill (CSR Bill)
      </h2>
      <p>
        The UK government&apos;s{" "}
        <a
          href="https://www.gov.uk/government/publications/cyber-security-and-resilience-bill-policy-statement/cyber-security-and-resilience-bill-policy-statement"
          target="_blank"
          rel="noreferrer"
        >
          Cyber Security and Resilience Bill
        </a>{" "}
        updates the UK&apos;s NIS Regulations 2018, brings managed service
        providers (MSPs) and certain digital service providers into scope,
        introduces supply-chain duties for operators of essential services (OES)
        and relevant digital service providers (RDSPs), and tightens incident
        reporting to a two-stage <strong>24 h early warning</strong> plus{" "}
        <strong>72 h follow-up</strong> aligned with EU NIS2. Technical and
        methodological requirements are expected to track the{" "}
        <a
          href="https://www.ncsc.gov.uk/collection/cyber-assessment-framework"
          target="_blank"
          rel="noreferrer"
        >
          NCSC Cyber Assessment Framework (CAF)
        </a>{" "}
        Basic and Enhanced profiles.
      </p>
      <p>
        DaloyJS itself is open-source framework software (it is not an MSP, OES,
        RDSP, or designated critical supplier), but apps built on it routinely
        fall into scope. The table below maps each measure from the April 2025
        policy statement to the DaloyJS primitives a regulated team can point at
        on day one. Because the CSR Bill is closely modeled on NIS2 Article 21,
        the EU CRA evidence above also carries over almost line-for-line.
      </p>
      <table>
        <thead>
          <tr>
            <th>CSR Bill measure / CAF principle</th>
            <th>DaloyJS evidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Measure 1.2: supply-chain security duties for OES / RDSPs and
              designated critical suppliers
            </td>
            <td>
              Zero runtime dependencies in <code>@daloyjs/core</code> (enforced
              by <code>pnpm verify:no-runtime-deps</code>); npm provenance via
              Sigstore; CycloneDX SBOM published with every release;{" "}
              <code>verify:lockfile</code> refuses non-npm registry origins and
              known-bad <code>name@version</code> IOCs; SHA-pinned third-party
              GitHub Actions audited by <code>verify-actions-pinned</code>;
              scaffolded projects ship <code>ignore-scripts=true</code> +{" "}
              <code>minimum-release-age=1440</code> in <code>_npmrc</code> to
              shrink the install-time blast radius from compromised upstream
              suppliers.
            </td>
          </tr>
          <tr>
            <td>
              Measure 2.1: technical and methodological security requirements
              (NCSC CAF Basic / Enhanced)
            </td>
            <td>
              <strong>CAF B2 Identity &amp; access control</strong>:{" "}
              <code>bearerAuth()</code>
              {", "}
              <code>basicAuth()</code>
              {", "}signed-cookie <code>session()</code>
              {", "}JWT with algorithm allow-listing, IP allowlists.{" "}
              <strong>CAF B3 Data security</strong>:{" "}
              <code>secureHeaders()</code> (HSTS, CSP nonce + Trusted Types,
              COOP, CORP), prod-mode RFC 9457 redaction.{" "}
              <strong>CAF B4 System security</strong>:{" "}
              <code>bodyLimitBytes</code>
              {", "}
              <code>requestTimeoutMs</code>
              {", "}
              <code>rateLimit()</code>
              {", "}
              <code>fetchGuard()</code> default-deny SSRF,
              prototype-pollution-safe parsers, CRLF/NUL header rejection,{" "}
              <code>.strict()</code> schemas.{" "}
              <strong>CAF B5 Resilient networks &amp; systems</strong>
              {": "}graceful shutdown, load shedding, plugin lifecycle events.{" "}
              <strong>CAF B6 Staff awareness &amp; training</strong> remains an
              organizational control.
            </td>
          </tr>
          <tr>
            <td>
              Measure 2.2: expanded incident reporting (24 h early warning + 72
              h report, confidentiality / availability / integrity)
            </td>
            <td>
              Per-request structured logs with correlated request IDs and
              Server-Timing; OpenTelemetry-shaped spans without taking a hard
              dependency on <code>@opentelemetry/api</code>; plugin lifecycle
              hooks (<code>onPluginInstalled</code>
              {", "}
              <code>onShutdown</code>) suitable for wiring rate-limit /
              auth-failure / SSRF-block / body-limit / timeout events into the
              regulator + NCSC notification pipeline within the statutory
              window.
            </td>
          </tr>
          <tr>
            <td>
              Measure 2.2: transparency duty toward affected customers of a
              digital service
            </td>
            <td>
              Coordinated vulnerability disclosure published at{" "}
              <a
                href="https://daloyjs.dev/.well-known/security.txt"
                target="_blank"
                rel="noreferrer"
              >
                <code>/.well-known/security.txt</code>
              </a>{" "}
              (RFC 9116); every confirmed vulnerability published as a GitHub
              Security Advisory with Discovered / Patch available / Fix deployed
              timestamps; CVSS-keyed upstream patch SLAs in{" "}
              <code>SECURITY.md</code> a downstream RDSP can quote verbatim in
              their own customer notice.
            </td>
          </tr>
          <tr>
            <td>
              Cross-cutting: secure software development lifecycle expected of
              suppliers to OES / RDSPs
            </td>
            <td>
              <code>create-daloy --with-ci</code> turns CodeQL, OSSF Scorecard,
              zizmor, Dependabot, gitleaks, and CODEOWNERS on out of the box;
              the repo&apos;s own <code>pnpm verify:*</code> bundle (parity,
              governance, routing-hardening, secret comparisons, no-remote-exec,
              no-registry-exfiltration, no-encoded-payloads,
              no-invisible-unicode, no-weak-random, no-unsafe-buffer,
              no-leaked-credentials, no-vulnerable-sandboxes,
              no-lifecycle-scripts, lockfile-sources, no-runtime-deps,
              dep-licenses, SBOM) gates every release.
            </td>
          </tr>
          <tr>
            <td>
              Cross-cutting: secure-by-default posture so the regulator&apos;s
              &ldquo;appropriate and proportionate&rdquo; test is met from the
              first deploy
            </td>
            <td>
              All hardening above is on by default. Per project policy (see{" "}
              <code>AGENTS.md</code>), <code>secureHeaders</code>
              {", "}
              <code>requestId</code>
              {", "}
              <code>rateLimit</code>
              {", "}
              <code>bodyLimitBytes</code>
              {", "}
              <code>requestTimeoutMs</code>
              {", "}
              <code>fetchGuard</code>
              {", "}JWT algorithm allowlists, timing-safe credential
              comparisons, schema <code>.strict()</code>
              {", "}
              response-body validation, prod-mode error redaction, and the
              scaffolded <code>_gitignore</code> / <code>_npmrc</code> defaults
              must not be silently weakened.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>
          Status: the CSR Bill was outlined in the King&apos;s Speech 2024 and
          the policy statement was presented to Parliament in April 2025; duties
          will be set in secondary legislation and statutory instruments after
          Royal Assent. This mapping reflects the policy statement as published
          and will be updated when the Bill is enacted and the technical
          requirements (expected to track NCSC CAF) are codified.
        </em>
      </p>

      <h2 id="dora-regulation-eu-2022-2554">
        DORA (Regulation (EU) 2022/2554)
      </h2>
      <p>
        The{" "}
        <a
          href="https://eur-lex.europa.eu/eli/reg/2022/2554/oj"
          target="_blank"
          rel="noreferrer"
        >
          Digital Operational Resilience Act
        </a>{" "}
        has applied to EU financial entities and their ICT third-party service
        providers since <strong>17 January 2025</strong>
        {". "}It is built on five pillars: ICT risk management (Chapter II),
        ICT-related incident management, classification, and reporting (Chapter
        III), digital operational resilience testing (Chapter IV), management of
        ICT third-party risk (Chapter V), and information-sharing arrangements
        (Chapter VI). The technical detail lives in the Commission&apos;s
        Regulatory Technical Standards, most notably{" "}
        <a
          href="https://eur-lex.europa.eu/eli/reg_del/2024/1774/oj"
          target="_blank"
          rel="noreferrer"
        >
          Delegated Regulation (EU) 2024/1774
        </a>{" "}
        on ICT risk-management tools and{" "}
        <a
          href="https://eur-lex.europa.eu/eli/reg_del/2024/1773/oj"
          target="_blank"
          rel="noreferrer"
        >
          Delegated Regulation (EU) 2024/1773
        </a>{" "}
        on subcontracting arrangements.
      </p>
      <p>
        DaloyJS itself is open-source framework software, not a regulated
        financial entity and not (on its own) a designated &ldquo;critical ICT
        third-party service provider&rdquo; under Article 31. But apps built on
        DaloyJS routinely <em>are</em> the ICT systems that DORA applies to, and
        the framework layer is something a financial-entity team or its ICT-TPP
        supplier must be able to point at during a Joint Examination Team
        review. Because DORA&apos;s technical control families overlap heavily
        with NIS2 Article 21 and the EU CRA Annex I, most of the evidence above
        carries over directly. The table below summarizes the DORA-specific
        framing.
      </p>
      <table>
        <thead>
          <tr>
            <th>DORA requirement</th>
            <th>DaloyJS evidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Article 6: sound, comprehensive, and well-documented ICT
              risk-management framework
            </td>
            <td>
              Secure-by-default baseline (body cap, request timeout,{" "}
              <code>secureHeaders()</code>
              {", "}
              <code>fetchGuard()</code>
              {", "}JWT algorithm allow-listing, timing-safe credential
              comparisons, <code>.strict()</code> schemas, RFC 9457 problem+json
              with prod redaction) all live in source, are version-pinned, and
              are enforced by the <code>pnpm verify:*</code> bundle so the
              control evidence is reproducible at any commit.
            </td>
          </tr>
          <tr>
            <td>
              Article 8: identification of ICT-supported business functions and
              their dependencies
            </td>
            <td>
              <code>openapi.json</code> is the canonical, generated inventory of
              every public route, its inputs, its response shape, and its auth
              requirements. Combined with the CycloneDX{" "}
              <code>dist/sbom.cdx.json</code> shipped in every release tarball,
              it gives auditors a machine-readable dependency map for the
              framework layer.
            </td>
          </tr>
          <tr>
            <td>
              Article 9: protection and prevention (including authentication,
              access control, cryptography, network segmentation)
            </td>
            <td>
              First-party <code>bearerAuth</code>
              {", "}
              <code>basicAuth</code>
              {", "}
              signed-cookie <code>session()</code>
              {", "}
              <code>jwk()</code> with algorithm allow-listing and JWKS rotation,{" "}
              <code>ipRestriction()</code>
              {", "}
              <code>fetchGuard()</code> default-deny SSRF against cloud metadata
              IPs, HMAC algorithm prefix parsing, and the{" "}
              <code>verify:secret-comparisons</code> gate that rejects
              short-circuiting comparisons against header-derived values.
            </td>
          </tr>
          <tr>
            <td>
              Article 10: detection of anomalous activities and ICT-related
              incidents
            </td>
            <td>
              Per-request structured logs with correlated request IDs and
              Server-Timing; OpenTelemetry-shaped spans without a hard
              dependency on <code>@opentelemetry/api</code>; plugin lifecycle
              hooks (rate-limit, auth-failure, SSRF-block, body-limit, timeout,{" "}
              <code>onShutdown</code>) that operators can wire into a SIEM or
              the financial-entity SOC pipeline.
            </td>
          </tr>
          <tr>
            <td>
              Article 11: response and recovery (business continuity, graceful
              degradation)
            </td>
            <td>
              First-party graceful shutdown with in-flight request draining,{" "}
              <code>loadShedding()</code> for concurrency caps,{" "}
              <code>rateLimit()</code> with optional Redis store for shared
              counters across replicas, multi-runtime adapters (Node, Bun, Deno,
              Cloudflare Workers, Vercel) so the same app can fail over between
              platforms without rewrites.
            </td>
          </tr>
          <tr>
            <td>
              Article 17&ndash;19: ICT-related incident management,
              classification, and reporting (initial notification, intermediate
              report, final report)
            </td>
            <td>
              Structured logs and lifecycle events are the technical substrate
              the financial entity needs to meet the regulatory timetable;{" "}
              <code>SECURITY.md</code> publishes the upstream framework response
              targets, the GHSA evidence pattern, and the rotation in{" "}
              <code>SECURITY-CONTACTS.md</code> (audit-gated by{" "}
              <code>pnpm verify:governance-audits</code>) so the financial
              entity&apos;s own incident submission can quote the framework
              layer verbatim.
            </td>
          </tr>
          <tr>
            <td>
              Article 24&ndash;25: digital operational resilience testing
              programme; testing of ICT tools and systems
            </td>
            <td>
              CI runs on Node 24 (<code>node-version: 24</code> in{" "}
              <code>ci.yml</code> / <code>release.yml</code>; package{" "}
              <code>engines.node</code> is <code>^24 || &gt;=26</code>). Every
              change runs <code>pnpm typecheck</code>
              {", "}
              <code>pnpm test</code>
              {", "}
              <code>pnpm coverage</code> (90% lines / 90% functions on the tsx
              run), and <code>pnpm coverage:branches</code> (92% branches on
              compiled JS). Multi-runtime adapters are guarded by{" "}
              <code>verify:runtime-parity-audits</code> (not a Bun/Deno test
              matrix on every PR). The <code>verify:parity-audits</code>
              {", "}
              <code>verify:routing-hardening-audits</code>
              {", "}and <code>verify:governance-audits</code> gates are
              reproducible by any downstream resilience-testing programme. Bench
              harnesses under <code>bench/</code> give a baseline for
              performance regression testing.
            </td>
          </tr>
          <tr>
            <td>
              Article 28: general principles for sound management of ICT
              third-party risk (including the register of contractual
              arrangements in Article 28(3))
            </td>
            <td>
              Zero runtime dependencies in <code>@daloyjs/core</code> (enforced
              by <code>pnpm verify:no-runtime-deps</code>) keeps the third-party
              register short; CycloneDX + SPDX SBOMs shipped per release;{" "}
              <code>verify:lockfile</code> refuses non-npm registry origins and
              known-bad <code>name@version</code> IOCs;{" "}
              <code>verify:dep-licenses</code> blocks copyleft drift. The
              framework itself does not call any external network endpoint at
              startup or runtime.
            </td>
          </tr>
          <tr>
            <td>
              Article 30: key contractual provisions (security, incident
              reporting cooperation, audit rights, exit strategy)
            </td>
            <td>
              Contractual / commercial terms are the financial entity&apos;s
              responsibility. The framework layer makes the underlying evidence
              feasible: npm provenance via Sigstore + Rekor transparency log
              lets the entity verify exactly which CI run built a given version
              without trusting a vendor portal; the published GHSA feed and
              CVSS-keyed SLA table give the cooperation timetable a regulator
              expects to see referenced.
            </td>
          </tr>
          <tr>
            <td>
              Annex II of RTS 2024/1774: ICT security policies, procedures,
              protocols, and tools (including secure configuration,
              vulnerability management, encryption, cryptographic-key
              management, identity and access management)
            </td>
            <td>
              Per project policy (see <code>AGENTS.md</code>),{" "}
              <code>secureHeaders</code>
              {", "}
              <code>requestId</code>
              {", "}
              <code>rateLimit</code>
              {", "}
              <code>bodyLimitBytes</code>
              {", "}
              <code>requestTimeoutMs</code>
              {", "}
              <code>fetchGuard</code>
              {", "}JWT algorithm allowlists, timing-safe credential
              comparisons, schema <code>.strict()</code>
              {", "}response-body validation, prod-mode error redaction, and the
              scaffolded <code>_gitignore</code> / <code>_npmrc</code> defaults
              must not be silently weakened. Key material (JWKS, cookie keys) is
              rotated by configuration, not by code change.
            </td>
          </tr>
          <tr>
            <td>
              Article 45: arrangements for the exchange of cyber-threat
              information and intelligence
            </td>
            <td>
              Every confirmed vulnerability is published as a{" "}
              <a
                href="https://github.com/daloyjs/daloy/security/advisories"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Security Advisory
              </a>{" "}
              with a CVE through GitHub&apos;s CNA, plus a coordinated
              disclosure entry-point at{" "}
              <a
                href="https://daloyjs.dev/.well-known/security.txt"
                target="_blank"
                rel="noreferrer"
              >
                <code>/.well-known/security.txt</code>
              </a>{" "}
              (RFC 9116). Financial-sector ISACs (e.g. FS-ISAC) can subscribe to
              the GHSA feed directly.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>
          This mapping is informational and is not a legal opinion. DORA
          conformity for a regulated financial entity or for a designated
          critical ICT third-party service provider remains the operator&apos;s
          responsibility; the evidence above exists so the framework layer of
          that dossier does not have to be reconstructed from scratch. Critical
          ICT third-party service provider designation (Article 31) and the
          resulting Lead Overseer oversight regime are out of scope for an
          open-source framework.
        </em>
      </p>

      <h2 id="operator-responsibilities-the-framework-cannot-cover">
        Operator responsibilities the framework cannot cover
      </h2>
      <p>
        Be upfront about this when you talk to your auditor, because conflating
        application controls with platform or organizational controls is the
        fastest way to lose credibility:
      </p>
      <ul>
        <li>
          TLS termination, key management, KMS/HSM choice live at your load
          balancer, CDN, or platform.
        </li>
        <li>
          Encryption at rest, backup, disaster recovery live at the data store
          and infrastructure layer.
        </li>
        <li>
          Identity provider, MFA enrollment, account recovery live at the IdP
          (Cognito, Entra ID, Auth0, Okta, Clerk). The framework consumes the
          resulting tokens; it does not run the IdP.
        </li>
        <li>
          Log retention, immutability, SIEM forwarding live at the log sink. The
          framework emits the structured logs; how long they live and who can
          delete them is a pipeline concern.
        </li>
        <li>
          Vendor management, employee training, access reviews, background
          checks, physical security are organizational controls. No framework
          can produce evidence for those.
        </li>
        <li>
          Data-processing agreements, standard contractual clauses, transfer
          impact assessments are legal artifacts.
        </li>
      </ul>

      <h2 id="suggested-artifact-pack-for-an-audit">
        Suggested artifact pack for an audit
      </h2>
      <ol>
        <li>
          The generated <code>openapi.json</code> as the canonical inventory of
          every public endpoint.
        </li>
        <li>
          The <code>sbom.json</code> emitted by{" "}
          <code>scripts/generate-sbom.ts</code> for the framework version you
          ship.
        </li>
        <li>
          Your own application&apos;s lockfile plus a recent{" "}
          <code>pnpm audit --prod</code> output.
        </li>
        <li>
          The release&apos;s npm provenance attestation (visible on the package
          page) and the matching GitHub Security Advisory entries.
        </li>
        <li>
          A short README mapping your routes to data classes (PII / PHI /
          cardholder data / none) so the auditor can verify the redaction
          configuration matches reality.
        </li>
      </ol>

      <h2 id="further-reading">Further reading</h2>
      <ul>
        <li>
          <a href="/docs/security/secure-defaults">Secure-by-default</a>
          {": "}what the core enforces without any opt-in.
        </li>
        <li>
          <a href="/docs/security/supply-chain">Supply-chain security</a>
          {": "}the controls behind the SOC 2 CC6.8 / ISO A.8.7 / NIS2 21(2)(d)
          rows above.
        </li>
        <li>
          <a
            href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md"
            target="_blank"
            rel="noreferrer"
          >
            SECURITY.md
          </a>
          {": "}SLAs, GHSA evidence pattern, reporting flow.
        </li>
        <li>
          <a
            href="https://www.aikido.dev/blog/cloud-compliance-frameworks"
            target="_blank"
            rel="noreferrer"
          >
            Aikido: cloud compliance frameworks overview
          </a>
          {": "}broader background on the frameworks themselves.
        </li>
      </ul>
    </>
  );
}
