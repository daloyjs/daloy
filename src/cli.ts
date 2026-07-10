/**
 * `daloy inspect` — CLI inspector.
 *
 * Loads a user's `App` instance from an entry file and prints its routes,
 * schema summary, dead routes, missing operationIds, or the full OpenAPI
 * 3.1 document.
 *
 * Pure logic lives in `runCli` so it can be unit-tested without spawning
 * a child process. The thin shim in `bin/daloy.mjs` wires this up to
 * `process.argv`, `process.stdout`, dynamic `import()`, and `process.exit`.
 */

import type { App, IntrospectedRoute } from "./app.js";
import { findRoutesMissingResponseBodySchema } from "./app.js";
import { runContractTests } from "./contract.js";
import { diffOpenAPI, type OpenAPIChange } from "./openapi-diff.js";
import { generateOpenAPI, openapiToYAML } from "./openapi.js";
import { generateAsyncAPI, asyncapiToYAML } from "./asyncapi.js";
import type { RouteDefinition, RouteMeta } from "./types.js";

/** I/O hooks used by {@link runCli} to read modules, write output, and spawn child processes. */
export interface CliIO {
  /** Write a chunk to standard output (tables, JSON/YAML dumps). */
  stdout: (chunk: string) => void;
  /** Write a chunk to standard error (usage errors, diagnostics). */
  stderr: (chunk: string) => void;
  /** Resolve a user-provided entry specifier to a module to import. */
  importEntry: (specifier: string) => Promise<unknown>;
  /** Version string surfaced by `--version`. */
  version: string;
  /**
   * Spawn a child process and resolve with its exit code. Required for
   * `daloy dev`; optional so unit tests that only exercise `inspect`
   * can omit it.
   */
  spawn?: (command: string, args: readonly string[]) => Promise<number>;
  /**
   * Read a UTF-8 text file by path. Required for `daloy diff`; optional so
   * unit tests that only exercise `inspect` can omit it.
   */
  readTextFile?: (path: string) => Promise<string>;
  /**
   * Override runtime detection (defaults to inspecting `globalThis.process.versions`).
   * Mainly exists for tests.
   */
  detectRuntime?: () => DevRuntime;
}

/** Return value of {@link runCli}. The caller wires `exitCode` into `process.exit(...)`. */
export interface CliResult {
  /** Process exit code: `0` on success, `1` on load failures or failed checks, `2` on usage errors. */
  exitCode: number;
}

/** Parsed CLI flags accepted by {@link runCli}. See {@link parseArgs}. */
export interface CliOptions {
  /** `--json`: print machine-readable JSON instead of a table. */
  json: boolean;
  /** `--check`: run the contract test suite; exit 1 on errors. */
  check: boolean;
  /** `--schemas`: include per-route schema presence (body/query/params/headers). */
  schemas: boolean;
  /** `--openapi`: print the App's OpenAPI 3.1 document. */
  openapi: boolean;
  /** `--asyncapi`: print the AsyncAPI 3.0 document for the App's WebSocket surfaces. */
  asyncapi: boolean;
  /** `--ai`: print the AI/codegen-friendly route-catalog dump ({@link buildAiDump}). */
  ai: boolean;
  /**
   * Output format for `--ai` and `--openapi`. Defaults to `"json"`.
   * `"yaml"` emits YAML 1.2 via {@link openapiToYAML}; useful for
   * LLM system prompts where the lack of `{`, `}`, `"` and `,` saves
   * roughly 20–40% of tokens versus JSON for the same payload.
   *
   * @since 0.14.2
   */
  format?: "json" | "yaml";
  /** `--tag <tag>`: only show routes that declare this tag. */
  tag?: string;
  /** `--method <method>`: only show routes for this HTTP method (uppercased by {@link parseArgs}). */
  method?: string;
  /** Entry file to load the App from (last positional argument). */
  entry?: string;
  /** `-h` / `--help`: print usage and exit 0. */
  help: boolean;
  /** `-v` / `--version`: print the CLI version and exit 0. */
  version: boolean;
  /** Override runtime detection for `daloy dev`. */
  runtime?: DevRuntime;
  /** `daloy doctor` — also scan env vars for leaked secrets. */
  auditSecrets?: boolean;
  /** `daloy doctor` — disable the default-defaults audit. */
  noAuditDefaults?: boolean;
  /** Positional arguments collected in order (used by `daloy diff`). */
  positionals?: string[];
}

