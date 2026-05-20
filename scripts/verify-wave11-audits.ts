/**
 * Wave 11 - multi-runtime web-standard ergonomic-framework parity bake-ins
 * (target `0.30.x`).
 *
 * Converts the Wave 11 ROADMAP items into a standing CI gate so the
 * focused-slice defaults shipped in the wave cannot silently regress, and
 * so the documented "if we ever ship" non-goals cannot land unaudited.
 * Each numbered audit below is a check, not a one-time change.
 *
 * Audits covered here:
 *   1. Reverse-proxy / `proxy()` helper does not exist - if a future
 *      contributor introduces one, the audit either confirms it strips
 *      hop-by-hop headers or fails. Today the helper is intentionally
 *      absent, so we audit absence.
 *   4. Auth-failure responses ship `Cache-Control: no-store` - the three
 *      auth-related error classes (`UnauthorizedError`, `ForbiddenError`,
 *      `TooManyRequestsError`) must construct themselves with that header
 *      baked in. Lifted via static source scan, not runtime test, so
 *      removal of the header at any time trips the gate.
 *   6. Compression helper skips already-encoded responses - `src/compression.ts`
 *      must keep the `Content-Encoding` short-circuit + the entropy-coded
 *      content-type deny-list.
 *   7. CSP report receiver hardening - `src/app.ts` `cspReportRoute` must
 *      enforce the 64 KiB hard cap, accept only the two RFC content types
 *      (`application/csp-report`, `application/reports+json`), default to
 *      not logging report bodies in production, and rate-limit per IP.
 *   9. `cors()` `allowMethods` default narrowed - `src/middleware.ts`
 *      must declare `DEFAULT_CORS_METHODS = ["GET", "HEAD", "POST"]` and
 *      refuse `methods: ["*"]` at construction.
 *
 * Exit code:
 *   0 - every audit passed.
 *   1 - at least one audit failed; offending findings are printed to
 *       stderr.
 *
 * @since 0.30.0
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface Finding {
  readonly level?: "error" | "warn";
  readonly audit: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly message: string;
}

const REPO_ROOT = pathToFileURL(`${process.cwd()}/`);
const SRC_ROOT = new URL("src/", REPO_ROOT);

async function listSrcFiles(): Promise<readonly string[]> {
  const entries = await readdir(SRC_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => e.name);
}

async function readSrc(name: string): Promise<string> {
  return await readFile(new URL(name, SRC_ROOT), "utf8");
}

/**
 * Item 1: reverse-proxy / `proxy()` helper does not exist in `src/`. If a
 * future contributor adds one, the audit fails until they document the
 * hop-by-hop header strip in `SECURITY.md` and re-enable this gate with
 * the matching pattern.
 */
