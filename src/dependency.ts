/**
 * Typed-DI chain helper.
 *
 * `defineDependency()` wraps a middleware so the framework deduplicates
 * evaluation per request — a request that triggers two routes both depending
 * on `getCurrentUser` runs the auth check exactly once per request, with the
 * typed result threaded through `ctx.state` declared in {@link AppState}.
 *
 * Refuses-at-construction on cyclic dependency declarations (companion to
 * the cyclic plugin-extension-ordering refusal in {@link App.register}).
 *
 * @since 0.24.0
 */

import type { BaseContext, Hooks } from "./types.js";

/** Symbol stamped on hooks returned by {@link defineDependency}. */
export const DEPENDENCY_MARKER: unique symbol = Symbol.for(
  "daloyjs.dependency.marker",
);

/** Per-request cache of dependency results, keyed by dependency name. */
const RESULTS_KEY: unique symbol = Symbol.for("daloyjs.dependency.results");

/** Configuration passed to {@link defineDependency}. */
export interface DependencyOptions<TName extends string, TValue, TStateKey extends string> {
  /** Unique dependency name. Used for cycle detection and dedup. */
  name: TName;
  /** Other dependency names this one requires (must run + complete first). */
  dependsOn?: readonly string[];
  /** Key the resolved value is written to on `ctx.state`. Defaults to `name`. */
  stateKey?: TStateKey;
  /**
   * Resolve the dependency value. Receives the per-request context, returns
   * the value to stamp on `ctx.state[stateKey]`. Called at most once per
   * request when the dependency wrapper is composed multiple times.
   */
  resolve: (ctx: BaseContext<any, any>) => TValue | Promise<TValue>;
}

/** Hooks bundle returned by {@link defineDependency} (carries metadata). */
export interface DependencyHooks extends Hooks {
  /** Non-enumerable dependency metadata (`name` + `dependsOn`) used for dedup and cycle checks. */
  readonly [DEPENDENCY_MARKER]: {
    readonly name: string;
    readonly dependsOn: readonly string[];
  };
}

/**
 * Wrap a per-request value producer as a {@link Hooks} bundle. The hook
 * runs in `beforeHandle` and writes its resolved value to
 * `ctx.state[stateKey]` (default `name`). Composing the same dependency
 * twice in one chain runs `resolve()` exactly once.
 *
 * @param opts - Dependency `name`, optional `dependsOn` / `stateKey`, and the `resolve` function.
 * @returns A {@link DependencyHooks} bundle to compose via `app.use()` / route hooks.
 * @throws {Error} When `name` is empty or the dependency declares itself in `dependsOn` (cycle).
 * @since 0.24.0
 */
export function defineDependency<
  TName extends string,
  TValue,
  TStateKey extends string = TName,
>(opts: DependencyOptions<TName, TValue, TStateKey>): DependencyHooks {
  if (typeof opts.name !== "string" || opts.name.length === 0) {
    throw new Error("defineDependency(): name is required and must be a non-empty string.");
  }
  const dependsOn = opts.dependsOn ?? [];
  if (dependsOn.includes(opts.name)) {
    throw new Error(
      `defineDependency(): dependency "${opts.name}" declares itself as a dependency (cycle).`,
    );
  }
  const stateKey = opts.stateKey ?? opts.name;

  const hooks: Hooks = {
    async beforeHandle(ctx) {
      const state = ctx.state as Record<string, unknown> & {
        [RESULTS_KEY]?: Map<string, unknown>;
      };
      let cache = state[RESULTS_KEY];
      if (!cache) {
        cache = new Map();
        state[RESULTS_KEY] = cache;
      }
      if (cache.has(opts.name)) {
        // Already resolved this request — re-stamp for the active stateKey
        // in case a sibling chain wrote it under a different key.
        state[stateKey] = cache.get(opts.name);
        return;
      }
      // Verify declared dependencies ran first; the developer composes them
      // in the correct order via `every(...)` or registration order.
      for (const dep of dependsOn) {
        if (!cache.has(dep)) {
          throw new Error(
            `defineDependency(): "${opts.name}" requires "${dep}" to be composed first.`,
          );
        }
      }
      const value = await opts.resolve(ctx);
      cache.set(opts.name, value);
      state[stateKey] = value;
    },
  };
  Object.defineProperty(hooks, DEPENDENCY_MARKER, {
    value: { name: opts.name, dependsOn: [...dependsOn] },
    enumerable: false,
    writable: false,
  });
  return hooks as DependencyHooks;
}
