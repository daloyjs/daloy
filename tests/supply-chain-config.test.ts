import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

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

  assert.deepEqual(packageJson.pnpm.onlyBuiltDependencies, ["esbuild"]);
  assert.deepEqual(packageJson.pnpm.neverBuiltDependencies, []);
  assert.equal(packageJson.pnpm.minimumReleaseAge, 1440);
});

test("ci workflow avoids privileged fork-pr and cache-poisoning patterns", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/ci.yml");

  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.doesNotMatch(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /step-security\/harden-runner@v2/);
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
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*NODE_AUTH_TOKEN:/m);

  assert.doesNotMatch(workflow, /^\s*always-auth:/m);

  const verifyJob = workflow.match(/  verify:[\s\S]*?\n\n  publish-core:/)?.[0] ?? "";
  assert.doesNotMatch(verifyJob, /id-token:\s*write/);
});