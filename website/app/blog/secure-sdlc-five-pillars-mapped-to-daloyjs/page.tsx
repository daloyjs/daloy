import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "secure-sdlc-five-pillars-mapped-to-daloyjs",
  title: "The 5 Pillars of a Secure SDLC, Mapped to DaloyJS",
  description:
    "Aikido's 'Secure SDLC Explained' lists the five pillars every engineering team needs, Visibility, Early Feedback, Developer Adoption, Consistency, Actionability. Here's the honest per-pillar mapping of what a DaloyJS app and its create-daloy scaffold already give you on day one, what you still configure, and the few items no framework can own.",
  date: "2026-06-12",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "Secure SDLC",
    "SSDLC",
    "Aikido secure SDLC",
    "Secure software development lifecycle",
    "DaloyJS security",
    "SBOM CycloneDX",
    "CI security gates",
    "Shift left security",
    "SOC 2 ISO 27001 SSDLC",
    "Supply chain hardening TypeScript",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SBOM_SCRIPT = `# Generated on every release of @daloyjs/core, and shipped to users
# via the create-daloy templates so their repo gets the same treatment.
pnpm sbom            # writes a CycloneDX SBOM (sbom.cdx.json)
pnpm verify:sbom     # fails CI if the SBOM is missing or stale
pnpm osv-scan        # runs OSV-Scanner against the lockfile (CI)
pnpm vuln-scan       # daily scheduled - surfaces newly disclosed CVEs
                     # even when no PR is open (SOC 2 CC7.1 evidence)`;

const VERIFY_GATES = `# Repo-wide CI gates DaloyJS runs on every PR and ships into every
# scaffolded create-daloy project. None of these are aspirational -
# a failure blocks the merge button.
pnpm verify:no-leaked-credentials       # AWS / GCP / GH / npm tokens
pnpm verify:secret-comparisons          # all secret compares use timingSafeEqual
pnpm verify:no-encoded-payloads         # base64 smuggling
pnpm verify:no-invisible-unicode        # Trojan Source / zero-width / bidi
pnpm verify:no-remote-exec              # no curl|sh, no eval(fetch(...))
pnpm verify:no-lifecycle-scripts        # no install/postinstall/prepare
pnpm verify:no-registry-exfiltration    # no sneaky POSTs to a registry
pnpm verify:no-runtime-deps             # @daloyjs/core ships ZERO runtime deps
pnpm verify:no-weak-random              # Math.random() banned for secrets
pnpm verify:no-unsafe-buffer            # Buffer(n) banned
pnpm verify:no-vulnerable-sandboxes     # vm/sandbox escapes blocked
pnpm verify:actions-pinned              # every GH Action pinned to a SHA
pnpm verify:lockfile-sources            # no git/tarball deps in lockfile
pnpm verify:dep-licenses                # license allow-list
pnpm verify:sbom                        # CycloneDX SBOM generated + signed
pnpm verify:parity-audits               # secure-by-default parity across runtimes
pnpm verify:governance-audits           # security docs in sync
pnpm verify:runtime-parity-audits       # adapter feature parity
pnpm verify:routing-hardening-audits    # router refuses traversal / NUL / //`;

const CI_WORKFLOWS = `# Every project scaffolded with 'pnpm create daloy@latest --with-ci'
# gets these workflows pre-wired in .github/workflows. Pinned to commit
# SHAs, top-level 'permissions: {}', no cache poisoning surface,
# no third-party 'install this tool' actions in the supply chain.
ci.yml              # typecheck + test + the verify:* family on every PR
codeql.yml          # GitHub's SAST engine, weekly + on PR
opengrep.yml        # Aikido's LGPL fork of Semgrep (second SAST engine,
                    #   curated rule packs, binary verified via cosign)
osv-scan.yml        # known-CVE lockfile scan
vuln-scan.yml       # daily 'pnpm audit' against committed lockfile
                    #   (SOC 2 CC7.1 continuous-vulnerability-management)
dast.yml            # weekly OWASP ZAP baseline against the booted app
secret-scan.yml     # gitleaks on PR + daily full-history scan
                    #   (binary verified by SHA-256, not a 3rd-party action)
scorecard.yml       # OpenSSF Scorecard
zizmor.yml          # GitHub Actions workflow auditor
container-scan.yml  # Trivy + hadolint on Dockerfile + image
                    #   (only when scaffolded with a Dockerfile)`;

