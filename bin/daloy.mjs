#!/usr/bin/env node
/**
 * `daloy` CLI shim. Real logic lives in `dist/cli.js` (`src/cli.ts`).
 *
 * TypeScript entry files are imported directly — Node.js >= 22.18 strips
 * erasable TypeScript syntax natively. If the native load fails (older
 * Node, non-erasable syntax such as enums, or extensionless relative
 * imports) we fall back to registering `tsx` when the consumer project has
 * it installed; otherwise we surface a friendly error.
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { runCli } from "../dist/cli.js";

const PKG = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
);

const TS_EXT = /\.(ts|tsx|mts|cts)$/i;

/**
 * Error codes that mean the host Node.js could not load a TypeScript file
 * natively — the cases where falling back to a transpiling loader (tsx)
 * can still succeed.
 */
const NATIVE_TS_ERROR_CODES = new Set([
  // Type stripping disabled (--no-strip-types) or Node too old.
  "ERR_UNKNOWN_FILE_EXTENSION",
  // Non-erasable syntax: enums, runtime namespaces, parameter properties.
  "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
  // Extensionless relative imports that native stripping refuses to resolve.
  "ERR_MODULE_NOT_FOUND",
]);

let tsxRegistered = false;
async function registerTsxFallback(specifier, cause) {
  try {
    const api = await import("tsx/esm/api");
    api.register();
    tsxRegistered = true;
  } catch {
    throw new Error(
      `Loading TypeScript entry "${specifier}" failed: ${cause?.message ?? cause}\n` +
        "Node.js runs erasable-only TypeScript natively (>= 22.18). If the entry uses " +
        "non-erasable syntax (enums, runtime namespaces, parameter properties) or " +
        "extensionless relative imports, install tsx (`pnpm add -D tsx`) and re-run.",
      { cause }
    );
  }
}

async function importEntry(specifier) {
  const abs = resolve(process.cwd(), specifier);
  if (!existsSync(abs)) {
    throw new Error(`Entry file not found: ${abs}`);
  }
  const href = pathToFileURL(abs).href;
  if (!TS_EXT.test(abs) || tsxRegistered) return import(href);
  try {
    return await import(href);
  } catch (err) {
    if (!NATIVE_TS_ERROR_CODES.has(err?.code)) throw err;
    await registerTsxFallback(abs, err);
    // Cache-bust so the retried load resolves through tsx's hooks instead of
    // the failed native module job. The first attempt failed before
    // evaluation, so no side effects ran twice.
    return import(`${href}?daloy-tsx-fallback=1`);
  }
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
                ? "Ensure Node.js is on PATH."
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
  readTextFile: (path) => readFile(resolve(process.cwd(), path), "utf8"),
});

process.exit(result.exitCode);
