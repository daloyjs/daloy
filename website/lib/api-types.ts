import snapshot from "./api-types.snapshot.json";

/** One documented property of an exported interface or object type. */
export type ApiProperty = {
  name: string;
  /** Type annotation as written in the source, whitespace-collapsed. */
  type: string;
  required: boolean;
  /** TSDoc summary with `{@link X}` resolved to `X`; may contain backtick code spans. */
  description: string;
  /** `@default` tag value, when present. */
  default?: string;
  /** `@deprecated` tag text, when present (empty string for a bare tag). */
  deprecated?: string;
  /** `@since` tag value, when present. */
  since?: string;
};

/**
 * Documented members of an exported interface (or object type alias), for
 * `<AutoTypeTable>`, read from the committed snapshot
 * `lib/api-types.snapshot.json`.
 *
 * The site build (Vercel) only sees `website/`, not the framework source, so
 * the snapshot is generated from `../src` by `pnpm gen:api-types` and kept
 * honest by the drift test in `tests/lib/api-types.test.ts`.
 *
 * @param file - Repo-relative path, e.g. `src/middleware.ts`.
 * @param name - The interface or type alias name, e.g. `RateLimitOptions`.
 * @returns The properties in declaration order.
 * @throws {Error} When the declaration is not in the snapshot (run `pnpm gen:api-types`).
 */
export function getApiProperties(file: string, name: string): ApiProperty[] {
  const properties = (snapshot as Record<string, ApiProperty[]>)[`${file}#${name}`];
  if (!properties) {
    throw new Error(`AutoTypeTable: ${file}#${name} is not in lib/api-types.snapshot.json. Run \`pnpm gen:api-types\` in website/.`);
  }
  return properties;
}
