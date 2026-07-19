/**
 * Type-level regression tests for {@link createClient} inference.
 *
 * These assertions are validated at compile time by `pnpm typecheck` (which
 * runs `tsc` against `tsconfig.typetest.json`). They guard the bug where the
 * typed client collapsed to a loose, string-indexed record because the `App`
 * type erased per-route information: `createClient(app).getBookById` resolved
 * to an `any`-ish method instead of a precise, operationId-keyed signature.
 *
 * Inference supports method chaining and literal tuples passed to
 * `registerRoutes()`. A widening `: App` annotation still intentionally
 * discards the accumulated route tuple.
 */

import { z } from "zod";

import { App } from "../../src/app.js";
import { createClient } from "../../src/client.js";
import { getBookRoute } from "./fixtures/get-book.route.js";
import { listBooksRoute } from "./fixtures/list-books.route.js";

/** Compile-time assertion that `T` is exactly `true`. */
type Expect<T extends true> = T;
/** Structural equality check between two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const app = new App({ logger: false })
  .route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "ok",
        body: z.object({ id: z.string(), title: z.string() }),
      },
      404: { description: "not found" },
    },
    handler: async () => ({ status: 200 as const, body: { id: "1", title: "Dune" } }),
  })
  .route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    request: { body: z.object({ title: z.string() }) },
    responses: {
      201: { description: "created", body: z.object({ id: z.string() }) },
    },
    handler: async () => ({ status: 201 as const, body: { id: "1" } }),
  });

const client = createClient(app, { baseUrl: "http://localhost:3000" });

// The client is keyed by operationId with precise method signatures.
type ClientKeys = keyof typeof client;
type _KeysAreExactlyOperationIds = Expect<Equal<ClientKeys, "getBookById" | "createBook">>;

// `getBookById` takes a typed `params.id: string`.
type GetByIdInput = Parameters<(typeof client)["getBookById"]>[0];
type _ParamsAreTyped = Expect<Equal<GetByIdInput["params"], { id: string }>>;

async function probes() {
  const r = await client.getBookById({ params: { id: "1" } });
  // The response is a discriminated union; the 200 body is precisely typed.
  if (r.status === 200) {
    const title: string = r.body.title;
    void title;
  }

  // @ts-expect-error - `id` must be a string, not a number.
  await client.getBookById({ params: { id: 123 } });

  // @ts-expect-error - unknown operationId; the client surface is not string-indexed.
  client.doesNotExist;

  // @ts-expect-error - `createBook` requires a typed body.
  await client.createBook({ body: { title: 123 } });

  // A body-only route does not invent a required `params: {}` property.
  await client.createBook({ body: { title: "Dune" } });

  // @ts-expect-error - routes without path parameters do not accept fake params.
  await client.createBook({ params: { id: "not-in-the-path" }, body: { title: "Dune" } });
}

void probes;

// Independently defined routes retain their complete tuple when composed.
const modularApp = new App({ logger: false }).registerRoutes([
  listBooksRoute,
  getBookRoute,
] as const);
const modularClient = createClient(modularApp, { baseUrl: "http://localhost" });
type _ModularKeysArePreserved = Expect<Equal<keyof typeof modularClient, "listBooks" | "getBook">>;
type ModularGetInput = Parameters<(typeof modularClient)["getBook"]>[0];
type _ModularParamsAreTyped = Expect<Equal<ModularGetInput["params"], { id: string }>>;

const shorthandApp = new App({ logger: false })
  .get(
    "/",
    { responses: { 200: { body: z.object({ ok: z.boolean() }) } } },
    () => ({ status: 200, body: { ok: true } })
  )
  .post(
    "/book-items/:item_id",
    {
      request: { body: z.object({ title: z.string() }) },
      responses: {
        201: { description: "Created", body: z.object({ id: z.string() }) },
      },
    },
    ({ params, body }) => ({ status: 201, body: { id: `${params.item_id}:${body.title}` } })
  );
const shorthandClient = createClient(shorthandApp, { baseUrl: "http://localhost" });
type _ShorthandOperationIdsAreInferred = Expect<
  Equal<keyof typeof shorthandClient, "getRoot" | "postBookItemsByItemId">
>;

// A route with no required request inputs is callable without an argument.
void shorthandClient.getRoot();

// @ts-expect-error - path parameters remain required when the path declares them.
void shorthandClient.postBookItemsByItemId({ body: { title: "Dune" } });

// @ts-expect-error - method shorthands never silently opt out of response contracts.
new App({ logger: false }).get("/unsafe", () => Response.json({ secret: true }));
