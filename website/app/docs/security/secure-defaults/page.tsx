import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Secure-by-default",
  description:
    "Daloy auto-applies secureHeaders() and rejects cross-origin state-changing requests unless cors() is registered. Learn the new defaults, escape hatches, and per-route opt-ins.",
  path: "/docs/security/secure-defaults",
  keywords: [
    "DaloyJS secure defaults",
    "secureHeaders auto",
    "CORS cross-origin guard",
    "CORS origin allowlist",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Secure-by-default</h1>
      <blockquote>
        <strong>Think of it like…</strong> a brand-new car. Seatbelts are
        buckled, airbags are armed, doors are locked when you start moving. You{" "}
        <em>can</em> turn any of those off, but only by deliberately pressing a
        button labelled &quot;I know this is unsafe&quot; (
        <code>secureDefaults: false</code> +{" "}
        <code>acknowledgeInsecureDefaults: true</code>), and the car logs that
        you did.
      </blockquote>
      <p>
        Daloy is the first release in the &ldquo;secure-by-default&rdquo;
        series. It flips secure headers and cross-origin write protection on by
        default, adds a per-route content type opt-in, and keeps a single master
        escape hatch (<code>secureDefaults: false</code>) plus per-feature
        opt-outs for the rare cases where you genuinely need the old behavior.
      </p>

      <BranchDiagram
        title="What new App() arms for you"
        source={{
          eyebrow: "construction",
          label: "new App()",
          detail: "no middleware calls required",
        }}
        branches={[
          {
            label: "secureHeaders() auto-applied",
            detail: "HSTS, frame DENY, nosniff, baseline CSP",
            tone: "success",
          },
          {
            label: "Cross-origin write guard",
            detail: "POST/PUT/PATCH/DELETE need cors()",
            tone: "success",
          },
          {
            label: "Per-route accepts allowlist",
            detail: "content-type opt-in per route",
            tone: "success",
          },
        ]}
        caption="A fresh App instance ships these defaults armed. Each one has a per-feature opt-out, and secureDefaults: false is the single master escape hatch for migrations."
      />

      <h2 id="what-flipped">What flipped</h2>

      <h3 id="1-secureheaders-is-now-auto-applied">
        1. <code>secureHeaders()</code> is now auto-applied
      </h3>
      <p>
        Every <code>new App()</code> instance ships <code>secureHeaders()</code>{" "}
        with the same sensible defaults the middleware has always had: HSTS,{" "}
        <code>X-Frame-Options: DENY</code>,{" "}
        <code>X-Content-Type-Options: nosniff</code>, a strict{" "}
        <code>Referrer-Policy</code>, and a baseline CSP. No code change
        required.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App();
// secureHeaders() already attached - no app.use(secureHeaders()) needed.`}
      />

      <p>
        If you call <code>app.use(secureHeaders(...))</code> with your own
        configuration, the auto-installed instance is automatically removed so
        your overrides win instead of being silently shadowed by the
        framework&apos;s defaults.
      </p>
      <CodeBlock
        code={`import { App, secureHeaders } from "@daloyjs/core";

const app = new App();
app.use(
  secureHeaders({
    contentSecurityPolicy: "default-src 'self'; script-src 'self' 'nonce-{nonce}'",
    frameOptions: "SAMEORIGIN",
  }),
);
// The framework's default secureHeaders is dropped; your config is the only one active.`}
      />

      <p>
        Want the headers configured at construction time instead? Pass a{" "}
        <code>secureHeaders</code> object to <code>new App()</code>:
      </p>
      <CodeBlock
        code={`const app = new App({
  secureHeaders: { frameOptions: "SAMEORIGIN" },
});`}
      />

      <p>
        To opt out entirely (e.g. you serve content from a CDN that injects its
        own headers):
      </p>
      <CodeBlock code={`const app = new App({ secureHeaders: false });`} />

      <h3 id="2-cross-origin-post-put-patch-delete-require-cors">
        2. Cross-origin <code>POST</code> / <code>PUT</code> /{" "}
        <code>PATCH</code> / <code>DELETE</code> require <code>cors()</code>
      </h3>
      <p>
        State-changing requests carrying an <code>Origin</code> header from a
        different origin than the request URL are now rejected with{" "}
        <code>403 problem+json</code> unless the matched route has a{" "}
        <code>cors()</code> policy that allows that origin. Read-only methods (
        <code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code>), same-origin
        requests, and requests without an <code>Origin</code> header (or with{" "}
        <code>Origin: null</code> from a sandboxed iframe) pass through
        unchanged.
      </p>

      <FlowDiagram
        title="Cross-origin write admission"
        numbered
        steps={[
          {
            eyebrow: "ingress",
            label: "Cross-origin POST/PUT/PATCH/DELETE",
            detail: "Origin differs from request URL",
          },
          {
            eyebrow: "guard",
            label: "cors() allows the origin?",
            detail: "matched route policy decides",
            tone: "accent",
          },
          {
            eyebrow: "no policy",
            label: "Rejected",
            detail: "403 application/problem+json",
            tone: "danger",
          },
          {
            eyebrow: "allowed",
            label: "Reaches your handler",
            detail: "origin on the cors() allowlist",
            tone: "success",
          },
        ]}
        caption="Without a cors() policy that allows the origin, a cross-origin state-changing request is rejected with 403 before your handler runs. Read-only methods and same-origin requests are never affected."
      />

      <CodeBlock
        code={`import { App, cors } from "@daloyjs/core";

const app = new App();
app.use(cors({ origin: ["https://app.example.com"] }));
// Register this before the routes it should apply to.
// Cross-origin POST from https://app.example.com now passes through to your handler.`}
      />

      <p>
        Per-route opt-in works too, register the <code>cors()</code> hook on
        the specific routes that need it via{" "}
        <code>route({"{ hooks: cors({...}) }"})</code>.
      </p>

      <p>
        To disable the guard entirely (you handle cross-origin admission another
        way, e.g. via <code>csrf()</code> with the <code>fetch-metadata</code>{" "}
        strategy):
      </p>
      <CodeBlock
        code={`const app = new App({ corsCrossOriginGuard: false });`}
      />

      <h3 id="3-per-route-accepts-field">
        3. Per-route <code>accepts</code> field
      </h3>
      <p>
        New <code>route({"{ accepts: [...] }"})</code> field overrides the
        global <code>allowedContentTypes</code> allowlist for a single route.
        The default allowlist already covers <code>application/json</code>,{" "}
        <code>application/x-www-form-urlencoded</code>, and{" "}
        <code>multipart/form-data</code>, so use <code>accepts</code> to{" "}
        <em>restrict</em> a route to a subset (the example below accepts only
        form-encoded and rejects JSON with <code>415</code>) or to accept a type
        outside that set (e.g. <code>application/xml</code>) without touching the
        global allowlist.
      </p>
      <CodeBlock
        code={`app.post(
  "/legacy/webhook",
  {
    operationId: "legacyWebhook",
    accepts: ["application/x-www-form-urlencoded"],
    request: { body: z.object({ payload: z.string() }) },
    responses: { 200: { description: "ok" } },
  },
  async ({ body }) => ({ status: 200 as const, body: { ok: true } }),
);`}
      />

      <h2 id="the-master-escape-hatch">The master escape hatch</h2>
      <p>
        If you need to adopt Daloy without changing an existing
        application&apos;s behavior in the same deployment, pass{" "}
        <code>secureDefaults: false</code> as a temporary migration hatch:
      </p>
      <CodeBlock code={`const app = new App({ secureDefaults: false });`} />
      <p>
        This is intentionally one-shot: there is no per-feature granular master
        flag because the per-feature opt-outs already exist (
        <code>secureHeaders: false</code>,{" "}
        <code>corsCrossOriginGuard: false</code>). Use{" "}
        <code>secureDefaults: false</code> as a time-boxed migration hatch, not
        a permanent posture.
      </p>

      <h2 id="detection-markers-advanced">Detection markers (advanced)</h2>
      <p>
        The framework detects <code>secureHeaders()</code> and{" "}
        <code>cors()</code> registration via two exported symbols. If you wrap
        these middleware in your own helpers, stamp the marker on your returned
        hooks to get the same behavior:
      </p>
      <CodeBlock
        code={`import {
  cors,
  secureHeaders,
  CORS_HOOK_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  SECURE_HEADERS_MARKER,
} from "@daloyjs/core";

export function myCors() {
  const hooks = cors({ origin: ["https://app.example.com"] });
  // already stamped with CORS_HOOK_MARKER and CORS_ORIGIN_ALLOW_MARKER.
  return hooks;
}

export function myCustomHeaders() {
  const hooks = secureHeaders({ frameOptions: "SAMEORIGIN" });
  // already stamped; the auto-installed instance will be dropped when you use() this.
  return hooks;
}`}
      />

      <h2 id="migration-checklist">Migration checklist</h2>
      <ul>
        <li>
          Audit any custom <code>secureHeaders()</code> call sites. Behavior is
          the same, the auto-installed instance is automatically replaced when
          you register your own.
        </li>
        <li>
          Audit any cross-origin <code>POST</code> / <code>PUT</code> /{" "}
          <code>PATCH</code> / <code>DELETE</code> tests / integrations.
          Register <code>cors()</code> (recommended) or pass{" "}
          <code>corsCrossOriginGuard: false</code> (if you handle cross-origin
          admission via <code>csrf({"{ strategy: 'fetch-metadata' }"})</code>,
          for example).
        </li>
        <li>
          For legacy form-encoded routes, add{" "}
          <code>accepts: [&quot;application/x-www-form-urlencoded&quot;]</code>{" "}
          on the route definition.
        </li>
        <li>
          If you must ship the upgrade with zero behavior change while you
          triage, set <code>secureDefaults: false</code> as a temporary escape
          hatch.
        </li>
      </ul>

      <h2 id="related-secure-defaults">Related secure defaults</h2>
      <p>
        Daloy&apos;s wider secure-default posture also covers CSP nonces,
        per-content-type body caps, development response-schema validation,
        conditional <code>/openapi.json</code> exposure in production,
        clickjacking defenses, and trailing-slash canonicalization. Use the
        focused security pages for configuration details and scoped opt-outs.
      </p>
    </>
  );
}
