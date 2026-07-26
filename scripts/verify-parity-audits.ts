/**
 * Pattern-agnostic-framework parity audits.
 *
 * Converts the head-to-head feature comparison in
 * `otherdocs/security_task.txt` into a standing CI gate so the framework
 * never silently regresses against another TS / Bun / Node ergonomic
 * framework's documented defaults. Each numbered audit below is a check,
 * not a one-time change. This file carries the static grep gates that scan
 * source code so a future contributor cannot quietly reintroduce a forbidden
 * surface. Live-config posture checks live in `daloy doctor --audit-defaults`
 * (see `src/cli.ts`), and already-shipped runtime behavior remains covered by
 * the feature-specific tests that introduced those defaults.
 *
 * Audits covered here:
 *   9.  Mutable-request-URL audit         (no `set url(`, `set path(`,
 *                                          `set method(` in `src/`)
 *  10.  Response-bypass escape hatch       (no `ctx.respond = false`-style)
 *  11.  Open-redirect-via-Referer          (no `Location` set from `referer`)
 *  15.  Encrypted-cookie helper crypto     (no `AES-CBC`, `SHA-1` or
 *                                          third-party crypto in
 *                                          `src/cookie.ts`)
 *  17.  Internal-route exposure            (adapters dispatch via
 *                                          `app.fetch(...)`, never
 *                                          `allowInternal: true`)
 *  19.  Runtime-dependency audit           (delegates to
 *                                          `verify-no-runtime-deps.ts`;
 *                                          reaffirmed here as item 19)
 *
 * Item 22 is enforced by the existing
 * `scripts/verify-secret-comparisons.ts` gate and runs separately in CI.
 *
 * Exit code:
 *   0 - every audit passed.
 *   1 - at least one audit failed; offending lines are printed to stderr.
 *
 * @since 0.28.0
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Finding {
  readonly audit: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly message: string;
}

const REPO_ROOT = pathToFileURL(`${process.cwd()}/`);
const SRC_ROOT = new URL("src/", REPO_ROOT);
const PACKAGE_JSON = new URL("package.json", REPO_ROOT);

async function readSrc(rel: string): Promise<string> {
  return readFile(new URL(rel, SRC_ROOT), "utf8");
}

async function listSrcFiles(): Promise<readonly string[]> {
  const out: string[] = [];
  async function walk(dir: URL, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(new URL(`${entry.name}/`, dir), rel);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(rel);
      }
    }
  }
  await walk(SRC_ROOT, "");
  return out;
}

function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed === "*/"
  );
}

/**
 * Item 9: mutable-request-URL audit. No public setter on `request.url` /
 * `request.path` / `request.method` may exist in the Daloy public
 * surface. Closes the security-middleware-ordering bug class that
 * minimalist async-middleware frameworks ship as advertised features.
 */
