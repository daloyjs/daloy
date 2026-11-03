/**
 * Type-level regression tests for {@link RequestState}: the `requestId` and
 * `log` fields the framework always writes to `ctx.state` must be typed on
 * every HTTP context without any `AppState` augmentation. A regression here
 * surfaces as `state.log` collapsing to `unknown` (every app re-declaring
 * the field just to log from a handler).
 */

import { z } from "zod";

import { App } from "../../src/app.js";
import type { Logger } from "../../src/logger.js";
import type {
  ContextState,
  PreBodyContext,
  RequestState,
} from "../../src/types.js";

/** Compile-time assertion that `T` is exactly `true`. */
type Expect<T extends true> = T;
/** Structural equality check between two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

new App({ logger: false }).route({
  method: "GET",
  path: "/health",
  responses: {
    200: { description: "ok", body: z.object({ ok: z.boolean() }) },
  },
  hooks: {
    preBody: (ctx: PreBodyContext) => {
      type _PreBodyLog = Expect<Equal<typeof ctx.state.log, Logger>>;
      type _PreBodyId = Expect<Equal<typeof ctx.state.requestId, string>>;
      ctx.state.log.debug({ phase: "preBody" });
      return undefined;
    },
  },
  handler: ({ state }) => {
    type _LogTyped = Expect<Equal<typeof state.log, Logger>>;
    type _IdTyped = Expect<Equal<typeof state.requestId, string>>;
    // Other keys still fall back to the index signature.
    type _OtherKeysUnknown = Expect<
      Equal<(typeof state)["somethingElse"], unknown>
    >;
    state.log.info({ requestId: state.requestId }, "health probe");
    const id: string = state.requestId;
    void id;
    return { status: 200 as const, body: { ok: true } };
  },
});

// `ContextState` is the public name for the handler's `state` type.
type _ContextStateHasRequestFields = Expect<
  Equal<Pick<ContextState, keyof RequestState>, RequestState>
>;
