import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "cloud-security-architecture-mapped-to-daloyjs",
  title: "Cloud Security Architecture, Mapped to the DaloyJS App Layer",
  description:
    "Aikido's 'Cloud Security Architecture' guide is a fine high-level checklist — Zero Trust, defense-in-depth, IAM, segmentation, IaC scanning, continuous monitoring. Here's the honest, per-principle mapping of what DaloyJS already ships for the application-layer half of that checklist, what the cloud platform still owns, and the opt-ins worth turning on today.",
  date: "2026-05-23",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "cloud security architecture",
    "Zero Trust DaloyJS",
    "defense in depth Node.js",
    "secure by default framework",
    "supply chain hardening",
    "IAM JWT JWK",
    "structured logging redaction",
    "OWASP API security",
    "NIS2 application layer",
    "Aikido cloud security",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ZERO_TRUST = `// src/app.ts
import { App, jwt, ipRestriction, basicAuth, timingSafeEqual } from "@daloyjs/core";

export const app = new App();

// 1. Every request is authenticated before reaching handlers.
app.use(jwt({
  // Rotates from JWKS — no long-lived shared secrets baked into the image.
  jwksUri: process.env.JWKS_URI!,
  audience: "api.example.com",
  issuer: "https://auth.example.com/",
}));

// 2. Admin surfaces are network-fenced AND credentialed.
app.use(
  "/admin",
  ipRestriction({ allow: ["10.0.0.0/8"] }),
  basicAuth({
    realm: "admin",
    verify: (user, pass) =>
      timingSafeEqual(user, process.env.ADMIN_USER!) &&
      timingSafeEqual(pass, process.env.ADMIN_PASS!)
        ? { sub: "admin" }
        : false,
  }),
);`;

const DEFENSE_IN_DEPTH = `// src/app.ts — every layer here is a separate middleware.
// Removing one does not silently disable the others.
import {
  App,
  secureHeaders,
  rateLimit,
  loadShedding,
  fetchGuard,
  compression,
  cors,
} from "@daloyjs/core";

export const app = new App({
  bodyLimitBytes: 1 << 20,    // L7: bounded reads
  requestTimeoutMs: 30_000,   // L7: bounded duration
});

app.use(secureHeaders());     // L7: CSP nonce, Trusted Types, HSTS, X-CTO
app.use(cors({ origin: ["https://app.example.com"] }));
app.use(loadShedding({ maxConcurrent: 500 })); // L7: brown-out before OOM
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // L7: per-IP throttle
app.use(fetchGuard({ allow: ["https://api.example.com"] })); // L7: egress allow-list
app.use(compression()); // safe defaults — no Brotli on cookies (BREACH-aware)`;

const STRUCTURED_LOGS = `// Structured logs with built-in redaction.
import { logger } from "@daloyjs/core";

app.use(logger({
  // Authorization, cookie, set-cookie, x-api-key are redacted by default.
  // Add anything else your team treats as a secret:
  redactKeys: ["x-internal-token", "sessionId", "creditCard"],
  // JSON output — shippable straight into CloudWatch / GCP / Datadog
  // without a regex-based scrubber in the middle.
  format: "json",
}));`;

const FETCH_GUARD = `// fetchGuard() blocks server-side request forgery (SSRF) at the source.
// It wraps the runtime fetch() so a compromised handler cannot pivot to
// 169.254.169.254 (cloud metadata) or your private VPC ranges.
import { App, fetchGuard } from "@daloyjs/core";

export const app = new App();

app.use(fetchGuard({
  // Explicit egress allow-list. Everything else throws.
  allow: [
    "https://api.example.com",
    "https://*.s3.amazonaws.com",
  ],
  // Always-blocked ranges (defaults — listed for clarity):
  // 169.254.0.0/16, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
  // 192.168.0.0/16, ::1, fc00::/7, etc.
}));`;

const SUPPLY_CHAIN_VERIFY = `# Repository CI gate — these are the framework's "IaC scanners".
# Every PR runs them; any failure blocks merge.
pnpm verify:actions-pinned       # all GitHub Actions pinned to SHA
pnpm verify:dep-licenses         # license allow-list
pnpm verify:no-lifecycle-scripts # no install / postinstall scripts allowed
pnpm verify:no-remote-exec       # no curl|sh, no eval(fetch(...))
pnpm verify:no-leaked-credentials
pnpm verify:no-registry-exfiltration
pnpm verify:no-unsafe-buffer
pnpm verify:no-vulnerable-sandboxes
pnpm verify:no-encoded-payloads  # base64-blob scanner
pnpm verify:no-invisible-unicode # bidi / zero-width Trojan Source defense
pnpm verify:sbom                 # CycloneDX SBOM is generated and signed
pnpm verify:secret-comparisons   # all secret compares use timingSafeEqual`;

