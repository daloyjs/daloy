/**
 * OpenAPI 3.1 document for the HTTP APIs hosted on daloyjs.dev itself
 * (docs MCP, agent discovery, Markdown negotiation). This is not the OpenAPI
 * document an application generates with `@daloyjs/core`; that flow is
 * documented at `/docs/openapi`.
 */

import { SITE_URL } from "@/lib/seo";

const PROBLEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "status", "detail", "code", "hint"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    code: {
      type: "string",
      description: "Machine-readable error code (snake_case).",
    },
    hint: {
      type: "string",
      description: "What the caller should do next to recover.",
    },
  },
} as const;

const PROBLEM_RESPONSE = {
  description: "RFC 9457 problem+json with an error code and a recovery hint.",
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/Problem" },
    },
  },
} as const;

/**
 * Build the OpenAPI 3.1 document for this website's machine APIs.
 *
 * @returns A plain object safe to `JSON.stringify`.
 */
export function buildSiteOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "DaloyJS website APIs",
      version: "1.0.0",
      summary:
        "Agent discovery, docs MCP, and Markdown representations for daloyjs.dev.",
      description:
        "HTTP APIs hosted on the DaloyJS project site. Errors are RFC 9457 problem+json with `code` and `hint` fields. Page URLs also negotiate `Accept: text/markdown`. The framework's own generated OpenAPI (the spec your app emits) is documented at /docs/openapi.",
      contact: {
        name: "DaloyJS maintainers",
        email: "daloyjs@gmail.com",
        url: `${SITE_URL}/contact`,
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [{ url: SITE_URL }],
    tags: [
      { name: "Discovery", description: "Catalogs agents should fetch first." },
      {
        name: "Docs MCP",
        description: "Read-only Model Context Protocol for the documentation.",
      },
    ],
    paths: {
      "/api": {
        get: {
          tags: ["Discovery"],
          operationId: "getApiCatalog",
          summary: "JSON index of DaloyJS website APIs",
          responses: {
            "200": {
              description: "Catalog of machine endpoints on this origin.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiIndex" },
                },
              },
            },
            default: PROBLEM_RESPONSE,
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["Discovery"],
          operationId: "getOpenApiDocument",
          summary: "DaloyJS website OpenAPI 3.1 document",
          responses: {
            "200": {
              description: "This OpenAPI document.",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
            default: PROBLEM_RESPONSE,
          },
        },
      },
      "/.well-known/api-catalog": {
        get: {
          tags: ["Discovery"],
          operationId: "getRfc9727ApiCatalog",
          summary: "RFC 9727 API catalog linkset",
          responses: {
            "200": {
              description: "Linkset pointing at OpenAPI and the docs MCP.",
              content: {
                "application/linkset+json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
      "/mcp": {
        post: {
          tags: ["Docs MCP"],
          operationId: "postMcpJsonRpc",
          summary: "DaloyJS MCP server (JSON-RPC 2.0 over Streamable HTTP)",
          description:
            "Read-only tools: search_docs, get_doc, list_docs. Send JSON-RPC 2.0. GET on this URL returns 405 with a JSON hint.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          responses: {
            "200": {
              description: "JSON-RPC result or error envelope.",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            "400": PROBLEM_RESPONSE,
            "405": PROBLEM_RESPONSE,
            "413": PROBLEM_RESPONSE,
          },
        },
      },
      "/llms.txt": {
        get: {
          tags: ["Discovery"],
          operationId: "getLlmsTxt",
          summary: "Curated Markdown index of the site for agents",
          responses: {
            "200": {
              description: "llms.txt v2 document.",
              content: { "text/plain": { schema: { type: "string" } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Problem: PROBLEM_SCHEMA,
        ApiIndex: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "links"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            links: {
              type: "object",
              additionalProperties: { type: "string", format: "uri" },
            },
          },
        },
      },
    },
  };
}
