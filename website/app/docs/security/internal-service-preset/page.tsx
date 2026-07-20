import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Internal services & service meshes",
  description:
    'Use preset: "internal-service" to right-size DaloyJS\'s secure-by-default posture for service-to-service deployments behind a service mesh, sidecar, or private network, without turning off the input, credential, parser, or SSRF guards that still apply inside the perimeter.',
  path: "/docs/security/internal-service-preset",
  keywords: [
    "internal-service preset",
    "service mesh",
    "service-to-service",
    "zero trust",
    "lateral movement",
    "private network",
    "Istio",
    "Linkerd",
    "sidecar",
    "topology-aware security",
    "secure-by-default",
    "intranet app security",
    "employee-only internal app",
    "enterprise internal tools",
    "CSRF behind firewall",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Internal services & service meshes</h1>
      <blockquote>
        <strong>Think of it like…</strong> taking off your raincoat when you
        walk indoors. CSRF, same-origin checks, and browser-specific headers are
        raincoats for the public street, useful when traffic comes from random
        people&apos;s browsers, useless inside a private building (your service
        mesh, where every caller is one of your own services). The preset takes
        off the raincoats but keeps the safe locked, the IDs verified, and the
        input guards on.
      </blockquote>
      <p>
        Most DaloyJS security defaults, body limits, request timeouts, JWT
        algorithm allowlists, <code>timingSafeEqual</code> credential checks,
        prototype-pollution-safe parsers, <code>fetchGuard()</code> SSRF
        defaults, schema strictness, RFC 9457 problem+json with prod-mode
        redaction, apply just as much to a service running behind a service mesh
        as to one facing the public internet. A compromised neighbour, an SSRF
        in another pod, or a leaked internal token will exercise those guards
        identically.
      </p>
      <p>
        A small subset of defaults, however, only make sense at a{" "}
        <em>browser-facing</em> boundary: HSTS, CSP, X-Frame-Options, the
        cross-origin write guard, and the session+state-changing-route CSRF boot
        guard. When TLS is terminated by the mesh, there is no browser to read
        those headers, and no Origin header to compare. Forcing them on at the
        app layer adds noise without adding safety.
      </p>
      <p>
        For these deployments, use <code>{`preset: "internal-service"`}</code>
        {". "}
        It turns off the topology-dependent guards and keeps everything else on.
      </p>

      <BranchDiagram
        title="What the preset changes"
        source={{
          label: 'preset: "internal-service"',
          detail: "names the topology once",
        }}
        branches={[
          {
            eyebrow: "turned off",
            label: "secureHeaders auto-install",
            detail: "HSTS / CSP / X-Frame-Options",
            tone: "danger",
          },
          {
            eyebrow: "turned off",
            label: "corsCrossOriginGuard",
            detail: "no browser Origin to compare",
            tone: "danger",
          },
          {
            eyebrow: "turned off",
            label: "csrf boot guard",
            detail: "callers use bearer / mTLS",
            tone: "danger",
          },
          {
            eyebrow: "kept on",
            label: "bodyLimitBytes + requestTimeoutMs",
            detail: "1 MiB / 30 s defaults",
            tone: "success",
          },
          {
            eyebrow: "kept on",
            label: "fetchGuard() SSRF defaults",
            detail: "still blocks 169.254.169.254",
            tone: "success",
          },
          {
            eyebrow: "kept on",
            label: "JWT allowlist + timingSafeEqual",
            detail: "prototype-pollution-safe parsers",
            tone: "success",
          },
        ]}
        converge={{
          label: "Boot audit log",
          detail: 'event: "security.preset.applied"',
        }}
        caption="The preset only disables the topology-dependent, browser-facing guards (top row). Every guard that protects the service from malformed input, confused dependencies, or compromised callers stays on. A one-time boot log names exactly what was disabled and what was kept."
      />

      <h2 id="one-line-to-switch-posture">One line to switch posture</h2>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";

const app = new App({
  preset: "internal-service",
  production: process.env.NODE_ENV === "production",
});`}
      />
      <p>
        Per-knob options you pass alongside the preset still win. If you want
        headers back on a single internal service that proxies to a browser, set{" "}
        <code>secureHeaders: {`{}`}</code> explicitly, the preset will not
        overwrite an explicit value.
      </p>

      <h2 id="what-the-preset-turns-off">What the preset turns OFF</h2>
      <ul>
        <li>
          <strong>
            <code>secureHeaders</code> auto-install
          </strong>
          {", "}HSTS, CSP, X-Frame-Options, COOP / CORP. No browser to read
          them.
        </li>
        <li>
          <strong>
            <code>corsCrossOriginGuard</code>
          </strong>
          {", "}rejects state-changing requests carrying a cross-origin{" "}
          <code>Origin</code> header. Service-to-service callers do not send{" "}
          <code>Origin</code>.
        </li>
        <li>
          <strong>
            <code>csrf</code> boot guard
          </strong>
          {", "}refuses to start when <code>session()</code> is registered
          alongside a state-changing route without <code>csrf()</code>
          {". "}Internal callers authenticate with bearer tokens or mTLS, not
          cookies.
        </li>
        <li>
          <strong>
            unconfigured <code>X-Forwarded-*</code> guard
          </strong>
          {", "}the first-request 500 when <code>trustProxy</code> /{" "}
          <code>behindProxy</code> is unset. The mesh terminates TLS and the
          immediate peer inside the mesh <em>is</em> the caller.
        </li>
      </ul>

      <h2 id="what-the-preset-keeps-on-non-negotiable">
        What the preset KEEPS on (non-negotiable)
      </h2>
      <p>
        Everything that protects the service itself from malformed input,
        confused dependencies, compromised callers, or operational mistakes
        stays on. The preset does not weaken any of:
      </p>
      <ul>
        <li>
          <code>bodyLimitBytes</code> (1 MiB default),{" "}
          <code>requestTimeoutMs</code> (30 s default)
        </li>
        <li>
          JWT algorithm allowlist + <code>timingSafeEqual</code> credential
          comparison
        </li>
        <li>
          Prototype-pollution-safe parsers + <code>isForbiddenObjectKey</code>
        </li>
        <li>
          <code>fetchGuard()</code> SSRF defaults (still blocks{" "}
          <code>169.254.169.254</code>)
        </li>
        <li>Weak session secret refuse-to-boot</li>
        <li>
          <code>cors({`{ origin: '*' }`})</code> refuse-to-boot
        </li>
        <li>Anonymous stateful plugin refuse-to-boot</li>
        <li>RFC 9457 problem+json with prod-mode redaction</li>
        <li>
          <code>stripServerHeaders</code> (removes <code>Server</code> and{" "}
          <code>X-Powered-By</code>)
        </li>
        <li>
          Schema <code>.strict()</code> and response validation when enabled
        </li>
        <li>
          <code>crashOnUnhandledRejection</code> (still on by default in
          production)
        </li>
      </ul>

      <h2 id="the-threat-model-behind-the-preset">
        The threat model behind the preset
      </h2>
      <p>
        &quot;Behind a firewall&quot; is a weaker guarantee than it used to be.
        Internal services are still reachable through SSRF from a compromised
        workload, leaked VPN access, accidentally-permissive ingress rules, dev
        tunnels, port-forwards, CI jobs, and other internal services gone bad.
        The Aikido / Supabase <em>Secure-by-Default Development</em> write-up
        puts the underlying risk plainly: &quot;If you tell an AI to make
        something work, it might remove the very security checks that protect
        you.&quot;
      </p>
      <p>
        The preset is the answer to that risk for service-to-service
        deployments:{" "}
        <strong>
          do not remove the guards, name the topology once, audit which guards
          stayed on, and keep everything else
        </strong>
        {". "}That is closer to the <code>config.force_ssl</code> /{" "}
        <code>SECURE_*</code> settings shape used by Rails and Django than to a
        master &quot;disable everything&quot; switch.
      </p>

      <h2 id="boot-audit-log">Boot audit log</h2>
      <p>
        Whenever the preset is applied, the framework emits a one-time{" "}
        <code>info</code> log under{" "}
        <code>{`event: "security.preset.applied"`}</code> naming the preset, the
        guards that were disabled, the guards that stayed on, and the list of
        fields the caller overrode explicitly. Operators can grep for it in
        centralized logs without reading the app source.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "event": "security.preset.applied",
  "preset": "internal-service",
  "disabled": [
    "secureHeaders auto-install",
    "corsCrossOriginGuard (state-changing cross-origin write rejection)",
    "csrf boot guard (session() + state-changing route)",
    "unconfigured X-Forwarded-* / trustProxy guard"
  ],
  "kept": [
    "bodyLimitBytes (1 MiB default)",
    "requestTimeoutMs (30 s default)",
    "crashOnUnhandledRejection (production)",
    "weak session secret refuse-to-boot",
    "cors({ origin: '*' }) refuse-to-boot",
    "anonymous stateful plugin refuse-to-boot",
    "stripServerHeaders",
    "RFC 9457 problem+json prod redaction",
    "JWT algorithm allowlist + timingSafeEqual credential comparison",
    "prototype-pollution-safe parsers + isForbiddenObjectKey",
    "fetchGuard() SSRF defaults",
    "schema .strict() + response validation when enabled"
  ],
  "userOverrode": []
}`}
      />

      <h2 id="introspecting-the-live-posture">
        Introspecting the live posture
      </h2>
      <p>
        <code>app.getSecurityPosture()</code> returns a frozen snapshot of the
        resolved security configuration, useful for an internal{" "}
        <code>/__security</code> route, CI audits, or a custom dashboard:
      </p>
      <CodeBlock
        language="ts"
        code={`app.get(
  "/__security",
  {
    operationId: "securityPosture",
    responses: {
      200: { description: "Live security posture snapshot", body: z.any() },
    },
  },
  async () => ({ status: 200, body: app.getSecurityPosture() }),
);`}
      />

      <h2 id="employee-only-internal-apps">
        Employee-only internal apps are NOT this topology
      </h2>
      <blockquote>
        <strong>Think of it like…</strong> a staff-only cafeteria. The building
        is private, but your employees walk in from the street all day, and
        every one of their browsers is a revolving door to the public internet.
        The raincoats (CSRF, secure headers, same-origin checks) stay on
        indoors, because the weather walks in with the people.
      </blockquote>
      <p>
        A back-office tool, HR portal, or admin dashboard that only employees
        can reach, behind a VPN, firewall, or corporate proxy, is{" "}
        <em>browser-facing</em>
        {", "}not service-to-service. The firewall stops outsiders from
        connecting to the server directly; it does nothing about what an
        employee&apos;s browser can be tricked into sending. That browser sits
        inside the perimeter and carries the corporate session cookie:
      </p>
      <ul>
        <li>
          <strong>CSRF is the textbook intranet attack.</strong> An employee
          visits a malicious public site on a lunch break; that site fires a{" "}
          <code>POST</code> at <code>https://intranet.corp/transfer</code>
          {". "}The browser is inside the network and attaches the session
          cookie, so the request lands. The firewall never sees anything wrong.
        </li>
        <li>
          <strong>DNS rebinding and clickjacking</strong> cross the perimeter
          the same way: the victim&apos;s browser executes the attack from the
          inside.
        </li>
      </ul>
      <p>
        So the right posture for an employee-only browser app is the{" "}
        <strong>default posture</strong>
        {", "}exactly what you get with no preset. A hypothetical{" "}
        <code>&quot;intranet-app&quot;</code> preset would flip nothing off;
        naming one would only imply a relaxation that must not happen. What
        distinguishes the intranet topology is <em>additive</em>
        {", "}
        not subtractive:
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, ipRestriction, session, csrf, loginThrottle } from "@daloyjs/core";