const HELP = `daloy — DaloyJS CLI

Usage:
  daloy <command> [options] [entry]

Commands:
  inspect [entry]        Load an App and print its routes (default command).
  dev     [entry]        Start the entry file with the host runtime's
                         native watch mode (node --watch on Node, --hot on
                         Bun, --watch on Deno). Node runs TypeScript
                         entries via its built-in type stripping.
  doctor  [entry]        Audit a loaded App's secure-by-default posture.
                         Exits non-zero on any violation so the
                         command can guard container HEALTHCHECK and CI
                         deploy steps.
  diff <baseline> <current>
                         Compare two OpenAPI 3.1 JSON documents and report
                         added, removed, and changed operations. Exits 1
                         when a breaking change is detected so it can gate
                         CI; pass --json for machine-readable output.

Options:
  --json                 Print machine-readable JSON instead of a table.
  --check                Run the contract test suite; exit 1 on errors.
  --schemas              Include per-route schema presence (body/query/...).
  --openapi              Print the OpenAPI 3.1 document for the App.
  --asyncapi             Print the AsyncAPI 3.0 document for the App's
                         WebSocket (app.ws()) surfaces.
  --ai                   Print an AI/codegen-friendly dump of the
                         route catalog with schemas and meta examples
                         (suitable for feeding to an LLM or for writing
                         to a sibling routes.json / routes.yaml).
  --format <fmt>         Output format for --ai, --openapi and --asyncapi:
                         json | yaml (default: json). YAML saves ~20–40%% of
                         LLM tokens versus JSON for the same payload.
  --yaml                 Shorthand for --format yaml.
  --tag <tag>            Only show routes that declare this tag.
  --method <method>      Only show routes for this HTTP method.
  --runtime <r>          (dev) Force the runtime: node | bun | deno.
                         Useful from package.json scripts where the CLI
                         shebang would otherwise always select Node.
  --audit-secrets        (doctor) Also scan environment variables for
                         leaked HMAC secrets and known-weak placeholders.
  --audit-defaults       (doctor) Also audit framework defaults (default
                         on; pass --no-audit-defaults to skip).
  -h, --help             Show this help.
  -v, --version          Print the @daloyjs/core version this CLI ships from.

Entry:
  For inspect: a path to a JS or TS file that exports an App instance,
  either as the default export or as a named export called "app". Modules
  may also export a zero-argument buildApp() or createApp() factory.
  Defaults to ./src/app.ts, ./src/app.js, ./src/build-app.ts,
  ./src/build-app.js, ./app.ts, ./app.js, ./build-app.ts, ./build-app.js.

  For dev: a path to the runnable entry (e.g. ./src/index.ts that calls
  serve()). Defaults to ./src/index.ts, ./src/main.ts, ./src/server.ts,
  ./src/app.ts, ./index.ts, ./main.ts, ./server.ts, ./app.ts.

Examples:
  daloy inspect
  daloy inspect --json src/server.ts
  daloy inspect --check
  daloy inspect --openapi > openapi.json
  daloy inspect --ai --yaml > routes.yaml
  daloy inspect --openapi --format yaml > openapi.yaml
  daloy inspect --asyncapi > asyncapi.json
  daloy inspect --asyncapi --format yaml > asyncapi.yaml
  daloy dev
  daloy dev src/server.ts
  daloy diff openapi.published.json openapi.json
  daloy diff --json openapi.published.json openapi.json
`;

const DEFAULT_ENTRIES: string[] = [
  "src/app.ts",
  "src/app.js",
  "src/build-app.ts",
  "src/build-app.js",
  "app.ts",
  "app.js",
  "build-app.ts",
  "build-app.js",
];

const DEFAULT_DEV_ENTRIES: string[] = [
  "src/index.ts",
  "src/main.ts",
  "src/server.ts",
  "src/app.ts",
  "src/index.js",
  "src/main.js",
  "src/server.js",
  "src/app.js",
  "index.ts",
  "main.ts",
  "server.ts",
  "app.ts",
  "index.js",
  "main.js",
  "server.js",
  "app.js",
];

/** Runtime detected for `daloy dev`. */
export type DevRuntime = "node" | "bun" | "deno";

/**
 * Detect which JS runtime is hosting the CLI. Inspects
 * `globalThis.process.versions` for Bun/Deno markers; falls back to Node.
 *
 * @returns `"bun"`, `"deno"`, or `"node"` (the default when no marker is found).
 * @since 0.3.0
 */
export function detectRuntime(): DevRuntime {
  const proc = (globalThis as { process?: { versions?: Record<string, unknown> } }).process;
  const v = proc?.versions ?? {};
  if (v.bun) return "bun";
  if (v.deno) return "deno";
  return "node";
}

/**
 * Validate a CLI-supplied entry path before it is handed to `import()` or
 * forwarded as a child-process argv element. Rejects NUL bytes, CR/LF, and
 * leading `-` characters so a hostile caller (or a misparsed positional)
 * cannot smuggle a `--eval=...`, `--inspect-brk=...`, or similar
 * argv-injection payload past `spawn({ shell: false })` into Node, Bun, or
 * Deno's own argv parser.
 *
 * This is defense-in-depth alongside {@link parseArgs}, which already
 * rejects `-`-prefixed positionals. The check also runs in programmatic
 * `runCli()` callers and tests so the invariant holds regardless of how the
 * entry value was produced.
 *
 * @param entry - Entry path to validate.
 * @param context - Label prefixed to error messages (e.g. `"daloy dev"`).
 * @throws Error when the path is empty, contains NUL/CR/LF, or starts with `-`.
 * @internal
 */
export function assertSafeEntryPath(entry: string, context: string): void {
  if (typeof entry !== "string" || entry.length === 0) {
    throw new Error(`${context}: entry path must be a non-empty string.`);
  }
  if (entry.includes("\0") || /[\r\n]/.test(entry)) {
    throw new Error(
      `${context}: entry path must not contain NUL bytes or newlines (got: ${JSON.stringify(entry)}).`,
    );
  }
  if (entry.startsWith("-")) {
    throw new Error(
      `${context}: entry path must not start with "-" — runtimes parse leading dashes as flags ` +
        `(got: ${JSON.stringify(entry)}). Prefix the path with "./" to disambiguate.`,
    );
  }
}

