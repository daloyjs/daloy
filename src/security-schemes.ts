/**
 * Ergonomic builders for OpenAPI 3.1 Security Scheme objects.
 *
 * These return plain JSON objects shaped exactly like the spec expects, so the
 * output of any builder can be dropped straight into
 * `generateOpenAPI(app, { securitySchemes: { ... } })`.
 *
 * Spec reference:
 *   https://spec.openapis.org/oas/v3.1.0#security-scheme-object
 */

/** Location where an API key is presented on the request. */
export type ApiKeyLocation = "header" | "query" | "cookie";

/** Options for {@link httpBearerScheme}. */
export interface HttpBearerSchemeOptions {
  /** Hint about the bearer token format (e.g. "JWT"). */
  bearerFormat?: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
  /** Require payload/body authentication for routes using this scheme. */
  requirePayloadAuth?: boolean;
}

/** Options for {@link httpBasicScheme}. */
export interface HttpBasicSchemeOptions {
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
  /** Require payload/body authentication for routes using this scheme. */
  requirePayloadAuth?: boolean;
}

/** Options for {@link apiKeyScheme}. */
export interface ApiKeySchemeOptions {
  /** Where the key is presented: `"header"`, `"query"`, or `"cookie"`. */
  in: ApiKeyLocation;
  /** Name of the header, query parameter, or cookie that carries the key. */
  name: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
  /** Require payload/body authentication for routes using this scheme. */
  requirePayloadAuth?: boolean;
}

/** OAuth2 Implicit flow object (deprecated in OAuth 2.1 but still part of OpenAPI). */
export interface OAuth2ImplicitFlow {
  /** Authorization endpoint URL (OpenAPI `authorizationUrl`; must be TLS). */
  authorizationUrl: string;
  /** Optional URL for obtaining refresh tokens. */
  refreshUrl?: string;
  /** Map of scope name to short description. May be empty. */
  scopes: Record<string, string>;
}

/** OAuth2 Resource Owner Password Credentials flow object. */
export interface OAuth2PasswordFlow {
  /** Token endpoint URL (OpenAPI `tokenUrl`; must be TLS). */
  tokenUrl: string;
  /** Optional URL for obtaining refresh tokens. */
  refreshUrl?: string;
  /** Map of scope name to short description. May be empty. */
  scopes: Record<string, string>;
}

/** OAuth2 Client Credentials flow object. */
export interface OAuth2ClientCredentialsFlow {
  /** Token endpoint URL (OpenAPI `tokenUrl`; must be TLS). */
  tokenUrl: string;
  /** Optional URL for obtaining refresh tokens. */
  refreshUrl?: string;
  /** Map of scope name to short description. May be empty. */
  scopes: Record<string, string>;
}

/** OAuth2 Authorization Code flow object (the recommended interactive flow). */
export interface OAuth2AuthorizationCodeFlow {
  /** Authorization endpoint URL (OpenAPI `authorizationUrl`; must be TLS). */
  authorizationUrl: string;
  /** Token endpoint URL (OpenAPI `tokenUrl`; must be TLS). */
  tokenUrl: string;
  /** Optional URL for obtaining refresh tokens. */
  refreshUrl?: string;
  /** Map of scope name to short description. May be empty. */
  scopes: Record<string, string>;
}

/** Container for all OAuth2 flows supported by a single scheme. At least one entry is required. */
export interface OAuth2Flows {
  /** Implicit flow (deprecated in OAuth 2.1; avoid for new APIs). */
  implicit?: OAuth2ImplicitFlow;
  /** Resource Owner Password Credentials flow. */
  password?: OAuth2PasswordFlow;
  /** Client Credentials flow (machine-to-machine). */
  clientCredentials?: OAuth2ClientCredentialsFlow;
  /** Authorization Code flow (the recommended interactive flow). */
  authorizationCode?: OAuth2AuthorizationCodeFlow;
}

/** Options for {@link oauth2Scheme}. */
export interface OAuth2SchemeOptions {
  /** Supported OAuth2 flows. At least one entry is required. */
  flows: OAuth2Flows;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
  /** Require payload/body authentication for routes using this scheme. */
  requirePayloadAuth?: boolean;
}

/** Options for {@link openIdConnectScheme}. */
export interface OpenIdConnectSchemeOptions {
  /** OpenID Connect Discovery URL (typically ends in `/.well-known/openid-configuration`). */
  openIdConnectUrl: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
  /** Require payload/body authentication for routes using this scheme. */
  requirePayloadAuth?: boolean;
}

/** OpenAPI specification extension marking a security scheme as requiring signed/payload authentication. */
export const REQUIRE_PAYLOAD_AUTH_EXTENSION = "x-daloy-require-payload-auth" as const;

/** Mixin shape for schemes that opt into payload authentication via {@link REQUIRE_PAYLOAD_AUTH_EXTENSION}. */
export interface RequirePayloadAuthExtension {
  /** Set to `true` when routes using this scheme must also pass payload (signed body) authentication. */
  readonly [REQUIRE_PAYLOAD_AUTH_EXTENSION]?: true;
}

