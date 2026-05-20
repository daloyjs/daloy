/**
 * Wave 12 - mature-Node ergonomic-framework second-pass bake-ins
 * (target `0.31.x`).
 *
 * Converts the Wave 12 ROADMAP items into a standing CI gate so the
 * focused-slice defaults shipped in the wave cannot silently regress.
 * Every audit below is a check, not a one-time change.
 *
 * Audits covered here:
 *   1. `useSemicolonDelimiter: false` hardline default - `src/router.ts`
 *      `splitPath()` only splits on `/`. The router NEVER splits on `;`
 *      so a request to `/users/42;admin=true` stays a single literal
 *      path segment and cannot smuggle attacker-controlled query data
 *      past the framework's auth / CSRF / rate-limit middleware via a
 *      proxy / origin disagreement on RFC 3986 path-segment delimiters.
 *   2. `allowErrorHandlerOverride: false` hardline default - the
 *      framework does NOT expose a standalone `app.setErrorHandler()` /
 *      `app.onError()` method. Error handlers are composed through the
 *      `Hooks.onError` chain via `use()`, deterministically merged via
 *      `firstResponse(pick("onError"))`, so the documented "second
 *      developer silently overrides the first error handler" bug class
 *      cannot occur because there is no single-handler API to override.
 *   3. `requestIdHeader: false` hardline default - the `requestId()`
 *      middleware in `src/middleware.ts` defaults to
 *      `trustIncoming: false`, so a client-supplied `X-Request-ID`
 *      header is NEVER honored unless the developer opts in explicitly.
 *      Closes the "attacker injects `X-Request-ID` to poison the audit
 *      log or fingerprint another tenant's session" surface.
 *   4. `addHttpMethod` RFC-method allowlist - the `HttpMethod` type in
 *      `src/types.ts` is the exact RFC 7231 + RFC 5789 union
 *      (`GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS`).
 *      The framework refuses arbitrary methods (WebDAV `MKCOL`,
 *      `COPY`, `PROPFIND`, `MOVE`, etc.) by type constraint and has
 *      NO `addHttpMethod()` runtime API to bypass the allowlist.
 *   5. `return503OnClosing` `Connection: close` reaffirm - the
 *      `fetch =` arrow on `App` in `src/app.ts` sets
 *      `connection: close` on every response produced while the app is
 *      draining, so HTTP/1.1 load balancers immediately stop re-using
 *      the socket for new requests on the closing instance.
 *
 * Exit code:
 *   0 - every audit passed.
 *   1 - at least one audit failed; offending findings are printed to
 *       stderr.
 *
 * @since 0.31.0
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
 * Item 1: the router NEVER splits on `;`. `splitPath()` in
 * `src/router.ts` must only call `.split("/")`. Any attempt to split on
 * `;` re-opens the "reverse proxy and origin disagree on whether `;` is
 * a path delimiter" auth-bypass class.
 */
