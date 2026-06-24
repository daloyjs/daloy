import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Routing",
  description:
    "Define type-safe HTTP routes in DaloyJS with a contract-first API: path params, query, body, and response schemas inferred end-to-end from a single declaration.",
  path: "/docs/routing",
  keywords: [
    "DaloyJS routing",
    "type-safe routes",
    "contract-first routing",
    "HTTP router TypeScript",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Routing</h1>
      <p>
        DaloyJS uses a trie/radix router with a static-route fast path. Static
        routes resolve via a single <code>Map.get</code>; dynamic routes walk a
        trie in O(path-segments) regardless of how many routes you have.
      </p>

      <h2>Defining routes</h2>
      <p>
        A route declaration is the source of truth for matching, request
        validation, response validation, OpenAPI output, and typed clients.
        Provide an <code>operationId</code> for every public route you want in
        the typed client or generated SDK; DaloyJS rejects duplicate{" "}
        <code>operationId</code> values at registration.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  tenantId: z.string(),
  included: z.enum(["profile", "settings"]).optional(),
});

async function loadUser(input: {
  id: string;
  tenantId: string;
  include?: "profile" | "settings";
}) {
  return {
    id: input.id,
    email: "dev@example.com",
    tenantId: input.tenantId,
    included: input.include,
  };
}

export const app = new App().route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  tags: ["Users"],
  summary: "Get a user by id",
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z
      .object({ include: z.enum(["profile", "settings"]).optional() })
      .optional(),
    headers: z.object({ "x-tenant": z.string() }),
  },
  responses: {
    200: { description: "Found", body: UserSchema },
    404: { description: "Not found" },
  },
  handler: async ({ params, query, headers }) => {
    // params, query, and headers are inferred from the schemas above.
    return {
      status: 200,
      body: await loadUser({
        id: params.id,
        tenantId: headers["x-tenant"],
        include: query?.include,
      }),
    };
  },
});`}
      />

      <h2>Type inference and chaining</h2>
      <p>
        <code>app.route()</code> returns the same app instance with a widened
        route tuple type. Chain route registrations when you want{" "}
        <code>createClient(app)</code> to expose strongly typed methods for each{" "}
        <code>operationId</code>. Separate statements still register routes at
        runtime and in OpenAPI, but TypeScript cannot widen the already-created{" "}
        <code>app</code> variable.
      </p>
      <CodeBlock
        code={`// Best for typed clients: app carries both operationIds in its type.
export const app = new App()
  .route({
    method: "GET",
    path: "/books",
    operationId: "listBooks",
    responses: {
      200: { description: "Books", body: z.array(z.object({ id: z.string() })) },
    },
    handler: async () => ({ status: 200, body: [{ id: "1" }] }),
  })
  .route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    request: { body: z.object({ title: z.string().min(1) }) },
    responses: {
      201: { description: "Created", body: z.object({ id: z.string() }) },
    },
    handler: async () => ({ status: 201, body: { id: "2" } }),
  });`}
      />

      <h2>HTTP methods</h2>
      <p>
        Supported methods include <code>GET</code>, <code>POST</code>,{" "}
        <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code>,{" "}
        <code>HEAD</code>, and <code>OPTIONS</code>. Custom methods such as{" "}
        <code>TRACE</code>, <code>CONNECT</code>, and WebDAV verbs are rejected
        at registration.
      </p>
      <p>
        <code>HEAD</code> falls back to the matching <code>GET</code> route when
        no explicit <code>HEAD</code> route exists, returning the same headers
        with an empty body. <code>OPTIONS</code> returns a 204 preflight with an{" "}
        <code>Allow</code> header when a path exists but no explicit{" "}
        <code>OPTIONS</code> route is registered.
      </p>

      <h2>Path parameters</h2>
      <CodeBlock
        code={`app.route({
  method: "GET",
  path: "/orgs/:org/repos/:repo",
  operationId: "getRepo",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      description: "Repository",
      body: z.object({ org: z.string(), repo: z.string() }),
    },
  },
  handler: async ({ params }) => ({ status: 200, body: params }),
});`}
      />
      <p>
        Path values are decoded before validation. If you omit a{" "}
        <code>request.params</code> schema, <code>ctx.params</code> is inferred
        from the path as raw strings. Conflicting parameter names at the same
        trie position, such as <code>/a/:x</code> and <code>/a/:y</code>, throw
        at registration.
      </p>

      <h3>Wildcard captures</h3>
      <p>
        A trailing <code>*name</code> segment captures the rest of the path into
        one decoded string. Wildcards must be terminal.
      </p>
      <CodeBlock
        code={`app.route({
  method: "GET",
  path: "/assets/*path",
  operationId: "getAsset",
  request: { params: z.object({ path: z.string() }) },
  responses: {
    200: { description: "Asset", body: z.object({ path: z.string() }) },
  },
  handler: async ({ params }) => ({ status: 200, body: params }),
});

