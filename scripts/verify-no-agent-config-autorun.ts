/**
 * Pre-publish "AI-agent / editor config auto-run" gate (Miasma worm class).
 *
 * Sibling to `verify-no-leaky-agent-skills.ts` and
 * `verify-no-toxic-agent-skills.ts`. Those two gates scan *agent
 * instruction markdown* (`SKILL.md`, `AGENTS.md`, `.cursorrules`,
 * `CLAUDE.md`, …) for prompt-injection / credential-leak prose. This
 * gate closes the adjacent — and, until June 2026, unguarded — surface
 * that the **Miasma** worm (a Mini Shai-Hulud variant) weaponized:
 * editor and AI-coding-agent *config files* that silently auto-execute
 * a command the moment a developer opens the folder or starts an agent
 * session.
 *
 * SafeDep's 2026-06-05 write-up
 * <https://safedep.io/miasma-worm-ai-coding-agent-config-injection/>
 * documents a worm wave that skipped the npm registry entirely and
 * pushed a six-file commit straight to 120+ GitHub source repos
 * (including `Azure/durabletask`). Five of the six files exist only to
 * launch the sixth (`.github/setup.js`, a staged Bun-loader dropper).
 * Each launcher abuses a *legitimate auto-run feature* of a different
 * tool:
 *
 *  - `.vscode/tasks.json` — a task with
 *    `"runOptions": { "runOn": "folderOpen" }`. VS Code runs it on
 *    folder open with no agent and no prompt.
 *  - `.claude/settings.json` / `.gemini/settings.json` — a
 *    `SessionStart` (or any) **command hook** (`"type": "command"`)
 *    that Claude Code / Gemini CLI execute when an agent session opens.
 *    "A `SessionStart` hook is a `postinstall` for your editor."
 *  - `.cursor/rules/*.mdc` — an always-applied project rule
 *    (`alwaysApply: true`) whose body instructs the agent to run the
 *    dropper. A prompt injection that ships in the repo.
 *  - `package.json` — the `test` (or any) script hijacked to
 *    `node .github/setup.js`, so CI and `npm test` also detonate it.
 *  - a loose executable script dropped directly under `.github/`
 *    (the `.github/setup.js` payload itself).
 *
 * "Cloning the repo is safe. Opening it is not." The detonation surface
 * moved from `npm install` to `git clone` + open-in-editor, which is
 * exactly the workflow a developer scaffolding a `create-daloy`
 * template performs. Because the `create-daloy` templates ship verbatim
 * into the user's freshly-opened workspace, a single poisoned template
 * file would auto-run on the user's machine with the user's
 * credentials — strictly worse than a `@daloyjs/core` source
 * regression. This gate is the publish-blocking regression net.
 *
 * The detectors are deliberately high-precision: they flag the
 * *auto-run wiring* (the trigger), not the mere presence of a
 * `.vscode/` or `.claude/` directory. A `.vscode/settings.json`,
 * `.vscode/extensions.json`, or a `.cursor` rule that only states a
 * coding convention does not trip the gate — only a config that wires a
 * command to an auto-run trigger does.
 *
 * Categories (each finding carries its taxonomy id):
 *
 *  - `vscode-folderopen-task` — a `.vscode/tasks.json` (or
 *    `*.code-workspace`) task configured with `runOn: "folderOpen"`.
 *  - `agent-session-command-hook` — a `.claude` / `.gemini`
 *    `settings.json` carrying a `"type": "command"` hook.
 *  - `cursor-alwaysapply-exec` — a `.cursor/rules/*.mdc` rule with
 *    `alwaysApply: true` whose body instructs the agent to run a
 *    command / script.
 *  - `npm-script-config-entrypoint` — a `package.json` script that
 *    invokes a JS/TS entrypoint living inside an editor / agent / CI
 *    config directory (`.github/`, `.vscode/`, `.claude/`, `.gemini/`,
 *    `.cursor/`) — e.g. the Miasma `"test": "node .github/setup.js"`
 *    hijack.
 *  - `github-root-dropper` — a loose executable script
 *    (`*.js` / `*.ts` / `*.mjs` / `*.cjs`) placed directly under
 *    `.github/` (where only config, templates, and `workflows/` belong),
 *    matching the `.github/setup.js` dropper IoC.
 *
 * Scope: the entire repo tree, including
 * `packages/create-daloy/templates/<tpl>/` (where the `_`-prefixed
 * dotfile convention is also matched, so a `_vscode/tasks.json` or
 * `_claude/settings.json` that scaffolds into `.vscode` / `.claude`
 * is caught before it ships).
 *
 * Exit codes:
 *   0 — no auto-run config-injection wiring found.
 *   1 — at least one finding; offending paths printed to stderr.
 *
 * @since 0.37.1
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();

/** Directory names the walker never descends into, at any depth. */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-coverage",
  "coverage",
  "temp_tarball",
  "generated",
]);

