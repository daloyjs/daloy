/**
 * Composition primitives for {@link Hooks} bundles. These let you assemble
 * curated middleware stacks (`every`), express "any of these proofs is
 * enough" auth (`some`), and exempt specific paths from a check (`except`).
 *
 * @since 0.19.0
 */

import type { Hooks, BaseContext, PreBodyContext } from "./types.js";
import { AUTH_OPTIONAL_PASS, AUTH_RAN } from "./internal-auth.js";
import {
  _mergePreBodyWithEarlyRejections,
  _orderBeforeHandleForReplay,
  COMBINED_BEFORE_HANDLE_LAYERS,
  type CombinedBeforeHandleLayers,
  CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  DEFERRED_PRE_BODY_HOOK_MARKER,
  DEFERRED_PRE_BODY_ONLY_MARKER,
  EARLY_REJECTION_HOOK_MARKER,
  PRE_BODY_HANDLES_OWN_EARLY_REJECTIONS,
  PRE_BODY_SAFE_HOOK_MARKER,
  REQUIRE_SCOPES_HOOK_MARKER,
} from "./middleware.js";
import { requestFinalizerMark, rollbackRequestFinalizers } from "./request-finalizers.js";

/**
 * Run every supplied {@link Hooks} bundle in order, pipeline-style.
 * Equivalent to passing the bundles to `app.use(...)` one after another,
 * but lets you package a curated stack as a single value (e.g. "the auth
 * stack for the admin section"). All lifecycle phases compose:
 *
 * - `onRequest` / `onResponse` run in registration order.
 * - `preBody` / `beforeHandle` / `onError` short-circuit on the first `Response`.
 * - `afterHandle` / `onSend` thread the value through every bundle.
 *
 * Symbol-keyed security markers (CORS / CSRF / session / secure-headers)
 * are forwarded onto the merged bundle so boot-time guards still see them.
 * Before-handler authentication remains ahead of stored-response replay,
 * including when another all-of bundle encloses this stack.
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
 * @param layers Hook bundles to compose, executed in the order given.
 * @returns A single merged {@link Hooks} bundle preserving all lifecycle phases.
 * @since 0.19.0
 */
export function every(...layers: Hooks[]): Hooks {
  return mergeCombineHooks(layers);
}

/**
 * Run the supplied bundles until one of them passes its auth gate
 * check without throwing. Useful for "this route accepts a bearer token
 * OR a signed cookie OR an API key" patterns where any single proof of
 * identity is enough.
 *
 * Semantics:
 *
 * - The bundles' `preBody` or `beforeHandle` hooks are awaited in order. The first one
 *   that resolves without throwing wins; its `ctx` mutations (headers,
 *   `ctx.state`, etc.) are preserved.
 * - When a bundle returns a `Response`, that response is treated as a
 *   denial and the next bundle gets a chance to pass. If every bundle
 *   denies, the first denial wins.
 * - Each bundle is a transaction over `ctx.state`: when it throws or returns
 *   a `Response`, every own string and symbol key it added or changed (a
 *   rejected token's `user`, the auth-ran record of an auth hook that passed
 *   before a later gate in the same branch denied) is rolled back before the
 *   next bundle runs, and any lease it acquired (a `concurrencyLimit()` slot,
 *   an `idempotency()` reservation) is released at the same time. Since 1.20.0.
 * - When the first denial is a thrown error, that error is rethrown so the
 *   client gets a deterministic status code. Place the auth method whose
 *   `WWW-Authenticate` challenge you want clients to see first.
 * - A branch in `optional` mode (for example `httpSignatureAuth({ optional: true })`)
 *   that sees **no** credential does not win: the remaining branches still
 *   run, so a caller presenting a credential for a later branch is
 *   authenticated by it. Its unauthenticated pass-through is honoured only
 *   when no branch denies the request; any denial wins over it. Since 1.22.0.
 * - `afterHandle`, `onSend`, `onResponse`, and `onError` from every bundle
 *   still compose normally — `some()` only changes the auth-gate
 *   evaluation strategy.
 * - `requireScopes()` inside a branch applies to that branch only: the
 *   bundle does not advertise an all-of union of every branch's scopes.
 *   When a branch pairs a `preBody` auth hook with a default-phase
 *   `requireScopes()`, the whole `some()` runs in `preBody`, ahead of body
 *   parsing and decompression. Since 1.22.0.
 *
 * @example
 * ```ts
 * app.use(some(
 *   bearerAuth({ validate: (token) => token === env.PUBLIC_API_TOKEN }),
 *   session(),
 * ));
 * ```
 *
 * @param layers Candidate hook bundles; the first auth gate that passes wins.
 * @returns A merged {@link Hooks} bundle with an OR-style auth-gate strategy.
 * @since 0.19.0
 */
