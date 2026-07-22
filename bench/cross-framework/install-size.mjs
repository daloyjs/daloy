#!/usr/bin/env node
// Install size: walks each framework's package tree under node_modules and
// reports total file size + file count + direct + transitive dep count.
//
// Methodology: for each framework, we ask `pnpm why` / read its package.json
// to find its top-level package, then recursively sum every file under that
// package and its transitive deps (skipping symlinks-to-elsewhere and
// duplicated content via pnpm's content-addressable store).
//
// Workspace-linked packages (the local @daloyjs/core `link:../..`) are NOT
// walked: realpath resolves the link to the repository root, so a naive walk
// would count the entire repo (node_modules, website, .git, …) as "install
// size". Those roots are measured with `npm pack --dry-run --json` instead,
// which reports the publish footprint an npm consumer actually installs.
//
// Each framework is measured in two variants where applicable:
//   - "minimal"       = just the framework's core packages (router/runtime).
//   - "secure parity" = framework + the middleware needed to match Daloy's
//                       secure-by-default posture (helmet/secure-headers,
//                       CORS, rate-limit, HS256 JWT verify). Daloy ships
//                       those guards in `@daloyjs/core`, so its two rows
//                       are identical — that's the point.
//
// Usage:
//   node install-size.mjs
//   node install-size.mjs --only=daloy

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { resultsPath, ROOT, machineInfo, parseArgs, fmt } from "./lib/common.mjs";
import { c, summary, fail, metric, metricsLine } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",    variant: "minimal",       pkgs: ["@daloyjs/core"] },
  { name: "daloy",    variant: "secure parity", pkgs: ["@daloyjs/core"] },
  { name: "hono",     variant: "minimal",       pkgs: ["hono", "@hono/node-server"] },
  // hono's secure-headers / cors / jwt middleware live inside the `hono`
  // package itself (subpath imports), so the install footprint is the same.
  { name: "hono",     variant: "secure parity", pkgs: ["hono", "@hono/node-server"] },
  { name: "fastify",  variant: "minimal",       pkgs: ["fastify"] },
  { name: "fastify",  variant: "secure parity", pkgs: ["fastify", "@fastify/helmet", "@fastify/cors", "@fastify/rate-limit", "@fastify/jwt"] },
  { name: "express",  variant: "minimal",       pkgs: ["express"] },
  { name: "express",  variant: "secure parity", pkgs: ["express", "helmet", "cors", "express-rate-limit", "jsonwebtoken"] },
  { name: "koa",      variant: "minimal",       pkgs: ["koa", "@koa/router"] },
  { name: "koa",      variant: "secure parity", pkgs: ["koa", "@koa/router", "koa-helmet", "@koa/cors", "koa-ratelimit", "koa-jwt"] },
  { name: "nest",     variant: "minimal",       pkgs: ["@nestjs/core", "@nestjs/common", "@nestjs/platform-fastify"] },
  { name: "nest",     variant: "secure parity", pkgs: ["@nestjs/core", "@nestjs/common", "@nestjs/platform-fastify", "@fastify/helmet", "@fastify/cors", "@fastify/rate-limit", "@nestjs/jwt", "@nestjs/throttler"] },
  { name: "elysia",   variant: "minimal",       pkgs: ["elysia", "@elysiajs/node"] },
  { name: "elysia",   variant: "secure parity", pkgs: ["elysia", "@elysiajs/node", "@elysiajs/cors", "@elysiajs/jwt"] },
  // Feathers measured minimal-only — parity middleware (helmet/jwt/etc.)
  // for the koa transport wasn't installed in this folder; add a secure
  // variant when those deps land if you want it on the chart.
  { name: "feathers", variant: "minimal",       pkgs: ["@feathersjs/feathers", "@feathersjs/koa"] },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;

function label(fw) {
  return fw.variant ? `${fw.name} (${fw.variant})` : fw.name;
}

function findPackageRoot(pkgName) {
  // Look in this folder's node_modules.
  const direct = path.join(ROOT, "node_modules", pkgName);
  if (existsSync(direct)) return realpathSync(direct);
  return null;
}

