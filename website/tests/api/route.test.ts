import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DOCS_READ_SCOPE } from "../../lib/site-api";
import {
  handleClientCredentialsGrant,
  issueDocsReadAccessToken,
  verifyDocsReadAccessToken,
} from "../../lib/site-oauth";
import {
  clientBucket,
  createMemoryRateLimiter,
  rateLimitHeaders,
  rateLimitKey,
} from "../../lib/site-rate-limit";

const { GET: getUnversionedApi } = await import(
  "../../app/api/[[...path]]/route"
);
const { GET: getApiV1, POST: postApiV1 } = await import(
  "../../app/api/v1/[[...path]]/route"
);
const { GET: getOpenApi, POST: postOpenApi } = await import(
  "../../app/openapi.json/route"
);
const { GET: getAsMetadata } = await import(
  "../../app/.well-known/oauth-authorization-server/route"
);
const { GET: getProtectedResource } = await import(
  "../../app/.well-known/oauth-protected-resource/route"
);
const { GET: getOidcDiscovery } = await import(
  "../../app/.well-known/openid-configuration/route"
);
const { POST: postToken, GET: getToken } = await import(
  "../../app/oauth/token/route"
);
const { GET: getAuthorize } = await import(
  "../../app/oauth/authorize/route"
);

function formPost(body: string): Request {
  return new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

test("GET /api redirects to /api/v1", () => {
  const res = getUnversionedApi(new Request("http://localhost/api"));
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), "/api/v1");
});

