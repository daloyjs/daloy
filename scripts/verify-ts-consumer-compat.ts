/**
 * `pnpm verify:ts-consumer-compat` — proves `@daloyjs/core` still works in
 * apps that compile with TypeScript 6, while the framework itself is built
 * with TypeScript 7.
 *
 * Why this gate exists: TypeScript 6 is the last JavaScript-based compiler.
 * Tools that load `typescript` as a library (Vercel's Node builder, the stable
 * Hey API generator, much lint and codegen tooling) cannot move to the native
 * TypeScript 7 yet, so many apps stay on 6. Nothing else stops a future TS 7
 * feature in a public type, or a TS 7-only `.d.ts` emit shape, from silently
 * breaking those apps. The published package has no `typescript` peer
 * dependency, so the support promise lives here.
 *
 * Checks, all of which must pass:
 *
 *   1. TypeScript 6 type-checks the framework source and the type-level tests
 *      (`tsconfig.typetest.json`), so the `@ts-expect-error` assertions still
 *      fire and inferred types do not decay to `any` on TS 6.
 *   2. TypeScript 7 emits the declarations exactly as a release does
 *      (`tsconfig.build.json`) into `tmp/ts-consumer-compat/pkg`.
 *   3. A consumer fixture that imports every public subpath through the
 *      `exports` map, plus the type-level tests rewired to the built `.d.ts`,
 *      type-checks with `skipLibCheck: false` under TypeScript 6 for both
 *      `NodeNext` and `Bundler` resolution. TypeScript 7 runs the same fixture
 *      first as a control, so a broken fixture fails loudly instead of
 *      passing for the wrong reason.
 *
 * The TypeScript 6 compiler comes from the private `compat/typescript-6`
 * workspace package (a plain devDependency, not an `npm:` alias). Nothing is
 * downloaded at run time.
 *
 * Exit codes: 0 when every check passes, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = path.join(repoRoot, "tmp", "ts-consumer-compat");
const pkgDir = path.join(workDir, "pkg");
const consumerDir = path.join(workDir, "consumer");

/** A located `tsc` entry point and the version it reports. */
interface Compiler {
  label: string;
  bin: string;
  version: string;
}

/**
 * Resolve the `tsc` script of the `typescript` package visible from `fromDir`.
 *
 * @throws {Error} when `typescript` is not installed there.
 */
function locateCompiler(label: string, fromDir: string): Compiler {
  const require = createRequire(path.join(fromDir, "package.json"));
  const manifestPath = require.resolve("typescript/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  const tscBin = manifest.bin.tsc;
  if (!tscBin) throw new Error(`${label}: typescript ${manifest.version} declares no tsc bin`);
  return { label, bin: path.join(path.dirname(manifestPath), tscBin), version: manifest.version };
}

/** Run `tsc` with `args`; returns whether it exited 0, echoing output on failure. */
function runTsc(compiler: Compiler, args: string[], what: string): boolean {
  const result = spawnSync(process.execPath, [compiler.bin, ...args], { cwd: repoRoot, encoding: "utf8" });
  const ok = result.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${compiler.label} ${compiler.version}: ${what}`);
  if (!ok) process.stdout.write(`${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}\n`);
  return ok;
}

/** Link `target` at `linkPath` as a directory junction (Windows) or symlink. */
function linkDir(target: string, linkPath: string): void {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/** Build the consumer fixture against the declarations in `pkgDir`. */
function writeConsumerFixture(): void {
  const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(rootPkg, null, 2));
  linkDir(pkgDir, path.join(consumerDir, "node_modules", "@daloyjs", "core"));
  writeFileSync(path.join(consumerDir, "package.json"), JSON.stringify({ private: true, type: "module" }));

  const subpaths = Object.keys(rootPkg.exports).filter((key) => !key.endsWith(".json"));
  const imports = subpaths.map((key, i) => {
    const specifier = key === "." ? "@daloyjs/core" : `@daloyjs/core${key.slice(1)}`;
    return `import * as m${i} from "${specifier}";\nvoid m${i};`;
  });
  writeFileSync(path.join(consumerDir, "all-subpaths.ts"), `${imports.join("\n")}\nexport {};\n`);

  // Re-point the type-level tests from `src/` at the built declarations, so
  // they assert against exactly what a TypeScript 6 app would see.
  const typesSrc = path.join(repoRoot, "tests", "types");
  const typesDst = path.join(consumerDir, "types");
  cpSync(typesSrc, typesDst, { recursive: true });
  const rewrite = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        rewrite(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const up = "../".repeat(depth);
      const pattern = new RegExp(`(["'])${up.replaceAll(".", "\\.")}src/([^"']+?)\\.(?:js|ts)\\1`, "g");
      const rel = `${"../".repeat(depth - 1)}../pkg/dist/`;
      writeFileSync(full, readFileSync(full, "utf8").replace(pattern, (_m, q: string, p: string) => `${q}${rel}${p}.js${q}`));
    }
  };
  // tests/types/*.ts reach src via ../../src; fixtures/ one level deeper.
  rewrite(typesDst, 2);

  const base = {
    target: "ES2022",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    types: ["node"],
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: false,
    noEmit: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
  };
  const include = ["all-subpaths.ts", "types/**/*.ts"];
  writeFileSync(
    path.join(consumerDir, "tsconfig.nodenext.json"),
    JSON.stringify({ compilerOptions: { ...base, module: "NodeNext", moduleResolution: "NodeNext" }, include }, null, 2)
  );
  writeFileSync(
    path.join(consumerDir, "tsconfig.bundler.json"),
    JSON.stringify({ compilerOptions: { ...base, module: "ESNext", moduleResolution: "Bundler" }, include }, null, 2)
  );
}

function main(): number {
  const ts7 = locateCompiler("TypeScript", repoRoot);
  const ts6 = locateCompiler("TypeScript", path.join(repoRoot, "compat", "typescript-6"));
  if (!ts7.version.startsWith("7.")) throw new Error(`expected TypeScript 7 at the root, found ${ts7.version}`);
  if (!ts6.version.startsWith("6.")) throw new Error(`expected TypeScript 6 in compat/typescript-6, found ${ts6.version}`);

  let ok = runTsc(ts6, ["-p", "tsconfig.typetest.json", "--noEmit"], "framework source + type-level tests");

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(consumerDir, { recursive: true });
  const built = runTsc(
    ts7,
    ["-p", "tsconfig.build.json", "--outDir", path.join(pkgDir, "dist"), "--emitDeclarationOnly"],
    "emit release declarations"
  );
  if (!built || !existsSync(path.join(pkgDir, "dist", "index.d.ts"))) return 1;

  writeConsumerFixture();
  for (const config of ["tsconfig.nodenext.json", "tsconfig.bundler.json"]) {
    const project = path.join(consumerDir, config);
    const control = runTsc(ts7, ["-p", project], `consumer fixture control (${config})`);
    if (!control) return 1;
    ok = runTsc(ts6, ["-p", project], `consumer of TS 7-emitted .d.ts (${config})`) && ok;
  }

  console.log(
    ok
      ? "verify-ts-consumer-compat: apps on TypeScript 6 can consume @daloyjs/core."
      : "verify-ts-consumer-compat: FAILED. A public type or .d.ts shape no longer works on TypeScript 6."
  );
  return ok ? 0 : 1;
}

process.exitCode = main();
