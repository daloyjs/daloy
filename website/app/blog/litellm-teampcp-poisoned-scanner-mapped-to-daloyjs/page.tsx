import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "litellm-teampcp-poisoned-scanner-mapped-to-daloyjs",
  title:
    "When the Security Scanner Is the Attacker: The LiteLLM / TeamPCP Compromise, Mapped to DaloyJS",
  description:
    "On March 24, 2026 the litellm Python package was backdoored after a poisoned Trivy GitHub Action stole the maintainer's PyPI token. The same attack pattern - compromised scanner action -> exfiltrated publish token -> malicious release with a startup-time payload - would have to clear nine of DaloyJS's existing CI gates before it could ship. Here's the stage-by-stage mapping.",
  date: "2026-06-15",
  readingTime: "9 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "LiteLLM supply chain attack",
    "TeamPCP",
    "Trivy GitHub Action compromise",
    "PyPI credential theft",
    "GitHub Actions SHA pinning",
    "npm trusted publishing OIDC",
    "DaloyJS supply chain",
    "ignore-scripts npmrc",
    "minimum-release-age",
    "harden-runner egress audit",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SHA_PINNED = `# .github/workflows/release.yml, every action pinned to a 40-char SHA.
# A maintainer rewriting the v0.69.4 tag on trivy-action does nothing to
# a SHA-pinned reference. 'verify:actions-pinned' fails CI if anyone tries
# to land 'uses: foo/bar@v2' without the resolved commit SHA.
- name: Harden runner
  uses: step-security/harden-runner@ab7a9404c0f3da075243ca237b5fac12c98deaa5 # v2
  with:
    egress-policy: audit

- name: Checkout
  uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
  with:
    persist-credentials: false   # the worker can't push back to origin
    show-progress: false

- name: Set up pnpm
  uses: pnpm/action-setup@ac6db6d3c1f721f886538a378a2d73e85697340a # v6
  with:
    version: 11.1.3
    run_install: false

- name: Set up Node.js
  uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
  with:
    node-version: 24

- name: Install dependencies (no scripts)
  run: pnpm install --frozen-lockfile --ignore-scripts
  env:
    npm_config_ignore_scripts: "true"`;

const SCANNER_ISOLATION = `# .github/workflows, scanners and publish are in SEPARATE workflows,
# in separate jobs, with separate permissions. A scanner job has
# 'contents: read' and never sees a publish credential.
#
#   ci.yml             - pnpm install, typecheck, build, test, audit
#   codeql.yml         - SAST (read-only)
#   opengrep.yml       - SAST (read-only, binary cosign-verified)
#   osv-scan.yml       - SCA (read-only)
#   secret-scan.yml    - gitleaks (read-only)
#   vuln-scan.yml      - pnpm audit on a daily schedule (read-only)
#   scorecard.yml      - OpenSSF Scorecard (read-only)
#   zizmor.yml         - workflow audit (read-only)
#   release.yml        - split into 'verify' (no creds) and 'publish'
#                        (id-token: write, gated on the npm-publish
#                        Environment with manual approval)
#
# Even if a scanner action were compromised the way trivy-action was,
# the runner it executes on never has an npm publish token in scope.
# The publish job has zero scanner steps and zero third-party scanner
# actions - only the four pinned actions above plus 'npm stage publish
# --provenance'.`;

const TRUSTED_PUBLISHING = `# packages.json / release.yml, npm Trusted Publishing via GitHub OIDC.
# No long-lived NPM_TOKEN exists as a repo or org secret. The publish job
# trades the short-lived OIDC token for a single-use publish credential
# inside the gated 'npm-publish' Environment.
#
# Equivalent to what PyPI ships as "Trusted Publishers" - except LiteLLM
# wasn't using it, so a static PYPI_PUBLISH token was sitting in the
# CI environment when the poisoned Trivy action ran.
permissions:
  id-token: write    # ONLY in the publish job, ONLY after env approval
  contents: read

# - Manual approval gate on the 'npm-publish' Environment.
# - Releases require a git tag pushed by a maintainer.
# - Every published artifact carries a Sigstore provenance attestation.`;