/** OpenAPI HTTP Bearer security scheme returned by {@link httpBearerScheme}. */
export interface HttpBearerScheme extends RequirePayloadAuthExtension {
  /** OpenAPI security scheme `type` discriminant. Always `"http"`. */
  type: "http";
  /** HTTP auth scheme name per RFC 9110. Always `"bearer"`. */
  scheme: "bearer";
  /** Hint about the bearer token format (e.g. "JWT"). */
  bearerFormat?: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
}

/** OpenAPI HTTP Basic security scheme returned by {@link httpBasicScheme}. */
export interface HttpBasicScheme extends RequirePayloadAuthExtension {
  /** OpenAPI security scheme `type` discriminant. Always `"http"`. */
  type: "http";
  /** HTTP auth scheme name per RFC 9110. Always `"basic"`. */
  scheme: "basic";
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
}

/** OpenAPI API-key security scheme returned by {@link apiKeyScheme}. */
export interface ApiKeyScheme extends RequirePayloadAuthExtension {
  /** OpenAPI security scheme `type` discriminant. Always `"apiKey"`. */
  type: "apiKey";
  /** Where the key is presented: `"header"`, `"query"`, or `"cookie"`. */
  in: ApiKeyLocation;
  /** Name of the header, query parameter, or cookie that carries the key. */
  name: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
}

/** OpenAPI OAuth2 security scheme returned by {@link oauth2Scheme}. */
export interface OAuth2Scheme extends RequirePayloadAuthExtension {
  /** OpenAPI security scheme `type` discriminant. Always `"oauth2"`. */
  type: "oauth2";
  /** Supported OAuth2 flows (at least one entry). */
  flows: OAuth2Flows;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
}

/** OpenAPI OpenID Connect security scheme returned by {@link openIdConnectScheme}. */
export interface OpenIdConnectScheme extends RequirePayloadAuthExtension {
  /** OpenAPI security scheme `type` discriminant. Always `"openIdConnect"`. */
  type: "openIdConnect";
  /** OpenID Connect Discovery URL (typically ends in `/.well-known/openid-configuration`). */
  openIdConnectUrl: string;
  /** Human-readable description shown in the generated docs (CommonMark). */
  description?: string;
}

/** Union of every concrete security scheme this module can build. */
export type SecurityScheme =
  | HttpBearerScheme
  | HttpBasicScheme
  | ApiKeyScheme
  | OAuth2Scheme
  | OpenIdConnectScheme;

function markRequirePayloadAuth<T extends RequirePayloadAuthExtension>(
  scheme: T,
  options: { requirePayloadAuth?: boolean },
): T {
  if (options.requirePayloadAuth === true) {
    (scheme as Record<string, unknown>)[REQUIRE_PAYLOAD_AUTH_EXTENSION] = true;
  }
  return scheme;
}

/**
 * Returns `true` when `scheme` opts into payload (signed body) authentication
 * via either the legacy `requirePayloadAuth` flag or the canonical
 * {@link REQUIRE_PAYLOAD_AUTH_EXTENSION} OpenAPI extension.
 *
 * @param scheme - Candidate security scheme object (non-objects are tolerated).
 * @returns `true` when payload auth is required; `false` otherwise.
 */
export function securitySchemeRequiresPayloadAuth(scheme: unknown): boolean {
  if (!scheme || typeof scheme !== "object") return false;
  const record = scheme as Record<string, unknown>;
  return (
    record[REQUIRE_PAYLOAD_AUTH_EXTENSION] === true ||
    record.requirePayloadAuth === true
  );
}

/**
 * Normalize a builder output into a spec-compliant OpenAPI security scheme by
 * stripping the convenience `requirePayloadAuth` flag and emitting the
 * canonical {@link REQUIRE_PAYLOAD_AUTH_EXTENSION} extension instead.
 *
 * @param scheme - Candidate security scheme object (non-objects pass through untouched).
 * @returns A copy without `requirePayloadAuth` (extension set when it was `true`), or the input itself when no normalization is needed.
 */
export function toOpenAPISecurityScheme(scheme: unknown): unknown {
  if (!scheme || typeof scheme !== "object") return scheme;
  const record = scheme as Record<string, unknown>;
  if (!("requirePayloadAuth" in record)) return scheme;
  const out: Record<string, unknown> = { ...record };
  const requiresPayloadAuth = securitySchemeRequiresPayloadAuth(record);
  delete out.requirePayloadAuth;
  if (requiresPayloadAuth) out[REQUIRE_PAYLOAD_AUTH_EXTENSION] = true;
  return out;
}

/**
 * Build an OpenAPI Security Scheme Object for HTTP Bearer authentication
 * (e.g. `Authorization: Bearer <token>`).
 *
 * @example
 * ```ts
 * import { App, httpBearerScheme } from "@daloyjs/core";
 * import { generateOpenAPI } from "@daloyjs/core/openapi";
 *
 * const app = new App();
 * const doc = generateOpenAPI(app, {
 *   info: { title: "Books API", version: "1.0.0" },
 *   securitySchemes: { bearerAuth: httpBearerScheme({ bearerFormat: "JWT" }) },
 * });
 * ```
 *
 * @param options - Optional `bearerFormat` hint and `description`.
 * @returns A spec-shaped `{ type, scheme, ... }` object.
 * @since 0.1.0
 */
