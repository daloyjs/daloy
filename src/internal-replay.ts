/**
 * Check the scope requirements aggregated by App before a stored-response hook.
 *
 * @param context - Current request state, including requirements installed by
 *   App.mergeBeforeHandle and the user resolved by upstream authentication.
 * @returns True when no scope guard applies or the current user owns every
 *   required scope in an own `scopes` array; inherited scopes grant nothing,
 *   matching `requireScopes()`. False tells replay middleware to defer to the
 *   normal hook chain without reading, reserving, or capturing a stored response. The
 *   downstream requireScopes hook remains responsible for rejecting access.
 * @internal
 */
export function hasReplayScopes(context: {
  readonly state: Readonly<Record<string, unknown>>;
}): boolean {
  const required = context.state.__daloyRequiredScopes;
  if (!Array.isArray(required) || required.length === 0) return true;
  const user = context.state.user;
  if (!user || typeof user !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(user, "scopes")) return false;
  const owned = (user as { scopes?: unknown }).scopes;
  return (
    Array.isArray(owned) && required.every((scope) => owned.includes(scope))
  );
}

/**
 * `ctx.state` symbol under which a framework auth hook records a caller
 * identity that is NOT carried in `Authorization` / `Cookie` (a client
 * certificate from `clientCertAuth()`, an HTTP-signature key from
 * `httpSignatureAuth()`). Stored-response middleware reads it so a caller that
 * authenticated by such a channel is never served another caller's stored
 * response: `responseCache()` bypasses, `idempotency()` folds it into its
 * default scope. Registered globally so the modules need not import each other.
 * @internal
 */
export const AUTH_IDENTITY_MARKER: unique symbol = Symbol.for("daloyjs.auth.identity");

/**
 * Record a resolved non-header caller identity on `ctx.state`. A second
 * identity (for example mTLS plus an HTTP signature) is appended, so the
 * combined value is at least as specific as either.
 *
 * @param state - The request's `ctx.state`.
 * @param identity - Stable, source-prefixed identity (e.g. `mtls:<sha256>`).
 * @internal
 */
export function markAuthIdentity(state: Record<PropertyKey, unknown>, identity: string): void {
  const existing = state[AUTH_IDENTITY_MARKER];
  state[AUTH_IDENTITY_MARKER] =
    typeof existing === "string" && existing !== identity ? `${existing}\n${identity}` : identity;
}

/**
 * Read the identity recorded by {@link markAuthIdentity}.
 *
 * @param state - The request's `ctx.state`.
 * @returns The identity string, or `undefined` when no such hook ran.
 * @internal
 */
export function getAuthIdentity(state: Readonly<Record<PropertyKey, unknown>>): string | undefined {
  const value = state[AUTH_IDENTITY_MARKER];
  return typeof value === "string" ? value : undefined;
}

/**
 * Optional method an `App` may call on a registered hooks object to tell it
 * the app's resolved `bodyLimitBytes`, which hooks cannot otherwise read from
 * the request context. `idempotency()` uses it to lower its raw-body
 * fingerprint cap to the app limit; receivers only ever tighten a cap.
 * @internal
 */
export const APP_BODY_LIMIT_HOOK: unique symbol = Symbol.for("daloyjs.hooks.appBodyLimit");

/**
 * Symbol under which dispatch records a route's own `bodyLimitBytes` on the
 * `Request` when it differs from the app value (mirror of
 * `DALOY_REQUEST_BODY_LIMIT` in app.ts, via the global registry to avoid an
 * import cycle). Raw-body readers use it to bound their read by the limit the
 * framework applies to that route.
 * @internal
 */
export const REQUEST_BODY_LIMIT: unique symbol = Symbol.for("daloyjs.request.bodyLimit");

/**
 * Effective raw-body read cap for the current request: `maxBytes`, tightened
 * to the app limit (`appCappedMax`) unless the matched route set its own
 * `bodyLimitBytes`, in which case the route's limit bounds the read instead.
 *
 * @param request - The request being fingerprinted.
 * @param maxBytes - The middleware's own configured cap.
 * @param appCappedMax - `maxBytes` already lowered to the app limit.
 * @returns The number of bytes the reader may consume.
 * @internal
 */
export function effectiveBodyReadCap(
  request: Request,
  maxBytes: number,
  appCappedMax: number,
): number {
  const routeLimit = (request as unknown as Record<symbol, unknown>)[REQUEST_BODY_LIMIT];
  if (typeof routeLimit === "number" && Number.isSafeInteger(routeLimit) && routeLimit >= 0) {
    return Math.min(maxBytes, routeLimit);
  }
  return appCappedMax;
}
