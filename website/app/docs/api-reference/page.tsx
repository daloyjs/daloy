import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata, CORE_PACKAGE_VERSION } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference",
  description:
    "Complete API reference for DaloyJS: App, routing, middleware, MCP, plugins, errors, security helpers, JWT/JWK, sessions, streaming, websockets, and runtime adapters, with TypeScript signatures.",
  path: "/docs/api-reference",
  keywords: [
    "DaloyJS API reference",
    "DaloyJS docs",
    "TypeScript framework API",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference</h1>
      <p>{`The complete public surface of DaloyJS v${CORE_PACKAGE_VERSION}, organized by import path. Every signature in this reference is generated from the same TypeScript types your editor reads on hover, open the source files for fuller TSDoc, examples, and security rationale.`}</p>

      <h2 id="reference-sections">Reference sections</h2>
      <p>
        The reference is split into five focused pages so each one stays
        scannable:
      </p>
      <ul>
        <li>
          <Link href={"/docs/api-reference/app" as Route}>
            App &amp; routing</Link>
          {": "}the <code>App</code> class, route contracts, hooks and context
          types, dispatch order, errors, and schema validation.
        </li>
        <li>
          <Link href={"/docs/api-reference/middleware" as Route}>
            Middleware &amp; helpers</Link>
          {": "}built-in middleware, <code>every</code>/<code>some</code>/
          <code>except</code> composition, typed dependencies, config, logging,
          and connection info.
        </li>
        <li>
          <Link href={"/docs/api-reference/security" as Route}>
            Security &amp; auth</Link>
          {": "}hardening primitives, <code>fetchGuard</code>
          {", "}
          <code>safeRedirect</code>
          {", "}cookies, JWT/JWK, sessions, and password hashing.
        </li>
        <li>
          <Link href={"/docs/api-reference/modules" as Route}>
            Feature modules</Link>
          {": "}OpenAPI, typed client, contract tests, MCP, docs UIs,
          streaming, multipart, WebSocket, tracing, and the CLI.
        </li>
        <li>
          <Link href={"/docs/api-reference/adapters" as Route}>
            Runtime adapters</Link>
          {": "}<code>serve()</code> for Node.js, Bun, and Deno, plus the
          Cloudflare, Vercel, Fastly, and Lambda handlers.
        </li>
      </ul>

      <h2 id="minimal-server">Minimal server</h2>
      <p>
        This page is a reference, the signatures below are the source of truth,
        not a step-by-step tutorial. If you are starting from scratch, the{" "}
        <Link href="/docs/getting-started">getting-started guide</Link> walks
        through scaffolding, validation, the typed client, and OpenAPI docs in
        full. The snippet here is just enough to map the types below onto a
        server you can actually run.
      </p>
      <CodeBlock language="bash" code={`pnpm add @daloyjs/core zod`} />
      <CodeBlock
        code={`// index.ts
import { z } from "zod";
import { App } from "@daloyjs/core";          // root barrel
import { serve } from "@daloyjs/core/node";   // adapters are subpath-only

const app = new App({ title: "Hello API", version: "1.0.0" }).get(
  "/hello",
  {
    operationId: "hello",
    responses: {
      // A response \`body\` schema enables OWASP-API3 field stripping.
      200: { description: "Greeting", body: z.object({ message: z.string() }) },
    },
  },
  // The handler returns the discriminated union HandlerReturn<Res>:
  // { status, body, headers? }, keyed by a status declared above.
  () => ({ status: 200, body: { message: "Hello from DaloyJS" } }),
);

const { port } = serve(app);                  // NodeServerOptions.port defaults to 3000
console.log(\`listening on http://localhost:\${port}\`);`}
      />
      <p>
        Run it with <code>node index.ts</code>
        {": "}Node.js (22.18+) strips TypeScript types natively, no loader
        required. Every response already carries the secure-by-default headers (<code>secureHeaders</code>) and an <code>x-request-id</code> (<code>requestId</code>); errors serialize to RFC 9457{" "}
        <code>application/problem+json</code>
        {". "}To serve <code>/docs</code> and <code>/openapi.json</code>
        {", "}pass <code>docs: true</code> to <code>new App(...)</code> (it
        defaults to <code>false</code>).
      </p>
      <p>
        If you drop the response <code>body</code> schema the route still works,
        but DaloyJS logs a <code>security.response.bodySchemaMissing</code>{" "}
        warning at startup: response field-level stripping (OWASP API3) cannot
        be applied to a schema-less body. Declare the schema, or ignore the
        warning for routes that intentionally return no body.
      </p>

      <h2 id="subpath-modules">Subpath modules</h2>
      <p>Quick map of subpath modules exposed by the package:</p>
      <CodeBlock
        code={`@daloyjs/core                       // App, routing types, errors, middleware, security, JWT/JWK, ...
@daloyjs/core/openapi               // OpenAPI 3.1 document generation + security-scheme builders
@daloyjs/core/openapi-diff          // Dependency-free OpenAPI 3.x breaking-change diffing
@daloyjs/core/asyncapi              // AsyncAPI 3.0 generation for app.ws() WebSocket surfaces
@daloyjs/core/client                // Typed in-process client + Hey API SDK glue
@daloyjs/core/contract              // Contract-tests harness (assert OpenAPI parity)
@daloyjs/core/docs                  // Scalar / Swagger UI / Redoc HTML + CSP helper
@daloyjs/core/mcp                   // MCP Streamable HTTP tools, resources, prompts, and routes
@daloyjs/core/streaming             // SSE + NDJSON helpers
@daloyjs/core/websocket             // WebSocket route helper + frame primitives
@daloyjs/core/multipart             // File-field + multipart object schema helpers

// Observability & ops
@daloyjs/core/tracing               // OpenTelemetry tracing hook (interface-typed; no runtime dep)
@daloyjs/core/metrics               // Prometheus / OpenMetrics exposition
@daloyjs/core/banner                // Pretty startup banner
@daloyjs/core/cli                   // CLI internals (used by bin/daloy.mjs)

// Auth, sessions & crypto (also on the root barrel)
@daloyjs/core/session               // Cookie sessions + signed-value helpers
@daloyjs/core/hashing               // passwordHash / passwordVerify (scrypt)
@daloyjs/core/jwt                   // createJwtSigner / createJwtVerifier (no "alg: none")
@daloyjs/core/jwk                   // jwk() JWKS Bearer middleware (refuses HS*)
@daloyjs/core/cookie                // Cookie serialization + attribute validation
@daloyjs/core/time-claims           // assertTemporalClaims() (iat / nbf / exp)

// HTTP features & API ergonomics
@daloyjs/core/etag                  // etag() strong-validation 304 helper
@daloyjs/core/compression           // compression() with BREACH-aware defaults
@daloyjs/core/pagination            // Opaque-cursor pagination helpers
@daloyjs/core/idempotency           // Idempotency-Key handling for unsafe-method retries
@daloyjs/core/response-cache        // Server-side response caching (pluggable store)
@daloyjs/core/tenancy               // Multitenancy: per-request tenant resolution
@daloyjs/core/scheduler             // In-process scheduled (cron) tasks

// Rate limiting, concurrency & access control
@daloyjs/core/rate-limit-redis      // Distributed rate-limit store
@daloyjs/core/concurrency-limit     // Per-route/client concurrency limit + FIFO queue
@daloyjs/core/waf                   // WAF-lite inbound inspection (OWASP CRS-lite)
@daloyjs/core/auto-ban              // Adaptive fail2ban-style escalating bans
@daloyjs/core/bot-guard             // Bot / User-Agent management
@daloyjs/core/ip-reputation         // Pluggable, refreshed IP abuse-feed denylist
@daloyjs/core/geo-block             // ISO 3166-1 country allow/deny (BYO GeoIP lookup)
@daloyjs/core/request-decompression // Inbound decompression-bomb guard
@daloyjs/core/mtls                  // Mutual-TLS / client-certificate auth
@daloyjs/core/http-signatures       // HTTP Message Signatures (RFC 9421) sign + verify

// Outbound resilience
@daloyjs/core/fetch-resilience      // resilientFetch(): circuit breaker + retry + timeout
@daloyjs/core/webhook-delivery      // Outbound webhook delivery (signed, retried)

// Runtime adapters
@daloyjs/core/node                  // Node.js (http) - serve(app, opts)
@daloyjs/core/bun                   // Bun.serve adapter
@daloyjs/core/deno                  // Deno.serve adapter
@daloyjs/core/cloudflare            // Cloudflare Workers + generic { fetch } default export
@daloyjs/core/vercel                // Vercel Functions / Edge / Next.js App Router
@daloyjs/core/fastly                // Fastly Compute@Edge
@daloyjs/core/lambda                // AWS Lambda (API Gateway v1 + v2 / Function URLs)`}
      />

      <p>
        You can import any feature two ways: from the root{" "}
        <code>@daloyjs/core</code> barrel (convenient and tree-shakeable), or
        from its own subpath (for example <code>@daloyjs/core/jwt</code>) for
        the smallest possible bundle without relying on a bundler&apos;s
        tree-shaking. Both resolve to the same code. Runtime{" "}
        <strong>adapters</strong> are the one exception: they are available{" "}
        <em>only</em> as subpaths (for example <code>@daloyjs/core/node</code>),
        so runtime-specific code such as <code>node:http</code> never leaks into
        an edge or Worker bundle.
      </p>

      <BranchDiagram
        title="Two ways to import"
        source={{
          eyebrow: "same code",
          label: "@daloyjs/core feature",
          detail: "App, jwt, fetchGuard, ...",
        }}
        branches={[
          {
            eyebrow: "convenient",
            label: "Root barrel",
            detail: 'import { App } from "@daloyjs/core"',
          },
          {
            eyebrow: "smallest bundle",
            label: "Own subpath",
            detail: 'import { ... } from "@daloyjs/core/jwt"',
          },
          {
            eyebrow: "subpath only",
            label: "Runtime adapters",
            detail: "@daloyjs/core/node · /bun · /vercel",
            tone: "muted",
          },
        ]}
        caption="The barrel and per-feature subpaths resolve to the same code, so pick whichever suits your bundler. Runtime adapters are the exception: they ship only as subpaths so platform code (like node:http) never leaks into an edge bundle."
      />

      <p>
        Ready to dig in? Start with{" "}
        <Link href={"/docs/api-reference/app" as Route}>App &amp; routing</Link>
        {"."}
      </p>
    </>
  );
}
