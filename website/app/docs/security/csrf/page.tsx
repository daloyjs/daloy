import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "CSRF protection",
  description:
    "Use the built-in csrf() middleware to add double-submit-cookie CSRF protection to mutating routes with timing-safe verification.",
  path: "/docs/security/csrf",
  keywords: ["DaloyJS CSRF", "double-submit cookie", "CSRF protection", "TypeScript CSRF middleware"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>CSRF protection</h1>
      <p>
        DaloyJS ships a small, framework-agnostic <code>csrf()</code> middleware that implements the{" "}
        <strong>double-submit cookie</strong> pattern. The server stamps a random token in a cookie on
        safe requests; the client mirrors that token in a request header on mutating requests. The
        middleware then compares the cookie and header in constant time and rejects mismatches with{" "}
        <strong>403 Forbidden</strong>.
      </p>
      <p>
        The token cookie is intentionally readable by client-side JavaScript so a browser client can
        echo it into the header. Treat XSS prevention as a separate requirement: if an attacker can
        run script in your origin, they can read the CSRF token too.
      </p>

      <h2>Quick start</h2>
      <CodeBlock code={`import { App, csrf } from "@daloyjs/core";

const app = new App();

app.use(csrf());

app.route({
  method: "GET",
  path: "/me",
  operationId: "me",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => ({
    status: 200 as const,
    // ctx.state.csrfToken is always populated; render it into your form
    // or expose it to the SPA via a JSON envelope.
    body: { csrfToken: state.csrfToken },
  }),
});

app.route({
  method: "POST",
  path: "/transfer",
  operationId: "transfer",
  responses: { 204: { description: "ok" }, 403: { description: "denied" } },
  handler: async () => ({ status: 204 as const, body: undefined }),
});`} />

      <h2>How clients send the token</h2>
      <p>
        Browsers cache the token cookie automatically; your client code only needs to read it and
        echo it on the next mutating call. From a SPA:
      </p>
      <CodeBlock language="ts" code={`function getCsrf(): string {
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
});`} />

      <h2>Defaults</h2>
      <table>
        <thead><tr><th>Option</th><th>Default</th></tr></thead>
        <tbody>
          <tr><td><code>cookieName</code></td><td><code>__Host-daloy.csrf</code></td></tr>
          <tr><td><code>headerName</code></td><td><code>x-csrf-token</code></td></tr>
          <tr><td><code>ignoreMethods</code></td><td><code>[&quot;GET&quot;, &quot;HEAD&quot;, &quot;OPTIONS&quot;]</code></td></tr>
          <tr><td><code>cookieOptions.sameSite</code></td><td><code>&quot;Lax&quot;</code></td></tr>
          <tr><td><code>cookieOptions.secure</code></td><td><code>true</code></td></tr>
          <tr><td><code>cookieOptions.path</code></td><td><code>&quot;/&quot;</code></td></tr>
          <tr><td><code>generator</code></td><td>32-byte WebCrypto random token</td></tr>
        </tbody>
      </table>

      <p>
        The default generator requires WebCrypto (<code>crypto.getRandomValues</code> or{" "}
        <code>crypto.randomUUID</code>). If you run DaloyJS in an unusual runtime without WebCrypto,
        pass a cryptographically secure custom <code>generator</code> rather than falling back to
        predictable randomness.
      </p>

      <h2>The <code>__Host-</code> prefix</h2>
      <p>
        The default cookie name is prefixed with <code>__Host-</code>. Browsers refuse to set such a
        cookie unless it is also <code>Secure</code>, has <code>Path=/</code>, and has no{" "}
        <code>Domain</code> attribute. The middleware enforces those constraints at construction
        time, so you cannot ship a misconfigured prefix to production. To use a non-prefixed cookie
        (for example during local HTTP development), pass an explicit <code>cookieName</code>:
      </p>
      <CodeBlock code={`app.use(csrf({
  cookieName: "csrf",
  cookieOptions: {
    secure: false,    // local dev over plain HTTP
    sameSite: "Lax",
  },
}));`} />

      <h2>Custom header names and methods</h2>
      <p>
        Some clients (Angular, Axios) read <code>XSRF-TOKEN</code> and reflect it as{" "}
        <code>X-XSRF-TOKEN</code>. To match that convention, override both names and the safe-method
        list:
      </p>
      <CodeBlock code={`app.use(csrf({
  cookieName: "XSRF-TOKEN",
  headerName: "X-XSRF-TOKEN",
  ignoreMethods: ["GET", "HEAD", "OPTIONS", "TRACE"],
  cookieOptions: {
    sameSite: "Lax",
    secure: true,
    // Optional: long-lived cookie so SPAs don't have to reissue per session.
    maxAgeSeconds: 60 * 60 * 24 * 7,
  },
}));`} />

      <h2>What is <em>not</em> covered</h2>
      <ul>
        <li>
          <strong>Cross-origin reads.</strong> Set a strict CORS allowlist via{" "}
          <code>cors()</code> so other origins cannot trigger credentialed reads.
        </li>
        <li>
          <strong>HTML form posts.</strong> Render <code>ctx.state.csrfToken</code> into a hidden
          field and forward it as the <code>x-csrf-token</code> header (or use a small client-side
          script to do so) — the middleware only reads the header, not multipart bodies.
        </li>
        <li>
          <strong>Authentication.</strong> CSRF is orthogonal to auth. Combine{" "}
          <code>csrf()</code> with <code>bearerAuth()</code> or your session middleware.
        </li>
      </ul>
    </>
  );
}