async function auditMutableRequestUrl(files: readonly string[]): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const RE = /\bset\s+(url|path|method)\s*\(/;
  for (const rel of files) {
    const src = await readSrc(rel);
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || isCommentLine(trimmed)) continue;
      if (RE.test(trimmed)) {
        out.push({
          audit: "9. mutable-request-URL",
          file: `src/${rel}`,
          line: i + 1,
          text: trimmed,
          message:
            "Public setter on request.url / request.path / request.method " +
            "would let later middleware re-route requests past earlier " +
            "security checks. Remove the setter or rename if this is a " +
            "private helper unrelated to the public Request shape.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 10: response-bypass escape hatch audit. No public field on `ctx` /
 * `Context` may switch off framework response handling.
 */
async function auditResponseBypass(files: readonly string[]): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  // Match `respond` as a property declaration / assignment on a Context-shaped
  // object (`ctx.respond`, `context.respond`, `respond:` in a Context type)
  // followed by an assignment or a boolean type.
  const RE = /\b(?:ctx|context|c|state)\.respond\s*=|\brespond\s*:\s*(?:boolean|false|true)\b/;
  for (const rel of files) {
    const src = await readSrc(rel);
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || isCommentLine(trimmed)) continue;
      if (RE.test(trimmed)) {
        out.push({
          audit: "10. response-bypass escape hatch",
          file: `src/${rel}`,
          line: i + 1,
          text: trimmed,
          message:
            "Public `ctx.respond` / `respond: boolean` switch would let a " +
            "handler silently bypass secure-headers, audit-log, CSRF state " +
            "mutation, and rate-limit counters. The framework either owns " +
            "the response or it doesn't.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 11: open-redirect-via-Referer audit. No helper in the public API
 * reads `request.headers.referer` as a redirect target. The Referer
 * header is attacker-controlled on victim requests; using it to pick a
 * redirect target is an open-redirect amplifier the framework refuses to
 * provide. CSRF origin-verification reads of `referer` are explicitly
 * allowlisted because they compare the Referer against a same-origin
 * allowlist; they never redirect to it.
 */
async function auditOpenRedirectReferer(files: readonly string[]): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  for (const rel of files) {
    const src = await readSrc(rel);
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || isCommentLine(trimmed)) continue;
      // Forbid any line that mentions BOTH a Location header (or `redirect(`
      // call) AND the `referer` header. CSRF code uses Referer for an
      // allowlist check only, never alongside a Location header.
      const mentionsReferer = /\breferer\b/i.test(trimmed);
      if (!mentionsReferer) continue;
      const mentionsLocation =
        /["']Location["']/i.test(trimmed) || /Response\.redirect\s*\(/.test(trimmed);
      if (mentionsLocation) {
        out.push({
          audit: "11. open-redirect-via-Referer",
          file: `src/${rel}`,
          line: i + 1,
          text: trimmed,
          message:
            "Reading the Referer header to choose a redirect target is an " +
            "open-redirect amplifier. The Referer header is attacker-" +
            "controlled on victim requests.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 15: encrypted-cookie helper crypto audit. The
 * `setEncryptedCookie` helper (and any helper module under
 * `src/cookie.ts`) must use only WebCrypto AES-GCM + HMAC-SHA256: no
 * AES-CBC fallback, no SHA-1 fallback, no third-party crypto reach.
 *
 * The audit is scoped to `src/cookie.ts` because SHA-1 has documented
 * legitimate uses elsewhere (RFC 6455 WebSocket handshake in
 * `src/websocket.ts`, the strong-ETag default in `src/etag.ts` - neither
 * is a confidentiality primitive).
 */
async function auditEncryptedCookieCrypto(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  let src: string;
  try {
    src = await readSrc("cookie.ts");
  } catch {
    return out;
  }
  const lines = src.split(/\r?\n/);
  // We forbid AES-CBC + SHA-1 outright when they appear in NON-comment lines,
  // and forbid imports from any module that is not WebCrypto. The cookie
  // helper module is allowed to import only from `./security.ts` (the
  // existing WebCrypto/HMAC primitives) and `./time-claims.ts` / node:
  // built-ins that do not pull in third-party crypto.
  const FORBIDDEN_STRINGS = [
    /\bAES-CBC\b/,
    /\bSHA-1\b/,
    /\bAES-CTR\b/, // explicit foot-shoots
  ];
  // Third-party crypto reach: anything not WebCrypto / node:crypto / a
  // first-party module under `./` or `../`.
  const IMPORT_RE = /^\s*import\s+[^;]*?from\s+["']([^"']+)["']/;
  const ALLOWED_IMPORT_PREFIXES = ["./", "../", "node:"];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (!isCommentLine(trimmed)) {
      for (const re of FORBIDDEN_STRINGS) {
        if (re.test(trimmed)) {
          out.push({
            audit: "15. encrypted-cookie helper crypto",
            file: "src/cookie.ts",
            line: i + 1,
            text: trimmed,
            message:
              "The encrypted-cookie helper must use only WebCrypto AES-GCM " +
              "+ HMAC-SHA256. AES-CBC / SHA-1 / AES-CTR are forbidden.",
          });
        }
      }
    }
    const m = IMPORT_RE.exec(raw);
    if (m) {
      const spec = m[1]!;
      const allowed = ALLOWED_IMPORT_PREFIXES.some((p) => spec.startsWith(p));
      if (!allowed) {
        out.push({
          audit: "15. encrypted-cookie helper crypto",
          file: "src/cookie.ts",
          line: i + 1,
          text: trimmed,
          message:
            `Third-party crypto reach forbidden in the cookie helper: ` +
            `import from "${spec}". Use WebCrypto (globalThis.crypto.subtle).`,
        });
      }
    }
  }
  return out;
}

/**
 * Item 17: internal-route exposure audit. No `internal: true` route may be
 * mounted into a public adapter. Every adapter under `src/adapters/`
 * must dispatch via `app.fetch(...)` (which refuses internal routes) and
 * never via `app.dispatch(req, { allowInternal: true })` or
 * `app.inject(...)`.
 */
async function auditInternalRouteExposure(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const adapterDir = new URL("adapters/", SRC_ROOT);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(adapterDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const rel = `adapters/${entry.name}`;
    const src = await readSrc(rel);
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || isCommentLine(trimmed)) continue;
      if (/allowInternal\s*:\s*true/.test(trimmed)) {
        out.push({
          audit: "17. internal-route exposure",
          file: `src/${rel}`,
          line: i + 1,
          text: trimmed,
          message:
            "Public adapters must dispatch via app.fetch(...). " +
            "{ allowInternal: true } would expose `internal: true` routes " +
            "to the public listener.",
        });
      }
      if (/app\.inject\s*\(/.test(trimmed)) {
        out.push({
          audit: "17. internal-route exposure",
          file: `src/${rel}`,
          line: i + 1,
          text: trimmed,
          message:
            "Public adapters must not call app.inject(...). inject() is " +
            "the in-process test surface and bypasses the internal-route " +
            "guard.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 19: runtime-dependency audit. Reaffirms the same policy as
 * `verify-no-runtime-deps.ts`, kept local so this audit script can also run
 * from the compiled `dist-coverage/` tree used by `pnpm coverage:branches`.
 */
async function auditRuntimeDeps(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readFile(PACKAGE_JSON, "utf8");
  const pkg = JSON.parse(text) as { dependencies?: Record<string, unknown> };
  const deps = pkg.dependencies;
  if (deps && typeof deps === "object") {
    for (const name of Object.keys(deps)) {
      out.push({
        audit: "19. runtime-dependency",
        file: "package.json",
        line: 0,
        text: name,
        message:
          "@daloyjs/core ships zero runtime dependencies. Move to " +
          "peerDependencies (adapters/validators) or devDependencies. " +
          "If unavoidable, document the addition in SECURITY.md.",
      });
    }
  }
  return out;
}

/**
 * Top-level orchestrator. Runs every audit, reports findings to stderr,
 * exits non-zero on any finding.
 */
export async function runParityAudits(): Promise<readonly Finding[]> {
  const files = await listSrcFiles();
  const all: Finding[] = [];
  all.push(...(await auditMutableRequestUrl(files)));
  all.push(...(await auditResponseBypass(files)));
  all.push(...(await auditOpenRedirectReferer(files)));
  all.push(...(await auditEncryptedCookieCrypto()));
  all.push(...(await auditInternalRouteExposure()));
  all.push(...(await auditRuntimeDeps()));
  return all;
}

async function main(): Promise<void> {
  const findings = await runParityAudits();
  if (findings.length === 0) {
    console.log("verify-parity-audits: all static gates passed (items 9, 10, 11, 15, 17, 19).");
    return;
  }
  for (const f of findings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`[${f.audit}] ${where}: ${f.text}`);
    console.error(`    ${f.message}`);
  }
  console.error(
    `verify-parity-audits: ${findings.length} finding${findings.length === 1 ? "" : "s"}.`
  );
  process.exitCode = 1;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  await main();
}