/**
 * Normalize a relative entry path so the host runtime always sees an
 * unambiguous file path, never a possible flag. Absolute paths and paths
 * already anchored with `./` or `../` are returned unchanged; bare relative
 * paths like `src/server.ts` are rewritten to `./src/server.ts`. This is
 * the second half of the {@link assertSafeEntryPath} defense.
 *
 * @param entry - Entry path to anchor.
 * @returns The path unchanged if already absolute or `./`/`../`-anchored (Windows drive paths included); otherwise `./` + path.
 * @internal
 */
export function normalizeEntryArg(entry: string): string {
  if (entry.startsWith("./") || entry.startsWith("../")) return entry;
  if (entry.startsWith("/")) return entry;
  // Windows drive letter (C:\, D:/, ...).
  if (/^[A-Za-z]:[\\/]/.test(entry)) return entry;
  return `./${entry}`;
}

/**
 * Build the `(command, args)` pair `daloy dev` should spawn for the given
 * runtime and entry file. Pure function so tests can assert exact argv
 * without spawning a child process.
 *
 * - Node: `node --watch <entry>` (Node >= 22.18 strips TypeScript types
 *   natively, so `.ts` entries with erasable-only syntax run without a
 *   loader; `.js` entries also work. Projects that need non-erasable
 *   syntax — enums, runtime namespaces, parameter properties — should
 *   transpile or add a loader such as tsx themselves).
 * - Bun:  `bun --hot <entry>` (Bun ships with TS support).
 * - Deno: `deno run --watch --allow-net --allow-env --allow-read <entry>`
 *   (the three permissions cover serving HTTP, reading env vars, and
 *   reading the source tree; users who need more should run `deno run`
 *   directly).
 *
 * The entry is validated via {@link assertSafeEntryPath} and anchored with
 * {@link normalizeEntryArg} so a future caller cannot smuggle a flag past
 * `spawn({ shell: false })` into the runtime's argv parser. See
 * `SECURITY.md` § "CLI threat model" for the full rationale (and why we
 * are not vulnerable to the class of bug Snyk reported as CVE-2022-22984).
 *
 * @param runtime - Host runtime to build the command for.
 * @param entry - Entry file to run; validated and `./`-anchored before use.
 * @returns The executable name and argv array to pass to `spawn({ shell: false })`.
 * @throws Error via {@link assertSafeEntryPath} when the entry path is unsafe.
 * @since 0.3.0
 */
export function buildDevCommand(runtime: DevRuntime, entry: string): { command: string; args: string[] } {
  assertSafeEntryPath(entry, "daloy dev");
  const safe = normalizeEntryArg(entry);
  switch (runtime) {
    case "bun":
      return { command: "bun", args: ["--hot", safe] };
    case "deno":
      return {
        command: "deno",
        args: ["run", "--watch", "--allow-net", "--allow-env", "--allow-read", safe],
      };
    case "node":
    default:
      return { command: "node", args: ["--watch", safe] };
  }
}

/**
 * Pick the first existing dev entry. Unlike `loadApp` we can't `import()`
 * to probe (we'd execute the user's server twice) so we rely on the file
 * system via `node:fs` when available; on edge runtimes we just return the
 * first candidate.
 */
async function resolveDevEntry(entry: string | undefined): Promise<string> {
  if (entry) {
    assertSafeEntryPath(entry, "daloy dev");
    return entry;
  }
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const proc = (globalThis as { process?: { cwd?: () => string } }).process;
    const cwd = proc?.cwd?.() ?? ".";
    for (const candidate of DEFAULT_DEV_ENTRIES) {
      if (fs.existsSync(path.join(cwd, candidate))) return candidate;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    `Could not find a dev entry. Tried: ${DEFAULT_DEV_ENTRIES.join(", ")}.\n` +
      `Pass an explicit path: daloy dev ./src/server.ts`
  );
}

/**
 * Parse a process-style argv (without the `node`/`daloy` prefix) into a
 * `{ command, opts }` pair. Throws on unknown flags or invalid enum values.
 *
 * @param argv - Arguments after the binary name, e.g. `["inspect", "--json", "./src/server.ts"]`.
 * @returns The resolved command (default `"inspect"`) and parsed {@link CliOptions}.
 * @throws Error on unknown `-`-prefixed flags, missing flag values, or invalid `--format`/`--runtime` values.
 */
