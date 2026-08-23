/**
 * OpenAPI 3.1 document for the HTTP APIs hosted on daloyjs.dev itself
 * (docs MCP, agent discovery, Markdown negotiation, OAuth metadata).
 * This is not the OpenAPI document an application generates with
 * `@daloyjs/core`; that flow is documented at `/docs/openapi`.
 */

import {
  DOCS_READ_SCOPE,
  OAUTH_AS_METADATA_PATH,
  OAUTH_INTROSPECTION_ENDPOINT,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_TOKEN_ENDPOINT,
  SITE_API_LIFECYCLE_DOC_URL,
  SITE_API_SUNSET_NOTICE_DAYS,
  SITE_API_VERSION_ALIASES,
  SITE_API_VERSION_HEADER,
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC,
  SITE_API_V1_PATH,
  SITE_API_VERSION,
  SITE_API_VERSIONING_POLICY,
} from "@/lib/site-api";
import { apiLifecycleSummary } from "@/lib/site-deprecation";
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

/**
 * Lifecycle headers emitted by surfaces that are on the way out. `Deprecation`
 * is an RFC 9745 structured-field Date; `Sunset` is an RFC 8594 IMF-fixdate and
 * only appears once a retirement has been scheduled.
 */
const DEPRECATION_HEADERS = {
  Deprecation: {
    description:
      "RFC 9745 structured-field Date marking when this surface was deprecated, e.g. @1756944000.",
    schema: { type: "string" },
  },
  Sunset: {
    description:
      "RFC 8594 IMF-fixdate for the scheduled retirement. Absent while no retirement is scheduled; never set less than 180 days ahead.",
    schema: { type: "string" },
  },
  Link: {
    description:
      'RFC 8288 relations: rel="deprecation", rel="sunset", rel="successor-version", rel="latest-version".',
    schema: { type: "string" },
  },
} as const;

/**
 * Optional request header an agent can send to pin the URL-path major it was
 * built against. Any other value is a 400 `unsupported_api_version` problem.
 */
