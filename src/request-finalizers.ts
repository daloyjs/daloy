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
