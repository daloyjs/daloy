/**
 * Composition primitives for {@link Hooks} bundles. These let you assemble
 * curated middleware stacks (`every`), express "any of these proofs is
 * enough" auth (`some`), and exempt specific paths from a check (`except`).
 *
 * @since 0.19.0
 */

import type { Hooks, BaseContext } from "./types.js";

/**
 * Run every supplied {@link Hooks} bundle in order, pipeline-style.
 * Equivalent to passing the bundles to `app.use(...)` one after another,
 * but lets you package a curated stack as a single value (e.g. "the auth
 * stack for the admin section"). All lifecycle phases compose:
 *
 * - `onRequest` / `onResponse` run in registration order.
 * - `beforeHandle` / `onError` short-circuit on the first `Response`.
 * - `afterHandle` / `onSend` thread the value through every bundle.
 *
 * Symbol-keyed security markers (CORS / CSRF / session / secure-headers)
 * are forwarded onto the merged bundle so boot-time guards still see them.
 *
 * @example
 * ```ts
 * const adminStack = every(
 *   requestId(),
 *   bearerAuth({ validate: (token) => token === env.ADMIN_TOKEN }),
 *   rateLimit({ windowMs: 60_000, max: 30, groupId: "admin" }),
 * );
 * app.use(adminStack);
 * ```
 *
 * @since 0.19.0
 */
export function every(...layers: Hooks[]): Hooks {
  return mergeCombineHooks(layers);
}

/**
 * Run the supplied bundles until one of them passes its `beforeHandle`
 * check without throwing. Useful for "this route accepts a bearer token
 * OR a signed cookie OR an API key" patterns where any single proof of
 * identity is enough.
 *
 * Semantics:
 *
 * - The bundles' `beforeHandle` hooks are awaited in order. The first one
 *   that resolves without throwing wins; its `ctx` mutations (headers,
 *   `ctx.state`, etc.) are preserved.
 * - When a bundle returns a `Response`, that response is treated as a
 *   denial and the next bundle gets a chance to pass. If every bundle
 *   denies, the first denial wins.
 * - When the first denial is a thrown error, that error is rethrown so the
 *   client gets a deterministic status code. Place the auth method whose
 *   `WWW-Authenticate` challenge you want clients to see first.
 * - `afterHandle`, `onSend`, `onResponse`, and `onError` from every bundle
 *   still compose normally — `some()` only changes the `beforeHandle`
 *   evaluation strategy.
 *
 * @example
 * ```ts
 * app.use(some(
 *   bearerAuth({ validate: (token) => token === env.PUBLIC_API_TOKEN }),
 *   session(),
 * ));
 * ```
 *
 * @since 0.19.0
 */
export function some(...layers: Hooks[]): Hooks {
  if (layers.length === 0) return {};
  const stripped = layers.map(({ beforeHandle: _b, ...rest }) => rest);
  const base = mergeCombineHooks(stripped);
  const candidates = layers
    .map((h) => h.beforeHandle)
    .filter((f): f is NonNullable<Hooks["beforeHandle"]> => typeof f === "function");
  if (candidates.length === 0) return base;
  return {
    ...base,
    async beforeHandle(ctx) {
      let firstFailure: { kind: "throw"; err: unknown } | { kind: "response"; res: Response } | undefined;
      for (const fn of candidates) {
        try {
          const r = await fn(ctx);
          if (r instanceof Response) {
            // Treat as a denial — try the next layer.
            if (!firstFailure) firstFailure = { kind: "response", res: r };
            continue;
          }
          // Undefined = pass; bundle accepts the request.
          return undefined;
        } catch (err) {
          if (!firstFailure) firstFailure = { kind: "throw", err };
        }
      }
      if (firstFailure?.kind === "response") return firstFailure.res;
      throw (firstFailure as { kind: "throw"; err: unknown }).err;
    },
  };
}

/**
 * Pattern accepted by {@link except}. Strings starting with `/` are matched
 * against the request `pathname`. `*` matches one path segment (no `/`);
 * `**` matches any suffix (zero or more segments). Functions receive the
 * request context and return `true` to skip the gated bundle.
 *
 * @since 0.19.0
 */
export type ExceptPredicate =
  | string
  | string[]
  | ((ctx: BaseContext<any, any>) => boolean | Promise<boolean>);