export function httpBearerScheme(options: HttpBearerSchemeOptions = {}): HttpBearerScheme {
  const scheme: HttpBearerScheme = { type: "http", scheme: "bearer" };
  if (options.bearerFormat !== undefined) scheme.bearerFormat = options.bearerFormat;
  if (options.description !== undefined) scheme.description = options.description;
  return markRequirePayloadAuth(scheme, options);
}

/**
 * Build an OpenAPI Security Scheme Object for HTTP Basic authentication
 * (`Authorization: Basic <base64>`).
 *
 * @param options - Optional human-readable `description`.
 * @returns A spec-shaped `{ type: "http", scheme: "basic", ... }` object.
 * @since 0.1.0
 */
export function httpBasicScheme(options: HttpBasicSchemeOptions = {}): HttpBasicScheme {
  const scheme: HttpBasicScheme = { type: "http", scheme: "basic" };
  if (options.description !== undefined) scheme.description = options.description;
  return markRequirePayloadAuth(scheme, options);
}

/**
 * Build an OpenAPI Security Scheme Object for an API key delivered in a
 * request header, query parameter, or cookie.
 *
 * @example
 * ```ts
 * apiKeyScheme({ in: "header", name: "x-api-key" })
 * ```
 *
 * @param options - Required `in` location and `name`, plus optional `description`.
 * @returns A spec-shaped `{ type: "apiKey", in, name, ... }` object.
 * @throws {TypeError} When `in` is not `"header" | "query" | "cookie"` or `name` is empty.
 * @since 0.1.0
 */
export function apiKeyScheme(options: ApiKeySchemeOptions): ApiKeyScheme {
  if (options.in !== "header" && options.in !== "query" && options.in !== "cookie") {
    throw new TypeError(
      `apiKeyScheme: "in" must be one of "header" | "query" | "cookie", got "${String(options.in)}"`
    );
  }
  if (typeof options.name !== "string" || options.name.length === 0) {
    throw new TypeError(`apiKeyScheme: "name" must be a non-empty string`);
  }
  const scheme: ApiKeyScheme = {
    type: "apiKey",
    in: options.in,
    name: options.name,
  };
  if (options.description !== undefined) scheme.description = options.description;
  return markRequirePayloadAuth(scheme, options);
}

/**
 * Build an OpenAPI Security Scheme Object for OAuth 2.0. At least one flow
 * (implicit, password, client credentials, or authorization code) must be
 * declared.
 *
 * @example
 * ```ts
 * oauth2Scheme({
 *   flows: {
 *     authorizationCode: {
 *       authorizationUrl: "https://example.com/oauth/authorize",
 *       tokenUrl: "https://example.com/oauth/token",
 *       scopes: { "orders:read": "Read your orders" },
 *     },
 *   },
 * })
 * ```
 *
 * @param options - Object with at least one `flows.*` entry.
 * @returns A spec-shaped `{ type: "oauth2", flows, ... }` object.
 * @throws {TypeError} When no OAuth2 flow is declared.
 * @since 0.1.0
 */
export function oauth2Scheme(options: OAuth2SchemeOptions): OAuth2Scheme {
  const flows = options.flows ?? {};
  const hasFlow =
    flows.implicit !== undefined ||
    flows.password !== undefined ||
    flows.clientCredentials !== undefined ||
    flows.authorizationCode !== undefined;
  if (!hasFlow) {
    throw new TypeError(`oauth2Scheme: at least one OAuth2 flow is required`);
  }
  const scheme: OAuth2Scheme = { type: "oauth2", flows };
  if (options.description !== undefined) scheme.description = options.description;
  return markRequirePayloadAuth(scheme, options);
}

/**
 * Build an OpenAPI Security Scheme Object for OpenID Connect Discovery.
 * The `openIdConnectUrl` must be a non-empty string (typically ending in
 * `/.well-known/openid-configuration`).
 *
 * @param options - Object with the required `openIdConnectUrl`.
 * @returns A spec-shaped `{ type: "openIdConnect", openIdConnectUrl, ... }` object.
 * @throws {TypeError} When `openIdConnectUrl` is missing or empty.
 * @since 0.1.0
 */
export function openIdConnectScheme(
  options: OpenIdConnectSchemeOptions
): OpenIdConnectScheme {
  if (typeof options.openIdConnectUrl !== "string" || options.openIdConnectUrl.length === 0) {
    throw new TypeError(
      `openIdConnectScheme: "openIdConnectUrl" must be a non-empty string`
    );
  }
  const scheme: OpenIdConnectScheme = {
    type: "openIdConnect",
    openIdConnectUrl: options.openIdConnectUrl,
  };
  if (options.description !== undefined) scheme.description = options.description;
  return markRequirePayloadAuth(scheme, options);
}
