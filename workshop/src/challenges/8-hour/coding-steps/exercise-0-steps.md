# 8-Hour · Exercise 0 — Step-by-Step

> Goal: bootstrap an App, register `/health`, and prove `app.introspect()` works.

If you already did the [4-hour exercise 0 walkthrough](../../4-hour/coding-steps/exercise-0-steps.md), skip to Step 4 below. The first three steps are identical.

## Step 1 — Construct the App

```ts
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});
```

## Step 2 — Register `/health`

```ts
app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    responses: { 200: { description: "OK", body: z.object({ status: z.literal("ok") }) } },
  },
  async () => ({ status: 200 as const, body: { status: "ok" as const } }),
);
```

## Step 3 — `serve(app, { port: 3000 })`

The starter already has the imports; you're filling in the body.

## Step 4 — Dump `app.introspect()` at boot

Above the `serve(...)` call:

```ts
console.log("Registered routes:");
for (const op of app.introspect()) {
  console.log(`  ${op.method.padEnd(6)} ${op.path}  (operationId=${op.operationId})`);
}
```

**Why this matters:** the rest of the 8-hour track adds many routes and middleware. Every save should print a tidy table — if the table looks wrong, you've broken something structural before you even open `/docs`.

## Code-change cheat sheet

| Step | Where     | Change                                                                    |
| ---- | --------- | ------------------------------------------------------------------------- |
| 1    | Top       | `const app = new App({ title, version, openapi: { info }, docs: true })` |
| 2    | Mid       | `app.get("/health", { ... }, handler)`                                   |
| 3    | Bottom    | `serve(app, { port: 3000 })`                                              |
| 4    | Above (3) | `for (const op of app.introspect()) console.log(...)`                    |

## Common mistakes

See [`../../4-hour/coding-steps/exercise-0-steps.md`](../../4-hour/coding-steps/exercise-0-steps.md). Same gotchas apply — forgetting `docs: true`, dropping `as const`, registering routes after `serve()`.