const NPMRC = `# .npmrc, what makes "a freshly published bad version" not auto-install.
ignore-scripts=true            # postinstall / preinstall / prepare = no
minimum-release-age=1440       # 24h cooldown; bad versions get unpublished
frozen-lockfile=true
verify-store-integrity=true
strict-peer-dependencies=true
auto-install-peers=false
provenance=true
registry=https://registry.npmjs.org/`;

const VERIFY_GATES = `# Every PR and every release runs these. A poisoned dep would have to
# pass all of them, not just one.
pnpm verify:actions-pinned             # every GH Action pinned to a SHA
pnpm verify:no-lifecycle-scripts       # no install / postinstall / prepare
pnpm verify:no-runtime-deps            # @daloyjs/core has ZERO runtime deps
pnpm verify:no-remote-exec             # no curl|sh, no eval(fetch())
pnpm verify:no-registry-exfiltration   # no sneaky POSTs to a registry URL
pnpm verify:no-encoded-payloads        # no base64 blobs (the 'init.pth' trick)
pnpm verify:no-invisible-unicode       # Trojan Source / zero-width chars
pnpm verify:no-leaked-credentials      # AWS / GCP / GitHub / npm token shapes
pnpm verify:no-weak-random             # no Math.random in security paths
pnpm verify:no-unsafe-buffer           # no Buffer.allocUnsafe
pnpm verify:no-vulnerable-sandboxes    # no vm2 / Function() escape patterns
pnpm verify:no-native-addons           # no .node binaries in the tree
pnpm verify:lockfile                   # lockfile sources are the public registry
pnpm verify:secret-comparisons         # all secret compares use timingSafeEqual
pnpm verify:dep-licenses               # license allowlist
pnpm verify:sbom                       # CycloneDX SBOM generated + checked`;