// Everything installed from the registry realpaths into this folder's
// node_modules (pnpm's .pnpm store lives under it). A `link:`/`workspace:`
// package realpaths OUTSIDE it — walking that directory would measure the
// whole source repository, not an install.
const NODE_MODULES_REAL = realpathSync(path.join(ROOT, "node_modules")) + path.sep;
function isWorkspaceLink(pkgRoot) {
  return !pkgRoot.startsWith(NODE_MODULES_REAL);
}

// Measure a workspace-linked package by its publish footprint: what `npm
// pack` would ship (honors the "files" allowlist), i.e. what a registry
// consumer actually installs. --ignore-scripts keeps this hermetic — the
// bench flow builds dist/ via prepare-daloy.mjs before this script runs.
function measurePacked(pkgRoot) {
  // Static command string via execSync: npm is `npm.cmd` on Windows, which
  // Node refuses to execFileSync without a shell (and shell+args triggers
  // DEP0190). No user input is interpolated.
  const out = execSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: pkgRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  // npm's --json shape varies by version: an array of entries, or an object
  // keyed by package name.
  const parsed = JSON.parse(out);
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!info?.unpackedSize) throw new Error(`unexpected npm pack --json output in ${pkgRoot}`);
  return { bytes: info.unpackedSize, files: info.entryCount ?? info.files?.length ?? 0, tarballBytes: info.size };
}

// pnpm-aware: resolve a dependency from a specific parent package's location
// by walking Node's module resolution from that location. This correctly
// finds deps under node_modules/.pnpm/<pkg>@<ver>/node_modules/ which are
// not hoisted to top-level.
function resolveDepFrom(parentPkgRoot, depName) {
  try {
    const req = createRequire(path.join(parentPkgRoot, "package.json"));
    // Resolve the dep's package.json — works even when the dep has no main.
    const pkgJsonPath = req.resolve(`${depName}/package.json`);
    return realpathSync(path.dirname(pkgJsonPath));
  } catch {
    return null;
  }
}

