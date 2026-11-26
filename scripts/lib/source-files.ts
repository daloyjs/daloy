/**
 * Which files under a source root the source-scanning CI gates read.
 *
 * Each gate used to carry its own `/\\.(?:m?ts|m?js)$/` filter, which skipped
 * `.cts`, `.cjs`, `.tsx` and `.jsx`. `tsconfig.json` includes `src/**\/*`, so
 * `tsc` compiles a `src/evil.cts` into `dist/evil.cjs` and it ships, while no
 * gate ever opened it. One shared predicate keeps the gates and the compiler
 * in step.
 */

/** Every JavaScript / TypeScript source extension the compiler accepts. */
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

/**
 * Whether a gate must scan this file.
 *
 * @param name - File name or path.
 * @returns `true` for `.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`, `.cjs`
 *   and `.jsx` (declaration files included).
 */
export function isSourceFile(name: string): boolean {
  return SOURCE_FILE_RE.test(name);
}
