import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with Microsoft Entra ID (MSAL)",
  description:
    "Authenticate and authorize requests in a DaloyJS API with Microsoft Entra ID (formerly Azure AD). Verifies v2.0 access tokens with jose and the tenant's JWKS, and shows MSAL Node usage for downstream service calls.",
  path: "/docs/auth/entra-id",
  keywords: [
    "DaloyJS Entra ID",
    "DaloyJS Azure AD",
    "MSAL Node",
    "@azure/msal-node",
    "Entra ID JWT verification",
    "jose JWKS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with Microsoft Entra ID (MSAL)</h1>
      <p>
        <a
          href="https://learn.microsoft.com/en-us/entra/identity-platform/"
          target="_blank"
          rel="noreferrer"
        >
          Microsoft Entra ID
        </a>{" "}
        (formerly Azure Active Directory) is Microsoft&apos;s enterprise
        identity platform. For a backend API, the job is to verify the v2.0
        access token in the <code>Authorization</code> header against the
        tenant&apos;s public JWKS. The{" "}
        <a href="https://github.com/panva/jose" target="_blank" rel="noreferrer">
          <code>jose</code>
        </a>{" "}
        library is the modern, runtime-portable choice for that. Use{" "}
        <a
          href="https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node"
          target="_blank"
          rel="noreferrer"
        >
          <code>@azure/msal-node</code>
        </a>{" "}
        on top when your API needs to call <em>another</em> protected service
        (OAuth 2.0 on-behalf-of, client credentials, etc.).
      </p>

      <SequenceDiagram
        title="Entra ID v2.0 access-token verification"
        participants={[
          "Client app",
          "Entra ID",
          "DaloyJS API",
          "Tenant JWKS",
        ]}
        steps={[
          {
            from: "Client app",
            to: "Entra ID",
            label: "User signs in; Entra ID mints a v2.0 access token (RS256)",
            detail: "aud = api://my-daloy-api",
            kind: "async",
          },
          {
            from: "Client app",
            to: "DaloyJS API",
            label: "Call API with Authorization: Bearer <access token>",
            kind: "request",
          },
          {
            from: "DaloyJS API",
            to: "Tenant JWKS",
            label: "createRemoteJWKSet fetches signing keys (cached)",
            detail: "GET /{tenantId}/discovery/v2.0/keys",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "DaloyJS API",
            label: "jwtVerify checks issuer, audience, scp / roles",
            detail: "iss = login.microsoftonline.com/{tenantId}/v2.0",
            kind: "note",
          },
          {
            from: "DaloyJS API",
            to: "Client app",
            label: "Return protected data after requireAuth passes",
            kind: "response",
          },
        ]}
        caption="The DaloyJS API verifies the v2.0 token against the tenant's JWKS with jose. Keys refresh automatically on a missing kid, so signing-key rollover needs no redeploy. Multi-tenant apps must also validate the tid claim against an allowlist."
      />

      <h2>1. Register the API in Entra ID</h2>
      <ol>
        <li>
          In the <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer">Microsoft
          Entra admin center</a>, go to{" "}
          <strong>Entra ID → App registrations → New registration</strong> and
          register your API app.
        </li>
        <li>
          Under <strong>Expose an API</strong>, set an{" "}
          <strong>Application ID URI</strong> (e.g.{" "}
          <code>api://my-daloy-api</code>) and add one or more{" "}
          <strong>scopes</strong> (e.g. <code>access_as_user</code>).
        </li>
        <li>
          Register your client app separately and grant it permission to the
          scope above. Note the <strong>tenant ID</strong> and the API
          app&apos;s <strong>Application (client) ID</strong>.
        </li>
        <li>
          The OIDC discovery document lives at{" "}
          <code>
            https://login.microsoftonline.com/&#123;tenantId&#125;/v2.0/.well-known/openid-configuration
          </code>{" "}
          and references the JWKS at{" "}
          <code>https://login.microsoftonline.com/&#123;tenantId&#125;/discovery/v2.0/keys</code>.
        </li>
      </ol>

      <h2>2. Install</h2>
      <CodeBlock code={`pnpm add jose`} />
      <p>
        Add <code>@azure/msal-node</code> as well only if the API itself needs
        to acquire downstream tokens (see below).
      </p>

      <h2>3. Environment variables</h2>
      <CodeBlock
        code={`# .env
ENTRA_TENANT_ID=11111111-2222-3333-4444-555555555555
ENTRA_API_AUDIENCE=api://my-daloy-api   # or the API app's client ID GUID
ENTRA_REQUIRED_SCOPE=access_as_user`}
      />

      <h2>4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/entra.ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { App } from "@daloyjs/core";

const tenantId = process.env.ENTRA_TENANT_ID!;
const issuer = \`https://login.microsoftonline.com/\${tenantId}/v2.0\`;
const audience = process.env.ENTRA_API_AUDIENCE!;

const jwks = createRemoteJWKSet(
  new URL(\`https://login.microsoftonline.com/\${tenantId}/discovery/v2.0/keys\`),
);

export interface Principal {
  sub: string;
  oid?: string;
  tid?: string;
  scopes: string[];
  roles: string[];
  claims: JWTPayload;
}

export const entraPlugin = {
  name: "entra",
  register(app: App) {
    app.decorate("verifier", {
      async verify(token: string): Promise<Principal> {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience,
          algorithms: ["RS256"],
        });
        const scp = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
        const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
        return {
          sub: String(payload.sub),
          oid: payload.oid as string | undefined,
          tid: payload.tid as string | undefined,
          scopes: scp,
          roles,
          claims: payload,
        };
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
      <p>
        <code>createRemoteJWKSet</code> caches keys in memory and refreshes on
        a missing <code>kid</code>, so key rollover is handled automatically.
      </p>

      <h2>5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { entraPlugin } from "./plugins/entra";
import { requireAuth } from "./plugins/auth"; // from the Overview page

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(entraPlugin);

app.route({
  method: "GET",
  path: "/me",
  operationId: "getMe",
  middleware: [requireAuth(process.env.ENTRA_REQUIRED_SCOPE!)],
  responses: {
    200: { description: "OK", body: z.object({ oid: z.string().optional(), tid: z.string().optional() }) },
  },
  handler: ({ state }) => ({
    status: 200,
    body: { oid: state.principal!.oid, tid: state.principal!.tid },
  }),
});`}
      />
      <p>
        <strong>App roles vs delegated scopes:</strong> app-only tokens
        (client-credentials flow) put granted roles in <code>roles</code> with
        no <code>scp</code> claim, while user-delegated tokens put granted
        scopes in <code>scp</code>. Inspect both in <code>requireAuth</code> if
        you support both shapes.
      </p>

      <h2>Acquiring downstream tokens with MSAL Node</h2>
      <p>
        If your API needs to call Microsoft Graph or another protected service{" "}
        <em>on behalf of</em> the user, use MSAL Node&apos;s{" "}
        <code>ConfidentialClientApplication</code>:
      </p>
      <CodeBlock
        code={`pnpm add @azure/msal-node`}
      />
      <CodeBlock
        code={`import { ConfidentialClientApplication } from "@azure/msal-node";

const msal = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.ENTRA_CLIENT_ID!,
    authority: \`https://login.microsoftonline.com/\${process.env.ENTRA_TENANT_ID}\`,
    clientSecret: process.env.ENTRA_CLIENT_SECRET!, // or use a certificate
  },
});

// On-behalf-of: exchange the incoming user token for a Graph token
const result = await msal.acquireTokenOnBehalfOf({
  oboAssertion: incomingUserAccessToken,
  scopes: ["https://graph.microsoft.com/User.Read"],
});
console.log(result?.accessToken);`}
      />
      <p>
        Prefer <strong>certificates over client secrets</strong> in production,
        and store credentials in Azure Key Vault or your platform&apos;s
        secret manager.
      </p>

      <h2>Notes</h2>
      <ul>
        <li>
          The <code>issuer</code> for v2.0 tokens is{" "}
          <code>https://login.microsoftonline.com/&#123;tenantId&#125;/v2.0</code>.
          Multi-tenant apps must validate the <code>tid</code> claim against
          an allowlist rather than relying on the issuer alone.
        </li>
        <li>
          <strong>Don&apos;t validate tokens you don&apos;t own.</strong>{" "}
          Microsoft Graph tokens may not be JWTs and aren&apos;t meant to be
          inspected by your app.
        </li>
        <li>
          Entra ID rotates signing keys regularly, never pin keys, always
          resolve them through the JWKS endpoint.
        </li>
      </ul>

      <p>
        See also <Link href="/docs/auth/aws-cognito">AWS Cognito</Link>,{" "}
        <Link href="/docs/auth/auth0">Auth0</Link>, and the{" "}
        <Link href="/docs/auth">auth integrations overview</Link>.
      </p>
    </>
  );
}
