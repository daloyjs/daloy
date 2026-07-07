import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import {
  runCli,
  parseArgs,
  type CliIO,
  detectRuntime,
  buildDevCommand,
  assertSafeEntryPath,
  normalizeEntryArg,
} from "../src/cli.js";

function buildIO(
  app: App | undefined,
  opts: { failEntry?: boolean; modulesByEntry?: Record<string, unknown> } = {}
) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async (specifier) => {
      if (opts.modulesByEntry) {
        const hit = opts.modulesByEntry[specifier];
        if (hit !== undefined) return hit;
        throw new Error("ENOENT: no such file");
      }
      if (opts.failEntry) throw new Error("ENOENT: no such file");
      return { default: app };
    },
    version: "0.0.0-test",
  };
  return { io, out, err };
}

function buildAppFixture(): App {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/users/:id",
    operationId: "getUser",
    tags: ["Users"],
    request: { params: z.object({ id: z.string() }) as any },
    responses: {
      200: { description: "ok", body: z.object({ id: z.string() }) as any },
    },
    handler: async ({ params }) => ({ status: 200 as const, body: { id: params.id } }),
  });
  app.route({
    method: "POST",
    path: "/users",
    operationId: "createUser",
    tags: ["Users"],
    request: { body: z.object({ name: z.string() }) as any },
    responses: {
      201: { description: "created", body: z.object({ id: z.string() }) as any },
      400: { description: "bad" },
    },
    handler: async () => ({ status: 201 as const, body: { id: "1" } }),
  });
  return app;
}

test("parseArgs: defaults to inspect with no args", () => {
  const { command, opts } = parseArgs([]);
  assert.equal(command, "inspect");
  assert.equal(opts.json, false);
  assert.equal(opts.entry, undefined);
});

test("parseArgs: parses flags and entry", () => {
  const { command, opts } = parseArgs([
    "inspect",
    "--json",
    "--check",
    "--schemas",
    "--openapi",
    "--tag",
    "Users",
    "--method",
    "get",
    "src/app.ts",
  ]);
  assert.equal(command, "inspect");
  assert.equal(opts.json, true);
  assert.equal(opts.check, true);
  assert.equal(opts.schemas, true);
  assert.equal(opts.openapi, true);
  assert.equal(opts.tag, "Users");
  assert.equal(opts.method, "GET");
  assert.equal(opts.entry, "src/app.ts");
});

test("parseArgs: skips sparse argv holes", () => {
  const sparse = ["--json", undefined, "src/app.ts"] as unknown as string[];
  const { opts } = parseArgs(sparse);
  assert.equal(opts.json, true);
  assert.equal(opts.entry, "src/app.ts");
});

test("parseArgs: short flags help and version", () => {
  assert.equal(parseArgs(["-h"]).opts.help, true);
  assert.equal(parseArgs(["--help"]).opts.help, true);
  assert.equal(parseArgs(["-v"]).opts.version, true);
  assert.equal(parseArgs(["--version"]).opts.version, true);
});

test("parseArgs: rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--nope"]), /Unknown flag/);
});

test("parseArgs: rejects flags with missing values", () => {
  assert.throws(() => parseArgs(["--tag"]), /--tag requires a value/);
  assert.throws(() => parseArgs(["--method", "--json"]), /--method requires a value/);
});

test("parseArgs: 'help' positional command", () => {
  assert.equal(parseArgs(["help"]).command, "help");
});

test("parseArgs: 'inspect' positional command consumes the command token", () => {
  const { command, opts } = parseArgs(["inspect", "src/app.ts"]);
  assert.equal(command, "inspect");
  assert.equal(opts.entry, "src/app.ts");
});

