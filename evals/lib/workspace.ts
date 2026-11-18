/**
 * Workspace lifecycle for one eval trial: scaffold a template with the local
 * `create-daloy`, wire dependencies offline from this repository, apply the
 * ablation and task setup, commit a git baseline, and snapshot files.
 *
 * Dependencies are never installed from the registry. `@daloyjs/core` is
 * copied from this repo's `dist/` (so the agent codes against the current
 * source, and cannot edit the repo through `node_modules`), and `zod`,
 * `typescript`, and `@types/node` are symlinked from the root install. That
 * keeps a trial fast, offline, and identical across runs.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Ablation,
  DiffFootprint,
  EvalTask,
  WorkspaceHandle,
} from "./types.ts";

/**
 * Absolute path of the repository root: the nearest ancestor holding
 * `pnpm-workspace.yaml`. Walking up (instead of a fixed `../..`) keeps this
 * correct when the harness is compiled into `dist-coverage/` for the
 * branch-coverage run.
 */
export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function findRepoRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir)
      throw new Error(`no pnpm-workspace.yaml above ${start}`);
  }
}

/**
 * Version of the stored-diff format in results files. `2` (from 16 Nov 2026)
 * includes deleted files; files without the field were written by the
 * earlier format, whose diffs omit deletions.
 */
export const DIFF_FORMAT = 2;

/**
 * Project name `create-daloy` scaffolds for every trial. Deliberately the
 * same kind of name a real user would pick, so nothing in the workspace says
 * it is an evaluation.
 */
export const WORKSPACE_APP_NAME = "my-daloy-app";

/** Directory names never read into a snapshot. */
const SNAPSHOT_SKIP = new Set(["node_modules", ".git", "dist", "generated"]);
/** Files above this size are not snapshotted (they are never source). */
const SNAPSHOT_MAX_BYTES = 512 * 1024;
/** Default cap on captured process output, to bound memory and report size. */
const OUTPUT_CAP_CHARS = 200_000;

/** Marker inserted where {@link runProcess} dropped the middle of long output. */
export const OUTPUT_ELIDED = "\n[... output elided ...]\n";

/**
 * Environment variables passed to every child process. Everything else in the
 * parent environment (cloud credentials, registry tokens, `NODE_OPTIONS`) is
 * withheld so a trial cannot read or leak it.
 */
const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "SHELL",
] as const;

/**
 * Build a minimal child-process environment.
 *
 * @param extraKeys - Extra parent variables to pass through (e.g. an agent's
 *   own API key). Unset keys are skipped.
 * @param source - Environment to read from (defaults to `process.env`).
 * @returns A fresh env object containing only allowlisted keys, plus
 *   `pnpm_config_verify_deps_before_run=false` so `pnpm test` / `pnpm
 *   typecheck` run against the pre-linked `node_modules` instead of
 *   attempting a registry install.
 */
export function childEnv(
  extraKeys: readonly string[] = [],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...BASE_ENV_KEYS, ...extraKeys]) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env.pnpm_config_verify_deps_before_run = "false";
  env.NO_COLOR = "1";
  return env;
}

/** Result of {@link runProcess}. */
export interface ProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /**
   * Combined stdout + stderr. Beyond the cap, the first quarter and the most
   * recent output are kept around {@link OUTPUT_ELIDED}: an agent trace needs
   * both how the session started (what it read) and how it ended.
   */
  readonly output: string;
}

