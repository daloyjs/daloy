import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "secureDefaults enforcement",
  description:
    "Daloy enforces secureDefaults master-flag acknowledgement, strong JWT HMAC secrets, consistent frame defenses, and hardware-backed 2FA for contributors with publish access.",
  path: "/docs/security/secure-defaults-enforcement",
  keywords: [
    "secureDefaults",
    "acknowledgeInsecureDefaults",
    "JWT weak secret",
    "HS256 32 bytes",
    "RFC 7518",
    "secureHeaders frame-ancestors",
    "clickjacking",
    "mandatory 2FA",
    "npm publish 2FA",
    "secure-by-default",
    "security enforcement",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>secureDefaults enforcement</h1>
      <blockquote>
        Insecure settings require an explicit
        <code>acknowledgeInsecureDefaults: true</code> and produce a startup
        log. Some configurations, including JWT secrets shorter than 32 bytes,
        are rejected outright.
      </blockquote>
      <p>
        Daloy applies these <strong>cross-cutting security invariants</strong>{" "}
        at construction time, request time, and release time. The checks are
        designed to keep an insecure local workaround from silently becoming a
        production default.
      </p>

      <h2 id="1-securedefaults-false-master-flag-enforcement">
        1. <code>secureDefaults: false</code> master-flag enforcement
      </h2>
      <p>
        The wholesale escape hatch for the entire secure-by-default surface now
        refuses-to-construct in production unless you also pass{" "}
        <code>acknowledgeInsecureDefaults: true</code>
        {". "}This closes the well-documented &quot;developer flipped the flag
        off while debugging and shipped to production&quot; footgun by forcing
        an explicit two-step opt-in:
      </p>

      <FlowDiagram
        title="Turning off secure defaults in production"
        numbered
        steps={[
          {
            eyebrow: "construct",
            label: "new App({ env: 'production' })",
            detail: "with secureDefaults: false",
          },
          {
            eyebrow: "no ack",
            label: "Refuses to construct",
            detail: "acknowledgeInsecureDefaults missing",
            tone: "danger",
          },
          {
            eyebrow: "ack: true",
            label: "Constructs, audit-logged",
            detail: 'event: "secure_defaults.disabled"',
            tone: "success",
          },
        ]}
        caption="Disabling the whole secure-by-default surface in production needs an explicit second flag. Even when acknowledged, a once-per-process error log enumerates every default that was turned off."
      />

      <CodeBlock
        language="ts"
        code={`// ❌ refuses-to-construct in production
new App({ env: "production", secureDefaults: false });

// ✅ explicit two-step opt-in (and you still get the audit log)
new App({
  env: "production",
  secureDefaults: false,
  acknowledgeInsecureDefaults: true,
});`}
      />
      <p>
        Any time the flag is off, a once-per-process <code>error</code> log is
        emitted with <code>{`event: "secure_defaults.disabled"`}</code>{" "}
        enumerating every default it disabled, so the blast radius is loud at
        boot even when the option was set deep in shared configuration:
      </p>
      <ul>
        <li>
          auto <code>secureHeaders</code> install
        </li>
        <li>cross-origin guard for state-changing requests</li>
        <li>crash-on-unhandled-rejection (production)</li>
        <li>
          first-request <code>X-Forwarded-*</code> / <code>trustProxy</code>{" "}
          guard
        </li>
        <li>
          <code>session()</code> + state-changing route requires{" "}
          <code>csrf()</code> boot guard
        </li>
        <li>weak session secret refuse-to-boot</li>
        <li>
          <code>cors({"{ origin: '*' }"})</code> refuse-to-boot
        </li>
        <li>anonymous stateful plugin refuse-to-boot</li>
      </ul>
      <p>
        Per-feature opt-outs (<code>secureHeaders: false</code>
        {", "}
        <code>corsCrossOriginGuard: false</code>
        {", "}
        <code>crashOnUnhandledRejection: false</code>
        {", "}
        <code>trustProxy: false</code>
        {", "}
        <code>csrf: &quot;off&quot;</code>) remain available without the
        production refusal, prefer those when you only need to disable one
        default rather than the whole surface. Tests can reset the audit-log
        latch via the exported <code>_resetInsecureDefaultsLogForTests()</code>{" "}
        helper, mirroring the existing <code>_resetCrashHandlersForTests</code>{" "}
        pattern.
      </p>

      <h2 id="2-jwt-hs-secret-length-refuse-to-construct-rfc-7518-3-2">
        2. JWT HS-secret length refuse-to-construct (RFC 7518 §3.2)
      </h2>
      <p>
        <code>createJwtSigner()</code> and <code>createJwtVerifier()</code> now
        refuse <code>Uint8Array</code> HS-shaped secrets shorter than{" "}
        <strong>32 bytes</strong> at construction time. RFC 7518 §3.2 sets the
        floor at the hash output size (32 bytes for HS256), and Daloy applies
        the same floor to HS384 and HS512 because a shorter key does not buy a
        stronger HMAC, it only reduces the effective entropy.
      </p>
      <CodeBlock
        language="ts"
        code={`// ❌ refuses at construction
createJwtSigner({
  alg: "HS256",
  key: new Uint8Array(16),        // 16 bytes - too short
  maxLifetimeSeconds: 60,
});
// JwtError [weak_hs_secret]: jwt(): HS256 secret must be at least 32 bytes
// (RFC 7518 §3.2); got 16.

createJwtVerifier({
  algorithms: ["HS384"],
  key: new Uint8Array(20),        // 20 bytes - too short
});
// JwtError [weak_hs_secret]: jwt(): HS* secret must be at least 32 bytes
// (RFC 7518 §3.2); got 20.

// ✅ 32 bytes from a CSPRNG
const key = new Uint8Array(32);
crypto.getRandomValues(key);
createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 });`}
      />

      <h2 id="3-secureheaders-refuses-dual-framing-defense-disable">
        3. <code>secureHeaders()</code> refuses dual framing-defense disable
      </h2>
      <p>
        <code>secureHeaders()</code> ships two layered defenses against
        clickjacking: the <code>X-Frame-Options</code> header (legacy browsers)
        and a CSP <code>frame-ancestors</code> directive (modern spec). The
        helper now refuses to construct when <em>both</em> are disabled
        simultaneously, that combination silently re-opens the clickjacking
        surface the helper exists to close:
      </p>
      <CodeBlock
        language="ts"
        code={`// ❌ refuses
secureHeaders({
  frameOptions: false,
  contentSecurityPolicy: false,
});
// Error: secureHeaders(): refusing to construct with both frameOptions: false
// AND no CSP frame-ancestors directive - that disables every clickjacking
// defense the helper provides.

// ❌ refuses (CSP string without frame-ancestors directive)
secureHeaders({
  frameOptions: false,
  contentSecurityPolicy: "default-src 'self'",
});

// ✅ explicit frame-ancestors directive in the CSP carries the defense
secureHeaders({
  frameOptions: false,
  contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
});

// ✅ directives-object form is also recognised
secureHeaders({
  frameOptions: false,
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "frame-ancestors": ["'none'"],
    },
  },
});`}
      />
      <p>
        If you only want to disable one of the two defenses, keep the other one
        on, the helper&apos;s defaults already wire both layers, so the common
        case (no options passed) needs no changes.
      </p>

      <h2 id="4-mandatory-hardware-backed-2fa-for-publish-access">
        4. Mandatory hardware-backed 2FA for publish access
      </h2>
      <p>
        Daloy&apos;s supply-chain posture now mandates{" "}
        <strong>hardware-backed 2FA</strong> for every contributor with publish
        access, documented in <code>SECURITY.md</code> as a release-checklist
        item:
      </p>
      <ul>
        <li>
          GitHub organization level:{" "}
          <code>
            Settings -&gt; Authentication security -&gt; Require two-factor
            authentication
          </code>{" "}
          is enforced on the <code>@daloyjs</code> org; every account with write
          access must have a hardware-backed factor (passkey or security key,
          TOTP-only accounts are off-boarded).
        </li>
        <li>
          npm registry level: <code>npm access 2fa-required</code> is set on{" "}
          <code>@daloyjs/core</code> and <code>create-daloy</code>; OIDC trusted
          publishing from the protected <code>npm-publish</code> environment
          means publishes themselves carry no long-lived token, but every
          maintainer who can approve the environment still needs hardware-backed
          2FA on the registry account.
        </li>
        <li>
          Off-boarding: when a maintainer leaves rotation, their org membership,
          publish grants, and granular tokens are revoked in the same change.
        </li>
        <li>
          Release-checklist audit gate: before tagging a release the maintainer
          running the release verifies that every contributor who approved the{" "}
          <code>npm-publish</code> Environment for that release has 2FA enabled
          at both levels (the mandatory-2FA audit gate).
        </li>
      </ul>

      <h2 id="related-cross-cutting-safeguards">
        Related cross-cutting safeguards
      </h2>
      <p>
        The same posture extends to shared helpers for cookie writes, client IP
        resolution, time-claim validation, and secret comparison; refusal of
        invalid <code>__Secure-</code> cookie configuration;{" "}
        <code>daloy doctor --audit-secrets</code>; the zero-runtime-dependency
        governance gate; and the timing-safe-comparison gate. Together these
        safeguards replace &quot;the developer remembered to do it&quot; with
        framework-level consistency.
      </p>
    </>
  );
}
