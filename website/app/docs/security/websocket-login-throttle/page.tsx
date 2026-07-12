import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "WebSocket + login throttle slice",
  description:
    "Daloy ships the remaining leftover items: WebSocket upgrade rate limiting, login throttling, automatic session rotation, upload magic-byte guards, payload-auth-required security schemes, and WebSocket safe defaults.",
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
      <h1>WebSocket + login throttle slice</h1>
      <blockquote>
        <strong>Think of it like…</strong> a doorman with three jobs at once. He
        limits how often anyone can knock on the door (
        <code>wsRateLimit()</code> on the upgrade), how many wrong passwords you
        can try before he stops listening (<code>loginThrottle()</code>), and he
        swaps out your wristband the moment you upgrade to VIP (
        <code>rotateSession()</code>) so anyone who copied the old wristband
        gets nothing.
      </blockquote>
      <p>
        Daloy closes the remaining expanded leftover items. The theme is narrow
        but practical: authentication entry points, upload boundaries, and
        WebSocket upgrades now have first-party helpers instead of copy-pasted
        local policy.
      </p>

      <h2 id="1-wsratelimit">
        1. <code>wsRateLimit()</code>
      </h2>
      <p>
        <code>wsRateLimit()</code> adapts the existing <code>rateLimit()</code>{" "}
        shared-bucket primitive to the WebSocket upgrade boundary. Put the same
        <code>groupId</code> on HTTP login routes and the WebSocket session
        route so an attacker cannot dodge the bucket by switching transports.
      </p>
      <SequenceDiagram
        title="One bucket, two transports"
        participants={["Attacker", "loginThrottle()", "wsRateLimit()", "Shared bucket"]}
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

const authBucket = {
  windowMs: 60_000,
  max: 10,
  groupId: "auth-entry",
  keyGenerator: (ctx) => ctx.request.headers.get("x-user-key") ?? "global",
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

      <h2 id="2-loginthrottle">
        2. <code>loginThrottle()</code>
      </h2>
      <p>
        <code>loginThrottle()</code> is the built-in preset for credential-entry
        routes. It combines a shared hard limit with a short progressive delay
        before the hard <code>429</code> response. By default it does not trust
        proxy IP headers; pass a <code>keyGenerator</code> or opt in to{" "}
        <code>trustProxyHeaders: true</code> only behind a trusted proxy.
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

      <h2 id="4-upload-mime-and-magic-byte-guards">4. Upload MIME and magic-byte guards</h2>
      <p>
        <code>fileField()</code> already enforced <code>maxBytes</code> and MIME
        allowlists. Add <code>magicBytes: true</code> to derive known signatures
        from <code>accept</code>, or pass custom signatures for private formats.
        The OpenAPI generator emits <code>x-magic-bytes</code> alongside
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
        scheme cannot set <code>auth.payload: false</code>; Daloy throws at
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
        inbound payload cap. In production under <code>secureDefaults</code>,
        <code>perMessageDeflate: true</code> is refused. Daloy also refuses a
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