export function some(...layers: Hooks[]): Hooks {
  if (layers.length === 0) return {};
  const stripped = layers.map(
    ({ preBody: _p, beforeHandle: _b, ...rest }) => rest,
  );
  const base = mergeCombineHooks(stripped);
  const hadConditionalScopes =
    Array.isArray((base as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER]) ||
    layers.some(
      (h) =>
        typeof h.beforeHandle === "function" &&
        (h.beforeHandle as unknown as Record<PropertyKey, unknown>)[
          CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
        ] === true,
    );
  // OR-composed branches do not impose an unconditional all-of scope union on
  // the route; each branch enforces and records its own scopes when it runs.
  delete (base as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER];
  const preBodyCandidates = layers
    .map((h) => h.preBody)
    .filter((f): f is NonNullable<Hooks["preBody"]> => typeof f === "function");
  const hasUnsafeBeforeHandle = layers.some(
    (h) =>
      typeof h.beforeHandle === "function" &&
      (h.beforeHandle as unknown as Record<PropertyKey, unknown>)[
        PRE_BODY_SAFE_HOOK_MARKER
      ] !== true,
  );
  const usePreBody =
    preBodyCandidates.length > 0 && !hasUnsafeBeforeHandle;
  const candidates = layers.flatMap((hooks) => {
    if (hooks.preBody && hooks.beforeHandle) {
      return [
        async (ctx: BaseContext<any, any>) => {
          const early = await hooks.preBody!(ctx);
          return early instanceof Response
            ? early
            : hooks.beforeHandle!(ctx);
        },
      ];
    }
    const gate = hooks.preBody ?? hooks.beforeHandle;
    return gate ? [gate] : [];
  });
  if (candidates.length === 0) return base;
  const runCandidates = async (ctx: BaseContext<any, any>) => {
    let firstFailure:
      | { kind: "throw"; err: unknown }
      | { kind: "response"; res: Response }
      | undefined;
    // Each candidate is a transaction over ctx.state: a branch that denies
    // must not leave its identity (a revoked token's `user`, the AUTH_RAN
    // record of an auth hook that passed before a later gate in the same
    // branch denied, or a dependency value it resolved into the shared
    // per-request RESULTS_KEY cache — see restoreState) for the winning
    // branch or the handler to read. Leases
    // the branch acquired are released first, while their bookkeeping is
    // still on ctx.state, so the rollback cannot orphan a slot.
    const state = ctx.state as Record<PropertyKey, unknown>;
    // An earlier optional-mode hook may already have recorded a pass-through;
    // clear it while the branches run so a branch's own pass-through is
    // detectable, and put it back afterwards (see `finally`).
    const priorOptionalPass = state[AUTH_OPTIONAL_PASS] === true;
    if (priorOptionalPass) delete state[AUTH_OPTIONAL_PASS];
    let sawOptionalPassthrough = false;
    const snapshot = snapshotState(state);
    const finalizerMark = requestFinalizerMark(ctx);
    try {
      for (const fn of candidates) {
        try {
          const r = await fn(ctx);
          if (r instanceof Response) {
            rollbackRequestFinalizers(ctx, finalizerMark);
            restoreState(state, snapshot);
            if (!firstFailure) firstFailure = { kind: "response", res: r };
            continue;
          }
          // An optional-mode auth branch that saw no credential did not
          // authenticate the caller: roll back its pass-through mark and let
          // the remaining branches evaluate the request. The pass-through is
          // honoured only when no branch denies; a denial (a present but
          // invalid credential, a strict branch's 401) wins over it.
          if (state[AUTH_OPTIONAL_PASS] === true && state[AUTH_RAN] !== true) {
            sawOptionalPassthrough = true;
            rollbackRequestFinalizers(ctx, finalizerMark);
            restoreState(state, snapshot);
            continue;
          }
          return undefined;
        } catch (err) {
          rollbackRequestFinalizers(ctx, finalizerMark);
          restoreState(state, snapshot);
          if (!firstFailure) firstFailure = { kind: "throw", err };
        }
      }
      if (firstFailure?.kind === "response") return firstFailure.res;
      if (firstFailure?.kind === "throw") throw firstFailure.err;
      if (sawOptionalPassthrough) state[AUTH_OPTIONAL_PASS] = true;
      return undefined;
    } finally {
      if (priorOptionalPass) state[AUTH_OPTIONAL_PASS] = true;
    }
  };
  if (usePreBody) {
    return { ...base, preBody: runCandidates };
  }
  if (hadConditionalScopes) {
    (runCandidates as unknown as Record<PropertyKey, unknown>)[
      CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
    ] = true;
  }
  return {
    ...base,
    beforeHandle: runCandidates,
  };
}