export async function auditReverseProxyAbsence(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const files = await listSrcFiles();
  const forbidden =
    /\bexport\s+(?:function|const|class)\s+(?:proxy|reverseProxy)\b/;
  for (const name of files) {
    const text = await readSrc(name);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (forbidden.test(line)) {
        out.push({
          audit: "1. reverse-proxy-helper-absence",
          file: `src/${name}`,
          line: i + 1,
          text: line.trim(),
          message:
            "Wave 11 refuses to ship a `proxy()` / `reverseProxy()` helper " +
            "unless it strips RFC 7230 hop-by-hop headers (Connection, " +
            "Keep-Alive, Proxy-Authenticate, Proxy-Authorization, TE, " +
            "Trailers, Transfer-Encoding, Upgrade) on BOTH directions and " +
            "default-strips upstream `Set-Cookie`. Document the strip in " +
            "SECURITY.md and update this gate before re-introducing the " +
            "helper.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 4: the three auth-failure error classes ship
 * `Cache-Control: no-store` baked into their default headers. Grep on the
 * exact construction site (the three class bodies in `src/errors.ts`)
 * keeps the audit cheap and robust.
 */
export async function auditAuthFailureCacheControl(): Promise<readonly Finding[]> {
  const text = await readSrc("errors.ts");
  const out: Finding[] = [];
  const checks: Array<{ classRe: RegExp; name: string }> = [
    { classRe: /class UnauthorizedError\b[\s\S]*?^\}/m, name: "UnauthorizedError" },
    { classRe: /class ForbiddenError\b[\s\S]*?^\}/m, name: "ForbiddenError" },
    { classRe: /class TooManyRequestsError\b[\s\S]*?^\}/m, name: "TooManyRequestsError" },
  ];
  for (const { classRe, name } of checks) {
    const m = classRe.exec(text);
    if (!m) {
      out.push({
        audit: "4. auth-failure-cache-control",
        file: "src/errors.ts",
        line: 0,
        text: `class ${name}`,
        message: `Could not locate class ${name} in src/errors.ts.`,
      });
      continue;
    }
    if (!/"cache-control"\s*:\s*"no-store"/.test(m[0])) {
      const start = text.slice(0, m.index).split(/\r?\n/).length;
      out.push({
        audit: "4. auth-failure-cache-control",
        file: "src/errors.ts",
        line: start,
        text: `class ${name}`,
        message:
          `${name} must construct itself with \`cache-control: no-store\` ` +
          "in its default headers so auth-failure responses are never " +
          "cached (Wave 11 item 4).",
      });
    }
  }
  return out;
}

/**
 * Item 6: compression helper keeps the `Content-Encoding` short-circuit
 * and the entropy-coded content-type deny-list.
 */
export async function auditCompressionSkipEncoded(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  let text: string;
  try {
    text = await readSrc("compression.ts");
  } catch {
    return out; // helper may not exist on a branch; tolerated.
  }
  if (!/content-encoding/i.test(text)) {
    out.push({
      audit: "6. compression-skip-encoded",
      file: "src/compression.ts",
      line: 0,
      text: "content-encoding",
      message:
        "compression() must read the response `Content-Encoding` header " +
        "and short-circuit when any encoding is already present " +
        "(Wave 11 item 6).",
    });
  }
  for (const needle of ["image/", "video/", "audio/", "application/zip"]) {
    if (!text.includes(needle)) {
      out.push({
        audit: "6. compression-skip-encoded",
        file: "src/compression.ts",
        line: 0,
        text: needle,
        message:
          `compression() must keep \`${needle}\` on the entropy-coded ` +
          "content-type deny-list (Wave 11 item 6).",
      });
    }
  }
  return out;
}

/**
 * Item 7: CSP report receiver hardening - enforce the 64 KiB hard cap,
 * accept only the two RFC content types, default-redact report bodies in
 * production, and rate-limit per IP.
 */
export async function auditCspReportHardening(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("app.ts");
  if (!/cspReportRoute/.test(text)) {
    return out;
  }
  if (!/HARD_MAX\s*=\s*65536/.test(text)) {
    out.push({
      audit: "7. csp-report-hardening",
      file: "src/app.ts",
      line: 0,
      text: "HARD_MAX = 65536",
      message:
        "cspReportRoute() must refuse `maxBodyBytes` above 64 KiB " +
        "(65536 bytes) to defend against DoS-via-report-flood " +
        "(Wave 11 item 7).",
    });
  }
  for (const contentType of [
    "application/csp-report",
    "application/reports+json",
  ]) {
    if (!text.includes(`contentType !== "${contentType}"`)) {
      out.push({
        audit: "7. csp-report-hardening",
        file: "src/app.ts",
        line: 0,
        text: contentType,
        message:
          `cspReportRoute() must keep \`${contentType}\` in the exact ` +
          "accepted content-type allowlist (Wave 11 item 7).",
      });
    }
  }
  if (text.includes('contentType !== "application/json"')) {
    out.push({
      audit: "7. csp-report-hardening",
      file: "src/app.ts",
      line: 0,
      text: "application/json acceptance",
      message:
        "cspReportRoute() must refuse `application/json`; only " +
        "`application/csp-report` and `application/reports+json` are " +
        "accepted per RFC 9116 / Reporting API v1 (Wave 11 item 7).",
    });
  }
  if (!/opts\.logCspReportBodies\s*\?\?\s*!this\.isProduction\(\)/.test(text)) {
    out.push({
      audit: "7. csp-report-hardening",
      file: "src/app.ts",
      line: 0,
      text: "opts.logCspReportBodies ?? !this.isProduction()",
      message:
        "cspReportRoute() must omit the parsed report body from the " +
        "default structured logger in production unless " +
        "`logCspReportBodies: true` is set explicitly (Wave 11 item 7).",
    });
  }
  if (!/rateLimitConfig\s*=\s*\n\s*opts\.rateLimit\s*===\s*false[\s\S]*limit:\s*60[\s\S]*windowMs:\s*60_000/.test(text)) {
    out.push({
      audit: "7. csp-report-hardening",
      file: "src/app.ts",
      line: 0,
      text: "rateLimit: 60 / 60_000",
      message:
        "cspReportRoute() must keep the default per-IP report rate limit " +
        "at 60 reports per 60 seconds unless explicitly disabled " +
        "(Wave 11 item 7).",
    });
  }
  return out;
}

/**
 * Item 9: `cors()` default `allowMethods` narrowed to the read-only set
 * and `methods: ["*"]` refused at construction.
 */
export async function auditCorsAllowMethodsDefault(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("middleware.ts");
  if (
    !/DEFAULT_CORS_METHODS\s*=\s*\[\s*"GET"\s*,\s*"HEAD"\s*,\s*"POST"\s*\]/.test(
      text,
    )
  ) {
    out.push({
      audit: "9. cors-allow-methods-default",
      file: "src/middleware.ts",
      line: 0,
      text: 'DEFAULT_CORS_METHODS = ["GET", "HEAD", "POST"]',
      message:
        "cors() default `allowMethods` must be the read-only set " +
        '`["GET", "HEAD", "POST"]`. Adding PUT/PATCH/DELETE to the ' +
        "default cross-origin-exposes every state-changing endpoint " +
        "without an explicit developer opt-in (Wave 11 item 9).",
    });
  }
  if (!/cors\(\): methods cannot include "\*"/.test(text)) {
    out.push({
      audit: "9. cors-allow-methods-default",
      file: "src/middleware.ts",
      line: 0,
      text: 'cors(): methods cannot include "*"',
      message:
        "cors() must refuse `methods: [\"*\"]` at construction with a " +
        "structured error. `*` is a response-only token per the Fetch " +
        "standard, not a developer-facing allowlist value " +
        "(Wave 11 item 9).",
    });
  }
  return out;
}

/**
 * Top-level orchestrator. Runs every audit, reports findings to stderr,
 * exits non-zero on any finding.
 */
export async function runWave11Audits(): Promise<readonly Finding[]> {
  const all: Finding[] = [];
  all.push(...(await auditReverseProxyAbsence()));
  all.push(...(await auditAuthFailureCacheControl()));
  all.push(...(await auditCompressionSkipEncoded()));
  all.push(...(await auditCspReportHardening()));
  all.push(...(await auditCorsAllowMethodsDefault()));
  return all;
}

async function main(): Promise<void> {
  const findings = await runWave11Audits();
  const warnings = findings.filter((f) => f.level === "warn");
  const errors = findings.filter((f) => f.level !== "warn");
  for (const f of warnings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.warn(`[warn][${f.audit}] ${where}: ${f.text}`);
    console.warn(`    ${f.message}`);
  }
  if (errors.length === 0) {
    console.log(
      warnings.length === 0
        ? "verify-wave11-audits: all static gates passed (items 1, 4, 6, 7, 9)."
        : `verify-wave11-audits: all static gates passed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (items 1, 4, 6, 7, 9).`,
    );
    return;
  }
  for (const f of errors) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`[${f.audit}] ${where}: ${f.text}`);
    console.error(`    ${f.message}`);
  }
  console.error(
    `verify-wave11-audits: ${errors.length} error${errors.length === 1 ? "" : "s"}` +
      (warnings.length === 0
        ? "."
        : ` and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`),
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