// GET /assets/css/app.css -> params.path === "css/app.css"`}
      />
      <p>
        Path traversal segments (<code>..</code>), empty segments{" "}
        <code>{"//"}</code>, and malformed percent escapes miss cleanly before
        your handler sees them.
      </p>

      <h2>Groups</h2>
      <CodeBlock
        code={`app.group("/api/v1", { tags: ["v1"] }, (v1) => {
  v1.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) },
    },
    handler: async () => ({ status: 200, body: { ok: true } }),
  });
});
// final path: /api/v1/health`}
      />
      <p>
        Groups merge prefixes, tags, hooks, and auth defaults into the routes
        registered inside the callback. The child app is encapsulated:
        middleware added inside a group does not leak to routes outside that
        group. Grouped routes are visible to runtime routing and OpenAPI.
      </p>

      <h2>Route options</h2>
      <ul>
        <li>
          <code>request</code>: schemas for <code>params</code>,{" "}
          <code>query</code>, <code>headers</code>, and <code>body</code>.
        </li>
        <li>
          <code>responses</code>: declared status codes and optional response
          body/header schemas.
        </li>
        <li>
          <code>accepts</code>: per-route <code>Content-Type</code> allowlist
          for routes with request body schemas.
        </li>
        <li>
          <code>auth</code>: OpenAPI security requirement for the route; pair it
          with an auth hook such as <code>bearerAuth()</code>.
        </li>
        <li>
          <code>internal</code>: hides a route from public adapters while still
          allowing in-process <code>app.inject()</code> calls.
        </li>
        <li>
          <code>deprecated</code> and <code>sunset</code>: mark an endpoint as
          deprecated and emit the matching response headers.
        </li>
        <li>
          <code>callbacks</code> and <code>meta</code>: add OpenAPI callbacks,
          examples, and AI-friendly route metadata.
        </li>
      </ul>

      <h2>Hooks</h2>
      <p>Hooks attach behavior at fixed lifecycle points:</p>
      <ul>
        <li>
          <code>onRequest</code>: earliest, before parsing.
        </li>
        <li>
          <code>beforeHandle</code>: after validation, before your handler.
          Return a <code>Response</code> to short-circuit.
        </li>
        <li>
          <code>afterHandle</code>: wrap or transform the handler result before
          response serialization.
        </li>
        <li>
          <code>onError</code>: observe or replace the error response.
        </li>
        <li>
          <code>onSend</code>: mutate outgoing headers in place or return a new{" "}
          <code>Response</code>. Runs on success, error, and{" "}
          <code>OPTIONS</code> preflight paths.
        </li>
        <li>
          <code>onResponse</code>: final observer. Use it for logging and
          metrics, not response mutation.
        </li>
      </ul>
      <FlowDiagram
        title="Request lifecycle"
        numbered
        caption="Hooks fire at fixed points around your handler. Validation runs before beforeHandle, so an invalid request never reaches your code. If anything throws, control jumps to onError, then onSend and onResponse still run so the error response is shaped and observed like any other."
        steps={[
          { label: "onRequest", eyebrow: "earliest", detail: "before parsing" },
          {
            label: "validate",
            eyebrow: "framework",
            detail: "params · query · body · headers",
          },
          {
            label: "beforeHandle",
            detail: "return a Response to short-circuit",
          },
          { label: "handler", detail: "your route logic", tone: "accent" },
          { label: "afterHandle", detail: "wrap / transform the result" },
          { label: "onSend", detail: "mutate or replace the Response" },
          {
            label: "onResponse",
            eyebrow: "always",
            detail: "observability only",
            tone: "success",
          },
        ]}
      />
      <CodeBlock
        code={`app.route({
  method: "POST",
  path: "/admin/purge",
  operationId: "adminPurge",
  hooks: bearerAuth({ validate: t => t === process.env.ADMIN_TOKEN }),
  responses: {
    200: { description: "ok", body: z.object({ purged: z.boolean() }) },
    401: { description: "denied" },
  },
  handler: async () => ({ status: 200, body: { purged: true } }),
});`}
      />

      <h2>
        Transforming responses with <code>onSend</code>
      </h2>
      <p>
        Use <code>onSend</code> when you need to rewrite the outgoing response,
        for example, to attach a header, strip an internal header, or replace
        the response entirely. Returning <code>void</code> keeps the current
        response. Multiple <code>onSend</code> hooks compose pipeline-style
        (global → group → route).
      </p>
      <CodeBlock
        code={`const app = new App({
  hooks: {
    onSend(res) {
      // Always advertise the API version on every outgoing response,
      // including error responses and OPTIONS preflights.
      res.headers.set("x-api-version", "2026-05-15");
    },
  },
});

app.route({
  method: "GET",
  path: "/users/me",
  operationId: "me",
  hooks: {
    onSend(res) {
      // Strip internal implementation detail before the response leaves.
      res.headers.delete("x-internal-cache-key");
    },
  },
  responses: {
    200: { description: "ok", body: z.object({ id: z.string() }) },
  },
  handler: async ({ set }) => {
    set.headers.set("x-internal-cache-key", "shard-a");
    return { status: 200, body: { id: "u_1" } };
  },
});`}
      />
      <p>
        <code>onSend</code> runs <em>after</em> response validation and after
        request-scoped headers, including <code>x-request-id</code>, have been
        merged. It runs <em>before</em> <code>onResponse</code>, which remains
        the right place for logging and metrics.
      </p>

      <h2>405 Method Not Allowed</h2>
      <p>
        If a path is registered for one method but called with another, the
        router returns <strong>405</strong> with a correct <code>Allow</code>{" "}
        header, never a misleading 404. Routes marked{" "}
        <code>internal: true</code> are filtered from public 405 and{" "}
        <code>Allow</code> responses so hidden admin or cron endpoints do not
        leak through method probing.
      </p>

      <h2>Performance</h2>
      <CodeBlock
        language="text"
        code={`static route lookup        12,363,799 ops/sec
dynamic 4-segment lookup    1,513,983 ops/sec
miss                        4,763,878 ops/sec`}
      />
    </>
  );
}