/**
 * Global-registry symbol under which `defineDependency()` keeps its
 * per-request results Map (the same `Symbol.for` key used in
 * `dependency.ts`). The Map is mutated in place (`cache.set(...)`), so a
 * reference-compare snapshot cannot see a denied branch's writes — they must
 * be reconciled entry-by-entry on rollback.
 */
const DEPENDENCY_RESULTS_KEY = Symbol.for("daloyjs.dependency.results");

/** Own string and symbol keys of `ctx.state` with their values, taken before a `some()` candidate runs. */
interface StateSnapshot {
  keys: PropertyKey[];
  values: unknown[];
  /**
   * Shallow copy of the pre-existing dependency-results Map, used to undo
   * in-place mutations a denied branch made to it. `undefined` when no Map
   * existed at snapshot time (a branch-created Map is dropped wholesale by
   * the key sweep in {@link restoreState}).
   */
  dependencyResults?: Map<string, unknown>;
}

function snapshotState(state: Record<PropertyKey, unknown>): StateSnapshot {
  const keys = Reflect.ownKeys(state);
  const values = new Array<unknown>(keys.length);
  for (let i = 0; i < keys.length; i++) values[i] = state[keys[i] as PropertyKey];
  const results = state[DEPENDENCY_RESULTS_KEY];
  const dependencyResults = results instanceof Map ? new Map(results) : undefined;
  return { keys, values, dependencyResults };
}

/** Put `state` back to `snapshot`: drop keys a failed branch added, reset the ones it changed. */
function restoreState(state: Record<PropertyKey, unknown>, snapshot: StateSnapshot): void {
  for (const key of Reflect.ownKeys(state)) {
    if (!snapshot.keys.includes(key)) delete state[key];
  }
  for (let i = 0; i < snapshot.keys.length; i++) {
    const key = snapshot.keys[i] as PropertyKey;
    if (state[key] !== snapshot.values[i]) state[key] = snapshot.values[i];
  }
  // Reconcile in-place mutations of the dependency-results Map. The generic
  // passes above only compare references, and a denied branch's
  // `cache.set(name, value)` keeps the same Map identity — without this
  // pass, a value derived under a *denied* auth branch would be served to
  // the winning branch from the shared per-request cache.
  if (snapshot.dependencyResults !== undefined) {
    const live = state[DEPENDENCY_RESULTS_KEY];
    if (live instanceof Map) {
      for (const key of [...live.keys()]) {
        if (!snapshot.dependencyResults.has(key)) live.delete(key);
      }
      for (const [key, value] of snapshot.dependencyResults) {
        if (!live.has(key) || live.get(key) !== value) live.set(key, value);
      }
    } else {
      state[DEPENDENCY_RESULTS_KEY] = new Map(snapshot.dependencyResults);
    }
  }
}

