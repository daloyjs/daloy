/**
 * Zero-runtime-dependency batteries-included parity & governance audit.
 *
 * Converts the cross-cutting governance items into a standing CI gate so the
 * framework cannot quietly drop a previously-shipped default. Each numbered
 * audit below is a check, not a one-time change.
 *
 * Audits covered here:
 *   1. Recurring security-disclosure exercise - the rotation file
 *      `SECURITY-CONTACTS.md` exists, is parseable, declares at least one
 *      active contact, and the `<!-- last-exercise: YYYY-MM-DD -->` marker
 *      is younger than 180 days (warn at 90, fail at 180).
 *   2. Zero-runtime-dependency posture - reaffirms the empty `dependencies`
 *      block in `@daloyjs/core/package.json` (delegates to
 *      `verify-no-runtime-deps.ts`; also reaffirmed by the parity-audits
 *      runtime-deps gate).
 *   3. Transitive-dep audit - root `package.json` MUST NOT declare any
 *      production `dependencies`; the transitive runtime closure is
 *      therefore trivially zero. A non-empty block requires an explicit
 *      `SECURITY.md` waiver naming every transitive dep.
 *   4. Plugin-prerequisite enforcement - `src/app.ts` MUST still contain a
 *      missing-dependency refuse-to-boot path on the plugin registration
 *      flow.
 *   5. Extension-order determinism - `src/app.ts` MUST still expose a
 *      `topoSortExtensions` deterministic-ordering pass that throws on
 *      cycles, so a new plugin can never silently reorder the security
 *      stack.
 *   6. Governance floor - every workflow file under `.github/workflows/`
 *      sets a top-level `permissions: {}`, every `actions/checkout` uses
 *      `persist-credentials: false`, every third-party action is pinned to
 *      a 40-hex commit SHA, every job runs `step-security/harden-runner`,
 *      and `.github/CODEOWNERS` exists. Removal of any one of these
 *      requires a documented `SECURITY.md` waiver.
 *
 * Exit code:
 *   0 - every audit passed.
 *   1 - at least one audit failed; offending findings are printed to
 *       stderr.
 *
 * @since 0.29.0
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findForbiddenRuntimeDependencies } from "./verify-no-runtime-deps.js";

export interface Finding {
  readonly level?: "error" | "warn";
  readonly audit: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly message: string;
}

const REPO_ROOT = pathToFileURL(`${process.cwd()}/`);
const SRC_ROOT = new URL("src/", REPO_ROOT);
const WORKFLOWS_ROOT = new URL(".github/workflows/", REPO_ROOT);
const PACKAGE_JSON = new URL("package.json", REPO_ROOT);
const SECURITY_CONTACTS = new URL("SECURITY-CONTACTS.md", REPO_ROOT);
const CODEOWNERS = new URL(".github/CODEOWNERS", REPO_ROOT);

/** Warn threshold for the quarterly disclosure exercise (days). */
const EXERCISE_WARN_DAYS = 90;
/** Fail threshold for the quarterly disclosure exercise (days). */
const EXERCISE_FAIL_DAYS = 180;

interface ParsedContacts {
  readonly active: readonly string[];
  readonly lastExercise: Date | null;
}

function parseUtcDate(y: number, mo: number, d: number): Date | null {
  const ts = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts);
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * Parse `SECURITY-CONTACTS.md`. The format is intentionally restricted to a
 * small machine-readable subset: contacts in the `<!-- BEGIN ACTIVE --> ...
 * <!-- END ACTIVE -->` block, one bullet per contact starting with
 * `- handle: <name>`, and a `<!-- last-exercise: YYYY-MM-DD -->` marker
 * anywhere in the file.
 */
export function parseSecurityContacts(text: string): ParsedContacts {
  const activeBlockMatch = text.match(
    /<!--\s*BEGIN ACTIVE\s*-->([\s\S]*?)<!--\s*END ACTIVE\s*-->/,
  );
  const active: string[] = [];
  if (activeBlockMatch && activeBlockMatch[1]) {
    const handleRe = /^\s*-\s*handle:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = handleRe.exec(activeBlockMatch[1])) !== null) {
      active.push(m[1]!);
    }
  }
  let lastExercise: Date | null = null;
  const dateMatch = text.match(
    /<!--\s*last-exercise:\s*(\d{4})-(\d{2})-(\d{2})\s*-->/,
  );
  if (dateMatch) {
    const y = Number(dateMatch[1]);
    const mo = Number(dateMatch[2]);
    const d = Number(dateMatch[3]);
    lastExercise = parseUtcDate(y, mo, d);
  }
  return { active, lastExercise };
}