/**
 * Files exempt from scanning: the gate's own source and its test, which
 * must be able to quote the attack shapes verbatim. Listed in
 * POSIX-relative form.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "scripts/verify-no-agent-config-autorun.ts",
  "tests/verify-no-agent-config-autorun.test.ts",
]);

/** A single auto-run config-injection finding. */
export interface AutorunFinding {
  readonly file: string;
  readonly id: string;
  readonly detail: string;
  readonly why: string;
}

/**
 * Strip `//` line and block comments from a JSONC document (VS Code
 * `tasks.json` and the agent `settings.json` files permit comments).
 * String contents are preserved so a `"https://…"` value or a `//`
 * inside a string is never mistaken for a comment.
 *
 * @param input - Raw JSONC source.
 * @returns The same document with comments replaced by nothing.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let stringChar = "";
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const n = input[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i++;
        continue;
      }
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Detect a VS Code `folderOpen` auto-run task. The literal
 * `"runOn": "folderOpen"` only appears for this feature, so a
 * whitespace-tolerant regex on the comment-stripped text is both
 * precise and obfuscation-resistant.
 *
 * @param raw - Raw `tasks.json` / `*.code-workspace` source.
 * @returns Findings (without the `file` field) for each occurrence.
 */
export function scanVscodeTasks(raw: string): readonly Omit<AutorunFinding, "file">[] {
  const text = stripJsonComments(raw);
  const re = /"runOn"\s*:\s*"folderOpen"/g;
  const out: Omit<AutorunFinding, "file">[] = [];
  if (re.test(text)) {
    out.push({
      id: "vscode-folderopen-task",
      detail: 'task wired to "runOn": "folderOpen"',
      why: 'A VS Code task with `runOptions.runOn: "folderOpen"` auto-executes its `command` the instant the folder is opened — no agent and no user action required. This is the Miasma worm\'s VS Code launcher (SafeDep 2026-06-05). A committed/shipped config must never carry it.',
    });
  }
  return out;
}

/**
 * Detect a Claude Code / Gemini CLI command hook
 * (`"type": "command"` under a `"hooks"` block). Such a hook runs a
 * shell command on agent lifecycle events (e.g. `SessionStart`). A
 * project-scoped, committed `settings.json` must not auto-run shell
 * commands; legitimate per-developer hooks live in the user-scoped
 * `~/.claude` / `~/.gemini` settings, not in the repo.
 *
 * @param raw - Raw `settings.json` source.
 * @returns Findings (without the `file` field) for each command hook.
 */
export function scanAgentHooks(raw: string): readonly Omit<AutorunFinding, "file">[] {
  const text = stripJsonComments(raw);
  const out: Omit<AutorunFinding, "file">[] = [];
  // High precision: only flag when BOTH a hooks block and a command-type
  // hook are present, so a settings.json that merely tweaks model/theme
  // does not trip the gate.
  if (/"hooks"\s*:/.test(text) && /"type"\s*:\s*"command"/.test(text)) {
    const cmds = [...text.matchAll(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/g)]
      .map((m) => m[1])
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    const detail =
      cmds.length > 0
        ? `command hook(s): ${cmds.map((c) => c.slice(0, 120)).join(" | ")}`
        : "command-type hook present";
    out.push({
      id: "agent-session-command-hook",
      detail,
      why: 'A Claude Code / Gemini CLI `"type": "command"` hook auto-runs a shell command when an agent session opens in the project ("a SessionStart hook is a postinstall for your editor"). This is the Miasma worm\'s Claude/Gemini launcher (SafeDep 2026-06-05). Repo-committed agent settings must not wire command hooks.',
    });
  }
  return out;
}

/**
 * Detect a Cursor always-applied rule (`alwaysApply: true`) whose body
 * instructs the agent to run / execute a command or script. The
 * combination is the Miasma Cursor launcher: an always-on project rule
 * that social-engineers the assistant into executing the dropper.
 *
 * @param raw - Raw `.mdc` rule source (front-matter + body).
 * @returns Findings (without the `file` field) when both signals match.
 */
