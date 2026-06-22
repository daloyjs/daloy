import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Recommended scanning tools (Socket, Snyk, Aikido)",
  description:
    "How to use Socket, Snyk, and Aikido with DaloyJS: why they matter, when to choose each tool, how to set them up, and which framework guardrails they complement.",
  path: "/docs/security/scanning-tools",
  keywords: [
    "Socket.dev",
    "Socket Firewall",
    "Snyk",
    "Aikido Security",
    "npm supply chain scanner",
    "SAST",
    "SCA",
    "DAST",
    "dependency scanning",
    "DaloyJS security tooling",
  ],
  type: "article",
});

const socketFirewallExample = `npm i -g sfw

# Put Socket Firewall in front of installs that change dependencies.
sfw pnpm add zod
sfw pnpm install

# Socket Firewall Free also supports npm, yarn, pip, uv, and cargo.
sfw npm install
sfw yarn install`;

const socketCliExample = `npm install -g socket
socket login

# Create a scan and fail if it violates your Socket policy.
socket scan create --report --repo="daloy-api" --branch="main" .

# In CI, socket ci is the shorter policy-gating command.
socket ci`;

const snykCliExample = `npm install -g snyk
snyk auth

# Open-source dependency and license scan.
snyk test --all-projects --severity-threshold=high

# First-party source scan.
snyk code test

# Snapshot dependencies for ongoing monitoring in Snyk.
snyk monitor --all-projects --target-reference=main`;

