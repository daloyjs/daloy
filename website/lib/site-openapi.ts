/**
 * OpenAPI 3.1 document for the HTTP APIs hosted on daloyjs.dev itself
 * (docs MCP, agent discovery, Markdown negotiation, OAuth metadata).
 * This is not the OpenAPI document an application generates with
 * `@daloyjs/core`; that flow is documented at `/docs/openapi`.
 */

import {
  DOCS_READ_SCOPE,
  OAUTH_AS_METADATA_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_TOKEN_ENDPOINT,
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC,
  SITE_API_V1_PATH,
  SITE_API_VERSION,
  SITE_API_VERSIONING_POLICY,
} from "@/lib/site-api";
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

const RATE_LIMIT_HEADERS = {
  RateLimit: {
    description:
      'IETF RateLimit header (draft-ietf-httpapi-ratelimit-headers). Example: "default";r=119;t=60',
    schema: { type: "string" },
  },
  "RateLimit-Policy": {
    description: `Advertised quota. Default: "default";q=${SITE_API_RATE_LIMIT};w=${SITE_API_RATE_WINDOW_SEC}`,
    schema: { type: "string" },
  },
  "RateLimit-Limit": {
    description: "Maximum requests per window.",
    schema: { type: "integer" },
  },
  "RateLimit-Remaining": {
    description: "Requests remaining in the current window.",
    schema: { type: "integer" },
  },
  "RateLimit-Reset": {
    description: "Seconds until the current window resets.",
    schema: { type: "integer" },
  },
  "API-Version": {
    description: `Current URL-path major (${SITE_API_VERSION}).`,
    schema: { type: "string", const: SITE_API_VERSION },
  },
} as const;

const PROBLEM_RESPONSE = {
  description: "RFC 9457 problem+json with an error code and a recovery hint.",
  headers: RATE_LIMIT_HEADERS,
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/Problem" },
    },
  },
} as const;

