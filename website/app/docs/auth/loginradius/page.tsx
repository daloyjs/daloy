import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with LoginRadius",
  description:
    "Authenticate and authorize requests in a DaloyJS API with LoginRadius. Uses loginradius-sdk to validate access tokens, load user profiles, and protect Node-style DaloyJS routes.",
  path: "/docs/auth/loginradius",
  keywords: [
    "DaloyJS LoginRadius",
    "loginradius-sdk",
    "LoginRadius Node SDK",
    "LoginRadius access token",
    "LoginRadius Customer Identity",
    "LoginRadius social login",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with LoginRadius</h1>
      <p>
        <a href="https://www.loginradius.com" target="_blank" rel="noreferrer">
          LoginRadius
        </a>{" "}
        is a customer identity platform for hosted login, social login,
        registration, user profiles, and account-management flows. Its official{" "}
        <a
          href="https://github.com/LoginRadius/node-js-sdk"
          target="_blank"
          rel="noreferrer"
        >
          <code>loginradius-sdk</code>
        </a>{" "}
        wraps the LoginRadius V2 APIs for Node.js. In a DaloyJS API, use it as a
        server-side verifier for LoginRadius access tokens and as a profile API
        client.
      </p>

      <SequenceDiagram
        title="LoginRadius access-token validation"
        participants={["Client app", "LoginRadius", "DaloyJS API"]}
        steps={[
          {
            from: "Client app",
            to: "LoginRadius",
            label: "Hosted login, social login, or registration flow",
            detail: "LoginRadius issues an access token",
            kind: "async",
          },
          {
            from: "Client app",
            to: "DaloyJS API",
            label: "Authorization: Bearer <access token>",
            kind: "request",
          },
          {
            from: "DaloyJS API",
            to: "LoginRadius",
            label: "authValidateAccessToken(accessToken)",
            detail: "server-side SDK call",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "LoginRadius",
            label: "getProfileByAccessToken(accessToken)",
            detail: "optional profile lookup",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "Client app",
            label: "401 on invalid token, protected data on success",
            kind: "response",
          },
        ]}
        caption="LoginRadius access tokens are validated through the provider API via the Node SDK. This is different from the JWT/JWKS provider pages, where verification is local after the signing keys are cached."
      />

      <h2 id="1-configure-loginradius">1. Configure LoginRadius</h2>
      <ol>
        <li>
          In the LoginRadius Admin Console, copy your <strong>API Key</strong>,{" "}
          <strong>API Secret</strong>, and <strong>Site Name</strong>.
        </li>
        <li>
          Configure your hosted login, social login, registration, and callback
          URLs in LoginRadius. The frontend owns the login flow and sends the
          resulting access token to your DaloyJS API.
        </li>
        <li>
          Keep the API secret on the server only. Never expose it in browser,
          mobile, or generated client code.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add loginradius-sdk`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
LOGINRADIUS_API_DOMAIN=api.loginradius.com
LOGINRADIUS_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LOGINRADIUS_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LOGINRADIUS_SITE_NAME=acme
LOGINRADIUS_API_REQUEST_SIGNING=false`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <p>
        The SDK is CommonJS and does not ship first-class TypeScript types, so
        wrap only the methods your app needs behind a small typed boundary.
      </p>
      <CodeBlock
        code={`// src/plugins/loginradius.ts
import { createRequire } from "node:module";
import type { App } from "@daloyjs/core";

const require = createRequire(import.meta.url);

type LoginRadiusProfile = {
  Uid?: string;
  ID?: string;
  Email?: Array<{ Value?: string; Type?: string }>;
  Roles?: string[];
  [claim: string]: unknown;
};

type LoginRadiusAccessTokenInfo = {
  access_token?: string;
  expires_in?: number;
  [claim: string]: unknown;
};

type LoginRadiusClient = {
  authenticationApi: {
    authValidateAccessToken(token: string): Promise<LoginRadiusAccessTokenInfo>;
    getProfileByAccessToken(
      token: string,
      emailTemplate?: string | null,
      fields?: string | null,
      verificationUrl?: string | null,
      welcomeEmailTemplate?: string | null,
    ): Promise<LoginRadiusProfile>;
  };
};

const createLoginRadiusClient = require("loginradius-sdk") as (
  config: Record<string, unknown>,
) => LoginRadiusClient;

const loginRadius = createLoginRadiusClient({
  apiDomain: process.env.LOGINRADIUS_API_DOMAIN ?? "api.loginradius.com",
  apiKey: process.env.LOGINRADIUS_API_KEY!,
  apiSecret: process.env.LOGINRADIUS_API_SECRET!,
  siteName: process.env.LOGINRADIUS_SITE_NAME!,
  apiRequestSigning: process.env.LOGINRADIUS_API_REQUEST_SIGNING === "true",
});

export interface Principal {
  sub: string;
  email?: string;
  roles: string[];
  tokenInfo: LoginRadiusAccessTokenInfo;
  profile: LoginRadiusProfile;
}

export const loginRadiusPlugin = {
  name: "loginradius",
  register(app: App) {
    app.decorate("verifier", {
      async verify(token: string): Promise<Principal> {
        const tokenInfo =
          await loginRadius.authenticationApi.authValidateAccessToken(token);
        const profile =
          await loginRadius.authenticationApi.getProfileByAccessToken(token);
        const primaryEmail = profile.Email?.find((email) => email.Value)?.Value;
        return {
          sub: String(profile.Uid ?? profile.ID ?? tokenInfo.access_token),
          email: primaryEmail,
          roles: Array.isArray(profile.Roles) ? profile.Roles : [],
          tokenInfo,
          profile,
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

      <h2 id="5-guard-a-route">5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { loginRadiusPlugin } from "./plugins/loginradius";
import { requireAuth } from "./plugins/auth"; // from the Overview page

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(loginRadiusPlugin);

app.route({
  method: "GET",
  path: "/me",
  operationId: "getMe",
  middleware: [requireAuth()],
  responses: {
    200: {
      description: "OK",
      body: z.object({
        userId: z.string(),
        email: z.string().optional(),
      }),
    },
  },
  handler: ({ state }) => ({
    status: 200,
    body: {
      userId: state.principal!.sub,
      email: state.principal!.email,
    },
  }),
});`}
      />

      <h2 id="role-checks">Role checks</h2>
      <p>
        LoginRadius profile shape depends on your account configuration and
        selected fields. If your site stores roles or authorization flags in the
        profile, normalize them in the plugin and enforce them with a narrow
        middleware:
      </p>
      <CodeBlock
        code={`import type { Middleware } from "@daloyjs/core";

export function requireLoginRadiusRole(role: string): Middleware {
  return async (ctx, next) => {
    if (!ctx.state.principal?.roles.includes(role)) {
      return ctx.problem(403, "forbidden", \`Requires \${role}\`);
    }
    return next();
  };
}`}
      />

      <h2 id="registration-and-account-apis">Registration and account APIs</h2>
      <p>
        The SDK also wraps registration, password reset, email verification,
        access-token invalidation, account lookup, and custom-object APIs. Keep
        those operations in server-side routes, validate every input with your
        schema library, and return DaloyJS problem+json errors instead of raw
        SDK error objects.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        <code>loginradius-sdk</code> is a Node-style CommonJS SDK. Use it on the{" "}
        <Link href="/docs/adapters/node">Node adapter</Link>, Bun when your
        deployment supports CommonJS packages, Vercel Node functions, and AWS
        Lambda. It is not a fit for Cloudflare Workers or Vercel Edge. For edge
        APIs, put LoginRadius validation behind a small Node service or use
        direct HTTP calls from a runtime that can safely keep server secrets.
      </p>

      <h2 id="security-notes">Security notes</h2>
      <ul>
        <li>
          Treat the LoginRadius API secret like a signing key. Store it in your
          platform secret manager and never send it to clients.
        </li>
        <li>
          Validate the access token on every protected API request, or cache
          positive validation results only for a short period bounded by token
          expiry.
        </li>
        <li>
          Use <code>rateLimit()</code> on login, registration, password reset,
          and token-validation routes. Identity endpoints are high-value abuse
          targets.
        </li>
        <li>
          Do not trust user profile fields as authorization policy until your
          backend has normalized them into explicit roles, scopes, or tenant
          memberships.
        </li>
      </ul>

      <p>
        See also the <Link href="/docs/auth">auth integrations overview</Link>,{" "}
        <Link href="/docs/auth/auth0">Auth0</Link>, and{" "}
        <Link href="/docs/auth/clerk">Clerk</Link>.
      </p>
    </>
  );
}
