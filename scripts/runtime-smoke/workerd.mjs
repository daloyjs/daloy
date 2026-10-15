// workerd runner for the cross-runtime smoke suite (see ./shared.mjs).
//
//   node scripts/runtime-smoke/workerd.mjs <path-to-workerd-binary>
//
// Runs on Node: it stages ./worker.mjs plus every module it reaches in `dist/`
// into a temp dir, writes a workerd config that serves it on a free loopback
// port, starts workerd (the open-source Cloudflare Workers runtime), and runs
// the shared checks over HTTP. No bundler: each file is listed as an ES module
// so workerd resolves the same relative imports the published package uses.
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks } from "./shared.mjs";

// Matches the create-daloy cloudflare-worker template (no nodejs_compat flag).
const COMPATIBILITY_DATE = "2026-05-01";
const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const ENTRY = "scripts/runtime-smoke/worker.mjs";

const workerdBin = process.argv[2];
if (!workerdBin) {
  console.error(
    "usage: node scripts/runtime-smoke/workerd.mjs <path-to-workerd>",
  );
  process.exit(2);
}

/** Every repo-relative module reachable from `entry` through relative imports. */
function collectModules(entry) {
  // Static `import ... from` / `export ... from` start a line in tsc output;
  // dynamic `import("./x.js")` is followed unless the line is a comment, so
  // JSDoc `import("...")` type references are not mistaken for modules.
  const staticSpecifier =
    /^(?:import|export)\b[^"']*?(?:from\s*)?["'](\.{1,2}\/[^"']+)["']/gm;
  const dynamicSpecifier = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const specifiers = [...source.matchAll(staticSpecifier)].map((m) => m[1]);
    for (const line of source.split("\n")) {
      const trimmed = line.trimStart();
      if (
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      )
        continue;
      for (const match of line.matchAll(dynamicSpecifier))
        specifiers.push(match[1]);
    }
    for (const spec of specifiers) {
      queue.push(
        path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)),
      );
    }
  }
  return [...seen];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(baseUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`workerd exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("workerd did not start within 20s");
}

const stage = mkdtempSync(path.join(tmpdir(), "daloy-workerd-"));
let child;
let failed = false;
try {
  const modules = collectModules(ENTRY);
  for (const rel of modules) {
    mkdirSync(path.join(stage, path.posix.dirname(rel)), { recursive: true });
    writeFileSync(
      path.join(stage, rel),
      readFileSync(path.join(REPO_ROOT, rel)),
    );
  }
  // The entry module must come first: workerd treats it as the main module.
  const ordered = [ENTRY, ...modules.filter((m) => m !== ENTRY)];
  const port = await freePort();
  writeFileSync(
    path.join(stage, "config.capnp"),
    `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "main", worker = .smokeWorker) ],
  sockets = [ (name = "http", address = "127.0.0.1:${port}", http = (), service = "main") ],
);
const smokeWorker :Workerd.Worker = (
  modules = [
${ordered.map((m) => `    (name = "${m}", esModule = embed "${m}")`).join(",\n")}
  ],
  compatibilityDate = "${COMPATIBILITY_DATE}",
);
`,
  );

  child = spawn(workerdBin, ["serve", "config.capnp"], {
    cwd: stage,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilUp(baseUrl, child);
  const passed = await runChecks(baseUrl, { peer: "none" });
  console.log(
    `workerd: ${passed.length} checks passed (${passed.join(", ")}) over ${modules.length} modules`,
  );
} catch (err) {
  failed = true;
  console.error("workerd: smoke check failed:", err);
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  // Windows can hold the directory briefly after the process exits.
  rmSync(stage, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
process.exit(failed ? 1 : 0);
