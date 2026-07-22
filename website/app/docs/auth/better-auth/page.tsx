import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Better Auth with DaloyJS",
  description:
    "Use Better Auth with a DaloyJS API. Mount Better Auth's standard Request to Response handler, configure trusted origins and cookies, and protect DaloyJS routes with auth.api.getSession().",
  path: "/docs/auth/better-auth",
  keywords: [
    "DaloyJS Better Auth",
    "Better Auth DaloyJS",
    "better-auth",
    "auth.handler",
    "auth.api.getSession",
    "Better Auth Hono",
    "Better Auth Elysia",
    "Better Auth Fastify",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Better Auth with DaloyJS</h1>
      <p>
        <a href="https://better-auth.com" target="_blank" rel="noreferrer">
          Better Auth
        </a>{" "}
        is a TypeScript authentication framework you host in your own
        application. Unlike Auth0, Okta, Clerk, or LoginRadius, it is not only a
        hosted identity provider integration. Your app owns the auth tables, the
        session cookies, and the auth endpoints.
      </p>
      <p>
        Better Auth already documents Hono, Elysia, and Fastify adapters.
        DaloyJS does not need a special adapter because both libraries meet at
        the Web-standard boundary: Better Auth exposes{" "}
        <code>auth.handler(request)</code>
        and DaloyJS gives every route and hook the original <code>Request</code>
        {"."}
      </p>

      <SequenceDiagram
        title="Better Auth inside a DaloyJS app"
        participants={["Browser", "DaloyJS", "Better Auth", "Database"]}
        steps={[
          {
            from: "Browser",
            to: "DaloyJS",
            label: "POST /api/auth/sign-in/email",
            detail: "credentials, OAuth callbacks, session actions",
            kind: "request",
          },
          {
            from: "DaloyJS",
            to: "Better Auth",
            label: "auth.handler(request)",
            detail: "mounted under /api/auth/*",
            kind: "async",
          },
          {
            from: "Better Auth",
            to: "Database",
            label: "users, accounts, sessions",
            kind: "async",
          },
          {
            from: "Better Auth",
            to: "Browser",
            label: "Response with Set-Cookie",
            kind: "response",
          },
          {
            from: "Browser",
            to: "DaloyJS",
            label: "GET /me with session cookie",
            kind: "request",
          },
          {
            from: "DaloyJS",
            to: "Better Auth",
            label: "auth.api.getSession({ headers })",
            kind: "async",
          },
        ]}
        caption="The auth endpoints are Better Auth's own Request to Response handler. Normal DaloyJS API routes read the current session from request headers and enforce application authorization."
      />

      <h2 id="1-install">1. Install</h2>
      <CodeBlock code={`pnpm add better-auth`} />

      <h2 id="2-create-the-auth-instance">2. Create the auth instance</h2>
      <p>
        Configure Better Auth once and export the instance. Use the database
        adapter that matches your app. The example below keeps the database
        placeholder explicit because production apps should not copy a toy
        in-memory store into auth.
      </p>
      <CodeBlock
        code={`// src/auth.ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL!,
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: [
    "http://localhost:3000",
    "https://app.example.com",
  ],
  emailAndPassword: {
    enabled: true,
  },
  // Pick the adapter for your database:
  // database: prismaAdapter(prisma, { provider: "postgresql" }),
  // database: drizzleAdapter(db, { provider: "pg" }),
});`}
      />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-at-least-32-random-bytes`}
      />

      <h2 id="4-mount-better-auth-routes">4. Mount Better Auth routes</h2>
      <p>
        Better Auth owns all routes below <code>/api/auth/*</code>
        {". "}Return the raw <code>Response</code> from a <code>preBody</code>{" "}
        hook so cookies, redirects, status codes, and multiple{" "}
        <code>Set-Cookie</code> headers are preserved exactly.{" "}
        <code>preBody</code> runs after routing but before any body I/O, which
        is the right place to delegate to another web-standard{" "}
        <code>Request -&gt; Response</code> handler. Because Better Auth owns
        the successful response body, cookies, and redirects, both routes
        explicitly set <code>acknowledgeNoResponseBodySchema: true</code>
        {"."}
      </p>
      <CodeBlock
        code={`// src/routes/auth.ts
import { App } from "@daloyjs/core";
import { auth } from "../auth.ts";

const app = new App();

const betterAuthHook = {
  preBody: ({ request }: { request: Request }) => auth.handler(request),
};

app.get(
  "/api/auth/*path",
  {
    operationId: "betterAuthGet",
    summary: "Better Auth GET endpoint",
    // Better Auth owns serialization, cookies, and redirects for this route.
    acknowledgeNoResponseBodySchema: true,
    responses: {
      200: { description: "Handled by Better Auth" },
      302: { description: "Redirect" },
      400: { description: "Bad Request" },
      401: { description: "Unauthorized" },
    },
    hooks: betterAuthHook,
  },
  () => ({ status: 200, body: null }),
);

app.post(
  "/api/auth/*path",
  {
    operationId: "betterAuthPost",
    summary: "Better Auth POST endpoint",
    acknowledgeNoResponseBodySchema: true,
    responses: {
      200: { description: "Handled by Better Auth" },
      201: { description: "Created" },
      204: { description: "No Content" },
      400: { description: "Bad Request" },
      401: { description: "Unauthorized" },
    },
    hooks: betterAuthHook,
  },
  () => ({ status: 200, body: null }),
);`}
      />

      <h2 id="5-protect-daloyjs-routes">5. Protect DaloyJS routes</h2>
      <p>
        Use <code>auth.api.getSession(&#123; headers &#125;)</code> inside a
        <code>preBody</code> guard. Because it only reads headers (no body
        parsing needed), it runs in the cheapest-rejection phase before
        validated context is built. This keeps normal DaloyJS routes
        contract-first while Better Auth owns the session lookup.
      </p>
      <CodeBlock
        code={`// src/plugins/better-auth.ts
import { UnauthorizedError, type Hooks } from "@daloyjs/core";
import { auth } from "../auth.ts";

export type BetterAuthSession = Awaited<
  ReturnType<typeof auth.api.getSession>
>;

export function requireBetterAuth(): Hooks {
  return {
    preBody: async (ctx) => {
      const session = await auth.api.getSession({
        headers: ctx.request.headers,
      });

      if (!session) {
        throw new UnauthorizedError("Missing or expired session");
      }

      ctx.state.session = session;
      // return undefined (or nothing) to continue to the handler
    },
  };
}

declare module "@daloyjs/core" {
  interface AppState {
    session?: NonNullable<BetterAuthSession>;
  }
}`}
      />
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { requireBetterAuth } from "./plugins/better-auth.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

app.get(
  "/me",
  {
    hooks: requireBetterAuth(),
    responses: {
      200: {
        description: "OK",
        body: z.object({
          userId: z.string(),
          email: z.email(),
        }),
      },
    },
  },
  ({ state }) => ({
    status: 200,
    body: {
      userId: state.session!.user.id,
      email: state.session!.user.email,
    },
  }),
);`}
      />

      <h2 id="client-usage">Client usage</h2>
      <p>
        Browser apps use Better Auth&apos;s client. Point <code>baseURL</code>{" "}
        at the same origin or public API origin that serves your DaloyJS app.
      </p>
      <CodeBlock
        code={`// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
});

await authClient.signIn.email({
  email: "ada@example.com",
  password: "correct horse battery staple",
});`}
      />

      <h2 id="runtime-fit">Runtime fit</h2>
      <table>
        <thead>
          <tr>
            <th>Runtime</th>
            <th>Fit</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node.js</td>
            <td>Recommended</td>
            <td>
              Best default for database-backed sessions and OAuth callbacks.
            </td>
          </tr>
          <tr>
            <td>Bun / Deno</td>
            <td>Depends on adapter</td>
            <td>Use only with database drivers tested on that runtime.</td>
          </tr>
          <tr>
            <td>Cloudflare Workers</td>
            <td>Depends on adapter</td>
            <td>
              The auth handler is Web-standard, but your database adapter must
              also work on Workers.
            </td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>Yes</td>
            <td>
              Use Node functions unless every selected adapter is edge-safe.
            </td>
          </tr>
          <tr>
            <td>AWS Lambda</td>
            <td>Yes</td>
            <td>Use pooled or serverless database access.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="security-notes">Security notes</h2>
      <FlowDiagram
        title="Secure deployment checklist"
        numbered
        steps={[
          {
            label: "Secret",
            detail: "BETTER_AUTH_SECRET from a real secret manager",
            eyebrow: "config",
          },
          {
            label: "Origin",
            detail: "trustedOrigins pins browser origins",
          },
          {
            label: "Cookies",
            detail: "preserve raw Response from auth.handler",
            tone: "accent",
          },
          {
            label: "Proxy",
            detail: "declare TRUST_PROXY_HOPS behind a platform edge",
          },
          {
            label: "Database",
            detail: "migrate auth tables before traffic",
            tone: "success",
          },
        ]}
        caption="Better Auth is part of your deployed app, so the auth route needs the same production posture as the rest of the API: secure secrets, trusted origins, proxy-aware URLs, preserved cookies, and database migrations."
      />
      <ul>
        <li>
          Generate a strong <code>BETTER_AUTH_SECRET</code> and rotate it with
          the same care as a JWT signing key.
        </li>
        <li>
          Keep <code>trustedOrigins</code> narrow. Do not allow arbitrary
          origins in production.
        </li>
        <li>
          Preserve Better Auth&apos;s raw <code>Response</code> for auth
          endpoints. Rebuilding headers into a plain object can collapse
          multiple <code>Set-Cookie</code> headers.
        </li>
        <li>
          When deployed behind Railway, Render, Fly.io, Vercel, Cloudflare, or
          another edge proxy, configure DaloyJS&apos;s proxy posture so
          generated URLs, cookies, rate limiting, and audit logs use the
          expected origin and client IP.
        </li>
        <li>
          Put <code>rateLimit()</code> in front of sign-in, sign-up, password
          reset, and callback routes. Better Auth handles auth logic, but the
          API still needs abuse controls.
        </li>
      </ul>

      <p>
        See also the <Link href="/docs/auth">auth integrations overview</Link>
        {", "}
        <a
          href="https://better-auth.com/docs/installation"
          target="_blank"
          rel="noreferrer"
        >
          Better Auth installation
        </a>
        {", "}
        <a
          href="https://better-auth.com/docs/basic-usage"
          target="_blank"
          rel="noreferrer"
        >
          Better Auth basic usage
        </a>
        {", "}and the framework integration docs for{" "}
        <a
          href="https://better-auth.com/docs/integrations/hono"
          target="_blank"
          rel="noreferrer"
        >
          Hono
        </a>
        {", "}
        <a
          href="https://better-auth.com/docs/integrations/elysia"
          target="_blank"
          rel="noreferrer"
        >
          Elysia
        </a>
        {", "}and{" "}
        <a
          href="https://better-auth.com/docs/integrations/fastify"
          target="_blank"
          rel="noreferrer"
        >
          Fastify
        </a>
        {"."}
      </p>
    </>
  );
}