const HARDEN_RUNNER = `# Every job (scanner OR publish) starts with harden-runner in audit mode.
# That alone would have flagged 'curl POST to models.litellm.cloud' as
# anomalous egress - that domain was registered the day before the
# compromise.
- name: Harden runner
  uses: step-security/harden-runner@ab7a9404c0f3da075243ca237b5fac12c98deaa5 # v2
  with:
    egress-policy: audit          # log every outbound connection
    disable-sudo: true            # no privilege escalation on the runner
    disable-file-monitoring: false`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: { "@type": "Person", name: POST.author },
  publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/blog/${POST.slug}`,
  },
  url: `${SITE_URL}/blog/${POST.slug}`,
};

function StageCard({
  stage,
  litellm,
  daloyjs,
}: {
  stage: string;
  litellm: string;
  daloyjs: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{stage}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          What happened
        </dt>
        <dd>{litellm}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS posture
        </dt>
        <dd className="text-muted-foreground">{daloyjs}</dd>
      </dl>
    </div>
  );
}

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">Supply chain</Badge>
            <Badge variant="outline">Incident mapping</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {POST.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            {POST.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{POST.author}</span>
            <span aria-hidden>·</span>
            <span>{POST.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={POST.date}>
              {dateFormatter.format(new Date(POST.date))}
            </time>
            <span aria-hidden>·</span>
            <span>{POST.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">
          <p>
            A reader sent{" "}
            <a
              href="https://snyk.io/blog/poisoned-security-scanner-backdooring-litellm/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Snyk&apos;s write-up of the LiteLLM / TeamPCP compromise
            </a>
            {". "}Most of the relevant protections were already shipped, so I
            checked the attack stage by stage.
          </p>

          <p>
            For the unfamiliar, the short version: on March 24, 2026, a threat
            actor known as <strong>TeamPCP</strong> published two backdoored
            versions of the <code>litellm</code> Python package (1.82.7 and
            1.82.8) to PyPI. They didn&apos;t hack PyPI. They didn&apos;t guess
            the maintainer&apos;s password. They stole the{" "}
            <code>PYPI_PUBLISH</code> token straight out of LiteLLM&apos;s
            GitHub Actions runner environment via a previously compromised{" "}
            <strong>Trivy GitHub Action</strong>
            {": "}a <em>security scanner</em> that LiteLLM&apos;s CI ran during
            the build. Same trick was used to backdoor Checkmarx KICS a day
            earlier.
          </p>

          <p>
            The payload was a Python <code>.pth</code> file that fires every
            time the interpreter starts, including during{" "}
            <code>pip install</code> itself, harvested SSH keys, cloud
            credentials, kubeconfigs, and crypto wallets, encrypted them with a
            hardcoded RSA key, and POSTed the bundle to{" "}
            <code>models.litellm.cloud</code> (registered the day before). Then
            it installed a systemd persistence service called &quot;System
            Telemetry Service&quot; and, if it found a Kubernetes
            service-account token, deployed privileged pods named{" "}
            <code>node-setup-*</code> to every node in <code>kube-system</code>.
          </p>

          <p>
            DaloyJS runs on Node/TypeScript, so the Python <code>.pth</code>{" "}
            hook does not apply. The <em>attack chain</em>
            {": "}
            poisoned scanner action -&gt; exfiltrated publish token -&gt;
            malicious release that runs at install time, is platform-agnostic,
            and is exactly what every JS framework that publishes to npm has to
            defend against. Here is how each stage maps to what&apos;s already
            in this repo, in the order the attack ran.
          </p>

          <h2>Stage 0: The Trivy tag rewrite (March 19)</h2>

          <StageCard
            stage="Initial compromise"
            litellm="Attackers rewrote the v0.69.4 git tag on the aquasecurity/trivy-action repository to point at a malicious commit. Anyone using 'uses: aquasecurity/trivy-action@v0.69.4' pulled the malicious version on their next CI run."
            daloyjs="Every GitHub Action in this repo is pinned to a 40-character commit SHA, not a tag. A tag rewrite is a no-op. 'verify:actions-pinned' is a release-blocking gate and runs on every PR, landing 'uses: foo/bar@v2' without a resolved SHA fails CI before merge."
          />

          <CodeBlock language="yaml" code={SHA_PINNED} />

          <p>
            This is the single most important defense for this entire attack
            class, and it costs nothing. The Snyk post calls out{" "}
            <em>
              &quot;LiteLLM&apos;s CI/CD pipeline ran Trivy as part of its build
              process, pulling it from apt without a pinned version&quot;
            </em>
            {". "}That sentence describes a class of mistake DaloyJS&apos;s CI{" "}
            <em>cannot</em> make, there are zero <code>apt install</code> calls
            in any workflow, and the only binaries downloaded at runtime
            (opengrep) are cosign-verified against the publisher&apos;s OIDC
            identity before they are executed.
          </p>

          <h2>Stage 1: Token exfiltration from the runner</h2>

          <StageCard
            stage="Credential theft"
            litellm="The compromised Trivy action ran in the same job as the publish step, so it could read PYPI_PUBLISH from the process environment, base64-encode it, and POST it to the attacker's C2 domain."
            daloyjs="Three separate defenses. (1) Scanners and publish are in different workflows; the publish workflow has zero scanner steps. (2) The publish job runs in a GitHub Environment ('npm-publish') gated on manual maintainer approval. (3) Publishing uses npm Trusted Publishing via OIDC, there is no long-lived NPM_TOKEN sitting in repo secrets to steal."
          />

          <CodeBlock language="bash" code={SCANNER_ISOLATION} />

          <CodeBlock language="yaml" code={TRUSTED_PUBLISHING} />

          <p>
            The Snyk post buries the most useful sentence in the whole article:{" "}
            <em>
              &quot;The package passes all standard integrity checks because the
              malicious content was published using legitimate
              credentials.&quot;
            </em>{" "}
            That&apos;s the whole game. If the attacker can&apos;t get the
            credentials, every hash check in the world still passes, because the
            bad version never ships. Removing the long-lived publish token
            removes the prize.
          </p>

          <h2>Stage 2: The install-time payload</h2>

          <StageCard
            stage="Execution on install"
            litellm="litellm 1.82.8 added litellm_init.pth to site-packages/. Python's startup-hook mechanism fires on every interpreter launch, including 'pip install', 'python -c', and IDE language servers, with no import required. pip's hash check passed because the .pth file was correctly listed in the wheel's RECORD."
            daloyjs="npm's equivalent execution vector is lifecycle scripts (preinstall / install / postinstall / prepare). The root .npmrc sets ignore-scripts=true, every CI install runs with --ignore-scripts, and 'verify:no-lifecycle-scripts' rejects PRs that try to add one. The create-daloy templates ship the same .npmrc. There is no in-repo equivalent of the .pth trick, and 'verify:no-encoded-payloads' would also flag a base64-embedded blob the way TeamPCP smuggled theirs."
          />

          <CodeBlock language="ini" code={NPMRC} />

          <p>
            The other half of this defense is the 24-hour{" "}
            <code>minimum-release-age</code> cooldown. The malicious LiteLLM
            versions were on PyPI for <strong>about three hours</strong> before
            PyPI quarantined them. A pnpm install against a registry that honors
            release-age would have refused to fetch them at all. Most worm
            campaigns we&apos;ve seen, chalk, debug, the Shai-Hulud sweeps, are
            caught and unpublished inside the same window.
          </p>

          <h2>Stage 3: Persistence and lateral movement</h2>

          <StageCard
            stage="Persistence + Kubernetes worm"
            litellm="Wrote ~/.config/sysmon/sysmon.py, registered a 'sysmon.service' systemd user unit polling https://checkmarx.zone/raw every 5 minutes. If a Kubernetes service-account token was present, deployed privileged 'node-setup-*' pods to every node in kube-system."
            daloyjs="Once the payload can't run at install time, none of this happens on a build runner, the systemd / pod-deployment behavior never gets a chance. For the runtime side, harden-runner runs in egress-audit mode on every job, so the first 'curl POST to models.litellm.cloud' lands in the workflow log. The publish job specifically sets disable-sudo: true so a runtime payload can't elevate even if one did slip through."
          />

          <CodeBlock language="yaml" code={HARDEN_RUNNER} />

          <h2>Stage 4: The framework&apos;s own dependency surface</h2>

          <StageCard
            stage="Blast radius"
            litellm="litellm is downloaded ~3.4 million times a day and is a transitive dependency of DSPy, MLflow, OpenHands, CrewAI, Phoenix, langwatch, and others, every consumer inherited the .pth."
            daloyjs="@daloyjs/core has zero runtime dependencies. 'verify:no-runtime-deps' fails the build if anyone adds one. The transitive blast radius is, by construction, the size of the framework itself."
          />

          <p>
            This is the single most boring decision in DaloyJS, and it&apos;s
            the one I&apos;m proudest of. Frameworks that pull in 30 transitive
            packages at runtime cannot claim a hardened supply chain; the
            attacker only has to compromise the smallest of those 30. A
            zero-runtime-deps core has exactly one supply-chain target: the core
            itself, published through the gated OIDC pipeline above.
          </p>

          <h2>The full CI gate list, for the receipts</h2>

          <CodeBlock language="bash" code={VERIFY_GATES} />

          <p>
            Every one of those runs in <code>release.yml</code> before{" "}
            <code>npm stage publish</code> ever fires, and most of them run on
            every PR too. None of them are aspirational, a failure blocks merge.
            The full reasoning for each is in{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              the supply-chain hardening post
            </Link>
            {"."}
          </p>

          <h2>What this attack would have needed to do to ship DaloyJS</h2>

          <ol>
            <li>
              Compromise a SHA-pinned action <em>at that exact SHA</em> (tag
              rewrites do nothing). The OIDC trust posture on the publish job
              means even that wouldn&apos;t hand over a usable npm token.
            </li>
            <li>
              Land a PR that adds an unpinned action, blocked by{" "}
              <code>verify:actions-pinned</code>.
            </li>
            <li>
              Land a PR that adds a lifecycle script to <em>any</em> package in
              the tree, blocked by <code>verify:no-lifecycle-scripts</code>.
            </li>
            <li>
              Land a PR that adds a runtime dependency to{" "}
              <code>@daloyjs/core</code>
              {": "}blocked by <code>verify:no-runtime-deps</code>.
            </li>
            <li>
              Sneak in a base64-encoded payload or invisible-unicode trick,
              blocked by <code>verify:no-encoded-payloads</code> and{" "}
              <code>verify:no-invisible-unicode</code>.
            </li>
            <li>
              Trigger a publish without a maintainer approving it in the{" "}
              <code>npm-publish</code> Environment, impossible by design.
            </li>
            <li>
              Beat the 24-hour <code>minimum-release-age</code> cooldown into
              every downstream pnpm install, also impossible by design.
            </li>
          </ol>

          <p>
            A determined attacker may still find another way; security is never
            finished. The path of least resistance in the LiteLLM compromise
            took (rewrite an action tag, steal a static token, ship a release
            that auto-runs on install) is shut on all four steps in this repo.
            That&apos;s the point of secure-by-default: the obvious attack
            doesn&apos;t work, and the non-obvious ones cost real effort.
          </p>

          <h2>What you should do in your own DaloyJS project</h2>

          <ul>
            <li>
              Scaffold with <code>pnpm create daloy@latest --with-ci</code>
              {". "}The generated <code>.github/workflows/</code> and{" "}
              <code>.npmrc</code> already carry the SHA-pinned actions,{" "}
              <code>ignore-scripts</code>
              {", "}
              and 24h release-age cooldown.
            </li>
            <li>
              If you publish your own packages, use npm Trusted Publishing
              (OIDC). Delete any long-lived <code>NPM_TOKEN</code> from repo
              secrets. The blog post linked above has the exact{" "}
              <code>permissions:</code> block.
            </li>
            <li>
              Don&apos;t run third-party security scanners in the same job as
              your publish step. Different workflow, different permissions,
              different runner identity. The LiteLLM team didn&apos;t,
              that&apos;s how they ended up here.
            </li>
            <li>
              Turn on <code>step-security/harden-runner</code> with{" "}
              <code>egress-policy: audit</code> (or{" "}
              <code>egress-policy: block</code> if you know your allow-list).
              That alone would have surfaced the{" "}
              <code>models.litellm.cloud</code> POST in real time.
            </li>
          </ul>

          <h2>Existing protections</h2>

          <p>
            The repository already used SHA-pinned actions, isolated OIDC
            publishing, environment approval, ignored lifecycle scripts, zero
            runtime dependencies, a 24-hour release-age floor, verification
            gates, and egress logging. The LiteLLM attack path would fail at
            several independent steps.
          </p>

          <p>
            None of this is hypothetical. Open <code>.github/workflows/</code>{" "}
            in the repo, run <code>pnpm verify</code> locally, look at the
            commit SHAs on every <code>uses:</code> line. The receipts are in
            the workflow files.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              Supply-chain hardening for TypeScript libraries
            </Link>
            {", "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>
            {", "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe coding security
            </Link>
            {", "}
            <Link href="/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds">
              Scaffolding a production-ready DaloyJS app in 60 seconds
            </Link>
            {". "}Relevant docs:{" "}
            <Link href="/docs/security">/docs/security</Link>
            {", "}
            <Link href="/docs/security/supply-chain">supply chain</Link>.
          </p>
        </div>
      </article>
    </main>
  );
}