export async function auditSemicolonDelimiterRefusal(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("router.ts");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Disallow `.split(";")` and `.split(/;/)` in the router. The router
    // must treat `;` as a literal path-segment character.
    if (/\.split\s*\(\s*['"`];['"`]\s*\)/.test(line) || /\.split\s*\(\s*\/;/.test(line)) {
      out.push({
        audit: "1. semicolon-delimiter-refusal",
        file: "src/router.ts",
        line: i + 1,
        text: line.trim(),
        message:
          "Wave 12 item 2 refuses to split path segments on `;`. The " +
          "router must treat `;` as a literal path character so a " +
          "request to `/users/42;admin=true` is a single segment and " +
          "cannot smuggle attacker-controlled query data past the " +
          "framework's auth / CSRF / rate-limit middleware via a " +
          "proxy / origin disagreement.",
      });
    }
  }
  // Positive guard: `splitPath` must exist and use `.split(\"/\")`.
  if (!/function\s+splitPath\b[\s\S]*?\.split\("\/"\)/.test(text)) {
    out.push({
      audit: "1. semicolon-delimiter-refusal",
      file: "src/router.ts",
      line: 0,
      text: 'splitPath() must use .split("/")',
      message:
        "src/router.ts must keep a `splitPath()` helper that splits the " +
        "URL path on `/` only. The presence of this helper is the " +
        "single source of truth for path-segment tokenization.",
    });
  }
  return out;
}

/**
 * Item 2: the framework exposes NO `app.setErrorHandler()` /
 * `app.onError()` standalone method. Error handling is composed through
 * the `Hooks.onError` chain via `use()` and deterministically merged.
 * Forbid any future `setErrorHandler` / standalone `onError` method on
 * `App` so a developer cannot accidentally overwrite a previously
 * registered error handler in production.
 */
export async function auditErrorHandlerOverrideRefusal(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const files = await listSrcFiles();
  // Forbid any source declaring `setErrorHandler(...)` as a method, or a
  // public method named `onError(` on a class. Hook-bundle keys like
  // `onError(ctx)` inside an object literal under `use({ onError })` are
  // matched by `:` or `(` immediately after the identifier inside a
  // braces context, which we do NOT want to flag.
  //
  // The regexes target only top-level method-definition shapes inside a
  // class body (e.g. `setErrorHandler(`, `public onError(`, or
  // `override onError(`). Hook bundles are object literals and are
  // unaffected.
  const forbiddenSetErrorHandler =
    /\b(?:public\s+|protected\s+|private\s+|override\s+|static\s+)*setErrorHandler\s*\(/;
  const forbiddenStandaloneOnError =
    /^\s*(?:public\s+|protected\s+|private\s+|override\s+|static\s+)+onError\s*\(/;
  for (const name of files) {
    const text = await readSrc(name);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (forbiddenSetErrorHandler.test(line)) {
        out.push({
          audit: "2. error-handler-override-refusal",
          file: `src/${name}`,
          line: i + 1,
          text: line.trim(),
          message:
            "Wave 12 item 3 refuses to ship a standalone " +
            "`setErrorHandler()` API. Error handlers must compose " +
            "through `use({ onError })` Hook bundles so two plugins " +
            "cannot silently overwrite each other.",
        });
      }
      if (forbiddenStandaloneOnError.test(line)) {
        out.push({
          audit: "2. error-handler-override-refusal",
          file: `src/${name}`,
          line: i + 1,
          text: line.trim(),
          message:
            "Wave 12 item 3 refuses to expose a standalone `onError()` " +
            "method on the `App` class. Hook bundle keys (`onError` " +
            "inside an object literal) are unaffected; only class " +
            "methods are forbidden.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 3: `requestId()` defaults to `trustIncoming: false`. The
 * client-supplied header is NEVER honored unless the developer
 * explicitly opts in.
 */
export async function auditRequestIdTrustDefault(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("middleware.ts");
  // The exact condition guarding incoming-header trust.
  if (!/opts\.trustIncoming\s*\?\s*ctx\.request\.headers\.get\(header\)\s*:\s*null/.test(text)) {
    out.push({
      audit: "3. request-id-trust-default",
      file: "src/middleware.ts",
      line: 0,
      text: "opts.trustIncoming ? ctx.request.headers.get(header) : null",
      message:
        "Wave 12 item 6 requires `requestId()` to default to " +
        "`trustIncoming: false` so a client-supplied `X-Request-ID` " +
        "header is NEVER honored unless the developer opts in. The " +
        "incoming-header read MUST be gated on `opts.trustIncoming`.",
    });
  }
  // Negative guard: the helper must NOT default `trustIncoming` to true.
  if (/trustIncoming\s*\?\?\s*true\b/.test(text) || /trustIncoming\s*=\s*true\b/.test(text)) {
    out.push({
      audit: "3. request-id-trust-default",
      file: "src/middleware.ts",
      line: 0,
      text: "trustIncoming default = true",
      message:
        "Wave 12 item 6 refuses to default `trustIncoming` to `true`. " +
        "The default must be `false` (opt-in trust) so client-injected " +
        "correlation IDs cannot poison framework logs by default.",
    });
  }
  return out;
}

/**
 * Item 4: the `HttpMethod` union in `src/types.ts` is the exact RFC
 * 7231 + RFC 5789 allowlist. No arbitrary `addHttpMethod()` API exists.
 * Closes the "framework silently routes WebDAV / TRACE / CONNECT" class
 * of bypass-via-extended-method bugs at compile time.
 */
export async function auditHttpMethodAllowlist(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("types.ts");
  const expected = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  // Capture the HttpMethod union body.
  const m = /export\s+type\s+HttpMethod\s*=\s*([^;]+);/.exec(text);
  if (!m) {
    out.push({
      audit: "4. http-method-allowlist",
      file: "src/types.ts",
      line: 0,
      text: "export type HttpMethod",
      message:
        "Wave 12 item 11 requires an `HttpMethod` union in src/types.ts " +
        "with the exact RFC 7231 + RFC 5789 method set.",
    });
    return out;
  }
  const body = m[1]!;
  const members = body
    .split("|")
    .map((s) => s.replace(/[\s"`'\r\n]/g, ""))
    .filter((s) => s.length > 0);
  const expectedSet = new Set(expected);
  const memberSet = new Set(members);
  // Forbid extras.
  for (const member of members) {
    if (!expectedSet.has(member)) {
      out.push({
        audit: "4. http-method-allowlist",
        file: "src/types.ts",
        line: 0,
        text: member,
        message:
          `\`${member}\` is not on the RFC 7231 + RFC 5789 method ` +
          "allowlist. Wave 12 item 11 refuses to extend `HttpMethod` " +
          "without an explicit `acknowledgeExtendedHTTPMethods: true` " +
          "opt-in (closes TRACE / CONNECT / WebDAV bypass surfaces).",
      });
    }
  }
  // Require every canonical member.
  for (const want of expected) {
    if (!memberSet.has(want)) {
      out.push({
        audit: "4. http-method-allowlist",
        file: "src/types.ts",
        line: 0,
        text: want,
        message:
          `Canonical method \`${want}\` is missing from the ` +
          "`HttpMethod` union. The seven RFC 7231 + RFC 5789 methods " +
          "must all be present.",
      });
    }
  }
  // Forbid a runtime `addHttpMethod()` export.
  const files = await listSrcFiles();
  const forbiddenAdd =
    /\bexport\s+(?:function|const|class)\s+addHttpMethod\b/;
  for (const name of files) {
    const fileText = await readSrc(name);
    const lines = fileText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (forbiddenAdd.test(line)) {
        out.push({
          audit: "4. http-method-allowlist",
          file: `src/${name}`,
          line: i + 1,
          text: line.trim(),
          message:
            "Wave 12 item 11 refuses to expose an `addHttpMethod()` " +
            "runtime API. Adding a method must require an `AppOptions` " +
            "opt-in routed through the type-system allowlist.",
        });
      }
    }
  }
  return out;
}

/**
 * Item 5: the `App.fetch` arrow sets `connection: close` on every
 * response produced while the app is draining. Reaffirms the Wave 4
 * default so a future refactor of the dispatch path cannot drop the
 * header.
 */
export async function auditDrainingConnectionClose(): Promise<readonly Finding[]> {
  const out: Finding[] = [];
  const text = await readSrc("app.ts");
  // Must contain the exact draining branch on the fetch arrow.
  if (
    !/if\s*\(\s*this\.draining\s*&&\s*!response\.headers\.has\("connection"\)\s*\)\s*\{[\s\S]{0,200}?response\.headers\.set\("connection",\s*"close"\)/m.test(
      text,
    )
  ) {
    out.push({
      audit: "5. draining-connection-close",
      file: "src/app.ts",
      line: 0,
      text: 'if (this.draining && !response.headers.has("connection")) { response.headers.set("connection", "close") }',
      message:
        "Wave 12 item 17 requires `App.fetch` to set " +
        "`Connection: close` on every response produced while the app " +
        "is draining so HTTP/1.1 load balancers immediately stop " +
        "re-using the socket for new requests on the closing instance.",
    });
  }
  return out;
}

/**
 * Top-level orchestrator. Runs every audit, reports findings to stderr,
 * exits non-zero on any finding.
 */
export async function runWave12Audits(): Promise<readonly Finding[]> {
  const all: Finding[] = [];
  all.push(...(await auditSemicolonDelimiterRefusal()));
  all.push(...(await auditErrorHandlerOverrideRefusal()));
  all.push(...(await auditRequestIdTrustDefault()));
  all.push(...(await auditHttpMethodAllowlist()));
  all.push(...(await auditDrainingConnectionClose()));
  return all;
}

async function main(): Promise<void> {
  const findings = await runWave12Audits();
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
        ? "verify-wave12-audits: all static gates passed (items 1, 2, 3, 4, 5)."
        : `verify-wave12-audits: all static gates passed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (items 1, 2, 3, 4, 5).`,
    );
    return;
  }
  for (const f of errors) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`[${f.audit}] ${where}: ${f.text}`);
    console.error(`    ${f.message}`);
  }
  console.error(
    `verify-wave12-audits: ${errors.length} error${errors.length === 1 ? "" : "s"}` +
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
