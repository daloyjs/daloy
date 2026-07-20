import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with Auth0",
  description:
    "Authenticate and authorize requests in a DaloyJS API with Auth0. Verifies access tokens with jose against your tenant's JWKS, enforces scopes and permissions, and works on Node and edge runtimes.",
  path: "/docs/auth/auth0",
  keywords: [
    "DaloyJS Auth0",
    "Auth0 JWT verification",
    "Auth0 access token",
    "Auth0 scopes",
    "Auth0 RBAC",
    "express-oauth2-jwt-bearer alternative",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with Auth0</h1>
      <p>
        <a href="https://auth0.com" target="_blank" rel="noreferrer">
          Auth0
        </a>{" "}
        is a developer-friendly IdP that handles universal login, MFA, social
        login, and a rich rule/action engine. For backend protection,
        Auth0&apos;s official quickstart uses{" "}
        <a
          href="https://github.com/auth0/node-oauth2-jwt-bearer/tree/main/packages/express-oauth2-jwt-bearer"
          target="_blank"
          rel="noreferrer"
        >
          <code>express-oauth2-jwt-bearer</code>
        </a>
        {", "}which is Express-only. DaloyJS isn&apos;t Express, so we use the
        same primitive, JWT verification against Auth0&apos;s JWKS, through{" "}
        <a
          href="https://github.com/panva/jose"
          target="_blank"
          rel="noreferrer"
        >
          <code>jose</code>
        </a>
        {". "}That keeps the same security guarantees while running on every
        runtime DaloyJS targets, including the edge.
      </p>

      <SequenceDiagram
        title="Auth0 access-token verification"
        participants={[
          "Client app",
          "Auth0 tenant",
          "DaloyJS API",
          "Auth0 JWKS",
        ]}
        steps={[
          {
            from: "Client app",
            to: "Auth0 tenant",
            label: "Universal Login (authorization-code + PKCE)",
            detail: "Auth0 owns login, MFA, social",
            kind: "request",
          },
          {
            from: "Auth0 tenant",
            to: "Client app",
            label: "Access token (RS256 JWT, aud = your API)",
            kind: "response",
          },
          {
            from: "Client app",
            to: "DaloyJS API",
            label: "Request with Authorization: Bearer <token>",
            kind: "request",
          },
          {
            from: "DaloyJS API",
            to: "Auth0 JWKS",
            label: "Fetch signing keys (cached by jose)",
            detail: "GET /.well-known/jwks.json",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "Client app",
            label:
              "jwtVerify checks iss (trailing slash), aud, RS256, then scopes",
            detail: "401 on a bad token, 403 on a missing scope",
            kind: "response",
          },
        ]}
        caption="DaloyJS is the resource server: jose verifies the RS256 token against your tenant's JWKS and enforces scopes or permissions. Auth0 owns login and is the only party that mints tokens."
      />

      <h2 id="1-configure-an-auth0-api">1. Configure an Auth0 API</h2>
      <ol>
        <li>
          In the Auth0 dashboard, go to{" "}
          <strong>Applications → APIs → Create API</strong>
          {". "}Pick an <strong>identifier</strong> (e.g.{" "}
          <code>https://api.acme.example.com</code>), this becomes the{" "}
          <code>aud</code> claim on issued tokens.
        </li>
        <li>
          Define <strong>permissions</strong> (e.g. <code>read:items</code>
          {", "}
          <code>write:items</code>) and enable <strong>RBAC</strong> +{" "}
          <em>Add Permissions in the Access Token</em> if you want them in{" "}
          <code>permissions</code>.
        </li>
        <li>
          Note your tenant&apos;s <strong>domain</strong> (e.g.{" "}
          <code>dev-abc123.us.auth0.com</code>). Your issuer is{" "}
          <code>https://&#123;domain&#125;/</code> (trailing slash).
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add jose`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
AUTH0_DOMAIN=dev-abc123.us.auth0.com
AUTH0_AUDIENCE=https://api.acme.example.com
AUTH0_REQUIRED_SCOPE=read:items`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/auth0.ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { App } from "@daloyjs/core";

const issuer = \`https://\${process.env.AUTH0_DOMAIN}/\`;
const audience = process.env.AUTH0_AUDIENCE!;

const jwks = createRemoteJWKSet(
  new URL(\`https://\${process.env.AUTH0_DOMAIN}/.well-known/jwks.json\`),
);

export interface Principal {
  sub: string;
  scopes: string[];
  permissions: string[];
  claims: JWTPayload;
}

export const auth0Plugin = {
  name: "auth0",
  register(app: App) {
    app.decorate("verifier", {
      async verify(token: string): Promise<Principal> {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience,
          algorithms: ["RS256"],
        });
        const scopes =
          typeof payload.scope === "string" ? payload.scope.split(" ") : [];
        const permissions = Array.isArray(payload.permissions)
          ? (payload.permissions as string[])
          : [];
        return { sub: String(payload.sub), scopes, permissions, claims: payload };
      },
    });
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    verifier: { verify(token: string): Promise<Principal> };
    principal?: Principal;
  }
}`}
      />

      <h2 id="5-guard-a-route">5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { auth0Plugin } from "./plugins/auth0.ts";
import { requireAuth } from "./plugins/auth.ts"; // from the Overview page

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(auth0Plugin);

app.get(
  "/items",
  {
    operationId: "listItems",
    hooks: requireAuth(process.env.AUTH0_REQUIRED_SCOPE!),
    responses: {
      200: { description: "OK", body: z.object({ user: z.string(), items: z.array(z.string()) }) },
    },
  },
  ({ state }) => ({
    status: 200,
    body: { user: state.principal!.sub, items: ["a", "b"] },
  }),
);`}
      />

      <h2 id="permissions-rbac">Permissions (RBAC)</h2>
      <p>
        If you enabled <em>Add Permissions in the Access Token</em>
        {", "}the JWT carries a <code>permissions</code> array. Tighten the
        overview&apos;s <code>requireAuth</code> to check{" "}
        <code>principal.permissions</code> when you want to enforce role
        assignments rather than OAuth 2.0 scopes:
      </p>
      <CodeBlock
        code={`import { ForbiddenError, type Hooks } from "@daloyjs/core";

export function requirePermission(...perms: string[]): Hooks {
  return {
    preBody: (ctx) => {
      // ... bearer extraction & verify() as before ...
      const have = ctx.state.principal!.permissions;
      if (!perms.every((p) => have.includes(p))) {
        throw new ForbiddenError("Missing permission");
      }
      // continue
    },
  };
}`}
      />

      <h2 id="auth0-actions-and-custom-claims">
        Auth0 Actions &amp; custom claims
      </h2>
      <p>
        Add custom claims through an{" "}
        <a
          href="https://auth0.com/docs/customize/actions/flows-and-triggers/login-flow"
          target="_blank"
          rel="noreferrer"
        >
          Action on the Login flow
        </a>
        {". "}Namespace them (e.g. <code>https://acme.example.com/tenant</code>)
        per Auth0&apos;s rules, that prevents collisions with standard claims
        and is required for non-reserved claims to be included.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        <code>jose</code> uses Web Crypto, so this setup runs everywhere DaloyJS
        does: Node.js, Bun, Deno, Cloudflare Workers, and AWS Lambda. No need to
        swap libraries between environments.
      </p>

      <h2 id="notes">Notes</h2>
      <ul>
        <li>
          The <code>iss</code> claim Auth0 issues includes a{" "}
          <strong>trailing slash</strong>
          {". "}Mismatching it (with or without the slash) is a common cause of
          validation failures.
        </li>
        <li>
          Set a non-empty <strong>audience</strong> on the API, without it Auth0
          returns an opaque token that you can&apos;t verify locally.
        </li>
        <li>
          For sensitive operations, also check Auth0&apos;s <code>azp</code>{" "}
          (authorized party) claim against your allowed client IDs.
        </li>
      </ul>

      <p>
        See also <Link href="/docs/auth/okta">Okta</Link>
        {", "}
        <Link href="/docs/auth/clerk">Clerk</Link>
        {", "}and the <Link href="/docs/auth">auth integrations overview</Link>
        {"."}
      </p>
    </>
  );
}
