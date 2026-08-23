import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOCS_READ_SCOPE,
  OAUTH_INTROSPECTION_ENDPOINT,
  OAUTH_ISSUER,
  OAUTH_PROTECTED_RESOURCE_PATH,
} from "../../lib/site-api";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  introspectToken,
  issueDocsReadAccessToken,
  PROTECTED_RESOURCE_PATHS,
} from "../../lib/site-oauth";

const { GET: getResourceMetadata } =
  await import("../../app/.well-known/oauth-protected-resource/[...resource]/route");
const { GET: getOriginResourceMetadata } =
  await import("../../app/.well-known/oauth-protected-resource/route");
const { GET: getApiCatalog } =
  await import("../../app/.well-known/api-catalog/route");
const { POST: postIntrospect, GET: getIntrospect } =
  await import("../../app/oauth/introspect/route");

function formPost(body: string): Request {
  return new Request("http://localhost/oauth/introspect", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

test("authorization-server metadata advertises the introspection endpoint", () => {
  const metadata = buildAuthorizationServerMetadata();
  assert.equal(metadata.introspection_endpoint, OAUTH_INTROSPECTION_ENDPOINT);
  assert.deepEqual(metadata.introspection_endpoint_auth_methods_supported, [
    "none",
  ]);
  assert.deepEqual(metadata.scopes_supported, [DOCS_READ_SCOPE]);
});

test("every registered resource publishes scopes_supported", () => {
  assert.ok(PROTECTED_RESOURCE_PATHS.includes("/mcp"));
  for (const path of ["/", ...PROTECTED_RESOURCE_PATHS]) {
    const metadata = buildProtectedResourceMetadata(path);
    assert.ok(metadata, `no metadata registered for ${path}`);
    assert.deepEqual(metadata.scopes_supported, [DOCS_READ_SCOPE]);
    assert.deepEqual(metadata.authorization_servers, [OAUTH_ISSUER]);
  }
});

test("an unregistered resource has no metadata document", () => {
  assert.equal(buildProtectedResourceMetadata("/not-a-resource"), null);
});

test("RFC 9728 per-resource metadata describes the resource it is nested under", async () => {
  const res = await getResourceMetadata(
    new Request(`http://localhost${OAUTH_PROTECTED_RESOURCE_PATH}/mcp`),
    { params: Promise.resolve({ resource: ["mcp"] }) },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    resource: string;
    scopes_supported: string[];
  };
  assert.match(body.resource, /\/mcp$/);
  assert.deepEqual(body.scopes_supported, [DOCS_READ_SCOPE]);
  assert.ok(res.headers.get("ratelimit-policy"));
});

test("nested resource metadata handles multi-segment paths", async () => {
  const res = await getResourceMetadata(
    new Request(`http://localhost${OAUTH_PROTECTED_RESOURCE_PATH}/api/v1`),
    { params: Promise.resolve({ resource: ["api", "v1"] }) },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { resource: string };
  assert.match(body.resource, /\/api\/v1$/);
});

test("unknown resource metadata is a 404 problem, not an invented document", async () => {
  const res = await getResourceMetadata(
    new Request(`http://localhost${OAUTH_PROTECTED_RESOURCE_PATH}/nope`),
    { params: Promise.resolve({ resource: ["nope"] }) },
  );
  assert.equal(res.status, 404);
  assert.equal(
    res.headers.get("content-type"),
    "application/problem+json; charset=utf-8",
  );
  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "not_found");
});

test("the origin-wide protected-resource document still resolves", async () => {
  const res = getOriginResourceMetadata(
    new Request(`http://localhost${OAUTH_PROTECTED_RESOURCE_PATH}`),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { resource: string };
  assert.match(body.resource, /\/$/);
});

test("the API catalog links the OAuth metadata documents", async () => {
  const res = getApiCatalog(
    new Request("http://localhost/.well-known/api-catalog"),
  );
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("ratelimit-policy"));
  const body = (await res.json()) as {
    linkset: Array<{
      describedby: Array<{ href: string }>;
      item: Array<{ href: string }>;
    }>;
  };
  const described =
    body.linkset[0]?.describedby.map((entry) => entry.href) ?? [];
  assert.ok(
    described.some((href) =>
      href.endsWith("/.well-known/oauth-protected-resource"),
    ),
  );
  assert.ok(
    described.some((href) =>
      href.endsWith("/.well-known/oauth-protected-resource/mcp"),
    ),
  );
  const items = body.linkset[0]?.item.map((entry) => entry.href) ?? [];
  assert.ok(items.includes(OAUTH_INTROSPECTION_ENDPOINT));
});

test("introspection reports an issued token as active with its scope", async () => {
  const token = issueDocsReadAccessToken();
  const res = await postIntrospect(formPost(`token=${token}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as {
    active: boolean;
    scope: string;
    exp: number;
  };
  assert.equal(body.active, true);
  assert.equal(body.scope, DOCS_READ_SCOPE);
  assert.equal(typeof body.exp, "number");
});

test("introspection reports a forged or expired token as inactive", async () => {
  const expired = issueDocsReadAccessToken(1, 1_000_000);
  for (const token of ["not-a-token", "a.b.c", expired]) {
    const result = introspectToken(new URLSearchParams(`token=${token}`));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.body, { active: false });
  }
});

test("introspection rejects a missing token and an unsupported hint", () => {
  const missing = introspectToken(new URLSearchParams(""));
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.body.error, "invalid_request");

  const hinted = introspectToken(
    new URLSearchParams("token=x&token_type_hint=refresh_token"),
  );
  assert.equal(hinted.ok, false);
  assert.equal(
    hinted.ok === false && hinted.body.error,
    "unsupported_token_type",
  );
});

test("introspection requires form encoding and rejects GET", async () => {
  const wrongType = await postIntrospect(
    new Request("http://localhost/oauth/introspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "x" }),
    }),
  );
  assert.equal(wrongType.status, 400);

  const viaGet = getIntrospect(
    new Request("http://localhost/oauth/introspect"),
  );
  assert.equal(viaGet.status, 405);
  assert.equal(viaGet.headers.get("allow"), "POST, OPTIONS");
});