/**
 * Pattern accepted by {@link except}. Strings starting with `/` are matched
 * against the request `pathname`. `*` matches one non-empty path segment
 * (no `/`); `**` matches any suffix (zero or more segments). Trailing slashes
 * are ignored on both the pattern and the request, exactly as the router
 * ignores them, so a pattern can never exempt a path that the router
 * dispatches to a different (protected) route. Functions receive the
 * request context and return `true` to skip the gated bundle.
 *
 * @since 0.19.0
 */
export type ExceptPredicate =
  | string
  | string[]
  | ((
    ctx: PreBodyContext<any> | BaseContext<any, any>,
  ) => boolean | Promise<boolean>);

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
 * The `preBody` and `beforeHandle` phases are gated — the surrounding
 * `onRequest`/`afterHandle`/`onSend`/`onResponse` phases still run so
 * shared concerns like request-id propagation are not accidentally
 * exempted. Wrap each bundle with {@link except} individually when you
 * need to gate other phases.
 *
 * A wrapped `cors()` policy is off on the exempted paths: it adds no CORS
 * headers there, and (since 1.20.0) it no longer lets the cross-origin write
 * guard accept a `POST`/`PUT`/`PATCH`/`DELETE` from its origins there. With a
 * function `when`, which the guard cannot evaluate before the hooks run, the
 * wrapped policy never relaxes that guard on any path.
 *
 * @param when Paths or predicate ({@link ExceptPredicate}) that exempt a request.
 * @param hooks The hook bundle whose `preBody` and `beforeHandle` gates are skipped on a match.
 * @returns A {@link Hooks} bundle whose request gates are controlled by `when`.
 * @throws Error at composition time if a string pattern does not start with `/`.
 * @since 0.19.0
 */