const API_VERSION_PARAMETER = {
  name: SITE_API_VERSION_HEADER,
  in: "header",
  required: false,
  description: `Pin the API major. Accepted: ${SITE_API_VERSION_ALIASES.join(", ")}. Any other value returns 400 unsupported_api_version instead of silently serving a different major.`,
  schema: {
    type: "string",
    enum: [...SITE_API_VERSION_ALIASES],
    default: SITE_API_VERSION,
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
        `OAuth 2.0 client_credentials at ${OAUTH_TOKEN_ENDPOINT} issues a Bearer token with scope ${DOCS_READ_SCOPE}. Tokens are optional: every resource here is already public. Named scopes exist so agents request least privilege instead of inferring roles from prose. Metadata: GET ${OAUTH_AS_METADATA_PATH} (RFC 8414) and GET ${OAUTH_PROTECTED_RESOURCE_PATH} (RFC 9728), with per-resource documents at ${OAUTH_PROTECTED_RESOURCE_PATH}/<resource>. Check a token with POST ${OAUTH_INTROSPECTION_ENDPOINT} (RFC 7662).`,
        "The framework's own generated OpenAPI (the spec your app emits) is documented at /docs/openapi.",
      ].join(" "),
      "x-api-lifecycle": apiLifecycleSummary(),
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
    externalDocs: {
      description:
        "Versioning, deprecation, and sunset policy for these endpoints.",
      url: SITE_API_LIFECYCLE_DOC_URL,
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
      {
        name: "Markdown",
        description:
          "Markdown representations of public pages, for agents that would rather not parse HTML.",
      },
    ],
    security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
    paths: {
      [SITE_API_V1_PATH]: {
        get: {
          tags: ["Discovery"],
          operationId: "getApiCatalogV1",
          summary: "JSON index of DaloyJS website APIs (v1)",
          description:
            "The catalog also publishes the whole versioning and deprecation policy under `versioning`, including every surface's status, successor, and sunset date.",
          security: [{ oauth2: [DOCS_READ_SCOPE] }, {}],
          parameters: [API_VERSION_PARAMETER],
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
            "400": {
              description:
                "The API-Version request header pinned a major this origin does not serve (code `unsupported_api_version`).",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/problem+json": {
                  schema: { $ref: "#/components/schemas/Problem" },
                },
              },
            },
            "429": RATE_LIMITED_RESPONSE,
            default: PROBLEM_RESPONSE,
          },
        },
      },
      "/api": {
        get: {
          tags: ["Discovery"],
          operationId: "getApiAlias",
          summary: "Unversioned alias for the current major",
          description:
            'Permanently redirects to /api/v1 so an agent never pins an unversioned path. The redirect carries rel="successor-version" and rel="latest-version" link relations.',
          responses: {
            "308": {
              description: "Permanent redirect to the current major.",
              headers: {
                Location: {
                  description: "The versioned path, e.g. /api/v1.",
                  schema: { type: "string" },
                },
                "API-Version": {
                  description: `Current URL-path major (${SITE_API_VERSION}).`,
                  schema: { type: "string", const: SITE_API_VERSION },
                },
                Link: {
                  description:
                    'RFC 5829 rel="successor-version" and rel="latest-version".',
                  schema: { type: "string" },
                },
              },
            },
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
              description:
                "Protected-resource metadata, including scopes_supported.",
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
                    grant_type: {
                      type: "string",
                      enum: ["client_credentials"],
                    },
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
              headers: RATE_LIMIT_HEADERS,
              content: { "text/plain": { schema: { type: "string" } } },
            },
            "429": RATE_LIMITED_RESPONSE,
          },
        },
      },
      "/oauth/authorize": {
        get: {
          tags: ["OAuth"],
          operationId: "getOauthAuthorize",
          summary: "Authorization endpoint (client_credentials only)",
          description:
            "Advertised by the RFC 8414 metadata. This server implements no browser redirect flow, so it answers with an RFC 6749 §4.1.2.1 unsupported_response_type error pointing at the token endpoint. Probes get live JSON rather than an HTML 404.",
          security: [],
          responses: {
            "400": {
              description: "OAuth error (RFC 6749 §5.2).",
              headers: RATE_LIMIT_HEADERS,
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
      "/oauth/introspect": {
        post: {
          tags: ["OAuth"],
          operationId: "postOauthIntrospect",
          summary: "OAuth 2.0 token introspection (RFC 7662)",
          description:
            "Confirm that a token minted by this origin is still active and which scope it carries. No client authentication: the only issued scope covers public documentation. Unknown or expired tokens return { active: false }.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  required: ["token"],
                  properties: {
                    token: { type: "string" },
                    token_type_hint: {
                      type: "string",
                      enum: ["access_token"],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Introspection response (RFC 7662 §2.2).",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/IntrospectionResponse",
                  },
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
      [`${OAUTH_PROTECTED_RESOURCE_PATH}/{resource}`]: {
        get: {
          tags: ["OAuth"],
          operationId: "getOauthProtectedResourceMetadataForResource",
          summary: "RFC 9728 §3.1 per-resource protected-resource metadata",
          description:
            "Metadata for one resource on this origin, located by inserting the resource path after the well-known prefix. MCP clients resolve /.well-known/oauth-protected-resource/mcp before attaching a token.",
          parameters: [
            {
              name: "resource",
              in: "path",
              required: true,
              description: "Resource path without the leading slash.",
              schema: { type: "string", examples: ["mcp", "api/v1"] },
            },
          ],
          responses: {
            "200": {
              description:
                "Protected-resource metadata, including scopes_supported.",
              headers: RATE_LIMIT_HEADERS,
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
            "404": PROBLEM_RESPONSE,
            "429": RATE_LIMITED_RESPONSE,
          },
        },
      },
      "/md/{path}": {
        get: {
          tags: ["Markdown"],
          operationId: "getPageMarkdown",
          summary: "Markdown representation of any public page",
          description:
            "Also reachable by appending `.md` to a page URL, or by sending `Accept: text/markdown` to the canonical URL. Responses set `Vary: Accept`.",
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              description: "Page path without the leading slash.",
              schema: { type: "string", examples: ["docs/routing"] },
            },
          ],
          responses: {
            "200": {
              description: "Markdown body of the page.",
              headers: RATE_LIMIT_HEADERS,
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            "404": {
              description:
                "No such page. The Markdown body lists recovery entry points.",
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            "429": RATE_LIMITED_RESPONSE,
          },
        },
      },
      "/docs-md/{path}": {
        get: {
          tags: ["Markdown"],
          operationId: "getLegacyDocsMarkdown",
          summary: "Legacy Markdown handler for cached /docs/*.md destinations",
          deprecated: true,
          description: `Deprecated in favour of /md/docs/{path}. Every response carries an RFC 9745 Deprecation date and RFC 8288 deprecation / successor-version relations. No Sunset date is scheduled; one will be announced at least ${SITE_API_SUNSET_NOTICE_DAYS} days ahead. Policy: ${SITE_API_LIFECYCLE_DOC_URL}.`,
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              description: "Docs path without the leading slash.",
              schema: { type: "string", examples: ["routing"] },
            },
          ],
          responses: {
            "200": {
              description: "Markdown body of the docs page.",
              headers: { ...RATE_LIMIT_HEADERS, ...DEPRECATION_HEADERS },
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            "404": {
              description: "No such docs page.",
              headers: { ...RATE_LIMIT_HEADERS, ...DEPRECATION_HEADERS },
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            "429": RATE_LIMITED_RESPONSE,
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
        IntrospectionResponse: {
          type: "object",
          required: ["active"],
          properties: {
            active: { type: "boolean" },
            scope: { type: "string" },
            token_type: { type: "string" },
            iss: { type: "string" },
            aud: { type: "string" },
            iat: { type: "integer" },
            exp: { type: "integer" },
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