export default function Page() {
  return (
    <>
      <h1>Recommended scanning tools</h1>
      <blockquote>
        <strong>Think of it like…</strong> airport security. There are always-on
        metal detectors at the door (Socket Firewall, in-line on every install),
        randomly-scheduled bag checks (Snyk / Aikido scans on every PR), and a
        watch-list desk that knows which travellers are wanted elsewhere
        (vulnerability databases). You want all three, each one catches things
        the others miss.
      </blockquote>
      <p>
        Yes: we recommend pairing DaloyJS with external security scanning. The
        framework gives you strong defaults in the source tree: blocked
        lifecycle scripts, source-verified lockfiles, a 24h release-age
        cooldown, strict schema conventions, <code>fetchGuard</code> SSRF
        controls, JWT algorithm allowlists, timing-safe comparisons, and many{" "}
        <code>verify:*</code> CI gates. See{" "}
        <a href="/docs/security/supply-chain">Supply-chain security</a> for the
        full posture.
      </p>
      <p>
        External scanners cover the moving parts DaloyJS cannot know from inside
        your repository: newly disclosed CVEs, live registry threat intel,
        dependency behavior changes, container image risk, cloud and IaC drift,
        and DAST checks against a running API. The right mental model is
        defense-in-depth: DaloyJS keeps dangerous defaults out of the app;
        Socket, Snyk, and Aikido keep watching the world around the app.
      </p>
      <LayerStack
        title="Layers a scanner adds on top of the framework"
        flow="down"
        layers={[
          {
            title: "DaloyJS framework defaults",
            detail: "in the source tree, enforced by verify:* gates",
            tone: "success",
            items: [
              "ignore-scripts=true",
              "release-age cooldown",
              "fetchGuard",
              ".strict() schemas",
            ],
          },
          {
            title: "Install-time firewall (Socket)",
            detail: "blocks confirmed malware before it touches disk",
            tone: "accent",
            items: ["sfw / Socket Firewall", "lockfile PR review"],
          },
          {
            title: "PR / CI scans (Snyk, Aikido)",
            detail: "CVEs, SAST, IaC, containers on every diff",
            items: ["snyk test", "socket ci", "Aikido PR gating"],
          },
          {
            title: "Runtime / DAST (against a running app)",
            detail: "live API surface the repo can't see at rest",
            items: ["DAST / API scanning", "surface monitoring"],
          },
        ]}
        caption="Each layer catches what the others miss. The framework keeps dangerous defaults out at build time; the scanners watch the registry, the diff, and the running service. None of them replaces keeping the framework controls on."
      />
      <p>
        Facts on this page were checked against the vendors&apos; public docs on
        2026-05-24. Product names, plan limits, and packaging details can
        change, so this page links to source docs instead of freezing pricing
        claims into our docs.
      </p>

      <h2>Quick recommendation</h2>
      <table>
        <thead>
          <tr>
            <th>Use case</th>
            <th>Recommended setup</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Small DaloyJS app, mostly npm dependencies</td>
            <td>
              Socket for GitHub + Socket Firewall Free + keep DaloyJS&apos;s{" "}
              <code>.npmrc</code> defaults.
            </td>
          </tr>
          <tr>
            <td>Audit-heavy team or customer security questionnaire</td>
            <td>
              Snyk for SCA/SAST reports, PR checks, fix PRs, and container/IaC
              evidence.
            </td>
          </tr>
          <tr>
            <td>Team wants one AppSec dashboard</td>
            <td>
              Aikido for code scanning, PR/release gating, container scanning,
              cloud scanning, DAST/surface monitoring, and optional Zen
              Firewall.
            </td>
          </tr>
          <tr>
            <td>Security-sensitive production system</td>
            <td>
              Socket for supply-chain behavior + Snyk or Aikido for broader
              AppSec coverage. Require status checks before merging.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Socket: supply-chain defense</h2>
      <p>
        <a href="https://socket.dev/" target="_blank" rel="noreferrer noopener">
          Socket
        </a>{" "}
        is the best fit when your main worry is malicious, compromised, or
        suspicious open-source packages. Its current docs emphasize several
        entry points:{" "}
        <a
          href="https://docs.socket.dev/docs/socket-for-github"
          target="_blank"
          rel="noreferrer noopener"
        >
          Socket for GitHub
        </a>{" "}
        for pull-request feedback, the{" "}
        <a
          href="https://docs.socket.dev/docs/socket-cli"
          target="_blank"
          rel="noreferrer noopener"
        >
          Socket CLI
        </a>{" "}
        for scans and policy automation, and{" "}
        <a
          href="https://docs.socket.dev/docs/socket-firewall-overview"
          target="_blank"
          rel="noreferrer noopener"
        >
          Socket Firewall
        </a>{" "}
        for install-time blocking.
      </p>

      <h3>Why use it</h3>
      <ul>
        <li>
          Socket watches package behavior, not only known CVEs. Its alert types
          include install scripts, telemetry, native code, known malware,
          typosquats, git/http dependencies, obfuscated code, shell access,
          network access, environment-variable access, and filesystem access.
        </li>
        <li>
          That maps directly to DaloyJS&apos;s own guardrails:{" "}
          <code>verify:known-dep-names</code>,{" "}
          <code>verify:no-lifecycle-scripts</code>,{" "}
          <code>verify:no-registry-exfiltration</code>, hardened lockfile
          checks, and the 24h release-age cooldown.
        </li>
        <li>
          Socket Firewall Free currently supports JavaScript/TypeScript package
          managers including <code>npm</code>, <code>yarn</code>, and{" "}
          <code>pnpm</code>. It sits in front of installs and blocks confirmed
          malware before the package reaches your filesystem.
        </li>
      </ul>

      <h3>When to use it</h3>
      <ul>
        <li>
          Use Socket for every DaloyJS project that accepts dependency PRs from
          Dependabot, Renovate, humans, or agents.
        </li>
        <li>
          Use Socket Firewall before local or CI installs that add or refresh
          dependencies, especially <code>pnpm add</code>,{" "}
          <code>pnpm install</code>, and template validation jobs.
        </li>
        <li>
          Use the Socket CLI when you are not on GitHub, when you want a
          policy-gating command in CI, or when you need scan reports for a
          dashboard.
        </li>
      </ul>

      <h3>How to use it</h3>
      <ol>
        <li>
          Install{" "}
          <a
            href="https://docs.socket.dev/docs/socket-for-github-installation"
            target="_blank"
            rel="noreferrer noopener"
          >
            Socket for GitHub
          </a>{" "}
          on the repositories that contain DaloyJS apps. Socket starts analyzing
          pull requests that change package manifests and lockfiles.
        </li>
        <li>
          Add the Socket status check to branch protection after the signal is
          tuned. Start in comment-only mode if the team needs a few days to
          calibrate.
        </li>
        <li>
          Install{" "}
          <a
            href="https://docs.socket.dev/docs/socket-firewall-free"
            target="_blank"
            rel="noreferrer noopener"
          >
            Socket Firewall Free
          </a>{" "}
          for local dependency changes. Keep DaloyJS&apos;s{" "}
          <code>ignore-scripts=true</code> in place; Firewall decides whether a
          package should download, and <code>ignore-scripts</code> prevents
          lifecycle execution.
        </li>
        <li>
          For CI or non-GitHub workflows, use{" "}
          <a
            href="https://docs.socket.dev/docs/socket-ci"
            target="_blank"
            rel="noreferrer noopener"
          >
            <code>socket ci</code>
          </a>{" "}
          or{" "}
          <a
            href="https://docs.socket.dev/docs/socket-scan"
            target="_blank"
            rel="noreferrer noopener"
          >
            <code>socket scan create --report</code>
          </a>
          .
        </li>
      </ol>
      <CodeBlock language="bash" code={socketFirewallExample} />
      <CodeBlock language="bash" code={socketCliExample} />

      <h2>Snyk: CVE, SAST, container, and IaC scanning</h2>
      <p>
        <a href="https://snyk.io/" target="_blank" rel="noreferrer noopener">
          Snyk
        </a>{" "}
        is the most audit-recognizable choice. Its current docs position Snyk as
        a developer-first scanning platform for SAST, DAST, SCA, and IaC. The
        product docs split this into{" "}
        <a
          href="https://docs.snyk.io/scan-with-snyk/snyk-open-source"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk Open Source
        </a>
        ,{" "}
        <a
          href="https://docs.snyk.io/scan-with-snyk/snyk-code"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk Code
        </a>
        ,{" "}
        <a
          href="https://docs.snyk.io/scan-with-snyk/snyk-container"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk Container
        </a>
        ,{" "}
        <a
          href="https://docs.snyk.io/scan-with-snyk/snyk-iac"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk IaC
        </a>
        , and{" "}
        <a
          href="https://snyk.io/product/dast-api-web/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk API &amp; Web
        </a>
        .
      </p>

      <h3>Why use it</h3>
      <ul>
        <li>
          Snyk is strong when you need CVE evidence, vulnerability remediation
          guidance, automated fix PRs, and reports that security reviewers
          already know how to read.
        </li>
        <li>
          It catches a different class of issue than Socket: not just suspicious
          package behavior, but known vulnerable versions, first-party code
          findings, container base-image issues, Terraform/Kubernetes mistakes,
          and API/web findings.
        </li>
        <li>
          Its GitHub integration can run PR checks, regularly monitor imported
          projects, and open signed fix or upgrade pull requests when fixes are
          available.
        </li>
      </ul>

      <h3>When to use it</h3>
      <ul>
        <li>
          Use Snyk when customers, auditors, or procurement ask for an SCA/SAST
          program with recognizable reports.
        </li>
        <li>
          Use it for projects that ship containers, Kubernetes manifests,
          Terraform, or other infrastructure code alongside the DaloyJS API.
        </li>
        <li>
          Use the CLI before releases when you want a local or CI gate with
          explicit exit codes. The current <code>snyk test</code> command exits
          non-zero when vulnerabilities are found, and <code>snyk monitor</code>
          creates a monitored dependency snapshot.
        </li>
      </ul>

      <h3>How to use it</h3>
      <ol>
        <li>
          Start with Snyk&apos;s{" "}
          <a
            href="https://docs.snyk.io/discover-snyk/getting-started"
            target="_blank"
            rel="noreferrer noopener"
          >
            getting started guide
          </a>
          , create or join the correct organization, and confirm your region and
          token policy.
        </li>
        <li>
          Connect the{" "}
          <a
            href="https://docs.snyk.io/developer-tools/scm-integrations/organization-level-integrations/github"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub integration
          </a>{" "}
          and import the repo. Enable PR checks for Open Source and Code, then
          tune severity thresholds before requiring the checks.
        </li>
        <li>
          Install the{" "}
          <a
            href="https://docs.snyk.io/developer-tools/snyk-cli/install-the-snyk-cli"
            target="_blank"
            rel="noreferrer noopener"
          >
            Snyk CLI
          </a>{" "}
          for local and CI scans. Review Snyk&apos;s CLI code-execution warning
          before scanning untrusted code.
        </li>
        <li>
          Use <code>snyk test --all-projects</code> for dependency scans,{" "}
          <code>snyk code test</code> for source scanning, and{" "}
          <code>snyk monitor</code> for ongoing Open Source or Container
          monitoring snapshots.
        </li>
      </ol>
      <CodeBlock language="bash" code={snykCliExample} />

      <h2>Aikido: consolidated AppSec workflow</h2>
      <p>
        <a
          href="https://www.aikido.dev/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Aikido Security
        </a>{" "}
        is a strong recommendation when a team wants one place for most AppSec
        signals. The current docs cover{" "}
        <a
          href="https://help.aikido.dev/code-scanning/code-scanning-overview"
          target="_blank"
          rel="noreferrer noopener"
        >
          code scanning
        </a>{" "}
        for dependencies, SAST, IaC, secrets, malware, and more;{" "}
        <a
          href="https://help.aikido.dev/pr-and-release-gating/aikido-ci-gating-functionality"
          target="_blank"
          rel="noreferrer noopener"
        >
          PR and release gating
        </a>
        ;{" "}
        <a
          href="https://help.aikido.dev/container-image-scanning/container-image-scanning-overview"
          target="_blank"
          rel="noreferrer noopener"
        >
          container image scanning
        </a>
        ;{" "}
        <a
          href="https://help.aikido.dev/dast-surface-monitoring/dast-surface-monitoring-overview"
          target="_blank"
          rel="noreferrer noopener"
        >
          DAST / surface monitoring
        </a>
        ; cloud scanning; AutoFix; and{" "}
        <a
          href="https://help.aikido.dev/zen-firewall/getting-started-with-zen-firewall"
          target="_blank"
          rel="noreferrer noopener"
        >
          Zen Firewall
        </a>{" "}
        for runtime protection.
      </p>

      <h3>Why use it</h3>
      <ul>
        <li>
          Aikido is useful when you want broad coverage without stitching
          together many vendors. A single repo can have dependency, SAST, IaC,
          secrets, malware, license, code quality, container, DAST/API, and
          cloud findings in one workflow.
        </li>
        <li>
          Its PR gating scans branch diffs and can fail only on new findings at
          or above your configured severity threshold. That makes rollout easier
          on older apps with existing backlog.
        </li>
        <li>
          DaloyJS emits OpenAPI by design, which pairs naturally with
          Aikido&apos;s API scanning and surface monitoring when you deploy a
          staging or production endpoint.
        </li>
      </ul>

      <h3>When to use it</h3>
      <ul>
        <li>
          Use Aikido when a small or mid-size team wants one security inbox and
          one triage workflow instead of separate SCA, SAST, DAST, IaC,
          container, and secrets tools.
        </li>
        <li>
          Use it when you want branch-level PR gating first, then release gating
          once the signal is tuned.
        </li>
        <li>
          Use DAST/API scanning after the DaloyJS app has a stable staging URL
          and a generated OpenAPI document.
        </li>
        <li>
          Consider Zen Firewall only when you want an additional runtime
          WAF-like layer. It does not replace DaloyJS&apos;s built-in runtime
          guardrails.
        </li>
      </ul>

      <h3>How to use it</h3>
      <ol>
        <li>
          Connect your source control from{" "}
          <a
            href="https://help.aikido.dev/code-scanning/connect-your-source-code"
            target="_blank"
            rel="noreferrer noopener"
          >
            Connect Your Source Code
          </a>
          . Aikido supports GitHub, GitHub Enterprise, GitLab, Bitbucket, and
          Azure DevOps paths in the current docs.
        </li>
        <li>
          Enable PR gating from{" "}
          <a
            href="https://help.aikido.dev/pr-and-release-gating/aikido-ci-gating-functionality"
            target="_blank"
            rel="noreferrer noopener"
          >
            PR Gating Overview
          </a>
          . Start with visibility mode or a high severity threshold, then
          require the check after triage rules are clear.
        </li>
        <li>
          If source code cannot leave your environment, evaluate{" "}
          <a
            href="https://help.aikido.dev/code-scanning/local-code-scanning"
            target="_blank"
            rel="noreferrer noopener"
          >
            Local Code Scanning
          </a>
          . Aikido recommends standard integrations for most teams because they
          provide faster results and better coverage.
        </li>
        <li>
          If you ship Docker images, connect the registry or run local image
          scanning before publish. Aikido tracks CVEs, licenses, EOL runtimes,
          SBOMs, and base-image remediation.
        </li>
        <li>
          Add{" "}
          <a
            href="https://help.aikido.dev/dast-surface-monitoring/api-scanning"
            target="_blank"
            rel="noreferrer noopener"
          >
            API scanning
          </a>{" "}
          against a staging URL. For DaloyJS, publish or upload the generated
          OpenAPI document from <code>pnpm gen</code> / your docs route so the
          scanner understands routes, methods, schemas, and auth expectations.
        </li>
      </ol>

      <h2>How they compare</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Best at</th>
            <th>Use with DaloyJS when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Socket</td>
            <td>
              Malicious-package behavior, install-time blocking, lockfile PR
              review, package reputation, supply-chain risk.
            </td>
            <td>
              Dependency changes are frequent, agents add packages, or you want
              a specific layer against npm/pnpm ecosystem attacks.
            </td>
          </tr>
          <tr>
            <td>Snyk</td>
            <td>
              CVE-backed SCA, SAST, container and IaC scanning, PR checks,
              fix/upgrade pull requests, audit-friendly reporting.
            </td>
            <td>
              Security questionnaires, SOC 2 / ISO 27001 evidence, customer
              reviews, or a bigger remediation backlog matter.
            </td>
          </tr>
          <tr>
            <td>Aikido</td>
            <td>
              Broad AppSec coverage in one dashboard: code, deps, secrets,
              malware, IaC, containers, DAST/API, cloud, PR/release gates.
            </td>
            <td>
              You want one operational workflow and fast triage across the whole
              application, not just npm dependencies.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Recommended rollout</h2>
      <ol>
        <li>
          Keep the DaloyJS defaults first: <code>ignore-scripts=true</code>,
          release-age cooldown, source-verified lockfiles, and the
          project&apos;s <code>verify:*</code> gates.
        </li>
        <li>
          Install Socket for GitHub and Socket Firewall for all developers who
          change dependencies. This gives immediate supply-chain feedback.
        </li>
        <li>
          Add either Snyk or Aikido for broader SAST/SCA/IaC/container/API
          coverage. Teams with audit pressure usually start with Snyk; teams
          optimizing for one dashboard often start with Aikido.
        </li>
        <li>
          Run scanners in observe-only mode for a short window. Fix obvious
          criticals, document accepted risk, then require status checks on new
          findings.
        </li>
        <li>
          Make ownership explicit. Every ignored finding should have a reason,
          an expiry, and a person or team responsible for revisiting it.
        </li>
      </ol>

      <h2>What no scanner replaces</h2>
      <p>
        Do not turn off framework controls after adding a scanner. The scanner
        tells you what it can see; the framework still needs to refuse dangerous
        behavior by default.
      </p>
      <ul>
        <li>
          Keep <code>ignore-scripts=true</code>. Even excellent scanners can
          miss day-zero payloads before a signal exists.
        </li>
        <li>
          Keep the 24h release-age cooldown. It gives the registry, vendors, and
          maintainers time to detect and yank bad versions.
        </li>
        <li>
          Keep <code>fetchGuard</code>, schema <code>.strict()</code>, JWT
          algorithm allowlists, timing-safe secret comparisons, secure headers,
          rate limits, body limits, and request timeouts.
        </li>
        <li>
          Keep reviewing lockfile diffs. A scanner comment is a signal; it is
          not a substitute for ownership of what ships.
        </li>
      </ul>

      <h2>Freshness policy</h2>
      <p>
        To keep this page current, review the linked vendor docs when changing
        recommendations and before major DaloyJS releases. Avoid hardcoding plan
        limits or seat counts; link to the vendors&apos; pricing pages instead:{" "}
        <a
          href="https://socket.dev/pricing"
          target="_blank"
          rel="noreferrer noopener"
        >
          Socket pricing
        </a>
        ,{" "}
        <a
          href="https://snyk.io/plans/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Snyk plans
        </a>
        , and{" "}
        <a
          href="https://www.aikido.dev/pricing"
          target="_blank"
          rel="noreferrer noopener"
        >
          Aikido pricing
        </a>
        . If a vendor renames a product module, update the wording here and keep
        the old name out unless it is still present in the current docs.
      </p>

      <h2>Disclosure</h2>
      <p>
        DaloyJS has no commercial relationship with Socket, Snyk, or Aikido.
        These recommendations are based on how their current public products map
        to DaloyJS&apos;s threat model: secure-by-default framework controls
        plus external visibility into dependencies, code, containers, cloud, and
        live APIs.
      </p>
    </>
  );
}