export function except(when: ExceptPredicate, hooks: Hooks): Hooks {
  const earlyRejectionHooks = (hooks as Record<PropertyKey, unknown>)[
    EARLY_REJECTION_HOOK_MARKER
  ];
  const deferredPreBodyHooks = (hooks as Record<PropertyKey, unknown>)[
    DEFERRED_PRE_BODY_HOOK_MARKER
  ];
  if (
    !hooks.preBody &&
    !hooks.beforeHandle &&
    !Array.isArray(earlyRejectionHooks) &&
    !Array.isArray(deferredPreBodyHooks)
  )
    return hooks;
  const matches = compileExceptMatcher(when);
  const wrapped: Hooks = { ...hooks };
  const hadRequiredScopes =
    Array.isArray((wrapped as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER]) ||
    (typeof hooks.beforeHandle === "function" &&
      (hooks.beforeHandle as unknown as Record<PropertyKey, unknown>)[
        CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
      ] === true);
  // Exempted paths must not inherit static required-scope markers before
  // `when` is evaluated; non-exempted requests run the inner scope guard.
  delete (wrapped as Record<PropertyKey, unknown>)[REQUIRE_SCOPES_HOOK_MARKER];
  // The App applies a cors() response decorator ahead of every hook (so early
  // rejections carry CORS headers). Path patterns are checked synchronously
  // here so it still skips the exempted paths; a predicate can be async and
  // read ctx, so with one the decorator is dropped and the wrapped
  // beforeHandle applies CORS as before.
  const decoratorKey = Symbol.for("daloyjs.cors.decorate");
  const decorate = (wrapped as Record<PropertyKey, unknown>)[decoratorKey];
  if (typeof decorate === "function") {
    if (typeof when === "function") {
      delete (wrapped as Record<PropertyKey, unknown>)[decoratorKey];
    } else {
      const exempt = compilePathMatcher(when);
      (wrapped as Record<PropertyKey, unknown>)[decoratorKey] = (request: Request, headers: Headers) => {
        if (!exempt(request.url)) (decorate as (r: Request, h: Headers) => void)(request, headers);
      };
    }
  }
  // The cross-origin write guard runs before any hook and consults the cors()
  // allow predicate directly, so gate it on the same paths: an exempted path
  // must not have its cross-origin writes accepted by a policy that is off
  // there. A function `when` cannot be decided synchronously, so the wrapped
  // policy then never relaxes the guard (fail closed). It is replaced rather
  // than deleted, because a bare CORS_HOOK_MARKER means "allow every origin".
  const allowKey = CORS_ORIGIN_ALLOW_MARKER;
  const allowFn = (wrapped as Record<PropertyKey, unknown>)[allowKey];
  if (typeof allowFn === "function") {
    if (typeof when === "function") {
      (wrapped as Record<PropertyKey, unknown>)[allowKey] = () => false;
    } else {
      const exempt = compilePathMatcher(when);
      (wrapped as Record<PropertyKey, unknown>)[allowKey] = (origin: string, request?: Request) =>
        request !== undefined &&
        !exempt(request.url) &&
        (allowFn as (o: string, r?: Request) => boolean)(origin, request);
    }
  }
  if (Array.isArray(earlyRejectionHooks)) {
    (wrapped as Record<PropertyKey, unknown>)[EARLY_REJECTION_HOOK_MARKER] =
      earlyRejectionHooks.map((hook) => {
        if (typeof hook !== "function") return hook;
        return async (ctx: PreBodyContext<any> | BaseContext<any, any>) =>
          (await matches(ctx)) ? undefined : hook(ctx);
      });
  }
  if (Array.isArray(deferredPreBodyHooks)) {
    (wrapped as Record<PropertyKey, unknown>)[DEFERRED_PRE_BODY_HOOK_MARKER] =
      deferredPreBodyHooks.map((hook) => {
        if (typeof hook !== "function") return hook;
        return async (ctx: PreBodyContext<any>) =>
          (await matches(ctx)) ? undefined : hook(ctx);
      });
  }
  if (hooks.preBody) {
    const original = hooks.preBody;
    const wrappedPreBody: NonNullable<Hooks["preBody"]> = async (ctx) =>
      (await matches(ctx)) ? undefined : original(ctx);
    if (
      (original as unknown as Record<PropertyKey, unknown>)[
        PRE_BODY_HANDLES_OWN_EARLY_REJECTIONS
      ] === true
    ) {
      (wrappedPreBody as unknown as Record<PropertyKey, unknown>)[
        PRE_BODY_HANDLES_OWN_EARLY_REJECTIONS
      ] = true;
    }
    wrapped.preBody = wrappedPreBody;
  }
  if (hooks.beforeHandle) {
    const original = hooks.beforeHandle;
    const wrappedBeforeHandle: NonNullable<Hooks["beforeHandle"]> = async (ctx) =>
      (await matches(ctx)) ? undefined : original(ctx);
    if (hadRequiredScopes) {
      (wrappedBeforeHandle as unknown as Record<PropertyKey, unknown>)[
        CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
      ] = true;
    }
    wrapped.beforeHandle = wrappedBeforeHandle;
  }
  return wrapped;
}

/**
 * Synchronous path test for string patterns, keyed on a request URL. Same
 * semantics as {@link compileExceptMatcher} (trailing slashes ignored).
 */
function compilePathMatcher(when: string | string[]): (url: string) => boolean {
  const patterns = Array.isArray(when) ? when : [when];
  const matchers = patterns.map(compilePathPattern);
  return (url) => {
    const path = trimTrailingSlashes(new URL(url).pathname);
    return matchers.some((m) => m(path));
  };
}

function compileExceptMatcher(
  when: ExceptPredicate,
): (ctx: PreBodyContext<any> | BaseContext<any, any>) => Promise<boolean> {
  if (typeof when === "function") {
    return async (ctx) => Boolean(await when(ctx));
  }
  const patterns = Array.isArray(when) ? when : [when];
  const matchers = patterns.map(compilePathPattern);
  return async (ctx) => {
    // Match the path the router dispatches on: it ignores trailing slashes,
    // so `/docs/` must be judged as `/docs`, never as a child of `/docs/*`.
    const path = trimTrailingSlashes(new URL(ctx.request.url).pathname);
    return matchers.some((m) => m(path));
  };
}

/** Strip trailing `/` the way the router does (`/` itself is kept). */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return end === path.length ? path : path.slice(0, end);
}

