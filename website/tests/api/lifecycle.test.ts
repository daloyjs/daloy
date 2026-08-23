import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * The `/docs-md/*` handler renders a docs page, and `getDocPage` calls
 * `cacheLife()` from `next/cache`, which throws outside the Next.js runtime.
 * Stub it before importing any route module (see tests/lib/docs-content.test.ts).
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

import {
  SITE_API_V1_PATH,
  SITE_API_VERSION,
  SITE_API_VERSION_HEADER,
} from "../../lib/site-api";
import {
  apiLifecycleSummary,
  deprecationHeaders,
  epochSeconds,
  findApiSurface,
  httpDate,
  SITE_API_SURFACES,
  surfaceLinkRelations,
  type ApiSurface,
} from "../../lib/site-deprecation";
import { buildSiteOpenApiDocument } from "../../lib/site-openapi";

const { GET: getApiV1 } = await import("../../app/api/v1/[[...path]]/route");
const { GET: getUnversionedApi } =
  await import("../../app/api/[[...path]]/route");
const { GET: getLegacyDocsMarkdown } =
  await import("../../app/docs-md/[[...slug]]/route");
const { GET: getPageMarkdown } = await import("../../app/md/[[...slug]]/route");

function surfaceById(id: string): ApiSurface {
  const surface = SITE_API_SURFACES.find((entry) => entry.id === id);
  assert.ok(surface, `no surface registered with id ${id}`);
  return surface;
}

test("findApiSurface returns the most specific registered surface", () => {
  assert.equal(findApiSurface("/api/v1")?.id, "api-v1");
  assert.equal(findApiSurface("/api/v1/nope")?.id, "api-v1");
  assert.equal(findApiSurface("/api")?.id, "api-alias");
  assert.equal(findApiSurface("/api/")?.id, "api-alias");
  assert.equal(findApiSurface("/docs-md/routing")?.id, "docs-md");
  assert.equal(findApiSurface("/md/docs/routing")?.id, "md");
  assert.equal(findApiSurface("/docs/routing"), null);
});

test("findApiSurface does not match a path that merely shares a prefix", () => {
  assert.equal(findApiSurface("/apiary"), null);
  assert.equal(findApiSurface("/md-notes"), null);
});

test("current surfaces emit no Deprecation or Sunset header", () => {
  for (const surface of SITE_API_SURFACES.filter(
    (entry) => entry.status === "current",
  )) {
    assert.deepEqual(deprecationHeaders(surface), {});
  }
});

test("a deprecated surface emits an RFC 9745 Deprecation date", () => {
  const surface = surfaceById("docs-md");
  const headers = deprecationHeaders(surface);
  assert.ok(surface.deprecatedAt);
  assert.equal(headers.Deprecation, `@${epochSeconds(surface.deprecatedAt)}`);
  // No retirement is scheduled, so no Sunset may be advertised.
  assert.equal(headers.Sunset, undefined);
});

test("a scheduled sunset renders as an RFC 8594 IMF-fixdate", () => {
  const scheduled: ApiSurface = {
    ...surfaceById("docs-md"),
    sunsetAt: "2027-11-11",
  };
  const headers = deprecationHeaders(scheduled);
  assert.equal(headers.Sunset, "Thu, 11 Nov 2027 00:00:00 GMT");
  assert.equal(headers.Sunset, httpDate("2027-11-11"));
  assert.ok(
    surfaceLinkRelations(scheduled).some((value) =>
      value.includes('rel="sunset"'),
    ),
  );
});

test("an invalid lifecycle date yields no header rather than a broken one", () => {
  const broken: ApiSurface = {
    ...surfaceById("docs-md"),
    deprecatedAt: "not-a-date",
    sunsetAt: "also-not-a-date",
  };
  assert.equal(epochSeconds("not-a-date"), null);
  assert.equal(httpDate("also-not-a-date"), null);
  assert.deepEqual(deprecationHeaders(broken), {});
});

test("link relations name the successor and the latest major", () => {
  const relations = surfaceLinkRelations(surfaceById("docs-md"));
  assert.ok(relations.some((value) => value.includes('rel="deprecation"')));
  assert.ok(
    relations.some((value) => value === '</md>; rel="successor-version"'),
  );
  assert.ok(
    relations.some(
      (value) => value === `<${SITE_API_V1_PATH}>; rel="latest-version"`,
    ),
  );
  assert.ok(!relations.some((value) => value.includes('rel="sunset"')));
});

test("GET /docs-md/* carries the deprecation signals", async () => {
  // An unknown slug short-circuits before the HTML self-fetch, so this asserts
  // the headers without needing a running server. The lifecycle headers are set
  // on every response, not only on 200s.
  const res = await getLegacyDocsMarkdown(
    new Request("http://localhost/docs-md/not-a-real-page"),
    { params: Promise.resolve({ slug: ["not-a-real-page"] }) },
  );
  assert.equal(res.status, 404);
  assert.match(res.headers.get("deprecation") ?? "", /^@\d+$/);
  assert.equal(res.headers.get("sunset"), null);
  const link = res.headers.get("link") ?? "";
  assert.match(link, /rel="deprecation"/);
  assert.match(link, /rel="successor-version"/);
  assert.ok(res.headers.get("ratelimit-policy"));
  assert.equal(res.headers.get("api-version"), SITE_API_VERSION);
});

