import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Auth architecture: where DaloyJS fits in OAuth2 & OpenID Connect",
  description:
    "DaloyJS is a resource server and relying-party toolkit, not an identity provider. Learn when to use an OpenID Connect provider such as Auth0, Okta, Keycloak, or Zitadel, when an embedded session system such as Better Auth fits, and the two architectures we recommend.",
  path: "/docs/auth/architecture",
  keywords: [
    "DaloyJS OAuth2",
    "DaloyJS OpenID Connect",
    "DaloyJS vs IdentityServer",
    "DaloyJS vs .NET",
    "resource server vs authorization server",
    "do I need Auth0 Okta Clerk",
    "self-hosted OIDC Keycloak Zitadel Ory",
    "embedded authentication Better Auth",
    "BFF pattern Node",
    "JWT verification edge",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>
        Auth architecture: where DaloyJS fits in OAuth2 &amp; OpenID Connect
      </h1>
      <p>
        This is the page to read before you wire up login. DaloyJS (like Hono,
        Express, Fastify, or ASP.NET Core) is a <strong>web framework</strong>
        {". "}
        It is excellent at <em>verifying</em> and <em>enforcing</em> identity on
        each request, but it deliberately does <strong>not</strong> ship a login
        UI, a user database, or an OAuth2 authorization server. Those belong to
        an <strong>identity provider (IdP)</strong> that you bring to the table.
      </p>

      <h2 id="short-answer">The short answer</h2>
      <ul>
        <li>
          <strong>DaloyJS is a resource server</strong> (and a toolkit for
          building a relying party). It checks tokens; it does not issue them.
        </li>
        <li>
          <strong>It is not an &quot;IdentityServer&quot;.</strong> It cannot,
          on its own, do what Duende IdentityServer, Keycloak, or Auth0 do: run
          login pages, manage clients and consent, and mint tokens.
        </li>
        <li>
          <strong>You need an identity and session system.</strong> For an
          OAuth2/OIDC architecture, use a standards-compliant managed or
          self-hosted IdP. For a first-party application that does not need an
          external token issuer, an embedded system such as Better Auth can own
          login and cookie sessions inside your DaloyJS deployment.
        </li>
        <li>
          <strong>Do not build your own authorization server.</strong> Verify
          tokens from a vetted provider instead.
        </li>
      </ul>

      <h2 id="roles">The three OAuth2 / OpenID Connect roles</h2>
      <p>
        Every OAuth2 / OIDC deployment splits responsibilities across three
        roles. Confusion about &quot;can DaloyJS do OAuth2?&quot; almost always
        comes from collapsing these into one box.
      </p>
      <table>
        <thead>
          <tr>
            <th>Responsibility</th>
            <th>OAuth2 / OIDC role</th>
            <th>Who plays it</th>
            <th>DaloyJS?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Owns login, consent, and clients; mints &amp; refreshes tokens
            </td>
            <td>
              <strong>Authorization Server</strong> / OpenID Provider (OP)
            </td>
            <td>
              Auth0, Okta, Entra ID, Cognito, Keycloak, Zitadel, Ory&hellip;
            </td>
            <td>No</td>
          </tr>
          <tr>
            <td>Accepts a token, verifies it, returns protected data</td>
            <td>
              <strong>Resource Server</strong>
            </td>
            <td>Your API</td>
            <td>
              <strong>Yes</strong>
            </td>
          </tr>
          <tr>
            <td>Starts the login flow and holds the user&apos;s session</td>
            <td>
              <strong>Client</strong> / Relying Party (RP)
            </td>
            <td>Your SPA, mobile app, or a server-side BFF</td>
            <td>
              <strong>Yes</strong> (building blocks)
            </td>
          </tr>
        </tbody>
      </table>

      <SequenceDiagram
        title="How the three roles interact"
        participants={[
          "Client (RP)",
          "Authorization Server (IdP)",
          "Resource Server (DaloyJS)",
        ]}
        steps={[
          {
            from: "Client (RP)",
            to: "Authorization Server (IdP)",
            label: "Start login (authorization-code + PKCE)",
            detail: "user authenticates on the IdP's pages",
            kind: "request",
          },
          {
            from: "Authorization Server (IdP)",
            to: "Client (RP)",
            label: "Issue access token (a signed JWT)",
            detail: "the IdP mints tokens; nobody else does",
            kind: "response",
          },
          {
            from: "Client (RP)",
            to: "Resource Server (DaloyJS)",
            label: "Call the API with Authorization: Bearer <token>",
            kind: "request",
          },
          {
            from: "Resource Server (DaloyJS)",
            to: "Authorization Server (IdP)",
            label: "Fetch JWKS to verify the signature (cached)",
            detail: "GET /.well-known/jwks.json",
            kind: "async",
          },
          {
            from: "Resource Server (DaloyJS)",
            to: "Client (RP)",
            label: "Return protected data after checking iss, aud & scopes",
            kind: "response",
          },
        ]}
        caption="DaloyJS only ever plays the Resource Server: it verifies tokens and enforces scopes. Minting tokens and running the login UI stays with the Authorization Server (the IdP)."
      />

      <h2 id="where-daloy-fits">
        Where DaloyJS fits (and where it doesn&apos;t)
      </h2>
      <p>
        DaloyJS owns the <strong>Resource Server</strong> role outright, and it
        gives you everything you need to build the{" "}
        <strong>Client / Relying Party</strong> (the back-end-for-frontend, or
        BFF). What it does not do is play the{" "}
        <strong>Authorization Server</strong>
        {": "}it will not render a login page, store passwords, run a consent
        screen, expose a <code>/.well-known/openid-configuration</code>{" "}
        discovery document, or issue access and refresh tokens to third-party
        clients. That is the IdP&apos;s job, and reimplementing it is exactly
        the kind of security-critical work you should not take on yourself.
      </p>

      <h2 id="dotnet-comparison">
        DaloyJS vs .NET, ASP.NET Core, and Duende IdentityServer
      </h2>
      <p>
        A common question is &quot;what is the difference between DaloyJS and
        .NET?&quot; They are not the same kind of thing. <strong>.NET</strong>{" "}
        is a whole platform: a runtime (the CLR), a large standard library, and
        an ecosystem of first-party frameworks. <strong>DaloyJS</strong> is a
        single web framework that runs on JavaScript runtimes. The closest .NET
        analog to DaloyJS is <strong>ASP.NET Core</strong>
        {", "}not &quot;.NET&quot; as a whole. And the identity pieces that
        ship in the .NET ecosystem (Duende IdentityServer, OpenIddict, ASP.NET
        Core Identity) have no built-in DaloyJS equivalent on purpose, you bring
        an external IdP.
      </p>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>.NET world</th>
            <th>JavaScript / DaloyJS world</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Language &amp; runtime</td>
            <td>C# / F# on the CLR</td>
            <td>TypeScript on Node, Bun, Deno, Workers, Vercel</td>
          </tr>
          <tr>
            <td>Standard library</td>
            <td>.NET base class library (BCL)</td>
            <td>
              The runtime&apos;s web-platform APIs (fetch, Web Crypto&hellip;)
            </td>
          </tr>
          <tr>
            <td>Web framework</td>
            <td>ASP.NET Core (Minimal APIs, MVC)</td>
            <td>
              <strong>DaloyJS</strong> (or Hono, Express, Fastify, Elysia)
            </td>
          </tr>
          <tr>
            <td>Token validation (resource server)</td>
            <td>
              <code>Microsoft.AspNetCore.Authentication.JwtBearer</code>
            </td>
            <td>
              <code>jwk()</code> / <code>createJwtVerifier()</code> /{" "}
              <code>bearerAuth()</code>
            </td>
          </tr>
          <tr>
            <td>Authorization server / login (issues tokens)</td>
            <td>Duende IdentityServer, OpenIddict, ASP.NET Core Identity</td>
            <td>
              A separate IdP (managed or self-hosted), no built-in equivalent
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        So yes: DaloyJS and Hono are frameworks, and on their own they cannot do
        what Duende IdentityServer does. IdentityServer <em>is</em> an
        authorization server. DaloyJS sits in front of your business logic and
        trusts the tokens an authorization server issues.
      </p>

      <h2 id="do-you-need-a-provider">Do you need Auth0, Okta, or Clerk?</h2>
      <p>
        If your architecture uses OAuth2/OIDC bearer tokens, you need an OpenID
        Connect provider, but not one of those three brands specifically. Any
        provider that exposes standard JWKS and OIDC discovery works with the
        same DaloyJS verifier. Pick the operational model that fits your team:
      </p>
      <h3 id="managed-providers">Managed (fastest to ship)</h3>
      <p>
        Someone else runs the IdP; you configure it. Good default for most
        teams.
      </p>
      <ul>
        <li>
          <Link href="/docs/auth/auth0">Auth0</Link>
          {", "}
          <Link href="/docs/auth/okta">Okta</Link>
          {", "}
          <Link href="/docs/auth/clerk">Clerk</Link>
          {", "}
          <Link href="/docs/auth/entra-id">Microsoft Entra ID</Link>
          {", "}
          <Link href="/docs/auth/aws-cognito">AWS Cognito</Link>
        </li>
        <li>
          Google Identity, Stytch, WorkOS, Firebase Authentication, and others
        </li>
      </ul>
      <h3 id="self-hosted-providers">Self-hosted open source (full control)</h3>
      <p>
        You operate the IdP yourself. Choose this for data residency, air-gapped
        environments, or cost control at scale.
      </p>
      <ul>
        <li>
          <a href="https://www.keycloak.org" target="_blank" rel="noreferrer">
            Keycloak
          </a>
          {", "}
          <a href="https://zitadel.com" target="_blank" rel="noreferrer">
            Zitadel
          </a>
          {", "}
          <a href="https://www.ory.sh" target="_blank" rel="noreferrer">
            Ory (Hydra + Kratos)
          </a>
          {", "}
          <a href="https://goauthentik.io" target="_blank" rel="noreferrer">
            Authentik
          </a>
          {", "}
          <a href="https://logto.io" target="_blank" rel="noreferrer">
            Logto
          </a>
          {", "}
          <a href="https://supertokens.com" target="_blank" rel="noreferrer">
            SuperTokens
          </a>
          {", "}
          <a href="https://dexidp.io" target="_blank" rel="noreferrer">
            Dex
          </a>
        </li>
      </ul>
      <h3 id="embedded-auth">Embedded authentication (same deployment)</h3>
      <p>
        <Link href="/docs/auth/better-auth">Better Auth</Link> runs inside your
        application and can own first-party login plus cookie sessions without
        acting as an external OIDC provider. Its optional OIDC/OAuth provider
        plugins can add that role when your architecture genuinely needs it.
      </p>
      <p>
        Whatever you pick, treat building your own authorization server as a
        non-goal. Implementing OAuth2 / OIDC correctly (authorization-code +
        PKCE, token rotation, key management and rotation, consent, discovery,
        and the long tail of spec edge cases) is a large, high-risk surface that
        vetted IdPs already solve.
      </p>

      <h2 id="resource-server">
        Recommended architecture 1: API as a resource server
      </h2>
      <p>
        This is the default and the most common shape. Your API trusts tokens
        issued by your IdP, verifies them on every request against the
        provider&apos;s JWKS, and authorizes per route by scope. It works
        identically across every runtime DaloyJS targets, including the edge.
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, requireScopes } from "@daloyjs/core";
import { jwk } from "@daloyjs/core/jwk";

