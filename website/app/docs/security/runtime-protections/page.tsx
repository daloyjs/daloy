import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Runtime protections that travel with your app",
  description:
    "The runtime guardrails that ship inside @daloyjs/core and apply at request time, regardless of your CI host, repo platform, or whether you use the generated GitHub Actions bundle.",
  path: "/docs/security/runtime-protections",
  keywords: [
    "DaloyJS runtime security",
    "framework-level guardrails",
    "private GitLab Bitbucket Azure DevOps on-prem",
    "secure defaults",
    "portable protections",
    "CORS CSRF JWT secure headers defaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Runtime protections that travel with your app</h1>
      <blockquote>
        <strong>Think of it like…</strong> the seatbelts, airbags, and crumple
        zones built into the car itself. They protect you in every country you
        drive in, regardless of which dealership sold you the car, which gas
        station you fill up at, or whether your country requires roadworthiness
        inspections. CI hardening is the inspection sticker; these runtime
        guards are the car.
      </blockquote>
      <p>
        These protections live inside <code>@daloyjs/core</code> and run at
        request time in your app process. They apply regardless of where you
        host the repo or which CI you use:
        <strong>
          {" "}
          private GitHub, GitLab, Bitbucket, Azure DevOps, Gitea,
        </strong>{" "}
        self-managed Jenkins, or on-prem runners. They are also unaffected by
        whether you keep or delete the optional GitHub Actions bundle from{" "}
        <code>create-daloy</code>.
      </p>
      <p>
        Think of DaloyJS supply-chain and security posture as three independent
        layers. This page documents the first one.
      </p>

      <LayerStack
        title="Three independent layers"
        flow="down"
        layers={[
          {
            title: "Runtime guardrails (this page)",
            detail: "inside @daloyjs/core, every request, no CI host required",
            tone: "success",
            items: [
              "safe CORS",
              "safeJsonParse",
              "bodyLimitBytes",
              "requestTimeoutMs",
              "secureHeaders()",
            ],
          },
          {
            title: "Install-time hardening",
            detail: "pnpm scaffold .npmrc + verify:lockfile",
            tone: "accent",
            items: [
              "ignore-scripts=true",
              "minimum-release-age=1440",
              "frozen lockfile",
            ],
          },
          {
            title: "CI / CD hardening",
            detail: "GitHub Actions bundle only; translate elsewhere",
            tone: "muted",
            items: ["SHA-pinned actions", "harden-runner", "permissions: {}"],
          },
        ]}
        caption="Only the top layer travels everywhere. It is baked into the framework and runs on every request no matter where you host the repo. The lower two layers depend on keeping the pnpm scaffold and the generated GitHub workflows."
      />

      <h2 id="the-three-layers-side-by-side">The three layers, side by side</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Where it runs</th>
            <th>Travels to GitLab / Bitbucket / Azure / on-prem?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Runtime guardrails (this page)</td>
            <td>
              Inside your app, every request. Lives in{" "}
              <code>@daloyjs/core</code>.
            </td>
            <td>Yes. Always on. No CI host required.</td>
          </tr>
          <tr>
            <td>Install-time hardening</td>
            <td>
              <code>.npmrc</code> in pnpm scaffolds, plus{" "}
              <code>pnpm verify:lockfile</code>.
            </td>
            <td>
              Yes when you use pnpm. The hardened <code>.npmrc</code> ships in
              the project itself.
            </td>
          </tr>
          <tr>
            <td>CI / CD hardening</td>
            <td>
              <code>.github/workflows/*.yml</code> from{" "}
              <code>create-daloy --with-ci</code>.
            </td>
            <td>
              GitHub only (public or private repo / org). On other CIs you have
              to translate the rules yourself.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="backend-footguns-the-framework-handles-by-default">
        Backend footguns the framework handles by default
      </h2>
      <p>
        Every row below describes behavior that is on by default in a fresh
        DaloyJS app. You do not need to install a plugin, deploy on a specific
        CI, or open a particular file to get these.
      </p>

      <table>
        <thead>
          <tr>
            <th>Footgun</th>
            <th>What DaloyJS does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Unsafe CORS defaults</td>
            <td>
              Cross-origin state-changing requests are refused unless{" "}
              <code>cors()</code> explicitly allows the origin. No reflective{" "}
              <code>Access-Control-Allow-Origin: *</code> with credentials.
            </td>
          </tr>
          <tr>
            <td>Missing CSRF on stateful routes</td>
            <td>
              Booting <code>session()</code> with mutating routes but without{" "}
              <code>csrf()</code> is refused at startup, not silently allowed.
            </td>
          </tr>
          <tr>
            <td>Weak session secrets</td>
            <td>
              Short / low-entropy session secrets are refused at boot.
              Production requires a real secret.
            </td>
          </tr>
          <tr>
            <td>Missing secure response headers</td>
            <td>
              <code>secureHeaders()</code> is auto-applied: HSTS, frame deny,
              no-sniff, strict referrer policy, baseline CSP.
            </td>
          </tr>
          <tr>
            <td>Prototype pollution via JSON bodies</td>
            <td>
              <code>safeJsonParse</code> strips <code>__proto__</code>
              {", "}
              <code>constructor</code>
              {", "}and <code>prototype</code> keys before the value reaches
              your handler.
            </td>
          </tr>
          <tr>
            <td>Path traversal</td>
            <td>
              Dot-segments (<code>.</code> / <code>..</code>) are resolved to a
              canonical path before route matching, and empty{" "}
              <code>{"//"}</code> segments are refused. Routes match exact
              strings, so there is no directory to escape into.
            </td>
          </tr>
          <tr>
            <td>Body-size abuse</td>
            <td>
              Streamed reads with a hard cap (default 1 MiB); oversize requests
              return <code>413</code> before they hit your handler.
            </td>
          </tr>
          <tr>
            <td>Hung handlers / slow-loris</td>
            <td>
              <code>requestTimeoutMs</code> (default 30s) returns{" "}
              <code>408</code> and fires <code>ctx.request.signal</code> for
              cooperative teardown; the Node adapter sets socket-level timeouts.
            </td>
          </tr>
          <tr>
            <td>Header-count flood / HTTP/2 Bomb</td>
            <td>
              <code>maxHeaderCount</code> (default 100) is a portable
              application-tier guard that returns{" "}
              <code>431 Request Header Fields Too Large</code> when a request
              exceeds the cap (e.g. via <code>app.fetch()</code> or runtimes
              without a native cap). The Node adapter also sets the native{" "}
              <code>server.maxHeadersCount</code> to the same value, so on Node
              a header-count flood is dropped at the HTTP parser as a{" "}
              <code>400</code>-class client error before it ever becomes a
              request. Either way it is defence-in-depth, apply the vendor
              HTTP/2 fix at any proxy that terminates HTTP/2.
            </td>
          </tr>
          <tr>
            <td>Bad reverse-proxy assumptions</td>
            <td>
              <code>X-Forwarded-*</code> headers are never trusted by default.{" "}
              <strong>In production</strong>
              {", "}a request carrying one while <code>trustProxy</code> /{" "}
              <code>behindProxy</code> is unconfigured is refused with a{" "}
              <code>500</code> (and a clear log line) so a spoofed source IP
              can&apos;t reach the rate limiter or audit log. Dev and CI relax
              this so you can test forwarded headers locally. Opt in via{" "}
              <code>behindProxy</code> (or <code>trustProxy: false</code> to
              ignore the headers).
            </td>
          </tr>
          <tr>
            <td>Auth response caching</td>
            <td>
              <code>401</code>
              {", "}<code>403</code>
              {", "}and <code>429</code> automatically set{" "}
              <code>Cache-Control: no-store</code> so proxies and CDNs cannot
              reuse them.
            </td>
          </tr>
          <tr>
            <td>Duplicate dangerous headers</td>
            <td>
              Duplicate <code>Host</code> and <code>Content-Length</code> are
              rejected at parse time to block request-smuggling shapes.
            </td>
          </tr>
          <tr>
            <td>Weak JWT secrets</td>
            <td>
              <code>createJwtSigner()</code> refuses HS* secrets shorter than
              the algorithm requires.
            </td>
          </tr>
          <tr>
            <td>Missing JWT expiry</td>
            <td>
              Signing without an <code>exp</code> claim is refused, not
              defaulted to a forever token.
            </td>
          </tr>
          <tr>
            <td>Unsafe compression cases (BREACH)</td>
            <td>
              <code>compression()</code> skips <code>Set-Cookie</code>
              {", "}
              <code>Authorization</code>
              {", "}session / CSRF cookie responses, and already-encoded
              content; downgrades strong ETags per RFC 9110.
            </td>
          </tr>
          <tr>
            <td>Unsafe file-upload assumptions</td>
            <td>
              <code>multipartObject</code> + <code>fileField</code> enforce
              per-field size caps, MIME allowlists, and magic-byte checks.
            </td>
          </tr>
          <tr>
            <td>Leaky production errors</td>
            <td>
              Production mode strips <code>detail</code> from <code>5xx</code>{" "}
              problem+json automatically; stack traces never leak through the
              default error path.
            </td>
          </tr>
          <tr>
            <td>Unsupported content types</td>
            <td>
              Routes with body schemas reject non-allowed content-types with{" "}
              <code>415</code>.
            </td>
          </tr>
          <tr>
            <td>Method confusion</td>
            <td>
              Real <code>405</code> with <code>Allow</code> header instead of a
              misleading <code>404</code>.
            </td>
          </tr>
          <tr>
            <td>Header / response splitting</td>
            <td>
              <code>sanitizeHeaderName</code> / <code>sanitizeHeaderValue</code>{" "}
              reject CRLF and NUL in header values.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="what-this-page-does-not-cover">
        What this page does <em>not</em> cover
      </h2>
      <p>
        The following protections only apply if you keep using the matching
        scaffolded bits:
      </p>
      <ul>
        <li>
          <strong>Install-time hardening</strong> (blocked install scripts, 24h
          release-age cooldown, source-verified lockfile, zero-runtime-dep gate)
          applies when you use the pnpm scaffold and keep its{" "}
          <code>.npmrc</code> + <code>pnpm verify:lockfile</code> script.
        </li>
        <li>
          <strong>CI / CD hardening</strong> (pinned actions,{" "}
          <code>harden-runner</code>
          {", "}top-level <code>permissions: {"{}"}</code>
          {", "}CODEOWNERS, Dependabot, CodeQL / Scorecard / zizmor) applies
          when you use the <code>create-daloy --with-ci</code> GitHub Actions
          bundle. On GitLab, Bitbucket, Azure DevOps, Jenkins, or on-prem
          runners you have to translate those rules into your CI&apos;s own
          configuration.
        </li>
        <li>
          <strong>
            Branch protection, environment approvals, secret hygiene, runner
            isolation, and org policy
          </strong>{" "}
          are decisions of the host (GitHub / GitLab / Azure / Bitbucket / your
          own infra). DaloyJS cannot enforce them from inside your code.
        </li>
      </ul>

      <h2 id="what-the-generated-github-actions-bundle-actually-does">
        What the generated GitHub Actions bundle actually does
      </h2>
      <p>
        If you scaffold with <code>create-daloy --with-ci</code> and{" "}
        <strong>keep the generated workflows</strong>
        {", "}the YAML itself encodes these protections. They apply equally to
        public repos, private repos, and private organizations, being private is
        not a substitute for any of them:
      </p>
      <ul>
        <li>
          Top-level <code>permissions: {"{}"}</code> with least-privilege
          per-job permissions.
        </li>
        <li>Third-party Actions pinned to a commit SHA (not a moving tag).</li>
        <li>
          <code>actions/checkout</code> with{" "}
          <code>persist-credentials: false</code>.
        </li>
        <li>
          <code>step-security/harden-runner</code> with egress policy on every
          job.
        </li>
        <li>
          Lifecycle scripts disabled during CI installs (
          <code>--ignore-scripts</code> for npm/yarn,{" "}
          <code>ignore-scripts=true</code> in the scaffolded <code>.npmrc</code>{" "}
          for pnpm).
        </li>
        <li>No shared Actions cache by default.</li>
        <li>Dependabot config for npm + Actions ecosystems.</li>
        <li>
          <code>CODEOWNERS</code> for security-sensitive files.
        </li>
        <li>
          CodeQL, OpenSSF Scorecard, zizmor, and vulnerability-scan workflows
          where included.
        </li>
        <li>
          Manual-only <code>deploy.yml</code> starter instead of automatic
          publish or deploy on push.
        </li>
      </ul>
      <p>
        This is <strong>generated GitHub CI hardening</strong>
        {", "}not &ldquo;default supply-chain protection everywhere&rdquo;. If
        you delete the workflows, rewrite them, or use a different CI host,
        DaloyJS cannot give you these guarantees automatically.
      </p>

      <h2 id="the-honest-matrix">The honest matrix</h2>
      <p>
        Use this table to figure out which protections you actually get for a
        given setup.
      </p>
      <table>
        <thead>
          <tr>
            <th>User setup</th>
            <th>What DaloyJS can protect</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>create-daloy --with-ci</code> on GitHub (private or public
              repo / org)
            </td>
            <td>
              Runtime guardrails + pnpm install-time hardening (if pnpm) +{" "}
              <strong>full generated GitHub Actions starter protections</strong>
              {"."}
            </td>
          </tr>
          <tr>
            <td>
              <code>create-daloy</code> with pnpm, no CI bundle
            </td>
            <td>
              Runtime guardrails + hardened install defaults via{" "}
              <code>.npmrc</code> and <code>pnpm verify:lockfile</code>.
            </td>
          </tr>
          <tr>
            <td>npm / yarn / bun users (no pnpm scaffold)</td>
            <td>
              Runtime guardrails. CI install commands still benefit if you keep
              the generated workflows on GitHub.
            </td>
          </tr>
          <tr>
            <td>GitLab / Bitbucket / Azure DevOps / Jenkins / on-prem</td>
            <td>
              Runtime guardrails and portable docs / patterns.{" "}
              <strong>No GitHub Actions protections.</strong> Translate the YAML
              rules into your CI&apos;s own configuration.
            </td>
          </tr>
          <tr>
            <td>User deletes or rewrites the generated workflows</td>
            <td>
              Runtime guardrails only. DaloyJS cannot guarantee CI supply-chain
              posture once the workflows are gone.
            </td>
          </tr>
          <tr>
            <td>
              Branch protection, environment approvals, secret hygiene, runner
              isolation, egress policy, org settings, deploy-platform config
            </td>
            <td>
              Out of scope. These are decisions of your repo host and deploy
              platform; DaloyJS cannot enforce them from inside your code.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        See <a href="/docs/security/secure-defaults">Secure-by-default</a>
        {", "}
        <a href="/docs/security/boot-guards">Boot guards</a>
        {", "}and{" "}
        <a href="/docs/security/supply-chain">Supply-chain security</a> for the
        full surface of each layer.
      </p>
    </>
  );
}