function compilePathPattern(pattern: string): (path: string) => boolean {
  if (!pattern.startsWith("/")) {
    throw new Error(
      `except(): path patterns must start with "/" (got ${JSON.stringify(pattern)}).`,
    );
  }
  if (!pattern.includes("*")) {
    const exact = trimTrailingSlashes(pattern);
    return (path) => path === exact;
  }
  const escaped = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === "**") return ".*";
      // `*` is one non-empty segment, so `/docs/*` never matches `/docs`.
      if (part === "*") return "[^/]+";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const regex = new RegExp(`^${escaped}$`);
  return (path) => regex.test(path);
}

/** Registration-time production hook key (see app.ts APP_PRODUCTION_HOOK). */
const APP_PRODUCTION_HOOK = Symbol.for("daloyjs.hooks.appProduction");
/** Registration-time behindProxy receiver (rateLimit / loginThrottle); see app.ts. */
const APP_BEHIND_PROXY_HOOK = Symbol.for("daloyjs.hooks.appBehindProxy");
/** Registration-time body-limit receiver (idempotency); see internal-replay.ts. */
const APP_BODY_LIMIT_HOOK = Symbol.for("daloyjs.hooks.appBodyLimit");
/** Data marker stamped by `clientCertAuth({ header })` (see mtls.ts CLIENT_CERT_HEADER_MODE). */
const CLIENT_CERT_HEADER_MODE = Symbol.for("daloyjs.hooks.clientCertHeaderMode");

/**
 * Registration callbacks the App calls once with its own settings. Every
 * composed bundle's receiver must hear it: keeping only the first would leave
 * a later rateLimit()/loginThrottle() keyed on the proxy (one bucket shared by
 * every client), or a later idempotency() reading past the App body limit.
 */