const RATE_LIMITED_RESPONSE = {
  description:
    "Quota exhausted. Honor Retry-After and retry. RateLimit remaining is 0.",
  headers: {
    ...RATE_LIMIT_HEADERS,
    "Retry-After": {
      description: "Seconds to wait before retrying.",
      schema: { type: "integer" },
    },
  },
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
      version: `${SITE_API_VERSION}.0.0`,
      summary:
        "Agent discovery, docs MCP, and Markdown representations for daloyjs.dev.",
      description: [
        "HTTP APIs hosted on the DaloyJS project site. Errors are RFC 9457 problem+json with `code` and `hint` fields. Page URLs also negotiate `Accept: text/markdown`.",
        SITE_API_VERSIONING_POLICY,
        `OAuth 2.0 client_credentials at ${OAUTH_TOKEN_ENDPOINT} issues a Bearer token with scope ${DOCS_READ_SCOPE}. Tokens are optional: every resource here is already public. Named scopes exist so agents request least privilege instead of inferring roles from prose. Metadata: GET ${OAUTH_AS_METADATA_PATH} (RFC 8414) and GET ${OAUTH_PROTECTED_RESOURCE_PATH} (RFC 9728).`,
        "The framework's own generated OpenAPI (the spec your app emits) is documented at /docs/openapi.",
      ].join(" "),
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
    servers: [
      {
        url: SITE_URL,
        description: "Current origin. Versioned paths live under /api/v1.",
      },
    ],
    tags: [
      { name: "Discovery", description: "Catalogs agents should fetch first." },
      {
        name: "Docs MCP",
        description: "Read-only Model Context Protocol for the documentation.",
      },
      {
        name: "OAuth",
        description:
          "RFC 8414 authorization server and client_credentials token grant.",
      },
    ],
    security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
    paths: {
      [SITE_API_V1_PATH]: {
        get: {
          tags: ["Discovery"],
          operationId: "getApiCatalogV1",
          summary: "JSON index of DaloyJS website APIs (v1)",
          security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
          responses: {
            "200": {
              description: "Catalog of machine endpoints on this origin.",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiIndex" },
                },
              },
            },
            "429": RATE_LIMITED_RESPONSE,
            default: PROBLEM_RESPONSE,
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["Discovery"],
          operationId: "getOpenApiDocument",
          summary: "DaloyJS website OpenAPI 3.1 document",
          security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
          responses: {
            "200": {
              description: "This OpenAPI document.",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
            "429": RATE_LIMITED_RESPONSE,
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
      [OAUTH_AS_METADATA_PATH]: {
        get: {
          tags: ["OAuth"],
          operationId: "getOauthAuthorizationServerMetadata",
          summary: "RFC 8414 OAuth 2.0 authorization-server metadata",
          responses: {
            "200": {
              description: "Authorization-server metadata JSON.",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
      [OAUTH_PROTECTED_RESOURCE_PATH]: {
        get: {
          tags: ["OAuth"],
          operationId: "getOauthProtectedResourceMetadata",
          summary: "RFC 9728 OAuth 2.0 protected-resource metadata",
          responses: {
            "200": {
              description: "Protected-resource metadata, including scopes_supported.",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
      "/oauth/token": {
        post: {
          tags: ["OAuth"],
          operationId: "postOauthToken",
          summary: "OAuth 2.0 client_credentials token endpoint",
          description:
            "Public client. Send grant_type=client_credentials and optional scope=docs:read as application/x-www-form-urlencoded. No client_secret.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  required: ["grant_type"],
                  properties: {
                    grant_type: { type: "string", enum: ["client_credentials"] },
                    scope: { type: "string", enum: [DOCS_READ_SCOPE] },
                    client_id: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Access token response (RFC 6749 §5.1).",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TokenResponse" },
                },
              },
            },
            "400": {
              description: "OAuth error (RFC 6749 §5.2).",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OAuthError" },
                },
              },
            },
            "429": RATE_LIMITED_RESPONSE,
          },
        },
      },
      "/mcp": {
        post: {
          tags: ["Docs MCP"],
          operationId: "postMcpJsonRpc",
          summary: "DaloyJS MCP server (JSON-RPC 2.0 over Streamable HTTP)",
          description:
            "Read-only tools: search_docs, get_doc, list_docs. Send JSON-RPC 2.0. GET on this URL returns 405 with a JSON hint. Bearer docs:read is optional.",
          security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
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
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            "400": PROBLEM_RESPONSE,
            "405": PROBLEM_RESPONSE,
            "413": PROBLEM_RESPONSE,
            "429": RATE_LIMITED_RESPONSE,
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
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          description:
            "Optional OAuth 2.0 client_credentials. The only issued scope is docs:read (public documentation). Resources remain usable without a token.",
          flows: {
            clientCredentials: {
              tokenUrl: OAUTH_TOKEN_ENDPOINT,
              scopes: {
                [DOCS_READ_SCOPE]:
                  "Read public DaloyJS documentation, OpenAPI, llms.txt, and the docs MCP server.",
              },
            },
          },
        },
      },
      schemas: {
        Problem: PROBLEM_SCHEMA,
        ApiIndex: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "version", "links"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            version: { type: "string" },
            versioning: { type: "object", additionalProperties: true },
            links: {
              type: "object",
              additionalProperties: { type: "string", format: "uri" },
            },
          },
        },
        TokenResponse: {
          type: "object",
          required: ["access_token", "token_type", "expires_in", "scope"],
          properties: {
            access_token: { type: "string" },
            token_type: { type: "string", enum: ["Bearer"] },
            expires_in: { type: "integer" },
            scope: { type: "string", const: DOCS_READ_SCOPE },
          },
        },
        OAuthError: {
          type: "object",
          required: ["error", "error_description"],
          properties: {
            error: { type: "string" },
            error_description: { type: "string" },
          },
        },
      },
    },
  };
}
