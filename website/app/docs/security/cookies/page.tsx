import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Cookie helpers",
  description:
    "Read and write cookies the same way every DaloyJS subsystem does: serializeCookie(), readRequestCookie(), serializeClearCookie(), and assertCookieAttributes() enforce RFC 6265bis prefixes, secure-by-default attributes, and cookie-tossing defenses.",
  path: "/docs/security/cookies",
  keywords: [
    "DaloyJS cookies",
    "serializeCookie",
    "readRequestCookie",
    "Set-Cookie",
    "__Host- cookie prefix",
    "secure cookie defaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Cookie helpers</h1>
      <blockquote>
        <strong>Think of it like…</strong> a tamper-evident envelope service.
        Every department that mails something out uses the same envelopes with
        the same seals, so nobody invents their own flimsy version, and the
        mail room refuses to accept two identical envelopes claiming to be the
        same letter.
      </blockquote>
      <p>
        DaloyJS exposes the same low-level cookie helpers that{" "}
        <code>session()</code> and <code>csrf()</code> use internally. Routing
        every <code>Set-Cookie</code> write through one tiny, dependency-free
        implementation means there is exactly one place that knows the RFC
        6265bis attribute rules, the <code>__Host-</code> /{" "}
        <code>__Secure-</code> prefix rules, and the secure-by-default posture.
        Reach for these when you need a custom cookie outside the built-in
        session and CSRF flows.
      </p>

      <h2 id="secure-by-default">Secure by default</h2>
      <p>
        When you omit attributes, the helpers choose the safest interpretation:
      </p>
      <ul>
        <li>
          <code>secure: true</code>
        </li>
        <li>
          <code>httpOnly: true</code>
        </li>
        <li>
          <code>sameSite: &quot;Strict&quot;</code>
        </li>
        <li>
          <code>path: &quot;/&quot;</code>
        </li>
      </ul>

      <h2 id="writing-a-cookie">Writing a cookie</h2>
      <p>
        <code>serializeCookie(name, value, attributes?)</code> returns a single{" "}
        <code>Set-Cookie</code> header value. The value is URI-encoded so binary
        signature bytes and base64 padding round-trip safely. Set it on your
        response headers.
      </p>
      <CodeBlock
        code={`import { App, serializeCookie } from "@daloyjs/core";

const app = new App();

app.post(
  "/prefs",
  {
    operationId: "savePrefs",
    responses: { 204: { description: "saved" } },
  },
  async () => ({
    status: 204 as const,
    body: undefined,
    headers: {
      "set-cookie": serializeCookie("__Host-theme", "dark", {
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    },
  }),
);`}
      />
      <p>
        The <code>__Host-</code> prefix is the strongest anti-cookie-tossing
        choice: the browser only accepts it when it is <code>Secure</code>, has{" "}
        <code>Path=/</code>, and carries no <code>Domain</code>. The helper
        enforces exactly those constraints, so a misconfiguration throws instead
        of silently shipping a cookie the browser drops.
      </p>

      <h2 id="reading-a-cookie">Reading a cookie</h2>
      <p>
        <code>readRequestCookie(header, name)</code> parses a single cookie out
        of the request <code>Cookie</code> header, returning <code>null</code>{" "}
        when it is absent. It also includes a{" "}
        <strong>cookie-tossing defense</strong>: if the same name appears more
        than once, it returns <code>null</code> rather than guessing which copy
        is authentic, forcing a re-authentication instead of letting an
        attacker-injected shadow cookie win.
      </p>
      <FlowDiagram
        title="Cookie-tossing defense on read"
        steps={[
          {
            eyebrow: "ingress",
            label: "Cookie header",
            detail: "readRequestCookie(header, name)",
          },
          {
            eyebrow: "count",
            label: "How many copies of name?",
            detail: "scan the parsed header",
          },
          {
            eyebrow: "exactly one",
            label: "Return the value",
            detail: "authentic cookie to handler",
            tone: "success",
          },
          {
            eyebrow: "two or more",
            label: "Return null",
            detail: "ambiguous to force re-auth",
            tone: "danger",
          },
        ]}
        caption="When a name appears more than once the helper refuses to guess which copy is authentic and returns null, so an attacker-injected shadow cookie cannot win by ambiguity. Exactly one match returns the value."
      />
      <CodeBlock
        language="ts"
        code={`import { readRequestCookie } from "@daloyjs/core";

app.get(
  "/prefs",
  {
    responses: { 200: { description: "ok" } },
  },
  async ({ request }) => {
    const theme = readRequestCookie(request.headers.get("cookie"), "__Host-theme");
    return { status: 200 as const, body: { theme: theme ?? "light" } };
  },
);`}
      />

      <h2 id="clearing-a-cookie">Clearing a cookie</h2>
      <p>
        <code>serializeClearCookie(name, attributes?)</code> emits a{" "}
        <code>Set-Cookie</code> value with <code>Max-Age=0</code>, preserving
        the original attributes so intermediaries match the cookie they are
        meant to delete.
      </p>
      <CodeBlock
        language="ts"
        code={`import { serializeClearCookie } from "@daloyjs/core";

return {
  status: 204 as const,
  body: undefined,
  headers: { "set-cookie": serializeClearCookie("__Host-theme") },
};`}
      />

      <h2 id="validating-attributes-up-front">Validating attributes up front</h2>
      <p>
        <code>assertCookieAttributes()</code> throws on the first RFC 6265bis or
        secure-default violation. <code>serializeCookie()</code> and{" "}
        <code>serializeClearCookie()</code> call it for you, but you can invoke
        it directly to validate a configuration at construction time, failing
        the boot rather than shipping a cookie the browser would silently drop.
      </p>
      <CodeBlock
        language="ts"
        code={`import { assertCookieAttributes } from "@daloyjs/core";

assertCookieAttributes({
  scope: "my-feature",
  name: "__Secure-flags",
  attributes: { secure: true, sameSite: "Lax" },
  isProduction: process.env.NODE_ENV === "production",
});`}
      />
      <p>
        Common refusals: <code>sameSite: &quot;None&quot;</code> without{" "}
        <code>secure: true</code>; a <code>__Host-</code> cookie with a{" "}
        <code>Domain</code> or a non-root <code>path</code>; and (in production)
        a <code>__Secure-</code> cookie without <code>secure: true</code>.
      </p>
      <p>
        For client-readable tokens such as a CSRF mirror, set{" "}
        <code>httpOnly: false</code> explicitly. Everything else stays locked
        down.
      </p>

      <h2 id="when-to-use-the-built-ins-instead">When to use the built-ins instead</h2>
      <p>
        For authenticated sessions reach for <code>session()</code>, and for
        CSRF protection reach for <code>csrf()</code>. They already route
        through these helpers with hardened defaults. Use the raw helpers for
        everything else: preferences, feature flags, consent banners, and other
        small bits of per-client state.
      </p>
    </>
  );
}
