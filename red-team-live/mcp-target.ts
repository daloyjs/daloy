/**
 * RED-TEAM LIVE MCP TARGET — a daloyjs app exposing a Streamable HTTP MCP
 * endpoint, attacked by `mcp-attacks.ts` from a separate process.
 *
 * The app is written the way a competent developer would expose MCP through
 * the framework's secure-by-default posture: production env, bearer auth in
 * front of the endpoint (which also satisfies the production MCP boot guard),
 * strict tool input schemas, one destructive-annotated tool, one concrete
 * resource, one parameterized resource template, and one prompt. Nothing here
 * is deliberately weakened — `mcp-attacks.ts` attacks the FRAMEWORK'S MCP
 * defaults (origin validation, body caps, header/body agreement, args
 * validation, URI handling), not a broken app.
 *
 * Handshake: once listening, prints `MCP_TARGET_READY <port>` so the attacker
 * process can discover the ephemeral port.
 */

import { z } from "zod";
import { App, bearerAuth, createMcpHandler, mcpRoutes } from "../src/index.ts";
import { serve } from "../src/adapters/node.ts";

const MCP_TOKEN = "mcp-demo-token";

const mcp = createMcpHandler({
  serverInfo: { name: "redteam-mcp", version: "1.0.0" },
  instructions: "Bookstore inventory MCP server.",
  tools: [
    {
      name: "echo",
      description: "Echo a query string back. Read-only.",
      // `additionalProperties: false` is load-bearing for the live prototype-
      // pollution probe: after the parser strips `__proto__` / `constructor` /
      // `prototype`, only `query` remains and the call succeeds. If stripping
      // were dropped, the extra keys would fail this schema with -32602.
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", maxLength: 1024 } },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      handler: (args) => `echo:${String((args as { query: string }).query)}`,
    },
    {
      name: "inventory.count",
      description: "Return the number of books in stock. Read-only.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true },
      handler: () => "2",
    },
    {
      name: "inventory.purge",
      description:
        "Delete ALL inventory rows. Destructive; confirm with the user first.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { destructiveHint: true },
      // The demo handler refuses by design: the framework's job is to
      // advertise annotations and gate the transport, not to make the tool
      // actually destructive. `destructiveHint` is client-side gating.
      handler: () => "refused: destructive demo tool",
    },
  ],
  resources: [
    {
      uri: "config://app/info",
      name: "app-info",
      description: "Public application metadata.",
      mimeType: "application/json",
      read: () => ({
        uri: "config://app/info",
        mimeType: "application/json",
        // Unique `kind` so a template/resource mix-up is detectable even when
        // the attacker URI still looks like `db://records/...`.
        text: JSON.stringify({
          kind: "app-info",
          name: "redteam-mcp",
          public: true,
        }),
      }),
    },
  ],
  resourceTemplates: [
    {
      uriTemplate: "db://records/{id}",
      name: "record-by-id",
      description: "Fetch a canned inventory record by id.",
      mimeType: "application/json",
      read: (uri, variables) => ({
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          kind: "record",
          id: variables.id ?? "canned",
          title: "Foundation",
        }),
      }),
    },
  ],
  prompts: [
    {
      name: "summarize",
      description: "Summarize a piece of text.",
      arguments: [
        { name: "text", description: "Text to summarize", required: true },
      ],
      get: (args) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Summarize: ${String(args.text)}` },
          },
        ],
      }),
    },
  ],
});

const app = new App({
  title: "MCP Red-Team Target",
  version: "1.0.0",
  env: "production",
  logger: false,
  // A long-running attack harness must not be killed by the prod
  // crash-on-unhandled-rejection guard the moment a probe trips an edge case;
  // the attacker process detects a real crash via connection-refused instead.
  crashOnUnhandledRejection: false,
  openapi: { info: { title: "MCP Red-Team Target", version: "1.0.0" } },
})
  .use(bearerAuth({ validate: (t) => t === MCP_TOKEN }))
  .get(
    "/healthz",
    {
      operationId: "healthz",
      responses: {
        200: { description: "ok", body: z.object({ ok: z.boolean() }) },
      },
    },
    async () => ({ status: 200 as const, body: { ok: true } }),
  );

for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route);
}

const handle = serve(app, { port: 0 });
// With port 0 the OS-assigned port is only known once `listening` fires.
handle.server.on("listening", () => {
  // eslint-disable-next-line no-console
  console.log(`MCP_TARGET_READY ${handle.port}`);
});
const { close } = handle;

const shutdown = async (): Promise<void> => {
  await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
