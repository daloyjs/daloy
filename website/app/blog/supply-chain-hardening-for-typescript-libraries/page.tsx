import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "supply-chain-hardening-for-typescript-libraries",
  title:
    "Supply-Chain Hardening for TypeScript Libraries: Everything We Did and Why",
  description:
    "A maintainer's field guide to the supply-chain posture we shipped for DaloyJS, .npmrc that says no by default, pnpm 11 workspace keys (blockExoticSubdeps / strictDepBuilds / verifyDepsBeforeRun), SHA-pinned actions, permissions: {}, no Actions cache on installs, zizmor + Scorecard + CodeQL, npm trusted publishing with provenance, and the create-daloy --with-ci bundle that drops the app-safe parts into your project.",
  date: "2026-05-26",
  readingTime: "16 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack work, currently writing TypeScript from a desk in Norway. Has been on the receiving end of two npm-worm news cycles and would prefer not to be on the receiving end of a third.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "supply chain TypeScript",
    "pnpm 11 blockExoticSubdeps",
    "strictDepBuilds",
    "verifyDepsBeforeRun",
    "minimum-release-age",
    "npm trusted publishing provenance",
    "GitHub Actions SHA pin",
    "zizmor Scorecard CodeQL",
    "create-daloy --with-ci",
    "ignore-scripts npmrc",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const NPMRC = `# .npmrc, DaloyJS root npm/pnpm config (supply-chain hardening)

# ---------------------------------------------------------------------------
# Lifecycle scripts
# ---------------------------------------------------------------------------
# Reject preinstall/install/postinstall/prepare hooks from transitive deps.
# This is the primary execution channel in chalk/debug, node-ipc, and the
# Shai-Hulud worm campaigns. Anything that legitimately needs to build (esbuild)
# is on an explicit allowlist via pnpm-workspace.yaml allowBuilds.
ignore-scripts=true

# ---------------------------------------------------------------------------
# Install integrity
# ---------------------------------------------------------------------------
frozen-lockfile=true
verify-store-integrity=true
prefer-frozen-lockfile=true
strict-peer-dependencies=true
auto-install-peers=false

# ---------------------------------------------------------------------------
# Release-age cooldown
# ---------------------------------------------------------------------------
# Wait 24h (1440 minutes) before installing a freshly published version.
# Most worm campaigns are detected and unpublished within hours.
minimum-release-age=1440

# ---------------------------------------------------------------------------
# Registry posture
# ---------------------------------------------------------------------------
registry=https://registry.npmjs.org/
provenance=true

audit-level=moderate
fund=false`;

const PNPM_WORKSPACE = `# pnpm-workspace.yaml, pnpm 11 supply-chain keys
packages:
  - "packages/*"

# Wait 24h before resolving a freshly published version. Mirrors .npmrc.
minimumReleaseAge: 1440

# Only direct dependencies may use exotic sources (git, tarball URLs).
# Transitive deps MUST resolve from the configured registry. This blocks
# the "transitive dep pulled from a hijacked git fork" attack class.
blockExoticSubdeps: true

# Refuse to install any dependency with an unreviewed lifecycle script.
# Packages that genuinely need a build go through allowBuilds, below.
strictDepBuilds: true

# Re-check dependency state before \`pnpm run\` / \`pnpm exec\` so scripts
# never run against a stale node_modules - which is how cache-poisoning
# chains achieve persistence on CI.
verifyDepsBeforeRun: install

# Explicit allowlist of packages permitted to run install scripts. New
# entries require a PR that explains *why* the package needs to build.
allowBuilds:
  esbuild: true`;