test("runCli: --help prints usage", async () => {
  const { io, out } = buildIO(undefined);
  const r = await runCli(["--help"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /Usage:/);
});

test("runCli: 'help' command prints usage", async () => {
  const { io, out } = buildIO(undefined);
  const r = await runCli(["help"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /daloy inspect/);
});

test("runCli: --version prints io.version", async () => {
  const { io, out } = buildIO(undefined);
  const r = await runCli(["--version"], io);
  assert.equal(r.exitCode, 0);
  assert.equal(out.join("").trim(), "0.0.0-test");
});

test("runCli: unknown flag exits 2 with usage", async () => {
  const { io, err } = buildIO(undefined);
  const r = await runCli(["--nope"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /Unknown flag/);
});

test("runCli: first unknown positional is treated as an entry path", async () => {
  const { io, err } = buildIO(undefined);
  const r = await runCli(["wat"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /Could not load App/);
});

test("runCli: missing flag value exits 2 with usage", async () => {
  const { io, err } = buildIO(undefined);
  const r = await runCli(["--tag"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /--tag requires a value/);
});

test("runCli: prints table by default", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["inspect", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /METHOD/);
  assert.match(text, /\/users\/:id/);
  assert.match(text, /getUser/);
  assert.match(text, /2 routes\./);
});

test("runCli: --schemas adds B/Q/P/H column", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--schemas", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /B\/Q\/P\/H/);
  assert.match(text, /--P-/); // GET /users/:id has params only
  assert.match(text, /B---/); // POST /users has body only
});

test("runCli: --tag filters routes", async () => {
  const app = buildAppFixture();
  app.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    tags: ["Ops"],
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { io, out } = buildIO(app);
  const r = await runCli(["--tag", "Ops", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /\/health/);
  assert.doesNotMatch(text, /\/users/);
  assert.match(text, /1 route\./);
});

test("runCli: one-route table includes header separator", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const { io, out } = buildIO(app);
  const r = await runCli(["src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /------/);
  assert.match(out.join(""), /1 route\./);
});

test("runCli: inspect auto-discovers src/build-app.ts factories", async () => {
  const buildApp = () => buildAppFixture();
  const { io, out } = buildIO(undefined, {
    modulesByEntry: {
      "src/build-app.ts": { buildApp, default: buildApp },
    },
  });
  const r = await runCli(["inspect"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /METHOD/);
  assert.match(text, /\/users\/:id/);
  assert.match(text, /2 routes\./);
});

test("runCli: --method filters routes", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--method", "post", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /POST/);
  assert.doesNotMatch(text, /GET /);
});

test("runCli: empty filter result prints message", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--tag", "Nope", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /No routes registered/);
});

test("runCli: --json prints JSON", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--json", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  assert.ok(Array.isArray(parsed.routes));
  assert.equal(parsed.routes.length, 2);
});

test("runCli: --check passes for clean app", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--check", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /OK\./);
});

test("runCli: --check fails on missing operationId", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/missing",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const { io, out, err } = buildIO(app);
  const r = await runCli(["--check", "src/app.ts"], io);
  assert.equal(r.exitCode, 1);
  const text = out.join("") + err.join("");
  assert.match(text, /Missing operationId/);
  assert.match(text, /FAIL\./);
});

test("runCli: --check --json returns contract payload and exit 1 on fail", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const { io, out } = buildIO(app);
  const r = await runCli(["--check", "--json", "src/app.ts"], io);
  assert.equal(r.exitCode, 1);
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.contract.ok, false);
  assert.ok(parsed.contract.issues.length >= 1);
});

test("runCli: --openapi prints OpenAPI JSON", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--openapi", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const doc = JSON.parse(out.join(""));
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.paths["/users/{id}"]);
});

