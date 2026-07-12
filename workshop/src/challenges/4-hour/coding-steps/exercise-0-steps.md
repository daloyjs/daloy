# Exercise 0 — Step-by-Step

> Goal: understand the smallest working DaloyJS app with `/health`, `/docs`, and `/openapi.json` live on port 3000.

You are reading and lightly editing [`exercise-0.ts`](../exercise-0.ts). It is runnable from the first `pnpm dev:4:0` command so the workshop starts with a working docs page. The reference output is [`solutions/exercise-0-end.ts`](../solutions/exercise-0-end.ts).

---

## Mental model first (read this before touching code)

A DaloyJS app is just three things:

1. An `App` — the registry of routes, middleware, and OpenAPI metadata.
2. A series of `app.get(path, contract, handler)` calls (or the other method-specific shorthands — `app.post`, `app.put`, `app.patch`, `app.delete`, `app.head`) — each one a self-contained contract (method, path, request schema, response schemas, handler).
3. An adapter — `serve(app, { port })` for Node; the same `app` works on Bun / Deno / Workers via different adapters.

The single biggest "huh, that's different" moment for new attendees: **the OpenAPI spec is not a separate config file**. The `openapi.info` you pass to `new App()` and the `responses` schemas you pass to `app.get()` (and its sibling shorthands) are the spec.

That means the order of work in this exercise is:

1. Construct the `App` with OpenAPI metadata and `docs: true`.
2. Register `/health` with a response schema.
3. Call `serve(app, { port: 3000 })`.

---

## Step 1 — Replace the placeholder `App`

**Why first:** every other line in this file uses `app`. The starter already constructs it; inspect this block and try changing the title or version to see the OpenAPI output change.

The app block should look like this:

```ts
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});
```

**Why every option matters:**

- `title` / `version` are runtime metadata (used in logs and the startup banner).
- `openapi.info` is what shows up in the rendered Scalar UI title bar and the `info` block of `/openapi.json`.
- `docs: true` is the magic — it auto-mounts `GET /docs` and `GET /openapi.json` for you. Without it, you'd have to wire those endpoints by hand.

**Common mistake:** omitting `openapi.info` and assuming `title` is enough. They cover different concerns: `title` is for ops; `openapi.info` is for the published spec.

---

## Step 2 — Inspect the `/health` route

**Why second:** now that `app` exists, it needs something to respond with. Health checks are the simplest possible contract — no request schema, one response schema, no error path.

The starter already has this between the `const app = …` and the `serve(app, …)` call:

```ts
import { z } from "zod";

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    responses: {
      200: {
        description: "Service is healthy",
        body: z.object({ status: z.literal("ok") }),
      },
    },
  },
  async () => ({ status: 200 as const, body: { status: "ok" as const } }),
);
```

**Why each option matters:**

- `operationId` is what Hey API uses to name the generated SDK function in exercise 5. Pick it deliberately; you cannot change it later without breaking client code.
- `tags` groups operations in the Scalar UI sidebar.
- `body: z.object(...)` is what makes the response schema appear in `/openapi.json`. Without it the operation is documented but the response is `unknown`.
- The `as const` on `status: 200` is what gives TypeScript a literal `200` (so the handler return type is type-narrowed to the matching `responses[200].body` shape).

**Common mistake:** writing `responses: { 200: { description, body: z.object({...}) } }` but then returning `{ status: 200, body }` _without_ `as const`. TypeScript will widen `status` to `number` and you'll lose the contract narrowing.

---

## Step 3 — Boot under the Node adapter

**Why last:** `serve()` blocks until the process exits, so it must be the last call. The starter file already has `serve(app, { port: 3000 })`. No edit needed.

Save the file. `node --watch` should restart and print:

```
→ http://localhost:3000/health
→ http://localhost:3000/docs
```

---

## Step 4 — Verify in the browser and curl

```bash
curl -s http://localhost:3000/health
# {"status":"ok"}

curl -s http://localhost:3000/openapi.json | jq '.paths."/health".get.operationId'
# "getHealth"
```

Open `http://localhost:3000/docs` — you should see the Scalar UI with **Meta → getHealth** in the sidebar and a "Service is healthy" response example.

If `/docs` 404s, you forgot `docs: true`. If `/health` 404s but `/docs` works, your route is registered _after_ `serve()` returns — make sure the `app.get(...)` call is before `serve(app, ...)`.

---

## Code-change cheat sheet

| Step | Where                    | Change                                                                    |
| ---- | ------------------------ | ------------------------------------------------------------------------- |
| 1    | `const app`              | Inspect `new App({ title, version, openapi, docs })`                      |
| 2    | between `app` and `serve` | Inspect `app.get("/health", {...})` with a Zod response schema  |
| 2a   | top of file               | Confirm `import { z } from "zod";` is present                            |
| 3    | bottom                   | (no change — `serve(app, { port: 3000 })` was already there)              |

---

## Common mistakes

- **Forgetting `docs: true`.** No `/docs`, no `/openapi.json`. The route still works; the discoverability does not.
- **Putting `app.get(...)` after `serve(app, ...)`.** `serve()` snapshots the route table. Late registrations are silently ignored on some adapters.
- **Using `interface` instead of `z.object()`.** The framework only understands Standard Schema validators at the contract layer. A TypeScript `interface` is invisible at runtime and to OpenAPI.
- **Dropping `as const` on `status: 200`.** You lose the per-status contract narrowing. The code still compiles, but TypeScript no longer protects you against returning the wrong body for the wrong status.
