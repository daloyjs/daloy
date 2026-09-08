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
