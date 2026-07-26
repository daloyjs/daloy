/**
 * Pre-publish "invisible Unicode" gate.
 *
 * Scans every file that the `files` whitelist of a publishable package would
 * include in its npm tarball — plus the in-repo source roots (`src/`,
 * `scripts/`, `bin/`, `examples/`, `packages/create-daloy/{bin,templates}`)
 * — and refuses to publish if any source file contains a character from a
 * class that is known to hide arbitrary executable payloads from human code
 * review:
 *
 *  - **Unicode Tag characters** (U+E0000–U+E007F). The GlassWorm family of
 *    npm / VS Code supply-chain worms encodes ASCII payloads inside these
 *    code points, then `eval()`s them at runtime. The chars render as
 *    nothing in every editor, every diff viewer, and every PR review UI.
 *    First disclosed by Aikido Security in March 2025 and again in March
 *    2026 (151+ GitHub repos and npm packages compromised, see
 *    <https://www.aikido.dev/blog/glassworm-strikes-react-packages-phone-numbers>
 *    and
 *    <https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode>).
 *  - **Zero-width characters** mid-stream: U+200B (ZWSP), U+200C (ZWNJ),
 *    U+200D (ZWJ), U+2060 (WJ), and U+FEFF (BOM) when it appears anywhere
 *    other than the very first code point of the file. Used to smuggle
 *    homoglyph identifier tricks ("Trojan source") past code review.
 *  - **Bidi-override controls**: U+202A–U+202E and U+2066–U+2069. The
 *    Trojan Source class (<https://trojansource.codes>) hides reordering
 *    that makes source read differently than it executes.
 *  - **Private Use Area** code points in `src/`-style source code:
 *    U+E000–U+F8FF, U+F0000–U+FFFFD, and U+100000–U+10FFFD. PUA characters
 *    have no defined meaning, render as `.notdef` boxes in safe editors
 *    and as nothing in many code-review UIs, and are the exact range
 *    Aikido's first GlassWorm write-up identified as the carrier. We
 *    only forbid these in publishable code paths (excluding `tests/`,
 *    which may legitimately exercise the scanner with literal samples).
 *
 * Exit codes:
 *   0 — no invisible / suspicious Unicode found.
 *   1 — at least one finding; offending paths/lines printed to stderr.
 *
 * @since 0.34.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";

const REPO_ROOT = process.cwd();

/** Publishable packages whose tarball contents must be scanned. */
export interface PublishablePackage {
  readonly name: string;
  /** Directory containing the `package.json`, relative to the repo root. */
  readonly packageDir: string;
}

export const PUBLISHABLE_PACKAGES: readonly PublishablePackage[] = [
  { name: "@daloyjs/core", packageDir: "." },
  { name: "create-daloy", packageDir: "packages/create-daloy" },
];

/**
 * In-repo source roots scanned IN ADDITION to the publishable tarball
 * contents. Catches a malicious commit sitting in `src/` long before
 * `pnpm build` would propagate it into `dist/`. Paths are relative to the
 * repository root.
 */
export const ADDITIONAL_SOURCE_ROOTS: readonly string[] = [
  "src",
  "scripts",
  "bin",
  "examples",
  "packages/create-daloy/bin",
  "packages/create-daloy/templates",
];

/**
 * Categories of forbidden code points. Each entry's `test` returns `true`
 * when the supplied code point is forbidden. The `name` is included in
 * findings so that humans reading the gate output can immediately tell
 * which class of attack triggered the alert.
 */
export interface ForbiddenClass {
  readonly name: string;
  readonly test: (cp: number) => boolean;
}

export const FORBIDDEN_CLASSES: readonly ForbiddenClass[] = Object.freeze([
  {
    name: "Unicode Tag character (GlassWorm carrier, U+E0000–U+E007F)",
    test: (cp) => cp >= 0xe0000 && cp <= 0xe007f,
  },
  {
    name: "Zero-width / word-joiner character (U+200B/U+200C/U+200D/U+2060)",
    test: (cp) => cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060,
  },
  {
    name: "Bidi override control (Trojan Source, U+202A–U+202E/U+2066–U+2069)",
    test: (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069),
  },
]);

/**
 * Private Use Area ranges. Only enforced inside `forbidPuaIn` paths
 * (publishable packages + the in-repo source roots). NOT enforced on the
 * scanner itself recognising literal samples, because PUA is sometimes
 * used by typographic fixtures.
 */
export const PUA_RANGES: readonly { name: string; low: number; high: number }[] = Object.freeze([
  { name: "Private Use Area (BMP, U+E000–U+F8FF)", low: 0xe000, high: 0xf8ff },
  {
    name: "Supplementary Private Use Area-A (U+F0000–U+FFFFD)",
    low: 0xf0000,
    high: 0xffffd,
  },
  {
    name: "Supplementary Private Use Area-B (U+100000–U+10FFFD)",
    low: 0x100000,
    high: 0x10fffd,
  },
]);

/**
 * Binary file extensions skipped by the content scanner. Same list as
 * `verify-no-leaked-credentials.ts` so the two gates have identical
 * coverage of the published tarball.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".gz",
  ".tgz",
  ".br",
]);

export interface InvisibleUnicodeFinding {
  readonly source: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly codePoint: number;
  readonly detail: string;
}

function isBinary(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Scan a single file's text for forbidden code points. Returns one
 * finding per offending code point so that humans can see exactly where
 * the carrier was hidden (line + column).
 *
 * @param source - Decoded UTF-8 text of the file.
 * @param scanPua - When true, also reject Private Use Area code points.
 *   Reserved for publishable / executable source roots.
 */
