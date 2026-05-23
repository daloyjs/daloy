/**
 * `pnpm hooks:install` — opt-in installer for the local `.git/hooks/pre-commit`
 * gate that runs {@link scripts/scan-staged-secrets.ts} before every commit.
 *
 * This is the local complement to the CI-side
 * [`secret-scan.yml`](../.github/workflows/secret-scan.yml) gitleaks
 * workflow and matches the "Secrets Pre-Commit Hook" feature of Aikido's
 * [Expansion Packs](https://www.aikido.dev/blog/introducing-aikido-expansion-packs):
 * a leaked credential is most cheaply caught *before* the secret reaches
 * any remote, including a personal fork.
 *
 * Behaviour:
 *
 *   1. Refuses to run unless the cwd is a git checkout (a `.git`
 *      directory or file — the latter is what `git worktree` writes).
 *   2. If `.git/hooks/pre-commit` already exists and was *not* installed
 *      by us, the install is refused so a contributor's local hook is
 *      never silently clobbered. Pass `--force` to overwrite.
 *   3. Writes a small POSIX shell hook that runs
 *      `pnpm scan:staged-secrets` and exits with its status. The hook is
 *      tagged with a sentinel comment so subsequent runs (or `--force`)
 *      can recognise it as ours.
 *   4. Marks the file executable (mode 0o755).
 *
 * Not invoked from `prepare` / `postinstall` — the framework's own
 * `verify:no-lifecycle-scripts` gate forbids those lifecycle hooks on
 * published manifests, and we deliberately do not install git hooks on a
 * consumer's `pnpm install` (that would surprise them). Contributors run
 * `pnpm hooks:install` once after `git clone`.
 *
 * Exit codes:
 *   0 — hook installed (or already installed and identical).
 *   1 — not a git checkout, or existing non-Daloy hook present without
 *       `--force`.
 *
 * @since 0.34.4
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const SENTINEL = "# daloyjs-pre-commit-secrets-hook v1";

const HOOK_BODY = `#!/usr/bin/env sh
${SENTINEL}
#
# Installed by \`pnpm hooks:install\`. Runs the local secret-leak gate
# against files staged for commit. To uninstall, delete this file.
#
# Bypass for a single commit (e.g. you are intentionally committing a
# fake credential into a test fixture) with \`git commit --no-verify\`.

if command -v pnpm >/dev/null 2>&1; then
  pnpm --silent scan:staged-secrets
else
  npm run --silent scan:staged-secrets
fi
`;

interface InstallOptions {
  readonly cwd: string;
  readonly force: boolean;
}

interface InstallResult {
  readonly status: "installed" | "already-installed" | "refused-existing";
  readonly hookPath: string;
}

/**
 * Resolve the `.git` directory for the given working directory. Supports
 * both a real `.git` directory and a `.git` file (which `git worktree`
 * writes as `gitdir: <path>`).
 */
function resolveGitDir(cwd: string): string | null {
  const gitMarker = resolve(cwd, ".git");
  if (!existsSync(gitMarker)) return null;
  const s = statSync(gitMarker);
  if (s.isDirectory()) return gitMarker;
  // .git file from `git worktree` — first line is `gitdir: <path>`.
  const text = readFileSync(gitMarker, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/m.exec(text);
  if (!match) return null;
  const target = match[1]!.trim();
  return resolve(cwd, target);
}

export function installPreCommitHook(opts: InstallOptions): InstallResult {
  const gitDir = resolveGitDir(opts.cwd);
  if (gitDir === null) {
    throw new Error(
      `hooks:install: not a git checkout (no .git directory at ${opts.cwd}).`,
    );
  }
  const hooksDir = resolve(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = resolve(hooksDir, "pre-commit");

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    if (existing.includes(SENTINEL)) {
      // Re-write to pick up template updates; this is idempotent.
      writeFileSync(hookPath, HOOK_BODY, { mode: 0o755 });
      chmodSync(hookPath, 0o755);
      return { status: "already-installed", hookPath };
    }
    if (!opts.force) {
      return { status: "refused-existing", hookPath };
    }
  }

  writeFileSync(hookPath, HOOK_BODY, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return { status: "installed", hookPath };
}

function main(): void {
  const force = process.argv.includes("--force");
  let result: InstallResult;
  try {
    result = installPreCommitHook({ cwd: process.cwd(), force });
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  switch (result.status) {
    case "installed":
      console.error(`hooks:install: wrote ${result.hookPath}`);
      return;
    case "already-installed":
      console.error(`hooks:install: refreshed existing Daloy hook at ${result.hookPath}`);
      return;
    case "refused-existing":
      console.error(
        `hooks:install: refusing to overwrite existing ${result.hookPath}. ` +
          "Re-run with --force to replace it, or move your hook aside first.",
      );
      process.exitCode = 1;
      return;
  }
}

if (process.argv[1]?.endsWith("install-git-hooks.ts")) {
  main();
}
