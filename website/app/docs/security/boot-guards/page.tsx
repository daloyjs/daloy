import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Boot guards",
  description:
    "Daloy refuses to boot in production on weak session secrets, wildcard CORS, session() without csrf() on state-changing routes, and unconfigured X-Forwarded-* headers. Learn each guard, how to opt out, and how to migrate.",
  path: "/docs/security/boot-guards",
  keywords: [
    "DaloyJS boot guards",
    "weak session secret",
    "cors wildcard production",
    "csrf required",
    "trustProxy unconfigured",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Boot guards</h1>
      <blockquote>
        <strong>Think of it like…</strong> the engine check that won&apos;t let
        your car start if the parking brake is on, the doors aren&apos;t shut,
        or a seatbelt isn&apos;t buckled. It is much better to fail loudly in
        the driveway than to discover the problem at the first intersection
        under load. Boot guards turn the most common misconfigurations (wildcard
        CORS with credentials, weak session secrets, unconfigured proxy headers)
        into refuse-to-start errors.
      </blockquote>
      <p>
        Daloy ships the boot-guards slice of the secure-by-default initiative:
        four refuse-to-boot / first-request guards that turn the most common
        production misconfigurations into loud failures during startup instead
        of silent vulnerabilities under load.
      </p>

      <p>
        All four guards are gated on the resolved environment being{" "}
        <code>production</code> (sources:{" "}
        <code>
          app({"{"} env: &quot;production&quot; {"}"})
        </code>
        , then{" "}
        <code>
          app({"{"} production: true {"}"})
        </code>
        , then <code>NODE_ENV === &quot;production&quot;</code>) so dev and CI
        workflows keep working with sample secrets and ad-hoc headers. The
        single master escape hatch{" "}
        <code>
          app({"{"} secureDefaults: false {"}"})
        </code>{" "}
        disables every boot guard at once.
      </p>

      <FlowDiagram
        title="Fail in the driveway, not the intersection"
        numbered
        steps={[
          {
            eyebrow: "startup",
            label: "App boots in production",
            detail: 'env: "production"',
          },
          {
            eyebrow: "guards",
            label: "Four refuse-to-boot checks",
            detail: "secret, cors '*', csrf, X-Forwarded-*",
            tone: "accent",
          },
          {
            eyebrow: "misconfig",
            label: "Refuses to start / first request 500",
            detail: "loud error during startup",
            tone: "danger",
          },
          {
            eyebrow: "clean",
            label: "Serves traffic",
            detail: "all guards satisfied",
            tone: "success",
          },
        ]}
        caption="In production each guard turns a common misconfiguration into a refuse-to-boot or first-request 500 instead of a silent vulnerability under load. Dev and CI keep working with sample secrets."
      />

      <h2 id="1-weak-session-secret-refuse-to-boot">1. Weak session secret refuse-to-boot</h2>
      <p>
        <code>
          app.use(session({"{"} secret {"}"}))
        </code>{" "}
        now refuses to register in production when the secret is shorter than 32
        UTF-8 bytes, matches a well-known placeholder (
        <code>&quot;changeme&quot;</code>,{" "}
        <code>&quot;your-jwt-secret&quot;</code>,{" "}
        <code>&quot;it-is-very-secret&quot;</code>, …), or is a single repeated
        character (<code>&quot;a&quot;.repeat(64)</code>,{" "}
        <code>&quot;0&quot;.repeat(64)</code>). The check runs synchronously
        inside <code>app.use(...)</code> so the process exits during startup,
        not on first request.
      </p>
      <CodeBlock
        code={`import { App, session } from "@daloyjs/core";

const app = new App({ env: "production" });

// Throws at boot - secret is >= 16 chars, but < 32 bytes.
app.use(session({ secret: "sixteen-chars-ok" }));

// Also throws - known weak placeholder.
app.use(session({ secret: "your-session-secret-for-production" }));

// Generate one with: openssl rand -base64 48
app.use(session({ secret: process.env.SESSION_SECRET! }));`}
      />

      <p>
        Third-party session implementations can opt into the same check by
        stamping <code>SESSION_HOOK_MARKER</code> and{" "}
        <code>SESSION_SECRETS_MARKER</code> on the returned <code>Hooks</code>{" "}
        object. The standalone helper{" "}
        <code>assertStrongSecret(secret, scope)</code> is also exported for use
        in your own boot code.
      </p>

      <h2 id="2-cors-refuse-to-boot">
        2.{" "}
        <code>
          cors({"{"} origin: &quot;*&quot; {"}"})
        </code>{" "}
        refuse-to-boot
      </h2>
      <p>
        A wildcard CORS origin exposes every state-changing route cross-origin
        and is almost never what production wants. Daloy now refuses to register
        a <code>cors()</code> hook whose <code>origin</code> is{" "}
        <code>&quot;*&quot;</code> or an array containing{" "}
        <code>&quot;*&quot;</code> in production.
      </p>
      <CodeBlock
        code={`import { App, cors } from "@daloyjs/core";

const app = new App({ env: "production" });

// Throws at boot.
app.use(cors({ origin: "*" }));

// Use an explicit allowlist instead.
app.use(cors({ origin: ["https://app.example.com"] }));

// Or a predicate.
app.use(cors({ origin: (o) => o.endsWith(".example.com") }));`}
      />

      <h2 id="3-session-state-changing-route-without-csrf">
        3. <code>session()</code> + state-changing route without{" "}
        <code>csrf()</code>
      </h2>
      <p>
        When any route accepts <code>POST</code>, <code>PUT</code>,{" "}
        <code>PATCH</code>, or <code>DELETE</code> AND a <code>session()</code>{" "}
        hook is installed, a <code>csrf()</code> hook must also be installed.
        The check runs on first request (because route registration order is
        unknown until then) and the boot error is cached so every subsequent
        request rethrows the same failure until you fix the wiring.
      </p>
      <CodeBlock
        code={`import { App, session, csrf } from "@daloyjs/core";

const app = new App({ env: "production" });
app.use(session({ secret: process.env.SESSION_SECRET! }));
app.use(csrf({ strategy: "fetch-metadata", allowedOrigins: ["https://app.example.com"] }));

app.route({
  method: "POST",
  path: "/items",
  // ...
});`}
      />

      <p>
        Non-browser apps (machine-to-machine APIs, webhook receivers behind
        bearer auth) can acknowledge that CSRF does not apply with{" "}
        <code>
          app({"{"} csrf: &quot;off&quot; {"}"})
        </code>
        :
      </p>
      <CodeBlock
        code={`const app = new App({ env: "production", csrf: "off" });
app.use(session({ secret: process.env.SESSION_SECRET! }));
// state-changing routes ok without csrf()`}
      />

      <h2 id="4-x-forwarded-with-trustproxy-unset-returns-500">
        4. <code>X-Forwarded-*</code> with <code>trustProxy</code> unset returns
        500
      </h2>
      <p>
        When{" "}
        <code>
          app({"{"} trustProxy {"}"})
        </code>{" "}
        is not set and a request arrives carrying <code>X-Forwarded-For</code>,{" "}
        <code>X-Forwarded-Host</code>, <code>X-Forwarded-Proto</code>,{" "}
        <code>X-Forwarded-Port</code>, or <code>X-Real-IP</code>, Daloy refuses
        to dispatch the request and returns a structured{" "}
        <code>500 problem+json</code>. The rate limiter, audit log, and
        request-id propagation would otherwise honour the attacker-supplied IP.
      </p>
      <CodeBlock
        code={`// Pick exactly one in production:

// (a) Running behind a trusted reverse proxy (nginx, ALB, Cloudflare):
const app = new App({ env: "production", trustProxy: true });

// (b) Direct-to-process - ignore forwarded headers:
const app = new App({ env: "production", trustProxy: false });

// (c) Disable every boot guard (escape hatch):
const app = new App({ env: "production", secureDefaults: false });`}
      />

      <p>
        The warning is logged at <code>warn</code> exactly once per process via
        a latch, so a flood of forged requests does not flood your logs.
      </p>

      <h2 id="migration-checklist">Migration checklist</h2>
      <ul>
        <li>
          Audit every{" "}
          <code>
            session({"{"} secret {"}"})
          </code>{" "}
          call, regenerate any secret shorter than 32 bytes with{" "}
          <code>openssl rand -base64 48</code>.
        </li>
        <li>
          Replace{" "}
          <code>
            cors({"{"} origin: &quot;*&quot; {"}"})
          </code>{" "}
          with an explicit allowlist or predicate.
        </li>
        <li>
          Add <code>app.use(csrf(...))</code> next to{" "}
          <code>app.use(session(...))</code>, or pass{" "}
          <code>
            app({"{"} csrf: &quot;off&quot; {"}"})
          </code>{" "}
          for non-browser-facing apps.
        </li>
        <li>
          Pick a <code>trustProxy</code> posture explicitly for every production
          app.
        </li>
      </ul>
    </>
  );
}
