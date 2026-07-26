# Exercise 5 — Step-by-Step

> Goal: prove that the contract you've built is real by consuming it two ways — the in-process `createClient(app)` typed client (no codegen step), and a generated Hey API fetch SDK from the live `/openapi.json`.

You are editing [`exercise-5.ts`](../exercise-5.ts). Reference: [`solutions/exercise-5-end.ts`](../solutions/exercise-5-end.ts).

---

## Mental model first

DaloyJS gives you _two_ flavors of typed client:

1. **In-process** — `createClient(app)` returns a fully typed proxy whose method names are your `operationId`s. It runs in the same Node process and hits the local HTTP server. Use this for startup smoke-tests, contract tests, and admin scripts.
2. **External / generated** — `pnpm gen` hits `/openapi.json`, runs Hey API, and writes `generated/client/`. That generated SDK is what your frontend, mobile bundle, or internal CLI imports. Use this for any consumer that lives in a different process or different repo.

Both clients are driven by the same OpenAPI doc, which is generated from the same route definitions. There is exactly one source of truth.

Order of work:

1. Import `createClient`.
2. Add the smoke-test that calls `getBookById` for both 200 and 404.
3. Run `pnpm gen` in a second terminal and inspect the generated SDK.

---

## Step 1 — Import `createClient`

Keep your root import focused on server APIs, then add `createClient` from the client entrypoint:

```ts
import { App, NotFoundError } from "@daloyjs/core";
import { createClient } from "@daloyjs/core/client";
```

---

## Step 2 — Add the smoke-test

Below `const { port, close } = serve(app, { port: 3000 });`:

```ts
const client = createClient(app, { baseUrl: `http://localhost:${port}` }) as {
  getBookById(input: { params: { id: string } }): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
};

setTimeout(async () => {
  const ok = await client.getBookById({ params: { id: "1" } });
  console.log("client.getBookById(1) ->", ok.status, ok.body);

  const miss = await client.getBookById({ params: { id: "missing" } });
  console.log("client.getBookById(missing) ->", miss.status, miss.body);

  await close();
}, 250);
```

**Why the manual cast on `client`:** the in-process client's full type is derived from the App's internal route table and is too elaborate to spell out here. Casting to the minimum shape we need (`getBookById`) keeps the example readable. In your real codebase you'd import the generated `types.gen.ts` from `generated/client/` and let TypeScript infer everything.

**Why `setTimeout(..., 250)`:** the in-process client _does_ make real HTTP calls back to the same server, so we let the listen socket settle before the first request. In a long-running process this is irrelevant; for a one-shot smoke-test it avoids a race on cold start.

**Why call both the 200 and the 404 path:** to demonstrate that the framework's error path still passes through the typed client cleanly. The 404 comes back with `status: 404` and a problem+json body — no exception thrown, no special casing on the consumer side.

---

## Step 3 — Run `pnpm gen` in a second terminal

```bash
# Terminal A (already running): pnpm dev:4:5
# Terminal B:
pnpm gen:openapi
pnpm gen:client

ls generated/client
# client.gen.ts  index.ts  sdk.gen.ts  types.gen.ts  zod.gen.ts  @tanstack/...
```

Open `generated/client/sdk.gen.ts`. You should see:

```ts
export const getBookById = <ThrowOnError extends boolean = false>(...) => ...;
```

That function takes `{ path: { id: string } }` (Hey API's parameter slot layout) and returns a discriminated union of `{ status: 200, data: Book } | { status: 404, data: Problem }` (depending on the plugin set). The frontend imports `getBookById` and gets compile-time errors if it forgets the 404 branch.

Open `generated/client/zod.gen.ts`. You should see a Zod schema that mirrors `BookSchema` from your server — same shape, same constraints. The consumer can re-use it for `<form>` validation without copy-pasting types.

---

## Step 4 — (Optional) Wire the generated client back into the test

If you want to close the loop, you can replace the in-process `createClient` with the generated `getBookById` and confirm both clients behave identically. The point of the workshop is that you _shouldn't have to choose_ — the spec is the contract; pick whichever client matches your deployment.

---

## Code-change cheat sheet

| Step | Where              | Change                                                               |
| ---- | ------------------ | -------------------------------------------------------------------- |
| 1    | Imports            | Add `createClient` to the `@daloyjs/core` import                     |
| 2    | After `serve(...)` | Add the in-process client smoke-test (200 + 404 calls, then `close`) |
| 3    | (no edit)          | Run `pnpm gen` in another terminal and inspect `generated/client/`   |

---

## Common mistakes

- **Running `pnpm gen` without the server running.** Hey API hits `http://localhost:3000/openapi.json`. If nothing is listening, you get a connection-refused error. Start the exercise first.
- **Calling `close()` before the in-process client request finishes.** The smoke-test awaits the calls, then closes. Don't move `close()` outside the `setTimeout`.
- **Treating the generated `client/` folder as something you edit.** It's a build artifact. Edit your route definitions instead.
- **Naming two routes with the same `operationId`.** Hey API would clobber one function with the other. The framework refuses to start in that case — fix the duplicate id in the route definition.