/**
 * Spawn a process without a shell, capture its output, and kill its whole
 * process group if it exceeds `timeoutMs` (agents spawn their own children).
 *
 * @param command - Executable (resolved via `PATH`).
 * @param args - Arguments, passed verbatim (no shell interpolation).
 * @param opts - Working directory, environment, timeout, optional stdin, and
 *   output cap in characters (default 200,000).
 * @returns Exit code, timeout flag, duration, and captured output.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdin?: string;
    maxOutputChars?: number;
  },
): Promise<ProcessResult> {
  const started = Date.now();
  const cap = opts.maxOutputChars ?? OUTPUT_CAP_CHARS;
  const headCap = Math.floor(cap / 4);
  return new Promise((resolvePromise) => {
    let head = "";
    let tail = "";
    let elided = false;
    let timedOut = false;
    const append = (chunk: Buffer): void => {
      let text = chunk.toString("utf8");
      if (head.length < headCap) {
        const room = headCap - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
      }
      tail += text;
      if (tail.length > cap - headCap) {
        tail = tail.slice(-(cap - headCap));
        elided = true;
      }
    };
    const output = (): string => (elided ? head + OUTPUT_ELIDED + tail : head + tail);
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const kill = (): void => {
      try {
        if (child.pid !== undefined && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      tail += `\n[spawn error] ${err.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        output: output(),
      });
    });
    // A child that exits before reading stdin (fast tools, failed spawns)
    // closes the pipe; without a listener the EPIPE crashes the harness.
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? "");
  });
}

/**
 * A {@link WorkspaceHandle} rooted at `dir`. Paths are resolved relative to
 * the root and rejected if they escape it.
 *
 * @param dir - Absolute workspace root.
 * @returns The handle.
 * @throws Error from any method when a path escapes the root.
 */
export function workspaceHandle(dir: string): WorkspaceHandle {
  const abs = (rel: string): string => {
    const p = resolve(dir, rel);
    if (p !== dir && !p.startsWith(dir + sep))
      throw new Error(`path escapes workspace: ${rel}`);
    return p;
  };
  // The lexical check above does not see symlinks. The agent can make
  // `tests` a link to anywhere on the host; a harness write of
  // `tests/__eval_hidden__/x.test.ts` would then land there. Resolve the
  // parent and require it to be inside the (resolved) root.
  const insideAfterSymlinks = async (p: string): Promise<void> => {
    // Resolve the nearest ancestor that exists, before anything is created.
    let ancestor = dirname(p);
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const [root, real] = await Promise.all([realpath(dir), realpath(ancestor)]);
    if (real !== root && !real.startsWith(root + sep))
      throw new Error(`path resolves outside the workspace through a symlink: ${relative(dir, p)}`);
  };
  return {
    dir,
    read: async (rel) => readFile(abs(rel), "utf8"),
    async write(rel, content) {
      const p = abs(rel);
      await insideAfterSymlinks(p);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content);
    },
    remove: async (rel) => rm(abs(rel), { recursive: true, force: true }),
    async exists(rel) {
      try {
        await stat(abs(rel));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Read every text file under `dir` (skipping `node_modules`, `.git`, build
 * output, and large files) into a relative-path → content map.
 *
 * @param dir - Workspace root.
 * @returns The snapshot, keyed by `/`-separated relative paths.
 */
export async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (SNAPSHOT_SKIP.has(entry.name)) continue;
      const p = join(current, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && (await stat(p)).size <= SNAPSHOT_MAX_BYTES) {
        out.set(
          relative(dir, p).split(sep).join("/"),
          await readFile(p, "utf8"),
        );
      }
    }
  };
  await walk(dir);
  return out;
}

/**
 * Wire dependencies into a workspace. `@daloyjs/core` is always copied from
 * `dist/`. The others are symlinked: to the root install by default, or, with
 * `depsRoot`, to that absolute path as seen inside the agent container (the
 * links dangle on the host, which never runs them in Docker mode).
 */
async function linkDependencies(dir: string, depsRoot?: string): Promise<void> {
  const distEntry = join(REPO_ROOT, "dist", "index.js");
  try {
    await stat(distEntry);
  } catch {
    throw new Error(
      "dist/index.js not found. Run `pnpm build` before running evals.",
    );
  }
  const nm = join(dir, "node_modules");
  const core = join(nm, "@daloyjs", "core");
  await mkdir(core, { recursive: true });
  for (const entry of ["package.json", "dist", "bin"]) {
    await cp(join(REPO_ROOT, entry), join(core, entry), { recursive: true });
  }
  for (const name of ["zod", "typescript", "@types/node"]) {
    const target = depsRoot
      ? `${depsRoot}/${name}`
      : await realpath(join(REPO_ROOT, "node_modules", name));
    await mkdir(dirname(join(nm, name)), { recursive: true });
    await symlink(target, join(nm, name), "dir");
  }
  await mkdir(join(nm, ".bin"), { recursive: true });
  await symlink("../typescript/bin/tsc", join(nm, ".bin", "tsc"));
  await symlink("../@daloyjs/core/bin/daloy.mjs", join(nm, ".bin", "daloy"));
}