/**
 * Run a hook bundle on every request EXCEPT those matching `when`. The
 * canonical use is "apply auth everywhere except the public endpoints":
 *
 * @example
 * ```ts
 * app.use(except(
 *   ["/health", "/openapi.json", "/docs/**"],
 *   bearerAuth({ validate: (token) => token === env.API_TOKEN }),
 * ));
 * ```
 *
 * Only the `beforeHandle` phase is gated — the surrounding
 * `onRequest`/`afterHandle`/`onSend`/`onResponse` phases still run so
 * shared concerns like request-id propagation are not accidentally
 * exempted. Wrap each bundle with {@link except} individually when you
 * need to gate other phases.
 *
 * @since 0.19.0
 */
export function except(when: ExceptPredicate, hooks: Hooks): Hooks {
  const matches = compileExceptMatcher(when);
  const original = hooks.beforeHandle;
  if (!original) return hooks;
  return {
    ...hooks,
    async beforeHandle(ctx) {
      if (await matches(ctx)) return undefined;
      return original(ctx);
    },
  };
}

function compileExceptMatcher(
  when: ExceptPredicate,
): (ctx: BaseContext<any, any>) => Promise<boolean> {
  if (typeof when === "function") {
    return async (ctx) => Boolean(await when(ctx));
  }
  const patterns = Array.isArray(when) ? when : [when];
  const matchers = patterns.map(compilePathPattern);
  return async (ctx) => {
    const path = new URL(ctx.request.url).pathname;
    return matchers.some((m) => m(path));
  };
}

function compilePathPattern(pattern: string): (path: string) => boolean {
  if (!pattern.startsWith("/")) {
    throw new Error(
      `except(): path patterns must start with "/" (got ${JSON.stringify(pattern)}).`,
    );
  }
  if (!pattern.includes("*")) {
    return (path) => path === pattern;
  }
  const escaped = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const regex = new RegExp(`^${escaped}$`);
  return (path) => regex.test(path);
}

function mergeCombineHooks(layers: Hooks[]): Hooks {
  const pick = <K extends keyof Hooks>(key: K): NonNullable<Hooks[K]>[] =>
    layers
      .map((h) => h[key])
      .filter((f): f is NonNullable<Hooks[K]> => typeof f === "function");

  const merged: Hooks = {};
  const onRequest = pick("onRequest");
  if (onRequest.length > 0) {
    merged.onRequest = async (req) => {
      for (const fn of onRequest) await fn(req);
    };
  }
  const beforeHandle = pick("beforeHandle");
  if (beforeHandle.length > 0) {
    merged.beforeHandle = async (ctx) => {
      for (const fn of beforeHandle) {
        const r = await fn(ctx);
        if (r instanceof Response) return r;
      }
      return undefined;
    };
  }
  const afterHandle = pick("afterHandle");
  if (afterHandle.length > 0) {
    merged.afterHandle = async (ctx, value) => {
      let current: unknown = value;
      for (const fn of afterHandle) {
        const out = await fn(ctx, current);
        if (out !== undefined) current = out;
      }
      return current;
    };
  }
  const onError = pick("onError");
  if (onError.length > 0) {
    merged.onError = async (err, ctx) => {
      for (const fn of onError) {
        const r = await fn(err, ctx);
        if (r instanceof Response) return r;
      }
      return undefined;
    };
  }
  const onSend = pick("onSend");
  if (onSend.length > 0) {
    merged.onSend = async (res, ctx) => {
      let current = res;
      for (const fn of onSend) {
        const r = await fn(current, ctx);
        if (r instanceof Response) current = r;
      }
      return current;
    };
  }
  const onResponse = pick("onResponse");
  if (onResponse.length > 0) {
    merged.onResponse = async (res) => {
      for (const fn of onResponse) await fn(res);
    };
  }
  // Forward symbol-keyed security markers (CORS / CSRF / session /
  // secure-headers) so boot-time and per-request guards still see them
  // on the composed bundle.
  for (const hooks of layers) {
    const record = hooks as Record<PropertyKey, unknown>;
    for (const key of Object.getOwnPropertySymbols(record)) {
      if (!(key in (merged as Record<PropertyKey, unknown>))) {
        (merged as Record<PropertyKey, unknown>)[key] = record[key];
      }
    }
  }
  return merged;
}
