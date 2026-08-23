import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * The llms.txt handlers enumerate docs pages, which calls `cacheLife()` from
 * `next/cache`. That throws outside the Next.js runtime, so stub it before any
 * route module is imported (see tests/lib/docs-content.test.ts).
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

import {
  SITE_API_RATE_LIMIT,
  SITE_API_RATE_WINDOW_SEC,
  SITE_API_VERSION,
} from "../../lib/site-api";
import { consumeSiteApiQuota } from "../../lib/site-api-response";

const { GET: getSiteLlmsTxt } = await import("../../app/llms.txt/route");
const { GET: getDocsLlmsTxt } = await import("../../app/docs/llms.txt/route");
const { GET: getOpenApi } = await import("../../app/openapi.json/route");
const { GET: getApiCatalog } =
  await import("../../app/.well-known/api-catalog/route");
const { GET: getAsMetadata } =
  await import("../../app/.well-known/oauth-authorization-server/route");

/**
 * Every agent-facing endpoint must advertise the quota, not just the JSON
 * ones. An agent bulk-reading Markdown or llms.txt has the same need to
 * self-throttle as one calling /api/v1.
 */
const ENDPOINTS: ReadonlyArray<{
  name: string;
  url: string;
  call: (request: Request) => Response | Promise<Response>;
}> = [
  {
    name: "GET /llms.txt",
    url: "http://localhost/llms.txt",
    call: (request) => getSiteLlmsTxt(request),
  },
  {
    name: "GET /docs/llms.txt",
    url: "http://localhost/docs/llms.txt",
    call: (request) => getDocsLlmsTxt(request),
  },
  {
    name: "GET /openapi.json",
    url: "http://localhost/openapi.json",
    call: (request) => getOpenApi(request),
  },
  {
    name: "GET /.well-known/api-catalog",
    url: "http://localhost/.well-known/api-catalog",
    call: (request) => getApiCatalog(request),
  },
  {
    name: "GET /.well-known/oauth-authorization-server",
    url: "http://localhost/.well-known/oauth-authorization-server",
    call: (request) => getAsMetadata(request),
  },
];

for (const endpoint of ENDPOINTS) {
  test(`${endpoint.name} advertises the RFC RateLimit quota`, async () => {
    const res = await endpoint.call(new Request(endpoint.url));
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("ratelimit-policy"),
      `"default";q=${SITE_API_RATE_LIMIT};w=${SITE_API_RATE_WINDOW_SEC}`,
    );
    assert.equal(
      res.headers.get("ratelimit-limit"),
      String(SITE_API_RATE_LIMIT),
    );
    assert.match(res.headers.get("ratelimit") ?? "", /r=\d+;t=\d+/);
    assert.ok(res.headers.get("ratelimit-remaining"));
    assert.equal(res.headers.get("api-version"), SITE_API_VERSION);
  });
}

test("consumeSiteApiQuota returns a 429 that a shared cache cannot replay", async () => {
  const request = new Request("http://localhost/api/v1", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });

  let limited: Response | null = null;
  for (let attempt = 0; attempt <= SITE_API_RATE_LIMIT; attempt += 1) {
    const quota = consumeSiteApiQuota(request);
    if (quota.limited) {
      limited = quota.response;
      break;
    }
  }

  assert.ok(limited, "the advertised quota must actually be enforced");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(limited.headers.get("retry-after"));
  assert.equal(limited.headers.get("ratelimit-remaining"), "0");
  assert.equal(
    limited.headers.get("content-type"),
    "application/problem+json; charset=utf-8",
  );
  const body = (await limited.json()) as { code: string };
  assert.equal(body.code, "rate_limited");
});
