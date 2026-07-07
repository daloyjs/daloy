import Link from "next/link";
import type { Route } from "next";

import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Authentication & authorization for DaloyJS",
  description:
    "Protect a DaloyJS API with authentication and authorization from AWS Cognito, Microsoft Entra ID (MSAL), Auth0, Okta, Clerk, LoginRadius, or Better Auth. Compares SDKs, runtime support, and the common bearer-auth plugin pattern.",
  path: "/docs/auth",
  keywords: [
    "DaloyJS authentication",
    "DaloyJS authorization",
    "AWS Cognito DaloyJS",
    "Entra ID DaloyJS",
    "Auth0 DaloyJS",
    "Okta DaloyJS",
    "Clerk DaloyJS",
    "LoginRadius DaloyJS",
    "Better Auth DaloyJS",
    "JWT bearer auth",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Authentication &amp; authorization</h1>
      <p>
        DaloyJS doesn&apos;t bundle a user database or login UI, instead, it
        ships primitives that make it easy to plug in a hosted identity provider
        (IdP). Your API receives a bearer token, verifies it with the
        provider&apos;s JWKS or SDK, and gates routes by scope, role, or
        organization. The pages in this section show how to wire up the seven
        most common IdPs.
      </p>
      <p>
        New to this? Start with{" "}
        <Link href={"/docs/auth/architecture" as Route}>
          Auth architecture: where DaloyJS fits in OAuth2 &amp; OpenID Connect
        </Link>
        . It explains why DaloyJS is a <strong>resource server</strong> (it
        verifies tokens, it does not issue them), how that compares to .NET and
        Duende IdentityServer, whether you actually need Auth0/Okta/Clerk or can
        self-host an open-source IdP, and the two architectures we recommend.
      </p>

      <h2 id="supported-providers">Supported providers</h2>
      <ul>
        <li>
          <Link href="/docs/auth/aws-cognito">AWS Cognito</Link>: pay-as-you-go
          user pools with hosted sign-in. Use <code>aws-jwt-verify</code> to
          verify access and ID tokens with zero runtime dependencies; runs on
          Node, edge, and Lambda.
        </li>
        <li>
          <Link href="/docs/auth/entra-id">Microsoft Entra ID (MSAL)</Link>:
          enterprise SSO for Microsoft 365 / Azure AD users. Verify tokens with
          the OIDC JWKS using <code>jose</code>; acquire downstream tokens with{" "}
          <code>@azure/msal-node</code> when needed.
        </li>
        <li>
          <Link href="/docs/auth/auth0">Auth0</Link>: developer-friendly IdP
          with universal login, MFA, and rich rule engine. Verify access tokens
          with <code>jose</code> against your tenant&apos;s issuer URL.
        </li>
        <li>
          <Link href="/docs/auth/okta">Okta</Link>: workforce identity with
          custom authorization servers and granular policies. Use the official{" "}
          <code>@okta/jwt-verifier</code> for access and ID tokens.
        </li>
        <li>
          <Link href="/docs/auth/clerk">Clerk</Link>: modern, embeddable
          authentication with user, organization, and billing primitives. Use{" "}
          <code>@clerk/backend</code> <code>authenticateRequest()</code> to
          authenticate any <code>Request</code>.
        </li>
        <li>
          <Link href={"/docs/auth/loginradius" as Route}>LoginRadius</Link>:
          customer identity, social login, registration, and profile APIs. Use{" "}
          <code>loginradius-sdk</code> to validate LoginRadius access tokens and
          load profiles from a Node-style DaloyJS runtime.
        </li>
        <li>
          <Link href={"/docs/auth/better-auth" as Route}>Better Auth</Link>:
          self-hosted authentication for email/password, OAuth, sessions, and
          plugins. Mount its standard <code>Request → Response</code> handler
          under DaloyJS and guard API routes with{" "}
          <code>auth.api.getSession()</code>.
        </li>
      </ul>

      <BranchDiagram
        title="One resource server, many identity providers"
        source={{
          label: "DaloyJS API (resource server)",
          detail: "verifies the bearer token, gates routes by scope/role",
          eyebrow: "your code",
          tone: "accent",
        }}
        branches={[
          { label: "AWS Cognito", detail: "aws-jwt-verify" },
          { label: "Microsoft Entra ID", detail: "jose + OIDC JWKS" },
          { label: "Auth0", detail: "jose" },
          { label: "Okta", detail: "@okta/jwt-verifier" },
          { label: "Clerk", detail: "@clerk/backend" },
          { label: "LoginRadius", detail: "loginradius-sdk" },
          { label: "Better Auth", detail: "auth.handler + getSession" },
        ]}
        caption="DaloyJS stays the resource server in every case. Each provider page swaps only the verifier SDK behind the same TokenVerifier interface, so the rest of your app stays IdP-agnostic."
      />

      <h2 id="runtime-compatibility-at-a-glance">Runtime compatibility at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Node / Bun / Deno</th>
            <th>Cloudflare Workers</th>
            <th>AWS Lambda</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              AWS Cognito (<code>aws-jwt-verify</code>)
            </td>
            <td>Yes</td>
            <td>Yes (Web Crypto)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              Entra ID (<code>jose</code>)
            </td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              Auth0 (<code>jose</code>)
            </td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              Okta (<code>@okta/jwt-verifier</code>)
            </td>
            <td>Yes</td>
            <td>No (Node-only)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              Clerk (<code>@clerk/backend</code>)
            </td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              LoginRadius (<code>loginradius-sdk</code>)
            </td>
            <td>Yes (Node-style)</td>
            <td>No</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>
              Better Auth (<code>better-auth</code>)
            </td>
            <td>Yes</td>
            <td>Depends on database adapter</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>

      <h2 id="common-pattern">Common pattern</h2>
      <p>
        Each provider page implements the same three steps: install the verifier
        SDK, register a DaloyJS plugin that decorates the request context with
        an <code>auth</code> object, then guard routes with a small middleware
        that requires a token (and optional scopes).
      </p>
      <FlowDiagram
        numbered
        title="The same three steps on every provider page"
        steps={[
          {
            label: "Install the verifier SDK",
            detail: "pnpm add <provider-sdk>",
          },
          {
            label: "Register an auth plugin",
            detail: "decorates ctx with a verifier",
          },
          {
            label: "Guard routes",
            detail: "requireAuth(...scopes)",
            tone: "accent",
          },
        ]}
        caption="Every provider page follows this shape. Only the verifier SDK in step 1 changes; steps 2 and 3 stay the same across IdPs."
      />
      <pre>
        <code>{`// src/plugins/auth.ts
import type { App, Middleware } from "@daloyjs/core";

export interface Principal {
  sub: string;
  scopes?: string[];
  claims: Record<string, unknown>;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export function authPlugin(verifier: TokenVerifier) {
  return {
    name: "auth",
    register(app: App) {
      app.decorate("verifier", verifier);
    },
  };
}

export function requireAuth(...requiredScopes: string[]): Middleware {
  return async (ctx, next) => {
    const header = ctx.request.headers.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return ctx.problem(401, "unauthorized", "Missing bearer token");
    }
    try {
      const principal = await ctx.state.verifier.verify(token);
      if (requiredScopes.length) {
        const scopes = principal.scopes ?? [];
        const ok = requiredScopes.every((s) => scopes.includes(s));
        if (!ok) return ctx.problem(403, "forbidden", "Insufficient scope");
      }
      ctx.state.principal = principal;
      return next();
    } catch {
      return ctx.problem(401, "unauthorized", "Invalid or expired token");
    }
  };
}

declare module "@daloyjs/core" {
  interface AppState {
    verifier: TokenVerifier;
    principal?: Principal;
  }
}`}</code>
      </pre>
      <p>
        Each provider page implements <code>TokenVerifier</code> with the
        official SDK so the rest of your application stays IdP-agnostic.
      </p>

      <h2 id="security-checklist">Security checklist</h2>
      <ul>
        <li>
          <strong>Always verify the signature.</strong> Never trust an
          unverified JWT, decode-only utilities are for debugging. Use the
          provider&apos;s JWKS endpoint with key caching and automatic rotation
          (every SDK on the following pages handles this).
        </li>
        <li>
          <strong>
            Check <code>iss</code> and <code>aud</code>.
          </strong>{" "}
          Pin the expected issuer URL and audience/client ID. A correct
          signature on the wrong audience is still a token confusion attack.
        </li>
        <li>
          <strong>Authorize, don&apos;t just authenticate.</strong> A valid
          token only proves the caller is who they say they are. Enforce scopes,
          roles, or organization membership for every privileged action.
        </li>
        <li>
          <strong>Use TLS everywhere.</strong> Bearer tokens are
          plaintext-equivalent. Require HTTPS and set the{" "}
          <Link href="/docs/security">
            <code>secureHeaders</code>
          </Link>{" "}
          middleware (<code>Strict-Transport-Security</code>).
        </li>
        <li>
          <strong>Rate-limit token-issuing routes.</strong> Login redirects,
          token-exchange endpoints, and any introspection passthroughs should go
          through{" "}
          <Link href="/docs/security">
            <code>rateLimit</code>
          </Link>{" "}
          (or the{" "}
          <Link href="/docs/security/rate-limit-redis">Redis store</Link>) so
          abuse can&apos;t drive cost or lock out users.
        </li>
        <li>
          <strong>Protect cookies and CSRF.</strong> If you also use session
          cookies (for an admin panel, say), enable{" "}
          <Link href="/docs/security/csrf">CSRF</Link> and use{" "}
          <code>SameSite=Lax</code> + <code>Secure</code> +{" "}
          <code>HttpOnly</code> via the built-in{" "}
          <Link href="/docs/security/session">session middleware</Link>.
        </li>
      </ul>
    </>
  );
}
