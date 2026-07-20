import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Composition & network",
  description:
    "Daloy ships rateLimit({ groupId }) shared buckets, combine primitives every/some/except, ipRestriction() with CIDR allow/deny, and the internal: true route flag with app.inject().",
  path: "/docs/security/composition-network",
  keywords: [
    "DaloyJS combine",
    "every some except",
    "ipRestriction",
    "CIDR allow deny",
    "rateLimit groupId",
    "internal routes",
    "app.inject",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Composition &amp; network</h1>
      <blockquote>
        <strong>Think of it like…</strong> the velvet ropes outside a club. They
        steer traffic into the right line (allow/deny lists via
        <code>ipRestriction</code>), share a single headcount across a group of
        doors (<code>rateLimit({"{ groupId }"})</code>), and let staff slip in
        through the side door without queueing (<code>internal: true</code>
        routes reachable only via <code>app.inject()</code>).
      </blockquote>
      <p>
        Daloy ships the composition & network slice of the secure-by-default
        initiative: four primitives that compose the security stack you already
        have. Every item is opt-in; no existing behaviour changes unless you
        call the new helper.
      </p>

      <h2 id="1-ratelimit-shared-buckets">
        1. <code>rateLimit({"{ groupId }"})</code> shared buckets
      </h2>
      <p>
        Every <code>rateLimit()</code> call that declares the same{" "}
        <code>groupId</code> shares one in-memory bucket. Use it to enforce a
        combined limit across related routes (e.g. login, OTP, password reset)
        without juggling a shared store yourself.
      </p>
      <CodeBlock
        code={`import { App, rateLimit } from "@daloyjs/core";

const app = new App({ env: "production" });
const authLimit = () =>
  rateLimit({ windowMs: 60_000, max: 10, groupId: "auth" });

app.post("/login",          { hooks: authLimit(), ... });
app.post("/login/otp",      { hooks: authLimit(), ... });
app.post("/password-reset", { hooks: authLimit(), ... });
// All three endpoints spend from the same bucket per IP.`}
        language="ts"
      />
      <p>
        When you supply a custom <code>store</code>
        {", "}Daloy still prefixes the derived key with{" "}
        <code>{`\`\${groupId}:\``}</code> so two groups cannot collide in a
        shared Redis backend either.
      </p>

      <h2 id="2-combine-primitives-every-some-except">
        2. <code>combine</code> primitives, <code>every</code> /{" "}
        <code>some</code> / <code>except</code>
      </h2>
      <p>
        Declarative composition for your <code>Hooks</code> bundles. Use them to
        package curated security stacks as a single value and drop the fragile{" "}
        <code>if (...) await next()</code> chains.
      </p>
      <CodeBlock
        code={`import {
  App,
  every, some, except,
  requestId, bearerAuth, rateLimit,
} from "@daloyjs/core";

const adminStack = every(
  requestId(),
  bearerAuth({ validate: (t) => t === process.env.ADMIN_TOKEN }),
  rateLimit({ windowMs: 60_000, max: 30, groupId: "admin" }),
);

const app = new App();

// Mount one curated bundle:
app.use(adminStack);

// "Auth except the public endpoints":
app.use(except(
  ["/health", "/openapi.json", "/docs/**"],
  bearerAuth({ validate: (t) => t === process.env.API_TOKEN }),
));

// "Any one of these proofs of identity is enough":
app.use(some(
  bearerAuth({ validate: (t) => t === process.env.PUBLIC_API_TOKEN }),
  // session-cookie middleware, API-key middleware, ...
));`}
        language="ts"
      />
      <ul>
        <li>
          <code>every(...layers)</code> runs every bundle in order across every
          lifecycle phase. Forwards CORS / CSRF / session security markers so
          boot-time guards still see them on the composed bundle.
        </li>
        <li>
          <code>some(...layers)</code> runs each layer&apos;s auth gate in order
          until one passes. When every candidate uses <code>preBody</code> (as
          the built-in <code>bearerAuth()</code>
          {", "}<code>basicAuth()</code>
          {", "}
          <code>jwk()</code>
          {", "}and <code>clientCertAuth()</code> now do), selection happens
          before body I/O; mixed stacks defer to <code>beforeHandle</code>
          {". "}A returned <code>Response</code> is treated as a denial, the
          next layer gets a turn. The first failure wins when every layer
          rejects, so place the auth scheme whose <code>WWW-Authenticate</code>{" "}
          challenge you want clients to see first.
        </li>
        <li>
          <code>except(when, hooks)</code> skips the wrapped bundle&apos;s{" "}
          <code>preBody</code> and <code>beforeHandle</code> gates for matching
          paths (<code>/health</code>
          {", "}<code>/public/**</code>
          {", "}
          <code>/v1/*/meta</code>) or for any request where the supplied
          predicate returns <code>true</code>
          {". "}Its <code>onRequest</code>
          {", "}
          <code>afterHandle</code>
          {", "}<code>onSend</code>
          {", "}and <code>onResponse</code> phases still run, so shared
          concerns wired through those phases keep working.
        </li>
      </ul>

      <blockquote>
        <strong>Perimeter guards run on unmatched requests too.</strong>{" "}
        <code>beforeHandle</code> guards registered with{" "}
        <code>app.use(...)</code>
        {", "}such as <code>rateLimit()</code>
        {", "}
        <code>ipRestriction()</code>
        {", "}<code>csrf()</code>
        {", "}and your own WAF bundles, also run on the cold dispatch path: a
        request that matches no route (<code>404</code>), hits a registered path
        with the wrong method and gets <code>405</code>
        {", "}or arrives as an <code>OPTIONS</code> preflight. Without this, an
        attacker could flood random paths to slip past a{" "}
        <code>rateLimit()</code> that an operator reasonably expects to cover
        every request. Two consequences worth knowing:
      </blockquote>
      <ul>
        <li>
          A flood of <code>404</code>s is now throttled / IP-fenced just like
          traffic to a real route.
        </li>
        <li>
          When auth is installed globally (e.g.{" "}
          <code>app.use(except(exempt, bearerAuth(...)))</code>), an
          unauthenticated request to an <em>unmatched</em> path is rejected with{" "}
          <code>401</code> rather than <code>404</code>
          {". "}This is intentional route-enumeration resistance: the perimeter
          answers the same way whether or not the route exists. Per-route hooks
          are unaffected, and no handler is ever reached. Need public unknown
          paths to stay plain <code>404</code>s instead? Avoid global{" "}
          <code>app.use()</code> auth for that surface; use route/group-scoped
          hooks for auth and reserve <code>App({"{ hooks }"})</code>{" "}
          <code>onRequest</code> for checks that should truly run before
          routing.
        </li>
      </ul>

      <h2 id="3-iprestriction-cidr-allow-deny">
        3. <code>ipRestriction()</code>
        {": "}CIDR allow / deny
      </h2>
      <p>
        Block or allow requests by source IP or CIDR range. Pairs naturally with{" "}
        <code>trustProxyHeaders: true</code> behind a trusted proxy so the
        matched address is the real client, not your load balancer. Supports
        IPv4, IPv6, and IPv4-mapped IPv6 (<code>::ffff:a.b.c.d</code>).{" "}
        <code>deny</code> always wins over <code>allow</code>.
      </p>
      <CodeBlock
        code={`import { App, ipRestriction } from "@daloyjs/core";

const app = new App({ env: "production", trustProxy: true });

app.use(ipRestriction({
  allow: ["10.0.0.0/8", "192.168.1.0/24", "::1"],
  deny:  ["10.6.6.0/24"],
  trustProxyHeaders: true,
}));

// Rejected requests:
//   HTTP/1.1 403 Forbidden
//   content-type: application/problem+json
//   { "title": "Forbidden", "detail": "IP address not permitted" }`}
        language="ts"
      />
      <p>
        Invalid IP literals, invalid CIDR prefixes, and calls with neither an{" "}
        <code>allow</code> nor <code>deny</code> list throw at construction
        time, catching bugs that would otherwise hide until production traffic
        hits. By default the helper fails closed because Web-standard requests
        do not expose the peer address. Supply <code>resolveIp</code> if your
        adapter exposes connection metadata or if you sit behind a CDN that
        sends the real client through a custom header such as{" "}
        <code>cf-connecting-ip</code> or <code>true-client-ip</code>.
      </p>

      <h2 id="4-internal-true-app-inject">
        4. <code>internal: true</code> + <code>app.inject()</code>
      </h2>
      <p>
        Mark a route as <code>internal: true</code> and the public{" "}
        <code>app.fetch(...)</code> entry point returns <code>404</code>
        {": "}
        existence cannot be probed. The same route runs normally through{" "}
        <code>app.inject(request)</code>
        {", "}which is meant for cron jobs, admin scripts, and integration
        tests. Internal routes are also excluded from generated OpenAPI by
        default; pass <code>includeInternal: true</code> to{" "}
        <code>generateOpenAPI()</code> (imported from the{" "}
        <code>@daloyjs/core/openapi</code> subpath) for private admin SDK
        generation. The framework also filters
        <code>Allow</code> headers so a probe with a different method stays a
        clean <code>404</code> rather than a leaky <code>405</code>.
      </p>

      <BranchDiagram
        title="Two entry points, one internal route"
        source={{
          eyebrow: "route",
          label: "internal: true route",
          detail: "/__admin/reindex",
        }}
        branches={[
          {
            eyebrow: "public",
            label: "app.fetch()",
            detail: "404, existence cannot be probed",
            tone: "danger",
          },
          {
            eyebrow: "in-process",
            label: "app.inject()",
            detail: "runs normally, 204",
            tone: "success",
          },
        ]}
        caption="The public adapter returns 404 for an internal route so its existence stays hidden, while cron jobs, admin scripts, and tests reach it through app.inject(). Internal routes are also excluded from generated OpenAPI by default."
      />

      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { generateOpenAPI } from "@daloyjs/core/openapi";

const app = new App();

app.post(
  "/__admin/reindex",
  {
    internal: true,
    responses: { 204: { description: "Started" } },
  },
  () => ({ status: 204 }),
);

// Public adapter - 404
await app.fetch(new Request("http://app/__admin/reindex", { method: "POST" }));

// In-process / cron / tests - 204
await app.inject(new Request("http://app/__admin/reindex", { method: "POST" }));

// Public spec - internal routes omitted
const publicSpec = generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
});

// Private admin SDK generation - internal routes included
const adminSpec = generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
  includeInternal: true,
});`}
        language="ts"
      />

      <h2 id="opt-out">Opt-out</h2>
      <p>
        Every primitive in this slice is additive; nothing changes unless you
        call the helper. The earlier secure-defaults master opt-out flag still
        applies if you ever need to disable secure defaults in a development
        sandbox:
      </p>
      <CodeBlock
        code={`const app = new App({ env: "development", secureDefaults: false });`}
        language="ts"
      />
    </>
  );
}
