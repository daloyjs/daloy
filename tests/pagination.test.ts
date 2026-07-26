import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  encodeCursor,
  decodeCursor,
  buildLinkHeader,
  buildPageLinks,
  paginationQuery,
  MAX_CURSOR_LENGTH,
  validate,
  HttpError,
} from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";

// ---------- encodeCursor / decodeCursor ----------

test("encodeCursor + decodeCursor round-trip an object", () => {
  const payload = { id: 42, createdAt: "2026-05-31T00:00:00.000Z" };
  const cursor = encodeCursor(payload);
  assert.equal(typeof cursor, "string");
  assert.deepEqual(decodeCursor(cursor), payload);
});

test("encoded cursor is URL-safe (base64url, no padding)", () => {
  const cursor = encodeCursor({ a: "??>>>>", b: [1, 2, 3] });
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
});

test("decodeCursor round-trips arrays and primitives", () => {
  assert.deepEqual(decodeCursor(encodeCursor([1, "two", true])), [1, "two", true]);
  assert.equal(decodeCursor(encodeCursor("plain")), "plain");
});

test("encodeCursor throws on non-serializable payloads", () => {
  assert.throws(() => encodeCursor(10n as unknown), TypeError);
  assert.throws(() => encodeCursor(() => 1), TypeError);
});

function statusOfThrow(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    return (e as HttpError).status;
  }
  throw new Error("expected the function to throw");
}

test("decodeCursor rejects an empty cursor with a 400", () => {
  assert.equal(
    statusOfThrow(() => decodeCursor("")),
    400
  );
});

test("decodeCursor rejects an over-long cursor", () => {
  const huge = "a".repeat(MAX_CURSOR_LENGTH + 1);
  assert.equal(
    statusOfThrow(() => decodeCursor(huge)),
    400
  );
});

test("decodeCursor rejects a malformed (non-base64url) cursor", () => {
  assert.equal(
    statusOfThrow(() => decodeCursor("not base64!!")),
    400
  );
});

test("decodeCursor rejects base64url that is not valid JSON", () => {
  // "hello" base64url-encoded is not JSON.
  const notJson = Buffer.from("hello").toString("base64url");
  assert.equal(
    statusOfThrow(() => decodeCursor(notJson)),
    400
  );
});

test("decodeCursor strips prototype-pollution keys", () => {
  // Hand-craft a cursor whose JSON contains __proto__.
  const malicious = Buffer.from(
    JSON.stringify({ id: 1, __proto__: { admin: true }, nested: { constructor: "x", ok: 2 } })
  ).toString("base64url");
  const decoded = decodeCursor<Record<string, unknown>>(malicious);
  assert.equal(({} as Record<string, unknown>).admin, undefined);
  assert.equal(decoded.id, 1);
  assert.deepEqual(decoded.nested, { ok: 2 });
});

// ---------- buildLinkHeader ----------

test("buildLinkHeader serializes rel and title", () => {
  const header = buildLinkHeader([
    { url: "https://api.test/books?cursor=abc", rel: "next" },
    { url: "https://api.test/books", rel: "first", title: "First page" },
  ]);
  assert.equal(
    header,
    '<https://api.test/books?cursor=abc>; rel="next", <https://api.test/books>; rel="first"; title="First page"'
  );
});

test("buildLinkHeader returns empty string for no links", () => {
  assert.equal(buildLinkHeader([]), "");
});

test("buildLinkHeader rejects header-injection in the URL", () => {
  assert.throws(
    () => buildLinkHeader([{ url: "https://api.test/\r\nSet-Cookie: x=1", rel: "next" }]),
    /forbidden characters/
  );
  assert.throws(
    () => buildLinkHeader([{ url: "https://api.test/<script>", rel: "next" }]),
    /forbidden characters/
  );
});

test("buildLinkHeader rejects injection in rel and title", () => {
  assert.throws(
    () => buildLinkHeader([{ url: "https://api.test/", rel: 'next"; rel="evil' }]),
    /forbidden characters/
  );
  assert.throws(
    () => buildLinkHeader([{ url: "https://api.test/", rel: "next", title: 'a"b' }]),
    /forbidden characters/
  );
});

// ---------- buildPageLinks ----------

test("buildPageLinks swaps the cursor param while preserving other query params", () => {
  const { urls, linkHeader } = buildPageLinks({
    url: "https://api.test/books?limit=10&tag=ts",
    next: "NEXT",
    prev: "PREV",
    first: true,
  });
  assert.ok(urls.next!.includes("cursor=NEXT"));
  assert.ok(urls.next!.includes("limit=10"));
  assert.ok(urls.next!.includes("tag=ts"));
  assert.ok(urls.prev!.includes("cursor=PREV"));
  assert.ok(!urls.first!.includes("cursor="));
  assert.ok(linkHeader.includes('rel="next"'));
  assert.ok(linkHeader.includes('rel="prev"'));
  assert.ok(linkHeader.includes('rel="first"'));
});

test("buildPageLinks omits next/prev when cursors are absent", () => {
  const { links, urls } = buildPageLinks({ url: "https://api.test/books" });
  assert.equal(links.length, 0);
  assert.equal(urls.next, undefined);
  assert.equal(urls.prev, undefined);
  assert.equal(urls.self, "https://api.test/books");
});