const SECURE_BY_DEFAULT_CTOR = `// The "developer adoption" win: the safest configuration is the
// default constructor. There is no "production hardening" checklist
// to remember on launch day - the dangerous knobs are off until you
// explicitly turn them on.
import { App } from "@daloyjs/core";

export const app = new App({
  // bodyLimitBytes: 1 << 20,      // default: 1 MiB
  // requestTimeoutMs: 30_000,     // default: 30s
  // production: process.env.NODE_ENV === "production"  // auto-detected
  //   -> in prod, 5xx bodies are redacted, stack traces never leak,
  //      DB error messages never reach the wire.
});

// secureHeaders(), requestId(), problem+json error mapping, prototype-
// pollution-safe JSON parse, CRLF/header-splitting refusal, path-traversal
// rejection, method-confusion 405 (not 404), 415 on unsupported content
// types, __Host-/Secure/HttpOnly/SameSite=Lax cookies - all on by default.`;

const AGENT_FILES = `# The scaffolder ships the rules the agent reads BEFORE generating code.
# This is the "PromptBOM" idea applied to the agent's own context window.
my-app/
├── AGENTS.md                # repo-wide rules: pnpm only, schema-validated
│                            #   routes, no template SQL, where admin lives
├── .github/
│   ├── copilot-instructions.md  # short pointer back to AGENTS.md
│   └── workflows/           # the CI gates above
├── _vscode/
│   └── skills/
│       └── daloyjs-best-practices/SKILL.md   # invoked by the agent
└── scripts/
    └── verify-lockfile-sources.mjs           # local mirror of the gate`;

const PROBLEM_JSON = `HTTP/1.1 413 Payload Too Large
content-type: application/problem+json

{
  "type": "https://daloyjs.dev/problems/payload-too-large",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "Request body exceeded the 1048576 byte limit.",
  "instance": "/orders",
  "requestId": "01J9XP4M2K3W7Z8V0YQHB6T5RC"
}
// Every 4xx / 5xx is RFC 9457 problem+json. The requestId correlates to
// the structured log line your SIEM already indexed, so a finding goes
// from "something failed in prod" to a one-click drill-down in seconds.
// In production, 5xx bodies are redacted by default - no stack traces,
// no internal hostnames, no DB error messages reach the attacker.`;

const SCAFFOLD_SHELL = `# The end-to-end "give my team a Secure SDLC starter kit" command.
# Single line. No follow-up checklist. The five pillars are wired in.
pnpm create daloy@latest my-app --with-ci

# What that gives you:
#   - All 14+ verify:* gates wired into .github/workflows/ci.yml
#   - CodeQL + Opengrep (two SAST engines, different bug classes)
#   - OSV scanner against your lockfile
#   - Daily vuln-scan against the committed lockfile (SOC 2 CC7.1)
#   - Weekly DAST baseline against the booted app
#   - gitleaks secret scan on PR + daily full-history
#   - OpenSSF Scorecard + zizmor (Actions auditor)
#   - Dependabot + CODEOWNERS
#   - SECURITY.md with the patch-SLA table (NIS2 / CRA shaped)
#   - AGENTS.md + a SKILL.md so coding agents read the rules first
#   - Hardened Dockerfile + container-scan workflow (Trivy + hadolint)
#     (when scaffolded with a Dockerfile)`;

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