/**
 * Days elapsed between two UTC dates, rounded down. Pulled out for testing.
 */
export function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Evaluate the machine-readable SECURITY-CONTACTS.md body. Kept pure so the
 * date-boundary behavior is easy to test without mutating the live tree.
 */
export function auditSecurityContactsText(
  text: string,
  now: Date = new Date(),
): readonly Finding[] {
  const out: Finding[] = [];
  const parsed = parseSecurityContacts(text);
  if (parsed.active.length === 0) {
    out.push({
      audit: "1. security-contacts",
      file: "SECURITY-CONTACTS.md",
      line: 0,
      text: "<!-- BEGIN ACTIVE --> ... <!-- END ACTIVE -->",
      message:
        "SECURITY-CONTACTS.md must declare at least one `- handle: <name>` " +
        "bullet inside the ACTIVE block.",
    });
  }
  if (parsed.lastExercise === null) {
    out.push({
      audit: "1. security-contacts",
      file: "SECURITY-CONTACTS.md",
      line: 0,
      text: "<!-- last-exercise: YYYY-MM-DD -->",
      message:
        "SECURITY-CONTACTS.md must carry a valid `<!-- last-exercise: " +
        "YYYY-MM-DD -->` marker recording the most recent disclosure exercise.",
    });
  } else {
    const age = daysBetween(now, parsed.lastExercise);
    if (age < 0) {
      out.push({
        audit: "1. security-contacts",
        file: "SECURITY-CONTACTS.md",
        line: 0,
        text: `last-exercise=${parsed.lastExercise.toISOString().slice(0, 10)} (${age}d old)`,
        message:
          "Disclosure exercise date is in the future. Record the actual " +
          "exercise date before publishing.",
      });
    } else if (age > EXERCISE_FAIL_DAYS) {
      out.push({
        audit: "1. security-contacts",
        file: "SECURITY-CONTACTS.md",
        line: 0,
        text: `last-exercise=${parsed.lastExercise.toISOString().slice(0, 10)} (${age}d old)`,
        message:
          `Disclosure exercise is ${age} days old; the fail ` +
          `threshold is ${EXERCISE_FAIL_DAYS} days. Run a fresh ` +
          "simulated exercise, and bump " +
          "the `<!-- last-exercise: -->` marker.",
      });
    } else if (age > EXERCISE_WARN_DAYS) {
      out.push({
        level: "warn",
        audit: "1. security-contacts",
        file: "SECURITY-CONTACTS.md",
        line: 0,
        text: `last-exercise=${parsed.lastExercise.toISOString().slice(0, 10)} (${age}d old)`,
        message:
          `Disclosure exercise is ${age} days old; the warning ` +
          `threshold is ${EXERCISE_WARN_DAYS} days. Schedule the next ` +
          "quarterly simulation before the hard 180-day gate.",
      });
    }
  }
  return out;
}

/**
 * Item 1: recurring security-disclosure exercise rotation file.
 */
export async function auditSecurityContacts(
  now: Date = new Date(),
): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  let text: string;
  try {
    text = await readFile(SECURITY_CONTACTS, "utf8");
  } catch {
    out.push({
      audit: "1. security-contacts",
      file: "SECURITY-CONTACTS.md",
      line: 0,
      text: "(missing)",
      message:
        "A `SECURITY-CONTACTS.md` rotation file is required at the " +
        "repository root. Create it before the next publish.",
    });
    return out;
  }
  out.push(...auditSecurityContactsText(text, now));
  return out;
}

/**
 * Item 2 + 3: zero-runtime-dependency posture + transitive closure.
 */
export async function auditRuntimeDeps(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readFile(PACKAGE_JSON, "utf8");
  const pkg = JSON.parse(text) as {
    dependencies?: Record<string, unknown>;
  };
  const offending = findForbiddenRuntimeDependencies(pkg);
  for (const name of offending) {
    out.push({
      audit: "2/3. runtime-deps",
      file: "package.json",
      line: 0,
      text: name,
      message:
        "@daloyjs/core ships zero runtime dependencies. Any addition " +
        "requires a SECURITY.md waiver naming every transitive runtime dep " +
        "(transitive-closure rule).",
    });
  }
  return out;
}

async function readSrcText(rel: string): Promise<string> {
  return readFile(new URL(rel, SRC_ROOT), "utf8");
}

/**
 * Item 4: plugin-prerequisite enforcement still wired in `src/app.ts`.
 *
 * Looks for the `installedPlugins` membership check paired with a throw on
 * the plugin-dependency miss path. The check is intentionally string-based
 * so a contributor cannot remove the guard without tripping this audit.
 */
