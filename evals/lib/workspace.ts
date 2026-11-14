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
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ablation, EvalTask, WorkspaceHandle } from "./types.ts";

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

/** Directory names never read into a snapshot. */
const SNAPSHOT_SKIP = new Set(["node_modules", ".git", "dist", "generated"]);
/** Files above this size are not snapshotted (they are never source). */
const SNAPSHOT_MAX_BYTES = 512 * 1024;
/** Cap on captured process output, to bound memory and report size. */
const OUTPUT_CAP_CHARS = 200_000;

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
  /** Combined stdout + stderr, capped. */
  readonly output: string;
}

/**
 * Spawn a process without a shell, capture its output, and kill its whole
 * process group if it exceeds `timeoutMs` (agents spawn their own children).
 *
 * @param command - Executable (resolved via `PATH`).
 * @param args - Arguments, passed verbatim (no shell interpolation).
 * @param opts - Working directory, environment, timeout, optional stdin.
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
  },
): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP_CHARS)
        output = output.slice(-OUTPUT_CAP_CHARS);
    };
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
      output += `\n[spawn error] ${err.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        output,
      });
    });
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
  return {
    dir,
    read: async (rel) => readFile(abs(rel), "utf8"),
    async write(rel, content) {
      const p = abs(rel);
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

async function linkDependencies(dir: string): Promise<void> {
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
    const target = await realpath(join(REPO_ROOT, "node_modules", name));
    await mkdir(dirname(join(nm, name)), { recursive: true });
    await symlink(target, join(nm, name), "dir");
  }
  await mkdir(join(nm, ".bin"), { recursive: true });
  await symlink("../typescript/bin/tsc", join(nm, ".bin", "tsc"));
  await symlink("../@daloyjs/core/bin/daloy.mjs", join(nm, ".bin", "daloy"));
}

async function git(dir: string, args: string[]): Promise<ProcessResult> {
  return runProcess("git", args, {
    cwd: dir,
    env: childEnv(),
    timeoutMs: 60_000,
  });
}

/** A prepared trial workspace. */
export interface PreparedWorkspace {
  /** Project root. */
  readonly dir: string;
  /** Temp parent directory to delete when the trial ends. */
  readonly root: string;
  /** Snapshot taken after setup, before the agent runs. */
  readonly before: Map<string, string>;
}

/**
 * Scaffold and prepare a workspace for one trial.
 *
 * @param task - The task (template + setup step).
 * @param ablation - Which agent-instruction surfaces to remove.
 * @returns The prepared workspace with its baseline snapshot.
 * @throws Error when scaffolding fails or `dist/` has not been built.
 */
export async function prepareWorkspace(
  task: EvalTask,
  ablation: Ablation,
): Promise<PreparedWorkspace> {
  const root = await mkdtemp(join(tmpdir(), `daloy-eval-${task.id}-`));
  const name = "daloy-eval-app";
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

  await linkDependencies(dir);
  if (task.setup) await task.setup(ws);

  await git(dir, ["init", "--quiet", "--initial-branch=main"]);
  await git(dir, ["add", "-A"]);
  await git(dir, [
    "-c",
    "user.name=daloy-eval",
    "-c",
    "user.email=eval@daloyjs.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    "eval baseline",
  ]);

  return { dir, root, before: await snapshot(dir) };
}

/**
 * The agent's changes since the baseline commit, including new files.
 *
 * @param dir - Workspace root.
 * @param maxChars - Truncation limit for the report.
 * @returns A unified diff (possibly truncated).
 */
export async function workspaceDiff(
  dir: string,
  maxChars = 60_000,
): Promise<string> {
  await git(dir, ["add", "-A", "--intent-to-add"]);
  const diff = await git(dir, [
    "--no-pager",
    "diff",
    "--no-color",
    "--",
    ".",
    ":(exclude)node_modules",
  ]);
  return diff.output.length > maxChars
    ? `${diff.output.slice(0, maxChars)}\n[diff truncated]`
    : diff.output;
}

/**
 * Delete a trial's temp directory.
 *
 * @param root - The `root` from {@link prepareWorkspace}.
 */
export async function disposeWorkspace(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