const RELEASE_WORKFLOW = `# .github/workflows/release.yml, npm publish with OIDC + provenance
name: release

on:
  push:
    tags: ["v*"]

# Top-level permissions: deny everything by default. Each job opts in.
# This is the single most important line in this file.
permissions: {}

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v5
        with:
          persist-credentials: false
      - name: Setup pnpm
        uses: pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4
      - name: Setup Node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
        with:
          node-version: 20
          # NOTE: deliberately no \`cache: pnpm\` - the GHA cache is a known
          # exfiltration channel and a known persistence channel.
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm coverage

  publish:
    name: publish
    needs: verify
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: npm-publish # manual approval gate
    permissions:
      contents: read
      # id-token: write is required by npm trusted publishing (OIDC).
      # It is granted on THIS job only - never to verify, never globally,
      # and never on a workflow that a fork PR could run.
      id-token: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v5
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - name: Publish to npm with provenance
        run: pnpm publish --access public --no-git-checks --provenance
        env:
          NPM_CONFIG_PROVENANCE: "true"
          # NOTE: no NODE_AUTH_TOKEN. Trusted publishing gets the credential
          # from the OIDC exchange. Long-lived npm tokens have been retired.`;

const ZIZMOR_WORKFLOW = `# .github/workflows/zizmor.yml, static analysis on the workflows themselves
name: zizmor
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions: {}
jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v5
        with: { persist-credentials: false }
      - name: Run zizmor
        uses: woodruffw/zizmor-action@0c4ee94d3ea53cd6fd34a05dd07a4ba14e1f9b4c # v0.4.1
        with: { upload-sarif: true }`;

const SCORECARD_WORKFLOW = `# .github/workflows/scorecard.yml, OpenSSF Scorecard weekly
name: scorecard
on:
  branch_protection_rule:
  schedule: [{ cron: "30 5 * * 0" }]
  push: { branches: [main] }
permissions: {}
jobs:
  analysis:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write   # only for publishing the result
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with: { persist-credentials: false }
      - uses: ossf/scorecard-action@62b2cac7ed8198b15735ed49ab1e5cf35480ba46 # v2.4.0
        with: { results_file: results.sarif, results_format: sarif, publish_results: true }
      - uses: github/codeql-action/upload-sarif@4f3212b61783c3c68e8309a0f18a699764811cda
        with: { sarif_file: results.sarif }`;

const VERIFY_LOCKFILE = `// scripts/verify-lockfile-sources.mjs, run in CI before install
// Catches "registry override sneaks into pnpm-lock.yaml" attacks.

import { readFileSync } from "node:fs";

const lock = readFileSync("pnpm-lock.yaml", "utf8");
const FORBIDDEN = [
  /resolution:\\s*\\{\\s*tarball:/, // direct tarball URL in a transitive resolution
  /resolution:\\s*\\{\\s*git:/,     // git resolution in a transitive dep
  /registry:\\s*['"]?(?!https:\\/\\/registry\\.npmjs\\.org\\/)/, // any non-npm registry
];

const offenders = FORBIDDEN.flatMap((re) => {
  const matches = lock.match(new RegExp(re, "g")) ?? [];
  return matches.map((m) => ({ re: re.source, snippet: m }));
});

if (offenders.length > 0) {
  console.error("Forbidden resolutions in pnpm-lock.yaml:");
  for (const o of offenders) console.error(" ", o.re, "→", o.snippet);
  process.exit(1);
}
console.log("Lockfile sources OK.");`;

const CREATE_DALOY_CI = `# Scaffold a new app with the app-safe posture baked in.
pnpm create daloy@latest my-api \\
  --template node-basic \\
  --with-ci \\
  --code-owner @acme/security

# What this drops into the new repo:
#   .github/workflows/ci.yml         - pinned actions, no cache, --ignore-scripts
#   .github/workflows/codeql.yml     - TS/JS static analysis
#   .github/workflows/deploy.yml     - manual-only app deployment starter
#   .github/workflows/container-scan.yml - runs Trivy scans on your dockerfile
#   .github/workflows/scorecard.yml  - weekly OpenSSF Scorecard
#   .github/workflows/vuln-scan.yml  - checks for known vulnerabilities
#   .github/workflows/zizmor.yml     - workflow lint on every push
#   .github/dependabot.yml           - weekly bumps, grouped by ecosystem
#   .github/CODEOWNERS               - @acme/security on workflow files
#   SECURITY.md                      - disclosure policy + supported versions
#   scripts/verify-lockfile-sources.mjs - the script above, runnable as
#                                        pnpm verify:lockfile`;

