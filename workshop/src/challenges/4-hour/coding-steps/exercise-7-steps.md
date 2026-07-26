# Exercise 7 — Step-by-Step

> Goal: introspect the running app and lock the contract with a tiny `node:test` test file. The whole thing is under 80 lines of test code.

You are editing [`exercise-7.ts`](../exercise-7.ts) and [`tests/exercise-7.test.ts`](../../../../tests/exercise-7.test.ts). Reference: [`solutions/exercise-7-end.ts`](../solutions/exercise-7-end.ts).

---

## Mental model first

Two complementary surfaces:

1. **`app.introspect()`** — synchronous, in-process. Returns an array of every registered operation with method, path, operationId, request/response schema references. Use it for:
   - "Did we delete a route by accident?" guards.
   - Static checks on every PR.
   - Boot-time logging of the full route table.
2. **`fetch` + `node:test`** — exercise the actual HTTP path. Use it for:
   - End-to-end contract assertions (status, headers, body shape).
   - Verifying problem+json shape doesn't regress.

You want both. The introspect check is fast and catches structural regressions (renamed operationId, removed route). The HTTP check is slower but catches runtime regressions (handler logic broke, middleware order changed).

Order of work:

1. Print `app.introspect()` when the exercise runs as a script.
2. Write the three tests against `buildApp()`.

---

## Step 1 — Print the route table at boot

In the `if (import.meta.url === ...)` block, replace the TODO with:

```ts
const app = buildApp();
console.log("Registered routes:");
for (const op of app.introspect()) {
  console.log(`  ${op.method.padEnd(6)} ${op.path}  (operationId=${op.operationId})`);
}
serve(app, { port: 3000 });
```

**Why the `import.meta.url === ...` guard:** it lets the same file be both imported by tests (which use `buildApp` but don't want a listen socket) and run as a script (`pnpm dev:4:7`). The check resolves true only when the file is the entry point.

---

## Step 2 — Write the test file

`tests/exercise-7.test.ts` already exists in the workshop scaffold. Its essential shape is:

```ts
async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = buildApp();
  const { port, close } = serve(app, { port: 0 }); // port 0 = OS-assigned
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await close();
  }
}
```

**Why an ephemeral port:** tests can run in parallel; binding port 3000 means only one test file at a time. `port: 0` asks the OS for any free port, and the adapter returns it on the `{ port, close }` handle. You never have to hard-code a port in a test.

**Why `try { ... } finally { close() }`:** if an assertion throws, the server must still be closed or the next test hangs on port reuse. The `finally` block is non-negotiable.

The three test bodies are short — see the existing file. They cover:

- The happy path **schema** by re-using the exported `BookSchema` from the exercise file. The test imports the same Zod schema the route uses, which means there is exactly one definition of "a Book" in the codebase.
- The 404 path's **content type and status code**, plus that `body.status === 404` (the framework writes the status into the problem+json body too).
- The introspect API, which proves at the type-system level that `getBookById` exists.

---

## Step 3 — Run the tests

```bash
pnpm test
```

You should see three green checkmarks. If you break the handler (e.g. remove the `if (!b) throw ...` line), the 404 test fails immediately.

---

## Code-change cheat sheet

| Step | Where                                 | Change                                                                 |
| ---- | ------------------------------------- | ---------------------------------------------------------------------- |
| 1    | `exercise-7.ts` script block          | `for (const op of app.introspect()) { console.log(...) }`              |
| 2    | `tests/exercise-7.test.ts` (provided) | Read the three tests — confirm they exercise both paths and introspect |

---

## Common mistakes

- **Binding port 3000 in tests.** Parallel runs collide; CI flakes. Always `port: 0`.
- **Not awaiting `close()` in `finally`.** The next test inherits a dangling listener and either flakes or hangs.
- **Asserting on the literal problem+json string.** The framework can change the exact wording at any time. Assert on shape (`status`, `title` present), not exact strings.
- **Re-creating `BookSchema` inside the test file.** Two definitions drift. Import the one the route uses.