/**
 * Run git with no user or system config. With `gitDir`, the repository is that
 * directory and `dir` is only its work tree, so the `.git` inside `dir` (the
 * agent's, which it can fill with `diff.external`, `core.fsmonitor`, hooks)
 * is never read: the harness must not execute anything the agent wrote.
 */
async function git(dir: string, args: string[], gitDir?: string): Promise<ProcessResult> {
  return runProcess(
    "git",
    gitDir ? ["--git-dir", gitDir, "--work-tree", dir, ...args] : args,
    {
      cwd: dir,
      env: { ...childEnv(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      timeoutMs: 60_000,
    },
  );
}

/** The baseline commit, in the agent's repo and in the harness's. */
async function commitBaseline(dir: string, gitDir?: string): Promise<void> {
  await git(dir, ["init", "--quiet", "--initial-branch=main"], gitDir);
  await git(dir, ["add", "-A"], gitDir);
  await git(
    dir,
    [
      "-c",
      "user.name=Developer",
      "-c",
      "user.email=dev@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "Initial commit",
    ],
    gitDir,
  );
}

/** A prepared trial workspace. */
export interface PreparedWorkspace {
  /** Project root. */
  readonly dir: string;
  /** Temp parent directory to delete when the trial ends. */
  readonly root: string;
  /**
   * The harness's own git directory for this workspace, outside the agent's
   * mount. Diffs are computed from it, never from the agent's `.git`: the
   * agent can neither rewrite the baseline (by committing) nor plant config
   * that runs commands on the host.
   */
  readonly gitDir: string;
  /** Snapshot taken after setup, before the agent runs. */
  readonly before: Map<string, string>;
}

/**
 * Scaffold and prepare a workspace for one trial.
 *
 * @param task - The task (template + setup step).
 * @param ablation - Which agent-instruction surfaces to remove.
 * @param opts - `depsRoot`: link dependencies to this in-container path
 *   instead of the root install (Docker mode).
 * @returns The prepared workspace with its baseline snapshot.
 * @throws Error when scaffolding fails or `dist/` has not been built.
 */
export async function prepareWorkspace(
  task: EvalTask,
  ablation: Ablation,
  opts: { readonly depsRoot?: string } = {},
): Promise<PreparedWorkspace> {
  // Neutral names only: the agent can see its working directory, package
  // name, and git log, and an earlier run read "daloy-eval-guardrail-body-
  // limit" from the path as a hint about what was being graded.
  const root = await mkdtemp(join(tmpdir(), "proj-"));
  const name = WORKSPACE_APP_NAME;
  const scaffold = await runProcess(
    process.execPath,
    [
      join(REPO_ROOT, "packages", "create-daloy", "bin", "create-daloy.mjs"),
      name,
      "--template",
      task.template,
      "--yes",
      "--no-install",
      "--no-git",
      "--no-ci",
    ],
    { cwd: root, env: childEnv(), timeoutMs: 120_000 },
  );
  const dir = join(root, name);
  if (scaffold.exitCode !== 0) {
    await rm(root, { recursive: true, force: true });
    throw new Error(`create-daloy failed:\n${scaffold.output.slice(-2000)}`);
  }

  const ws = workspaceHandle(dir);
  if (ablation === "no-agents-md" || ablation === "bare")
    await ws.remove("AGENTS.md");
  if (ablation === "no-skill" || ablation === "bare")
    await ws.remove(".agents");

  await linkDependencies(dir, opts.depsRoot);
  if (task.setup) await task.setup(ws);

  // The agent's repo (a realistic project with one neutral commit), and the
  // harness's record of the same baseline where the agent cannot reach.
  await commitBaseline(dir);
  const gitDir = join(root, "harness.git");
  await commitBaseline(dir, gitDir);

  return { dir, root, gitDir, before: await snapshot(dir) };
}

/** Marks a stored diff that could not be computed; regrade treats it as unverified. */
export const DIFF_UNAVAILABLE = "[diff unavailable]";

/** Files whose rules change what git stages or shows. */
const RULE_FILES = new Set([".gitignore", ".gitattributes"]);

/**
 * Stage the agent's work in the harness's git directory from a clean copy,
 * so the agent's own files cannot decide what the harness sees. Staging
 * straight from the workspace let three files the agent can write blind the
 * stored diff (all reproduced): a new file listed in its `.gitignore` was
 * left out; a `.gitattributes` `-diff` entry turned a change into "Binary
 * files differ"; a nested git repository became one submodule line, or with
 * no commit made `git add` fail. The copy has no `.git` at any depth (a
 * nested repo's files are plain files) and stages with the BASELINE's
 * ignore and attribute rules; the agent's own `.gitignore` /
 * `.gitattributes` are then added as content, so their changes still show.
 * A symlinked rule file is copied as a link, never read.
 *
 * @returns An error message, or `undefined` when staging worked.
 */
async function stageFromCleanCopy(
  ws: Pick<PreparedWorkspace, "dir" | "gitDir">,
): Promise<string | undefined> {
  const tmp = await mkdtemp(join(tmpdir(), "eval-stage-"));
  const copy = join(tmp, "w");
  try {
    const agentRules: string[] = [];
    await cp(ws.dir, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: async (src) => {
        const name = basename(src);
        if (src === ws.dir) return true;
        if (name === ".git" || name === "node_modules") return false;
        if (RULE_FILES.has(name) && !(await lstat(src)).isSymbolicLink()) {
          agentRules.push(relative(ws.dir, src));
          return false;
        }
        return true;
      },
    });
    const tracked = await git(copy, ["ls-tree", "-r", "-z", "--name-only", "HEAD"], ws.gitDir);
    if (tracked.exitCode !== 0) return `git ls-tree failed: ${tracked.output.slice(0, 300)}`;
    const baselineRules = tracked.output.split("\0").filter((f) => RULE_FILES.has(basename(f)));
    for (const rel of baselineRules) {
      const show = await git(copy, ["show", `HEAD:${rel}`], ws.gitDir);
      if (show.exitCode !== 0) continue;
      await mkdir(dirname(join(copy, rel)), { recursive: true });
      await writeFile(join(copy, rel), show.output);
    }
    const add = await git(copy, ["add", "-A", "--", "."], ws.gitDir);
    if (add.exitCode !== 0) return `git add failed: ${add.output.slice(0, 300)}`;
    for (const rel of agentRules) {
      await mkdir(dirname(join(copy, rel)), { recursive: true });
      await writeFile(join(copy, rel), await readFile(join(ws.dir, rel)));
    }
    const ruleSet = new Set(agentRules);
    for (const rel of baselineRules.filter((f) => !ruleSet.has(f)))
      await rm(join(copy, rel), { force: true });
    if (agentRules.length || baselineRules.length) {
      const forced = await git(
        copy,
        ["add", "-A", "--force", "--", ...new Set([...agentRules, ...baselineRules])],
        ws.gitDir,
      );
      if (forced.exitCode !== 0) return `git add failed: ${forced.output.slice(0, 300)}`;
    }
    return undefined;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * The agent's changes since the baseline commit, including new and deleted
 * files. Computed in the harness's git directory ({@link PreparedWorkspace.gitDir}),
 * so an agent that committed its work still shows every change, and nothing
 * in the agent's `.git` is read or run.
 *
 * @param ws - The workspace (`dir` and `gitDir`).
 * @param maxChars - Truncation limit for the report.
 * @returns A unified diff (possibly truncated).
 */
export async function workspaceDiff(
  ws: Pick<PreparedWorkspace, "dir" | "gitDir">,
  maxChars = 60_000,
): Promise<string> {
  // Stage everything and diff the index against the baseline commit, so new,
  // modified, AND deleted files all appear. (The earlier `add -A -N` + plain
  // `git diff` staged deletions and so dropped them from the diff.)
  const staged = await stageFromCleanCopy(ws);
  if (staged) return `${DIFF_UNAVAILABLE} ${staged}\n`;
  const diff = await git(
    ws.dir,
    [
      "--no-pager",
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--text",
      "HEAD",
      "--",
      ".",
      ":(exclude)node_modules",
    ],
    ws.gitDir,
  );
  return diff.output.length > maxChars
    ? `${diff.output.slice(0, maxChars)}\n[diff truncated]`
    : diff.output;
}

/**
 * Parse `git diff --numstat` output. Binary files (`-\t-`) count as changed
 * files with no line counts.
 *
 * @param numstat - The command's output.
 * @returns Files changed and lines added / removed.
 */
export function parseNumstat(numstat: string): DiffFootprint {
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of numstat.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t./.exec(line);
    if (!m) continue;
    filesChanged++;
    if (m[1] !== "-") linesAdded += Number(m[1]);
    if (m[2] !== "-") linesRemoved += Number(m[2]);
  }
  return { filesChanged, linesAdded, linesRemoved };
}

/**
 * Size of the agent's changes since the baseline, new and deleted files
 * included (same source as {@link workspaceDiff}).
 *
 * @param ws - The workspace (`dir` and `gitDir`).
 * @returns Files changed and lines added / removed.
 */
export async function workspaceFootprint(
  ws: Pick<PreparedWorkspace, "dir" | "gitDir">,
): Promise<DiffFootprint> {
  await stageFromCleanCopy(ws);
  const r = await git(
    ws.dir,
    [
      "--no-pager",
      "diff",
      "--cached",
      "--numstat",
      "--no-ext-diff",
      "--no-textconv",
      "--text",
      "HEAD",
      "--",
      ".",
      ":(exclude)node_modules",
    ],
    ws.gitDir,
  );
  return parseNumstat(r.output);
}

/**
 * Delete a trial's temp directory.
 *
 * @param root - The `root` from {@link prepareWorkspace}.
 */
export async function disposeWorkspace(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/**
 * Copy a workspace for grading, so hidden tests and the agent's code run on a
 * copy and the original stays the record. No `node_modules` directory (at any
 * depth) and no symlink is copied; the top-level `node_modules` is rebuilt
 * from trusted sources, because the agent can write them and they are
 * outside the diff and snapshots. An agent that replaced
 * `node_modules/typescript` with its own always-passing `tsc` would
 * otherwise forge the typecheck grade, and a fake `@daloyjs/core` could fake
 * framework behaviour under the hidden tests.
 *
 * @param dir - Workspace root.
 * @param dest - Destination directory (must not exist).
 * @param depsRoot - Same as {@link prepareWorkspace}'s option: where
 *   dependencies live (the agent image path in Docker mode).
 */
export async function copyWorkspace(
  dir: string,
  dest: string,
  depsRoot?: string,
): Promise<void> {
  // Symlinks are not copied either: on the host they resolve against the
  // host filesystem, so a link the agent made (`tests` -> somewhere) would
  // redirect the harness's own writes, chmods, and removals in the copy.
  await cp(dir, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: async (src) =>
      basename(src) !== "node_modules" && !(await lstat(src)).isSymbolicLink(),
  });
  await linkDependencies(dest, depsRoot);
}

/**
 * Make a temporary directory tree writable by any user, so the unprivileged
 * user in an agent or grader container can work in it whatever the host
 * user's uid. Only used on throwaway trial directories. Symlinks are skipped.
 *
 * @param dir - Directory to open up.
 */
export async function openForContainer(dir: string): Promise<void> {
  const { chmod, lstat } = await import("node:fs/promises");
  const walk = async (p: string): Promise<void> => {
    const st = await lstat(p);
    if (st.isSymbolicLink()) return;
    await chmod(p, st.isDirectory() ? 0o777 : 0o666 | (st.mode & 0o111));
    if (st.isDirectory())
      for (const e of await readdir(p)) await walk(join(p, e));
  };
  await walk(dir);
}
