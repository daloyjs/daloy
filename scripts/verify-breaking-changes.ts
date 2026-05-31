/**
 * Breaking-change governance gate.
 *
 * Compares the freshly generated OpenAPI document (`generated/openapi.json`)
 * against a committed baseline (`generated/openapi.baseline.json`, the last
 * published contract) and fails CI when the current spec introduces a
 * **breaking** change — a removed path/operation/response, a newly required
 * parameter, a tightened parameter requirement, or a newly required request
 * body. Additive (non-breaking) changes are reported but do not fail.
 *
 * For a single-source-of-truth framework this answers the one question that
 * a contract-first workflow should make trivial: *"did this change break my
 * published API?"* The same engine ({@link diffOpenAPI}) powers the public
 * `daloy diff` CLI command so application teams can run the identical gate.
 *
 * When no baseline file exists yet, the gate is a no-op (exit 0) so a fresh
 * repository can adopt it incrementally: commit `generated/openapi.json` as
 * `generated/openapi.baseline.json` once you publish, and the gate starts
 * guarding subsequent changes.
 *
 * Exit code:
 *   0 — no baseline, or no breaking changes detected.
 *   1 — at least one breaking change detected (printed to stderr).
 *
 * @since 0.37.0
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { diffOpenAPI, type OpenAPIChange } from "../src/openapi-diff.js";

export interface BreakingChangeCheck {
  /** Whether the current spec is compatible with the baseline. */
  readonly ok: boolean;
  /** Human-readable lines describing every detected change. */
  readonly issues: readonly string[];
  /** Whether a baseline file was found and compared. */
  readonly compared: boolean;
}

const DEFAULT_BASELINE = "./generated/openapi.baseline.json";
const DEFAULT_CURRENT = "./generated/openapi.json";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function render(change: OpenAPIChange): string {
  return `[${change.kind}] ${change.location}: ${change.detail}`;
}

/**
 * Run the breaking-change comparison between a baseline and current OpenAPI
 * document on disk.
 *
 * @param baselinePath - Path to the last-published OpenAPI JSON document.
 * @param currentPath - Path to the freshly generated OpenAPI JSON document.
 * @returns The check result with `ok`, `issues`, and whether a comparison ran.
 */
export async function verifyBreakingChanges(
  baselinePath: string = DEFAULT_BASELINE,
  currentPath: string = DEFAULT_CURRENT
): Promise<BreakingChangeCheck> {
  const baselineAbs = resolve(process.cwd(), baselinePath);
  const currentAbs = resolve(process.cwd(), currentPath);

  if (!(await fileExists(baselineAbs))) {
    return {
      ok: true,
      compared: false,
      issues: [
        `No baseline found at ${baselinePath}; skipping breaking-change gate. ` +
          `Commit the published spec as the baseline to start guarding the API.`,
      ],
    };
  }
  if (!(await fileExists(currentAbs))) {
    return {
      ok: false,
      compared: false,
      issues: [`Current spec not found at ${currentPath}; run \`pnpm gen\` first.`],
    };
  }

  const baseline = JSON.parse(await readFile(baselineAbs, "utf8"));
  const current = JSON.parse(await readFile(currentAbs, "utf8"));
  const result = diffOpenAPI(baseline, current);

  const issues = [
    ...result.breaking.map((c) => `BREAKING ${render(c)}`),
    ...result.nonBreaking.map((c) => `ok       ${render(c)}`),
  ];

  return { ok: result.breaking.length === 0, compared: true, issues };
}

async function main(): Promise<void> {
  const check = await verifyBreakingChanges();
  for (const issue of check.issues) {
    (check.ok ? process.stdout : process.stderr).write(`${issue}\n`);
  }
  if (!check.ok) {
    process.stderr.write("verify:breaking-changes FAILED — published API contract broken.\n");
    process.exit(1);
  }
  process.stdout.write(
    check.compared
      ? "verify:breaking-changes OK — no breaking changes.\n"
      : "verify:breaking-changes OK — no baseline to compare.\n"
  );
  process.exit(0);
}

// Run only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