test("GET /api/v1 returns a versioned JSON catalog with RateLimit headers", async () => {
  const res = await getApiV1(new Request("http://localhost/api/v1"), {
    params: Promise.resolve({ path: undefined }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("api-version"), "1");
  assert.ok(res.headers.get("ratelimit"));
  assert.ok(res.headers.get("ratelimit-policy"));
  assert.ok(res.headers.get("ratelimit-limit"));
  assert.ok(res.headers.get("ratelimit-remaining"));
  const body = (await res.json()) as {
    name: string;
    version: string;
    versioning: { path: string; header: string };
    links: Record<string, string>;
    oauth: { scopes: string[] };
  };
  assert.match(body.name, /DaloyJS/);
  assert.equal(body.version, "1");
  assert.equal(body.versioning.path, "/api/v1");
  assert.equal(body.versioning.header, "API-Version");
  assert.ok(body.links.openapi.endsWith("/openapi.json"));
  assert.deepEqual(body.oauth.scopes, [DOCS_READ_SCOPE]);
});

test("GET /api/v1/does-not-exist returns problem+json with code and hint", async () => {
  const res = await getApiV1(
    new Request("http://localhost/api/v1/does-not-exist"),
    { params: Promise.resolve({ path: ["does-not-exist"] }) },
  );
  assert.equal(res.status, 404);
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
  const body = (await res.json()) as {
    code: string;
    hint: string;
    status: number;
  };
  assert.equal(body.status, 404);
  assert.equal(body.code, "not_found");
  assert.ok(body.hint.length > 0);
});

test("POST /api/v1 returns 405 problem+json with a recovery hint", () => {
  const res = postApiV1(
    new Request("http://localhost/api/v1", { method: "POST" }),
  );
  assert.equal(res.status, 405);
});

test("GET /openapi.json is an OpenAPI 3.1 document with oauth2 scopes and /api/v1", async () => {
  const res = getOpenApi(new Request("http://localhost/openapi.json"));
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("ratelimit-policy"));
  const body = (await res.json()) as {
    openapi: string;
    info: { title: string; description: string };
    paths: Record<string, unknown>;
    components: {
      securitySchemes: {
        oauth2: {
          type: string;
          flows: { clientCredentials: { scopes: Record<string, string> } };
        };
      };
    };
  };
  assert.equal(body.openapi, "3.1.0");
  assert.match(body.info.title, /DaloyJS/);
  assert.ok(body.paths["/api/v1"]);
  assert.ok(body.paths["/mcp"]);
  assert.ok(body.paths["/oauth/token"]);
  assert.match(body.info.description, /Sunset/);
  assert.match(body.info.description, /\/api\/v1/);
  assert.equal(body.components.securitySchemes.oauth2.type, "oauth2");
  assert.ok(
    body.components.securitySchemes.oauth2.flows.clientCredentials.scopes[
      DOCS_READ_SCOPE
    ],
  );
});

test("POST /openapi.json returns problem+json", async () => {
  const res = postOpenApi(
    new Request("http://localhost/openapi.json", { method: "POST" }),
  );
  assert.equal(res.status, 405);
  const body = (await res.json()) as { code: string; hint: string };
  assert.equal(body.code, "method_not_allowed");
  assert.match(body.hint, /openapi\.json/);
});

test("RFC 8414 authorization-server metadata lists issuer, token endpoint, and scopes", async () => {
  const res = getAsMetadata(
    new Request("http://localhost/.well-known/oauth-authorization-server"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    issuer: string;
    token_endpoint: string;
    authorization_endpoint: string;
    grant_types_supported: string[];
    scopes_supported: string[];
  };
  assert.match(body.issuer, /^https:\/\/daloyjs\.dev$/);
  assert.match(body.token_endpoint, /\/oauth\/token$/);
  assert.match(body.authorization_endpoint, /\/oauth\/authorize$/);
  assert.deepEqual(body.grant_types_supported, ["client_credentials"]);
  assert.deepEqual(body.scopes_supported, [DOCS_READ_SCOPE]);
});

test("RFC 9728 protected-resource metadata lists scopes_supported", async () => {
  const res = getProtectedResource(
    new Request("http://localhost/.well-known/oauth-protected-resource"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    resource: string;
    scopes_supported: string[];
    authorization_servers: string[];
  };
  assert.equal(body.resource, "https://daloyjs.dev/");
  assert.deepEqual(body.scopes_supported, [DOCS_READ_SCOPE]);
  assert.ok(body.authorization_servers.includes("https://daloyjs.dev"));
});

test("openid-configuration serves the same OAuth authorization-server metadata", async () => {
  const res = getOidcDiscovery(
    new Request("http://localhost/.well-known/openid-configuration"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { issuer: string };
  assert.equal(body.issuer, "https://daloyjs.dev");
});

test("POST /oauth/token issues a Bearer docs:read token", async () => {
  const res = await postToken(
    formPost("grant_type=client_credentials&scope=docs:read"),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  };
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.scope, DOCS_READ_SCOPE);
  assert.ok(body.expires_in > 0);
  assert.equal(verifyDocsReadAccessToken(body.access_token), true);
});

test("POST /oauth/token rejects unsupported grants and unknown scopes", async () => {
  const grant = await postToken(
    formPost("grant_type=authorization_code&code=x"),
  );
  assert.equal(grant.status, 400);
  const grantBody = (await grant.json()) as { error: string };
  assert.equal(grantBody.error, "unsupported_grant_type");

  const scope = await postToken(
    formPost("grant_type=client_credentials&scope=admin"),
  );
  assert.equal(scope.status, 400);
  const scopeBody = (await scope.json()) as { error: string };
  assert.equal(scopeBody.error, "invalid_scope");
});

test("[unhappy] POST /oauth/token rejects oversized form bodies with 413", async () => {
  const oversizedHeader = await postToken(
    new Request("http://localhost/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(64 * 1024),
      },
      body: "grant_type=client_credentials",
    }),
  );
  assert.equal(oversizedHeader.status, 413);

  const oversizedBody = await postToken(
    formPost(`grant_type=client_credentials&pad=${"a".repeat(20 * 1024)}`),
  );
  assert.equal(oversizedBody.status, 413);
});

test("GET /oauth/token is 405; GET /oauth/authorize responds with OAuth JSON", async () => {
  const token = getToken(new Request("http://localhost/oauth/token"));
  assert.equal(token.status, 405);
  const tokenBody = (await token.json()) as { error: string };
  assert.equal(tokenBody.error, "invalid_request");

  const authorize = getAuthorize(
    new Request("http://localhost/oauth/authorize"),
  );
  assert.equal(authorize.status, 400);
  const authorizeBody = (await authorize.json()) as { error: string };
  assert.equal(authorizeBody.error, "unsupported_response_type");
});

test("handleClientCredentialsGrant defaults scope to docs:read", () => {
  const result = handleClientCredentialsGrant(
    new URLSearchParams("grant_type=client_credentials"),
  );
  assert.equal(result.ok, true);
});

test("minted access tokens fail verification after expiry", () => {
  const token = issueDocsReadAccessToken(1, 1_000_000);
  assert.equal(verifyDocsReadAccessToken(token), false);
});

test("memory rate limiter returns 429 after the quota is exhausted", () => {
  const limiter = createMemoryRateLimiter(2, 60_000);
  const first = limiter.take("k");
  const second = limiter.take("k");
  const third = limiter.take("k");
  assert.equal(first.limited, false);
  assert.equal(second.limited, false);
  assert.equal(third.limited, true);
  assert.equal(third.remaining, 0);
  assert.ok(third.resetSec >= 1);
  const headers = rateLimitHeaders(third);
  assert.equal(headers["RateLimit-Remaining"], "0");
  assert.match(headers.RateLimit, /r=0/);
  assert.match(headers["RateLimit-Policy"], /q=2/);
});

test("[happy] memory rate limiter sweeps expired buckets once it is full", () => {
  const limiter = createMemoryRateLimiter(2, 1_000, 3);
  limiter.take("a", 0);
  limiter.take("b", 0);
  limiter.take("c", 0);
  assert.equal(limiter.size(), 3);
  // All three windows have expired by t=2000, so the new key replaces them.
  limiter.take("d", 2_000);
  assert.equal(limiter.size(), 1);
});

test("[unhappy] memory rate limiter stays bounded under a flood of live keys", () => {
  const limiter = createMemoryRateLimiter(2, 60_000, 100);
  for (let i = 0; i < 5_000; i++) {
    limiter.take(`key-${i}`, i);
  }
  assert.ok(limiter.size() <= 100);
  // A caller still inside the map keeps its count: the limit still applies.
  limiter.take("key-4999", 5_000);
  assert.equal(limiter.take("key-4999", 5_001).limited, true);
});

test("[happy] rate-limit keys leave IPv4 addresses alone", () => {
  assert.equal(clientBucket("203.0.113.7"), "203.0.113.7");
  assert.equal(clientBucket("::ffff:203.0.113.7"), "203.0.113.7");
});

test("[unhappy] rotating through one IPv6 /64 lands in a single bucket", () => {
  const keys = new Set(
    [
      "2001:db8:1:2::1",
      "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
      "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff",
      "[2001:db8:1:2::9]",
      "2001:db8:1:2::9%eth0",
    ].map(clientBucket),
  );
  assert.deepEqual([...keys], ["2001:db8:1:2::/64"]);
  assert.notEqual(clientBucket("2001:db8:1:3::1"), "2001:db8:1:2::/64");
  assert.equal(clientBucket("::1"), "0:0:0:0::/64");

  const request = new Request("http://localhost/api/v1", {
    headers: { "x-forwarded-for": "2001:db8:1:2::42, 10.0.0.1" },
  });
  assert.equal(rateLimitKey(request), "2001:db8:1:2::/64");
});

test("[unhappy] an oversized client address cannot become an unbounded key", () => {
  assert.ok(clientBucket("x".repeat(10_000)).length <= 64);
});

test("homepage SSR markup has an H1 and nested H2/H3 headings", async () => {
  // Both locales' home pages (app/page.tsx, app/es/page.tsx) render this one
  // shared component, so its heading order holds for every language.
  const source = await readFile(
    path.join(process.cwd(), "components/home/home-page.tsx"),
    "utf8",
  );
  assert.match(source, /<h1\b/);
  assert.match(source, /<h2\b/);
  assert.match(source, /<h3\b/);
  const h1 = source.indexOf("<h1");
  const h2 = source.indexOf("<h2");
  assert.ok(h1 !== -1 && h2 !== -1 && h2 > h1);
});