const ASSUME_BREACH = `// Assume-breach defaults that DaloyJS turns on without asking:
//
// 1. Production redacts 5xx error bodies — no stack traces over the wire.
// 2. Cookies default to __Host- prefix, Secure, HttpOnly, SameSite=Lax.
// 3. JSON parser strips __proto__ / constructor / prototype keys.
// 4. CRLF injection in user-controlled header values is rejected at write time.
// 5. Path traversal (..%2F, encoded NULs) is rejected before routing.
// 6. Body limit + request timeout are both enforced, even with no Content-Length.
// 7. Compression skips secrets-shaped bodies to avoid BREACH-style oracle attacks.
//
// None of these require a flag. They are the constructor.
new App();`;

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

function PrincipleCard({
  principle,
  framework,
  platform,
}: {
  principle: string;
  framework: string;
  platform: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{principle}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You / your cloud
        </dt>
        <dd className="text-muted-foreground">{platform}</dd>
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
              href="https://www.aikido.dev/blog/cloud-security-architecture"
              target="_blank"
              rel="noopener noreferrer"
            >
              Aikido&apos;s &quot;Cloud Security Architecture&quot; guide
            </a>{" "}
            and asked the only question worth asking when someone hands you a
            security checklist: <em>are we doing any of this?</em> Fair
            question. The piece is a tour of Zero Trust, defense-in-depth, IAM,
            network segmentation, IaC scanning, and continuous monitoring — the
            meat-and-potatoes of modern cloud security architecture.
          </p>

          <p>
            It&apos;s a <em>cloud</em> guide, not a framework guide. A lot of it
            lives at a layer DaloyJS will never touch — VPC peering, S3 bucket
            ACLs, GuardDuty, the AWS Well-Architected Security Pillar. But every
            one of its principles has an <strong>application-layer half</strong>
            , and that half is where a framework lives or dies. Below is the
            honest mapping: what Daloy already gives you for free, what it gives
            you when you opt in, and what stays in the cloud account&apos;s
            lane.
          </p>

          <p>
            Spoiler: if your worry was &quot;does my framework actively
            <em> undermine </em> the architecture in that post,&quot; the answer
            is no. The boring defenses are on by default. The shared-
            responsibility line is drawn cleanly.
          </p>

          <h2>
            Principle 1 — Zero Trust: &quot;never trust, always verify&quot;
          </h2>

          <PrincipleCard
            principle="Verify explicitly · least privilege · assume breach"
            framework="JWT + JWKS middleware with audience/issuer pinning, basic auth wired to timingSafeEqual, per-route auth scopes, IP allow-lists for admin surfaces, signed-cookie sessions with rotating signing keys, production-mode stack-trace redaction in error responses."
            platform="Issuing the JWTs (Okta / Entra / Auth0), enforcing MFA at the IdP, rotating IAM roles, and segmenting accounts/projects."
          />

          <p>
            Zero Trust at the application layer is not a vibe — it&apos;s a
            chain of <em>explicit verification points</em> that don&apos;t
            collapse into &quot;the firewall said it was fine.&quot; Daloy gives
            you the verifying middleware as first-class primitives, so the chain
            is visible in your <code>app.ts</code>:
          </p>

          <CodeBlock language="ts" code={ZERO_TRUST} />

          <p>
            Two non-negotiables worth pointing out: every secret comparison in
            the framework — basic auth, CSRF tokens, session HMAC, webhook
            signatures — runs through <code>timingSafeEqual</code>. There is a
            CI guard (<code>verify:secret-comparisons</code>) that fails the
            build if anyone tries to slip a raw <code>===</code> back in. And
            the JWT middleware refuses unsigned tokens, refuses{" "}
            <code>alg: none</code>, and pins to JWKS by <code>kid</code> — so a
            stolen audience claim doesn&apos;t silently become a master key.
          </p>

          <h2>Principle 2 — Defense-in-depth</h2>

          <PrincipleCard
            principle="Multiple independent layers, any one of which can stop an attack"
            framework="Bounded body reads, request timeouts, CSP nonces, Trusted Types, HSTS, CORS, multi-instance rate limiting (Redis Lua), load shedding, egress fetch guard (SSRF), BREACH-aware compression, prototype-pollution-safe JSON, CRLF & path-traversal rejection."
            platform="Network ACLs, WAF, VPC segmentation, security groups, KMS encryption-at-rest, TLS termination."
          />

          <p>
            The post&apos;s castle analogy — moat, wall, towers, keep — maps
            almost one-for-one to a Daloy middleware pipeline. The point
            isn&apos;t that one layer catches everything; it&apos;s that
            removing one doesn&apos;t silently disable the others:
          </p>

          <CodeBlock language="ts" code={DEFENSE_IN_DEPTH} />

          <p>
            For the deep tour of which of these run with <code>new App()</code>{" "}
            and which require a flag, see the older{" "}
            <Link href="/blog/secure-by-default">
              &quot;Secure by Default&quot;
            </Link>{" "}
            post.
          </p>

          <h2>Principle 3 — Centralize IAM</h2>

          <PrincipleCard
            principle="Federated identity, MFA everywhere, roles not long-lived keys"
            framework="JWKS-based verification (rotation built in), session signing key arrays (rotate without logging users out), no shared-secret defaults baked into the framework, no long-lived API tokens generated for you."
            platform="Pick the IdP. Wire MFA. Use cloud-native role assumption (IRSA, Workload Identity, Managed Identities) so your pods don't hold static keys."
          />

          <p>
            The framework explicitly{" "}
            <strong>does not invent a user system</strong> for you. There is no
            built-in &quot;forgot password&quot; route silently shipped with
            every project, no default admin account, no auto-issued bearer
            token. The thing IAM guides hate most — &quot;the framework&apos;s
            default user table&quot; — does not exist here. You bring an IdP and
            Daloy verifies what it signs.
          </p>

          <p>
            For the secrets that <em>do</em> live in the app (session signing
            key, basic-auth password, webhook HMAC), the framework supports
            multi-value rotation: pass an array of secrets and the oldest one is
            accepted-but-not-issued, so a key rotation is a single deploy with
            no logout storm.
          </p>

          <h2>Principle 4 — Segmented network &amp; SSRF protection</h2>

          <PrincipleCard
            principle="Limit blast radius; secure ingress AND egress"
            framework="fetchGuard() egress allow-list with default-deny on cloud metadata IPs (169.254.169.254) and RFC1918 ranges; CORS allow-lists; ipRestriction() for admin surfaces; per-route mount paths so 'public' and 'internal' apps can be split."
            platform="VPC subnets, security groups, NAT gateways, service mesh mTLS, private endpoints."
          />

          <p>
            The article spends a lot of words on micro-segmentation. The
            application-layer analogue — and the one the cloud guide{" "}
            <em>doesn&apos;t</em> cover — is server-side request forgery. A
            compromised handler that can <code>fetch()</code> anywhere can still
            reach AWS metadata, your private Redis, your internal admin
            dashboard, and any IMDSv1 endpoint that didn&apos;t get upgraded.{" "}
            <code>fetchGuard()</code> is the application-layer firewall:
          </p>

          <CodeBlock language="ts" code={FETCH_GUARD} />

          <p>
            See{" "}
            <Link href="/docs/security/fetch-guard">the fetch-guard docs</Link>{" "}
            for the full default deny-list and how it composes with timeouts.
          </p>

          <h2>Principle 5 — Automate security with IaC scanning</h2>

          <PrincipleCard
            principle="Scan infrastructure-as-code in CI before it ships"
            framework="The framework's own repo runs ~15 verify-* gates on every PR. The scaffolded app from create-daloy ships with the same CI workflow templates so your project gets them on day one."
            platform="Terraform / CloudFormation / Pulumi scanners (Checkov, tfsec, Aikido, etc.) for your cloud resources. Daloy does not scan your S3 buckets — but it does refuse to install a dependency that runs a postinstall script."
          />

          <p>
            The cloud post is talking about Terraform scanners. The framework
            analogue is the supply-chain CI gate. These are not aspirational —
            they all run today, and a failure blocks merge:
          </p>

          <CodeBlock language="bash" code={SUPPLY_CHAIN_VERIFY} />

          <p>
            The reasoning behind each one is in{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              &quot;Supply-chain hardening for TypeScript libraries&quot;
            </Link>
            . Short version: pnpm&apos;s install-time defaults, plus our CI
            gates, plus a release-age cooldown, plus SHA-pinned Actions, plus
            npm provenance, plus a CycloneDX SBOM — chosen because attackers
            don&apos;t need a 0-day if they can ship a malicious{" "}
            <code>postinstall</code>.
          </p>

          <h2>Principle 6 — Continuous monitoring (CSPM-equivalent)</h2>

          <PrincipleCard
            principle="A single pane of glass for security posture"
            framework="Structured per-request JSON logs with correlated request IDs, automatic redaction of Authorization / Cookie / Set-Cookie / X-API-Key, Server-Timing, and OpenTelemetry-shaped spans — same shape on Node, Bun, Workers, and Vercel Edge."
            platform="Ship the logs into your SIEM (CloudWatch / Datadog / Splunk / Loki). Daloy doesn't run the dashboard; it makes sure the events are useful when they arrive."
          />

          <p>
            CSPM tools want one thing from the application: clean,
            machine-readable, redacted events. That&apos;s what the logger
            ships:
          </p>

          <CodeBlock language="ts" code={STRUCTURED_LOGS} />

          <p>
            The redaction is not a string regex pass — it walks the object
            graph, so a secret hiding inside <code>req.body.user.token</code>{" "}
            gets redacted the same way an Authorization header does. The list of
            keys is extensible; the defaults are conservative. If your company
            adds a new secret-shaped header, you add one string.
          </p>

          <h2>The &quot;assume breach&quot; defaults you already have</h2>

          <p>
            The article&apos;s most underrated line is &quot;assume a breach
            will happen. Focus on minimizing the impact.&quot; Translated into
            framework behavior, that means the defaults must minimize blast
            radius even when a handler is buggy or compromised. Daloy&apos;s
            assume-breach defaults are the seven below, and they are not opt-in:
          </p>

          <CodeBlock language="ts" code={ASSUME_BREACH} />

          <h2>What we do not do (the honest part)</h2>

          <ul>
            <li>
              We don&apos;t scan your cloud configuration. If you mis-IAM an S3
              bucket, Daloy won&apos;t know. Use the cloud provider&apos;s
              tooling or a CSPM vendor — the Aikido post lists several.
            </li>
            <li>
              We don&apos;t encrypt your database. That&apos;s the data
              layer&apos;s job (RDS encryption, KMS-managed keys). The framework
              defaults to TLS for outbound connections and a fetch-guard
              allow-list, but it cannot prove your DB is encrypted at rest.
            </li>
            <li>
              We don&apos;t do runtime threat detection (GuardDuty / Falco). We
              give you the structured event stream a detector needs; someone
              still has to run the detector.
            </li>
            <li>
              We don&apos;t replace your WAF. <code>secureHeaders()</code>,{" "}
              <code>rateLimit()</code>, and <code>loadShedding()</code> are
              application-layer L7 — they overlap with a CDN/WAF and work behind
              one, but they are not the same thing.
            </li>
          </ul>

          <p>
            That&apos;s the line. If a checklist says &quot;the application
            framework must do X,&quot; Daloy does X by default or via a
            documented opt-in. If a checklist says &quot;the cloud account must
            do X,&quot; we don&apos;t lie about owning it.
          </p>

          <h2>A 60-second checklist for your own deploy</h2>

          <ol>
            <li>
              <code>new App()</code> with no overrides — you already have body
              limits, request timeouts, problem+json redaction in production,
              and prototype-pollution-safe JSON.
            </li>
            <li>
              Add <code>secureHeaders()</code>, <code>rateLimit()</code>,{" "}
              <code>loadShedding()</code>, and <code>fetchGuard()</code> — four
              lines, four layers.
            </li>
            <li>
              Wire <code>jwt()</code> to your IdP&apos;s JWKS. Don&apos;t pass a
              static secret. Pin <code>audience</code> and <code>issuer</code>.
            </li>
            <li>
              Mount admin under <code>/admin</code> with{" "}
              <code>ipRestriction()</code> + <code>basicAuth()</code> (or move
              it off the public app entirely).
            </li>
            <li>
              Turn on the structured logger and point your SIEM at stdout.
            </li>
            <li>
              Run <code>pnpm verify:*</code> in CI and gate merges on it.
            </li>
            <li>
              Read <Link href="/docs/security">/docs/security</Link> once.
              Bookmark{" "}
              <Link href="/docs/security/owasp-api-top-10">
                /docs/security/owasp-api-top-10
              </Link>
              .
            </li>
          </ol>

          <p>
            None of this is novel — that&apos;s the point. The whole reason the
            Aikido post exists is that the boring defenses are still the ones
            that prevent breaches. Daloy&apos;s job is to make sure you
            can&apos;t accidentally skip them.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/secure-by-default">Secure by Default</Link>,{" "}
            <Link href="/blog/supply-chain-hardening-for-typescript-libraries">
              Supply-chain hardening for TypeScript libraries
            </Link>
            ,{" "}
            <Link href="/blog/csrf-in-2026-double-submit-and-fetch-metadata">
              CSRF in 2026
            </Link>
            ,{" "}
            <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
              CSP nonces and Trusted Types
            </Link>
            ,{" "}
            <Link href="/blog/sessions-on-the-edge">Sessions on the edge</Link>,{" "}
            <Link href="/blog/observability-without-lock-in-structured-logs-and-otel-tracing">
              Observability without lock-in
            </Link>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
