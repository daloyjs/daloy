/**
 * Per-request finalizers that the dispatcher runs in its `finally` block.
 *
 * Middleware that holds a lease for the life of a request (a concurrency slot,
 * for example) cannot rely on its own `onSend` hook alone to release it: the
 * composed `onSend` pipeline stops at the first hook that throws, and an
 * `onError` hook that throws skips `onSend` entirely. A finalizer registered
 * here runs exactly once per request regardless of how the response path
 * ended, so a lease can never leak.
 *
 * The dispatcher checks {@link requestFinalizersEnabled} before touching
 * `ctx.state`, so apps that never register a finalizer pay one module-level
 * boolean read per request.
 *
 * When the `requestTimeoutMs` deadline answers while a step (hook or handler)
 * is still running, the dispatcher marks the request abandoned (see
 * {@link isRequestAbandoned}) and runs the finalizers only after that step
 * settles, so a lease is held for as long as the guarded work actually runs.
 *
 * @internal
 * @module
 */

import type { BaseContext } from "./types.js";

/** @internal `ctx.state` slot holding the pending finalizers for a request. */
const REQUEST_FINALIZERS: unique symbol = Symbol.for("daloyjs.requestFinalizers");

/** A finalizer receives the request context it was registered on. Must be synchronous. */
type RequestFinalizer = (ctx: BaseContext<any, any>) => void;

/**
 * @internal True once any middleware has registered a request finalizer in
 * this process; the dispatcher skips the finalizer lookup while it is false.
 */
export let requestFinalizersEnabled = false;

/**
 * Register a finalizer that the dispatcher runs once, after the response for
 * `ctx` has been produced (or the dispatch failed), even if `onSend`,
 * `onError`, or `onResponse` hooks threw.
 *
 * @param ctx - The request context the lease belongs to.
 * @param fn - Synchronous, idempotent release callback. Errors it throws are
 *   swallowed so one finalizer cannot skip another or mask the response.
 * @internal
 */
export function registerRequestFinalizer(
  ctx: BaseContext<any, any>,
  fn: RequestFinalizer
): void {
  requestFinalizersEnabled = true;
  const state = ctx.state as Record<PropertyKey, unknown>;
  const list = state[REQUEST_FINALIZERS] as RequestFinalizer[] | undefined;
  if (list === undefined) state[REQUEST_FINALIZERS] = [fn];
  else list.push(fn);
}

/** Requests whose deadline answered while a step was still running. */
const ABANDONED_REQUESTS = new WeakSet<object>();

/** False until the first abandoned request, so {@link isRequestAbandoned} stays a boolean read. */
let abandonedSeen = false;

/**
 * Mark `request` as abandoned: the deadline response was built while a step
 * for it was still pending, and its request finalizers will run only once that
 * step settles.
 *
 * @param request - The dispatched request (the same object as `ctx.request`).
 * @internal
 */
export function markRequestAbandoned(request: object): void {
  abandonedSeen = true;
  ABANDONED_REQUESTS.add(request);
}

/**
 * True when the response being sent for `ctx` was built by the request
 * deadline while the handler (or a hook) was still running. Lease-holding
 * `onSend` hooks must then leave the release to their request finalizer, which
 * the dispatcher defers until the abandoned step settles.
 *
 * @param ctx - The request context passed to `onSend`.
 * @returns Whether the request's work is still running after its response.
 * @internal
 */
export function isRequestAbandoned(ctx: BaseContext<any, any>): boolean {
  return abandonedSeen && ABANDONED_REQUESTS.has(ctx.request);
}

/**
 * Run and clear every finalizer registered on `ctx`. Safe to call more than
 * once; later calls are no-ops. Never throws.
 *
 * @param ctx - The request context, or `undefined` when none was built.
 * @internal
 */
export function runRequestFinalizers(ctx: BaseContext<any, any> | undefined): void {
  if (ctx === undefined) return;
  const state = ctx.state as Record<PropertyKey, unknown> | undefined;
  if (state === undefined || state === null) return;
  const list = state[REQUEST_FINALIZERS] as RequestFinalizer[] | undefined;
  if (list === undefined) return;
  state[REQUEST_FINALIZERS] = undefined;
  for (const fn of list) {
    try {
      fn(ctx);
    } catch {
      // A failing finalizer must not skip the rest or replace the response.
    }
  }
}

/**
 * Number of finalizers currently registered on `ctx`, for use as a mark with
 * {@link rollbackRequestFinalizers}.
 *
 * @param ctx - The request context.
 * @returns The current finalizer count (0 when none were registered).
 * @internal
 */
export function requestFinalizerMark(ctx: BaseContext<any, any>): number {
  const list = (ctx.state as Record<PropertyKey, unknown>)[REQUEST_FINALIZERS] as
    | RequestFinalizer[]
    | undefined;
  return list === undefined ? 0 : list.length;
}

/**
 * Run and remove every finalizer registered on `ctx` after `mark` (a value from
 * {@link requestFinalizerMark}), oldest first. Used by `some()` when a candidate
 * branch is rejected: leases that branch acquired (a `concurrencyLimit()` slot,
 * an `idempotency()` reservation) are released right away, while the
 * bookkeeping they read on `ctx.state` is still in place, instead of being
 * orphaned when the branch's state changes are rolled back. Finalizers
 * registered before `mark` are left untouched. Never throws.
 *
 * @param ctx - The request context.
 * @param mark - Finalizer count taken before the branch ran.
 * @internal
 */
export function rollbackRequestFinalizers(ctx: BaseContext<any, any>, mark: number): void {
  const state = ctx.state as Record<PropertyKey, unknown>;
  const list = state[REQUEST_FINALIZERS] as RequestFinalizer[] | undefined;
  if (list === undefined || list.length <= mark) return;
  const added = list.splice(mark);
  for (const fn of added) {
    try {
      fn(ctx);
    } catch {
      // A failing finalizer must not skip the rest or replace the response.
    }
  }
}
