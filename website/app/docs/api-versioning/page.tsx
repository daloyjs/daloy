import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API versioning",
  description:
    "Version DaloyJS APIs with explicit URL prefixes such as /api/v1/books, organize major versions as plugins, publish accurate OpenAPI contracts, and retire old endpoints safely.",
  path: "/docs/api-versioning",
  keywords: [
    "DaloyJS API versioning",
    "URL path versioning",
    "/api/v1",
    "versioned REST API",
    "public API",
    "commercial API",
    "OpenAPI versions",
    "API deprecation",
    "Sunset header",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API versioning</h1>
      <p>
        DaloyJS supports URL-based API versioning with ordinary route prefixes.
        Put a stable major version in the public path, such as{" "}
        <code>/api/v1/books</code>
        {", "}and mount that version with <code>app.group()</code> or a
        prefixed plugin. The resulting paths are normal DaloyJS routes: request
        and response validation, OpenAPI, generated clients, hooks, auth, and
        rate limits all continue to work.
      </p>
      <p>
        Use a new major path only for a breaking contract. Additive endpoints
        and optional inputs normally stay in the current version. This keeps
        consumers stable without turning every release into another permanent
        API surface.
      </p>

      <BranchDiagram
        title="One service, explicit public contracts"
        source={{
          eyebrow: "api.example.com",
          label: "DaloyJS application",
          detail: "shared auth · services · storage · observability",
        }}
        branches={[
          {
            eyebrow: "stable",
            label: "Books API v1",
            detail: "/api/v1/books",
            tone: "muted",
          },
          {
            eyebrow: "current",
            label: "Books API v2",
            detail: "/api/v2/books",
            tone: "accent",
          },
          {
            eyebrow: "operations",
            label: "Unversioned health route",
            detail: "/healthz",
            tone: "success",
          },
        ]}
        caption="Version the public resource contract, not necessarily the whole deployment. v1 and v2 can run side by side while sharing internal services. Operational routes such as health checks normally remain unversioned."
      />

      <h2 id="quick-start">Create /api/v1/books</h2>
      <p>
        A group prepends its path to every route registered inside the callback.
        Group tags also carry into OpenAPI, which keeps versions easy to
        distinguish in Scalar, Swagger UI, or Redoc.
      </p>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const BookV1 = z.object({
  id: z.string(),
  title: z.string(),
});

const app = new App({
  openapi: {
    info: { title: "Books API", version: "1.0.0" },
  },
  docs: true,
});

app.group("/api/v1", { tags: ["Books v1"] }, (v1) => {
  v1.get(
    "/books",
    {
      operationId: "listBooksV1",
      responses: {
        200: {
          description: "Books available to the caller",
          body: z.array(BookV1),
        },
      },
    },
    async () => ({
      status: 200,
      body: [{ id: "book_1", title: "Dune" }],
    }),
  );
});

// GET /api/v1/books
// OpenAPI path: /api/v1/books`}
      />
      <p>
        Groups are ideal for a small API or a version defined in one module. For
        a larger public API, prefer one plugin per major version so route
        ownership and version-specific middleware stay explicit.
      </p>

      <h2 id="organize-versions-as-plugins">
        Organize major versions as plugins
      </h2>
      <p>
        Keep version-specific transport contracts near each other, but call
        shared domain services underneath them. Avoid copying database and
        business logic into every version. Usually only the route schemas and
        the mapping between those schemas and the domain model should differ.
      </p>
      <CodeBlock
        language="text"
        code={`src/
  api/
    v1/
      books.ts
      index.ts
    v2/
      books.ts
      index.ts
  domain/
    books-service.ts
  app.ts`}
      />
      <CodeBlock
        language="ts"
        code={`// src/app.ts
import { App } from "@daloyjs/core";
import { apiV1 } from "./api/v1/index.js";
import { apiV2 } from "./api/v2/index.js";

const app = new App({
  openapi: {
    info: { title: "Books API", version: "2.0.0" },
  },
  docs: true,
});

app.register(apiV1, {
  prefix: "/api/v1",
  tags: ["Books v1"],
});

app.register(apiV2, {
  prefix: "/api/v2",
  tags: ["Books v2"],
});

await app.ready();`}
      />
      <p>
        Each plugin registers resource paths such as <code>/books</code>
        {". "}The prefix supplied by the application produces{" "}
        <code>/api/v1/books</code> and <code>/api/v2/books</code>
        {". "}Plugins also encapsulate hooks and decorations, so a
        compatibility adapter or limit added to v1 does not leak into v2.
      </p>

      <h2 id="when-to-create-a-new-version">
        When to create a new major version
      </h2>
      <p>
        Treat the public request and response contract as the versioned product.
        Internal refactors, database migrations, and deployment changes do not
        need a new URL when callers observe the same behavior.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Change</th>
              <th>Typical decision</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Add a new endpoint or optional request parameter</td>
              <td>Keep the current major version</td>
            </tr>
            <tr>
              <td>Fix internals without changing the contract</td>
              <td>Keep the current major version</td>
            </tr>
            <tr>
              <td>Remove or rename a request or response field</td>
              <td>Create a new major version</td>
            </tr>
            <tr>
              <td>Tighten accepted input so valid old requests fail</td>
              <td>Create a new major version</td>
            </tr>
            <tr>
              <td>Change the meaning of a field or operation</td>
              <td>Create a new major version</td>
            </tr>
            <tr>
              <td>Add a new required permission to an existing operation</td>
              <td>
                Usually create a new major version or run a migration period
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Run{" "}
        <Link href="/docs/api-lifecycle#detecting-breaking-changes">
          DaloyJS&apos;s OpenAPI diff
        </Link>{" "}
        in CI instead of relying only on judgment. It catches removed paths and
        responses, newly required parameters, optional parameters that became
        required, and newly required request bodies.
      </p>

      <h2 id="openapi-and-generated-clients">OpenAPI and generated clients</h2>
      <p>
        A single DaloyJS application produces one OpenAPI document containing
        every public route registered on that application. If v1 and v2 run
        together, the default document contains both sets of paths. Use
        version-specific tags and globally unique operation IDs:
      </p>
      <CodeBlock
        language="ts"
        code={`// Good: stable and unique across the complete document
operationId: "listBooksV1"
operationId: "listBooksV2"

// Avoid: duplicate operation IDs fail during registration
operationId: "listBooks"`}
      />
      <p>
        The OpenAPI <code>info.version</code> identifies the release of the
        document or API contract. It does not add a URL prefix and it does not
        select a route at runtime. Likewise, the route-level{" "}
        <code>version</code> property is informational metadata; it is not a
        routing switch and is not emitted into OpenAPI. The URL prefix is what
        makes <code>/api/v1</code> real.
      </p>
      <blockquote>
        <strong>Current boundary:</strong> <code>generateOpenAPI()</code> does
        not currently filter a document by tag or version. If consumers need
        separately published v1 and v2 specifications or SDKs, register the
        reusable version plugin on a dedicated contract app for each codegen
        run.
      </blockquote>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { apiV1 } from "./api/v1/index.js";

const v1Contract = new App();
v1Contract.register(apiV1, {
  prefix: "/api/v1",
  tags: ["Books v1"],
});

await v1Contract.ready();

const v1Spec = generateOpenAPI(v1Contract, {
  info: { title: "Books API v1", version: "1.8.0" },
});

// Write v1Spec for publication or feed it to the v1 SDK codegen job.`}
      />
      <p>
        Reusing the same plugin for the runtime app and contract app prevents a
        second handwritten route inventory from drifting away from production.
        See <Link href="/docs/openapi">OpenAPI generation</Link> and{" "}
        <Link href="/docs/typed-client">typed-client codegen</Link> for the
        publication workflow.
      </p>

      <h2 id="retire-an-old-version-safely">Retire an old version safely</h2>
      <p>
        Do not replace v1 in place when v2 is breaking. Run both versions,
        announce the migration, observe remaining v1 traffic, and remove v1 only
        after the published support window.
      </p>
      <CodeBlock
        language="ts"
        code={`app.get(
  "/api/v1/books",
  {
    operationId: "listBooksV1",
    sunset: "2027-06-30T00:00:00Z",
    responses: {
      200: {
        description: "Books in the v1 representation",
        body: z.array(BookV1),
      },
    },
  },
  async () => ({ status: 200, body: await books.listV1() }),
);

// Every response includes:
// Deprecation: true
// Sunset: Wed, 30 Jun 2027 00:00:00 GMT
//
// OpenAPI includes:
// deprecated: true
// x-sunset: Wed, 30 Jun 2027 00:00:00 GMT`}
      />
      <ol>
        <li>Ship v2 while v1 remains available.</li>
        <li>Publish migration examples and a concrete retirement date.</li>
        <li>
          Mark v1 routes with <code>sunset</code>
          {", "}which also marks them deprecated.
        </li>
        <li>Track usage by version and contact active consumers.</li>
        <li>Remove v1 after the date and the promised support window.</li>
      </ol>
      <p>
        Read{" "}
        <Link href="/docs/api-lifecycle">
          API lifecycle &amp; breaking changes
        </Link>{" "}
        for the response headers, OpenAPI extensions, CLI diff, and CI gate.
      </p>

      <h2 id="authentication-quotas-and-paid-apis">
        Authentication, quotas, and paid APIs
      </h2>
      <p>
        Versioning keeps a customer&apos;s integration stable. It does not by
        itself turn an endpoint into a commercial API product. DaloyJS provides
        the data-plane building blocks that run on every request:
      </p>
      <ul>
        <li>bearer, JWT, JWK, mTLS, and HTTP-signature verification;</li>
        <li>
          <code>requireScopes()</code> for operation-level permissions;
        </li>
        <li>
          <code>rateLimit()</code> with a Redis-backed store for multi-instance
          request limits;
        </li>
        <li>structured logs, metrics, tracing, and request IDs;</li>
        <li>
          OpenAPI documentation, generated clients, and contract-change gates.
        </li>
      </ul>
      <p>
        Your application or an external API-management control plane still owns
        customer onboarding, credential issuance and revocation, plan
        entitlements, billing, invoices, a developer portal, and durable usage
        records. Those policies are business-specific and are not a turnkey
        DaloyJS subsystem.
      </p>
      <blockquote>
        <strong>Security:</strong> a group&apos;s <code>auth</code> option
        documents the OpenAPI security requirement; it does not verify a
        credential by itself. Install an enforcement hook such as{" "}
        <code>jwk()</code>
        {", "}<code>bearerAuth()</code>
        {", "}or a reviewed custom API-key hook. Key limits by a stable
        authenticated customer ID, not by the raw secret, and use a shared store
        when more than one instance serves traffic.
      </blockquote>
      <p>
        For the enforcement pieces, continue with{" "}
        <Link href="/docs/auth/architecture">OAuth2/OIDC architecture</Link>
        {", "}
        <Link href="/docs/security/auth-slice">JWT and auth safeguards</Link>
        {", "}
        and the{" "}
        <Link href="/docs/security/rate-limit-redis">
          Redis rate-limit store
        </Link>
        {"."}
      </p>

      <h2 id="supported-versioning-styles">Supported versioning styles</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Style</th>
              <th>DaloyJS support</th>
              <th>Guidance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                URL path: <code>/api/v1/books</code>
              </td>
              <td>First-class through groups and plugin prefixes</td>
              <td>Recommended for public APIs</td>
            </tr>
            <tr>
              <td>
                Header: <code>Accept-Version: 1</code>
              </td>
              <td>No automatic route negotiation</td>
              <td>Implement explicit application logic only when required</td>
            </tr>
            <tr>
              <td>Versioned media types</td>
              <td>No automatic route negotiation</td>
              <td>Useful only when your API contract already requires it</td>
            </tr>
            <tr>
              <td>
                Query string: <code>?version=1</code>
              </td>
              <td>Possible as ordinary input, not a versioning feature</td>
              <td>
                Avoid for public contracts because caches and docs are less
                clear
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        URL path versioning is deliberately boring: it is visible in logs,
        caches, documentation, generated clients, gateway policies, and support
        tickets. For a public resource API, that clarity is usually more useful
        than implicit negotiation.
      </p>
    </>
  );
}
