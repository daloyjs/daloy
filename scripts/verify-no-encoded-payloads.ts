/**
 * Encoded-payload obfuscation CI gate (Socket "Obfuscation 101" defense).
 *
 * Socket's 2025-03-28 write-up
 * (https://socket.dev/blog/obfuscation-101-the-tricks-behind-malicious-code)
 * catalogues the obfuscation tricks malicious open-source packages use
 * to slip past human code review and static scanners. Daloy already
 * blocks the *executable* primitives those payloads need to actually
 * run (`scripts/verify-no-remote-exec.ts` for `eval` / `new Function` /
 * `child_process` / `vm` / remote dynamic imports;
 * `scripts/verify-no-invisible-unicode.ts` for GlassWorm-class invisible
 * Unicode / Trojan-Source carriers; `scripts/verify-no-lifecycle-scripts.ts`
 * for install-time payloads; `scripts/verify-no-registry-exfiltration.ts`
 * for the exfil primitives that ship the loot home). This gate closes
 * the remaining visible-but-unreadable carrier surface — string
 * literals whose contents have been encoded *specifically* so a
 * reviewer cannot read the URL / command / shell snippet hidden in
 * them:
 *
 *   1. Long runs of `\x..` hex escapes inside a single string literal
 *      (the article's example #1, e.g.
 *      `"\x68\x74\x74\x70\x73\x3a\x2f\x2fexample[.]com"`). Four or
 *      more consecutive `\xXX` escapes encoding printable ASCII have
 *      no legitimate reason to appear in TypeScript source — a real
 *      URL or command string would be written literally. Test fixtures
 *      that legitimately exercise this gate live under `tests/` and
 *      are excluded from the scan.
 *
 *   2. Long runs of `\u00XX` (or `\u{0000XX}`) escapes encoding
 *      printable ASCII inside a single string literal. Same class of
 *      attack as #1, just spelled with the Unicode escape syntax.
 *
 *   3. Opaque base64 / base64url blobs of `>= 200` characters inside a
 *      single string literal with no whitespace. This is the carrier
 *      shape used by the article's PyPI `capmostercloudclinet` example
 *      (`exec(Fernet(b'...').decrypt(b'gAAAAABm...'))`) — a giant
 *      opaque blob handed straight to a decryptor + executor. A real
 *      framework's source has no business shipping a 200+ char opaque
 *      base64 literal; if you genuinely need one (e.g. a test vector),
 *      put it under `tests/` where this gate does not run.
 *
 * Why these limits don't cause false positives in Daloy's tree:
 *   - Real URLs, JSON keys, error messages, and CSP directives are
 *     written as plain text, so they never match #1 / #2.
 *   - Daloy ships no embedded binary assets, no compiled WASM blobs,
 *     and no precomputed crypto material in `src/**`. Hashes and JWKs
 *     that *do* legitimately live in source are well below the 200-char
 *     threshold of #3 and/or contain non-base64 punctuation (`.` in
 *     JWTs, `{}` in JWKs).
 *   - SBOM artifacts in `dist/` are JSON, not encoded literals, and
 *     are not scanned by this gate (they are emitted post-build).
 *
 * Exit code:
 *   0 — no encoded-payload literals found in scanned roots.
 *   1 — at least one was found; offending lines are printed to stderr.
 *
 * @since 0.34.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_ROOTS: readonly URL[] = [
  new URL("../src/", import.meta.url),
  new URL("../scripts/", import.meta.url),
  new URL("../bin/", import.meta.url),
  new URL("../examples/", import.meta.url),
  new URL("../packages/create-daloy/bin/", import.meta.url),
  new URL("../packages/create-daloy/templates/", import.meta.url),
];

export interface EncodedPayloadFinding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/** 4+ consecutive `\xXX` escapes (article example #1). */
const HEX_ESCAPE_RUN_RE = /(?:\\x[0-9a-fA-F]{2}){4,}/;

/**
 * 4+ consecutive `\u00XX` escapes encoding printable ASCII (0x20-0x7E),
 * or 4+ consecutive `\u{0000XX}` escapes in the same range. Restricting
 * to printable ASCII avoids tripping on legitimate Unicode escape
 * sequences for non-ASCII characters (e.g. `\u2603` for a snowman in a
 * test fixture).
 */
const UNICODE_ESCAPE_RUN_RE = /(?:\\u00[2-7][0-9a-fA-F]){4,}|(?:\\u\{0{0,4}[2-7][0-9a-fA-F]\}){4,}/;

/**
 * 200+ char body of base64 / base64url alphabet, no whitespace. The
 * surrounding quote characters are stripped before this regex runs.
 */
const OPAQUE_BASE64_BLOB_RE = /^[A-Za-z0-9+/=_-]{200,}$/;

const STRING_LITERAL_RE = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g;

export function findEncodedPayloadLiterals(
  file: string,
  source: string
): readonly EncodedPayloadFinding[] {
  const out: EncodedPayloadFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    // Skip lines that are clearly a comment (best-effort; the gate
    // intentionally scans inside block-comment continuation lines too,
    // because a malicious blob hidden in a JSDoc is still a malicious
    // blob shipped in the tarball).
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    STRING_LITERAL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STRING_LITERAL_RE.exec(raw)) !== null) {
      const body = m[1] ?? m[2] ?? m[3] ?? "";
      if (HEX_ESCAPE_RUN_RE.test(body)) {
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          reason:
            "run of 4+ `\\xXX` hex escapes inside a string literal — hides URLs / commands from reviewers (Socket Obfuscation 101 example #1)",
        });
        break;
      }
      if (UNICODE_ESCAPE_RUN_RE.test(body)) {
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          reason:
            "run of 4+ `\\u00XX` unicode escapes for printable ASCII inside a string literal — hides URLs / commands from reviewers (Socket Obfuscation 101 example #1)",
        });
        break;
      }
      if (OPAQUE_BASE64_BLOB_RE.test(body)) {
        out.push({
          file,
          line: i + 1,
          text: raw.trim().slice(0, 120) + (raw.length > 120 ? "…" : ""),
          reason:
            "opaque base64/base64url blob (>=200 chars, no whitespace) inside a string literal — the carrier shape for Fernet-style encrypted payloads (Socket Obfuscation 101 PyPI example)",
        });
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile() && /\.(?:m?ts|m?js|cjs|mjs)$/.test(entry.name)) {
      yield fileURLToPath(child);
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  for (const root of SCAN_ROOTS) {
    try {
      await stat(root);
    } catch {
      continue;
    }
    for await (const absolute of walk(root)) {
      const rel = relative(process.cwd(), absolute).replaceAll("\\", "/");
      const text = await readFile(absolute, "utf8");
      const findings = findEncodedPayloadLiterals(rel, text);
      for (const f of findings) {
        console.error(
          `${f.file}:${f.line}: forbidden encoded-payload literal (${f.reason}): ${f.text}`
        );
        total++;
      }
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-encoded-payloads: ${total} encoded-payload literal${total === 1 ? "" : "s"} found. ` +
        "Daloy refuses to ship string literals that hide their contents from human reviewers via " +
        "`\\xXX` / `\\u00XX` escape runs or opaque 200+ char base64 blobs — the visible-but-unreadable " +
        "carrier shapes catalogued by Socket's Obfuscation 101 write-up " +
        "(https://socket.dev/blog/obfuscation-101-the-tricks-behind-malicious-code). " +
        "Write URLs and commands as plain text, and keep crypto test vectors under `tests/`."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-encoded-payloads.ts")) {
  await main();
}
