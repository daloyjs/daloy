import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Routing",
  description:
    "Define type-safe HTTP routes in DaloyJS with a contract-first API: path params, query, body, and response schemas inferred end-to-end from a single declaration.",
  path: "/docs/routing",
  keywords: ["DaloyJS routing", "type-safe routes", "contract-first routing", "HTTP router TypeScript"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Routing</h1>
      <p>
        DaloyJS uses a trie/radix router with a static-route fast path. Static routes resolve via a single{" "}
        <code>Map.get</code>; dynamic routes walk a trie in O(path-segments) regardless of how many routes you have.
      </p>

      <h2>Defining routes</h2>
      <CodeBlock code={`app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",     // required and unique across the app
  tags: ["Users"],
  summary: "Get a user by id",
  request: {
    params:  z.object({ id: z.string().uuid() }),
    query:   z.object({ include: z.enum(["profile", "settings"]).optional() }).optional(),
    headers: z.object({ "x-tenant": z.string() }).optional(),
  },
  responses: {
    200: { description: "Found", body: UserSchema },
    404: { description: "Not found" },
  },
  handler: async ({ params, query, headers }) => {
    // params.id is string, query.include is "profile" | "settings" | undefined, headers["x-tenant"] is string
    return { status: 200, body: await loadUser(params.id) };
  },
});`} />

      <h2>HTTP methods</h2>
      <p>Supported: <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code>, <code>HEAD</code>, <code>OPTIONS</code>. <code>HEAD</code> is auto-derived from <code>GET</code> when not declared explicitly.</p>

      <h2>Path parameters</h2>
      <CodeBlock code={`app.route({
  method: "GET",
  path: "/orgs/:org/repos/:repo",
  // params is { org: string, repo: string } — inferred from the path
});`} />
      <p>Conflicting parameter names (e.g. <code>/a/:x</code> and <code>/a/:y</code>) throw at registration. Path traversal segments (<code>..</code>) and empty segments <code>{"//"}</code> are rejected by the router before your handler sees them.</p>

      <h2>Groups</h2>
      <CodeBlock code={`app.group("/api/v1", { tags: ["v1"] }, (v1) => {
  v1.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200, body: { ok: true } }),
  });
});
// final path: /api/v1/health`} />
      <p>Groups merge prefixes, tags, and hooks. They are encapsulated — middleware added inside a group does not leak out.</p>

      <h2>Hooks</h2>
      <p>Hooks attach behavior at fixed lifecycle points:</p>
      <ul>
        <li><code>onRequest</code> — earliest, before parsing.</li>
        <li><code>beforeHandle</code> — after validation, before your handler. Return a Response to short-circuit.</li>
        <li><code>afterHandle</code> — wrap or transform the handler result.</li>
        <li><code>onError</code> — observe or replace the error response.</li>
        <li><code>onResponse</code> — final hook, always runs.</li>
      </ul>
      <CodeBlock code={`app.route({
  method: "POST",
  path: "/admin/purge",
  operationId: "adminPurge",
  hooks: bearerAuth({ validate: t => t === process.env.ADMIN_TOKEN }),
  responses: { 200: { description: "ok" }, 401: { description: "denied" } },
  handler: async () => ({ status: 200, body: { purged: true } }),
});`} />

      <h2>405 Method Not Allowed</h2>
      <p>
        If a path is registered for one method but called with another, the router returns{" "}
        <strong>405</strong> with a correct <code>Allow</code> header — never a misleading 404.
      </p>

      <h2>Performance</h2>
      <CodeBlock language="text" code={`static route lookup        12,363,799 ops/sec
dynamic 4-segment lookup    1,513,983 ops/sec
miss                        4,763,878 ops/sec`} />
    </>
  );
}
