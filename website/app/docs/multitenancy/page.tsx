import type { Route } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Multitenancy",
  description:
    "Resolve, validate, and isolate tenants with the secure-by-default tenancy() middleware: pluggable resolution (subdomain, header, path, JWT claim, or custom), refuse-unresolved by default, format-validated tenant ids, no-enumeration rejection, and a tenantScope() helper that partitions rateLimit, concurrencyLimit, idempotency, and responseCache per tenant.",
  path: "/docs/multitenancy",
  keywords: [
    "multitenancy",
    "multi-tenant",
    "tenant isolation",
    "DaloyJS tenancy",
    "tenantScope",
    "tenantFromSubdomain",
    "per-tenant rate limit",
    "subdomain routing",
    "tenant context",
    "SaaS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Multitenancy</h1>
      <p>
        DaloyJS ships <code>tenancy()</code>
        {", "}a <strong>dependency-free</strong>
        {", "}secure-by-default <code>Hooks</code> bundle that resolves the
        calling tenant <em>once</em> per request, validates and normalizes it,
        and exposes it on <code>ctx.state.tenant</code>
        {". "}It is the single source of truth for &ldquo;who is this request
        for&rdquo; so the per-tenant isolation knobs already on the framework (<code>rateLimit</code>
        {", "}
        <code>concurrencyLimit</code>
        {", "}<code>idempotency</code>
        {", "}
        <code>responseCache</code>) can all key off the same resolved value via{" "}
        <code>tenantScope()</code>.
      </p>

      <FlowDiagram
        title="Resolve once, then isolate"
        numbered
        steps={[
          {
            eyebrow: "request",
            label: "Incoming request",
            detail: "subdomain · header · path · claim",
          },
          {
            eyebrow: "tenancy()",
            label: "Resolve + validate + normalize",
            detail: "ctx.state.tenant",
            tone: "accent",
          },
          {
            eyebrow: "tenantScope()",
            label: "Partition isolation knobs",
            detail:
              "rateLimit · concurrencyLimit · idempotency · responseCache",
          },
          {
            eyebrow: "handler",
            label: "Tenant-scoped work",
            detail: "ordersFor(state.tenant)",
            tone: "success",
          },
        ]}
        caption="tenancy() resolves the calling tenant once per request and writes it to ctx.state.tenant. Register it first so tenantScope() can key every per-tenant bucket off the same value. If a limiter runs before tenancy(), its key falls back to tenant:unknown."
      />

      <h2 id="quick-start">Quick start</h2>
      <p>
        Resolve the tenant from the request subdomain, bound the space with an
        allowlist, and give every tenant its own rate-limit bucket. Register{" "}
        <code>tenancy()</code> <strong>before</strong> the isolation middleware
        so <code>ctx.state.tenant</code> is set by the time they run.
      </p>
      <CodeBlock
        code={`import { App, rateLimit, tenancy, tenantFromSubdomain, tenantScope } from "@daloyjs/core";

const app = new App({
  // Global hook → resolves before any group hook below.
  hooks: tenancy({
    resolve: tenantFromSubdomain({ baseDomain: "example.com" }),
    allow: ["acme", "globex"],
  }),
});

// Each tenant gets an independent 100-req/min bucket.
app.use(rateLimit({ windowMs: 60_000, max: 100, keyGenerator: tenantScope() }));

app.get(
  "/orders",
  {
    operationId: "listOrders",
    responses: { 200: { description: "ok" } },
  },
  ({ state }) => {
    // acme.example.com → state.tenant === "acme"
    const tenant = state.tenant as string;
    return { status: 200 as const, body: { tenant, orders: ordersFor(tenant) } };
  },
);`}
        language="ts"
      />

      <h2 id="resolving-the-tenant">Resolving the tenant</h2>
      <p>
        Pass one resolver to <code>resolve</code>
        {", "}or an array tried in order until one returns a non-empty value
        (e.g. prefer a verified JWT claim, fall back to the subdomain). A
        resolver is just a <code>(ctx) =&gt; string | undefined</code>
        {", "}so you can write your own.
      </p>

      <BranchDiagram
        title="Many sources, one resolved tenant"
        source={{
          eyebrow: "resolve",
          label: "Resolver(s) tried in order",
          detail: "first non-empty value wins",
        }}
        branches={[
          {
            eyebrow: "subdomain",
            label: "tenantFromSubdomain()",
            detail: "acme.example.com to acme",
          },
          {
            eyebrow: "header",
            label: "tenantFromHeader()",
            detail: "spoofable, pair with allow",
            tone: "danger",
          },
          {
            eyebrow: "path",
            label: "tenantFromPathPrefix()",
            detail: "/acme/orders to acme",
          },
          {
            eyebrow: "claim",
            label: "tenantFromClaim()",
            detail: "verified JWT/session claim",
          },
          {
            eyebrow: "custom",
            label: "(ctx) => string | undefined",
            detail: "derive it however you like",
          },
        ]}
        converge={{
          eyebrow: "ctx.state.tenant",
          label: "Validated, normalized id",
          detail: "starts/ends alphanumeric, 1 to 63 chars",
        }}
        caption="Pass one resolver or an array tried in order. The first non-empty result is normalized to a conservative tenant-id grammar before it is stored, so a spoofable header value cannot smuggle separators into keys or log lines. tenantFromHeader is opt-in and only safe behind a trusted proxy."
      />

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Resolver</th>
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>tenantFromSubdomain({`{ baseDomain }`})</code>
              </td>
              <td>
                <code>acme.example.com</code> → <code>acme</code>
              </td>
              <td>
                PSL-aware via <code>subdomains()</code>
                {". "}A <code>Host</code> not under <code>baseDomain</code>{" "}
                resolves to <em>unresolved</em> (host-spoof safe), never a{" "}
                <code>500</code>
                {". "}Recommended for production.
              </td>
            </tr>
            <tr>
              <td>
                <code>tenantFromHeader(&quot;x-tenant-id&quot;)</code>
              </td>
              <td>request header</td>
              <td>
                <strong>Spoofable.</strong> Only trust behind a proxy that{" "}
                <em>overwrites</em> the header on every inbound request. Always
                pair with <code>allow</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>tenantFromPathPrefix()</code>
              </td>
              <td>
                <code>/acme/orders</code> → <code>acme</code>
              </td>
              <td>
                Reads the segment only (does not rewrite the path); your routes
                still include the tenant segment.
              </td>
            </tr>
            <tr>
              <td>
                <code>tenantFromClaim(&quot;org&quot;)</code>
              </td>
              <td>
                <code>ctx.state.auth.credentials.org</code>
              </td>
              <td>
                For a verified JWT/session claim. The auth middleware that
                populates it must run <em>before</em> <code>tenancy()</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>(ctx) =&gt; string | undefined</code>
              </td>
              <td>anything</td>
              <td>Custom resolver: derive the id however you like.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CodeBlock
        code={`// Prefer a verified claim, fall back to the subdomain.
tenancy({
  resolve: [tenantFromClaim("org"), tenantFromSubdomain({ baseDomain: "example.com" })],
});`}
        language="ts"
      />

      <h2 id="options-reference">Options reference</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>resolve</code>
              </td>
              <td>
                <code>TenantResolver | TenantResolver[]</code>
              </td>
              <td>(required)</td>
              <td>Resolver(s) tried in order; first non-empty wins.</td>
            </tr>
            <tr>
              <td>
                <code>require</code>
              </td>
              <td>
                <code>boolean</code>
              </td>
              <td>
                <code>true</code>
              </td>
              <td>
                Reject unresolved requests. The secure default: an unresolved
                request is never served as an ambient &ldquo;default&rdquo;
                tenant.
              </td>
            </tr>
            <tr>
              <td>
                <code>allow</code>
              </td>
              <td>
                <code>string[] | (id, ctx) =&gt; boolean</code>
              </td>
              <td>-</td>
              <td>
                Bound the tenant space. Array entries are validated at
                construction. A disallowed id is rejected with{" "}
                <code>invalidStatus</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>normalize</code>
              </td>
              <td>
                <code>(raw) =&gt; string | undefined</code>
              </td>
              <td>trim + lowercase + strict charset</td>
              <td>
                Validate/canonicalize the raw id. Return <code>undefined</code>{" "}
                to reject. The default accepts 1-63 lowercase alphanumeric
                characters, with <code>-</code> and <code>_</code> allowed only
                inside the id.
              </td>
            </tr>
            <tr>
              <td>
                <code>stateKey</code>
              </td>
              <td>
                <code>string</code>
              </td>
              <td>
                <code>&quot;tenant&quot;</code>
              </td>
              <td>
                <code>ctx.state</code> key the resolved id is written to.
              </td>
            </tr>
            <tr>
              <td>
                <code>unresolvedStatus</code>
              </td>
              <td>
                <code>400 | 401 | 403 | 404</code>
              </td>
              <td>
                <code>400</code>
              </td>
              <td>
                Status when <code>require</code> is true and nothing resolved.
              </td>
            </tr>
            <tr>
              <td>
                <code>invalidStatus</code>
              </td>
              <td>
                <code>400 | 403 | 404</code>
              </td>
              <td>
                <code>404</code>
              </td>
              <td>
                Status for a resolved-but-disallowed/malformed id.{" "}
                <code>404</code> avoids tenant enumeration.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="per-tenant-isolation-with-tenantscope">
        Per-tenant isolation with <code>tenantScope()</code>
      </h2>
      <p>
        <code>tenantScope()</code> returns a <code>(ctx) =&gt; string</code> key
        function that reads <code>ctx.state.tenant</code> and returns a{" "}
        <code>tenant:&lt;id&gt;</code> partition key. Drop it into the isolation
        knobs so each tenant gets its own bucket / namespace and cannot exhaust,
        read, or poison another tenant&apos;s:
      </p>
      <CodeBlock
        code={`import { tenantScope, rateLimit, concurrencyLimit, idempotency, responseCache } from "@daloyjs/core";

const scope = tenantScope(); // (ctx) => "tenant:<id>"

rateLimit({ windowMs: 60_000, max: 100, keyGenerator: scope });
concurrencyLimit({ maxConcurrent: 20, scope });
idempotency({ scope });   // CWE-524 cross-tenant cached-response defense

// responseCache differs: its keyGenerator REPLACES the whole cache key, and it
// takes ttlSeconds (not ttlMs). Fold the tenant in alongside the path yourself,
// or every URL for a tenant would collide on one entry.
responseCache({
  ttlSeconds: 30,
  keyGenerator: (ctx) => {
    const u = new URL(ctx.request.url);
    return \`\${scope(ctx)}:\${ctx.request.method} \${u.pathname}\${u.search}\`;
  },
});`}
        language="ts"
      />
      <p>
        <strong>Ordering matters.</strong> <code>tenancy()</code> resolves in{" "}
        <code>beforeHandle</code>
        {", "}and so do these consumers. Register <code>tenancy()</code> first,
        as a global hook (<code>new App({`{ hooks: tenancy(...) }`}</code>) or
        the first <code>app.use(...)</code>
        {", "}so the tenant is populated before any <code>keyGenerator</code> /{" "}
        <code>scope</code> callback runs. If a limiter runs first, its key falls
        back to <code>tenant:unknown</code>.
      </p>

      <h2 id="database-isolation-is-yours-to-wire">
        Database isolation is yours to wire
      </h2>
      <p>
        This is the boundary worth being explicit about, because people coming
        from &ldquo;the framework guarantees isolation with Row-Level
        Security&rdquo; expect more than any Node framework can deliver.{" "}
        <code>tenancy()</code> owns tenant <em>identity</em> (a verified,
        normalized, non-spoofable <code>ctx.state.tenant</code>) and{" "}
        <code>tenantScope()</code> owns per-tenant <em>resource</em> isolation
        (rate-limit, concurrency, cache, and idempotency buckets). What it
        deliberately does <em>not</em> do is reach into your database and
        enforce row isolation, that last inch lives in your data layer. The
        clean, trustworthy id is exactly what that layer needs:
      </p>
      <CodeBlock
        code={`// (a) Scope every query with the verified id.
const rows = await db.query(
  "SELECT * FROM invoices WHERE tenant_id = $1",
  [ctx.state.tenant],
);

// (b) Or drive Postgres Row-Level Security from a per-request session
// variable, then let your RLS policies do the enforcing.
await db.query("SET app.current_tenant = $1", [ctx.state.tenant]);
// CREATE POLICY tenant_isolation ON invoices
//   USING (tenant_id = current_setting('app.current_tenant'));`}
        language="ts"
      />
      <p>
        Either way, the value reaching your database was already validated and
        normalized by <code>tenancy()</code>
        {", "}so a spoofed header or a <code>Host</code> outside your{" "}
        <code>baseDomain</code> can never become a query parameter or an RLS
        session variable. The{" "}
        <Link href={"/docs/security/resource-authorization" as Route}>
          resource authorization guide
        </Link>{" "}
        shows how to combine that tenant constraint with user ownership and
        cross-tenant attack tests.
      </p>

      <h2 id="typing-ctx-state-tenant">
        Typing <code>ctx.state.tenant</code>
      </h2>
      <p>
        Augment <code>AppState</code> so the resolved tenant is strongly typed
        in every handler and hook. Put the <code>declare module</code> block in
        a regular <code>.ts</code> module the compiler always checks (for
        example the file where you register <code>tenancy()</code>), not in a
        separate <code>.d.ts</code> file: declaration files are exempt from
        type-checking when <code>skipLibCheck</code> is on (the scaffolded
        default), so a mistake inside one fails silently.
      </p>
      <CodeBlock
        code={`// src/build-app.ts (same module where tenancy() is registered)
declare module "@daloyjs/core" {
  interface AppState {
    tenant?: string;
  }
}

// Now ctx.state.tenant is string | undefined everywhere.`}
        language="ts"
      />

      <h2 id="security-posture">Security posture</h2>
      <ul>
        <li>
          <strong>Refuse-unresolved by default.</strong> With{" "}
          <code>require: true</code>
          {", "}a request whose tenant cannot be resolved is rejected rather
          than silently served as a default tenant, the failure mode that leaks
          one tenant&apos;s data to another.
        </li>
        <li>
          <strong>Format-validated ids.</strong> Resolved ids are normalized to
          a conservative tenant-id grammar before they are stored or used as a
          key. A spoofable header value cannot smuggle newlines, <code>:</code>
          {", "}
          <code>/</code>
          {", "}or <code>*</code> into rate-limit keys, cache keys, or log
          lines (key/log injection, cache poisoning).
        </li>
        <li>
          <strong>No enumeration.</strong> A resolved-but-unknown tenant is{" "}
          <code>404</code> by default, indistinguishable from a missing route,
          so attackers cannot probe for valid tenant names.
        </li>
        <li>
          <strong>Host-spoof safe.</strong> <code>tenantFromSubdomain</code>{" "}
          treats a <code>Host</code> that is not under the declared{" "}
          <code>baseDomain</code> as unresolved instead of trusting it.
        </li>
        <li>
          <strong>Header resolution is opt-in and spoofable.</strong> Only use{" "}
          <code>tenantFromHeader</code> behind a trusted proxy that overwrites
          the header, and bound it with <code>allow</code>.
        </li>
      </ul>

      <h2 id="runnable-example">Runnable example</h2>
      <p>
        <code>examples/multitenancy-demo.ts</code> wires subdomain resolution +
        an allowlist + per-tenant rate limiting + a per-tenant in-memory store.
        The Node adapter builds the request URL from the <code>Host</code>{" "}
        header, so you can exercise subdomains locally without DNS:
      </p>
      <CodeBlock
        code={`node --import tsx examples/multitenancy-demo.ts

# acme's data is isolated from globex's:
curl -s localhost:3003/orders -H 'Host: acme.example.com'
curl -s -X POST localhost:3003/orders -H 'Host: acme.example.com' \\
  -H 'content-type: application/json' -d '{"item":"widget","total":9.99}'
curl -s localhost:3003/orders -H 'Host: globex.example.com'   # still empty

# Unknown tenant → 404 (no enumeration); no subdomain → 400:
curl -s -o /dev/null -w '%{http_code}\\n' localhost:3003/orders -H 'Host: intruder.example.com'
curl -s -o /dev/null -w '%{http_code}\\n' localhost:3003/orders -H 'Host: example.com'`}
        language="sh"
      />

      <h2 id="tree-shake-friendly-subpath">Tree-shake-friendly subpath</h2>
      <CodeBlock
        code={`// Main barrel:
import { tenancy, tenantScope } from "@daloyjs/core";

// Or, to keep your bundle minimal:
import { tenancy, tenantScope } from "@daloyjs/core/tenancy";`}
        language="ts"
      />
    </>
  );
}
