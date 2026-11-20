/**
 * `pnpm eval:image` — build the agent image for `pnpm eval --sandbox docker`.
 *
 * Pipes `evals/Dockerfile` to `docker build` with NO build context, so no
 * repository file can end up in the image, and passes the pinned versions
 * (pnpm from `packageManager`, the agent CLIs, the workspace dependencies)
 * as build arguments. The spec is stored as an image label; `pnpm eval`
 * refuses an image whose label does not match the checkout.
 *
 * Optional: `CLAUDE_CODE_VERSION=<x.y.z>` and `CODEX_VERSION=<x.y.z>` add
 * those CLIs; `COPILOT_CLI_VERSION` overrides the Copilot CLI version.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_IMAGE, imageSpec, specLabel } from "./lib/docker-sandbox.ts";
import { childEnv, REPO_ROOT, runProcess } from "./lib/workspace.ts";

// Pre-release identifiers may contain hyphens (`0.0.0-next-20260930190945`);
// nothing here can end a build argument or start a shell word.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function main(): Promise<void> {
  const spec = await imageSpec();
  for (const [name, v] of Object.entries({
    pnpm: spec.pnpm,
    copilot: spec.copilot,
    claude: spec.claude,
    codex: spec.codex,
    ...spec.deps,
  }))
    if (v !== undefined && !SEMVER.test(v))
      throw new Error(`${name} version must be an exact semver, got "${v}"`);
  const args = [
    "build",
    "--tag", AGENT_IMAGE,
    "--build-arg", `PNPM_VERSION=${spec.pnpm}`,
    "--build-arg", `COPILOT_CLI_VERSION=${spec.copilot}`,
    "--build-arg", `CLAUDE_CODE_VERSION=${spec.claude ?? ""}`,
    "--build-arg", `CODEX_VERSION=${spec.codex ?? ""}`,
    "--build-arg", `ZOD_VERSION=${spec.deps.zod}`,
    "--build-arg", `TYPESCRIPT_VERSION=${spec.deps.typescript}`,
    "--build-arg", `TYPES_NODE_VERSION=${spec.deps["@types/node"]}`,
    "--build-arg", `OPENAPI_TS_VERSION=${spec.deps["@hey-api/openapi-ts"]}`,
    "--build-arg", `SPEC_LABEL=${specLabel(spec)}`,
    "-",
  ];
  process.stdout.write(`Building ${AGENT_IMAGE} (no build context)\n${specLabel(spec)}\n`);
  const r = await runProcess("docker", args, {
    cwd: REPO_ROOT,
    env: childEnv(["DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_BUILDKIT"]),
    timeoutMs: 30 * 60_000,
    stdin: await readFile(join(REPO_ROOT, "evals", "Dockerfile"), "utf8"),
  });
  process.stdout.write(r.output.slice(-4000));
  if (r.exitCode !== 0) throw new Error(`docker build failed (exit ${r.exitCode})`);
  process.stdout.write(`\nBuilt ${AGENT_IMAGE}\n`);
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
