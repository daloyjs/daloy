#!/usr/bin/env node
/**
 * `daloy` CLI shim. Real logic lives in `dist/cli.js` (`src/cli.ts`).
 *
 * For TypeScript entry files we try to register `tsx` if it's installed
 * in the consumer project; otherwise we surface a friendly error pointing
 * users at `node --import tsx`.
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { runCli } from "../dist/cli.js";

const PKG = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
);

const TS_EXT = /\.(ts|tsx|mts|cts)$/i;

let tsxRegistered = false;
async function ensureTsxIfNeeded(specifier) {
  if (!TS_EXT.test(specifier) || tsxRegistered) return;
  try {
    const api = await import("tsx/esm/api");
    api.register();
    tsxRegistered = true;
  } catch {
    throw new Error(
      `Loading TypeScript entry "${specifier}" requires tsx. Install it ` +
        `(\`pnpm add -D tsx\`) or run: node --import tsx ./node_modules/.bin/daloy inspect ${specifier}`
    );
  }
}

async function importEntry(specifier) {
  const abs = resolve(process.cwd(), specifier);
  if (!existsSync(abs)) {
    throw new Error(`Entry file not found: ${abs}`);
  }
  await ensureTsxIfNeeded(abs);
  return import(pathToFileURL(abs).href);
}

function spawnDev(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    const forward = (sig) => {
      try {
        child.kill(sig);
      } catch {
        /* ignore */
      }
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        reject(
          new Error(
            `\`${command}\` was not found on PATH. ` +
              (command === "node"
                ? "Install `tsx` as a dev dependency (`pnpm add -D tsx`) and ensure Node.js is on PATH."
                : `Install ${command} or run daloy dev from the runtime that hosts it.`)
          )
        );
        return;
      }
      reject(err);
    });
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolvePromise(signal ? 1 : (code ?? 0));
    });
  });
}

const result = await runCli(process.argv.slice(2), {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
  importEntry,
  version: PKG.version,
  spawn: spawnDev,
});

process.exit(result.exitCode);