test("GET /api advertises the successor and latest major on the redirect", () => {
  const res = getUnversionedApi(new Request("http://localhost/api"));
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), SITE_API_V1_PATH);
  const link = res.headers.get("link") ?? "";
  assert.match(link, /rel="successor-version"/);
  assert.match(link, /rel="latest-version"/);
  // The alias is a convenience, not a deprecated surface.
  assert.equal(res.headers.get("deprecation"), null);
});

test("GET /api/v1 publishes the machine-readable lifecycle policy", async () => {
  const res = await getApiV1(new Request("http://localhost/api/v1"), {
    params: Promise.resolve({ path: undefined }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    versioning: {
      current: string;
      header: string;
      sunsetNoticeDays: number;
      signals: { deprecationHeader: string; linkRelations: string[] };
      surfaces: Array<{ id: string; status: string; successor: string | null }>;
    };
  };
  assert.equal(body.versioning.current, SITE_API_VERSION);
  assert.equal(body.versioning.header, SITE_API_VERSION_HEADER);
  assert.equal(body.versioning.sunsetNoticeDays, 180);
  assert.equal(body.versioning.signals.deprecationHeader, "Deprecation");
  assert.ok(body.versioning.signals.linkRelations.includes("sunset"));
  const legacy = body.versioning.surfaces.find(
    (entry) => entry.id === "docs-md",
  );
  assert.equal(legacy?.status, "deprecated");
  assert.equal(legacy?.successor, "/md");
  assert.match(res.headers.get("link") ?? "", /rel="latest-version"/);
});

test("GET /api/v1 accepts an API-Version header pinning the current major", async () => {
  for (const value of ["1", "v1", "1.0.0"]) {
    const res = await getApiV1(
      new Request("http://localhost/api/v1", {
        headers: { [SITE_API_VERSION_HEADER]: value },
      }),
      { params: Promise.resolve({ path: undefined }) },
    );
    assert.equal(res.status, 200, `expected ${value} to be accepted`);
  }
});

test("GET /api/v1 rejects an API-Version header for a major it does not serve", async () => {
  const res = await getApiV1(
    new Request("http://localhost/api/v1", {
      headers: { [SITE_API_VERSION_HEADER]: "2" },
    }),
    { params: Promise.resolve({ path: undefined }) },
  );
  assert.equal(res.status, 400);
  assert.equal(
    res.headers.get("content-type"),
    "application/problem+json; charset=utf-8",
  );
  const body = (await res.json()) as { code: string; hint: string };
  assert.equal(body.code, "unsupported_api_version");
  assert.match(body.hint, /API-Version: 1/);
});

test("the OpenAPI document declares the versioning and deprecation contract", () => {
  const doc = buildSiteOpenApiDocument() as {
    info: Record<string, unknown>;
    externalDocs: { url: string };
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };

  assert.deepEqual(doc.info["x-api-lifecycle"], apiLifecycleSummary());
  assert.match(doc.externalDocs.url, /\/docs\/api-lifecycle$/);

  const v1 = doc.paths[SITE_API_V1_PATH]?.get;
  const parameters = v1?.parameters as Array<{ name: string; in: string }>;
  assert.ok(
    parameters.some(
      (parameter) =>
        parameter.name === SITE_API_VERSION_HEADER && parameter.in === "header",
    ),
    "the versioned path must declare the API-Version header parameter",
  );
  assert.ok((v1?.responses as Record<string, unknown>)["400"]);

  const legacy = doc.paths["/docs-md/{path}"]?.get;
  assert.equal(legacy?.deprecated, true);
  const legacyHeaders = (
    legacy?.responses as Record<string, { headers: Record<string, unknown> }>
  )["200"]?.headers;
  assert.ok(legacyHeaders?.Deprecation);
  assert.ok(legacyHeaders?.Sunset);

  assert.ok(doc.paths["/api"]?.get, "the unversioned alias must be documented");
  assert.ok(doc.paths["/md/{path}"]?.get);
});

test("GET /md/* publishes the rate-limit quota without a deprecation signal", async () => {
  const res = await getPageMarkdown(
    new Request("http://localhost/md/docs/not-a-real-page"),
    { params: Promise.resolve({ slug: ["docs", "not-a-real-page"] }) },
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("deprecation"), null);
  assert.match(res.headers.get("ratelimit-policy") ?? "", /q=\d+;w=\d+/);
  assert.ok(res.headers.get("ratelimit-limit"));
  assert.equal(res.headers.get("api-version"), SITE_API_VERSION);
});
