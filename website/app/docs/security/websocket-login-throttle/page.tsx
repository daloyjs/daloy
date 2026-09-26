import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";
import { AuthRole } from "@/components/auth-role";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "WebSocket and login safeguards",
  description:
    "Protect WebSocket upgrades and login flows with rate limiting, login throttling, session rotation, upload guards, payload authentication, and safe runtime defaults.",
  path: "/docs/security/websocket-login-throttle",
  keywords: [
    "wsRateLimit",
    "loginThrottle",
    "rotateSession",
    "fileField magicBytes",
    "requirePayloadAuth",
    "WebSocket safe defaults",
    "maxPayloadLength",
    "perMessageDeflate",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>WebSocket and login safeguards</h1>
      <blockquote>
        Use <code>wsRateLimit()</code> on upgrades, <code>loginThrottle()</code>{" "}
        on failed authentication, and <code>rotateSession()</code> after login
        or a privilege change.
      </blockquote>
      <p>
        These focused safeguards cover authentication entry points, upload
        boundaries, and WebSocket upgrades with first-party helpers instead of
        copy-pasted local policy.
      </p>

      <AuthRole role="client-rp">
        <p>
          <code>loginThrottle()</code> guards an authentication endpoint that
          you expose. That is a normal thing to have in front of a
          backend-for-frontend that proxies to your provider, or on a
          machine-to-machine credential exchange. If it is guarding a password
          check you wrote yourself, throttling is not the thing to fix first.
        </p>
      </AuthRole>

      <h2 id="1-wsratelimit">
        1. <code>wsRateLimit()</code>
      </h2>
      <p>
        <code>wsRateLimit()</code> adapts the existing <code>rateLimit()</code>{" "}
        shared-bucket primitive to the WebSocket upgrade boundary. Put the same{" "}
        <code>groupId</code> on HTTP login routes and the WebSocket session
        route so an attacker cannot dodge the bucket by switching transports.
      </p>
      <SequenceDiagram
        title="One bucket, two transports"
        participants={[
          "Attacker",
          "loginThrottle()",
          "wsRateLimit()",
          "Shared bucket",
        ]}
        steps={[
          {
            from: "Attacker",
            to: "loginThrottle()",
            label: "Brute-force POST /login attempts",
            detail: "each attempt spends from groupId: auth-entry",
            kind: "request",
          },
          {
            from: "loginThrottle()",
            to: "Shared bucket",
            label: "Increment the same keyed counter",
            detail: "windowMs / max enforced",
            kind: "async",
          },
          {
            from: "Attacker",
            to: "wsRateLimit()",
            label: "Switch transports: WebSocket upgrade",
            detail: "beforeUpgrade on /session",
            kind: "request",
          },
          {
            from: "wsRateLimit()",
            to: "Shared bucket",
            label: "Spends from the SAME groupId bucket",
            detail: "no fresh budget for switching transport",
            kind: "async",
          },
          {
            from: "Shared bucket",
            to: "Attacker",
            label: "Limit exhausted, both paths reject",
            detail: "HTTP 429 / upgrade refused",
            kind: "note",
          },
        ]}
        caption="Putting the same groupId on the login route and the WebSocket upgrade makes both helpers spend from one shared counter. An attacker who exhausts the HTTP budget cannot get a fresh allowance by switching to the WebSocket transport."
      />
      <CodeBlock
        code={`import { App, loginThrottle, wsRateLimit } from "@daloyjs/core";

const app = new App({ env: "production" });

// No keyGenerator: both helpers use the default key, which is the
// trusted forwarded client IP (or the TCP peer when the request did not
// come through a listed proxy). Never key on a raw client header.
const authBucket = {
  windowMs: 60_000,
  max: 10,
  groupId: "auth-entry",
  trustedProxies: ["10.0.0.0/8"], // your load balancer's range
};

app.post(
  "/login",
  {
    hooks: loginThrottle(authBucket),
    responses: { 200: { description: "ok" } },
  },
  async () => ({ status: 200 as const, body: { ok: true } }),
);

app.ws("/session", {
  beforeUpgrade: wsRateLimit(authBucket),
  open(conn) {
    conn.send("ready");
  },
});`}
        language="ts"
      />
      <p>
        Both helpers must derive the <strong>same key</strong> for the shared
        counter to work. With proxy trust configured, as above, the default key
        is identical on both paths. Without proxy trust, <code>rateLimit()</code>{" "}
        (and so <code>wsRateLimit()</code>) keys every caller into one shared
        bucket while <code>loginThrottle()</code> keys per TCP peer, so the two
        would not line up. If you need a custom key, derive it from something
        the server controls, such as{" "}
        <code>getConnInfo(ctx.request)?.remoteAddress</code> or an
        authenticated identity.
      </p>
      <p>
        <strong>Never key a limiter on a raw client-supplied header</strong>{" "}
        (<code>x-user-key</code>, <code>x-client-id</code>, an untrusted{" "}
        <code>X-Forwarded-For</code>). The client picks the value, so an
        attacker sends a fresh one on every attempt and gets a fresh budget
        each time.
      </p>

      <h2 id="2-loginthrottle">
        2. <code>loginThrottle()</code>
      </h2>
      <p>
        <code>loginThrottle()</code> is the built-in preset for credential-entry
        routes. It combines a shared hard limit with a short progressive delay
        before the hard <code>429</code> response. By default it does not trust
        proxy IP headers and keys each caller on its TCP peer address, so one
        client cannot exhaust the budget for every other user. It falls back to
        a single shared bucket only on runtimes that expose no peer address.
        Pass a <code>keyGenerator</code> or opt in to{" "}
        <code>trustProxyHeaders: true</code> / <code>trustedProxies</code> only
        behind a trusted proxy. When proxy headers are trusted, the key is the{" "}
        <strong>rightmost</strong> <code>X-Forwarded-For</code> entry (the one
        your proxy appended), so rotating spoofed left entries cannot reset the
        budget. Multi-hop chains declare their length with{" "}
        <code>trustedHops</code>. Prefer <code>trustedProxies</code> when the
        origin can be reached without the proxy (see{" "}
        <a href="/docs/auto-ban#verify-the-peer-trustedproxies">
          the autoBan note
        </a>
        ).
      </p>
      <p>
        IPv6 clients are grouped by prefix (since 1.3.7). The{" "}
        <code>ipv6Subnet</code> option (default <code>64</code>) masks IPv6
        addresses to a /64, the block one subscriber normally holds, so an
        attacker cannot mint a fresh bucket per address. Different spellings of
        one address (<code>::1</code> and <code>0:0::1</code>
        {", "}or <code>1.2.3.4</code> and <code>::ffff:1.2.3.4</code>) collapse
        to one key. The option is ignored when you pass a{" "}
        <code>keyGenerator</code>
        {"."}
      </p>
      <p>
        Register <code>loginThrottle()</code> before your authentication hook.
        It then counts every rejected attempt, including guards that{" "}
        <em>throw</em> (for example a failed <code>bearerAuth()</code> check)
        rather than return a <code>Response</code>
        {". "}Once the budget is exhausted the <code>429</code> replaces the
        auth error.
      </p>
      <CodeBlock
        code={`app.post(
  "/password-reset",
  {
    hooks: loginThrottle({
      windowMs: 15 * 60_000,
      max: 5,
      groupId: "auth-entry",
      delayAfter: 2,
      delayMs: 250,
      maxDelayMs: 2_000,
      ipv6Subnet: 56, // group IPv6 clients per /56 instead of /64
    }),
    responses: { 204: { description: "accepted" } },
  },
  async () => ({ status: 204 as const }),
);`}
        language="ts"
      />

      <h2 id="3-rotatesession">
        3. <code>rotateSession()</code>
      </h2>
      <p>
        <code>rotateSession()</code> watches session privilege fields and calls{" "}
        <code>session.regenerate()</code> after the handler when those fields
        change. It skips itself when the handler already regenerated the
        session, so explicit login flows keep their exact behavior.
      </p>
      <CodeBlock
        code={`import { session, rotateSession } from "@daloyjs/core";

app.use(session({ secret: process.env.SESSION_SECRET! }));
app.use(rotateSession({ watch: ["userId", "roles", "tenantId"] }));

app.post(
  "/admin/promote",
  {
    responses: { 200: { description: "ok" } },
  },
  async ({ state }) => {
    state.session.set("roles", ["admin"]);
    return { status: 200 as const, body: { ok: true } };
  },
);`}
        language="ts"
      />

      <h2 id="4-upload-mime-and-magic-byte-guards">
        4. Upload MIME and magic-byte guards
      </h2>
      <p>
        <code>fileField()</code> already enforced <code>maxBytes</code> and MIME
        allowlists. Add <code>magicBytes: true</code> to derive known signatures
        from <code>accept</code>
        {", "}or pass custom signatures for private formats. The OpenAPI
        generator emits <code>x-magic-bytes</code> alongside{" "}
        <code>x-accept</code> and <code>x-max-bytes</code>.
      </p>
      <CodeBlock
        code={`fileField({
  maxBytes: 1_000_000,
  accept: ["image/png", "image/jpeg"],
  magicBytes: true,
});

fileField({
  accept: ["application/x-daloy"],
  magicBytes: [
    { mime: "application/x-daloy", bytes: [0x44, 0x4c, 0x59] },
  ],
});`}
        language="ts"
      />

      <h2 id="5-requirepayloadauth">
        5. <code>requirePayloadAuth</code>
      </h2>
      <p>
        OpenAPI security scheme builders accept{" "}
        <code>requirePayloadAuth: true</code> for schemes such as webhook
        signatures that must authenticate the request body. A route using that
        scheme cannot set <code>auth.payload: false</code>. Daloy throws at
        route registration. The public OpenAPI document uses{" "}
        <code>x-daloy-require-payload-auth</code> rather than leaking a non-spec
        field.
      </p>
      <CodeBlock
        code={`const app = new App({
  openapi: {
    securitySchemes: {
      webhook: httpBearerScheme({ requirePayloadAuth: true }),
    },
  },
});

app.post(
  "/webhooks/provider",
  {
    auth: { scheme: "webhook" },
    responses: { 204: { description: "accepted" } },
  },
  async () => ({ status: 204 as const }),
);`}
        language="ts"
      />

      <h2 id="6-websocket-safe-defaults">6. WebSocket safe defaults</h2>
      <p>
        <code>app.ws()</code> now normalizes safe runtime defaults for Node and
        Bun: close on excessive outbound backpressure, a 1 MiB backpressure
        limit, compression off by default, a non-zero idle timeout, and a 1 MiB
        inbound payload cap. In production under <code>secureDefaults</code>
        {", "}
        <code>perMessageDeflate: true</code> is refused. Daloy also refuses a{" "}
        <code>maxPayloadLength</code> larger than a route body schema&apos;s
        declared maximum when the schema exposes one.
      </p>
      <CodeBlock
        code={`app.ws("/events", {
  idleTimeout: 120,
  maxPayloadLength: 64 * 1024,
  closeOnBackpressureLimit: true,
  backpressureLimit: 1 * 1024 * 1024,
  perMessageDeflate: false,
  message(conn, data) {
    conn.send(data);
  },
});`}
        language="ts"
      />
    </>
  );
}