export function parseArgs(argv: readonly string[]): { command: string; opts: CliOptions } {
  const opts: CliOptions = {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: false,
    help: false,
    version: false,
  };
  let command = "inspect";
  let i = 0;
  if (argv[0] === "inspect" || argv[0] === "dev" || argv[0] === "help" || argv[0] === "doctor" || argv[0] === "diff") {
    command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "--json":
        opts.json = true;
        break;
      case "--check":
        opts.check = true;
        break;
      case "--schemas":
        opts.schemas = true;
        break;
      case "--openapi":
        opts.openapi = true;
        break;
      case "--asyncapi":
        opts.asyncapi = true;
        break;
      case "--ai":
        opts.ai = true;
        break;
      case "--yaml":
        opts.format = "yaml";
        break;
      case "--format": {
        const value = readFlagValue(argv, ++i, "--format").toLowerCase();
        if (value !== "json" && value !== "yaml") {
          throw new Error(`--format must be one of: json, yaml (got: ${value})`);
        }
        opts.format = value;
        break;
      }
      case "--tag":
        opts.tag = readFlagValue(argv, ++i, "--tag");
        break;
      case "--method":
        opts.method = readFlagValue(argv, ++i, "--method").toUpperCase();
        break;
      case "--runtime": {
        const value = readFlagValue(argv, ++i, "--runtime").toLowerCase();
        if (value !== "node" && value !== "bun" && value !== "deno") {
          throw new Error(`--runtime must be one of: node, bun, deno (got: ${value})`);
        }
        opts.runtime = value;
        break;
      }
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      case "--audit-secrets":
        opts.auditSecrets = true;
        break;
      case "--no-audit-defaults":
        opts.noAuditDefaults = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        (opts.positionals ??= []).push(a);
        opts.entry = a;
    }
  }
  return { command, opts };
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Execute the CLI against the supplied argv and {@link CliIO}. Does not read
 * `process.argv`, write to process stdio, or call `process.exit()` directly,
 * so tests can drive `inspect`/`dev`/`doctor` with in-memory stdio.
 *
 * @param argv - Process-style arguments (without the `node`/`daloy` prefix); see {@link parseArgs}.
 * @param io - I/O hooks for stdout/stderr, module import, spawning, and file reads.
 * @returns A {@link CliResult} whose `exitCode` the caller feeds to `process.exit()`.
 */
