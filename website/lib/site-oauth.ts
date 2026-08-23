/**
 * OAuth 2.0 authorization-server and protected-resource metadata for
 * daloyjs.dev, plus the client_credentials token grant.
 *
 * This origin's HTTP APIs are public documentation. They do not require a
 * token. The authorization server exists so agents can discover a named scope
 * (`docs:read`) and obtain a Bearer token that declares least privilege,
 * matching RFC 8414, RFC 9728, and OpenAPI oauth2 scopes.
 *
 * Only `client_credentials` is supported. There is no login UI, no refresh
 * tokens, and no access beyond already-public docs. HMAC-SHA256 JWTs are
 * signed with `DALOY_SITE_OAUTH_SECRET` when set, otherwise a site-derived
 * key that is enough to mint/verify tokens on this origin for the public
 * scope (it is not a credential for anyone's DaloyJS app).
 *
 * @see https://www.rfc-editor.org/rfc/rfc8414
 * @see https://www.rfc-editor.org/rfc/rfc9728
 * @see https://www.rfc-editor.org/rfc/rfc6749
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

import {
  ACCESS_TOKEN_TTL_SEC,
  DOCS_READ_SCOPE,
  OAUTH_AS_METADATA_PATH,
  OAUTH_AUTHORIZATION_ENDPOINT,
  OAUTH_ISSUER,
  OAUTH_TOKEN_ENDPOINT,
} from "@/lib/site-api";
import { SITE_URL } from "@/lib/seo";

function hmacSecret(): Buffer {
  const fromEnv = process.env.DALOY_SITE_OAUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    return Buffer.from(fromEnv, "utf8");
  }
  return createHash("sha256")
    .update(`daloyjs-docs-read:${OAUTH_ISSUER}`)
    .digest();
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

/**
 * RFC 8414 authorization-server metadata for this origin.
 *
 * `issuer` is the origin with no path. `authorization_endpoint` is published
 * so probes get a live URL; the grant that uses it is not implemented, and
 * that endpoint says so. `token_endpoint` implements client_credentials.
 */
export function buildAuthorizationServerMetadata(): Record<string, unknown> {
  return {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: OAUTH_AUTHORIZATION_ENDPOINT,
    token_endpoint: OAUTH_TOKEN_ENDPOINT,
    scopes_supported: [DOCS_READ_SCOPE],
    response_types_supported: ["token"],
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${SITE_URL}/docs/mcp`,
    ui_locales_supported: ["en"],
    protected_resources: [`${SITE_URL}/`],
    op_policy_uri: `${SITE_URL}/privacy`,
    op_tos_uri: `${SITE_URL}/privacy`,
  };
}

/**
 * RFC 9728 protected-resource metadata. `scopes_supported` is the
 * machine-readable permission list agents need; the resource stays usable
 * without a bearer token.
 */
export function buildProtectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: `${SITE_URL}/`,
    authorization_servers: [OAUTH_ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [DOCS_READ_SCOPE],
    resource_name: "DaloyJS website APIs",
    resource_documentation: `${SITE_URL}/openapi.json`,
    resource_policy_uri: `${SITE_URL}/privacy`,
  };
}

/**
 * Mint an HS256 JWT access token for `docs:read`.
 *
 * @param ttlSec - Lifetime in seconds.
 * @param nowSec - Issued-at timestamp (injectable for tests).
 */
export function issueDocsReadAccessToken(
  ttlSec = ACCESS_TOKEN_TTL_SEC,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: OAUTH_ISSUER,
      aud: OAUTH_ISSUER,
      iat: nowSec,
      exp: nowSec + ttlSec,
      scope: DOCS_READ_SCOPE,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = createHmac("sha256", hmacSecret())
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(sig)}`;
}

/**
 * Verify an access token minted by {@link issueDocsReadAccessToken}.
 *
 * @param token - Compact JWT.
 * @returns `true` when the signature, issuer, audience, expiry, and scope match.
 */
export function verifyDocsReadAccessToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return false;
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", hmacSecret())
    .update(signingInput)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as {
      iss?: string;
      aud?: string;
      exp?: number;
      scope?: string;
    };
    if (payload.iss !== OAUTH_ISSUER || payload.aud !== OAUTH_ISSUER) {
      return false;
    }
    if (payload.scope !== DOCS_READ_SCOPE) {
      return false;
    }
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * RFC 6749 §5.2 error body.
 *
 * @param error - OAuth error code.
 * @param description - Human-readable explanation.
 */
export function oauthErrorBody(
  error: string,
  description: string,
): Record<string, string> {
  return { error, error_description: description };
}

/**
 * Parse a client_credentials token request and return either a token payload
 * or an OAuth error. Unknown scopes are rejected so agents cannot mint a
 * permission this origin does not have.
 *
 * @param params - application/x-www-form-urlencoded fields.
 */
export function handleClientCredentialsGrant(
  params: URLSearchParams,
):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, string> } {
  const grantType = params.get("grant_type");
  if (!grantType) {
    return {
      ok: false,
      status: 400,
      body: oauthErrorBody(
        "invalid_request",
        "grant_type is required. This server supports client_credentials only.",
      ),
    };
  }
  if (grantType !== "client_credentials") {
    return {
      ok: false,
      status: 400,
      body: oauthErrorBody(
        "unsupported_grant_type",
        "This authorization server supports grant_type=client_credentials only. See GET " +
          OAUTH_AS_METADATA_PATH +
          ".",
      ),
    };
  }

  const requested = (params.get("scope") ?? DOCS_READ_SCOPE)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (requested.length === 0) {
    requested.push(DOCS_READ_SCOPE);
  }
  if (requested.some((scope) => scope !== DOCS_READ_SCOPE)) {
    return {
      ok: false,
      status: 400,
      body: oauthErrorBody(
        "invalid_scope",
        `Supported scopes: ${DOCS_READ_SCOPE}. This origin does not issue application or user scopes.`,
      ),
    };
  }

  return {
    ok: true,
    body: {
      access_token: issueDocsReadAccessToken(),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: DOCS_READ_SCOPE,
    },
  };
}
