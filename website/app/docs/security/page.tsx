import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram, LayerStack } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Security",
  description:
    "DaloyJS ships core-enforced security guardrails plus first-party middleware for secure headers, rate limits, CORS, CSRF, sessions, and supply-chain hardening.",
  path: "/docs/security",
  keywords: [
    "DaloyJS security",
    "secure HTTP defaults",
    "rate limiting",
    "secure headers",
    "OWASP TypeScript",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Security</h1>
      <p>
        Bad defaults are bugs. DaloyJS separates core-enforced guardrails from
        first-party security middleware so the dangerous things are blocked by
        default and the deployment-specific things stay explicit.
      </p>
      <blockquote>
        <strong>Think of it like…</strong> a modern car. Seatbelts, airbags,
        crumple zones, and ABS are built in and armed by default (core
        guardrails). The route the driver takes, who&apos;s allowed in the
        passenger seat, and whether you need a child seat are decisions you make
        per trip (first-party middleware). You don&apos;t have to wire the
        airbag yourself, but you do have to pick a destination.
      </blockquote>

      <LayerStack
        title="Two layers of defense"
        flow="down"
        layers={[
          {
            title: "Core-enforced guardrails",
            detail: "armed by default, no middleware call required",
            tone: "success",
            items: [
              "bodyLimitBytes",
              "safeJsonParse",
              "sanitizeHeaderValue",
              "path-traversal reject",
              "requestTimeoutMs",
              "405 + Allow",
              "prod 5xx redaction",
            ],
          },
          {
            title: "First-party security middleware",
            detail: "explicit, because policy is a deployment decision",
            tone: "accent",
            items: [
              "secureHeaders()",
              "cors()",
              "csrf()",
              "rateLimit()",
              "session()",
              "bearerAuth()",
            ],
          },
        ]}
        caption="The dangerous things are blocked in the core without any setup. The deployment-specific things (CSP, CORS origins, session secrets, CSRF rollout) stay explicit middleware you opt into."
      />

      <h2 id="plain-english-analogies-for-every-protection">
        Plain-English analogies for every protection
      </h2>
      <p>
        If the terminology in this page feels abstract, this table maps every
        major protection to an everyday analogy. Skim it once and the rest of
        the security docs read a lot faster.
      </p>
      <table>
        <thead>
          <tr>
            <th>Protection</th>
            <th>Think of it like…</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Body-size limit</td>
            <td>
              A weight limit on a parcel before the post office accepts it, so
              one oversized package can&apos;t jam the whole sorting room.
            </td>
          </tr>
          <tr>
            <td>Prototype-pollution-safe JSON</td>
            <td>
              A customs form that ignores hand-written notes in the margins.
              Only the printed boxes count, so smugglers can&apos;t scribble
              extra instructions (<code>__proto__</code>) that would quietly
              change how every later parcel in the building gets handled.
            </td>
          </tr>
          <tr>
            <td>Header / response splitting guard</td>
            <td>
              An envelope machine that refuses to print address labels with
              line-breaks in them, so nobody can sneak a second mailing address
              onto your package.
            </td>
          </tr>
          <tr>
            <td>Path-traversal safety</td>
            <td>
              A library desk that quietly rewrites any call number with
              &quot;..&quot; in it back to a real shelf. You always end up at a
              valid book, never in the staff-only basement.
            </td>
          </tr>
          <tr>
            <td>Request timeout</td>
            <td>
              A taxi with a hard limit on the meter: at 30 seconds the ride ends
              whether you arrived or not, so a passenger who fell asleep
              can&apos;t hold the cab forever.
            </td>
          </tr>
          <tr>
            <td>Method 405 (with Allow header)</td>
            <td>
              A receptionist who tells you &quot;this counter only handles
              deposits and withdrawals&quot; instead of pretending the counter
              doesn&apos;t exist.
            </td>
          </tr>
          <tr>
            <td>Production 5xx redaction</td>
            <td>
              A &quot;sorry, we&apos;re experiencing issues&quot; sign on a shop
              window instead of taping the till&apos;s error printout to the
              glass.
            </td>
          </tr>
          <tr>
            <td>secureHeaders (CSP, HSTS, X-Frame-Options)</td>
            <td>
              A bouncer who tells every passing browser: &quot;only run scripts
              from this building, always use HTTPS, and no, you can&apos;t stuff
              this page inside someone else&apos;s frame.&quot;
            </td>
          </tr>
          <tr>
            <td>CSP nonces + Trusted Types</td>
            <td>
              Numbered wristbands handed out fresh every night. Last
              night&apos;s wristband won&apos;t get a script onto the dance
              floor today.
            </td>
          </tr>
          <tr>
            <td>cors (explicit allowlist)</td>
            <td>
              A guest list at the door. &quot;Let everyone in, VIP wristbands
              included&quot; is not a guest list at all, so the guard refuses to
              enforce that combination (no <code>*</code> origin with
              credentials).
            </td>
          </tr>
          <tr>
            <td>csrf, cross-site request forgery (double-submit cookie)</td>
            <td>
              A doorman slips a numbered token into your pocket on the way in
              (the cookie). To hand anything over the counter you must also say
              the number out loud (the header), and the two must match. Another
              website never walked past the doorman, so it can&apos;t know your
              number.
            </td>
          </tr>
          <tr>
            <td>csrf (Fetch-Metadata)</td>
            <td>
              The doorman just asks &quot;did you come in through my front
              door?&quot; The browser answers truthfully via{" "}
              <code>Sec-Fetch-Site</code>
              {": "}no ticket needed.
            </td>
          </tr>
          <tr>
            <td>rateLimit</td>
            <td>
              A bouncer&apos;s clicker. Same person tries to enter 1000 times in
              a minute? Sit out the next 60 seconds.
            </td>
          </tr>
          <tr>
            <td>rateLimit (Redis store)</td>
            <td>
              One shared clicker across every door of the club, so opening more
              doors doesn&apos;t let the same guest sneak in N times.
            </td>
          </tr>
          <tr>
            <td>loadShedding</td>
            <td>
              A power grid that browns out non-essential streetlights before the
              whole city blacks out.
            </td>
          </tr>
          <tr>
            <td>loginThrottle</td>
            <td>An ATM that swallows your card after three wrong PINs.</td>
          </tr>
          <tr>
            <td>ipRestriction (CIDR allow/deny)</td>
            <td>
              A gated community guard list of which addresses can drive in or
              out: only the ranges you wrote down (CIDR notation is just
              shorthand for a range of IP addresses).
            </td>
          </tr>
          <tr>
            <td>requestId</td>
            <td>
              A boarding pass number stapled to every step of your journey. When
              something breaks, every log can be cross-referenced by that one
              number.
            </td>
          </tr>
          <tr>
            <td>bearerAuth / basicAuth</td>
            <td>
              An ID badge swiped at the door. <code>timingSafeEqual</code> means
              the guard reads the whole badge before deciding, so even an
              attacker timing the response can&apos;t tell which digit was
              wrong.
            </td>
          </tr>
          <tr>
            <td>jwt / jwk</td>
            <td>
              A passport (JWT) issued by a known embassy (the identity
              provider). The border officer checks the issuing authority&apos;s
              signature against the embassy&apos;s published seals (JWKS), not
              against the passport itself.
            </td>
          </tr>
          <tr>
            <td>requireScopes</td>
            <td>
              Hotel keycards that only open certain floors. A maintenance card
              doesn&apos;t open guest rooms; a guest card doesn&apos;t open the
              rooftop.
            </td>
          </tr>
          <tr>
            <td>session (signed cookie + store)</td>
            <td>
              A coat-check ticket. The server keeps the coat; the cookie is the
              numbered, signed stub the browser hands back to claim it.
            </td>
          </tr>
          <tr>
            <td>rotateSession</td>
            <td>
              Re-issuing a new keycard the moment you log in or get promoted, so
              anyone holding the old one loses access on the spot.
            </td>
          </tr>
          <tr>
            <td>fetchGuard (SSRF, server-side request forgery)</td>
            <td>
              A corporate firewall, but for your server&apos;s own outgoing
              calls. SSRF is an attacker handing your code a URL and hoping it
              fetches your internal admin panel or the cloud metadata endpoint
              on their behalf; <code>fetchGuard()</code> refuses to dial inside
              the building.
            </td>
          </tr>
          <tr>
            <td>compression (BREACH-aware)</td>
            <td>
              Vacuum-sealing parcels for shipping, but never vacuum-sealing
              anything with a return address visible through the wrap, because a
              thief watching the truck could measure the bulge and figure out
              what&apos;s inside. (BREACH is the real attack that does exactly
              this: guessing secrets from compressed response sizes.)
            </td>
          </tr>
          <tr>
            <td>etag (private/no-store skip)</td>
            <td>
              A library returns-receipt that&apos;s only stamped for public
              books. Private records get no receipt, so two patrons can&apos;t
              accidentally compare receipts and learn about each other&apos;s
              files.
            </td>
          </tr>
          <tr>
            <td>Refuse-to-boot guards</td>
            <td>
              The engine check that won&apos;t let the car start if the parking
              brake is on or the seatbelts are unbuckled. Better to fail in the
              driveway than at the first intersection.
            </td>
          </tr>
          <tr>
            <td>Internal-service preset</td>
            <td>
              Taking off your raincoat indoors. CSRF and same-origin checks are
              raincoats for the public street; inside a private building (your
              service mesh) they&apos;re useless, but you still lock the safe.
            </td>
          </tr>
          <tr>
            <td>
              WebSocket CSWSH (cross-site WebSocket hijacking) refuse-to-boot
            </td>
            <td>
              A doorman who refuses to open the back fire-exit unless they can
              confirm who you are <em>and</em> which street you walked in from.
            </td>
          </tr>
          <tr>
            <td>Webhook HMAC verify</td>
            <td>
              A wax seal on a letter. Anyone can write a letter; only the real
              sender owns the signet ring (the shared secret key) that makes
              that exact pattern.
            </td>
          </tr>
          <tr>
            <td>fileField magicBytes</td>
            <td>
              Customs opening every &quot;tin of coffee&quot; to confirm it
              actually smells like coffee, not gunpowder. Filename extensions
              are stickers; magic bytes are the actual contents.
            </td>
          </tr>
          <tr>
            <td>Supply-chain hardening (pnpm, provenance, SBOM)</td>
            <td>
              Tamper-evident seals on every ingredient before it goes into the
              kitchen, a printed ingredient list for the finished dish (the
              SBOM), plus a paper trail (provenance) showing exactly which farm
              grew each ingredient.
            </td>
          </tr>
          <tr>
            <td>
              <code>minimum-release-age=1440</code>
            </td>
            <td>
              A 24-hour fridge quarantine on freshly delivered groceries, long
              enough that an obviously-poisoned batch gets recalled before
              it&apos;s served.
            </td>
          </tr>
          <tr>
            <td>
              <code>ignore-scripts=true</code>
            </td>
            <td>
              Refusing to run the &quot;please install this companion app&quot;
              pop-up that ships with the package. Just the food, not the side
              dish that calls home.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="what-the-core-enforces">What the core enforces</h2>
      <p>
        These checks happen in <code>App</code> or the runtime adapter itself.
        Applications get them without calling any middleware.
      </p>

      <FlowDiagram
        title="Every request runs the gauntlet"
        numbered
        steps={[
          {
            eyebrow: "ingress",
            label: "Incoming request",
            detail: "method, path, headers, body",
          },
          {
            eyebrow: "size cap",
            label: "Body-size limit",
            detail: "Content-Length over cap to 413",
            tone: "danger",
          },
          {
            eyebrow: "parse",
            label: "Hardened JSON parse",
            detail: "strips __proto__ / constructor",
          },
          {
            eyebrow: "route",
            label: "Router + method check",
            detail: ".. resolved to canonical path; bad method 405",
            tone: "danger",
          },
          {
            eyebrow: "handler",
            label: "Your typed handler",
            detail: "runs under requestTimeoutMs",
            tone: "success",
          },
        ]}
        caption="A request only reaches your handler after clearing the body cap, the prototype-pollution-safe parser, and the path/method guards. Anything that fails a guard is rejected by the core before your code runs."
      />

      <table>
        <thead>
          <tr>
            <th>Threat</th>
            <th>Built-in behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Body-size DoS</td>
            <td>
              Streamed read, hard cap (default 1 MiB), Content-Length checked
              first → 413.
            </td>
          </tr>
          <tr>
            <td>Prototype pollution</td>
            <td>
              <code>safeJsonParse</code> strips <code>__proto__</code>
              {", "}
              <code>constructor</code>
              {", "}<code>prototype</code> via reviver.
            </td>
          </tr>
          <tr>
            <td>Header / response splitting</td>
            <td>
              <code>sanitizeHeaderName</code> / <code>sanitizeHeaderValue</code>{" "}
              reject CRLF + NUL.
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
            <td>Slow-loris / hung handlers</td>
            <td>
              <code>requestTimeoutMs</code> (default 30s) returns{" "}
              <code>408</code> and fires <code>ctx.request.signal</code> for
              cooperative teardown; the Node adapter also sets socket timeouts.
            </td>
          </tr>
          <tr>
            <td>Unsupported content types</td>
            <td>
              Routes with body schemas reject non-allowed content-types → 415.
            </td>
          </tr>
          <tr>
            <td>Method confusion</td>
            <td>
              Real <strong>405</strong> with <code>Allow</code> header, never a
              misleading 404.
            </td>
          </tr>
          <tr>
            <td>Information disclosure (5xx)</td>
            <td>
              Production mode strips <code>detail</code> from 5xx problem+json
              automatically.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="first-party-security-middleware">
        First-party security middleware
      </h2>
      <p>
        These are part of DaloyJS and documented together, but they stay
        explicit because CSP, CORS, rate-limit keys, session secrets, and CSRF
        rollout are deployment decisions.
      </p>
      <CodeBlock
        code={`import {
  requestId,
  secureHeaders,
  cors,
  rateLimit,
  bearerAuth,
  timing,
} from "@daloyjs/core";

app.use(requestId());           // x-request-id propagation
app.use(secureHeaders());       // CSP, HSTS, X-Frame-Options, COOP, CORP, no-sniff …
app.use(cors({                  // explicit allowlist; never * with credentials
  origin: ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST"],
}));
app.use(rateLimit({             // global by default; add keyGenerator or trusted proxy headers for per-client limits
  windowMs: 60_000,
  max: 120,
}));
app.use(timing());              // Server-Timing header for observability`}
      />

      <p>
        Put <code>rateLimit()</code> or <code>loginThrottle()</code> before
        bearer/basic/JWK/mTLS auth when it must count failed credentials. The
        limiter will still spend the attempt and return <code>429</code> after
        the cap even though auth rejects in <code>preBody</code>; DaloyJS does
        not read a declared request body to do it. A custom key generator on
        that path should use raw request data or state populated by an earlier{" "}
        <code>preBody</code> hook.
      </p>

      <p>
        The official starters wire these in for you: Node, Bun, and Deno enable{" "}
        <code>secureHeaders()</code>
        {", "}<code>requestId()</code>
        {", "}and <code>rateLimit()</code>; Cloudflare Worker and Vercel enable{" "}
        <code>secureHeaders()</code> and <code>requestId()</code> plus tighter
        edge-friendly body and timeout limits.
      </p>

      <h2 id="recommended-by-deployment-target">
        Recommended by deployment target
      </h2>
      <p>
        Start with the middleware below unless you have a concrete reason not
        to. The point is not to hide policy behind a boolean flag; it is to make
        the risky choices explicit and consistent.
      </p>
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Recommended baseline</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node / Bun / Deno API</td>
            <td>
              <code>requestId()</code>
              {", "}<code>secureHeaders()</code>
              {", "}
              <code>rateLimit()</code>
              {", "}and <code>cors()</code> when the API is cross-origin.
            </td>
          </tr>
          <tr>
            <td>Cloudflare Workers</td>
            <td>
              <code>requestId()</code> and <code>secureHeaders()</code> by
              default; use <code>cors()</code> only when needed, and prefer an
              external/shared limiter over the in-memory default when traffic
              spans many isolates.
            </td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>
              <code>requestId()</code> and <code>secureHeaders()</code> by
              default; add <code>cors()</code> only when needed, and use a
              shared limiter if you need durable counters across regions.
            </td>
          </tr>
          <tr>
            <td>Cookie-authenticated app</td>
            <td>
              Add <code>session()</code> plus <code>csrf()</code> on top of the
              baseline so mutating routes are protected against cross-site form
              and fetch attacks.
            </td>
          </tr>
          <tr>
            <td>Behind a trusted reverse proxy</td>
            <td>
              Keep the baseline, then configure <code>rateLimit()</code> with an
              explicit <code>keyGenerator</code> or set{" "}
              <code>trustProxyHeaders: true</code> only after the proxy strips
              and rewrites forwarding headers.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="csrf-for-state-changing-routes">
        <code>csrf()</code> for state-changing routes
      </h2>
      <p>
        Use{" "}
        <a href="/docs/security/csrf">
          <code>csrf()</code>
        </a>{" "}
        to protect mutating endpoints. Two strategies are supported:
      </p>
      <ul>
        <li>
          <strong>Double-submit cookie</strong> (default): sets a token cookie
          on safe requests, requires the same value on the{" "}
          <code>x-csrf-token</code> header for unsafe methods, and rejects
          mismatches with a timing-safe <strong>403</strong>.
        </li>
        <li>
          <strong>Fetch Metadata</strong> (
          <code>strategy: &quot;fetch-metadata&quot;</code>) - tokenless
          protection that relies on the modern <code>Sec-Fetch-Site</code>{" "}
          header. No cookie round-trip; no HTML rendering coupling. Recommended
          for new browser-facing apps.
        </li>
      </ul>
      <CodeBlock
        code={`import { csrf } from "@daloyjs/core";

// Classic double-submit cookie (default).
app.use(csrf());

// Tokenless Fetch-Metadata protection (recommended for browser-facing apps).
app.use(csrf({
  strategy: "fetch-metadata",
  allowedOrigins: ["https://app.example.com"],
}));`}
      />

      <h2 id="secureheaders-defaults">
        <code>secureHeaders()</code> defaults
      </h2>
      <CodeBlock
        language="text"
        code={`content-security-policy: default-src 'self'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
permissions-policy: camera=(), microphone=(), geolocation=(), clipboard-write=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin`}
      />

      <p>
        If you need a different CSP, want to disable HSTS in local development,
        or need a looser permissions policy, pass options to{" "}
        <code>secureHeaders()</code> explicitly. The legacy{" "}
        <code>X-XSS-Protection: 0</code> header is opt-in via{" "}
        <code>xssProtection: true</code> for deployments that want to explicitly
        disable old browser XSS filters.
      </p>

      <h3 id="csp-with-per-request-nonces-and-trusted-types">
        CSP with per-request nonces &amp; Trusted Types
      </h3>
      <p>
        <code>secureHeaders()</code> can build the CSP from a directive map and
        inject a fresh <strong>per-request nonce</strong> into{" "}
        <code>script-src</code>
        {", "}<code>script-src-elem</code>
        {", "}
        <code>style-src</code>
        {", "}and <code>style-src-elem</code>
        {", "}plus emit{" "}
        <code>require-trusted-types-for &apos;script&apos;</code> for runtime
        DOM XSS hardening. The nonce is exposed at{" "}
        <code>ctx.state.cspNonce</code> so handlers can render it into{" "}
        <code>&lt;script nonce=&quot;...&quot;&gt;</code> tags.
      </p>
      <CodeBlock
        code={`import { secureHeaders } from "@daloyjs/core";

app.use(secureHeaders({
  contentSecurityPolicy: {
    directives: {
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self'",
      "img-src": ["'self'", "data:"],
    },
    nonce: true,
    trustedTypes: { policies: ["default"] },
  },
}));

app.get(
  "/page",
  {
    operationId: "page",
    responses: { 200: { description: "ok" } },
  },
  // Return the HTML yourself so the secureHeaders nonce CSP is the one that ships.
  async ({ state }) => ({
    status: 200,
    body: \`<!doctype html>
<script nonce="\${state.cspNonce}">
  // inline bootstrap is allowed only via this fresh nonce
</script>\`,
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
);`}
      />
      <p>
        Do <strong>not</strong> render this page with{" "}
        <code>htmlResponse()</code> from <code>@daloyjs/core/docs</code>
        {": "}that helper ships its own Content-Security-Policy (tuned for the
        Swagger / Scalar docs UIs, with <code>&apos;unsafe-inline&apos;</code>)
        and would override the strict nonce CSP above, so the nonce would no
        longer be the thing gating inline scripts. Keep{" "}
        <code>htmlResponse()</code> for your API-docs route, and return your own{" "}
        <code>Response</code> body for nonce-protected pages.
      </p>

      <h2 id="auth">Auth</h2>
      <CodeBlock
        code={`import { bearerAuth, basicAuth, timingSafeEqual } from "@daloyjs/core";

// Bearer (opaque tokens, JWT verified via your own \`validate\`).
app.post(
  "/admin/purge",
  {
    operationId: "adminPurge",
    hooks: bearerAuth({
      validate: (token) => timingSafeEqual(token, process.env.ADMIN_TOKEN!),
      realm: "admin",
    }),
    responses: { 204: { description: "ok" }, 401: { description: "denied" } },
  },
  async () => ({ status: 204 as const, body: undefined }),
);

// Basic auth (RFC 7617).
app.use(basicAuth({
  realm: "books-api",
  verify: (user, pass) =>
    timingSafeEqual(user, "admin") &&
    timingSafeEqual(pass, process.env.ADMIN_PASSWORD ?? ""),
}));`}
      />

      <h2 id="sql-injection">SQL injection</h2>
      <p>
        Daloy doesn&apos;t ship a database driver, but the HTTP boundary it{" "}
        <em>does</em> own (strict Zod schemas, hardened JSON parser, body-size
        caps) shrinks the surface that reaches your repository layer. See{" "}
        <a href="/docs/security/sql-injection">SQL injection</a> for the safe
        vs. unsafe patterns per ORM (Prisma, Drizzle, Kysely, raw drivers), an
        allowlisting recipe for dynamic <code>ORDER BY</code>
        {", "}and the grep rules the maintainers use to catch regressions.
      </p>

      <h2 id="command-injection">Command injection</h2>
      <p>
        DaloyJS&apos;s runtime is <code>child_process</code>-free by CI gate, so
        the framework itself cannot shell out. See{" "}
        <a href="/docs/security/command-injection">Command injection</a> for the
        safe shape of a handler that does need to invoke an external program (
        <code>execFile</code> + argv array, never{" "}
        <code>exec(`cmd ${"${input}"}`)</code>), the Windows <em>BatBadBut</em>{" "}
        footgun, and the grep rules to keep new bugs out at PR time.
      </p>

      <h2 id="admin-panels">Admin panels</h2>
      <p>
        Building an admin or customer-success surface on top of DaloyJS? See{" "}
        <a href="/docs/security/admin-panels">Secure admin panels</a> for the
        recommended pattern: <code>internal: true</code> routes,{" "}
        <code>ipRestriction()</code>
        {", "}strict CSP with per-request nonces, per-admin authentication,
        login-throttle <code>rateLimit()</code> groups, and structured audit
        logging, mapped one-to-one to Aikido&apos;s public &quot;secure admin
        panel&quot; checklist.
      </p>

      <h2 id="supply-chain">Supply-chain</h2>
      <p>
        DaloyJS is distributed via{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
          pnpm
        </a>{" "}
        for a stricter install model. Scaffolded pnpm apps inherit the
        install-time controls, while DaloyJS&apos;s own repository and the
        optional GitHub Actions bundle add CI/CD controls against the
        cache-poisoning, maintainer-phishing, and OIDC token-abuse patterns seen
        in recent npm incidents.
      </p>
      <ul>
        <li>
          <strong>Strict isolation</strong>
          {": "}packages cannot reach phantom dependencies.
        </li>
        <li>
          <strong>Content-addressable store</strong>
          {": "}every byte is hashed and verified.
        </li>
        <li>
          <strong>Frozen lockfile in CI</strong> with{" "}
          <code>--ignore-scripts</code>
          {": "}reproducible installs without transitive lifecycle execution.
        </li>
        <li>
          <strong>
            <code>verify-store-integrity</code>
          </strong>
          {", "}corruption-detecting reads.
        </li>
        <li>
          <strong>
            <code>strict-peer-dependencies</code>
          </strong>
          {", "}no silent peer mismatches.
        </li>
        <li>
          <strong>
            <code>minimum-release-age=1440</code>
          </strong>
          {", "}wait 24h before installing fresh releases.
        </li>
        <li>
          <strong>
            <code>ignore-scripts=true</code>
          </strong>{" "}
          with explicit <code>pnpm.onlyBuiltDependencies</code>
          {": "}reviewed allowlist for native install scripts.
        </li>
        <li>
          <strong>SHA-pinned GitHub Actions</strong>
          {": "}the optional generated GitHub workflows pin third-party actions
          to immutable commits, not mutable tags.
        </li>
        <li>
          <strong>Protected DaloyJS npm publishing</strong>
          {": "}the framework&apos;s own packages use a tag-only release
          workflow, protected environment approval, OIDC trusted publishing, and{" "}
          <code>--provenance</code>.
        </li>
      </ul>
      <p>
        If your generated app lives outside GitHub, carry over the portable
        parts directly and translate the GitHub workflow rules to your CI host.
        The framework cannot enforce branch protection or runner egress in a
        private GitLab, Bitbucket, Azure DevOps, or on-prem installation.
      </p>

      <h2 id="trusted-proxies-and-rate-limiting">
        Trusted proxies and rate limiting
      </h2>
      <p>
        DaloyJS no longer trusts <code>X-Forwarded-For</code> or{" "}
        <code>X-Real-IP</code> by default when deriving a rate-limit key. Those
        headers are client-spoofable unless your reverse proxy strips and
        rewrites them. The default limiter is therefore global until you provide
        an explicit <code>keyGenerator</code> or opt in to{" "}
        <code>trustProxyHeaders: true</code> behind a trusted proxy.
      </p>
      <p>
        For credential-entry routes, use{" "}
        <a href="/docs/security/websocket-login-throttle">
          <code>loginThrottle()</code>
        </a>{" "}
        across <code>/login</code>
        {", "}OTP, and password-reset routes, and <code>wsRateLimit()</code> on
        related WebSocket upgrades. Both helpers can spend from the same{" "}
        <code>groupId</code> bucket.
      </p>

      <h2 id="self-hosted-docs-assets">Self-hosted docs assets</h2>
      <p>
        The built-in docs helpers no longer force a jsDelivr-shaped CSP. You can
        self-host the Swagger UI or Scalar assets, add a nonce to the bootstrap
        script, and emit a same-origin CSP for your docs route.
      </p>
      <CodeBlock
        code={`import {
  swaggerUiHtml,
  htmlResponse,
} from "@daloyjs/core/docs";

const nonce = crypto.randomUUID();
const html = swaggerUiHtml({
  specUrl: "/openapi.json",
  scriptNonce: nonce,
  assets: {
    swaggerUiCssUrl: "/docs-assets/swagger-ui.css",
    swaggerUiBundleUrl: "/docs-assets/swagger-ui.js",
  },
});

return htmlResponse(html, {
  assetOrigins: [],
  scriptNonce: nonce,
  allowInlineStyles: false,
});`}
      />

      <CodeBlock
        language="ini"
        code={`# .npmrc
ignore-scripts=true
minimum-release-age=1440
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
provenance=true`}
      />

      <p>
        For the full CI/CD and maintainer playbook, read{" "}
        <a href="/docs/security/supply-chain">Supply-chain security</a>
        {". "}Run <code>pnpm audit --prod</code> in CI and before release.
      </p>

      <h2 id="owasp-api-security-top-10-mapping">
        OWASP API Security Top 10 mapping
      </h2>
      <p>
        For a per-item walkthrough of how Daloy addresses every entry in the{" "}
        <a
          href="https://owasp.org/API-Security/editions/2023/en/0x11-t10/"
          target="_blank"
          rel="noreferrer"
        >
          OWASP API Security Top 10 (2023)
        </a>{" "}
        plus the cross-cutting best practices (encryption, validation, rate
        limiting, logging, inventory, third-party API safety), read{" "}
        <a href="/docs/security/owasp-api-top-10">OWASP API Top 10 mapping</a>.
      </p>

      <h2 id="reporting-a-vulnerability">Reporting a vulnerability</h2>
      <p>
        Use GitHub&apos;s private vulnerability reporting at{" "}
        <a
          href="https://github.com/daloyjs/daloy/security/advisories/new"
          target="_blank"
          rel="noreferrer"
        >
          github.com/daloyjs/daloy/security/advisories/new
        </a>{" "}
        with reproduction steps. Do not open a public issue with exploit
        details.
      </p>
    </>
  );
}
