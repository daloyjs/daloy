import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with Okta",
  description:
    "Authenticate and authorize requests in a DaloyJS API with Okta. Uses the official @okta/jwt-verifier to validate access and ID tokens from an Okta Custom Authorization Server, with scope and claim assertions.",
  path: "/docs/auth/okta",
  keywords: [
    "DaloyJS Okta",
    "@okta/jwt-verifier",
    "Okta access token",
    "Okta authorization server",
    "Okta scopes",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with Okta</h1>
      <p>
        <a href="https://developer.okta.com" target="_blank" rel="noreferrer">
          Okta
        </a>{" "}
        provides workforce and customer identity with granular policies and
        the API Access Management add-on for issuing custom-scoped access
        tokens. This guide uses the official{" "}
        <a
          href="https://github.com/okta/okta-jwt-verifier-js"
          target="_blank"
          rel="noreferrer"
        >
          <code>@okta/jwt-verifier</code>
        </a>{" "}
        package (4.x, stable) to validate tokens from a Custom Authorization
        Server.
      </p>

      <SequenceDiagram
        title="Okta access-token verification"
        participants={[
          "Client app",
          "Okta Custom Auth Server",
          "DaloyJS API",
          "Okta JWKS",
        ]}
        steps={[
          {
            from: "Client app",
            to: "Okta Custom Auth Server",
            label: "User signs in; Okta issues a scoped access token (RS256)",
            detail: "iss = https://{domain}/oauth2/{asId}",
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
            to: "Okta JWKS",
            label: "OktaJwtVerifier fetches signing keys (cached 1h)",
            detail: "jwksRequestsPerMinute throttles fetches",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "DaloyJS API",
            label: "verifyAccessToken checks issuer, audience, scp & assertClaims",
            kind: "note",
          },
          {
            from: "DaloyJS API",
            to: "Client app",
            label: "Return protected data after requireAuth passes",
            kind: "response",
          },
        ]}
        caption="Only tokens from a Custom Authorization Server are meant to be verified by your app. The Org Authorization Server issues opaque tokens that you introspect instead, never verify locally."
      />

      <h2>1. Configure an Okta Authorization Server</h2>
      <ol>
        <li>
          In the Okta admin console, go to <strong>Security → API →
          Authorization Servers</strong>. Use the built-in <code>default</code>{" "}
          server or create a new Custom Authorization Server (requires the API
          Access Management license).
        </li>
        <li>
          Add <strong>scopes</strong> (e.g. <code>items:read</code>,{" "}
          <code>items:write</code>) and an <strong>access policy</strong> that
          allows your client app to request them.
        </li>
        <li>
          Note the <strong>Issuer URI</strong> (e.g.{" "}
          <code>https://dev-12345.okta.com/oauth2/default</code>) and the
          client&apos;s <strong>Client ID</strong>.
        </li>
      </ol>

      <h2>2. Install</h2>
      <CodeBlock code={`pnpm add @okta/jwt-verifier`} />

      <h2>3. Environment variables</h2>
      <CodeBlock
        code={`# .env
OKTA_ISSUER=https://dev-12345.okta.com/oauth2/default
OKTA_CLIENT_ID=0oa1example2345
OKTA_AUDIENCE=api://default
OKTA_REQUIRED_SCOPE=items:read`}
      />

      <h2>4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/okta.ts
import OktaJwtVerifier from "@okta/jwt-verifier";
import type { App } from "@daloyjs/core";

const verifier = new OktaJwtVerifier({
  issuer: process.env.OKTA_ISSUER!,
  clientId: process.env.OKTA_CLIENT_ID,
  // Defaults shown for transparency:
  cacheMaxAge: 60 * 60 * 1000, // 1 hour
  jwksRequestsPerMinute: 10,
});

export interface Principal {
  sub: string;
  scopes: string[];
  groups: string[];
  claims: Record<string, unknown>;
}

const expectedAudience = process.env.OKTA_AUDIENCE!;

export const oktaPlugin = {
  name: "okta",
  register(app: App) {
    app.decorate("verifier", {
      async verify(token: string): Promise<Principal> {
        const { claims } = await verifier.verifyAccessToken(token, expectedAudience);
        const scopes = Array.isArray(claims.scp)
          ? (claims.scp as string[])
          : typeof claims.scp === "string"
            ? (claims.scp as string).split(" ")
            : [];
        const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];
        return { sub: String(claims.sub), scopes, groups, claims };
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

      <h2>5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { oktaPlugin } from "./plugins/okta";
import { requireAuth } from "./plugins/auth"; // from the Overview page

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(oktaPlugin);

app.route({
  method: "GET",
  path: "/items",
  operationId: "listItems",
  middleware: [requireAuth(process.env.OKTA_REQUIRED_SCOPE!)],
  responses: {
    200: { description: "OK", body: z.object({ user: z.string() }) },
  },
  handler: ({ state }) => ({ status: 200, body: { user: state.principal!.sub } }),
});`}
      />

      <h2>Custom claim assertions</h2>
      <p>
        The verifier can enforce extra claims at construction time. For
        example, to require that the token includes both{" "}
        <code>items:read</code> and <code>items:write</code> in the
        space-separated <code>scp</code> claim:
      </p>
      <CodeBlock
        code={`const verifier = new OktaJwtVerifier({
  issuer: process.env.OKTA_ISSUER!,
  clientId: process.env.OKTA_CLIENT_ID,
  assertClaims: {
    "scp.includes": ["items:read", "items:write"],
    "groups.includes": ["Engineering"],
  },
});`}
      />

      <h2>Verifying ID tokens</h2>
      <p>
        Use <code>verifyIdToken(token, expectedClientId, expectedNonce?)</code>{" "}
        if your client also sends ID tokens (for example, to populate a user
        profile). Pass the nonce only when the original auth request included
        one.
      </p>

      <h2>Custom JWKS URI</h2>
      <p>
        When the JWKS isn&apos;t under the issuer (e.g. you front Okta with a
        proxy), pass <code>jwksUri</code> explicitly:
      </p>
      <CodeBlock
        code={`const verifier = new OktaJwtVerifier({
  issuer: process.env.OKTA_ISSUER!,
  clientId: process.env.OKTA_CLIENT_ID,
  jwksUri: "https://dev-12345.okta.com/oauth2/v1/keys",
});`}
      />

      <h2>Runtimes</h2>
      <p>
        <code>@okta/jwt-verifier</code> is a <strong>Node-only</strong>{" "}
        library (it imports Node modules transitively). For Node, Bun, and AWS
        Lambda it works out of the box; for <Link href="/docs/adapters">Cloudflare
        Workers</Link> or <Link href="/docs/adapters">Vercel Edge</Link>, use{" "}
        <code>jose</code>&apos;s <code>createRemoteJWKSet</code> +{" "}
        <code>jwtVerify</code> against the same issuer (the{" "}
        <Link href="/docs/auth/auth0">Auth0</Link> page shows that exact
        pattern, only the issuer URL changes).
      </p>

      <h2>Org server vs Custom Authorization Server</h2>
      <p>
        Only tokens from a <strong>Custom Authorization Server</strong> are
        meant to be verified by your app, those issuers look like{" "}
        <code>https://&#123;domain&#125;/oauth2/&#123;asId&#125;</code>. The
        Org Authorization Server (<code>https://&#123;domain&#125;</code>)
        issues opaque tokens that only Okta should consume; validate those via
        the <code>/introspect</code> endpoint instead.
      </p>

      <p>
        See also <Link href="/docs/auth/auth0">Auth0</Link>,{" "}
        <Link href="/docs/auth/clerk">Clerk</Link>, and the{" "}
        <Link href="/docs/auth">auth integrations overview</Link>.
      </p>
    </>
  );
}