export function scanCursorRule(raw: string): readonly Omit<AutorunFinding, "file">[] {
  const out: Omit<AutorunFinding, "file">[] = [];
  const alwaysApply = /^\s*alwaysApply\s*:\s*true\s*$/im.test(raw);
  if (!alwaysApply) return out;
  // Imperative "run/execute/invoke … <runtime|script>" instruction.
  const runInstruction =
    /\b(?:run|execute|invoke|launch)\b[^\n]*?(?:\b(?:node|bun|deno|npx|ts-node|tsx|sh|bash|zsh|python3?|powershell|pwsh)\b|\.(?:c|m)?[jt]sx?\b|\.(?:sh|ps1|py)\b)/i;
  const m = raw.match(runInstruction);
  if (m) {
    out.push({
      id: "cursor-alwaysapply-exec",
      detail: `alwaysApply rule instructs: ${m[0].trim().slice(0, 160)}`,
      why: 'A Cursor `.mdc` rule with `alwaysApply: true` is injected into every agent turn. Pairing it with a "run this script" instruction is a prompt injection that ships in the repo — the Miasma worm\'s Cursor launcher (SafeDep 2026-06-05). An always-applied rule must not tell the agent to execute a command/script.',
    });
  }
  return out;
}

/**
 * Detect a `package.json` script that invokes a JS/TS entrypoint living
 * inside an editor / agent / CI config directory (`.github/`,
 * `.vscode/`, `.claude/`, `.gemini/`, `.cursor/`, with or without the
 * leading dot to also catch the `_`-prefixed template convention).
 * Those directories hold config — never npm-invoked entrypoints — so a
 * script that runs code out of them is the Miasma `test`-script hijack
 * (`"test": "node .github/setup.js"`).
 *
 * @param raw - Raw `package.json` source.
 * @returns Findings (without the `file` field) for each hijacked script.
 */
export function scanPackageJsonScripts(raw: string): readonly Omit<AutorunFinding, "file">[] {
  const out: Omit<AutorunFinding, "file">[] = [];
  const entrypointRe =
    /[._](?:github|vscode|idea|claude|gemini|cursor)\/[^\s"';|&]*\.(?:c|m)?[jt]sx?\b/i;
  let scripts: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(stripJsonComments(raw)) as {
      scripts?: Record<string, unknown>;
    };
    scripts = parsed.scripts;
  } catch {
    scripts = undefined;
  }
  if (scripts && typeof scripts === "object") {
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value === "string" && entrypointRe.test(value)) {
        out.push({
          id: "npm-script-config-entrypoint",
          detail: `script "${name}" runs a config-dir entrypoint: ${value.slice(0, 160)}`,
          why: 'A package.json script that executes a JS/TS file from a config directory (.github/.vscode/.claude/.gemini/.cursor) is the Miasma worm\'s script hijack (`"test": "node .github/setup.js"`) — it detonates on `npm test` and in CI. Run only files from normal source dirs (`scripts/`, `src/`, `bin/`).',
        });
      }
    }
    return out;
  }
  // Fallback: parse failed (truncated/obfuscated) — scan the raw text.
  if (entrypointRe.test(raw)) {
    out.push({
      id: "npm-script-config-entrypoint",
      detail: "a script references a config-dir entrypoint (unparseable package.json)",
      why: "A package.json script appears to execute a JS/TS file from a config directory (.github/.vscode/.claude/.gemini/.cursor) — the Miasma worm's script-hijack vector. Run only files from normal source dirs (`scripts/`, `src/`, `bin/`).",
    });
  }
  return out;
}

const VSCODE_TASKS_RE = /(?:^|\/)[._]vscode\/tasks\.json$/i;
const CODE_WORKSPACE_RE = /\.code-workspace$/i;
const AGENT_SETTINGS_RE = /(?:^|\/)[._](?:claude|gemini)\/settings(?:\.local)?\.json$/i;
const CURSOR_RULE_RE = /(?:^|\/)[._]cursor\/rules\/[^/]+\.mdc$/i;
const PACKAGE_JSON_RE = /(?:^|\/)package\.json$/i;
const GITHUB_ROOT_SCRIPT_RE = /(?:^|\/)[._]github\/[^/]+\.(?:c|m)?[jt]sx?$/i;

/**
 * True when `relPosix` names a config surface this gate must inspect.
 * Exposed for tests.
 *
 * @param relPosix - Repo-relative POSIX path.
 * @returns `true` if the path is an auto-run config surface.
 */
