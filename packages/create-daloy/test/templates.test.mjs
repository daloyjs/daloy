import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

test("node-basic health route preserves literal true type", async () => {
  const source = await readFile(path.join(pkgRoot, "templates/node-basic/src/index.ts"), "utf8");
  assert.match(source, /body:\s*\{ ok: true as const, uptime: process\.uptime\(\) \}/);
});

test("vercel-edge health route preserves literal true type", async () => {
  const source = await readFile(path.join(pkgRoot, "templates/vercel-edge/api/[...path].ts"), "utf8");
  assert.match(source, /body:\s*\{ ok: true as const, runtime: "vercel-edge" as const \}/);
});

test("node-basic template exposes /docs and /openapi.json", async () => {
  const source = await readFile(path.join(pkgRoot, "templates/node-basic/src/index.ts"), "utf8");
  assert.match(source, /path:\s*"\/docs"/);
  assert.match(source, /path:\s*"\/openapi\.json"/);
  assert.match(source, /swaggerUiHtml\(/);
  assert.match(source, /generateOpenAPI\(app/);
});

test("vercel-edge template exposes /docs and /openapi.json", async () => {
  const source = await readFile(path.join(pkgRoot, "templates/vercel-edge/api/[...path].ts"), "utf8");
  assert.match(source, /path:\s*"\/docs"/);
  assert.match(source, /path:\s*"\/openapi\.json"/);
  assert.match(source, /swaggerUiHtml\(/);
  assert.match(source, /generateOpenAPI\(app/);
});

test("pnpm templates ship hardened supply-chain .npmrc defaults", async () => {
  const templates = ["node-basic", "vercel-edge", "cloudflare-worker"];

  for (const template of templates) {
    const source = await readFile(path.join(pkgRoot, "templates", template, "_npmrc"), "utf8");
    assert.match(source, /^ignore-scripts=true$/m, `${template} should block dependency lifecycle scripts`);
    assert.match(source, /^minimum-release-age=1440$/m, `${template} should wait 24h before fresh package installs`);
    assert.match(source, /^verify-store-integrity=true$/m, `${template} should verify pnpm store integrity`);
    assert.match(source, /^prefer-frozen-lockfile=true$/m, `${template} should prefer reproducible installs`);
    assert.match(source, /^strict-peer-dependencies=true$/m, `${template} should fail closed on peer dependency drift`);
  }
});

test("pnpm scaffolds keep hardened .npmrc", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pnpm-secure";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [path.join(pkgRoot, "bin/create-daloy.mjs"), projectName, "--template", "node-basic", "--package-manager", "pnpm", "--no-install", "--no-git", "--yes"],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const npmrc = await readFile(path.join(tmpDir, projectName, ".npmrc"), "utf8");
    assert.match(npmrc, /^ignore-scripts=true$/m);
    assert.match(npmrc, /^minimum-release-age=1440$/m);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("non-pnpm scaffolds do not keep pnpm-specific .npmrc", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "npm-clean";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [path.join(pkgRoot, "bin/create-daloy.mjs"), projectName, "--template", "vercel-edge", "--package-manager", "npm", "--no-install", "--no-git", "--yes"],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    await assert.rejects(access(path.join(tmpDir, projectName, ".npmrc")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});