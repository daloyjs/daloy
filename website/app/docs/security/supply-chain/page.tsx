import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Supply-chain security",
  description:
    "How DaloyJS hardens its own publish pipeline against npm worm attacks, and the install-time defaults you should use in your own projects.",
  path: "/docs/security/supply-chain",
  keywords: [
    "npm supply chain",
    "DaloyJS provenance",
    "pnpm minimum-release-age",
    "ignore-scripts",
    "Shai-Hulud",
    "TanStack postmortem",
    "GitHub Actions hardening",
    "quantum incident response",
    "Aikido safe-chain",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Supply-chain security</h1>
      <blockquote>
        <strong>Think of it like…</strong> the tamper-evident seal on every
        ingredient that enters a restaurant&apos;s kitchen. The seal proves
        nobody opened the jar between the farm and the chef (
        <code>--provenance</code>). The 24-hour fridge quarantine means an
        obviously-poisoned batch gets recalled before it&apos;s served (
        <code>minimum-release-age=1440</code>). And refusing to run the
        &quot;please install this companion app&quot; pop-up that ships with the
        package keeps malware out of the prep area (
        <code>ignore-scripts=true</code>).
      </blockquote>
      <p>
        npm worm campaigns ship in waves &mdash; <code>chalk</code>/
        <code>debug</code> in September 2025, <code>node-ipc</code> in May 2026,
        the @tanstack/* compromise on 2026-05-11. The pattern is consistent: a
        single phished maintainer or one CI cache-poisoning bug becomes
        thousands of downstream installs in minutes. DaloyJS is built and
        shipped with that threat model in mind, and we recommend the same
        defaults for your project.
      </p>

      <h2>How DaloyJS itself is published</h2>
      <FlowDiagram
        title="The publish pipeline, tag to tarball"
        numbered
        steps={[
          {
            eyebrow: "trigger",
            label: "Signed tag push",
            detail: "release.yml only; fork PRs can't",
          },
          {
            eyebrow: "gate",
            label: "Protected environment",
            detail: "maintainer approval required",
            tone: "accent",
          },
          {
            eyebrow: "runner",
            label: "harden-runner egress block",
            detail: "npm + GitHub + Sigstore only",
          },
          {
            eyebrow: "auth",
            label: "OIDC trusted publish",
            detail: "no long-lived NPM_TOKEN",
          },
          {
            eyebrow: "attest",
            label: "--provenance via Sigstore",
            detail: "tarball bound to commit + run",
            tone: "success",
          },
        ]}
        caption="Only a signed tag can start a release, and only after maintainer approval on a network-restricted runner. There is no long-lived publish token to steal, and every tarball carries a provenance attestation back to its source commit."
      />
      <ul>
        <li>
          <strong>Releases run in a separate workflow</strong> (
          <code>release.yml</code>) that is triggered <em>only</em> by a signed
          tag push and gated by a protected GitHub Environment requiring
          maintainer approval. Fork PRs cannot touch it.
        </li>
        <li>
          <strong>
            npm trusted publishing (OIDC) with <code>--provenance</code>
          </strong>
          : every <code>@daloyjs/core</code> tarball is bound to its source
          commit and workflow run via Sigstore. There is no long-lived{" "}
          <code>NPM_TOKEN</code> in repo secrets to steal.
        </li>
        <li>
          <strong>
            <code>id-token: write</code> is granted only to the publish job
          </strong>
          , on the post-approval runner, with egress blocked to everything
          except npm, GitHub, and Sigstore (via{" "}
          <code>step-security/harden-runner</code>).
        </li>
        <li>
          <strong>No GitHub Actions cache</strong> in the standard CI workflow.
          Cache scope bridges fork PRs and pushes to <code>main</code>, which is
          the poisoning channel that bridged TanStack&apos;s PR pipeline into
          its release pipeline.
        </li>
        <li>
          <strong>
            No <code>pull_request_target</code>
          </strong>{" "}
          &mdash; ever. The repository has a <code>zizmor</code> check on every
          PR that fails the build if anyone ever adds it.
        </li>
        <li>
          <strong>Third-party GitHub Actions are SHA-pinned</strong> so a
          retargeted version tag cannot silently change what CI executes.
        </li>
        <li>
          <strong>CodeQL, OpenSSF Scorecard, Dependabot</strong> all run
          continuously, and <code>CODEOWNERS</code> blocks any change to{" "}
          <code>.github/</code>,<code>package.json</code>, the lockfile, or{" "}
          <code>.npmrc</code> without a maintainer review.
        </li>
        <li>
          <strong>Lockfile source verification</strong> runs in CI via
          <code>pnpm verify:lockfile</code> and fails if{" "}
          <code>pnpm-lock.yaml</code>
          introduces git dependency sources or non-registry tarball URLs.
        </li>
      </ul>
      <p>
        Full policy and incident-response playbook:{" "}
        <a
          href="https://github.com/daloyjs/daloy/blob/main/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          SECURITY.md
        </a>
        .
      </p>

      <h2>
        Defaults you get from <code>pnpm create daloy</code>
      </h2>
      <p>
        Every project scaffolded with <code>create-daloy</code> ships with an
        <code>.npmrc</code> and <code>pnpm-workspace.yaml</code> that turn on
        the install-time controls below when you choose <code>pnpm</code>. Keep
        them on.
      </p>
      <CodeBlock
        language="ini"
        code={`# .npmrc, shipped by create-daloy

# Block transitive postinstall/preinstall/prepare hooks, which is the
# execution channel used by chalk/debug, node-ipc, and Shai-Hulud.
ignore-scripts=true

# Wait 24h before resolving a freshly published version. npm worm
# campaigns are typically detected and unpublished within hours.
minimum-release-age=1440

# Reproducible installs.
prefer-frozen-lockfile=true
verify-store-integrity=true
strict-peer-dependencies=true`}
      />

      <h2>Optional CI bundle for user projects</h2>
      <p>
        <code>create-daloy --with-ci</code> adds the GitHub-side controls that
        do not come from a package install: CI with top-level{" "}
        <code>{"permissions: {}"}</code>, SHA-pinned actions,
        <code>harden-runner</code>, no package-manager cache, disabled lifecycle
        scripts, lockfile-source verification, CodeQL, OpenSSF Scorecard,
        zizmor, Dependabot, CODEOWNERS, and <code>SECURITY.md</code>. Templates
        can also get a manual-only <code>deploy.yml</code>
        starter: container templates publish a Docker image to GHCR, while
        Vercel and Cloudflare templates run their platform CLIs with credentials
        from GitHub Actions secrets and variables. The scaffolder deliberately
        omits npm publishing workflows because generated projects are REST API
        services, not reusable libraries.
      </p>
      <CodeBlock
        language="bash"
        code="pnpm create daloy@latest my-api --template node-basic --package-manager pnpm --with-ci --code-owner @acme/security"
      />
      <p>
        GitHub settings are still your responsibility: replace the CODEOWNERS
        owner if needed, enable branch protection, require the generated checks,
        and turn on secret scanning plus push protection.
      </p>
      <p>
        On GitLab, Bitbucket, Azure DevOps, Jenkins, or an on-prem runner, you
        still inherit the runtime guardrails, <code>@daloyjs/core</code>&apos;s
        zero-runtime-dependency package, SBOM and npm provenance, and the pnpm
        install-time controls if you choose pnpm. Translate the GitHub workflow
        rules above into your CI host: start from no default write permissions,
        avoid shared dependency caches for untrusted code, keep installs
        reproducible, and isolate any job that can publish or deploy.
      </p>

      <h2>If you legitimately need a postinstall</h2>
      <p>
        <code>ignore-scripts=true</code> is global. To allow a build script for
        a package you actually trust (e.g. <code>esbuild</code>), allowlist it
        explicitly in <code>package.json</code>:
      </p>
      <CodeBlock
        language="json"
        code={`{
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  }
}`}
      />
      <p>
        This is the same pattern DaloyJS uses in its own root{" "}
        <code>package.json</code>. Each entry should be reviewed in PR.
      </p>

      <h2>Avoid git and tarball dependencies</h2>
      <p>
        DaloyJS also checks its root lockfile for dependency sources that bypass
        the normal npm registry path. In this repo,{" "}
        <code>pnpm verify:lockfile</code> fails on git dependencies and
        non-registry tarball URLs so a transitive source change cannot slip
        through as ordinary version churn.
      </p>

      <h2>Optional: install-time malware scanners</h2>
      <p>
        The 24-hour <code>minimum-release-age</code> cooldown is what bridges
        the gap between a malicious version being published and the registry
        yanking it. Aikido&apos;s{" "}
        <a
          href="https://www.aikido.dev/blog/quantum-incident-response"
          target="_blank"
          rel="noreferrer"
        >
          &ldquo;quantum incident response&rdquo;
        </a>{" "}
        write-up makes the point that you cannot out-react an npm worm once it
        lands &mdash; prevention at install time is the only viable defense.
        DaloyJS&apos;s install defaults already implement that thesis (cooldown,
        no transitive lifecycle hooks, zero runtime deps in{" "}
        <code>@daloyjs/core</code>, frozen + verified store). For belt-and-
        braces beyond the cooldown, install a real-time scanner that intercepts
        package-manager calls and checks each requested version against a live
        malware feed before it touches disk:
      </p>
      <CodeBlock
        language="bash"
        code={`# Aikido Safe Chain, free, no account required.
# Wraps npm / pnpm / yarn / npx / pnpx and refuses known-malicious
# package versions before they install.
npm install -g @aikidosec/safe-chain
safe-chain setup`}
      />
      <p>
        DaloyJS deliberately does <strong>not</strong> add{" "}
        <code>safe-chain</code> (or any other third-party scanner) as a
        dependency or scaffold default &mdash; <code>@daloyjs/core</code> ships
        zero runtime dependencies by policy and any install-time tool you run is
        your trust decision, not the framework&apos;s. Equivalent commercial
        offerings (Socket, Snyk Advisor, JFrog Curation, npm&apos;s own Package
        Trust) sit at the same layer; pick one or run none, but understand that{" "}
        <code>minimum-release-age=1440</code> is already doing most of the work
        the article recommends.
      </p>

      <h2>What to do if a maintainer account is phished</h2>
      <p>
        The September 2025 chalk/debug compromise started with a single fake{" "}
        <code>npmjs.help</code> 2FA-reset email. If you suspect a maintainer
        (yours or an upstream&apos;s) was phished:
      </p>
      <ol>
        <li>
          Pin every direct dependency that lists the affected maintainer to the
          last known-good version in your lockfile.
        </li>
        <li>
          <code>pnpm audit --prod</code> and rotate any deployment credential
          the install host had access to (npm token, GitHub token, AWS keys, SSH
          keys).
        </li>
        <li>
          Bump <code>minimum-release-age</code> in <code>.npmrc</code> further
          (e.g.
          <code>4320</code> for 72h) until the campaign settles.
        </li>
        <li>
          Subscribe to{" "}
          <a
            href="https://github.com/advisories"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Security Advisories
          </a>{" "}
          for your dependency tree.
        </li>
      </ol>

      <h2>Hardening your own GitHub Actions</h2>
      <p>
        If you publish your own application&apos;s artifacts from CI, copy these
        rules:
      </p>
      <ul>
        <li>
          <strong>
            Never use <code>pull_request_target</code>
          </strong>{" "}
          to check out fork code.
        </li>
        <li>
          <strong>
            Top-level <code>permissions: {`{}`}</code>
          </strong>
          ; opt back in per job.
        </li>
        <li>
          <strong>Pin third-party actions to a commit SHA</strong> (Dependabot
          will keep them updated). A retargeted tag has the same blast radius as
          cache poisoning.
        </li>
        <li>
          <strong>Separate the publish job</strong>. Do not put{" "}
          <code>id-token: write</code> on a workflow that runs untrusted code in
          any earlier step &mdash; OIDC tokens have been pulled from runner
          memory in real attacks.
        </li>
        <li>
          <strong>
            Use <code>step-security/harden-runner</code>
          </strong>{" "}
          on the publish job with <code>egress-policy: block</code> and an
          explicit allowlist.
        </li>
        <li>
          <strong>Use a protected GitHub Environment</strong> (required
          reviewers) for any job that can publish.
        </li>
      </ul>

      <h2>Further reading</h2>
      <ul>
        <li>
          <a
            href="https://www.aikido.dev/blog/quantum-incident-response"
            target="_blank"
            rel="noreferrer"
          >
            Aikido: Quantum incident response
          </a>{" "}
          &mdash; why traditional IR cannot catch an npm worm, and why
          install-time prevention (cooldowns, blocked scripts, malware-feed
          scanners) is the only viable defense.
        </li>
        <li>
          <a
            href="https://tanstack.com/blog/npm-supply-chain-compromise-postmortem"
            target="_blank"
            rel="noreferrer"
          >
            TanStack 2026-05-11 postmortem
          </a>{" "}
          &mdash; the cache-poisoning + OIDC-extraction chain in detail.
        </li>
        <li>
          <a
            href="https://tanstack.com/blog/incident-followup"
            target="_blank"
            rel="noreferrer"
          >
            TanStack incident follow-up
          </a>{" "}
          &mdash; what they changed afterwards.
        </li>
        <li>
          <a
            href="https://securitylab.github.com/research/github-actions-preventing-pwn-requests/"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Security Lab: preventing pwn requests
          </a>
          .
        </li>
        <li>
          <a
            href="https://docs.npmjs.com/generating-provenance-statements"
            target="_blank"
            rel="noreferrer"
          >
            npm provenance documentation
          </a>
          .
        </li>
      </ul>
    </>
  );
}
