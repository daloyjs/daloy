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

const result = await runCli(process.argv.slice(2), {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
  importEntry,
  version: PKG.version,
});

process.exit(result.exitCode);