function PillarCard({
  pillar,
  framework,
  user,
}: {
  pillar: string;
  framework: string;
  user: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{pillar}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You still own
        </dt>
        <dd className="text-muted-foreground">{user}</dd>
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
            <Badge variant="outline">SSDLC</Badge>
            <Badge variant="outline">Field report</Badge>
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
            A reader sent me{" "}
            <a
              href="https://www.aikido.dev/blog/secure-sdlc"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aikido&apos;s &quot;Secure SDLC Explained: The 5 Pillars of a
              Secure Software Development Lifecycle&quot;
            </a>{" "}
            with the same question they always ask:{" "}
            <em>are we doing anything about this?</em>
          </p>

          <p>
            The piece is a fine high-level checklist for CTOs and engineering
            leaders. It groups everything a Secure SDLC needs into five pillars,{" "}
            <strong>
              Visibility, Early Feedback, Developer Adoption, Consistency,
            </strong>{" "}
            and <strong>Actionability</strong>
            {": "}and argues, correctly, that &quot;framework alone cannot
            guarantee security&quot;: culture, tools, and consistent processes
            have to line up. Fair. But a framework can absolutely make the right
            process the path of least resistance, and that&apos;s exactly what
            DaloyJS is built to do.
          </p>

          <p>
            Below is the honest per-pillar mapping of what an app built on
            DaloyJS, and scaffolded with{" "}
            <code>pnpm create daloy@latest --with-ci</code>
            {": "}already gives you on day one, what you still configure
            yourself, and the few items no framework can own. The TL;DR: if you
            ship the scaffold, you get four-and-a-half of the five pillars wired
            into a brand-new repo before the first commit. The half you still
            drive is the cultural piece, but the tools don&apos;t fight you on
            it.
          </p>

          <h2>Pillar 1: Visibility</h2>

          <PillarCard
            pillar="Aikido: 'You can't manage security if you can't see it.'"
            framework="CycloneDX SBOM generated and signed on every release. OSV-Scanner against the lockfile in CI. A daily scheduled vuln-scan.yml that runs the package manager's audit against the committed lockfile, so newly-disclosed CVEs are surfaced even when no PR or push has run CI (SOC 2 CC7.1 continuous-vulnerability-management evidence). Per-request structured logs with correlated requestId go to your SIEM. RFC 9457 problem+json error bodies carry the same requestId for one-click drill-down."
            user="Pick the SIEM (Datadog, CloudWatch, Loki, whatever) and wire the structured log stream to it. Decide which alerts page humans and which don't. The framework gives you the structured event surface; the dashboard is yours."
          />

          <CodeBlock language="bash" code={SBOM_SCRIPT} />

          <p>
            The &quot;can you immediately tell whether a new CVE affects
            you?&quot; question is the whole point of the SBOM. Daloy&apos;s
            <code>verify:sbom</code> gate fails the build if the SBOM is missing
            or stale, there is no &quot;we&apos;ll generate one for the
            audit&quot; mode. Every release carries one. Every scaffolded
            project gets the same workflow.
          </p>

          <p>
            On the runtime side, every 4xx / 5xx response is RFC 9457
            problem+json and carries the same <code>requestId</code> that shows
            up in the structured log line:
          </p>

          <CodeBlock language="ts" code={PROBLEM_JSON} />

          <p>
            Full detail:{" "}
            <Link href="/docs/security/supply-chain">
              /docs/security/supply-chain
            </Link>{" "}
            and <Link href="/docs/tracing">/docs/tracing</Link>.
          </p>

          <h2>Pillar 2: Early Feedback</h2>

          <PillarCard
            pillar="Aikido: 'Deliver security findings at the point of code creation, in IDEs, pull requests, and CI/CD, not after deployment.'"
            framework="14+ verify:* CI gates run on every PR and block the merge button on failure. CodeQL + Opengrep run two SAST engines (different bug classes). OSV-Scanner runs against the lockfile. gitleaks scans the diff on PR. The TypeScript compiler + Zod / Valibot / ArkType schemas catch entire vulnerability classes (mass assignment, missing input validation, wrong-type body) at edit time, in the IDE, before the PR is even opened."
            user="Read the PR comments. Don't merge a red build. Don't paste 'allow: ['*']' into fetchGuard() because a test fails, the AGENTS.md asks you not to, but the framework can't physically stop you from disabling a check you wrote."
          />

          <CodeBlock language="bash" code={VERIFY_GATES} />

          <p>And the workflows that run them:</p>

          <CodeBlock language="bash" code={CI_WORKFLOWS} />

          <p>
            The reason there are <em>two</em> SAST engines (CodeQL + Opengrep)
            is the same point Aikido themselves make in their{" "}
            <a
              href="https://www.aikido.dev/blog/ultimate-sast-guide-static-application-security-testing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ultimate SAST Guide</a>
            {": "}different engines catch different bug classes. Running both
            is the recommended layered posture, and the scaffolder gives you
            both with neither sitting in your supply chain as a third-party
            action, Opengrep&apos;s binary is downloaded from a pinned release
            and verified by its sigstore cosign signature before it runs.
          </p>

          <p>
            The DAST half (Pillar 1 + 2 both touch this) is in{" "}
            <code>dast.yml</code>
            {": "}a weekly OWASP ZAP baseline against the booted app, with
            HIGH-risk findings blocking and MEDIUM / LOW / INFO surfaced for
            triage. See Aikido&apos;s{" "}
            <a
              href="https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now"
              target="_blank"
              rel="noopener noreferrer"
            >
              SAST vs DAST
            </a>{" "}
            for why you need both.
          </p>

          <h2>Pillar 3: Developer Adoption</h2>

          <PillarCard
            pillar="Aikido: 'A Secure SDLC is only effective if developers engage with security tools consistently. Tools that disrupt workflows are ignored or bypassed.'"
            framework="The safest configuration is the default constructor. There is no 'production hardening checklist' to remember on launch day, secureHeaders(), problem+json, body limits, request timeouts, prototype-pollution-safe JSON, CRLF refusal, path-traversal rejection, prod-mode redaction, and __Host-/Secure/HttpOnly/SameSite=Lax cookies are all on by default. Schema validation is a route-level requirement, not an afterthought. The scaffolder ships AGENTS.md + a SKILL.md so coding agents (Copilot, Claude, Cursor, GPT) read the rules before generating code."
            user="Use the scaffolder. Don't manually delete the verify:* gates from ci.yml because a postinstall script 'needs' to run. Treat the secure default as the boring one, because it is."
          />

          <CodeBlock language="ts" code={SECURE_BY_DEFAULT_CTOR} />

          <p>
            The &quot;agent reads the rules before it writes code&quot; piece is
            the file layout the scaffolder drops into a brand-new project:
          </p>

          <CodeBlock language="bash" code={AGENT_FILES} />

          <p>
            Aikido&apos;s point is that adoption fails when tooling switches
            context. Daloy&apos;s answer is to put the rules in the file the
            agent already loads into its context window,{" "}
            <Link href="/blog/designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills">
              the AGENTS.md scaffold pattern</Link>
            {", "}and to make the secure default the{" "}
            <em>shortest line of code you can type</em>.
          </p>

          <h2>Pillar 4: Consistency</h2>

          <PillarCard
            pillar="Aikido: 'Apply uniform security standards, policies, and enforcement across all teams, repositories, and languages.'"
            framework="The same verify:* gate set ships in every create-daloy template. The same secure-by-default constructor runs on every supported runtime, Node, Bun, Deno, Cloudflare Workers, Vercel. verify:runtime-parity-audits and verify:parity-audits make sure no adapter drops a security guard. verify:governance-audits keeps the security docs in sync with the code. The whole posture travels with the framework; a new service started this week gets the same gates as a service started last quarter."
            user="Run the scaffolder for every new service. Don't fork the templates and then forget to merge upstream security fixes, the Dependabot config that ships in the scaffold updates @daloyjs/core for you, and a new version usually re-syncs the templates."
          />

          <p>
            The reason this works is the audit framing. Daloy&apos;s
            <code>verify:parity-audits</code>
            {", "}
            <code>verify:runtime-parity-audits</code>
            {", "}and <code>verify:routing-hardening-audits</code> are not
            documentation, they are scripts in <code>scripts/</code> that fail
            the build if a defense exists in one path but not another. The
            framework cannot ship a release where the JWT algorithm allowlist is
            enforced on Node but not on Workers, because the parity gate would
            catch it.
          </p>

          <p>
            Consistency in the user&apos;s app is the same story extended
            outward: the scaffolded project carries the same gates, so a
            ten-service organization that scaffolds each one with{" "}
            <code>pnpm create daloy@latest</code> ends up with ten repos that
            enforce the same standards. ISO 27001 and SOC 2 evidence becomes a
            directory listing, not an interview.
          </p>

          <h2>Pillar 5: Actionability</h2>

          <PillarCard
            pillar="Aikido: 'Turn security findings into clear next steps. Prioritize actionable findings over raw vulnerability data.'"
            framework="problem+json on every 4xx / 5xx, the type URL is a documented page on this site, the requestId correlates to the SIEM log line, the message tells the caller what to fix. For published CVEs in the framework, every advisory is a GitHub Security Advisory with a CVE through GitHub's CNA, and SECURITY.md publishes a CVSS-keyed patch SLA (Critical 48h, High 7d, Medium 30d, Low 90d, measured from triage) so downstream NIS2 / EU CRA procurement clauses have something concrete to point at."
            user="Read the advisories you're subscribed to. Apply the patch within your own deploy window. The framework's SLA covers the upstream release; the consumer's pnpm install is the consumer's deploy event."
          />

          <p>
            Aikido&apos;s point is that &quot;thousands of findings without
            context&quot; means developers either ignore the alerts or fix
            things at random. Daloy&apos;s answer at the framework level is to
            be parsimonious about what it reports. The router does not log a
            warning for every path-traversal attempt, it returns 400 and moves
            on. The body-limit guard does not page anyone, it returns 413. The
            findings that <em>do</em> bubble up to a human come from the verify
            gates (which are binary: red build or green) and the DAST / SAST
            workflows (which are scored). Every one comes with a documented fix.
          </p>

          <p>
            For framework-level vulnerabilities, the{" "}
            <Link href="/docs/security/compliance">compliance docs</Link> spell
            out the per-severity patch SLA, the three timestamps every advisory
            carries (Discovered, Patch available, Fix deployed), and the npm{" "}
            <code>--provenance</code> sigstore attestation that binds the
            published version to the source commit. That&apos;s the evidence
            shape a NIS2-aligned procurement audit asks for, and it&apos;s built
            in.
          </p>

          <h2>The whole thing in one shell command</h2>

          <CodeBlock language="bash" code={SCAFFOLD_SHELL} />

          <p>
            One command. Day-one coverage for four-and-a-half of the five
            pillars. The half you still drive is the &quot;does the team
            actually use the tools&quot; piece, and the AGENTS.md the scaffolder
            drops keeps even the coding agent honest.
          </p>

          <h2>What we honestly do not do</h2>

          <ul>
            <li>
              We do not run the ASPM dashboard. Aikido (and Snyk, and Wiz, and
              Semgrep, and a dozen others) sell that piece, and they do it well.
              Daloy gives you the structured signal, SBOMs, SARIF, problem+json
              with requestId, OpenAPI 3.1, that an ASPM tool ingests. Pick one
              and point it at the repo.
            </li>
            <li>
              We do not enforce the cultural side of a Secure SDLC: code review
              discipline, threat modeling, post-incident reviews, security
              champions in every team. Those are organizational practices, not
              framework primitives. What we do is make the framework boring
              enough that a thoughtful reviewer can focus on business logic
              instead of catching the same five bugs every PR.
            </li>
            <li>
              We do not chase 100% line coverage on every defensive branch. The
              repo runs <code>pnpm coverage</code> (90% lines / 90% functions)
              and <code>pnpm coverage:branches</code> (92% branches on compiled
              JS), and the README is clear that writing throwaway tests for
              unreachable <code>catch</code> blocks is not worth blocking a
              release on. Security gates that cannot be unit-tested (signal
              handlers, OS-level shutdown races) are documented instead.
            </li>
            <li>
              We do not stop you from disabling a guard in your own app. The
              verify gates run in <em>your</em> CI; if you remove the workflow
              file, they don&apos;t run. The framework&apos;s job is to ship the
              safe defaults and the agent-readable rules, the merge-button
              discipline is on the team.
            </li>
          </ul>

          <h2>The honest answer to the original question</h2>

          <p>
            <em>Are we doing anything about the Secure SDLC five pillars?</em>{" "}
            Yes, the framework, the scaffolder, and the templates were designed
            against this exact shape of checklist. Aikido&apos;s five-pillar
            framing maps one-for-one onto primitives that already ship today:
            SBOM + vuln-scan for Visibility, the verify:* family + DAST + dual
            SAST for Early Feedback, the secure-by-default constructor +
            AGENTS.md for Developer Adoption, the parity-audit gates + uniform
            templates for Consistency, and problem+json + GHSA + the CVSS-keyed
            SLA in SECURITY.md for Actionability.
          </p>

          <p>
            What the framework cannot do is the culture, but the framework also
            stops being the bottleneck. The team can spend its security
            attention on threat modeling and review, not on remembering to set{" "}
            <code>SameSite=Lax</code> or chasing the next <code>chalk</code>
            -style postinstall worm.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>
            {", "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              Supply-chain hardening for TypeScript libraries</Link>
            {", "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security</Link>
            {", "}
            <Link href="/blog/cloud-security-architecture-mapped-to-daloyjs">
              Cloud Security Architecture, Mapped</Link>
            {", "}
            <Link href="/blog/owasp-top-10-agentic-applications-mapped-to-daloyjs">
              OWASP Top 10 for Agentic Applications, Mapped</Link>
            {", "}
            <Link href="/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds">
              Scaffolding a production-ready DaloyJS app in 60 seconds</Link>
            {". "}Relevant docs:{" "}
            <Link href="/docs/security">/docs/security</Link>
            {", "}
            <Link href="/docs/security/supply-chain">supply chain</Link>
            {", "}
            <Link href="/docs/security/compliance">compliance</Link>
            {", "}
            <Link href="/docs/security/runtime-protections">
              runtime protections</Link>
            {", "}
            <Link href="/docs/security/secure-defaults">secure defaults</Link>
            {"."}
          </p>
        </div>
      </article>
    </main>
  );
}