const CHAINED_REGISTRATION_HOOKS: ReadonlySet<symbol> = new Set([
  APP_PRODUCTION_HOOK,
  APP_BEHIND_PROXY_HOOK,
  APP_BODY_LIMIT_HOOK,
]);

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
  const nonDeferredPreBody = _mergePreBodyWithEarlyRejections(layers, false);
  if (nonDeferredPreBody !== undefined) {
    merged.preBody = nonDeferredPreBody;
  } else {
    const allPreBody = _mergePreBodyWithEarlyRejections(layers, true);
    if (allPreBody !== undefined) {
      merged.preBody = allPreBody;
      (merged as Record<PropertyKey, unknown>)[DEFERRED_PRE_BODY_ONLY_MARKER] = true;
    }
  }
  const beforeHandle = _orderBeforeHandleForReplay(layers);
  if (beforeHandle.length > 0) {
    const run: NonNullable<Hooks["beforeHandle"]> = async (ctx) => {
      for (const fn of beforeHandle) {
        const r = await fn(ctx);
        if (r instanceof Response) return r;
      }
      return undefined;
    };
    const beforeHandleLayers = layers.filter(
      (layer) => typeof layer.beforeHandle === "function",
    );
    if (
      beforeHandleLayers.length > 0 &&
      beforeHandleLayers.every(
        (layer) =>
          (layer.beforeHandle as unknown as Record<PropertyKey, unknown>)[
            PRE_BODY_SAFE_HOOK_MARKER
          ] === true,
      )
    ) {
      (run as unknown as Record<PropertyKey, unknown>)[PRE_BODY_SAFE_HOOK_MARKER] = true;
    }
    if (
      beforeHandleLayers.some(
        (layer) =>
          (layer.beforeHandle as unknown as Record<PropertyKey, unknown>)[
            CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
          ] === true,
      )
    ) {
      (run as unknown as Record<PropertyKey, unknown>)[
        CONDITIONAL_SCOPES_BEFORE_REPLAY_MARKER
      ] = true;
    }
    merged.beforeHandle = run;
    // Snapshot the layers so App registration can order the original gates
    // and replays individually. Keyed on `run`: once a wrapper replaces
    // `merged.beforeHandle`, the snapshot no longer applies (see
    // CombinedBeforeHandleLayers).
    const combined: CombinedBeforeHandleLayers = {
      beforeHandle: run,
      layers: layers.map((layer) => ({ ...layer })),
    };
    (merged as Record<PropertyKey, unknown>)[COMBINED_BEFORE_HANDLE_LAYERS] = combined;
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
    merged.onResponse = async (res, ctx) => {
      for (const fn of onResponse) await fn(res, ctx);
    };
  }
  // Forward symbol-keyed security markers (CORS / CSRF / session /
  // secure-headers) so boot-time and per-request guards still see them
  // on the composed bundle.
  for (const hooks of layers) {
    const record = hooks as Record<PropertyKey, unknown>;
    for (const key of Object.getOwnPropertySymbols(record)) {
      if (key === DEFERRED_PRE_BODY_ONLY_MARKER) continue;
      // An inner bundle's layer snapshot describes that bundle's merged
      // function, never this one's; it is recorded above for this merge.
      if (key === COMBINED_BEFORE_HANDLE_LAYERS) continue;
      if (key === DEFERRED_PRE_BODY_HOOK_MARKER) {
        const existing = (merged as Record<PropertyKey, unknown>)[key];
        const incoming = record[key];
        (merged as Record<PropertyKey, unknown>)[key] = [
          ...(Array.isArray(existing) ? existing : []),
          ...(Array.isArray(incoming) ? incoming : []),
        ];
        continue;
      }
      if (key === EARLY_REJECTION_HOOK_MARKER) {
        const existing = (merged as Record<PropertyKey, unknown>)[key];
        const incoming = record[key];
        (merged as Record<PropertyKey, unknown>)[key] = [
          ...(Array.isArray(existing) ? existing : []),
          ...(Array.isArray(incoming) ? incoming : []),
        ];
        continue;
      }
      if (key === REQUIRE_SCOPES_HOOK_MARKER) {
        // Union every bundle's all-of scopes: replay middleware reads this
        // marker, and keeping only the first bundle's list would let a
        // stored response replay to a caller missing a later bundle's scope.
        const existing = (merged as Record<PropertyKey, unknown>)[key];
        const incoming = record[key];
        const union = Array.isArray(existing) ? [...(existing as string[])] : [];
        if (Array.isArray(incoming)) {
          for (const scope of incoming) {
            if (typeof scope === "string" && !union.includes(scope)) union.push(scope);
          }
        }
        (merged as Record<PropertyKey, unknown>)[key] = union;
        continue;
      }
      if (key === CLIENT_CERT_HEADER_MODE) {
        // Union the certificate-identity header names of every composed
        // clientCertAuth({ header }) bundle: the App's boot guard and
        // per-request spoofable-header refusal must cover each configured
        // name, not just the first bundle's.
        const existing = (merged as Record<PropertyKey, unknown>)[key] as
          | { headerNames: readonly string[] }
          | undefined;
        const incoming = record[key] as { headerNames?: readonly string[] } | undefined;
        const names = existing ? [...existing.headerNames] : [];
        if (Array.isArray(incoming?.headerNames)) {
          for (const name of incoming.headerNames) {
            if (typeof name === "string" && !names.includes(name)) names.push(name);
          }
        }
        (merged as Record<PropertyKey, unknown>)[key] = { headerNames: names };
        continue;
      }
      if (CHAINED_REGISTRATION_HOOKS.has(key)) {
        // Several bundles can each receive the same App setting at
        // registration (jwk() and session() refuse production-only
        // misconfigurations; rateLimit() and loginThrottle() learn the
        // behindProxy posture); call all of them, not the first.
        const existing = (merged as Record<PropertyKey, unknown>)[key];
        const incoming = record[key];
        (merged as Record<PropertyKey, unknown>)[key] =
          typeof existing === "function" && typeof incoming === "function"
            ? (...args: unknown[]) => {
              (existing as (...a: unknown[]) => void)(...args);
              (incoming as (...a: unknown[]) => void)(...args);
            }
            : typeof incoming === "function"
              ? incoming
              : existing;
        continue;
      }
      if (!(key in (merged as Record<PropertyKey, unknown>))) {
        (merged as Record<PropertyKey, unknown>)[key] = record[key];
      }
    }
  }
  return merged;
}