export async function runCli(argv: readonly string[], io: CliIO): Promise<CliResult> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${HELP}`);
    return { exitCode: 2 };
  }
  const { command, opts } = parsed;
  if (opts.help || command === "help") {
    io.stdout(HELP);
    return { exitCode: 0 };
  }
  if (opts.version) {
    io.stdout(`${io.version}\n`);
    return { exitCode: 0 };
  }
  if (command === "dev") {
    return runDev(opts, io);
  }
  if (command === "doctor") {
    return runDoctor(opts, io);
  }
  if (command === "diff") {
    return runDiff(opts, io);
  }
  if (command !== "inspect") {
    io.stderr(`Unknown command: ${command}\n\n${HELP}`);
    return { exitCode: 2 };
  }

  let app: App;
  try {
    app = await loadApp(opts.entry, io);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return { exitCode: 1 };
  }

  if (opts.openapi) {
    const doc = generateOpenAPI(app, {
      info: { title: "App", version: "0.0.0" },
    });
    if (opts.format === "yaml") {
      io.stdout(openapiToYAML(doc as unknown as Record<string, unknown>));
      return { exitCode: 0 };
    }
    io.stdout(`${JSON.stringify(doc, null, opts.json ? 0 : 2)}\n`);
    return { exitCode: 0 };
  }

  if (opts.asyncapi) {
    const doc = generateAsyncAPI(app, {
      info: { title: "App", version: "0.0.0" },
    });
    if (opts.format === "yaml") {
      io.stdout(asyncapiToYAML(doc));
      return { exitCode: 0 };
    }
    io.stdout(`${JSON.stringify(doc, null, opts.json ? 0 : 2)}\n`);
    return { exitCode: 0 };
  }

  if (opts.ai) {
    const dump = buildAiDump(app, opts);
    if (opts.format === "yaml") {
      io.stdout(openapiToYAML(dump));
      return { exitCode: 0 };
    }
    io.stdout(`${JSON.stringify(dump, null, opts.json ? 0 : 2)}\n`);
    return { exitCode: 0 };
  }

  const all = app.introspect();
  const routes = filterRoutes(all, opts);

  const issues = opts.check ? await runContractTests(app) : undefined;

  if (opts.json) {
    const payload: Record<string, unknown> = { routes };
    if (issues) payload.contract = issues;
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return { exitCode: issues && !issues.ok ? 1 : 0 };
  }

  io.stdout(formatTable(routes, opts.schemas));

  if (issues) {
    io.stdout(`\n${formatContract(issues)}`);
    if (!issues.ok) return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

function filterRoutes(routes: IntrospectedRoute[], opts: CliOptions): IntrospectedRoute[] {
  return routes
    .filter(
      (r) =>
        (!opts.method || r.method === opts.method) &&
        (!opts.tag || effectiveTags(r).includes(opts.tag)),
    )
    .map((r) => {
      const tags = effectiveTags(r);
      return tags.length > 0 ? { ...r, tags } : r;
    });
}

function effectiveTags(route: IntrospectedRoute): string[] {
  return dedupeTags(route.tags, route.meta?.tags);
}

function formatTable(routes: IntrospectedRoute[], includeSchemas: boolean): string {
  if (routes.length === 0) {
    return "No routes registered (or none matched the filter).\n";
  }
  const header = includeSchemas
    ? ["METHOD", "PATH", "OPERATION ID", "B/Q/P/H", "RESPONSES", "TAGS"]
    : ["METHOD", "PATH", "OPERATION ID", "RESPONSES", "TAGS"];
  const rows: string[][] = [header];
  for (const r of routes) {
    const opId = r.operationId ?? "-";
    const tags = effectiveTags(r).join(",") || "-";
    const responses = r.responses.length === 0 ? "-" : r.responses.sort((a, b) => a - b).join(",");
    if (includeSchemas) {
      const flags = `${r.hasBody ? "B" : "-"}${r.hasQuery ? "Q" : "-"}${r.hasParams ? "P" : "-"}${r.hasHeaders ? "H" : "-"}`;
      rows.push([r.method, r.path, opId, flags, responses, tags]);
    } else {
      rows.push([r.method, r.path, opId, responses, tags]);
    }
  }
  const widths = header.map((_, col) => Math.max(...rows.map((row) => (row[col] ?? "").length)));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const line = row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ");
    out.push(line.trimEnd());
    if (i === 0) out.push(widths.map((w) => "-".repeat(w)).join("  "));
  }
  out.push("");
  out.push(`${routes.length} route${routes.length === 1 ? "" : "s"}.`);
  return `${out.join("\n")}\n`;
}

function formatContract(report: Awaited<ReturnType<typeof runContractTests>>): string {
  const out: string[] = [];
  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");
  out.push(
    `Contract checks: ${report.checked} route${report.checked === 1 ? "" : "s"} · ` +
      `${errors.length} error${errors.length === 1 ? "" : "s"} · ` +
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
  );
  for (const issue of report.issues) {
    out.push(`  [${issue.level}] ${issue.route}: ${issue.message}`);
  }
  if (report.ok) out.push("OK.");
  else out.push("FAIL.");
  return `${out.join("\n")}\n`;
}

/**
 * `daloy diff <baseline> <current>` — compare two OpenAPI 3.1 JSON documents
 * and report added, removed, and changed operations. Exits 1 when a breaking
 * change is detected so it can gate CI; `--json` emits machine-readable output.
 *
 * @internal
 */
async function runDiff(opts: CliOptions, io: CliIO): Promise<CliResult> {
  const positionals = opts.positionals ?? [];
  if (positionals.length !== 2) {
    io.stderr(`daloy diff requires two file paths: <baseline> <current>\n\n${HELP}`);
    return { exitCode: 2 };
  }
  if (!io.readTextFile) {
    io.stderr("daloy diff: this environment cannot read files.\n");
    return { exitCode: 2 };
  }
  const [baselinePath, currentPath] = positionals as [string, string];

  let baseline: unknown;
  let current: unknown;
  try {
    baseline = JSON.parse(await io.readTextFile(baselinePath));
    current = JSON.parse(await io.readTextFile(currentPath));
  } catch (err) {
    io.stderr(`daloy diff: failed to read or parse input: ${(err as Error).message}\n`);
    return { exitCode: 1 };
  }

  const result = diffOpenAPI(baseline, current);
  const hasBreaking = result.breaking.length > 0;

  if (opts.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return { exitCode: hasBreaking ? 1 : 0 };
  }

  const out: string[] = [];
  const fmt = (c: OpenAPIChange) =>
    `  [${c.severity === "breaking" ? "BREAKING" : "ok"}] ${c.kind} ${c.location}` +
    (c.detail ? ` — ${c.detail}` : "");
  const total = result.breaking.length + result.nonBreaking.length;
  if (total === 0) {
    out.push("Specs match: no changes detected.");
  } else {
    out.push(`OpenAPI changes: ${total} · ${result.breaking.length} breaking`);
    for (const change of result.breaking) out.push(fmt(change));
    for (const change of result.nonBreaking) out.push(fmt(change));
  }
  out.push(hasBreaking ? "FAIL: breaking changes detected." : "OK.");
  io.stdout(`${out.join("\n")}\n`);
  return { exitCode: hasBreaking ? 1 : 0 };
}

/**
 * `daloy doctor` — boot-time + CLI audit. Loads the user's
 * App entry and runs the secure-by-default checklist so the command can guard
 * container `HEALTHCHECK` and CI deploy steps.
 *
 * Exit code: non-zero (`1`) only when at least one **`error`-level** finding is
 * present; `warn`-level findings are advisory and leave the exit code at `0`.
 * The `--json` output reports `ok: true` only when there are **no findings at
 * all** (any level), so `ok` is a stricter signal than the exit code — a
 * warn-only run prints `ok: false` but still exits `0`.
 *
 * @internal
 */
async function runDoctor(opts: CliOptions, io: CliIO): Promise<CliResult> {
  type Finding = { level: "error" | "warn"; code: string; message: string };
  const findings: Finding[] = [];

  let app: App | undefined;
  try {
    app = await loadApp(opts.entry, io);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return { exitCode: 1 };
  }

  const o = (app as unknown as { options: Record<string, unknown> }).options;
  const isProd =
    (o.env as string) === "production" ||
    o.production === true ||
    (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === "production";

  if (opts.noAuditDefaults !== true) {
    if (isProd && o.trustProxy === undefined && o.behindProxy === undefined) {
      findings.push({
        level: "error",
        code: "behindProxy.unset",
        message:
          "behindProxy / trustProxy is unset in production. Forwarded headers will be refused or trusted ambiguously. " +
          "Declare app({ behindProxy: 'none' | 'loopback' | { hops } | { cidrs } }) explicitly.",
      });
    }
    if (o.secureDefaults === false) {
      findings.push({
        level: "warn",
        code: "secureDefaults.off",
        message: "secureDefaults: false disables every hardening default.",
      });
    }
    if (o.requestTimeoutMs === 0) {
      findings.push({
        level: "error",
        code: "requestTimeout.zero",
        message: "requestTimeoutMs is 0 — slow-loris attacks can hold connections forever.",
      });
    }
    if (o.disconnectStatusCode !== undefined && o.disconnectStatusCode !== 0) {
      const v = o.disconnectStatusCode as number;
      if (!Number.isInteger(v) || v < 400 || v > 499) {
        findings.push({
          level: "error",
          code: "disconnectStatusCode.range",
          message: `disconnectStatusCode ${v} outside [400, 499].`,
        });
      }
    }

    // Live-config audits for CORS, body-size, idle timeout,
    // validation-detail / framework-identity leaks, and side-channel
    // exposure. Static grep gates, existing verify scripts,
    // feature-specific tests, and forward-looking gates cover the
    // remaining audit items.

    // CORS default posture audit. The framework refuses
    // `origin: '*'` + `credentials: true` outright at construction; the
    // doctor surfaces any `maxAge` greater than 24 h (86400 s) so
    // reviewers re-evaluate the trade-off vs the documented strictest
    // competitor.
    const cors = (o.cors as Record<string, unknown> | undefined) ?? undefined;
    if (cors !== undefined) {
      const maxAge = cors.maxAge;
      if (typeof maxAge === "number" && maxAge > 86_400) {
        findings.push({
          level: "warn",
          code: "audit.cors.maxAge",
          message:
            `cors({ maxAge: ${maxAge} }) exceeds 24 h. Long preflight ` +
            "caches amplify the blast radius of an inadvertently widened " +
            "Access-Control-Allow-* policy. Re-evaluate against the " +
            "strictest documented competitor.",
        });
      }
      if (cors.origin === "*" && cors.credentials === true) {
        // The framework already refuses-at-construction, but a custom
        // adapter that side-channels the cors() options would bypass
        // that — surface it here too.
        findings.push({
          level: "error",
          code: "audit.cors.wildcardCredentials",
          message:
            "cors({ origin: '*', credentials: true }) is forbidden — the " +
            "browser will silently drop credentials anyway, but the " +
            "configuration signals intent that does not match reality.",
        });
      }
    }

    // Body-size cap audit. The framework's default
    // `bodyLimitBytes` is 1 MiB and is enforced alongside per-content-
    // type multipart limits. Surface an unusually high blanket cap (>
    // 25 MiB) as a warning — at that scale the developer probably
    // meant to set a per-content-type cap on the multipart endpoint
    // and accidentally widened the JSON parser too.
    const bodyLimitBytes = o.bodyLimitBytes;
    if (typeof bodyLimitBytes === "number" && bodyLimitBytes > 25 * 1024 * 1024) {
      findings.push({
        level: "warn",
        code: "audit.bodyLimit.blanket",
        message:
          `bodyLimitBytes is ${bodyLimitBytes} (> 25 MiB). ` +
          "Use per-content-type caps for any limit this generous so " +
          "JSON parsers are not DoS-amplified by a multipart-sized blob.",
      });
    }

    // Header-count cap audit. The framework's portable maxHeaderCount
    // guard is the application-tier defence against header-*count*
    // amplification (the "HTTP/2 Bomb" dimension). Surface a finding when
    // it is disabled (0) or raised to an implausibly generous value, both
    // of which let a header flood reach routing.
    const maxHeaderCount = o.maxHeaderCount;
    if (maxHeaderCount === 0) {
      findings.push({
        level: "warn",
        code: "audit.maxHeaderCount.disabled",
        message:
          "maxHeaderCount is 0 — the header-count flood guard is disabled. " +
          "A request carrying thousands of header fields reaches routing. " +
          "Keep a finite cap (default 100) unless an upstream proxy already " +
          "enforces one (NGINX max_headers, Node server.maxHeadersCount).",
      });
    } else if (typeof maxHeaderCount === "number" && maxHeaderCount > 1000) {
      findings.push({
        level: "warn",
        code: "audit.maxHeaderCount.blanket",
        message:
          `maxHeaderCount is ${maxHeaderCount} (> 1000). Realistic requests ` +
          "carry a few dozen headers; a cap this high weakens the " +
          "header-count amplification defence.",
      });
    }

    // JSON structural limits audit. The new jsonMaxKeys / jsonMaxDepth
    // guards protect against hash-flood / deep-nesting DoS inside the byte
    // limit. Surface when disabled (0) or raised to an implausibly high
    // value.
    const jsonMaxKeys = o.jsonMaxKeys;
    if (jsonMaxKeys === 0) {
      findings.push({
        level: "warn",
        code: "audit.jsonMaxKeys.disabled",
        message:
          "jsonMaxKeys is 0 — the wide-object / hash-flood structural limit " +
          "is disabled. An attacker can send tens or hundreds of thousands " +
          "of keys in a body that still fits under bodyLimitBytes.",
      });
    } else if (typeof jsonMaxKeys === "number" && jsonMaxKeys > 100_000) {
      findings.push({
        level: "warn",
        code: "audit.jsonMaxKeys.blanket",
        message:
          `jsonMaxKeys is ${jsonMaxKeys} (> 100k). A cap this high weakens ` +
          "protection against wide-object DoS payloads.",
      });
    }

    const jsonMaxDepth = o.jsonMaxDepth;
    if (jsonMaxDepth === 0) {
      findings.push({
        level: "warn",
        code: "audit.jsonMaxDepth.disabled",
        message:
          "jsonMaxDepth is 0 — deep nesting DoS protection is disabled.",
      });
    } else if (typeof jsonMaxDepth === "number" && jsonMaxDepth > 200) {
      findings.push({
        level: "warn",
        code: "audit.jsonMaxDepth.blanket",
        message:
          `jsonMaxDepth is ${jsonMaxDepth} (> 200). Extremely deep JSON is ` +
          "almost never legitimate and can amplify CPU during validation.",
      });
    }

    // Idle-timeout / request-timeout audit. Reaffirms the
    // existing requestTimeoutMs check; also surface an explicit zero
    // idleTimeoutMs in production. The framework also keeps adapter
    // defaults non-zero, but a developer-supplied override is surfaced
    // here.
    const idleTimeoutMs = o.idleTimeoutMs;
    if (isProd && idleTimeoutMs === 0) {
      findings.push({
        level: "error",
        code: "audit.idleTimeout.zero",
        message:
          "idleTimeoutMs is 0 in production — adapters keep slow-loris " +
          "connections open indefinitely.",
      });
    }

    // Validation-detail / framework-identity leak audit. The
    // framework refuses-at-construction any opt-in named
    // `allowUnsafeValidationDetails` / `exposeFrameworkIdentity`. The
    // doctor double-checks the live options because a custom plugin
    // could mutate the object after construction.
    if (o.allowUnsafeValidationDetails === true) {
      findings.push({
        level: "error",
        code: "audit.validationDetails.leak",
        message:
          "allowUnsafeValidationDetails: true would expose schema paths " +
          "to clients in production. The knob does not exist in the " +
          "public type — a custom plugin must have set it. Remove it.",
      });
    }
    if (o.exposeFrameworkIdentity === true) {
      findings.push({
        level: "error",
        code: "audit.identityLeak",
        message:
          "exposeFrameworkIdentity: true would emit Server / X-Powered-By " +
          "naming the framework + version.",
      });
    }

    // Side-channel / timing exposure audit. Forbid any
    // first-party middleware that attaches Server-Timing in production
    // without authentication. The marker is the opt-in flag
    // `enableServerTimingInProduction` that the framework's `timing()`
    // helper refuses-at-construction; this doctor check is a
    // defense-in-depth against custom plugins setting the same flag.
    if (isProd && o.enableServerTimingInProduction === true) {
      findings.push({
        level: "error",
        code: "audit.serverTiming.production",
        message:
          "Server-Timing in production leaks performance side channels. " +
          "Disable or gate behind authenticated routes.",
      });
    }

    // Response-body-schema coverage audit (OWASP API3 — Broken Object
    // Property Level Authorization). Response-field stripping only runs when
    // a 2xx response declares a body schema; a schema-less 2xx ships whatever
    // the handler returns, so a stray `passwordHash` or spread ORM row would
    // leak. Advisory (warn) because a route may legitimately return no body.
    const routes =
      (app as unknown as {
        routes?: readonly { method: string; path: string; responses: Record<number, unknown> }[];
      }).routes ?? [];
    const missingBody = findRoutesMissingResponseBodySchema(routes as any);
    if (missingBody.length > 0) {
      const sample = missingBody
        .slice(0, 5)
        .map((r) => `${r.method} ${r.path} (${r.statuses.join("/")})`)
        .join(", ");
      findings.push({
        level: "warn",
        code: "audit.response.bodySchema",
        message:
          `${missingBody.length} route(s) declare a 2xx response with no body schema, so ` +
          `response field-level stripping (OWASP API3) is not applied: ${sample}` +
          `${missingBody.length > 5 ? ", …" : ""}. Declare a response body schema so undeclared ` +
          "handler fields cannot leak, or set `acknowledgeNoResponseBodySchema: true` on routes " +
          "that intentionally return an opaque or body-less response.",
      });
    }
  }

  if (opts.auditSecrets === true) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const weak = new Set(["changeme", "secret", "password", "your-secret", "it-is-very-secret"]);
    for (const [key, val] of Object.entries(env)) {
      if (!val) continue;
      if (!/(secret|token|key|password|signing)/i.test(key)) continue;
      if (weak.has(val.toLowerCase())) {
        findings.push({
          level: "error",
          code: "secret.weak",
          message: `${key} matches a known-weak placeholder.`,
        });
      } else if (val.length < 32 && isProd) {
        findings.push({
          level: "warn",
          code: "secret.short",
          message: `${key} is shorter than 32 bytes (production).`,
        });
      }
    }
  }

  if (opts.json) {
    io.stdout(`${JSON.stringify({ ok: findings.length === 0, findings }, null, 2)}\n`);
  } else {
    if (findings.length === 0) {
      io.stdout("daloy doctor: OK — no findings.\n");
    } else {
      io.stdout(`daloy doctor: ${findings.length} finding${findings.length === 1 ? "" : "s"}.\n`);
      for (const f of findings) {
        io.stdout(`  [${f.level}] ${f.code}: ${f.message}\n`);
      }
    }
  }
  return { exitCode: findings.some((f) => f.level === "error") ? 1 : 0 };
}

async function runDev(opts: CliOptions, io: CliIO): Promise<CliResult> {
  if (!io.spawn) {
    io.stderr(
      "daloy dev requires a spawn-capable host (use the bundled bin/daloy.mjs CLI).\n"
    );
    return { exitCode: 2 };
  }
  let entry: string;
  try {
    entry = await resolveDevEntry(opts.entry);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
  const runtime = opts.runtime ?? (io.detectRuntime ?? detectRuntime)();
  const { command, args } = buildDevCommand(runtime, entry);
  io.stdout(`daloy dev: ${runtime} → ${command} ${args.join(" ")}\n`);
  try {
    const code = await io.spawn(command, args);
    return { exitCode: code };
  } catch (err) {
    io.stderr(`daloy dev: failed to start: ${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
}

