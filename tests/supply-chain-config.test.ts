import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findForbiddenLockfileSources } from "../scripts/verify-lockfile-sources.ts";

async function readWorkspaceFile(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("root npmrc blocks install-time supply-chain attack paths", async () => {
  const npmrc = await readWorkspaceFile(".npmrc");

  assert.match(npmrc, /^ignore-scripts=true$/m);
  assert.match(npmrc, /^minimum-release-age=1440$/m);
  assert.match(npmrc, /^verify-store-integrity=true$/m);
  assert.match(npmrc, /^frozen-lockfile=true$/m);
  assert.match(npmrc, /^strict-peer-dependencies=true$/m);
  assert.match(npmrc, /^provenance=true$/m);
});

test("workspace allowlists dependency build scripts explicitly", async () => {
  const packageJson = JSON.parse(await readWorkspaceFile("package.json"));

  assert.equal(packageJson.scripts["verify:lockfile"], "node --import tsx scripts/verify-lockfile-sources.ts");
  assert.deepEqual(packageJson.pnpm.onlyBuiltDependencies, ["esbuild"]);
  assert.deepEqual(packageJson.pnpm.neverBuiltDependencies, []);
});

test("pnpm-workspace.yaml enables pnpm 11 supply-chain controls", async () => {
  const workspace = await readWorkspaceFile("pnpm-workspace.yaml");

  // 24h release-age cooldown — blocks freshly published malicious versions.
  assert.match(workspace, /^minimumReleaseAge:\s*1440$/m);

  // Transitive deps must not pull from git or arbitrary tarball URLs.
  assert.match(workspace, /^blockExoticSubdeps:\s*true$/m);

  // Refuse to install dependencies with unreviewed install scripts.
  assert.match(workspace, /^strictDepBuilds:\s*true$/m);

  // Scripts must not run against a stale node_modules.
  assert.match(workspace, /^verifyDepsBeforeRun:\s*install$/m);

  // Explicit build allowlist — esbuild is the only package permitted to run
  // install scripts. Adding more requires a deliberate PR.
  assert.match(workspace, /^allowBuilds:\s*$/m);
  assert.match(workspace, /^\s{2}esbuild:\s*true$/m);
});

test("lockfile does not contain git or non-registry tarball dependency sources", async () => {
  const lockfile = await readWorkspaceFile("pnpm-lock.yaml");

  assert.deepEqual(findForbiddenLockfileSources(lockfile), []);
  assert.deepEqual(findForbiddenLockfileSources("specifier: github:owner/project"), [
    {
      line: 1,
      reason: "git dependency source",
      text: "specifier: github:owner/project",
    },
  ]);
  assert.deepEqual(findForbiddenLockfileSources("resolution: {tarball: https://example.com/pkg.tgz}"), [
    {
      line: 1,
      reason: "non-registry tarball source",
      text: "resolution: {tarball: https://example.com/pkg.tgz}",
    },
  ]);
});

test("ci workflow avoids privileged fork-pr and cache-poisoning patterns", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/ci.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /pnpm verify:lockfile/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
});

test("release workflow isolates npm publish permissions", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/release.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /environment:\s*\n\s+name:\s+\$\{\{ vars\.NPM_PUBLISH_ENVIRONMENT \|\| 'npm-publish' \}\}/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /pnpm publish --access public --no-git-checks --provenance/);
  assert.match(workflow, /egress-policy:\s*block/);
  assert.match(workflow, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*NODE_AUTH_TOKEN:/m);

  assert.doesNotMatch(workflow, /^\s*always-auth:/m);

  const verifyJob = workflow.match(/  verify:[\s\S]*?\n\n  publish-core:/)?.[0] ?? "";
  assert.doesNotMatch(verifyJob, /id-token:\s*write/);
});