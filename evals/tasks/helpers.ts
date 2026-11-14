/**
 * Edit helpers for task setup and solution steps. Every helper throws when
 * its anchor is missing or ambiguous, so a template change that breaks a task
 * shows up as a calibration failure instead of a silently wrong scenario.
 *
 * @module
 */

import type { WorkspaceHandle } from "../lib/types.ts";

/** The `buildApp()` file in every Node-flavoured template. */
export const BUILD_APP = "src/build-app.ts";

/**
 * Replace exactly one occurrence of `search` in `file`.
 *
 * @param ws - Workspace.
 * @param file - Relative path.
 * @param search - Exact text to find; must occur exactly once.
 * @param replacement - Replacement text.
 * @throws Error when `search` occurs zero or several times.
 */
export async function replaceOnce(
  ws: WorkspaceHandle,
  file: string,
  search: string,
  replacement: string,
): Promise<void> {
  const text = await ws.read(file);
  const first = text.indexOf(search);
  if (first === -1 || text.indexOf(search, first + 1) !== -1) {
    throw new Error(
      `anchor must occur exactly once in ${file}: ${JSON.stringify(search.slice(0, 80))}`,
    );
  }
  await ws.write(
    file,
    text.slice(0, first) + replacement + text.slice(first + search.length),
  );
}

/**
 * Insert route code just before `return app;` in `buildApp()`.
 *
 * @param ws - Workspace.
 * @param code - Code to insert (indented for the function body).
 */
export async function addBeforeReturn(
  ws: WorkspaceHandle,
  code: string,
): Promise<void> {
  await replaceOnce(
    ws,
    BUILD_APP,
    "  return app;\n}",
    `${code.trimEnd()}\n\n  return app;\n}`,
  );
}

/**
 * Add named imports to the existing `@daloyjs/core` import in `buildApp()`.
 *
 * @param ws - Workspace.
 * @param names - Export names to add (duplicates are skipped).
 * @throws Error when the file has no single-line `@daloyjs/core` import.
 */
export async function addCoreImports(
  ws: WorkspaceHandle,
  names: readonly string[],
): Promise<void> {
  const text = await ws.read(BUILD_APP);
  const re = /import \{([^}]*)\} from "@daloyjs\/core";/;
  const m = re.exec(text);
  if (!m) throw new Error(`no @daloyjs/core import in ${BUILD_APP}`);
  const existing = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...existing, ...names])].sort((a, b) =>
    a.localeCompare(b),
  );
  await ws.write(
    BUILD_APP,
    text.replace(re, `import { ${merged.join(", ")} } from "@daloyjs/core";`),
  );
}
