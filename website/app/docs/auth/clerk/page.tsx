import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Protect a DaloyJS API with Clerk",
  description:
    "Authenticate and authorize requests in a DaloyJS API with Clerk. Uses @clerk/backend authenticateRequest() to verify session, OAuth, and machine tokens, with organization and role-aware authorization.",
  path: "/docs/auth/clerk",
  keywords: [
    "DaloyJS Clerk",
    "@clerk/backend",
    "authenticateRequest",
    "Clerk session token",
    "Clerk organizations",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Protect a DaloyJS API with Clerk</h1>
      <p>
        <a href="https://clerk.com" target="_blank" rel="noreferrer">
          Clerk
        </a>{" "}
        is a developer-first auth platform that bundles user management,
        organizations, billing, and embeddable UI components. For a backend API,
        the{" "}
        <a
          href="https://clerk.com/docs/reference/backend/overview"
          target="_blank"
          rel="noreferrer"
        >
          <code>@clerk/backend</code>
        </a>{" "}
        package exposes{" "}
        <a
          href="https://clerk.com/docs/reference/backend/authenticate-request"
          target="_blank"
          rel="noreferrer"
        >
          <code>authenticateRequest()</code>
        </a>
        {", "}which takes a standard <code>Request</code> and returns an{" "}
        <code>Auth</code> object, a perfect fit for DaloyJS&apos;s Web-standard
        handlers.
      </p>

      <SequenceDiagram
        title="Clerk session-token verification"
        participants={["Frontend SDK", "Clerk", "DaloyJS API"]}
        steps={[
          {
            from: "Frontend SDK",
            to: "Clerk",
            label: "User signs in; SDK gets a session token via getToken()",
            kind: "async",
          },
          {
            from: "Frontend SDK",
            to: "DaloyJS API",
            label: "Call API with Authorization: Bearer <session token>",
            kind: "request",
          },
          {
            from: "DaloyJS API",
            to: "Clerk",
            label: "authenticateRequest() verifies the token",
            detail: "networkless when jwtKey is set; otherwise calls Clerk",
            kind: "async",
          },
          {
            from: "DaloyJS API",
            to: "DaloyJS API",
            label: "Check authorizedParties, then read userId, orgId, orgRole",
            kind: "note",
          },
          {
            from: "DaloyJS API",
            to: "Frontend SDK",
            label:
              "Return protected data, or 401 when isAuthenticated is false",
            kind: "response",
          },
        ]}
        caption="With CLERK_JWT_KEY set, authenticateRequest() verifies the token as a pure crypto check with no Clerk API call, which is ideal for edge runtimes. authorizedParties pins the origins allowed to call the API."
      />

      <h2 id="1-set-up-your-clerk-app">1. Set up your Clerk app</h2>
      <ol>
        <li>
          Create an application in the{" "}
          <a
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
          >
            Clerk dashboard
          </a>
          {". "}From <strong>API Keys</strong>
          {", "}copy the <strong>Publishable Key</strong> and{" "}
          <strong>Secret Key</strong>
          {". "}
          Optionally copy the <strong>JWT Public Key (PEM)</strong> for
          networkless verification.
        </li>
        <li>
          Your frontend (Clerk&apos;s React, Next.js, Expo, or vanilla JS SDK)
          obtains a session token via <code>getToken()</code> and sends it in
          the <code>Authorization: Bearer &lt;token&gt;</code> header to your
          DaloyJS API.
        </li>
        <li>
          For machine-to-machine calls, create an <strong>M2M token</strong> or
          use Clerk&apos;s OAuth applications and accept{" "}
          <code>oauth_token</code> / <code>m2m_token</code> in the verifier.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @clerk/backend`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional - enables networkless JWT verification (no Clerk API call per request)
# Get it from API Keys -> Show JWT public key -> PEM Public Key
CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/clerk.ts
import { createClerkClient } from "@clerk/backend";
import { UnauthorizedError, type App, type Hooks } from "@daloyjs/core";

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
  jwtKey: process.env.CLERK_JWT_KEY, // optional: enables networkless verification
});

export interface Principal {
  userId: string;
  sessionId: string | null;
  orgId: string | null;
  orgRole: string | null;
  tokenType: string;
}

export const clerkPlugin = {
  name: "clerk",
  register(app: App) {
    app.decorate("clerk", clerk);
  },
};

type ClerkTokenType = "session_token" | "oauth_token" | "m2m_token" | "api_key";

export function requireClerkAuth(opts?: {
  acceptsToken?: ClerkTokenType | ClerkTokenType[] | "any";
  authorizedParties?: string[];
}): Hooks {
  const acceptsToken = opts?.acceptsToken ?? "session_token";
  return {
    preBody: async (ctx) => {
      const result = await ctx.state.clerk.authenticateRequest(ctx.request, {
        acceptsToken,
        authorizedParties: opts?.authorizedParties,
      });
      if (!result.isAuthenticated) {
        throw new UnauthorizedError(result.message ?? "Unauthorized");
      }
      const auth = result.toAuth();
      ctx.state.principal = {
        userId: (auth as { userId?: string }).userId ?? "",
        sessionId: (auth as { sessionId?: string | null }).sessionId ?? null,
        orgId: (auth as { orgId?: string | null }).orgId ?? null,
        orgRole: (auth as { orgRole?: string | null }).orgRole ?? null,
        tokenType: result.tokenType,
      };
      // continue
    },
  };
}

declare module "@daloyjs/core" {
  interface AppState {
    clerk: ReturnType<typeof createClerkClient>;
    principal?: Principal;
  }
}`}
      />
      <p>
        Setting{" "}
        <strong>
          <code>authorizedParties</code>
        </strong>{" "}
        is strongly recommended, it pins the origins allowed to make requests
        and protects against the subdomain-cookie-leaking attack described in
        Clerk&apos;s docs. Setting <code>jwtKey</code> turns verification into a
        pure crypto check (no network), which is ideal for edge runtimes.
      </p>

      <h2 id="5-guard-a-route">5. Guard a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { clerkPlugin, requireClerkAuth } from "./plugins/clerk.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.register(clerkPlugin);

