import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import { runCli, parseArgs, type CliIO } from "../src/cli.js";

function buildIO(app: App | undefined, opts: { failEntry?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => {
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
