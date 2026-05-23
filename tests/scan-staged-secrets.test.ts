import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isForbiddenStagedFilename,
  scanOneStagedFile,
  scanStagedSecrets,
} from "../scripts/scan-staged-secrets.ts";
import { installPreCommitHook } from "../scripts/install-git-hooks.ts";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "daloy-scan-staged-"));
}

test("isForbiddenStagedFilename flags secret-shaped basenames", () => {
  assert.equal(isForbiddenStagedFilename(".env"), true);
  assert.equal(isForbiddenStagedFilename(".env.production"), true);
  assert.equal(isForbiddenStagedFilename("id_rsa"), true);
  assert.equal(isForbiddenStagedFilename("id_ed25519.pub"), true);
  assert.equal(isForbiddenStagedFilename("server.pem"), true);
  assert.equal(isForbiddenStagedFilename("api.key"), true);
  assert.equal(isForbiddenStagedFilename("credentials.json"), true);
  assert.equal(isForbiddenStagedFilename("service-account-prod.json"), true);
  assert.equal(isForbiddenStagedFilename(".netrc"), true);
});

test("isForbiddenStagedFilename allows .env.example / .env.sample / .env.template", () => {
  assert.equal(isForbiddenStagedFilename(".env.example"), false);
  assert.equal(isForbiddenStagedFilename(".env.sample"), false);
  assert.equal(isForbiddenStagedFilename(".env.template"), false);
});

test("isForbiddenStagedFilename allows ordinary source files", () => {
  assert.equal(isForbiddenStagedFilename("index.ts"), false);
  assert.equal(isForbiddenStagedFilename("README.md"), false);
  assert.equal(isForbiddenStagedFilename("package.json"), false);
  // .npmrc intentionally allowed — repo & templates commit a hardening one.
  assert.equal(isForbiddenStagedFilename(".npmrc"), false);
});

test("scanOneStagedFile flags an AWS access key id inside a staged source file", async () => {
  const dir = await fixture();
  // Split to avoid the literal pattern triggering this test file under
  // the gitleaks history sweep.
  const fake = "AKIA" + "ABCDEFGHIJKLMNOP";
  await writeFile(join(dir, "leaky.ts"), `export const k = "${fake}";\n`, "utf8");
  const findings = await scanOneStagedFile(dir, "leaky.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "content");
  assert.match(findings[0]!.detail, /AWS access key id/);
  assert.equal(findings[0]!.line, 1);
});

test("scanOneStagedFile flags a secret-shaped filename without reading bytes", async () => {
  const dir = await fixture();
  await writeFile(join(dir, ".env.production"), "PORT=3000\n", "utf8");
  const findings = await scanOneStagedFile(dir, ".env.production");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "filename");
  assert.match(findings[0]!.detail, /forbidden secret-shaped filename/);
});

test("scanOneStagedFile is clean on ordinary source", async () => {
  const dir = await fixture();
  await writeFile(
    join(dir, "ok.ts"),
    "export const greet = (name: string) => `hello, ${name}`;\n",
    "utf8",
  );
  const findings = await scanOneStagedFile(dir, "ok.ts");
  assert.deepEqual(findings, []);
});

test("scanOneStagedFile silently ignores a missing staged file (deleted after staging)", async () => {
  const dir = await fixture();
  const findings = await scanOneStagedFile(dir, "ghost.ts");
  assert.deepEqual(findings, []);
});

test("scanStagedSecrets returns [] when git is unavailable / not a checkout", async () => {
  const dir = await fixture();
  // Force the "git unavailable / not a checkout" branch by passing
  // staged=null explicitly. The CLI does the same when `git diff`
  // exits non-zero (e.g. a CI sandbox without git installed).
  const findings = await scanStagedSecrets(dir, null);
  assert.deepEqual(findings, []);
});

test("scanStagedSecrets aggregates findings across multiple staged files", async () => {
  const dir = await fixture();
  await writeFile(join(dir, "a.ts"), "// clean\n", "utf8");
  const fake = "AKIA" + "1234567890ABCDEF";
  await writeFile(join(dir, "b.ts"), `const k = "${fake}";\n`, "utf8");
  await writeFile(join(dir, ".env"), "DATABASE_URL=...\n", "utf8");
  const findings = await scanStagedSecrets(dir, ["a.ts", "b.ts", ".env"]);
  assert.equal(findings.length, 2);
  assert.ok(findings.some((f) => f.file === "b.ts" && f.kind === "content"));
  assert.ok(findings.some((f) => f.file === ".env" && f.kind === "filename"));
});

test("installPreCommitHook refuses to run outside a git checkout", () => {
  // mkdtemp gives a real path that is *not* a git checkout.
  const dir = tmpdir();
  // Use a fresh subdir so the user's tmp isn't accidentally a git dir.
  const cwd = resolve(dir, `daloy-no-git-${Date.now()}`);
  assert.throws(
    () => installPreCommitHook({ cwd, force: false }),
    /not a git checkout/,
  );
});

test("installPreCommitHook writes an executable pre-commit hook", async () => {
  const dir = await fixture();
  await mkdir(join(dir, ".git", "hooks"), { recursive: true });
  const r = installPreCommitHook({ cwd: dir, force: false });
  assert.equal(r.status, "installed");
  assert.ok(existsSync(r.hookPath));
  const body = readFileSync(r.hookPath, "utf8");
  assert.match(body, /daloyjs-pre-commit-secrets-hook/);
  assert.match(body, /scan:staged-secrets/);
});

test("installPreCommitHook refuses to overwrite a foreign hook without --force", async () => {
  const dir = await fixture();
  const hooksDir = join(dir, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const r = installPreCommitHook({ cwd: dir, force: false });
  assert.equal(r.status, "refused-existing");
  // Original hook is preserved.
  assert.equal(readFileSync(hookPath, "utf8"), "#!/bin/sh\nexit 0\n");
});

test("installPreCommitHook --force overwrites a foreign hook", async () => {
  const dir = await fixture();
  const hooksDir = join(dir, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const r = installPreCommitHook({ cwd: dir, force: true });
  assert.equal(r.status, "installed");
  assert.match(readFileSync(hookPath, "utf8"), /daloyjs-pre-commit-secrets-hook/);
});

test("installPreCommitHook re-running on its own hook reports already-installed (idempotent)", async () => {
  const dir = await fixture();
  await mkdir(join(dir, ".git", "hooks"), { recursive: true });
  installPreCommitHook({ cwd: dir, force: false });
  const r2 = installPreCommitHook({ cwd: dir, force: false });
  assert.equal(r2.status, "already-installed");
});

test("installPreCommitHook understands a `.git` file written by git worktree", async () => {
  const dir = await fixture();
  // Create the real gitdir elsewhere.
  const realGitDir = await mkdtemp(join(tmpdir(), "daloy-worktree-gitdir-"));
  await mkdir(join(realGitDir, "hooks"), { recursive: true });
  // Write the `.git` file pointing at it.
  await writeFile(join(dir, ".git"), `gitdir: ${realGitDir}\n`, "utf8");
  const r = installPreCommitHook({ cwd: dir, force: false });
  assert.equal(r.status, "installed");
  assert.equal(r.hookPath, resolve(realGitDir, "hooks", "pre-commit"));
});