test("runCli: --openapi --json prints compact JSON", async () => {
  const { io, out } = buildIO(buildAppFixture());
  const r = await runCli(["--openapi", "--json", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("").trim();
  // Compact: no leading-space indentation.
  assert.ok(!text.includes("\n  "));
});

test("runCli: missing entry surfaces a friendly error", async () => {
  const { io, err } = buildIO(undefined, { failEntry: true });
  const r = await runCli(["src/app.ts"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /Could not load App/);
});

test("runCli: default entries tried when none given", async () => {
  const { io, err } = buildIO(undefined, { failEntry: true });
  const r = await runCli([], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /Tried: src\/app\.ts/);
});

test("runCli: rejects entry that does not export an App", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({ notAnApp: 42 }),
    version: "0.0.0",
  };
  const r = await runCli(["src/app.ts"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /did not export an App|Could not load App/);
});

test("runCli: picks app from named export when default missing", async () => {
  const app = buildAppFixture();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ app }),
    version: "0.0.0",
  };
  const r = await runCli(["src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /getUser/);
});

test("runCli: picks app from arbitrary named export as fallback", async () => {
  const app = buildAppFixture();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ myServer: app }),
    version: "0.0.0",
  };
  const r = await runCli(["src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /createUser/);
});

// ---------- `daloy dev` ----------

test("parseArgs: recognizes dev as a command", () => {
  const { command, opts } = parseArgs(["dev"]);
  assert.equal(command, "dev");
  assert.equal(opts.entry, undefined);
});

test("parseArgs: dev accepts an entry positional", () => {
  const { command, opts } = parseArgs(["dev", "src/server.ts"]);
  assert.equal(command, "dev");
  assert.equal(opts.entry, "src/server.ts");
});

test("detectRuntime: returns 'node' under standard test env", () => {
  assert.equal(detectRuntime(), "node");
});

test("buildDevCommand: node uses native --watch (built-in type stripping)", () => {
  assert.deepEqual(buildDevCommand("node", "src/server.ts"), {
    command: "node",
    args: ["--watch", "./src/server.ts"],
  });
});

test("buildDevCommand: bun uses --hot", () => {
  assert.deepEqual(buildDevCommand("bun", "src/server.ts"), {
    command: "bun",
    args: ["--hot", "./src/server.ts"],
  });
});

test("buildDevCommand: deno uses run --watch with safe permissions", () => {
  assert.deepEqual(buildDevCommand("deno", "src/server.ts"), {
    command: "deno",
    args: ["run", "--watch", "--allow-net", "--allow-env", "--allow-read", "./src/server.ts"],
  });
});

test("buildDevCommand: preserves already-anchored relative paths", () => {
  assert.deepEqual(buildDevCommand("node", "./src/server.ts").args, ["--watch", "./src/server.ts"]);
  assert.deepEqual(buildDevCommand("node", "../sibling/server.ts").args, [
    "--watch",
    "../sibling/server.ts",
  ]);
});

test("buildDevCommand: preserves absolute paths", () => {
  assert.deepEqual(buildDevCommand("bun", "/abs/server.ts").args, ["--hot", "/abs/server.ts"]);
});

test("buildDevCommand: rejects flag-like entry paths (argv injection guard)", () => {
  // Defense-in-depth against the class of bug Snyk reported as CVE-2022-22984
  // (command-injection via CLI flags constructing argv for spawned children).
  // Even though spawn() runs with shell:false, the *runtime's* own argv
  // parser would happily interpret a leading dash as a flag — so we refuse
  // it before it reaches Node/Bun/Deno.
  for (const bad of ["--eval=1+1", "-e", "--inspect-brk=0.0.0.0", "--watch=evil"]) {
    assert.throws(() => buildDevCommand("node", bad), /must not start with "-"/);
  }
});

test("buildDevCommand: rejects NUL bytes and newlines in entry paths", () => {
  assert.throws(() => buildDevCommand("node", "src/server.ts\0evil"), /NUL bytes or newlines/);
  assert.throws(() => buildDevCommand("node", "src/server.ts\nrm -rf /"), /NUL bytes or newlines/);
  assert.throws(() => buildDevCommand("node", "src/server.ts\r\nfoo"), /NUL bytes or newlines/);
});

test("buildDevCommand: rejects empty entry", () => {
  assert.throws(() => buildDevCommand("node", ""), /non-empty string/);
});