const ATTACK_PATHS = `# A short, opinionated map of the attack paths the above shuts down:

attack path                                 → blocked by
------------------------------------------- -----------------------------------
Malicious postinstall in a transitive dep   → ignore-scripts + strictDepBuilds
Hijacked package published as a new patch   → minimum-release-age=1440
Transitive dep swapped for a git/tarball    → blockExoticSubdeps
Stale node_modules survives an attack PR    → verifyDepsBeforeRun
GitHub Actions @v1 silently rolls to evil   → SHA-pinned actions (every step)
GHA cache contains an attacker's payload    → no \`cache: pnpm\` on install
Workflow accidentally gets contents: write  → top-level permissions: {}
Workflow exfiltrates secrets to an attacker → zizmor checks for it, blocks PR
Long-lived npm token leaks from a runner    → trusted publishing (OIDC) only
Build artifacts can't be traced to a commit → --provenance attaches a Sigstore
                                              attestation to every publish
Lockfile silently picks a wrong registry    → verify-lockfile-sources.mjs in CI`;

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

function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * ControlCard - three-column card per hardening control.
 */
function ControlCard({
  name,
  blocks,
  cost,
}: {
  name: string;
  blocks: string;
  cost: string;
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="text-base font-semibold tracking-tight">{name}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            blocks
          </div>
          <p className="mt-1 text-sm">{blocks}</p>
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            cost to you
          </div>
          <p className="mt-1 text-sm">{cost}</p>
        </div>
      </div>
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
            <Badge variant="outline">Maintainer notes</Badge>
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
            Hi, Devlin. Ten years of fullstack, currently in Norway, currently
            wishing I could un-read the changelogs of three different npm worm
            campaigns. The 2025 and 2026 supply-chain news has been
            <em>rough</em>
            {": "}chalk/debug, node-ipc, Shai-Hulud, TanStack, and if you
            maintain a TypeScript library that other people install, you
            probably had the same thought I did:{" "}
            <em>
              this could&apos;ve been me, and I&apos;m not actually sure my
              defaults would&apos;ve saved me
            </em>
            {"."}
          </p>

          <p>
            So this post is the maintainer-facing writeup of every supply-chain
            control we shipped for DaloyJS, plus the
            <code>create-daloy --with-ci</code> flag that drops the app-safe
            pieces into a brand-new user project. Nothing here is
            DaloyJS-specific, these are reusable defaults for pnpm-based
            TypeScript projects in 2026. Steal what you need.
          </p>

          <h2>The mental model: deny by default, opt in deliberately</h2>

          <p>
            Every control below is a variant of the same trick: take a
            permissive default that the ecosystem ships, flip it to{" "}
            <em>deny</em>
            {", "}and add a small allowlist for the legitimate cases. Lifecycle
            scripts go from &quot;run all of them silently&quot; to{" "}
            <em>
              none of them, except <code>esbuild</code>
            </em>
            {". "}GitHub Actions permissions go from <em>everything</em> to{" "}
            <em>
              nothing, except <code>contents: read</code> on these specific jobs
            </em>
            {". "}NPM tokens go from{" "}
            <em>long-lived, attached to a human account</em> to{" "}
            <em>
              none, ever, the runner does an OIDC exchange at publish time
            </em>
            {". "}The pattern repeats. Once you internalize it, the config
            writes itself.
          </p>

          <h2>Layer 1: .npmrc, the gate everything passes through</h2>

          <p>
            This file runs on every contributor&apos;s laptop and on every CI
            run. If you only fix one file in your repo, fix this one.
          </p>

          <EditorFrame
            files={[".npmrc"]}
            activeFile=".npmrc"
            status="ignore-scripts · minimum-release-age=1440 · provenance · frozen"
          >
            <CodeBlock language="bash" code={NPMRC} />
          </EditorFrame>

          <p>
            Three lines do most of the work. <code>ignore-scripts=true</code>{" "}
            stops every transitive postinstall hook, the canonical execution
            channel for the recent worm campaigns.{" "}
            <code>frozen-lockfile=true</code> makes a tampered lockfile cause an
            install failure, not a silent &quot;sure, let me grab a different
            version&quot;. <code>minimum-release-age=1440</code> says
            &quot;don&apos;t install anything published in the last 24
            hours&quot;, which is the single most effective filter against worm
            campaigns because they are typically detected and unpublished within
            hours.
          </p>

          <h2>Layer 2: pnpm 11 workspace keys</h2>

          <p>
            pnpm 11 added a set of workspace-level keys that complement
            <code>.npmrc</code> and let you encode supply-chain intent at the
            workspace boundary, not the per-process boundary. We use all of
            them.
          </p>

          <EditorFrame
            files={["pnpm-workspace.yaml"]}
            activeFile="pnpm-workspace.yaml"
            status="blockExoticSubdeps · strictDepBuilds · verifyDepsBeforeRun · allowBuilds"
          >
            <CodeBlock language="bash" code={PNPM_WORKSPACE} />
          </EditorFrame>

          <ControlCard
            name="blockExoticSubdeps: true"
            blocks="A transitive dep specified as a git URL or tarball. That's how a hijacked maintainer's GitHub fork has been smuggled into apps before, the direct dep on npm looks clean, the transitive one resolves to a git fork the attacker controls."
            cost="Approximately zero. If you genuinely need a git dep, declare it directly. Indirect git deps are almost never intentional."
          />

          <ControlCard
            name="strictDepBuilds: true"
            blocks="Any dep with an unreviewed install script. Combined with allowBuilds: { esbuild: true }, every other build-time script in the dep graph fails the install loud and proud."
            cost="The first time you add a new dep with a postinstall, you have to add it to allowBuilds. That's a feature."
          />

          <ControlCard
            name="verifyDepsBeforeRun: install"
            blocks="A stale node_modules persisting across a malicious PR being merged and reverted. Every pnpm run / pnpm exec re-validates the install state first."
            cost="A handful of ms per script invocation. You will not notice."
          />

          <h2>Layer 3: GitHub Actions: three rules that matter</h2>

          <p>
            Most of the Actions security advice on the internet is some variant
            of <em>be careful</em>
            {", "}which is not advice. Three rules are concrete:
          </p>

          <ol>
            <li>
              <strong>
                Top-level <code>permissions: &#123;&#125;</code>
              </strong>
              {". "}Every workflow starts with zero scopes. Each job opts in to
              the minimum it needs. <code>id-token: write</code> in particular
              is granted on the publish job only, it&apos;s the credential the
              TanStack attackers extracted in 2026-05.
            </li>
            <li>
              <strong>SHA-pin every action</strong>
              {". "}Not <code>@v4</code>
              {", "}not <code>@main</code>
              {", "}the full 40-character commit SHA. The comment after it (
              <code># v4</code>) is for humans. Dependabot keeps the SHAs
              updated.
            </li>
            <li>
              <strong>
                No <code>cache: pnpm</code> on the install step
              </strong>
              {". "}The GitHub Actions cache has been used as both an
              exfiltration channel and a persistence channel. Cold installs in
              CI cost ~30s. Pay them.
            </li>
          </ol>

          <p>
            The full release workflow is what those three rules look like in
            practice:
          </p>

          <EditorFrame
            files={[".github/workflows/release.yml"]}
            activeFile=".github/workflows/release.yml"
            status="permissions:{} · SHA-pinned · no cache · trusted publishing"
          >
            <CodeBlock language="bash" code={RELEASE_WORKFLOW} />
          </EditorFrame>

          <h2>Layer 4: static analysis on the workflows themselves</h2>

          <p>
            You can write the most carefully locked-down workflow on earth and
            someone will paste a snippet from a blog post and re-introduce{" "}
            <code>contents: write</code> on a PR-triggered job. The fix is to{" "}
            <em>lint your workflows</em>
            {", "}the way you lint your code. <code>zizmor</code> is the tool
            I&apos;ve been pleased with: it catches missing permissions,
            unpinned actions, dangerous <code>pull_request_target</code> usage,
            and a long list of paper-cut security smells.
          </p>

          <EditorFrame
            files={[".github/workflows/zizmor.yml"]}
            activeFile=".github/workflows/zizmor.yml"
            status="zizmor · uploads SARIF to GitHub code scanning"
          >
            <CodeBlock language="bash" code={ZIZMOR_WORKFLOW} />
          </EditorFrame>

          <h2>Layer 5: continuous scoring: Scorecard + CodeQL</h2>

          <p>
            <strong>OpenSSF Scorecard</strong> gives you a weekly numeric score
            of your security posture across ~18 checks (signed releases, branch
            protection, dependency update tools, etc). It&apos;s not perfect;
            it&apos;s a useful trend line. <strong>CodeQL</strong> is
            GitHub&apos;s built-in static analysis for TS/JS. Both upload SARIF
            to the same code-scanning UI, which keeps the noise in one place.
          </p>

          <EditorFrame
            files={[".github/workflows/scorecard.yml"]}
            activeFile=".github/workflows/scorecard.yml"
            status="weekly cron · publishes results to scorecard.dev"
          >
            <CodeBlock language="bash" code={SCORECARD_WORKFLOW} />
          </EditorFrame>

          <h2>Layer 6: trusted publishing + provenance: bye, npm tokens</h2>

          <p>
            For most of npm&apos;s history, publishing meant{" "}
            <code>NODE_AUTH_TOKEN</code> sitting in GitHub Actions secrets. That
            token is the keys to the kingdom: anyone with it can publish
            anything to your package. When it leaks, and tokens leak, the
            attacker has minutes before anyone notices.
          </p>

          <p>
            Trusted publishing is the fix. Your npm account configures a trust
            policy that says &quot;this exact GitHub repo, this exact workflow,
            this exact environment&quot;. At publish time the runner does an
            OIDC exchange and gets a one-shot, short-lived credential.{" "}
            <strong>You delete all long-lived npm tokens.</strong> They cannot
            leak if they do not exist.
          </p>

          <p>
            <code>--provenance</code> is the companion: every published tarball
            gets a Sigstore attestation that records the exact commit SHA,
            workflow file, and runner that produced it. Consumers can verify
            that an install is from the source you claim it is. (
            <code>npm</code> verifies provenance automatically on install for
            packages that publish it.)
          </p>

          <h2>Layer 7: lockfile source verification</h2>

          <p>
            One last paranoid layer. <code>pnpm-lock.yaml</code> can record a
            non-npm registry, a git URL, or a raw tarball URL for any
            resolution. A malicious PR can change a single resolution and the
            install will silently succeed. This script catches that:
          </p>

          <EditorFrame
            files={["scripts/verify-lockfile-sources.mjs"]}
            activeFile="scripts/verify-lockfile-sources.mjs"
            status="run before install in CI · grep is plenty here"
          >
            <CodeBlock language="ts" code={VERIFY_LOCKFILE} />
          </EditorFrame>

          <p>
            It&apos;s 20 lines and it has caught a real PR mistake (not
            malicious, a contributor pasted a tarball URL into a{" "}
            <code>packageManager</code> override). Worth the 20 lines.
          </p>

          <h2>The shortcut: create-daloy --with-ci</h2>

          <p>
            All of the above is reusable, and reusable should mean{" "}
            <em>one command, you have it</em>
            {". "}So we wired it into the scaffolder:
          </p>

          <EditorFrame
            files={["~/.pnpm/global/bin/create-daloy"]}
            activeFile="~/.pnpm/global/bin/create-daloy"
            status="--with-ci is default Y · --code-owner adds CODEOWNERS"
          >
            <CodeBlock language="bash" code={CREATE_DALOY_CI} />
          </EditorFrame>

          <p>
            <code>--with-ci</code> defaults to <em>yes</em>
            {". "}The scaffolded project starts with the application-safe
            posture this post describes: the <code>.npmrc</code>
            {", "}the <code>pnpm-workspace.yaml</code> keys, every workflow
            SHA-pinned with <code>permissions: &#123;&#125;</code>
            {", "}CODEOWNERS, Dependabot, SECURITY.md, and{" "}
            <code>verify-lockfile-sources.mjs</code> as a{" "}
            <code>pnpm verify:lockfile</code> script. You don&apos;t opt into
            security; you opt out of it (with <code>--no-ci</code>) if you
            insist. It does not generate an npm publish workflow, because a
            scaffolded Daloy app is a service, not a library release train.
          </p>

          <h2>The attack-path map, in one screen</h2>

          <p>
            This is the cheat sheet I keep open when I&apos;m reviewing a new
            repo&apos;s security posture. Each row is an attack class. Whichever
            rows on the right are missing, that&apos;s your work list.
          </p>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="print and pin to the laptop · or steal for your wiki"
          >
            <CodeBlock language="bash" code={ATTACK_PATHS} />
          </EditorFrame>

          <h2>
            What this <em>doesn&apos;t</em> protect you from
          </h2>

          <p>
            Honest section. Supply-chain hardening protects against{" "}
            <em>install-time</em> and <em>build-time</em> compromise. It does
            nothing for runtime vulnerabilities in your own code, write tests,
            run CodeQL, treat input as untrusted. It does nothing for a
            maintainer&apos;s laptop being compromised, use a hardware key,
            separate publish identities, and read the audit log of your npm
            account every so often. And it does nothing for the case where your{" "}
            <em>upstream</em> language ecosystem ships a bad release, the{" "}
            <code>minimum-release-age</code> cooldown helps with that, but
            isn&apos;t a guarantee. Layered defenses, applied where the cost is
            reasonable.
          </p>

          <p>
            Honest section, part two: I have absolutely shipped a supply-chain
            footgun. Not recently, but it happened. The version of this post I
            wish I&apos;d read five years ago is the one I tried to write here.
            I hope it lands for at least one other maintainer who opens their{" "}
            <code>.npmrc</code> today and finds <code>ignore-scripts</code>{" "}
            isn&apos;t there.
          </p>

          <h2>Steal the config</h2>

          <p>
            Every file in this post is open-source in the DaloyJS repo and comes
            with comments that explain <em>why</em>
            {", "}not just
            <em>what</em>
            {". "}The best place to start is <code>.npmrc</code> +{" "}
            <code>pnpm-workspace.yaml</code>; the next best place is to copy{" "}
            <code>.github/workflows/release.yml</code> and adapt the package
            name if you are publishing a library. For an app, run{" "}
            <code>pnpm create daloy@latest --with-ci</code> and cherry-pick from
            the generated CI and deploy starters.
          </p>

          <p>
            The full discussion of the trade-offs is in{" "}
            <Link href="/docs/security/supply-chain">
              the supply-chain docs
            </Link>
            {", "}and the broader{" "}
            <Link href="/docs/security">security overview</Link> shows how this
            slots in with sessions, CSRF, and CSP.
          </p>

          <p>
            Thanks for reading. Now go grep your <code>.github/workflows</code>{" "}
            for <code>@v</code> and replace each one with the SHA. I&apos;ll
            wait. (It&apos;s tedious for ten minutes and then you&apos;re done,
            forever, until Dependabot does it for you.)
          </p>

          <p>Devlin</p>
        </div>

        <Separator className="my-12" />

        <footer className="not-prose">
          <div className="rounded-xl border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">{POST.author}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {POST.authorBio}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link
                href="/docs/security/supply-chain"
                className="underline underline-offset-4"
              >
                Read the supply-chain docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/docs/scaffolder"
                className="underline underline-offset-4"
              >
                create-daloy reference
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link href="/blog" className="underline underline-offset-4">
                More posts
              </Link>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}
