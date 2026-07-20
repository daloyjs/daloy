import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "CSRF protection",
  description:
    "Use the built-in csrf() middleware to protect mutating routes with double-submit-cookie or Fetch Metadata CSRF strategies.",
  path: "/docs/security/csrf",
  keywords: [
    "DaloyJS CSRF",
    "double-submit cookie",
    "CSRF protection",
    "TypeScript CSRF middleware",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>CSRF protection</h1>
      <blockquote>
        <strong>Think of it like…</strong> a coat-check counter. When you walk
        in, the doorman quietly slips a numbered token into your pocket (the
        cookie). When you later try to claim something at the counter, you have
        to show that same number written on a slip (the header). A stranger who
        never walked past the doorman can&apos;t guess the number, so they
        can&apos;t use your name to grab a coat that isn&apos;t theirs, even if
        they know which counter to walk up to.
      </blockquote>
      <p>
        DaloyJS ships a small, framework-agnostic <code>csrf()</code> middleware
        that implements the <strong>double-submit cookie</strong> pattern. The
        server stamps a random token in a cookie on safe requests; the client
        mirrors that token in a request header on mutating requests. The
        middleware then compares the cookie and header in constant time and
        rejects mismatches with <strong>403 Forbidden</strong>.
      </p>
      <p>
        The token cookie is intentionally readable by client-side JavaScript so
        a browser client can echo it into the header. Treat XSS prevention as a
        separate requirement: if an attacker can run script in your origin, they
        can read the CSRF token too.
      </p>

      <SequenceDiagram
        title="Double-submit cookie"
        participants={["Browser", "Attacker page", "csrf()", "Handler"]}
        steps={[
          {
            from: "Browser",
            to: "csrf()",
            label: "Safe request (GET) stamps a token cookie",
            detail: "Set-Cookie: __Host-daloy.csrf=<random>",
            kind: "request",
          },
          {
            from: "csrf()",
            to: "Browser",
            label: "Token also exposed via ctx.state.csrfToken",
            detail: "client echoes it on the next mutating call",
            kind: "response",
          },
          {
            from: "Browser",
            to: "csrf()",
            label: "POST /transfer with header mirroring the cookie",
            detail: "x-csrf-token === __Host-daloy.csrf",
            kind: "request",
          },
          {
            from: "csrf()",
            to: "Handler",
            label: "Constant-time compare matches, request proceeds",
            detail: "timingSafeEqual(cookie, header)",
            kind: "response",
          },
          {
            from: "Attacker page",
            to: "csrf()",
            label: "Cross-site POST cannot read or set the header",
            detail: "missing / mismatched token to 403 Forbidden",
            kind: "note",
          },
        ]}
        caption="A forged cross-site request rides the cookie automatically but cannot read it to populate the x-csrf-token header, so the constant-time compare fails and the middleware returns 403. Only a same-origin client that read the token can match it."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        code={`import { App, csrf } from "@daloyjs/core";

const app = new App();

app.use(csrf());

app.get(
  "/me",
  {
    operationId: "me",
    responses: { 200: { description: "ok" } },
  },
  async ({ state }) => ({
    status: 200 as const,
    // ctx.state.csrfToken is always populated; render it into your form
    // or expose it to the SPA via a JSON envelope.
    body: { csrfToken: state.csrfToken },
  }),
);

app.post(
  "/transfer",
  {
    operationId: "transfer",
    responses: { 204: { description: "ok" }, 403: { description: "denied" } },
  },
  async () => ({ status: 204 as const, body: undefined }),
);`}
      />

      <h2 id="how-clients-send-the-token">How clients send the token</h2>
      <p>
        Browsers cache the token cookie automatically; your client code only
        needs to read it and echo it on the next mutating call. From a SPA:
      </p>
      <CodeBlock
        language="ts"
        code={`function getCsrf(): string {
  const m = document.cookie.match(/(?:^|; )__Host-daloy\\.csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

await fetch("/transfer", {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json",
    "x-csrf-token": getCsrf(),
  },
  body: JSON.stringify({ amount: 42 }),
});`}
      />

      <h2 id="defaults">Defaults</h2>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>cookieName</code>
            </td>
            <td>
              <code>__Host-daloy.csrf</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>headerName</code>
            </td>
            <td>
              <code>x-csrf-token</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ignoreMethods</code>
            </td>
            <td>
              <code>
                [&quot;GET&quot;, &quot;HEAD&quot;, &quot;OPTIONS&quot;]
              </code>
            </td>
          </tr>
          <tr>
            <td>
              <code>cookieOptions.sameSite</code>
            </td>
            <td>
              <code>&quot;Lax&quot;</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>cookieOptions.secure</code>
            </td>
            <td>
              <code>true</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>cookieOptions.path</code>
            </td>
            <td>
              <code>&quot;/&quot;</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>strategy</code>
            </td>
            <td>
              <code>&quot;double-submit&quot;</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>allowedOrigins</code>
            </td>
            <td>
              Required only for Fetch-Metadata legacy fallback / cross-origin
              allowlists
            </td>
          </tr>
          <tr>
            <td>
              <code>generator</code>
            </td>
            <td>32-byte WebCrypto random token</td>
          </tr>
        </tbody>
      </table>

      <p>
        The default generator requires WebCrypto (
        <code>crypto.getRandomValues</code> or <code>crypto.randomUUID</code>).
        If you run DaloyJS in an unusual runtime without WebCrypto, pass a
        cryptographically secure custom <code>generator</code> rather than
        falling back to predictable randomness.
      </p>

      <h2 id="the-host-prefix">
        The <code>__Host-</code> prefix
      </h2>
      <p>
        The default cookie name is prefixed with <code>__Host-</code>
        {". "}Browsers refuse to set such a cookie unless it is also{" "}
        <code>Secure</code>
        {", "}has <code>Path=/</code>
        {", "}and has no <code>Domain</code> attribute. The middleware enforces
        those constraints at construction time, so you cannot ship a
        misconfigured prefix to production. To use a non-prefixed cookie (for
        example during local HTTP development), pass an explicit{" "}
        <code>cookieName</code>
        {": "}
      </p>
      <CodeBlock
        code={`app.use(csrf({
  cookieName: "csrf",
  cookieOptions: {
    secure: false,    // local dev over plain HTTP
    sameSite: "Lax",
  },
}));`}
      />

      <h2 id="custom-header-names-and-methods">
        Custom header names and methods
      </h2>
      <p>
        Some clients (Angular, Axios) read <code>XSRF-TOKEN</code> and reflect
        it as <code>X-XSRF-TOKEN</code>
        {". "}To match that convention, override both names and the safe-method
        list:
      </p>
      <CodeBlock
        code={`app.use(csrf({
  cookieName: "XSRF-TOKEN",
  headerName: "X-XSRF-TOKEN",
  ignoreMethods: ["GET", "HEAD", "OPTIONS", "TRACE"],
  cookieOptions: {
    sameSite: "Lax",
    secure: true,
    // Optional: long-lived cookie so SPAs don't have to reissue per session.
    maxAgeSeconds: 60 * 60 * 24 * 7,
  },
}));`}
      />

      <h2 id="what-is-not-covered">
        What is <em>not</em> covered
      </h2>
      <ul>
        <li>
          <strong>Cross-origin reads.</strong> Set a strict CORS allowlist via{" "}
          <code>cors()</code> so other origins cannot trigger credentialed
          reads.
        </li>
        <li>
          <strong>HTML form posts.</strong> Render{" "}
          <code>ctx.state.csrfToken</code> into a hidden field and forward it as
          the <code>x-csrf-token</code> header (or use a small client-side
          script to do so), the middleware only reads the header, not multipart
          bodies.
        </li>
        <li>
          <strong>Authentication.</strong> CSRF is orthogonal to auth. Combine{" "}
          <code>csrf()</code> with <code>bearerAuth()</code> or your session
          middleware.
        </li>
      </ul>

      <h2 id="fetch-metadata-strategy-tokenless-recommended-for-new-apps">
        Fetch-Metadata strategy (tokenless, recommended for new apps)
      </h2>
      <p>
        The <code>csrf()</code> middleware also implements the modern{" "}
        <strong>Fetch Metadata</strong>
        strategy. Modern browsers send a <code>Sec-Fetch-Site</code> header on
        every request that tells the server whether the request originated from
        the <em>same</em> origin, a <em>cross</em>-site context, or no navigable
        context at all (<code>none</code>
        {", "}such as bookmarks or direct address-bar typing). That single
        header is enough to defeat the classic CSRF attack model without any
        cookie round-trip and without coupling your HTML rendering to a token.
      </p>
      <FlowDiagram
        title="Fetch-Metadata decision"
        steps={[
          {
            eyebrow: "ingress",
            label: "Mutating request",
            detail: "POST / PUT / PATCH / DELETE",
          },
          {
            eyebrow: "header",
            label: "Read Sec-Fetch-Site",
            detail: "browser-attested origin context",
          },
          {
            eyebrow: "same-origin / none",
            label: "Accept",
            detail: "same-origin or none to handler",
            tone: "success",
          },
          {
            eyebrow: "cross-site",
            label: "Reject",
            detail: "cross-site to 403 Forbidden",
            tone: "danger",
          },
        ]}
        caption="In fetch-metadata mode there is no cookie. The middleware trusts the browser-attested Sec-Fetch-Site header: same-origin and none pass, cross-site is rejected. A missing header (legacy browser) only passes when Origin or Referer matches allowedOrigins."
      />
      <CodeBlock
        code={`app.use(csrf({
  strategy: "fetch-metadata",
  // Allowed when the legacy browser sends Origin/Referer but no Sec-Fetch-Site.
  allowedOrigins: ["https://app.example.com"],
}));`}
      />
      <p>
        In <code>&quot;fetch-metadata&quot;</code> mode the middleware{" "}
        <em>does not</em> issue or require a cookie. On mutating requests it
        accepts the request when:
      </p>
      <ul>
        <li>
          <code>Sec-Fetch-Site</code> is <code>same-origin</code> or{" "}
          <code>none</code>; or
        </li>
        <li>
          <code>Sec-Fetch-Site</code> is missing (legacy browser) <em>and</em>{" "}
          <code>Origin</code> or <code>Referer</code> matches your{" "}
          <code>allowedOrigins</code> list/predicate.
        </li>
      </ul>
      <p>
        For defense in depth, pass <code>strategy: &quot;both&quot;</code>
        {". "}
        Mutating requests must then pass <em>both</em> the Fetch-Metadata check{" "}
        <em>and</em> the double-submit cookie check.
      </p>
      <p>
        Non-browser clients usually do not send <code>Sec-Fetch-Site</code>
        {". "}If they need to call protected mutating routes, give them an
        explicit <code>Origin</code> that matches <code>allowedOrigins</code>
        {", "}or use route-level middleware so browser and machine clients can
        follow different CSRF policies.
      </p>
    </>
  );
}