export function isConfigSurface(relPosix: string): boolean {
  return (
    VSCODE_TASKS_RE.test(relPosix) ||
    CODE_WORKSPACE_RE.test(relPosix) ||
    AGENT_SETTINGS_RE.test(relPosix) ||
    CURSOR_RULE_RE.test(relPosix) ||
    PACKAGE_JSON_RE.test(relPosix) ||
    GITHUB_ROOT_SCRIPT_RE.test(relPosix)
  );
}

/**
 * Pure dispatcher: given a config surface's repo-relative POSIX path and
 * its raw content, return every auto-run finding. A loose `.github/`
 * script is flagged on path alone (its mere presence is the IoC).
 * Exposed for tests.
 *
 * @param relPosix - Repo-relative POSIX path.
 * @param raw - Raw file content (ignored for `github-root-dropper`).
 * @returns Findings carrying the `file` field set to `relPosix`.
 */
export function scanConfigFile(relPosix: string, raw: string): readonly AutorunFinding[] {
  const hits: Omit<AutorunFinding, "file">[] = [];
  if (VSCODE_TASKS_RE.test(relPosix) || CODE_WORKSPACE_RE.test(relPosix)) {
    hits.push(...scanVscodeTasks(raw));
  }
  if (AGENT_SETTINGS_RE.test(relPosix)) {
    hits.push(...scanAgentHooks(raw));
  }
  if (CURSOR_RULE_RE.test(relPosix)) {
    hits.push(...scanCursorRule(raw));
  }
  if (PACKAGE_JSON_RE.test(relPosix)) {
    hits.push(...scanPackageJsonScripts(raw));
  }
  if (GITHUB_ROOT_SCRIPT_RE.test(relPosix)) {
    hits.push({
      id: "github-root-dropper",
      detail: "loose executable script placed directly under .github/",
      why: "The `.github/` directory holds config, issue/PR templates, and `workflows/` — never a loose top-level `*.js`/`*.ts` entrypoint. A standalone script here matches the Miasma `.github/setup.js` dropper IoC (SafeDep 2026-06-05). Move legitimate scripts to `scripts/` or `.github/actions/<name>/`.",
    });
  }
  return hits.map((h) => ({ file: relPosix, ...h }));
}

function isSkippedDir(relPath: string): boolean {
  const posixPath = relPath.split(sep).join("/");
  return posixPath.split("/").some((segment) => SKIP_DIR_NAMES.has(segment));
}

async function* walkConfigFiles(root: string): AsyncIterable<string> {
  async function* recurse(dir: string): AsyncIterable<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      const rel = relative(root, full);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name) || isSkippedDir(rel)) continue;
        yield* recurse(full);
      } else if (ent.isFile()) {
        const relPosix = rel.split(sep).join("/");
        if (isConfigSurface(relPosix)) yield full;
      }
    }
  }
  const s = await stat(root).catch(() => null);
  if (s && s.isDirectory()) {
    yield* recurse(root);
  }
}

/**
 * Walk `rootDir` and return every auto-run config-injection finding.
 *
 * @param rootDir - Directory to scan (defaults to the repo root).
 * @returns All findings across every scanned config surface.
 */
export async function findAgentConfigAutorun(
  rootDir: string = REPO_ROOT
): Promise<readonly AutorunFinding[]> {
  const findings: AutorunFinding[] = [];
  for await (const file of walkConfigFiles(rootDir)) {
    const relPosix = posix.normalize(relative(rootDir, file).split(sep).join("/"));
    if (ALLOWLIST.has(relPosix)) continue;
    // `github-root-dropper` is decided by path alone; for the rest we
    // need the content.
    let raw = "";
    if (!GITHUB_ROOT_SCRIPT_RE.test(relPosix)) {
      try {
        raw = await readFile(file, "utf8");
      } catch {
        continue;
      }
    }
    findings.push(...scanConfigFile(relPosix, raw));
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await findAgentConfigAutorun();
  for (const f of findings) {
    console.error(`${f.file} [${f.id}] ${f.why}`);
    console.error(`    > ${f.detail}`);
  }
  if (findings.length > 0) {
    console.error(
      `verify-no-agent-config-autorun: ${findings.length} auto-run ` +
        `config-injection${findings.length === 1 ? "" : "s"} detected. ` +
        "An editor / AI-coding-agent config file wires a command to an " +
        "auto-run trigger (VS Code folderOpen task, Claude/Gemini command " +
        "hook, Cursor always-apply rule, hijacked npm script, or a loose " +
        ".github/ dropper). This is the Miasma worm's detonation surface — " +
        "see https://safedep.io/miasma-worm-ai-coding-agent-config-injection/."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-agent-config-autorun.ts")) {
  await main();
}
