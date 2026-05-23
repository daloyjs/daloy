import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Compliance posture (SOC 2, ISO 27001, HIPAA, GDPR, PCI-DSS, NIS2)",
  description:
    "How DaloyJS's built-in security primitives map to the technical controls expected by the major cloud-compliance frameworks. The framework can't certify your deployment, but it can stop you from failing the easy audit findings.",
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
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Compliance posture</h1>
      <p>
        DaloyJS is a backend framework, not a managed service, so it cannot
        certify your deployment for SOC 2, ISO 27001, HIPAA, GDPR, PCI-DSS, or
        NIS2 on its own. What it <em>can</em> do is provide the technical
        controls each of those frameworks expects from the application layer so
        that the controls live in source code where they are reviewed, tested,
        and version-pinned &mdash; rather than in a checklist that drifts away
        from production.
      </p>
      <p>
        This page maps DaloyJS&apos;s built-in primitives to the control
        families auditors actually ask about. The mapping is informational, not
        a legal opinion: organizational controls (employee training, vendor
        management, physical security, access reviews) remain the
        operator&apos;s responsibility.
      </p>

      <h2>Shared technical controls</h2>
      <p>
        Most frameworks ask for the same handful of application-layer controls
        under different names. DaloyJS ships them by default.
      </p>
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
              <a href="/docs/security/session">Sessions</a>,{" "}
              <a href="/docs/auth">Authentication</a>
            </td>
          </tr>
          <tr>
            <td>Authorization at the route boundary</td>
            <td>
              Per-route middleware composition; <code>ipRestriction()</code> for
              admin slices; auth-slice pattern for internal endpoints.
            </td>
            <td>
              <a href="/docs/security/admin-panels">Secure admin panels</a>,{" "}
              <a href="/docs/security/auth-slice">Auth slice</a>
            </td>
          </tr>
          <tr>
            <td>Input validation &amp; injection defense</td>
            <td>
              Zod/Valibot schemas on every body, query, and param; router
              rejects
              <code>..</code> and <code>//</code>; <code>safeJsonParse</code>{" "}
              strips prototype-pollution keys; SQL/command-injection guards
              documented for ORMs and shells.
            </td>
            <td>
              <a href="/docs/security/sql-injection">SQL injection</a>,{" "}
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
              <a href="/docs/security/rate-limit-redis">Rate limit (Redis)</a>,{" "}
              <a href="/docs/security/websocket-login-throttle">
                WebSocket + login throttle
              </a>
            </td>
          </tr>
          <tr>
            <td>SSRF / outbound network controls</td>
            <td>
              <code>fetchGuard()</code> blocks private IPs, link-local,
              metadata-service ranges, and DNS rebinding.
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
              , <a href="/docs/security/compression">Compression</a>
            </td>
          </tr>
          <tr>
            <td>Audit logging &amp; PII handling</td>
            <td>
              Structured logger with request-id correlation and{" "}
              <code>redactRecord()</code> for known secret/PII keys; opt-in
              redaction for application-specific fields.
            </td>
            <td>
              <a href="/docs/tracing">Tracing &amp; logs</a>
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

      <h2>SOC 2 (Trust Services Criteria, 2017 with 2022 points of focus)</h2>
      <p>
        SOC 2 maps to the Trust Services Criteria. DaloyJS contributes mostly to
        the <strong>Security (Common Criteria)</strong> category and partially
        to Availability and Confidentiality. Privacy and Processing Integrity
        also get coverage when you turn the schemas into binding contracts.
      </p>
      <ul>
        <li>
          <strong>
            CC6.1 / CC6.6 &mdash; logical access &amp; boundary protection.
          </strong>{" "}
          Use <code>secureHeaders()</code>, <code>cors()</code>,{" "}
          <code>session()</code>, <code>bearerAuth()</code>, and{" "}
          <code>ipRestriction()</code> on admin routes.
        </li>
        <li>
          <strong>CC6.7 &mdash; data in transit.</strong> HSTS via{" "}
          <code>secureHeaders()</code>; TLS termination is the platform&apos;s
          responsibility.
        </li>
        <li>
          <strong>CC6.8 &mdash; protection against malicious software.</strong>{" "}
          Supply-chain hardening (no runtime deps, provenance, SBOM,
          <code>ignore-scripts</code>, SHA-pinned actions, lockfile-source
          verification).
        </li>
        <li>
          <strong>
            CC7.1 / CC7.2 &mdash; monitoring &amp; anomaly detection.
          </strong>{" "}
          Structured JSON logs with request-id correlation; Server-Timing for
          latency monitoring; OpenTelemetry integration documented under{" "}
          <a href="/docs/tracing">Tracing</a>.
        </li>
        <li>
          <strong>CC7.4 &mdash; incident response.</strong> Published{" "}
          <code>SECURITY.md</code>, GHSA evidence pattern, and CVSS-keyed patch
          SLA.
        </li>
        <li>
          <strong>A1.2 &mdash; availability.</strong> Rate limiting, load
          shedding, request timeouts, body-size caps, graceful shutdown hooks.
        </li>
      </ul>

      <h2>ISO/IEC 27001:2022 (Annex A)</h2>
      <ul>
        <li>
          <strong>A.5.30 ICT readiness for business continuity</strong> &mdash;
          graceful shutdown, health endpoints, and lifecycle hooks (see{" "}
          <a href="/docs/security/lifecycle-health">Lifecycle &amp; health</a>).
        </li>
        <li>
          <strong>A.8.7 Protection against malware</strong> &mdash; supply-chain
          controls listed above.
        </li>
        <li>
          <strong>A.8.8 Management of technical vulnerabilities</strong> &mdash;
          the SLA table in SECURITY.md, GHSA flow, OpenSSF Scorecard, CodeQL,
          Dependabot.
        </li>
        <li>
          <strong>A.8.9 Configuration management</strong> &mdash; secure
          defaults are enforced at boot (
          <a href="/docs/security/secure-defaults-enforcement">
            secureDefaults enforcement
          </a>
          ), not just documented.
        </li>
        <li>
          <strong>A.8.15 Logging</strong> &mdash; structured logger, request-id
          correlation, PII redaction.
        </li>
        <li>
          <strong>A.8.23 Web filtering</strong> &mdash;{" "}
          <code>fetchGuard()</code> enforces an egress allow-list pattern from
          inside the app.
        </li>
        <li>
          <strong>A.8.24 Use of cryptography</strong> &mdash; algorithm
          allow-listing on JWT/JWK; HMAC with algorithm-prefix parsing;
          timing-safe comparisons.
        </li>
        <li>
          <strong>A.8.25 Secure development lifecycle</strong> &mdash;{" "}
          <code>create-daloy --with-ci</code> ships CodeQL, Scorecard, zizmor,
          Dependabot, CODEOWNERS, and a <code>SECURITY.md</code> template.
        </li>
        <li>
          <strong>A.8.26 Application security requirements</strong> &mdash;
          input validation through Zod/Valibot; OpenAPI contract enforcement
          before any handler runs.
        </li>
        <li>
          <strong>A.8.28 Secure coding</strong> &mdash; documented patterns for
          SQL injection, command injection, SSRF, CSRF, prototype pollution.
        </li>
      </ul>

      <h2>HIPAA Security Rule (45 CFR § 164.312)</h2>
      <p>
        HIPAA cares about Protected Health Information (PHI) handled by Covered
        Entities and Business Associates. DaloyJS contributes to the{" "}
        <em>Technical Safeguards</em>:
      </p>
      <ul>
        <li>
          <strong>§ 164.312(a) Access Control</strong> &mdash; unique user
          identification via session/JWT subject claim; automatic logoff via
          session TTL; encryption at the cookie layer with signed and rotated
          keys.
        </li>
        <li>
          <strong>§ 164.312(b) Audit Controls</strong> &mdash; structured logs
          with request-id, route, status, latency, and user-id (when
          authenticated) so a downstream log pipeline can satisfy retention and
          tamper-evidence requirements (those still need to be configured at the
          log sink).
        </li>
        <li>
          <strong>§ 164.312(c) Integrity</strong> &mdash; HMAC for webhook
          payloads; signed sessions; ETag/Last-Modified for optimistic
          concurrency on PHI mutations.
        </li>
        <li>
          <strong>§ 164.312(d) Person or Entity Authentication</strong> &mdash;
          first-party authentication helpers; tested integrations with AWS
          Cognito, Microsoft Entra ID, Auth0, Okta, and Clerk.
        </li>
        <li>
          <strong>§ 164.312(e) Transmission Security</strong> &mdash; HSTS and
          secure cookies by default; the actual TLS terminator (load balancer,
          CDN, platform) is out of the framework&apos;s scope.
        </li>
        <li>
          <strong>Practical PHI hygiene.</strong> Add field-level redaction in
          the logger for any field that carries PHI; do not log request bodies
          on PHI routes; keep the <code>session()</code> cookie{" "}
          <code>httpOnly</code> and <code>sameSite</code> (default behavior).
        </li>
      </ul>

      <h2>GDPR (Regulation 2016/679)</h2>
      <p>
        GDPR is risk-based; Article 32 (&ldquo;security of processing&rdquo;)
        and Article 25 (&ldquo;data protection by design and by default&rdquo;)
        are where the framework helps most.
      </p>
      <ul>
        <li>
          <strong>Article 5(1)(f) integrity &amp; confidentiality</strong>{" "}
          &mdash; secure headers, signed sessions, schema-validated inputs,
          structured logs with redaction.
        </li>
        <li>
          <strong>Article 25 data protection by design and by default</strong>{" "}
          &mdash; secure-by-default body limits, request timeouts, content-type
          allow-listing, and CSRF/cors defaults; the auditor sees that the
          insecure paths are <em>opt-in</em>, not the other way around.
        </li>
        <li>
          <strong>Article 30 records of processing</strong> &mdash; OpenAPI is
          generated from the routes themselves, which gives a machine-readable
          inventory of every endpoint that touches personal data. Pair it with a
          tagging convention (e.g.{" "}
          <code>x-daloy-data-classes: [&quot;email&quot;, &quot;ip&quot;]</code>
          ) so the same spec answers ROPA questions.
        </li>
        <li>
          <strong>Article 32 security of processing</strong> &mdash; the
          &ldquo;Shared technical controls&rdquo; table above is the short
          answer for the application layer; pseudonymization, encryption at
          rest, and key management still live at the data store.
        </li>
        <li>
          <strong>Article 33 breach notification (within 72 hours)</strong>{" "}
          &mdash; the request-id and structured-log primitives make it possible
          to reconstruct affected sessions; the published CVSS-keyed patch SLA
          lets controllers describe the &ldquo;measures taken&rdquo; section of
          their breach notification with real numbers rather than aspirations.
        </li>
        <li>
          <strong>Logging PII responsibly.</strong> The logger&apos;s{" "}
          <code>redactRecord()</code> already masks well-known secret keys
          (passwords, tokens, API keys). Extend the redaction list for
          application-specific PII fields and never log raw request bodies on
          routes that process personal data.
        </li>
      </ul>

      <h2>PCI-DSS v4.0 (software-side controls)</h2>
      <p>
        DaloyJS&apos;s payments documentation already calls out the SAQ scope
        consequences of touching a Primary Account Number (PAN) directly. The
        framework helps with the software-side requirements of v4.0:
      </p>
      <ul>
        <li>
          <strong>Req 2 secure configurations</strong> &mdash; secure-by-default
          headers, content-type allow-listing, and the boot guards that
          fail-closed on insecure config.
        </li>
        <li>
          <strong>Req 4 strong cryptography in transit</strong> &mdash; HSTS via{" "}
          <code>secureHeaders()</code>.
        </li>
        <li>
          <strong>Req 6.2 secure software development</strong> &mdash;
          schema-validated inputs, prototype-pollution-safe JSON parsing, header
          sanitization, path-traversal-safe router, prepared-statement guidance
          for every ORM in{" "}
          <a href="/docs/security/sql-injection">SQL injection</a>.
        </li>
        <li>
          <strong>Req 6.3 manage vulnerabilities</strong> &mdash; SECURITY.md
          SLA, GHSA evidence, dependency-graph monitoring.
        </li>
        <li>
          <strong>Req 6.4 protect public-facing web applications</strong>{" "}
          &mdash; CSRF, secure headers, rate limiting, request-id correlation.
        </li>
        <li>
          <strong>Req 8 strong authentication</strong> &mdash; first-party
          session/JWT helpers with algorithm allow-listing.
        </li>
        <li>
          <strong>Req 10 log and monitor</strong> &mdash; structured logs with
          per-request correlation IDs; the retention and tamper-evidence
          obligations live at the log sink.
        </li>
        <li>
          <strong>SAQ scope.</strong> The strongest control here is{" "}
          <em>not seeing the PAN at all</em>. The payments docs (Stripe,
          Authorize.Net, Square) document the redirect/hosted-fields patterns
          that keep you in SAQ-A or SAQ-A-EP rather than SAQ-D.
        </li>
      </ul>

      <h2>NIS2 (Directive (EU) 2022/2555) and the EU CRA</h2>
      <p>
        NIS2 Article 21 lists the cybersecurity risk-management measures
        essential and important entities must adopt. The Cyber Resilience Act
        adds analogous obligations on the vendor side. Both increasingly show up
        as upstream patch-SLA clauses in procurement.
      </p>
      <ul>
        <li>
          <strong>
            Article 21(2)(a) policies on risk analysis and security of
            information systems
          </strong>{" "}
          &mdash; the secure-by-default baseline plus the boot-guard
          enforcement.
        </li>
        <li>
          <strong>Article 21(2)(b) incident handling</strong> &mdash;
          SECURITY.md publishes the response targets, escalation contacts, and
          GHSA evidence format.
        </li>
        <li>
          <strong>Article 21(2)(d) supply-chain security</strong> &mdash; npm
          provenance, SBOM, SHA-pinned third-party Actions, lockfile-source
          verification, <code>ignore-scripts</code> by default in scaffolded
          projects.
        </li>
        <li>
          <strong>
            Article 21(2)(e) security in network and information systems
            acquisition, development, and maintenance
          </strong>{" "}
          &mdash; the CI bundle from <code>create-daloy --with-ci</code> turns
          CodeQL, Scorecard, zizmor, Dependabot, and CODEOWNERS on out of the
          box.
        </li>
        <li>
          <strong>Article 21(2)(g) basic cyber hygiene practices</strong>{" "}
          &mdash; documented patterns for sessions, CSRF, SSRF, SQL/command
          injection, and admin-panel hardening; opinionated runtime protections.
        </li>
        <li>
          <strong>Article 21(2)(h) use of cryptography</strong> &mdash;
          algorithm allow-listing, timing-safe comparisons, HMAC algorithm
          prefix parsing.
        </li>
        <li>
          <strong>EU CRA upstream patch SLA</strong> &mdash; the CVSS-keyed
          table in <code>SECURITY.md</code> is written specifically so
          downstream procurement can quote it verbatim.
        </li>
      </ul>

      <h3>EU Cyber Resilience Act (Regulation (EU) 2024/2847)</h3>
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
        ; the table below is the operator-friendly summary.
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
              Annex I (1)(a) — no known exploitable vulnerabilities on release
            </td>
            <td>
              <code>pnpm audit --audit-level=high</code> in CI and pre-publish;
              daily <code>pnpm audit --prod</code> against <code>main</code>;
              zero runtime deps in <code>@daloyjs/core</code>.
            </td>
          </tr>
          <tr>
            <td>Annex I (1)(b) — secure-by-default configuration</td>
            <td>
              Body cap (1 MiB), 30 s request timeout,{" "}
              <code>secureHeaders()</code>, <code>fetchGuard()</code>{" "}
              default-denying SSRF against cloud-metadata IPs,
              prototype-pollution stripping in every parser, real{" "}
              <code>405</code>, problem+json 5xx detail redaction in production.
              Scaffolded projects inherit <code>ignore-scripts=true</code> +{" "}
              <code>minimum-release-age=1440</code>.
            </td>
          </tr>
          <tr>
            <td>
              Annex I (1)(c) — security updates independent of feature updates
            </td>
            <td>
              SemVer with patch releases (<code>0.x.Y</code>) reserved for
              security and regression fixes; consumers pinned with{" "}
              <code>^@daloyjs/core</code> get patches via{" "}
              <code>pnpm update</code> or Dependabot without code changes.
            </td>
          </tr>
          <tr>
            <td>Annex I (1)(d) — authentication and access control</td>
            <td>
              First-party <code>bearerAuth</code>, <code>basicAuth</code>,{" "}
              <code>jwt()</code> (PS256 / RS256 / ES256 / EdDSA, JWKS rotation
              with <code>kid</code> pinning), signed-cookie{" "}
              <code>session()</code>, <code>timingSafeEqual()</code>; the{" "}
              <code>pnpm verify:secret-comparisons</code> gate rejects every
              short-circuiting comparison against header-derived values.
            </td>
          </tr>
          <tr>
            <td>
              Annex I (1)(h) — resilience against and mitigation of DoS attacks
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
              Annex I (1)(j) — limit attack surface and external interfaces
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
              Annex I Part II (2)(1) — SBOM in a commonly used, machine-readable
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
              Annex I Part II (2)(2) — remediate vulnerabilities without delay
            </td>
            <td>
              CVSS-keyed upstream patch SLA: <strong>48 h</strong> Critical,{" "}
              <strong>7 d</strong> High, <strong>30 d</strong> Medium,{" "}
              <strong>90 d</strong> Low, measured from triage.
            </td>
          </tr>
          <tr>
            <td>
              Annex I Part II (2)(4) — public disclosure of fixed
              vulnerabilities
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
              Annex I Part II (2)(5) — policy on coordinated vulnerability
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
              at <code>SECURITY.md</code>. Disclosure rotation is named in{" "}
              <code>SECURITY-CONTACTS.md</code> and tested quarterly
              (audit-gated by <code>pnpm verify:governance-audits</code>).
            </td>
          </tr>
          <tr>
            <td>Annex I Part II (2)(7) — secure update distribution</td>
            <td>
              npm over HTTPS with <code>--provenance</code> Sigstore
              attestations bound to the <code>release.yml</code> workflow run on
              the Rekor transparency log; consumers can verify the provenance
              without trusting any vendor portal.
            </td>
          </tr>
          <tr>
            <td>
              Article 14 — 24-hour reporting of actively exploited
              vulnerabilities to ENISA
            </td>
            <td>
              From 2026-09-11 the maintainer rotation triages actively-exploited
              reports best-effort within 24 h and files the early-warning
              notification with ENISA via the Single Reporting Platform,
              followed by a 72 h CVSS / scope update — even when a patch is not
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
              Article 13(8) — declared support period (regulatory floor: 5
              years)
            </td>
            <td>
              DaloyJS commits to a{" "}
              <strong>minimum 5-year security-update support period</strong> for
              every major release line starting with 1.0, measured from that
              line&apos;s first GA release. The current 0.x line is pre-1.0 and
              rolls forward on the latest minor until 1.0 ships.
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

      <h2>Operator responsibilities the framework cannot cover</h2>
      <p>
        Be upfront about this when you talk to your auditor &mdash; conflating
        application controls with platform or organizational controls is the
        fastest way to lose credibility:
      </p>
      <ul>
        <li>
          <strong>TLS termination, key management, KMS/HSM choice</strong> live
          at your load balancer, CDN, or platform.
        </li>
        <li>
          <strong>Encryption at rest, backup, disaster recovery</strong> live at
          the data store and infrastructure layer.
        </li>
        <li>
          <strong>Identity provider, MFA enrollment, account recovery</strong>{" "}
          live at the IdP (Cognito, Entra ID, Auth0, Okta, Clerk). The framework
          consumes the resulting tokens; it does not run the IdP.
        </li>
        <li>
          <strong>Log retention, immutability, SIEM forwarding</strong> live at
          the log sink. The framework emits the structured logs; how long they
          live and who can delete them is a pipeline concern.
        </li>
        <li>
          <strong>
            Vendor management, employee training, access reviews, background
            checks, physical security
          </strong>{" "}
          are organizational controls. No framework can produce evidence for
          those.
        </li>
        <li>
          <strong>
            Data-processing agreements, standard contractual clauses, transfer
            impact assessments
          </strong>{" "}
          are legal artifacts.
        </li>
      </ul>

      <h2>Suggested artifact pack for an audit</h2>
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

      <h2>Further reading</h2>
      <ul>
        <li>
          <a href="/docs/security/secure-defaults">Secure-by-default</a> &mdash;
          what the core enforces without any opt-in.
        </li>
        <li>
          <a href="/docs/security/supply-chain">Supply-chain security</a>{" "}
          &mdash; the controls behind the SOC 2 CC6.8 / ISO A.8.7 / NIS2
          21(2)(d) rows above.
        </li>
        <li>
          <a
            href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md"
            target="_blank"
            rel="noreferrer"
          >
            SECURITY.md
          </a>{" "}
          &mdash; SLAs, GHSA evidence pattern, reporting flow.
        </li>
        <li>
          <a
            href="https://www.aikido.dev/blog/cloud-compliance-frameworks"
            target="_blank"
            rel="noreferrer"
          >
            Aikido: cloud compliance frameworks overview
          </a>{" "}
          &mdash; broader background on the frameworks themselves.
        </li>
      </ul>
    </>
  );
}