export async function auditPluginPrerequisite(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  let src: string;
  try {
    src = await readSrcText("app.ts");
  } catch {
    out.push({
      audit: "4. plugin-prerequisite",
      file: "src/app.ts",
      line: 0,
      text: "(unreadable)",
      message: "src/app.ts must exist and be readable.",
    });
    return out;
  }
  // Look for the negated-membership pattern paired with a throw, e.g.
  //   if (!this.installedPlugins.has(dep)) { throw new Error(...); }
  // The audit accepts any whitespace / formatting between the guard and
  // the throw so a future refactor that keeps the semantics passes.
  const guardThrowRe =
    /!\s*this\s*\.\s*installedPlugins\s*\.\s*has\s*\([^)]*\)\s*\)\s*\{[\s\S]{0,400}?throw\s+new\s+\w*Error\s*\(/;
  if (!guardThrowRe.test(src)) {
    out.push({
      audit: "4. plugin-prerequisite",
      file: "src/app.ts",
      line: 0,
      text: "if (!installedPlugins.has(dep)) throw ...",
      message:
        "src/app.ts must still refuse-to-boot when a plugin declares a " +
        "missing dependency: a negated `this.installedPlugins.has(dep)` " +
        "guard paired with a `throw new Error(...)` is required " +
        "(plugin-prerequisite contract).",
    });
  }
  return out;
}

/**
 * Item 5: extension-order determinism. Confirms `topoSortExtensions`
 * (deterministic ordering pass) still exists and throws on cycles.
 */
export async function auditExtensionOrderDeterminism(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  let src: string;
  try {
    src = await readSrcText("app.ts");
  } catch {
    return out;
  }
  if (!/\btopoSortExtensions\b/.test(src)) {
    out.push({
      audit: "5. extension-order",
      file: "src/app.ts",
      line: 0,
      text: "topoSortExtensions",
      message:
        "src/app.ts must expose a `topoSortExtensions` pass so the order " +
        "in which security middleware executes is deterministic " +
        "regardless of plugin-registration order.",
    });
    return out;
  }
  // Must throw on cycles - look for any throw statement inside the
  // topoSortExtensions function. Find the function DEFINITION (not a call
  // site) and then scan a window large enough to cover the function body.
  const defRe = /(?:export\s+)?function\s+topoSortExtensions\s*\(/;
  const defMatch = defRe.exec(src);
  if (defMatch) {
    const idx = defMatch.index;
    const window = src.slice(idx, idx + 4000);
    if (!/throw\s+new\s+\w*Error\s*\(/.test(window)) {
      out.push({
        audit: "5. extension-order",
        file: "src/app.ts",
        line: 0,
        text: "topoSortExtensions cycle detection",
        message:
          "`topoSortExtensions` must throw on cycles so a circular " +
          "before/after relationship is caught at boot, not silently " +
          "reorders the security stack at runtime.",
      });
    }
  }
  return out;
}

interface WorkflowFile {
  readonly rel: string;
  readonly text: string;
}

/**
 * Audit one workflow file's governance floor from an in-memory string.
 *
 * @param file - Display path used in findings.
 * @param text - Workflow YAML source to inspect.
 * @returns Findings for missing top-level permissions, missing harden-runner,
 * unpinned third-party actions, or checkout credentials left on disk.
 */
export function auditWorkflowGovernanceText(
  file: string,
  text: string,
): readonly Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r?\n/);
  // Top-level `permissions:` declaration must exist (an empty `{}` or a
  // narrow per-scope opt-in are both acceptable; the failure mode is a
  // workflow with NO top-level permissions block, which inherits the
  // GITHUB_TOKEN's broad default).
  const hasTopLevelPerms = lines.some((l) =>
    /^permissions\s*:/.test(l),
  );
  if (!hasTopLevelPerms) {
    out.push({
      audit: "6. governance-floor",
      file,
      line: 0,
      text: "permissions:",
      message:
        "Workflow must declare a top-level `permissions:` block " +
        "(typically `permissions: {}`) so jobs opt in to the minimum " +
        "tokens they need.",
    });
  }
  // Collect third-party `uses:` references for the SHA-pin and
  // harden-runner checks below.
  const usesRe = /^\s*-?\s*uses\s*:\s*([^\s@#]+)@([^\s#]+)/;
  let thirdPartyUses = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = usesRe.exec(lines[i]!);
    if (!m) continue;
    const target = m[1]!;
    const ref = m[2]!;
    if (target.startsWith("./") || target.startsWith("../")) continue;
    thirdPartyUses++;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      out.push({
        audit: "6. governance-floor",
        file,
        line: i + 1,
        text: `${target}@${ref}`,
        message:
          "Third-party actions must be pinned to a 40-hex commit SHA " +
          "(managed by Dependabot). Tags and floating refs are " +
          "forbidden by the governance floor.",
      });
    }
  }
  if (thirdPartyUses > 0 && !/step-security\/harden-runner@/.test(text)) {
    out.push({
      audit: "6. governance-floor",
      file,
      line: 0,
      text: "step-security/harden-runner",
      message:
        "Workflow uses third-party actions and must therefore call " +
        "`step-security/harden-runner` so unexpected egress is detected " +
        "and runner tampering is reported.",
    });
  }
  // Every `actions/checkout` must be paired with `persist-credentials:
  // false`. Walk lines and look for any checkout call without the flag
  // in the following ~12 lines (the `with:` block).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\bactions\/checkout@/.test(line)) continue;
    const window = lines.slice(i, Math.min(i + 12, lines.length)).join("\n");
    if (!/persist-credentials\s*:\s*false/.test(window)) {
      out.push({
        audit: "6. governance-floor",
        file,
        line: i + 1,
        text: line.trim(),
        message:
          "Every `actions/checkout` invocation must set " +
          "`persist-credentials: false` so the workflow's GITHUB_TOKEN " +
          "is not left on disk.",
      });
    }
  }
  return out;
}