// Employee-only intranet app: default posture (NO preset), plus add-ons.
const app = new App({
  production: process.env.NODE_ENV === "production",
  behindProxy: { hops: 1 }, // the corporate reverse proxy / TLS terminator
});

app.use(ipRestriction({ allow: ["10.0.0.0/8"] })); // corporate ranges only
app.use(session({ secret: process.env.SESSION_SECRET! }));
app.use(csrf({ strategy: "fetch-metadata", allowedOrigins: ["https://intranet.corp"] }));
app.use(loginThrottle()); // employees mistype passwords too`}
      />
      <p>The three topologies side by side:</p>
      <table>
        <thead>
          <tr>
            <th>Topology</th>
            <th>Who calls it</th>
            <th>Posture</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Public app / API</td>
            <td>Browsers and clients on the internet</td>
            <td>Default (no preset)</td>
          </tr>
          <tr>
            <td>Employee-only internal app</td>
            <td>Browsers on the corporate network</td>
            <td>
              Default (no preset) + <code>ipRestriction()</code>
              {", "}
              <code>session()</code> + <code>csrf()</code>
              {", "}
              <code>behindProxy</code>
              {", "}<code>loginThrottle()</code>
            </td>
          </tr>
          <tr>
            <td>Service-to-service / machine-to-machine</td>
            <td>Other services (bearer, JWT, mTLS), never a browser</td>
            <td>
              <code>{`preset: "internal-service"`}</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="when-not-to-use-the-preset">When NOT to use the preset</h2>
      <ul>
        <li>
          The service is reachable from a browser, even indirectly (BFF pattern,
          admin UI, embedded widgets, or an{" "}
          <a href="#employee-only-internal-apps">employee-only internal app</a>
          ). Use the default posture and add <code>cors()</code> per route.
        </li>
        <li>
          The service is exposed directly to the public internet without a mesh
          / WAF / TLS terminator in front. Use the default posture.
        </li>
        <li>
          You only need to disable a single guard. Prefer the per-knob option (
          <code>secureHeaders: false</code>
          {", "}
          <code>corsCrossOriginGuard: false</code>
          {", "}
          <code>csrf: &quot;off&quot;</code>) so the rest of the posture stays
          explicit at the call site.
        </li>
      </ul>

      <h2 id="related">Related</h2>
      <ul>
        <li>
          <a href="/docs/security/secure-defaults">Secure-by-default</a>
          {": "}the full list of defaults the framework ships.
        </li>
        <li>
          <a href="/docs/security/secure-defaults-enforcement">
            <code>secureDefaults</code> enforcement
          </a>
          {", "}the wholesale escape hatch (refuses-to-boot in production
          without explicit acknowledgement). Prefer the topology preset where
          possible.
        </li>
        <li>
          <a href="/docs/security/fetch-guard">
            <code>fetchGuard()</code> SSRF defaults
          </a>
          {", "}still active under the preset.
        </li>
      </ul>
    </>
  );
}
