/**
 * Docker isolation for live agent runs (`--sandbox docker`).
 *
 * Three stages with different trust:
 *
 * - **Harness** (trusted, this process on the host): prepares workspaces,
 *   holds the tasks, hidden tests, reference solutions, and graders.
 * - **Agent** (untrusted): runs in a container from the agent image that
 *   sees **only** its workspace, mounted at `/work`. The image is built from
 *   an empty context (`pnpm eval:image`), so no repository file, hidden test,
 *   or grader is in it. Its only network is an internal Docker network whose
 *   one way out is the allowlisting egress proxy (`egress-proxy.ts`).
 * - **Grade** (runs the agent's code): typecheck and tests run on a copy of
 *   the finished workspace in a `--network none` container from the same
 *   image. Static checks (the guardrail diff, protected files) run in the
 *   harness on snapshots.
 *
 * The image carries Linux builds of the workspace dependencies under
 * {@link IMAGE_DEPS_DIR}; in Docker mode workspaces link to them, because the
 * host's `node_modules` holds native binaries for the host platform
 * (TypeScript 7 is native). Containers run as the image's unprivileged `node`
 * user, so the harness makes each temporary workspace writable for it.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { childEnv, REPO_ROOT, runProcess, type ProcessResult } from "./workspace.ts";

/** Agent image name (override with `DALOY_EVAL_AGENT_IMAGE`). */
export const AGENT_IMAGE =
  process.env.DALOY_EVAL_AGENT_IMAGE ?? "daloy-eval-agent";

/** Where the image installs the workspace dependencies. */
export const IMAGE_DEPS_DIR = "/opt/eval-deps/node_modules";

/** Internal Docker network the agent and the egress proxy share. */
export const EVAL_NETWORK = "daloy-eval-internal";

/** Workspace mount point inside agent and grader containers. */
export const CONTAINER_WORKDIR = "/work";

/** Image label recording what the image was built with. */
export const IMAGE_LABEL = "dev.daloyjs.eval.spec";

/** Dependencies linked into every workspace (and installed in the image). */
export const WORKSPACE_DEPS = ["zod", "typescript", "@types/node"] as const;

/** Default egress allowlist per live agent. */
export const DEFAULT_EGRESS: Readonly<Record<string, readonly string[]>> = {
  copilot: [".githubcopilot.com", "api.github.com"],
  claude: ["api.anthropic.com"],
  codex: ["api.openai.com"],
};

/** What the agent image must contain; part of its label. */
export interface ImageSpec {
  readonly pnpm: string;
  readonly copilot: string;
  /** Optional extra CLIs, installed only when a version is set. */
  readonly claude?: string;
  readonly codex?: string;
  /** Workspace dependency versions, from the root install. */
  readonly deps: Readonly<Record<string, string>>;
}

