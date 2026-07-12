import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with AWS Cognito",
  description:
    "Authenticate and authorize requests in a DaloyJS API with Amazon Cognito user pools, using the official aws-jwt-verify library to validate access and ID tokens with JWKS, scopes, and groups.",
  path: "/docs/auth/aws-cognito",
  keywords: [
    "DaloyJS Cognito",
    "aws-jwt-verify",
    "CognitoJwtVerifier",
    "Cognito access token",
    "Cognito scopes",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with AWS Cognito</h1>
      <p>
        <a
          href="https://aws.amazon.com/cognito/"
          target="_blank"
          rel="noreferrer"
        >
          Amazon Cognito
        </a>{" "}
        user pools provide hosted sign-up, sign-in, MFA, and federation. This
        guide verifies the access tokens Cognito issues using the
        AWS-recommended{" "}
        <a
          href="https://github.com/awslabs/aws-jwt-verify"
          target="_blank"
          rel="noreferrer"
        >
          <code>aws-jwt-verify</code>
        </a>{" "}
        library, pure TypeScript, zero runtime dependencies, and edge-runtime
        compatible via Web Crypto.
      </p>

      <SequenceDiagram
        title="Cognito access-token verification"
        participants={[
          "Client app",
          "Cognito (user pool)",
          "DaloyJS API",
          "Cognito JWKS",
        ]}
        steps={[
          {
            from: "Client app",
            to: "Cognito (user pool)",
            label: "Sign in via hosted UI / authorization-code flow",
            detail: "Cognito issues access + ID tokens (RS256)",
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
            to: "Cognito JWKS",
            label: "CognitoJwtVerifier fetches signing keys (cached)",
            detail: "hydrate() pre-warms the JWKS cache",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "DaloyJS API",
            label:
              "Verify signature, tokenUse, clientId, scope & cognito:groups",
            kind: "note",
          },
          {
            from: "DaloyJS API",
            to: "Client app",
            label: "Return protected data after requireAuth passes",
            kind: "response",
          },
        ]}
        caption="The DaloyJS API only verifies the access token Cognito issued. It never sees user passwords, and the JWKS is cached so most requests verify without a network round-trip."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a user pool in the AWS console, then add an{" "}
          <strong>app client</strong>. Note the <strong>User pool ID</strong>{" "}
          (e.g. <code>us-east-1_AbCdEfGhI</code>) and the{" "}
          <strong>App client ID</strong>.
        </li>
        <li>
          Configure a <strong>resource server</strong> with custom scopes (e.g.{" "}
          <code>my-api/read</code>, <code>my-api/write</code>) and authorize
          them on the app client.
        </li>
        <li>
          Enable a hosted UI domain or use the OAuth 2.0 authorization-code flow
          from your client app. Your DaloyJS API only needs to verify the
          resulting access token, it never sees passwords.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add aws-jwt-verify`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
COGNITO_USER_POOL_ID=us-east-1_AbCdEfGhI
COGNITO_CLIENT_ID=1example23456789
COGNITO_REQUIRED_SCOPE=my-api/read`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/cognito.ts
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { App } from "@daloyjs/core";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: "access", // or "id"
  clientId: process.env.COGNITO_CLIENT_ID!,
});

export interface Principal {
  sub: string;
  scopes: string[];
  groups: string[];
  claims: Record<string, unknown>;
}

export const cognitoPlugin = {
  name: "cognito",
  register(app: App) {
    app.decorate("verifier", {
      async verify(token: string): Promise<Principal> {
        const payload = await verifier.verify(token);
        return {
          sub: String(payload.sub),
          scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
          groups: (payload["cognito:groups"] as string[]) ?? [],
          claims: payload as Record<string, unknown>,
        };
      },
    });
    // Pre-fetch the JWKS so the first request isn't slowed by a cold cache
    void verifier.hydrate();
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
        <code>verifier.hydrate()</code> downloads the JWKS up front so the first
        authenticated request doesn&apos;t pay a network round-trip. Subsequent
        key rotations are picked up automatically.
      </p>

      <h2 id="5-guard-a-route">5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { cognitoPlugin } from "./plugins/cognito.ts";
import { requireAuth } from "./plugins/auth.ts"; // from the Overview page

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(cognitoPlugin);

app.get(
  "/me",
  {
    hooks: requireAuth(process.env.COGNITO_REQUIRED_SCOPE!),
    responses: {
      200: {
        description: "OK",
        body: z.object({ sub: z.string(), groups: z.array(z.string()) }),
      },
    },
  },
  ({ state }) => ({
    status: 200,
    body: { sub: state.principal!.sub, groups: state.principal!.groups },
  }),
);`}
      />

      <h2 id="trusting-multiple-pools-or-idps">
        Trusting multiple pools or IdPs
      </h2>
      <p>
        <code>CognitoJwtVerifier.create([...])</code> accepts an array of pool
        configurations to trust JWTs from more than one user pool. To trust a
        Cognito pool <em>and</em> a non-Cognito OIDC IdP, use the generic{" "}
        <code>JwtVerifier</code> with <code>validateCognitoJwtFields</code> in a{" "}
        <code>customJwtCheck</code>.
      </p>

      <h2 id="notes-on-tokens">Notes on tokens</h2>
      <ul>
        <li>
          <strong>Access tokens</strong> carry <code>scope</code>{" "}
          (space-separated string) and <code>cognito:groups</code>: use them for
          API authorization.
        </li>
        <li>
          <strong>ID tokens</strong> carry user attributes (<code>email</code>,{" "}
          <code>name</code>) and an <code>aud</code> claim. Verify them with{" "}
          <code>tokenUse: &quot;id&quot;</code> when your UI needs profile data.
        </li>
        <li>
          Cognito signs with <strong>RS256</strong>. The library refuses{" "}
          <code>alg: none</code> and symmetric algorithms by design.
        </li>
      </ul>

      <p>
        See also <Link href="/docs/auth/entra-id">Entra ID</Link>,{" "}
        <Link href="/docs/auth/auth0">Auth0</Link>, and the{" "}
        <Link href="/docs/auth">auth integrations overview</Link>.
      </p>
    </>
  );
}