function walkSize(dir, seen = new Set()) {
  let bytes = 0;
  let files = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return { bytes, files }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    let real;
    try { real = realpathSync(p); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    let st;
    try { st = statSync(real); } catch { continue; }
    if (st.isDirectory()) {
      const sub = walkSize(real, seen);
      bytes += sub.bytes;
      files += sub.files;
    } else if (st.isFile()) {
      bytes += st.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function collectDeps(pkgRoot, allDeps = new Map(), depth = 0) {
  if (depth > 50) return allDeps; // safety bound
  let pkg;
  try { pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")); }
  catch { return allDeps; }
  // Skip optional peer deps: npm/pnpm don't install them automatically, so
  // counting them inflates the footprint for consumers who don't opt in.
  const peerMeta = pkg.peerDependenciesMeta ?? {};
  const requiredPeers = Object.fromEntries(
    Object.entries(pkg.peerDependencies ?? {}).filter(([n]) => !peerMeta[n]?.optional),
  );
  const deps = { ...(pkg.dependencies ?? {}), ...requiredPeers };
  for (const name of Object.keys(deps)) {
    if (allDeps.has(name)) continue;
    // Resolve from THIS package's location so pnpm's .pnpm/ store is walked.
    const candidate = resolveDepFrom(pkgRoot, name);
    if (!candidate) continue; // peer dep not installed in this workspace
    allDeps.set(name, candidate);
    collectDeps(candidate, allDeps, depth + 1);
  }
  return allDeps;
}

function measure(pkgNames) {
  // Resolve every root package and union their transitive dep sets.
  const roots = [];
  for (const name of pkgNames) {
    const root = findPackageRoot(name);
    if (!root) throw new Error(`package ${name} not found under ${ROOT}/node_modules`);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    roots.push({ name, root, version: pkg.version, directDeps: Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }) });
  }
  const transitive = new Map();
  for (const r of roots) collectDeps(r.root, transitive);
  // The root packages themselves are not "transitive" — remove them if a
  // root happens to also appear as another root's dep.
  for (const r of roots) transitive.delete(r.name);

  // Single shared `seen` across all walks so pnpm-hardlinked content isn't
  // double-counted between roots, between deps, or between the two.
  const seen = new Set();
  let ownBytes = 0;
  let ownFiles = 0;
  let tarballBytes = null;
  let packedRoots = false;
  for (const r of roots) {
    if (isWorkspaceLink(r.root)) {
      // link:/workspace: package — realpath escapes node_modules, so walking
      // it would count the whole source repo. Use the publish footprint.
      const p = measurePacked(r.root);
      ownBytes += p.bytes;
      ownFiles += p.files;
      tarballBytes = (tarballBytes ?? 0) + p.tarballBytes;
      packedRoots = true;
      continue;
    }
    const w = walkSize(r.root, seen);
    ownBytes += w.bytes;
    ownFiles += w.files;
  }
  let totalBytes = ownBytes;
  let totalFiles = ownFiles;
  for (const depRoot of transitive.values()) {
    const w = walkSize(depRoot, seen);
    totalBytes += w.bytes;
    totalFiles += w.files;
  }

  // Direct deps reported = union of every root's direct deps, minus the
  // roots themselves (a parity package isn't a "transitive dep" of itself).
  const rootNames = new Set(roots.map((r) => r.name));
  const directDeps = new Set();
  for (const r of roots) for (const d of r.directDeps) if (!rootNames.has(d)) directDeps.add(d);

  return {
    pkgs: pkgNames,
    version: roots[0].version, // primary package's version
    ownBytes,
    ownFiles,
    totalBytes,
    totalFiles,
    directDepCount: directDeps.size,
    transitiveDepCount: transitive.size,
    // True when any root was a workspace link measured via `npm pack`
    // (publish footprint) rather than a node_modules walk.
    measuredViaPack: packedRoots,
    tarballBytes,
  };
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const r = measure(fw.pkgs);
      rows.push({ framework: fw.name, variant: fw.variant ?? null, ...r });
      console.error(metricsLine(label(fw), [
        c.dim(`v${r.version}`),
        metric("own", `${(r.ownBytes / 1024).toFixed(1)} KiB / ${r.ownFiles} files`),
        metric("total", `${(r.totalBytes / 1024).toFixed(1)} KiB / ${r.totalFiles} files`, { color: c.cyan }),
        metric("deps", `${r.directDepCount} direct / ${r.transitiveDepCount} transitive`),
        r.measuredViaPack ? c.dim("(npm pack)") : "",
      ].filter(Boolean), { labelWidth: 24 }));
    } catch (err) {
      console.error("  " + fail(`${label(fw)}: ${err.message}`));
      rows.push({ framework: fw.name, variant: fw.variant ?? null, error: err.message });
    }
  }

  const tableRows = [];
  for (const r of rows) {
    if (!r.totalBytes) continue;
    const name = r.variant ? `${r.framework} (${r.variant})` : r.framework;
    tableRows.push([
      name,
      fmt(r.ownBytes / 1024),
      fmt(r.ownFiles),
      fmt(r.totalBytes / 1024),
      fmt(r.totalFiles),
      fmt(r.directDepCount),
      fmt(r.transitiveDepCount),
    ]);
  }
  const notes = [
    "",
    "Notes:",
    "  - \"minimal\"       = framework's core packages only (router/runtime).",
    "  - \"secure parity\" = framework + middleware needed to match Daloy's",
    "                       secure-by-default posture (helmet/secure-headers,",
    "                       CORS, rate-limit, HS256 JWT verify).",
    "    Daloy's two rows are identical because those guards ship in",
    "    `@daloyjs/core` — zero extra packages. Hono's two rows are also",
    "    identical because its middleware lives inside the `hono` package",
    "    via subpath imports. Every other framework's footprint grows.",
    "    Compare the secure-parity rows for an apples-to-apples number.",
    "  - Optional peer deps (e.g. NestJS's class-validator, class-transformer,",
    "    websockets, microservices) are skipped — pnpm/npm don't install them",
    "    automatically and a minimal app doesn't pull them in.",
  ];
  console.log("\n" + summary({
    head: ["Framework", "own (KiB)", "own files", "total (KiB)", "total files", "direct deps", "transitive deps"],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n" + c.dim(notes.join("\n")) + "\n");

  writeFileSync(
    resultsPath("results.install-size.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), machine: machineInfo(), rows }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
