/**
 * Shared auth-hook stamping, dependency-free so `jwk`, `mtls` and
 * `http-signatures` can use it without pulling in the middleware module.
 *
 * Stamping does two things:
 *
 * 1. Sets the `daloyjs.auth.hook` marker the boot guards look for (an auth
 *    hook is present in the route's chain).
 * 2. Wraps the bundle's `preBody` / `beforeHandle` so that when the hook
 *    actually runs and lets the request through, it records that on
 *    `ctx.state`. Presence alone is not proof: `except()` or a permissive
 *    `some()` branch can keep a present auth hook from ever running, so the App
 *    checks this record at request time on routes that require auth.
 *
 * @internal
 */

/** Marker the boot guards read: an auth hook is in the chain. */
const AUTH_HOOK = Symbol.for("daloyjs.auth.hook");
/** Per-request record: an auth hook ran and did not reject. */
export const AUTH_RAN = Symbol.for("daloyjs.auth.ran");
/** Set on a bundle once its functions are wrapped, so stamping is idempotent. */
const AUTH_WRAPPED = Symbol.for("daloyjs.auth.wrapped");

type HookFn = (ctx: { state: Record<PropertyKey, unknown> }, ...rest: unknown[]) => unknown;

function recordPass(ctx: { state: Record<PropertyKey, unknown> }, result: unknown): unknown {
  if (!(result instanceof Response)) ctx.state[AUTH_RAN] = true;
  return result;
}

function wrap(fn: HookFn): HookFn {
  return (ctx, ...rest) => {
    const result = fn(ctx, ...rest);
    if (result !== null && typeof result === "object" && typeof (result as PromiseLike<unknown>).then === "function") {
      return (result as PromiseLike<unknown>).then((resolved) => recordPass(ctx, resolved));
    }
    return recordPass(ctx, result);
  };
}

/**
 * Mark `hooks` as an authentication bundle and record, per request, when it
 * runs and lets the request through. Mutates and returns `hooks`.
 *
 * @param hooks - The auth hook bundle (any object with `preBody` /
 *   `beforeHandle`).
 * @param selfRecording - `true` when the bundle calls {@link markAuthPassed}
 *   itself (the built-in auth middlewares), so it is only marked, not wrapped.
 * @returns The same object, stamped and wrapped.
 * @internal
 */
export function stampAuthHook<T extends object>(hooks: T, selfRecording = false): T {
  const record = hooks as Record<PropertyKey, unknown>;
  record[AUTH_HOOK] = true;
  if (record[AUTH_WRAPPED] === true) return hooks;
  if (selfRecording) {
    // The hook calls markAuthPassed() itself, which costs nothing extra on
    // the request path; wrapping an async hook would add a promise per call.
    Object.defineProperty(record, AUTH_WRAPPED, { value: true, enumerable: false });
    return hooks;
  }
  for (const phase of ["preBody", "beforeHandle"] as const) {
    const fn = record[phase];
    if (typeof fn === "function") record[phase] = wrap(fn as HookFn);
  }
  Object.defineProperty(record, AUTH_WRAPPED, { value: true, enumerable: false });
  return hooks;
}

/**
 * Record, from inside an auth hook, that it ran and lets this request through.
 * Built-in auth middlewares call this at their success return.
 *
 * @param ctx - The request context passed to the hook.
 * @internal
 */
export function markAuthPassed(ctx: { state: unknown }): void {
  (ctx.state as Record<PropertyKey, unknown>)[AUTH_RAN] = true;
}