app.get(
  "/me",
  {
    hooks: requireClerkAuth({ authorizedParties: ["https://acme.example.com"] }),
    responses: {
      200: {
        description: "OK",
        body: z.object({
          userId: z.string(),
          orgId: z.string().nullable(),
          orgRole: z.string().nullable(),
        }),
      },
    },
  },
  ({ state }) => ({
    status: 200,
    body: {
      userId: state.principal!.userId,
      orgId: state.principal!.orgId,
      orgRole: state.principal!.orgRole,
    },
  }),
);`}
      />

      <h2 id="organizations-and-role-checks">
        Organizations &amp; role checks
      </h2>
      <p>
        Clerk&apos;s <code>Auth</code> object includes the active{" "}
        <code>orgId</code>
        {", "}
        <code>orgSlug</code>
        {", "}
        <code>orgRole</code> (e.g. <code>org:admin</code>), and{" "}
        <code>orgPermissions</code>
        {". "}Add a thin helper to require a role on top of{" "}
        <code>requireClerkAuth</code>
        {": "}
      </p>
      <CodeBlock
        code={`import { every, ForbiddenError, type Hooks } from "@daloyjs/core";

export function requireOrgRole(role: string): Hooks {
  return {
    preBody: (ctx) => {
      if (ctx.state.principal?.orgRole !== role) {
        throw new ForbiddenError(\`Requires \${role}\`);
      }
      // continue
    },
  };
}

// Usage:
hooks: every(
  requireClerkAuth(),
  requireOrgRole("org:admin"),
),`}
      />

      <h2 id="machine-to-machine-authentication">
        Machine-to-machine authentication
      </h2>
      <p>
        Set <code>acceptsToken</code> to <code>&quot;m2m_token&quot;</code>
        {", "}
        <code>&quot;oauth_token&quot;</code>
        {", "}or an array like{" "}
        <code>[&quot;session_token&quot;, &quot;m2m_token&quot;]</code> to
        accept multiple token kinds. The returned <code>tokenType</code> lets
        you branch your business logic per caller type.
      </p>

      <h2 id="webhooks">Webhooks</h2>
      <p>
        Clerk delivers user, organization, and session events via Svix-signed
        webhooks. Use <code>clerk.verifyWebhook(request)</code> to validate the
        signature before processing the payload, never trust an unverified
        webhook body.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        <code>@clerk/backend</code> is built on the Web <code>Request</code> and{" "}
        <code>fetch</code> APIs, so it runs everywhere DaloyJS does: Node.js,
        Bun, Deno, AWS Lambda, Vercel (Serverless and Edge), and Cloudflare
        Workers. Pair it with the{" "}
        <Link href="/docs/adapters">edge adapters</Link>.
      </p>

      <p>
        See also <Link href="/docs/auth/auth0">Auth0</Link>
        {", "}
        <Link href="/docs/auth/aws-cognito">AWS Cognito</Link>
        {", "}and the <Link href="/docs/auth">auth integrations overview</Link>
        {"."}
      </p>
    </>
  );
}
