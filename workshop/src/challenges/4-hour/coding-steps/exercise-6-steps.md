# Exercise 6 — Step-by-Step

> Goal: boot the same `App` from two adapters. The factory function is shared; only the `serve` import differs.

You are editing [`exercise-6.ts`](../exercise-6.ts). Reference: [`solutions/exercise-6-end.ts`](../solutions/exercise-6-end.ts).

---

## Mental model first

DaloyJS adapters are intentionally tiny. Each one does three things:

1. Receive a runtime-native request object (Node `IncomingMessage`, Bun `Request`, Workers `Request`, …).
2. Convert it to a Web-standard `Request`.
3. Hand it to `app.fetch(request)` and write back the resulting `Response`.

That means your application code never imports anything runtime-specific. It only uses `app.get(...)` (and its sibling method shorthands) and `app.use(...)`. The adapter is a boot detail, not a programming model.

Order of work:

1. Extract `buildApp()` so the App construction is reusable.
2. Detect the runtime at the bottom of the file.
3. Dynamically import the right adapter so the missing adapter doesn't crash the other runtime at import time.

---

## Step 1 — Extract `buildApp()`

Move everything from `const app = new App({...})` through the last `app.get(...)` into a function:

```ts
export function buildApp(): App {
  const app = new App({
    title: "Workshop API",
    version: "0.1.0",
    openapi: { info: { title: "Workshop API", version: "0.1.0" } },
    docs: true,
  });

  app.get(
    "/health",
    {
      operationId: "getHealth",
      tags: ["Meta"],
      responses: { 200: { description: "OK", body: z.object({ runtime: z.string() }) } },
    },
    async () => ({
      status: 200 as const,
      body: { runtime: detectRuntime() },
    }),
  );

  return app;
}

function detectRuntime(): string {
  // @ts-expect-error Bun-only global
  if (typeof Bun !== "undefined") return "Bun";
  // @ts-expect-error Deno-only global
  if (typeof Deno !== "undefined") return "Deno";
  if (typeof process !== "undefined" && process.versions?.node) return "Node.js";
  return "Unknown";
}
```

**Why a factory and not a top-level `app`:** in a multi-adapter file you may want to construct the App _after_ you've inspected `process.argv` or env vars. A factory makes that future easy. It also makes the App trivially testable — `buildApp()` from a `node:test` file with no listen socket.

**Why the `@ts-expect-error` comments:** `Bun` and `Deno` are runtime globals not present in the Node TypeScript libs. The comment tells the compiler "we know this isn't typed, and we expect that to be the case".

---

## Step 2 — Pick the adapter at boot

Below `buildApp` / `detectRuntime`:

```ts
const app = buildApp();

// @ts-expect-error Bun-only global
if (typeof Bun !== "undefined") {
  const { serve } = await import("@daloyjs/core/bun");
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/health (Bun)");
} else {
  const { serve } = await import("@daloyjs/core/node");
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/health (Node.js)");
}
```

**Why dynamic `await import(...)` instead of static `import`:** static imports run on every parse, even on the branch you don't take. `@daloyjs/core/bun` references the global `Bun` at import time on some versions; in Node that throws. The dynamic import defers the load until you know which runtime you're in.

**Why this file uses top-level `await`:** Node 20+ ESM and Bun both support it natively. If your target environment doesn't, wrap the boot in `async function main() { … }; main();`.

---

## Step 3 — Verify under Node

```bash
pnpm dev:4:6
curl -s http://localhost:3000/health
# {"runtime":"Node.js"}
```

---

## Step 4 — (Optional) Verify under Bun

If you have Bun installed:

```bash
bun src/challenges/4-hour/exercise-6.ts
curl -s http://localhost:3000/health
# {"runtime":"Bun"}
```

`buildApp()` ran the same code both times. The only thing that changed was which `serve` got imported.

---

## Code-change cheat sheet

| Step | Where         | Change                                                                |
| ---- | ------------- | --------------------------------------------------------------------- |
| 1    | Mid-file      | Wrap the App construction in `export function buildApp(): App { ... }` |
| 1a   | Mid-file      | Add `detectRuntime()` and use it in the `/health` handler              |
| 2    | Bottom        | Replace `serveNode(app, ...)` with a dynamic adapter pick              |

---

## Common mistakes

- **Static-importing both adapters at the top of the file.** This breaks the runtime that doesn't have the other adapter installed in its target. Always dynamically import the runtime-specific one.
- **Putting `process` checks in `buildApp()`.** That couples the App to the boot host. Keep `process` / `Bun` / `Deno` references at the boot level only.
- **Hardcoding `runtime: "Node.js"` in the handler response.** It works in Node; in Bun it lies. Use a real runtime detection so the response stays honest.
