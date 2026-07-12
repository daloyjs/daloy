import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/app.js";
import { createInProcessClient } from "../src/client.js";
import { generateOpenAPI } from "../src/openapi.js";
import { defineRoute } from "../src/types.js";

const healthRoute = defineRoute({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "OK", body: z.object({ ok: z.boolean() }) } },
  handler: () => ({ status: 200, body: { ok: true } }),
});

test("registerRoutes composes independently defined contracts", async () => {
  const app = new App({ logger: false }).registerRoutes([healthRoute] as const);
  const client = createInProcessClient(app);

  const response = await client.health({ params: {} });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual(
    app.introspect().map((route) => route.operationId),
    ["health"]
  );
});

test("HTTP shorthands infer stable operation ids from method and path", async () => {
  const app = new App({ logger: false })
    .get(
      "/",
      { responses: { 200: { body: z.object({ hello: z.string() }) } } },
      () => ({ status: 200, body: { hello: "world" } })
    )
    .get(
      "/book-items/:item_id",
      { responses: { 200: { body: z.object({ ok: z.boolean() }) } } },
      () => ({ status: 200, body: { ok: true } })
    );

  assert.deepEqual(
    app.introspect().map((route) => route.operationId),
    ["getRoot", "getBookItemsByItemId"]
  );
  assert.deepEqual(await (await app.request("/")).json(), { hello: "world" });
});

test("contract-backed shorthands retain validation and allow explicit operation ids", async () => {
  const app = new App({ logger: false }).post(
    "/books",
    {
      operationId: "createBook",
      request: { body: z.object({ title: z.string().min(1) }) },
      responses: {
        201: {
          body: z.object({ id: z.string(), title: z.string() }),
        },
      },
    },
    ({ body }) => ({ status: 201, body: { id: "1", title: body.title } })
  );

  const invalid = await app.request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "" }),
  });
  const valid = await app.request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Dune" }),
  });

  assert.equal(invalid.status, 422);
  assert.equal(valid.status, 201);
  assert.deepEqual(await valid.json(), { id: "1", title: "Dune" });
  assert.equal(app.introspect()[0]?.operationId, "createBook");
  const document = generateOpenAPI(app, {
    info: { title: "Shorthand API", version: "1.0.0" },
  });
  const paths = document.paths as Record<
    string,
    { post?: { responses?: Record<string, unknown> } }
  >;
  assert.equal(
    (paths["/books"]?.post?.responses?.["201"] as { description?: string }).description,
    "HTTP 201 response"
  );
});

test("opaque shorthand responses require an explicit acknowledgement", async () => {
  const app = new App({ logger: false }).get(
    "/health",
    {
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: {} },
    },
    () => new Response("ok")
  );

  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("HTTP shorthand runtime guard rejects malformed JavaScript calls", () => {
  const app = new App({ logger: false });
  assert.throws(
    () => (app.get as (...args: unknown[]) => unknown)("/broken", {}),
    /expected \(path, contract, handler\)/
  );
  assert.throws(
    () => (app.get as (...args: unknown[]) => unknown)("/broken", () => new Response()),
    /opaque responses require an explicit contract/
  );
});

// ---------------------------------------------------------------------------
// Drift guard: the operation-id inference algorithm is implemented twice —
// once at the type level (`AutoOperationId` in src/app.ts, powering the typed
// client's keys) and once at runtime (`inferOperationId`, powering the OpenAPI
// spec and the in-process client's actual keys). If the two ever diverge, the
// typed client would advertise a method name that does not exist at runtime.
// This test pins BOTH encodings to one shared literal list: a type-level
// drift fails `pnpm typecheck` (this file is part of tests/tsconfig.json),
// and a runtime drift fails `pnpm test`.
// ---------------------------------------------------------------------------

/** Compile-time assertion that `T` is exactly `true`. */
type Expect<T extends true> = T;
/** Structural equality check between two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

test("inferred operation ids stay in sync between type level and runtime", () => {
  const okContract = {
    responses: { 200: { body: z.object({ ok: z.boolean() }) } },
  };
  const okHandler = () => ({ status: 200 as const, body: { ok: true } });

  const app = new App({ logger: false })
    // Root path special case.
    .get("/", okContract, okHandler)
    // Kebab-case segment + snake_case param.
    .get("/book-items/:item_id", okContract, okHandler)
    // Mixed snake_case and kebab-case words inside one segment.
    .get("/legacy_admin-tools/export", okContract, okHandler)
    // Param in the middle of the path + non-GET method prefixes.
    .post("/books/:book_id/reviews", okContract, okHandler)
    .delete("/books/:book_id", okContract, okHandler);

  const client = createInProcessClient(app);

  const expected = [
    "getRoot",
    "getBookItemsByItemId",
    "getLegacyAdminToolsExport",
    "postBooksByBookIdReviews",
    "deleteBooksByBookId",
  ] as const;

  // Compile-time half: the typed client's keys must be exactly the literals
  // above, as derived by `AutoOperationId`.
  type _TypeLevelIdsMatchExpected = Expect<Equal<keyof typeof client, (typeof expected)[number]>>;

  // Runtime half: `inferOperationId` must produce the same literals, in
  // registration order.
  assert.deepEqual(
    app.introspect().map((route) => route.operationId),
    [...expected]
  );
});