test("buildPageLinks honors a custom cursorParam and extraLinks", () => {
  const { urls, links } = buildPageLinks({
    url: "https://api.test/books",
    cursorParam: "after",
    next: "N",
    extraLinks: [{ url: "https://api.test/books?cursor=LAST", rel: "last" }],
  });
  assert.ok(urls.next!.includes("after=N"));
  assert.ok(links.some((l) => l.rel === "last"));
});

// ---------- paginationQuery (runtime validation) ----------

test("paginationQuery applies the default limit and passes cursor through", async () => {
  const schema = paginationQuery({ defaultLimit: 25 });
  const r = await validate(schema, { cursor: "abc" });
  assert.ok(!r.issues);
  assert.deepEqual(r.value, { limit: 25, cursor: "abc" });
});

test("paginationQuery coerces a string limit to an integer", async () => {
  const schema = paginationQuery();
  const r = await validate(schema, { limit: "30" });
  assert.ok(!r.issues);
  assert.equal(r.value!.limit, 30);
  assert.equal(r.value!.cursor, undefined);
});

test("paginationQuery rejects a non-integer limit", async () => {
  const r = await validate(paginationQuery(), { limit: "abc" });
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /integer/);
});

test("paginationQuery rejects an out-of-range limit", async () => {
  const r = await validate(paginationQuery({ maxLimit: 50 }), { limit: "999" });
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /between 1 and 50/);
});

test("paginationQuery rejects an over-long cursor", async () => {
  const r = await validate(paginationQuery(), { cursor: "a".repeat(MAX_CURSOR_LENGTH + 1) });
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /too long/);
});

test("paginationQuery rejects a non-object query value", async () => {
  const r = await validate(paginationQuery(), null);
  assert.ok(r.issues);
});

test("paginationQuery treats empty-string params as absent", async () => {
  const r = await validate(paginationQuery({ defaultLimit: 10 }), { limit: "", cursor: "" });
  assert.ok(!r.issues);
  assert.deepEqual(r.value, { limit: 10 });
});

test("paginationQuery supports custom param names", async () => {
  const schema = paginationQuery({ limitParam: "perPage", cursorParam: "after" });
  const r = await validate(schema, { perPage: "5", after: "tok" });
  assert.ok(!r.issues);
  assert.deepEqual(r.value, { limit: 5, cursor: "tok" });
});

// ---------- paginationQuery (option validation) ----------

test("paginationQuery rejects invalid bounds", () => {
  assert.throws(() => paginationQuery({ maxLimit: 0 }), /positive integer/);
  assert.throws(() => paginationQuery({ minLimit: 10, maxLimit: 5 }), /must not exceed/);
  assert.throws(
    () => paginationQuery({ minLimit: 5, maxLimit: 10, defaultLimit: 1 }),
    /within \[minLimit, maxLimit\]/
  );
});

// ---------- OpenAPI parameter wiring ----------

test("paginationQuery wires cursor + limit into the OpenAPI document", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/books",
    operationId: "listBooks",
    request: { query: paginationQuery({ defaultLimit: 25, maxLimit: 100 }) },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { items: [] } }),
  });

  const doc: any = generateOpenAPI(app, { info: { title: "P", version: "1" } });
  const params = doc.paths["/books"].get.parameters;
  const byName = Object.fromEntries(params.map((p: any) => [p.name, p]));

  assert.equal(byName.limit.in, "query");
  assert.equal(byName.limit.schema.type, "integer");
  assert.equal(byName.limit.schema.minimum, 1);
  assert.equal(byName.limit.schema.maximum, 100);
  assert.equal(byName.limit.schema.default, 25);
  assert.equal(byName.cursor.in, "query");
  assert.equal(byName.cursor.schema.type, "string");
  assert.equal(byName.cursor.required, false);
});

// ---------- end-to-end through a request ----------

test("paginationQuery validates a live request and the handler emits a Link header", async () => {
  const app = new App({ logger: false });
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  app.route({
    method: "GET",
    path: "/books",
    operationId: "listBooks2",
    request: { query: paginationQuery({ defaultLimit: 2, maxLimit: 10 }) },
    responses: { 200: { description: "ok" } },
    handler: async ({ query, request, set }) => {
      const { limit, cursor } = query;
      const start = cursor ? decodeCursor<{ id: number }>(cursor).id : 0;
      const page = rows.filter((r) => r.id > start).slice(0, limit);
      const next = page.length === limit ? encodeCursor({ id: page[page.length - 1]!.id }) : null;
      const { linkHeader } = buildPageLinks({ url: request.url, next });
      if (linkHeader) set.headers.set("Link", linkHeader);
      return { status: 200 as const, body: { items: page } };
    },
  });

  const first = await app.request("/books", { method: "GET" });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(firstBody.items, [{ id: 1 }, { id: 2 }]);
  const link = first.headers.get("link");
  assert.ok(link && link.includes('rel="next"'));

  // Follow the next cursor from the Link header.
  const nextUrl = link!.match(/<([^>]+)>/)![1]!;
  const second = await app.request(nextUrl, { method: "GET" });
  const secondBody = await second.json();
  assert.deepEqual(secondBody.items, [{ id: 3 }, { id: 4 }]);
});

test("an invalid limit is rejected at the request boundary", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/books",
    operationId: "listBooks3",
    request: { query: paginationQuery({ maxLimit: 10 }) },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { items: [] } }),
  });
  const res = await app.request("/books?limit=999", { method: "GET" });
  assert.equal(res.status, 422);
});