/**
 * Build the `daloy inspect --ai` payload: the registered route catalog
 * paired with JSON-Schema dumps of every request/response schema and any
 * `meta.examples` declared on the route. The payload is intentionally
 * stable and self-describing so LLMs and SDK builders can consume it
 * without round-tripping through OpenAPI.
 *
 * @param app - Loaded App whose route registry is dumped.
 * @param opts - Parsed CLI options; `--tag` / `--method` filter the catalog.
 * @returns JSON-serializable dump with `daloy.ai` version marker, `generatedAt`, and the `routes` array.
 * @since 0.14.0
 */
export function buildAiDump(app: App, opts: CliOptions): Record<string, unknown> {
  const introspected = filterRoutes(app.introspect(), opts);
  const indexById = new Map<string, IntrospectedRoute>();
  for (const r of introspected) indexById.set(`${r.method} ${r.path}`, r);

  const routes: Record<string, unknown>[] = [];
  for (const def of app.routes as RouteDefinition[]) {
    const id = `${def.method} ${def.path}`;
    if (!indexById.has(id)) continue;
    const meta: RouteMeta | undefined = (def as { meta?: RouteMeta }).meta;
    const entry: Record<string, unknown> = {
      method: def.method,
      path: def.path,
      ...(def.operationId ? { operationId: def.operationId } : {}),
      ...(def.summary ?? meta?.summary
        ? { summary: def.summary ?? meta?.summary }
        : {}),
      ...(def.description ?? meta?.description
        ? { description: def.description ?? meta?.description }
        : {}),
      tags: dedupeTags(def.tags, meta?.tags),
      ...(def.deprecated ? { deprecated: true } : {}),
      ...(def.auth ? { auth: def.auth } : {}),
      request: aiRequest(def.request),
      responses: aiResponses(def.responses),
    };
    if (meta?.examples) entry.examples = meta.examples;
    if (meta?.extensions) entry.extensions = meta.extensions;
    routes.push(entry);
  }

  return {
    daloy: { ai: 1 },
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    routes,
  };
}

