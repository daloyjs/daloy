/**
 * Check the scope requirements aggregated by App before a stored-response hook.
 *
 * @param context - Current request state, including requirements installed by
 *   App.mergeBeforeHandle and the user resolved by upstream authentication.
 * @returns True when no scope guard applies or the current user owns every
 *   required scope. False tells replay middleware to defer to the normal hook
 *   chain without reading, reserving, or capturing a stored response. The
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