export function scanFileForInvisibleUnicode(
  source: string,
  scanPua: boolean
): readonly { line: number; column: number; codePoint: number; detail: string }[] {
  const out: { line: number; column: number; codePoint: number; detail: string }[] = [];
  let line = 1;
  let column = 0;
  let offset = 0;
  for (const ch of source) {
    const cp = ch.codePointAt(0)!;
    column += 1;
    if (ch === "\n") {
      line += 1;
      column = 0;
      offset += ch.length;
      continue;
    }
    // BOM is only allowed at offset 0.
    if (cp === 0xfeff && offset !== 0) {
      out.push({
        line,
        column,
        codePoint: cp,
        detail: "byte-order mark (U+FEFF) not at file start",
      });
      offset += ch.length;
      continue;
    }
    for (const klass of FORBIDDEN_CLASSES) {
      if (klass.test(cp)) {
        out.push({ line, column, codePoint: cp, detail: klass.name });
        break;
      }
    }
    if (scanPua) {
      for (const range of PUA_RANGES) {
        if (cp >= range.low && cp <= range.high) {
          out.push({ line, column, codePoint: cp, detail: range.name });
          break;
        }
      }
    }
    offset += ch.length;
  }
  return out;
}

async function* walk(root: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const p = join(root, ent.name);
    if (ent.isDirectory()) {
      yield* walk(p);
    } else if (ent.isFile()) {
      yield p;
    }
  }
}

async function* resolveFilesEntry(pkgDir: string, entry: string): AsyncIterable<string> {
  const abs = resolve(pkgDir, entry);
  let s;
  try {
    s = await stat(abs);
  } catch {
    return;
  }
  if (s.isDirectory()) {
    yield* walk(abs);
  } else if (s.isFile()) {
    yield abs;
  }
}

async function scanOnePath(
  sourceLabel: string,
  baseDir: string,
  file: string,
  scanPua: boolean,
  findings: InvisibleUnicodeFinding[]
): Promise<void> {
  const rel = posix.normalize(relative(baseDir, file).split(/[\\/]/g).join("/"));
  if (isBinary(rel)) return;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return; // unreadable or non-UTF-8 — treated as binary
  }
  for (const hit of scanFileForInvisibleUnicode(text, scanPua)) {
    findings.push({
      source: sourceLabel,
      file: rel,
      line: hit.line,
      column: hit.column,
      codePoint: hit.codePoint,
      detail: hit.detail,
    });
  }
}

/**
 * Scan the published tarball contents of a single publishable package
 * (the `package.json#files` whitelist, walked recursively for
 * directories). Mirrors {@link findCredentialLeaks} so that the two
 * publish-time gates share an identical view of "what gets shipped".
 */
export async function findInvisibleUnicodeInPackage(
  pkg: PublishablePackage,
  rootDir: string = REPO_ROOT
): Promise<readonly InvisibleUnicodeFinding[]> {
  const pkgDir = resolve(rootDir, pkg.packageDir);
  const pkgJsonPath = join(pkgDir, "package.json");
  let pkgJsonText: string;
  try {
    pkgJsonText = await readFile(pkgJsonPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${pkgJsonPath}: ${(err as Error).message}`);
  }
  const manifest = JSON.parse(pkgJsonText) as { files?: unknown };
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${pkg.name}: package.json must declare a non-empty "files" whitelist`);
  }

  const findings: InvisibleUnicodeFinding[] = [];
  // The manifest itself ships with the tarball.
  await scanOnePath(pkg.name, pkgDir, pkgJsonPath, true, findings);
  for (const entry of manifest.files as readonly unknown[]) {
    if (typeof entry !== "string") continue;
    for await (const file of resolveFilesEntry(pkgDir, entry)) {
      await scanOnePath(pkg.name, pkgDir, file, true, findings);
    }
  }
  return findings;
}

/**
 * Scan an in-repo source root (e.g. `src/`) for invisible Unicode.
 * Returns one finding per offending code point.
 */
export async function findInvisibleUnicodeInSourceRoot(
  sourceRoot: string,
  rootDir: string = REPO_ROOT
): Promise<readonly InvisibleUnicodeFinding[]> {
  const baseDir = resolve(rootDir, sourceRoot);
  const findings: InvisibleUnicodeFinding[] = [];
  for await (const file of walk(baseDir)) {
    await scanOnePath(sourceRoot, baseDir, file, true, findings);
  }
  return findings;
}

async function main(): Promise<void> {
  let total = 0;
  for (const pkg of PUBLISHABLE_PACKAGES) {
    let findings: readonly InvisibleUnicodeFinding[];
    try {
      findings = await findInvisibleUnicodeInPackage(pkg);
    } catch (err) {
      console.error(`verify-no-invisible-unicode: ${(err as Error).message}`);
      process.exitCode = 1;
      continue;
    }
    for (const f of findings) {
      const cp = "U+" + f.codePoint.toString(16).toUpperCase().padStart(4, "0");
      console.error(`${f.source} ${f.file}:${f.line}:${f.column}: ${f.detail} (${cp})`);
      total++;
    }
  }
  for (const root of ADDITIONAL_SOURCE_ROOTS) {
    const findings = await findInvisibleUnicodeInSourceRoot(root);
    for (const f of findings) {
      const cp = "U+" + f.codePoint.toString(16).toUpperCase().padStart(4, "0");
      console.error(`${f.source}/${f.file}:${f.line}:${f.column}: ${f.detail} (${cp})`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-invisible-unicode: ${total} invisible-Unicode finding${total === 1 ? "" : "s"} ` +
        "detected. Remove the carrier character(s) before release " +
        "(see https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode)."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-invisible-unicode.ts")) {
  await main();
}
