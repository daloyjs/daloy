import { CodeBlock } from "../../../../components/code-block";

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
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Supply-chain security</h1>
      <p>
        npm worm campaigns ship in waves &mdash; <code>chalk</code>/<code>debug</code> in
        September 2025, <code>node-ipc</code> in May 2026, the @tanstack/* compromise on
        2026-05-11. The pattern is consistent: a single phished maintainer or one CI
        cache-poisoning bug becomes thousands of downstream installs in minutes. DaloyJS
        is built and shipped with that threat model in mind, and we recommend the same
        defaults for your project.
      </p>

      <h2>How DaloyJS itself is published</h2>
      <ul>
        <li>
          <strong>Releases run in a separate workflow</strong> (<code>release.yml</code>)
          that is triggered <em>only</em> by a signed tag push and gated by a protected
          GitHub Environment requiring maintainer approval. Fork PRs cannot touch it.
        </li>
        <li>
          <strong>npm trusted publishing (OIDC) with <code>--provenance</code></strong>:
          every <code>@daloyjs/core</code> tarball is bound to its source commit and
          workflow run via Sigstore. There is no long-lived <code>NPM_TOKEN</code> in
          repo secrets to steal.
        </li>
        <li>
          <strong><code>id-token: write</code> is granted only to the publish job</strong>,
          on the post-approval runner, with egress blocked to everything except npm,
          GitHub, and Sigstore (via <code>step-security/harden-runner</code>).
        </li>
        <li>
          <strong>No GitHub Actions cache</strong> in the standard CI workflow. Cache
          scope bridges fork PRs and pushes to <code>main</code>, which is the
          poisoning channel that bridged TanStack&apos;s PR pipeline into its release
          pipeline.
        </li>
        <li>
          <strong>No <code>pull_request_target</code></strong> &mdash; ever. The
          repository has a <code>zizmor</code> check on every PR that fails the build
          if anyone ever adds it.
        </li>
        <li>
          <strong>Third-party GitHub Actions are SHA-pinned</strong> so a retargeted
          version tag cannot silently change what CI executes.
        </li>
        <li>
          <strong>CodeQL, OpenSSF Scorecard, Dependabot</strong> all run continuously,
          and <code>CODEOWNERS</code> blocks any change to <code>.github/</code>,
          <code>package.json</code>, the lockfile, or <code>.npmrc</code> without a
          maintainer review.
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

      <h2>Defaults you get from <code>pnpm create daloy</code></h2>
      <p>
        Every project scaffolded with <code>create-daloy</code> ships with an
        <code>.npmrc</code> that turns on the install-time controls below. Keep them on.
      </p>
      <CodeBlock
        language="ini"
        code={`# .npmrc — shipped by create-daloy

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

      <h2>If you legitimately need a postinstall</h2>
      <p>
        <code>ignore-scripts=true</code> is global. To allow a build script for a
        package you actually trust (e.g. <code>esbuild</code>), allowlist it explicitly
        in <code>package.json</code>:
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
        This is the same pattern DaloyJS uses in its own root <code>package.json</code>.
        Each entry should be reviewed in PR.
      </p>

      <h2>What to do if a maintainer account is phished</h2>
      <p>
        The September 2025 chalk/debug compromise started with a single fake{" "}
        <code>npmjs.help</code> 2FA-reset email. If you suspect a maintainer (yours or
        an upstream&apos;s) was phished:
      </p>
      <ol>
        <li>
          Pin every direct dependency that lists the affected maintainer to the last
          known-good version in your lockfile.
        </li>
        <li>
          <code>pnpm audit --prod</code> and rotate any deployment credential the
          install host had access to (npm token, GitHub token, AWS keys, SSH keys).
        </li>
        <li>
          Bump <code>minimum-release-age</code> in <code>.npmrc</code> further (e.g.
          <code>4320</code> for 72h) until the campaign settles.
        </li>
        <li>
          Subscribe to <a href="https://github.com/advisories" target="_blank" rel="noreferrer">GitHub Security Advisories</a>{" "}
          for your dependency tree.
        </li>
      </ol>

      <h2>Hardening your own GitHub Actions</h2>
      <p>If you publish your own application&apos;s artifacts from CI, copy these rules:</p>
      <ul>
        <li>
          <strong>Never use <code>pull_request_target</code></strong> to check out
          fork code.
        </li>
        <li>
          <strong>Top-level <code>permissions: {`{}`}</code></strong>; opt back in per job.
        </li>
        <li>
          <strong>Pin third-party actions to a commit SHA</strong> (Dependabot will
          keep them updated). A retargeted tag has the same blast radius as cache
          poisoning.
        </li>
        <li>
          <strong>Separate the publish job</strong>. Do not put <code>id-token: write</code>{" "}
          on a workflow that runs untrusted code in any earlier step &mdash; OIDC
          tokens have been pulled from runner memory in real attacks.
        </li>
        <li>
          <strong>Use <code>step-security/harden-runner</code></strong> on the publish
          job with <code>egress-policy: block</code> and an explicit allowlist.
        </li>
        <li>
          <strong>Use a protected GitHub Environment</strong> (required reviewers) for
          any job that can publish.
        </li>
      </ul>

      <h2>Further reading</h2>
      <ul>
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
