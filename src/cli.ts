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
import { runContractTests } from "./contract.js";
import { generateOpenAPI } from "./openapi.js";

export interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  /** Resolve a user-provided entry specifier to a module to import. */
  importEntry: (specifier: string) => Promise<unknown>;
  /** Version string surfaced by `--version`. */
  version: string;
}

export interface CliResult {
  exitCode: number;
}

export interface CliOptions {
  json: boolean;
  check: boolean;
  schemas: boolean;
  openapi: boolean;
  tag?: string;
  method?: string;
  entry?: string;
  help: boolean;
  version: boolean;
}

const HELP = `daloy — DaloyJS CLI

Usage:
  daloy <command> [options] [entry]

Commands:
  inspect [entry]        Load an App and print its routes (default command).

Options:
  --json                 Print machine-readable JSON instead of a table.
  --check                Run the contract test suite; exit 1 on errors.
  --schemas              Include per-route schema presence (body/query/...).
  --openapi              Print the OpenAPI 3.1 document for the App.
  --tag <tag>            Only show routes that declare this tag.
  --method <method>      Only show routes for this HTTP method.
  -h, --help             Show this help.
  -v, --version          Print the @daloyjs/core version this CLI ships from.

Entry:
  A path to a JS or TS file that exports an App instance, either as the
  default export or as a named export called "app". Defaults to
  ./src/app.ts, then ./src/app.js, then ./app.ts, then ./app.js.

Examples:
  daloy inspect
  daloy inspect --json src/server.ts
  daloy inspect --check
  daloy inspect --openapi > openapi.json
`;

const DEFAULT_ENTRIES: string[] = ["src/app.ts", "src/app.js", "app.ts", "app.js"];

export function parseArgs(argv: readonly string[]): { command: string; opts: CliOptions } {
  const opts: CliOptions = {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    help: false,
    version: false,
  };
  let command = "inspect";
  let i = argv[0] === "inspect" ? 1 : 0;
  // Treat the first positional that isn't a known command as the entry.
  if (argv[0] === "help") { command = "help"; i = 1; }
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
      case "--tag":
        opts.tag = readFlagValue(argv, ++i, "--tag");
        break;
      case "--method":
        opts.method = readFlagValue(argv, ++i, "--method").toUpperCase();
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(`Unknown flag: ${a}`);
        }
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
    io.stdout(`${JSON.stringify(doc, null, opts.json ? 0 : 2)}\n`);
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
  return routes.filter(
    (r) =>
      (!opts.method || r.method === opts.method) &&
      (!opts.tag || Boolean(r.tags?.includes(opts.tag))),
  );
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
    const tags = r.tags?.join(",") ?? "-";
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

async function loadApp(entry: string | undefined, io: CliIO): Promise<App> {
  const candidates = entry ? [entry] : DEFAULT_ENTRIES.slice();
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const mod = (await io.importEntry(candidate)) as Record<string, unknown>;
      const app = pickApp(mod);
      if (app) return app;
      lastErr = new Error(
        `Loaded "${candidate}" but it did not export an App instance ` +
          `(expected default export or "app" named export).`
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
  // Fallback: scan all named exports.
  for (const value of Object.values(mod)) {
    if (isApp(value)) return value;
  }
  return undefined;
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
