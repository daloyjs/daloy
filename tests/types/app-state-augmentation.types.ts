/**
 * Type-level regression tests for the {@link AppState} module-augmentation
 * hook.
 *
 * These assertions are validated at compile time by `pnpm typecheck` (which
 * runs `tsc` against `tsconfig.typetest.json`). They guard the contract that
 * augmenting `AppState` from application code strongly types `ctx.state` in
 * every route handler — the pattern every ORM/ODM/database doc relies on via
 * `app.decorate(...)`. A regression here surfaces as `state.<key>` collapsing
 * to `any`/`unknown` (dead autocomplete, no type safety) in user projects.
 */

import { z } from "zod";

import { App } from "../../src/app.js";

declare module "../../src/types.js" {
  interface AppState {
    db: { ping(): "pong" };
  }
}

/** Compile-time assertion that `T` is exactly `true`. */
type Expect<T extends true> = T;
/** Structural equality check between two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
/** Detects the `any` type (only `any` absorbs the impossible `0 extends 1`). */
type IsAny<T> = 0 extends 1 & T ? true : false;

new App({ logger: false }).route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "ok", body: z.object({ ok: z.boolean() }) },
  },
  handler: ({ params, state }) => {
    // The augmented key is precisely typed — not `any`, not `unknown`.
    type _DbNotAny = Expect<Equal<IsAny<typeof state.db>, false>>;
    type _DbIsTyped = Expect<Equal<ReturnType<typeof state.db.ping>, "pong">>;
    // Params stay independently inferred alongside the augmentation.
    type _ParamsTyped = Expect<Equal<typeof params.id, string>>;
    // Non-augmented keys stay `unknown` (index-signature fallback), so the
    // augmentation narrows exactly one key and nothing else silently widens.
    type _OtherKeysUnknown = Expect<Equal<(typeof state)["somethingElse"], unknown>>;
    const pong: "pong" = state.db.ping();
    void pong;
    return { status: 200 as const, body: { ok: true } };
  },
});