async function version(pkgDir: string): Promise<string> {
  const pkg = JSON.parse(
    await readFile(join(pkgDir, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

/**
 * The image spec for this checkout: pnpm from `packageManager`, the agent
 * CLI versions from the environment (`COPILOT_CLI_VERSION`, default 1.0.112;
 * `CLAUDE_CODE_VERSION`, `CODEX_VERSION` opt-in), and dependency versions
 * from `node_modules`.
 *
 * @returns The spec.
 * @throws Error when a dependency is not installed.
 */
export async function imageSpec(): Promise<ImageSpec> {
  const root = JSON.parse(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { packageManager?: string };
  const pnpm = /^pnpm@(\d[\w.-]*)$/.exec(root.packageManager ?? "")?.[1];
  if (!pnpm) throw new Error("package.json packageManager must be pnpm@<version>");
  const deps: Record<string, string> = {};
  for (const name of WORKSPACE_DEPS)
    deps[name] = await version(join(REPO_ROOT, "node_modules", name));
  return {
    pnpm,
    copilot: process.env.COPILOT_CLI_VERSION ?? "1.0.112",
    ...(process.env.CLAUDE_CODE_VERSION ? { claude: process.env.CLAUDE_CODE_VERSION } : {}),
    ...(process.env.CODEX_VERSION ? { codex: process.env.CODEX_VERSION } : {}),
    deps,
  };
}

/**
 * Stable label value for a spec.
 *
 * @param spec - The spec.
 * @returns A JSON string with sorted keys.
 */
export function specLabel(spec: ImageSpec): string {
  const sorted = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => {
          const v = o[k];
          return [k, v && typeof v === "object" ? sorted(v as Record<string, unknown>) : v];
        }),
    );
  return JSON.stringify(sorted(spec as unknown as Record<string, unknown>));
}

async function docker(args: string[], timeoutMs = 120_000): Promise<ProcessResult> {
  return runProcess("docker", args, { cwd: REPO_ROOT, env: childEnv(["DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"]), timeoutMs });
}

/**
 * Fail fast unless the agent image exists and matches this checkout.
 *
 * @param agent - The live agent that will run (its CLI must be in the image).
 * @throws Error naming the command that fixes the problem.
 */
export async function checkAgentImage(agent: string): Promise<void> {
  const want = await imageSpec();
  const r = await docker([
    "image",
    "inspect",
    "--format",
    `{{ index .Config.Labels "${IMAGE_LABEL}" }}`,
    AGENT_IMAGE,
  ]);
  if (r.exitCode !== 0)
    throw new Error(`agent image "${AGENT_IMAGE}" not found. Build it with: pnpm eval:image`);
  const have = r.output.trim();
  if (have !== specLabel(want))
    throw new Error(
      `agent image "${AGENT_IMAGE}" is out of date (built with ${have || "no label"}, need ${specLabel(want)}). Rebuild it with: pnpm eval:image`,
    );
  if (agent === "claude" && !want.claude)
    throw new Error("set CLAUDE_CODE_VERSION and rebuild (pnpm eval:image) to run Claude Code in the sandbox");
  if (agent === "codex" && !want.codex)
    throw new Error("set CODEX_VERSION and rebuild (pnpm eval:image) to run Codex in the sandbox");
}

/**
 * Fail fast unless the agent image (used to grade too) matches this checkout.
 *
 * @throws Error naming the command that fixes the problem.
 */
export async function checkGraderImage(): Promise<void> {
  await checkAgentImage("grader");
}

/** A running egress proxy. */
export interface EgressProxy {
  readonly name: string;
  readonly allow: readonly string[];
  /** Save the proxy's decision log to `logPath` and stop it. */
  stop(logPath: string): Promise<void>;
}

/**
 * Create the internal network (if needed) and start the egress proxy on it.
 * The proxy container gets only the two proxy source files, read-only.
 *
 * @param allow - Host-name allowlist.
 * @returns The running proxy.
 * @throws Error when Docker fails.
 */
export async function startEgressProxy(allow: readonly string[]): Promise<EgressProxy> {
  if ((await docker(["network", "inspect", EVAL_NETWORK])).exitCode !== 0) {
    const made = await docker(["network", "create", "--internal", EVAL_NETWORK]);
    if (made.exitCode !== 0) throw new Error(`docker network create failed: ${made.output}`);
  }
  const name = `daloy-eval-egress-${process.pid}-${Date.now()}`;
  const evals = join(REPO_ROOT, "evals");
  const started = await docker([
    "run", "-d", "--rm", "--name", name,
    "--cap-drop=ALL", "--security-opt", "no-new-privileges",
    "--memory", "256m", "--read-only",
    "-e", `EGRESS_ALLOW=${allow.join(",")}`,
    "-v", `${join(evals, "egress-proxy.ts")}:/proxy/egress-proxy.ts:ro`,
    "-v", `${join(evals, "lib", "egress.ts")}:/proxy/lib/egress.ts:ro`,
    "--entrypoint", "node",
    AGENT_IMAGE, "/proxy/egress-proxy.ts",
  ]);
  if (started.exitCode !== 0) throw new Error(`egress proxy failed to start: ${started.output}`);
  const connected = await docker(["network", "connect", "--alias", "egress", EVAL_NETWORK, name]);
  if (connected.exitCode !== 0) {
    await docker(["rm", "-f", name]);
    throw new Error(`egress proxy failed to join ${EVAL_NETWORK}: ${connected.output}`);
  }
  return {
    name,
    allow,
    async stop(logPath) {
      const logs = await docker(["logs", name]);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(logPath, logs.output);
      await docker(["rm", "-f", name]);
    },
  };
}

/** Restrictions every agent and grader container gets. */
function lockedDown(name: string, hostDir: string): string[] {
  return [
    "run", "--rm", "--name", name, "--init",
    "--cap-drop=ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--memory", "3g", "--pids-limit", "512",
    "--tmpfs", "/tmp:exec,mode=1777",
    "--tmpfs", "/home/eval:exec,mode=1777",
    "-e", "HOME=/home/eval",
    "-e", "pnpm_config_verify_deps_before_run=false",
    "-e", "NO_COLOR=1",
    "-v", `${hostDir}:${CONTAINER_WORKDIR}`,
    "-w", CONTAINER_WORKDIR,
  ];
}

async function runContainer(name: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcessResult> {
  const r = await runProcess("docker", args, {
    cwd: REPO_ROOT,
    env: { ...childEnv(["DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"]), ...env },
    timeoutMs,
    maxOutputChars: 4_000_000,
  });
  // Killing the docker client does not stop the container.
  if (r.timedOut) await docker(["rm", "-f", name]);
  return r;
}

/**
 * Run a live agent CLI in the agent container on one workspace.
 *
 * @param hostDir - The workspace on the host (the only thing mounted).
 * @param argv - The CLI and its arguments (paths must use {@link CONTAINER_WORKDIR}).
 * @param secretEnv - Variables to forward by name only (values never appear in
 *   the docker command line), with their values.
 * @param plainEnv - Non-secret variables, set explicitly.
 * @param timeoutMs - Wall-clock limit; the container is removed on timeout.
 * @returns The CLI's exit code and output.
 */
export async function runAgentContainer(
  hostDir: string,
  argv: readonly string[],
  secretEnv: NodeJS.ProcessEnv,
  plainEnv: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<ProcessResult> {
  const name = `daloy-eval-agent-${process.pid}-${Date.now()}`;
  const proxy = "http://egress:3128";
  const args = [
    ...lockedDown(name, hostDir),
    "--network", EVAL_NETWORK,
    ...Object.keys(secretEnv).flatMap((k) => ["-e", k]),
    ...Object.entries({
      ...plainEnv,
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy,
      https_proxy: proxy,
      http_proxy: proxy,
      NO_PROXY: "localhost,127.0.0.1,::1",
      NODE_USE_ENV_PROXY: "1",
    }).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    AGENT_IMAGE,
    ...argv,
  ];
  return runContainer(name, args, secretEnv, timeoutMs);
}

/**
 * Run a grading command (`node ...`) on a workspace copy in a container with
 * no network.
 *
 * @param hostDir - The workspace copy on the host.
 * @param argv - Command and arguments, run in {@link CONTAINER_WORKDIR}.
 * @param timeoutMs - Wall-clock limit.
 * @returns Exit code and output.
 */
export async function runGraderContainer(
  hostDir: string,
  argv: readonly string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  const name = `daloy-eval-grade-${process.pid}-${Date.now()}`;
  return runContainer(
    name,
    [...lockedDown(name, hostDir), "--network", "none", AGENT_IMAGE, ...argv],
    {},
    timeoutMs,
  );
}
