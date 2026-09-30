/**
 * Regenerate `lib/api-types.snapshot.json`, the snapshot `<AutoTypeTable>`
 * renders from.
 *
 * Why a snapshot: the Vercel build only has the `website/` directory, not the
 * framework source in `../src`, so the table cannot read TypeScript at build
 * time. This script (run from a full checkout) finds every
 * `<AutoTypeTable path="…" name="…" />` in `app/` and `content/`, extracts
 * the declarations from `../src`, and writes the JSON. The
 * `tests/lib/api-types.test.ts` drift check fails when the snapshot no longer
 * matches the source, so a TSDoc change cannot silently go stale.
 *
 * Usage (from `website/`): `pnpm gen:api-types`
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ApiProperty } from "../lib/api-types";
import { readApiProperties } from "../lib/api-types-extract";

/** Where the snapshot lives, relative to the website root. */
export const SNAPSHOT_FILE = path.join("lib", "api-types.snapshot.json");

const USAGE = /<AutoTypeTable\s+path="([^"]+)"\s+name="([^"]+)"\s*\/>/g;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => walk(path.join(dir, entry.name))),
  );
  return [
    ...entries.filter((entry) => entry.isFile() && /\.(tsx|mdx)$/.test(entry.name)).map((entry) => path.join(dir, entry.name)),
    ...nested.flat(),
  ];
}

/**
 * Find every `<AutoTypeTable>` usage in the site.
 *
 * @returns Sorted, de-duplicated `{ path, name }` pairs.
 */
export async function findAutoTypeTableUsages(): Promise<Array<{ path: string; name: string }>> {
  const files = [...(await walk("app")), ...(await walk("content"))];
  const found = new Map<string, { path: string; name: string }>();
  for (const file of files) {
    for (const match of (await readFile(file, "utf8")).matchAll(USAGE)) {
      found.set(`${match[1]}#${match[2]}`, { path: match[1]!, name: match[2]! });
    }
  }
  return [...found.values()].sort((a, b) => `${a.path}#${a.name}`.localeCompare(`${b.path}#${b.name}`));
}

/**
 * Build the snapshot object from the current framework source.
 *
 * @returns `"src/file.ts#Name"` → properties, in sorted key order.
 */
export async function buildApiTypesSnapshot(): Promise<Record<string, ApiProperty[]>> {
  const snapshot: Record<string, ApiProperty[]> = {};
  for (const usage of await findAutoTypeTableUsages()) {
    snapshot[`${usage.path}#${usage.name}`] = await readApiProperties(usage.path, usage.name);
  }
  return snapshot;
}

/** Serialize exactly as committed (stable key order, trailing newline). */
export function serializeSnapshot(snapshot: Record<string, ApiProperty[]>): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = await buildApiTypesSnapshot();
  await writeFile(SNAPSHOT_FILE, serializeSnapshot(snapshot));
  console.log(`wrote ${SNAPSHOT_FILE} (${Object.keys(snapshot).length} declarations)`);
}