function dedupeTags(a: string[] | undefined, b: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function aiRequest(req: RouteDefinition["request"]): Record<string, unknown> {
  if (!req) return {};
  const out: Record<string, unknown> = {};
  for (const part of ["params", "query", "headers", "body"] as const) {
    const schema = req[part];
    if (schema) out[part] = aiSchema(schema);
  }
  return out;
}

function aiResponses(
  responses: RouteDefinition["responses"]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [status, spec] of Object.entries(responses)) {
    if (!spec) continue;
    const entry: Record<string, unknown> = { description: spec.description };
    if (spec.body) entry.body = aiSchema(spec.body);
    if (spec.examples) entry.examples = spec.examples;
    out[status] = entry;
  }
  return out;
}

function aiSchema(schema: unknown): unknown {
  const anySchema = schema as { toJSONSchema?: () => unknown };
  if (typeof anySchema?.toJSONSchema === "function") {
    try {
      return anySchema.toJSONSchema();
    } catch {
      /* fall through */
    }
  }
  return {};
}

async function loadApp(entry: string | undefined, io: CliIO): Promise<App> {
  if (entry !== undefined) assertSafeEntryPath(entry, "daloy inspect");
  const candidates = entry ? [entry] : DEFAULT_ENTRIES.slice();
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const mod = (await io.importEntry(candidate)) as Record<string, unknown>;
      const app = pickApp(mod);
      if (app) return app;
      lastErr = new Error(
        `Loaded "${candidate}" but it did not export an App instance ` +
          `or a zero-argument buildApp()/createApp() factory.`
      );
    } catch (err) {
      lastErr = err;
    }
  }
  if (entry) {
    throw new Error(
      `Could not load App from "${entry}": ${(lastErr as Error)?.message ?? String(lastErr)}`
    );
  }
  throw new Error(
    `Could not find an App entry. Tried: ${DEFAULT_ENTRIES.join(", ")}.\n` +
      `Pass an explicit path: daloy inspect ./path/to/app.ts`
  );
}

