/**
 * Runtime-portable, permission-safe read of `NODE_ENV`.
 *
 * Node, Bun and Workers expose `process.env` directly. Deno exposes it through
 * a proxy that throws `NotCapable` when `NODE_ENV` is not in the `--allow-env`
 * allowlist, which used to crash `new App({ env })` at construction. Every
 * core read of `NODE_ENV` goes through here so an unreadable value is treated
 * exactly like an unset one.
 *
 * @internal
 */

/**
 * Read `process.env.NODE_ENV` without ever throwing.
 *
 * @returns The value, or `undefined` when there is no `process`, no `env`,
 *   the variable is unset, or the runtime refuses access to it.
 * @internal
 */
export function readNodeEnv(): string | undefined {
  try {
    return typeof process === "object" ? process.env?.NODE_ENV : undefined;
  } catch {
    return undefined;
  }
}