async function listWorkflowFiles(): Promise<readonly WorkflowFile[]> {
  let entries;
  try {
    entries = await readdir(WORKFLOWS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkflowFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    const text = await readFile(new URL(entry.name, WORKFLOWS_ROOT), "utf8");
    out.push({ rel: `.github/workflows/${entry.name}`, text });
  }
  return out;
}

/**
 * Item 6: governance floor. Each workflow file must:
 *   - declare top-level `permissions: {}` (least privilege)
 *   - call `step-security/harden-runner` at least once
 *   - use `persist-credentials: false` on every `actions/checkout`
 *   - pin every third-party `uses:` reference to a 40-hex commit SHA
 *
 * `.github/CODEOWNERS` must exist.
 */
export async function auditGovernanceFloor(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const workflows = await listWorkflowFiles();
  if (workflows.length === 0) {
    out.push({
      audit: "6. governance-floor",
      file: ".github/workflows/",
      line: 0,
      text: "(empty)",
      message:
        "No workflow files found under `.github/workflows/`. The audit " +
        "requires at least one workflow file with the documented governance " +
        "floor in place.",
    });
    return out;
  }
  for (const wf of workflows) {
    out.push(...auditWorkflowGovernanceText(wf.rel, wf.text));
  }
  // CODEOWNERS exists.
  try {
    await readFile(CODEOWNERS, "utf8");
  } catch {
    out.push({
      audit: "6. governance-floor",
      file: ".github/CODEOWNERS",
      line: 0,
      text: "(missing)",
      message:
        "`.github/CODEOWNERS` must exist and protect privileged files " +
        "(workflows, SECURITY.md, SECURITY-CONTACTS.md, package.json).",
    });
  }
  return out;
}

/**
 * Top-level orchestrator. Runs every audit, reports findings to stderr,
 * exits non-zero on any finding.
 */
export async function runGovernanceAudits(
  now: Date = new Date(),
): Promise<readonly Finding[]> {
  const all: Finding[] = [];
  all.push(...(await auditSecurityContacts(now)));
  all.push(...(await auditRuntimeDeps()));
  all.push(...(await auditPluginPrerequisite()));
  all.push(...(await auditExtensionOrderDeterminism()));
  all.push(...(await auditGovernanceFloor()));
  return all;
}

async function main(): Promise<void> {
  const findings = await runGovernanceAudits();
  const warnings = findings.filter((f) => f.level === "warn");
  const errors = findings.filter((f) => f.level !== "warn");
  for (const f of warnings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.warn(`[warn][${f.audit}] ${where}: ${f.text}`);
    console.warn(`    ${f.message}`);
  }
  if (errors.length === 0) {
    console.log(
      warnings.length === 0
        ? "verify-governance-audits: all static gates passed (items 1, 2/3, 4, 5, 6)."
        : `verify-governance-audits: all static gates passed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (items 1, 2/3, 4, 5, 6).`,
    );
    return;
  }
  for (const f of errors) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`[${f.audit}] ${where}: ${f.text}`);
    console.error(`    ${f.message}`);
  }
  console.error(
    `verify-governance-audits: ${errors.length} error${errors.length === 1 ? "" : "s"}` +
      (warnings.length === 0
        ? "."
        : ` and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`),
  );
  process.exitCode = 1;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  await main();
}