test("assertSafeEntryPath / normalizeEntryArg: behave as documented", () => {
  assert.doesNotThrow(() => assertSafeEntryPath("src/app.ts", "ctx"));
  assert.doesNotThrow(() => assertSafeEntryPath("./src/app.ts", "ctx"));
  assert.doesNotThrow(() => assertSafeEntryPath("/abs/app.ts", "ctx"));
  assert.throws(() => assertSafeEntryPath("-eval", "ctx"), /must not start with "-"/);
  assert.throws(() => assertSafeEntryPath("", "ctx"), /non-empty/);
  assert.equal(normalizeEntryArg("src/app.ts"), "./src/app.ts");
  assert.equal(normalizeEntryArg("./src/app.ts"), "./src/app.ts");
  assert.equal(normalizeEntryArg("../sibling/app.ts"), "../sibling/app.ts");
  assert.equal(normalizeEntryArg("/abs/app.ts"), "/abs/app.ts");
  assert.equal(normalizeEntryArg("C:\\Users\\x\\app.ts"), "C:\\Users\\x\\app.ts");
  assert.equal(normalizeEntryArg("D:/x/app.ts"), "D:/x/app.ts");
});

test("runCli dev: errors when spawn helper is not provided", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({}),
    version: "0.0.0",
  };
  const r = await runCli(["dev", "src/server.ts"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /spawn/);
});

test("runCli dev: invokes spawn with the runtime-specific command", async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({}),
    version: "0.0.0",
    spawn: async (command, args) => {
      calls.push({ command, args });
      return 0;
    },
    detectRuntime: () => "bun",
  };
  const r = await runCli(["dev", "src/server.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "bun");
  assert.deepEqual(Array.from(calls[0]!.args), ["--hot", "./src/server.ts"]);
  assert.match(out.join(""), /bun → bun --hot \.\/src\/server\.ts/);
});

test("runCli dev: propagates child exit code", async () => {
  const io: CliIO = {
    stdout: () => {},
    stderr: () => {},
    importEntry: async () => ({}),
    version: "0.0.0",
    spawn: async () => 137,
    detectRuntime: () => "node",
  };
  const r = await runCli(["dev", "src/server.ts"], io);
  assert.equal(r.exitCode, 137);
});

test("runCli dev: returns 1 when spawn rejects", async () => {
  const err: string[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: (c) => err.push(c),
    importEntry: async () => ({}),
    version: "0.0.0",
    spawn: async () => {
      throw new Error("ENOENT bun");
    },
    detectRuntime: () => "bun",
  };
  const r = await runCli(["dev", "src/server.ts"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /failed to start.*ENOENT bun/);
});

test("runCli dev: with no entry, errors when no default exists", async () => {
  const err: string[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: (c) => err.push(c),
    importEntry: async () => ({}),
    version: "0.0.0",
    spawn: async () => 0,
  };
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => "/__nonexistent_for_dev_test__";
  try {
    const r = await runCli(["dev"], io);
    assert.equal(r.exitCode, 1);
    assert.match(err.join(""), /Could not find a dev entry/);
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
  }
});

test("runCli dev: --runtime flag overrides detection", async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: () => {},
    importEntry: async () => ({}),
    version: "0.0.0",
    spawn: async (command, args) => {
      calls.push({ command, args });
      return 0;
    },
    // Detection says node, but --runtime bun should win.
    detectRuntime: () => "node",
  };
  const r = await runCli(["dev", "--runtime", "bun", "src/server.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.equal(calls[0]!.command, "bun");
  assert.deepEqual(Array.from(calls[0]!.args), ["--hot", "./src/server.ts"]);
});

test("parseArgs: rejects --runtime with an unknown value", () => {
  assert.throws(() => parseArgs(["dev", "--runtime", "deno-fresh"]), /must be one of/);
});

test("parseArgs: --runtime is case-insensitive", () => {
  const { opts } = parseArgs(["dev", "--runtime", "DENO"]);
  assert.equal(opts.runtime, "deno");
});

test("runCli help: includes dev command in help text", async () => {
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({}),
    version: "0.0.0",
  };
  const r = await runCli(["help"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /dev\s+\[entry\]/);
});
