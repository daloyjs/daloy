import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Secure admin panels",
  description:
    "Map Aikido's secure admin panel checklist to DaloyJS primitives: internal-only routes, ipRestriction, strict CSP, per-admin bearer/JWT auth, login-throttle rate limits, and structured audit logging.",
  path: "/docs/security/admin-panels",
  keywords: [
    "DaloyJS admin panel",
    "secure admin panel",
    "internal routes",
    "ipRestriction",
    "CSP nonce",
    "admin audit log",
    "Aikido checklist",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Secure admin panels</h1>
      <blockquote>
        <strong>Think of it like…</strong> the back office of a bank. Different
        door, different lock, different keys, different camera, and a logbook of
        who opened the safe and when, all separate from the public lobby. Most
        admin-panel breaches happen because the back office was stapled to the
        public lobby with a flimsy curtain (the same auth, the same domain, the
        same surface).
      </blockquote>
      <p>
        Aikido&apos;s{" "}
        <a
          href="https://www.aikido.dev/blog/build-secure-admin-panel"
          target="_blank"
          rel="noreferrer"
        >
          &quot;How to build a secure admin panel for your SaaS app&quot;
        </a>{" "}
        lists the recurring mistakes that turn customer-success tooling into a
        breach: admin endpoints stitched into the same surface as the public
        app, shared support accounts with no audit trail, single-factor
        authentication, and no Content-Security-Policy to contain injected
        JavaScript. Daloy doesn&apos;t ship an admin panel, but every primitive
        you need to follow that checklist is already in the framework. This page
        maps each rule to the helper that enforces it.
      </p>

      <LayerStack
        title="Defense layers a request crosses before it changes admin state"
        flow="down"
        layers={[
          {
            title: "Network perimeter",
            detail: "rejected before authentication even runs",
            tone: "accent",
            items: ["internal: true", "ipRestriction()", "VPN / tunnel"],
          },
          {
            title: "Per-admin authentication",
            detail: "no shared support@ accounts",
            items: ["bearerAuth()", "JWT verify", "rateLimit(admin-auth)"],
          },
          {
            title: "Session & CSRF",
            detail: "stops cross-site state changes",
            items: ["session() Strict+Secure", "csrf()"],
          },
          {
            title: "Strict CSP",
            detail: "injected scripts dropped by the browser",
            items: ["default-src 'none'", "nonce: true", "Trusted Types"],
          },
          {
            title: "Audit log",
            detail: "who did what, when, from where",
            tone: "success",
            items: ["requestId()", "structured logger", "tracing()"],
          },
        ]}
        caption="Each layer maps to one rule on Aikido's checklist. A leaked password alone clears none of them: it still has to come from the right network, carry an unthrottled per-admin token, survive CSRF, and leave an audit record."
      />

      <h2>1. Don&apos;t mix admin routes into your public app</h2>
      <p>
        The first rule is the most important: admin endpoints should not be
        reachable from the same hostname as the public API, and they should not
        leak into client-side bundles where attackers can probe them. Daloy
        gives you two tools that compose into a clean &quot;private API
        only&quot; posture:
      </p>
      <ul>
        <li>
          <code>internal: true</code> on a route hides it from the public
          listener entirely. It is only reachable via{" "}
          <code>app.inject()</code> (server-to-server) or through an adapter
          that explicitly mounts internal routes on a separate socket / hostname
          / port.
        </li>
        <li>
          <code>subdomains()</code> lets you mount the admin sub-app on{" "}
          <code>admin.example.com</code> while the public API stays on{" "}
          <code>api.example.com</code>, so a critical issue in the admin code
          can be taken offline (firewall, DNS, deploy) without affecting the
          customer-facing app.
        </li>
      </ul>
      <CodeBlock
        language="ts"
        code={`import { App, ipRestriction, secureHeaders, bearerAuth } from "@daloyjs/core";

const app = new App({ env: "production" });

// Public surface stays minimal and visible.
app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "ok" } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
});

// Admin surface is opt-in only. The internal flag keeps it out of the
// OpenAPI document and out of the public listener entirely.
app.route({
  method: "POST",
  path: "/admin/users/:id/disable",
  operationId: "adminDisableUser",
  internal: true,
  hooks: [
    ipRestriction({ allow: ["10.0.0.0/8", "203.0.113.4/32"] }),
    bearerAuth({
      validate: (token, { state }) => verifyAdminToken(token, state),
      realm: "daloy-admin",
    }),
  ],
  responses: { 204: { description: "ok" } },
  handler: async () => ({ status: 204 as const, body: undefined }),
});`}
      />
      <p>
        Front the internal listener with a VPN, a Cloudflare Access tunnel, or a
        private load balancer. The combination of <code>internal: true</code> +{" "}
        <code>ipRestriction()</code> means misconfigured DNS or a routing
        accident cannot expose the admin surface to the public internet by
        default.
      </p>

      <h2>2. Per-admin accounts with an audit log</h2>
      <p>
        Aikido&apos;s second rule is to ban shared <code>support@app.io</code>{" "}
        logins so every sensitive change is attributable. Daloy doesn&apos;t
        ship an identity provider. Pick one (Auth0, Clerk, Cognito, Keycloak,
        or your own JWT issuer) and verify per-admin tokens with{" "}
        <code>bearerAuth()</code> or the JWT helpers. The framework gives you
        the audit-log primitives:
      </p>
      <ul>
        <li>
          <code>requestId()</code> stamps every request with a propagated{" "}
          <code>x-request-id</code> so the same identifier appears in every
          downstream log line.
        </li>
        <li>
          The built-in <code>logger</code> emits structured JSON; attach the
          authenticated admin&apos;s subject claim in your <code>hooks</code> so
          &quot;who did what, when, from where&quot; falls out for free.
        </li>
        <li>
          <code>tracing()</code> ties the same request id into OpenTelemetry
          spans for long-term retention in your observability stack.
        </li>
      </ul>
      <CodeBlock
        language="ts"
        code={`import { jwtVerify, requestId, logger } from "@daloyjs/core";

app.use(requestId());
app.use(logger({ level: "info" }));

const adminAuth = jwtVerify({
  issuer: "https://login.example.com/",
  audience: "daloy-admin",
  // Per-admin tokens carry the admin's subject + email + role claims.
  required: { roles: ["admin"] },
});

app.route({
  method: "POST",
  path: "/admin/feature-flags/:flag",
  operationId: "adminToggleFlag",
  internal: true,
  hooks: [
    ipRestriction({ allow: ["10.0.0.0/8"] }),
    adminAuth,
    {
      afterHandle: (_res, ctx) => {
        // Structured audit record - one line per sensitive change.
        ctx.log.info({
          event: "admin.flag.toggle",
          actor: ctx.state.jwt?.sub,
          actorEmail: ctx.state.jwt?.email,
          flag: ctx.params.flag,
          requestId: ctx.requestId,
        }, "admin toggled feature flag");
      },
    },
  ],
  responses: { 204: { description: "ok" } },
  handler: async () => ({ status: 204 as const, body: undefined }),
});`}
      />

      <h2>3. Enforce 2FA (or 3FA) for admin auth</h2>
      <p>
        Daloy doesn&apos;t implement TOTP / WebAuthn itself (that belongs in
        your identity provider), but it gives you three layers that compose with
        whatever 2FA your IdP enforces, so a stolen password alone is not
        enough:
      </p>
      <ul>
        <li>
          <strong>Network factor.</strong> <code>ipRestriction()</code> with a
          tight CIDR allow-list (corporate VPN, Cloudflare WARP egress, office
          gateway) means a credential leak from outside that range is rejected
          before authentication even runs.
        </li>
        <li>
          <strong>Login-throttle factor.</strong>{" "}
          <code>rateLimit({'{ windowMs, max, groupId: "admin-auth" }'})</code>{" "}
          shares one bucket across <code>/admin/login</code>,{" "}
          <code>/admin/otp</code>, and <code>/admin/recovery</code> so password
          spraying and OTP guessing are both throttled by the same counter.
        </li>
        <li>
          <strong>Session factor.</strong> <code>session()</code> with{" "}
          <code>cookieOptions: {'{ secure: true, sameSite: "strict" }'}</code>{" "}
          plus <code>csrf()</code> on every mutating route closes the
          state-changing-request loophole even if a cookie escapes the admin
          subdomain.
        </li>
      </ul>
      <CodeBlock
        language="ts"
        code={`import { rateLimit, session, csrf } from "@daloyjs/core";

const adminLoginLimit = () =>
  rateLimit({ windowMs: 60_000, max: 5, groupId: "admin-auth" });

app.use(session({
  secret: process.env.ADMIN_SESSION_SECRET!,
  cookieOptions: { secure: true, httpOnly: true, sameSite: "strict" },
}));
app.use(csrf({ strategy: "fetch-metadata" }));

app.route({
  method: "POST",
  path: "/admin/login",
  operationId: "adminLogin",
  internal: true,
  hooks: [adminLoginLimit() /* + your IdP verification */],
  // …
});
app.route({
  method: "POST",
  path: "/admin/otp",
  operationId: "adminOtp",
  internal: true,
  hooks: [adminLoginLimit() /* + TOTP / WebAuthn verification */],
  // …
});`}
      />

      <h2>4. Block unknown JavaScript with CSP</h2>
      <p>
        Aikido&apos;s last rule (and the one that would have prevented the
        &quot;Apple email injection&quot; case they cite) is a strict
        Content-Security-Policy on the admin HTML. Daloy&apos;s{" "}
        <code>secureHeaders()</code> already emits a CSP, and it can mint a
        fresh per-request nonce so legitimate inline bootstrap scripts run while{" "}
        <em>any</em> injected <code>&lt;script&gt;</code> from a future XSS is
        silently dropped by the browser.
      </p>
      <CodeBlock
        language="ts"
        code={`import { secureHeaders } from "@daloyjs/core";

app.use(secureHeaders({
  // Strict CSP for the admin surface: only same-origin code, no inline
  // scripts unless they carry the per-request nonce, no objects, no
  // framing, and Trusted Types required for any DOM sink.
  contentSecurityPolicy: {
    directives: {
      "default-src": "'none'",
      "script-src": "'self'",
      "style-src": "'self'",
      "img-src": ["'self'", "data:"],
      "connect-src": "'self'",
      "frame-ancestors": "'none'",
      "base-uri": "'none'",
      "form-action": "'self'",
    },
    nonce: true,
    trustedTypes: { policies: ["default"] },
  },
  // Modern HSTS + tight cross-origin posture for an admin host.
  hsts: { maxAgeSeconds: 31536000, includeSubDomains: true, preload: true },
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  // Route violations to a reporting endpoint so you see attempted XSS in
  // production instead of finding out from a customer.
  reportingEndpoints: { csp: "https://csp.example.com/report" },
  reportTo: "csp",
}));`}
      />
      <p>
        Pair this with <code>app.cspReportRoute()</code> if you want Daloy to
        terminate the report endpoint itself (size-capped, with optional body
        redaction so reported URLs don&apos;t leak PII into logs).
      </p>

      <h2>Checklist: Aikido rule → Daloy primitive</h2>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>What Daloy gives you</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Admin panel is not built into the public app</td>
            <td>
              <code>internal: true</code> routes + <code>app.inject()</code>,
              optional <code>subdomains()</code> mount on a separate host
            </td>
          </tr>
          <tr>
            <td>Admin reachable only from trusted networks</td>
            <td>
              <code>ipRestriction({"{ allow: [...] }"})</code> with CIDR
              support, fails closed when no peer address is available
            </td>
          </tr>
          <tr>
            <td>Per-admin authentication, no shared accounts</td>
            <td>
              <code>bearerAuth()</code>, <code>basicAuth()</code>, JWT helpers,
              <code>session()</code>: each ties a request to an identifiable
              subject
            </td>
          </tr>
          <tr>
            <td>Action audit log</td>
            <td>
              <code>requestId()</code> + <code>logger</code> structured JSON +{" "}
              <code>tracing()</code> spans
            </td>
          </tr>
          <tr>
            <td>2FA / 3FA: throttle login + OTP + recovery together</td>
            <td>
              <code>rateLimit({'{ groupId: "admin-auth" }'})</code> shared
              bucket across all auth routes
            </td>
          </tr>
          <tr>
            <td>State-changing routes can&apos;t be cross-site triggered</td>
            <td>
              <code>csrf()</code> (double-submit or fetch-metadata) +{" "}
              <code>session()</code> with{" "}
              <code>SameSite=Strict; Secure; HttpOnly</code>
            </td>
          </tr>
          <tr>
            <td>Block unknown JavaScript (CSP)</td>
            <td>
              <code>
                secureHeaders(
                {
                  "{ contentSecurityPolicy: { …, nonce: true, trustedTypes }, hsts, … }"
                }
                )
              </code>{" "}
              + <code>app.cspReportRoute()</code>
            </td>
          </tr>
          <tr>
            <td>Take admin offline without taking the app offline</td>
            <td>
              Separate internal listener / subdomain mount: flip a feature flag
              or firewall rule, leave the public API running
            </td>
          </tr>
        </tbody>
      </table>

      <h2>
        What Daloy intentionally does <em>not</em> do
      </h2>
      <ul>
        <li>
          Implement TOTP, WebAuthn, or SSO. Use an identity provider. Daloy
          verifies the resulting bearer tokens / JWTs.
        </li>
        <li>
          Render an admin UI. The framework is API-first; pair it with any admin
          framework (Refine, AdminJS, Retool, internal Next.js) and point that
          UI at the internal-only Daloy routes.
        </li>
        <li>
          Decide your network perimeter. <code>ipRestriction()</code> enforces a
          CIDR list, but you still own the firewall, VPN, or zero-trust access
          layer that determines which addresses are trustworthy in the first
          place.
        </li>
      </ul>
    </>
  );
}