function pickApp(mod: Record<string, unknown>): App | undefined {
  for (const key of ["default", "app", "default_app"]) {
    const candidate = mod[key];
    if (isApp(candidate)) return candidate;
  }
  const factory = pickAppFactory(mod);
  if (factory) {
    const candidate = factory();
    if (isApp(candidate)) return candidate;
  }
  // Fallback: scan all named exports.
  for (const value of Object.values(mod)) {
    if (isApp(value)) return value;
  }
  return undefined;
}

function pickAppFactory(mod: Record<string, unknown>): (() => unknown) | undefined {
  for (const key of ["buildApp", "createApp"]) {
    const candidate = mod[key];
    if (isZeroArgFactory(candidate)) return candidate;
  }
  const defaultExport = mod.default;
  if (isNamedFactory(defaultExport, ["buildApp", "createApp"])) {
    return defaultExport;
  }
  return undefined;
}

function isZeroArgFactory(value: unknown): value is () => unknown {
  return typeof value === "function" && value.length === 0;
}

function isNamedFactory(value: unknown, names: readonly string[]): value is () => unknown {
  return isZeroArgFactory(value) && names.includes((value as Function).name);
}

function isApp(value: unknown): value is App {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { routes?: unknown }).routes) &&
    typeof (value as { introspect?: unknown }).introspect === "function" &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}
