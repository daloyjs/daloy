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