const app = new App();

// Verify every Bearer token against your IdP's JWKS. The same one line works
// for Auth0, Okta, Entra ID, Cognito, Keycloak, Zitadel, Ory, and others
// (JWT-based IdPs). Better Auth uses its own handler + getSession API instead.
app.use(
  jwk({
    jwks: "https://login.example.com/.well-known/jwks.json",
    algorithms: ["RS256", "ES256"], // asymmetric only; HS* is refused by design
    issuer: "https://login.example.com/",
    audience: "https://api.example.com",
  }),
);

// Authorize per route by scope/permission.
app.get(
  "/orders",
  {
    hooks: requireScopes("orders:read"),
    responses: { 200: { description: "ok" } },
  },
  () => ({ status: 200, body: { orders: [] } }),
);`}
      />
      <p>
        The <code>jwk()</code> middleware enforces an asymmetric-only algorithm
        allowlist (it refuses <code>HS*</code> to block the classic
        confused-deputy attack), checks <code>issuer</code> and{" "}
        <code>audience</code>
        {", "}caches the JWKS, and sends <code>Cache-Control: no-store</code>{" "}
        on its <code>401</code> challenges. See{" "}
        <Link href="/docs/security/auth-slice">the auth slice</Link> for the
        full behavior, and the per-provider guides for{" "}
        <Link href="/docs/auth/auth0">Auth0</Link>
        {", "}
        <Link href="/docs/auth/okta">Okta</Link>
        {", "}
        <Link href="/docs/auth/entra-id">Entra ID</Link>
        {", "}
        <Link href="/docs/auth/aws-cognito">Cognito</Link>
        {", "}
        <Link href="/docs/auth/clerk">Clerk</Link>
        {", "}and <Link href="/docs/auth/better-auth">Better Auth</Link>.
      </p>

      <h2 id="bff">
        Recommended architecture 2: browser app (the BFF pattern)
      </h2>
      <p>
        If a browser app needs users to log in, do <strong>not</strong> hold
        access or refresh tokens in JavaScript. Run a thin server-side{" "}
        <strong>back-end-for-frontend</strong> (BFF): it performs the
        authorization-code + PKCE flow with the IdP, keeps the resulting tokens
        in a signed, encrypted <code>session()</code> cookie, and exposes only
        same-origin endpoints to the browser. Protect every state-changing route
        with <code>csrf()</code> because the browser now authenticates with a
        cookie.
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, csrf } from "@daloyjs/core";
import { session } from "@daloyjs/core";

const app = new App();

// Tokens from the IdP live here, server-side and encrypted, never in the browser.
app.use(session({ secret: process.env.SESSION_SECRET! }));

// The browser authenticates with a cookie, so guard mutations against CSRF.
app.use(csrf());

// Your routes call upstream APIs with the access token stored in the session,
// so the browser never sees it.`}
      />
      <SequenceDiagram
        title="BFF pattern: tokens never reach the browser"
        participants={[
          "Browser",
          "BFF (DaloyJS)",
          "Authorization Server (IdP)",
          "Upstream API",
        ]}
        steps={[
          {
            from: "Browser",
            to: "BFF (DaloyJS)",
            label: "GET /login (same-origin)",
            kind: "request",
          },
          {
            from: "BFF (DaloyJS)",
            to: "Authorization Server (IdP)",
            label: "Authorization-code + PKCE flow",
            detail: "exchange code for tokens server-side",
            kind: "async",
          },
          {
            from: "BFF (DaloyJS)",
            to: "Browser",
            label: "Set signed, encrypted session cookie",
            detail: "tokens stay server-side; cookie holds only a session id",
            kind: "response",
          },
          {
            from: "Browser",
            to: "BFF (DaloyJS)",
            label: "Call same-origin route (+ CSRF token)",
            detail: "cookie auth → csrf() guards the mutation",
            kind: "request",
          },
          {
            from: "BFF (DaloyJS)",
            to: "Upstream API",
            label: "Forward request with the stored access token",
            kind: "request",
          },
          {
            from: "BFF (DaloyJS)",
            to: "Browser",
            label: "Return data; the access token is never exposed",
            kind: "response",
          },
        ]}
        caption="Because the browser now authenticates with a cookie, every state-changing route is protected with csrf(). Access and refresh tokens live only in the encrypted session, never in JavaScript."
      />
      <p>
        The login/callback routes themselves drive the OIDC flow against your
        provider. See <Link href="/docs/security/session">sessions</Link> and{" "}
        <Link href="/docs/security/csrf">CSRF</Link> for the building blocks.
      </p>

      <h2 id="building-blocks">First-party building blocks</h2>
      <table>
        <thead>
          <tr>
            <th>Helper</th>
            <th>Import</th>
            <th>Role it serves</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>jwk()</code>
            </td>
            <td>
              <code>@daloyjs/core/jwk</code>
            </td>
            <td>Verify asymmetric JWTs against a JWKS (resource server)</td>
          </tr>
          <tr>
            <td>
              <code>createJwtVerifier()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>Lower-level JWT verification when you manage the keys</td>
          </tr>
          <tr>
            <td>
              <code>bearerAuth()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>Validate opaque or custom Bearer tokens with your own hook</td>
          </tr>
          <tr>
            <td>
              <code>requireScopes()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>Authorize a route by scope or permission</td>
          </tr>
          <tr>
            <td>
              <code>basicAuth()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>HTTP Basic for simple internal cases</td>
          </tr>
          <tr>
            <td>
              <code>session()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>Signed, encrypted cookie session for a BFF / relying party</td>
          </tr>
          <tr>
            <td>
              <code>csrf()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>
              CSRF protection for cookie-authenticated, state-changing routes
            </td>
          </tr>
          <tr>
            <td>
              <code>createJwtSigner()</code>
            </td>
            <td>
              <code>@daloyjs/core</code>
            </td>
            <td>
              Mint your own JWTs for service-to-service or a tiny first-party
              issuer
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="recommendations">What we recommend</h2>
      <ul>
        <li>
          <strong>Default to a resource server.</strong> Verify JWTs with{" "}
          <code>jwk()</code>
          {", "}pin an asymmetric algorithm allowlist, enforce{" "}
          <code>issuer</code> + <code>audience</code>
          {", "}and gate routes with <code>requireScopes()</code>.
        </li>
        <li>
          <strong>Use the BFF pattern for browser logins.</strong> Run
          authorization-code + PKCE on the server, keep tokens in a{" "}
          <code>session()</code> cookie, never expose them to JavaScript, and
          protect mutations with <code>csrf()</code>.
        </li>
        <li>
          <strong>Bring an IdP you do not operate</strong> unless you have a
          strong reason not to: managed for speed, self-hosted open source for
          control and data residency.
        </li>
        <li>
          <strong>Never build your own authorization server.</strong>
        </li>
        <li>
          <strong>Service-to-service / internal traffic:</strong> use{" "}
          <code>bearerAuth()</code> with a verified token, or{" "}
          <code>createJwtSigner()</code> + <code>jwk()</code> when both sides
          speak JWT. See the{" "}
          <Link href="/docs/security/internal-service-preset">
            internal-service preset
          </Link>
          {"."}
        </li>
      </ul>

      <h2 id="related">Related</h2>
      <ul>
        <li>
          <Link href="/docs/auth">
            Authentication &amp; authorization overview
          </Link>
        </li>
        <li>
          <Link href="/docs/security/auth-slice">
            Auth slice (jwk, verify hooks)
          </Link>
        </li>
        <li>
          <Link href="/docs/security/session">Sessions</Link> and{" "}
          <Link href="/docs/security/csrf">CSRF</Link>
        </li>
        <li>
          <Link href="/docs/where-to-use">Where to use DaloyJS</Link>
        </li>
      </ul>
    </>
  );
}
