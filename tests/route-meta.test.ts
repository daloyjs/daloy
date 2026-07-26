import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import { runContractTests } from "../src/contract.js";
import { generateOpenAPI } from "../src/openapi.js";
import { buildAiDump, runCli, type CliIO } from "../src/cli.js";

function metaApp(): App {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    request: { body: z.object({ title: z.string() }) as any },
    responses: {
      201: {
        description: "created",
        body: z.object({ id: z.string(), title: z.string() }) as any,
      },
      400: { description: "bad" },
    },
    meta: {
      description: "Create a book record.",
      tags: ["AI"],
      examples: {
        happy: {
          summary: "Standard create",
          request: { body: { title: "Dune" } },
          response: { status: 201, body: { id: "1", title: "Dune" } },
        },
      },
      extensions: { "x-codegen-hint": "books" },
    },
    handler: async () => ({
      status: 201 as const,
      body: { id: "1", title: "Dune" },
    }),
  });
  return app;
}

test("OpenAPI surfaces meta examples on request body and response", () => {
  const doc = generateOpenAPI(metaApp(), { info: { title: "T", version: "0" } });
  const op = (doc.paths as any)["/books"].post;
  assert.equal(op.description, "Create a book record.");
  assert.deepEqual(op.tags, ["Books", "AI"]);
  assert.equal(op["x-codegen-hint"], "books");
  assert.ok(op["x-daloy-examples"].happy);
  const reqEx = op.requestBody.content["application/json"].examples;
  assert.deepEqual(reqEx.happy.value, { title: "Dune" });
  assert.equal(reqEx.happy.summary, "Standard create");
  const respEx = op.responses["201"].content["application/json"].examples;
  assert.deepEqual(respEx.happy.value, { id: "1", title: "Dune" });
});

test("contract tests validate meta examples against schemas", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/x",
    operationId: "x",
    request: { body: z.object({ n: z.number() }) as any },
    responses: {
      200: { description: "ok", body: z.object({ n: z.number() }) as any },
    },
    meta: {
      examples: {
        bad: {
          request: { body: { n: "nope" } },
          response: { status: 200, body: { n: "also nope" } },
        },
        unknownStatus: {
          response: { status: 418, body: {} },
        },
      },
    },
    handler: async () => ({ status: 200 as const, body: { n: 1 } }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, false);
  const messages = r.issues.map((i) => i.message).join("\n");
  assert.match(messages, /meta\.examples\["bad"\]\.request\.body/);
  assert.match(messages, /meta\.examples\["bad"\]\.response\.body/);
  assert.match(messages, /meta\.examples\["unknownStatus"\]\.response\.status 418/);
});

test("contract tests accept valid meta examples", async () => {
  const r = await runContractTests(metaApp());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("contract tests validate meta example query/params/headers", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/q/:id",
    operationId: "q",
    request: {
      params: z.object({ id: z.string() }) as any,
      query: z.object({ limit: z.number() }) as any,
      headers: z.object({ "x-token": z.string() }) as any,
    },
    responses: { 200: { description: "ok" } },
    meta: {
      examples: {
        bad: {
          request: {
            params: { id: 123 as any },
            query: { limit: "ten" as any },
            headers: { "x-token": 42 as any },
          },
        },
      },
    },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, false);
  const m = r.issues.map((i) => i.message).join("\n");
  assert.match(m, /request\.params/);
  assert.match(m, /request\.query/);
  assert.match(m, /request\.headers/);
});

test("introspect() includes meta", () => {
  const records = metaApp().introspect();
  assert.equal(records[0]?.meta?.examples?.happy?.response?.status, 201);
});

test("buildAiDump emits routes with schemas and examples", () => {
  const app = metaApp();
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
  });
  assert.equal((dump as any).daloy.ai, 1);
  assert.equal((dump as any).routeCount, 1);
  const route = (dump as any).routes[0];
  assert.equal(route.method, "POST");
  assert.equal(route.path, "/books");
  assert.deepEqual(route.tags, ["Books", "AI"]);
  assert.ok(route.request.body, "JSON schema for request body");
  assert.ok(route.responses["201"].body);
  assert.equal(route.examples.happy.request.body.title, "Dune");
  assert.equal(route.extensions["x-codegen-hint"], "books");
});

test("runCli --ai prints the AI dump JSON", async () => {
  const app = metaApp();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.daloy.ai, 1);
  assert.equal(parsed.routes[0].operationId, "createBook");
});

test("runCli --ai --json prints compact dump", async () => {
  const app = metaApp();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "--json", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("").trim();
  assert.ok(!text.includes("\n  "));
});

test("runCli --ai respects --tag/--method filters", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/a",
    operationId: "a",
    tags: ["A"],
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  app.route({
    method: "POST",
    path: "/b",
    operationId: "b",
    tags: ["B"],
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
    tag: "B",
    method: "POST",
  });
  assert.equal((dump as any).routes.length, 1);
  assert.equal((dump as any).routes[0].path, "/b");
});

test("buildAiDump omits routes rejected by tag filters", () => {
  const app = metaApp();
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
    tag: "Nope",
  });
  assert.equal((dump as any).routeCount, 0);
  assert.deepEqual((dump as any).routes, []);
});

test("runCli --ai rejects missing app entries", async () => {
  const err: string[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: (c) => err.push(c),
    importEntry: async () => {
      throw new Error("entry missing");
    },
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "missing.ts"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /entry missing/);
});

test("runCli --ai rejects modules without an App export", async () => {
  const err: string[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: (c) => err.push(c),
    importEntry: async () => ({ notAnApp: true }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "bad.ts"], io);
  assert.equal(r.exitCode, 1);
  assert.match(err.join(""), /did not export an App instance/);
});

test("runCli --ai respects tags supplied through meta", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/meta-tagged",
    operationId: "metaTagged",
    responses: { 200: { description: "ok" } },
    meta: { tags: ["AI"] },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
    tag: "AI",
  });
  assert.equal((dump as any).routes.length, 1);
  assert.deepEqual((dump as any).routes[0].tags, ["AI"]);
});

test("OpenAPI: route-level summary/description win over meta", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/p",
    operationId: "p",
    summary: "route-summary",
    description: "route-desc",
    responses: { 200: { description: "ok" } },
    meta: {
      summary: "meta-summary",
      description: "meta-desc",
    },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const doc = generateOpenAPI(app, { info: { title: "T", version: "0" } });
  const op = (doc.paths as any)["/p"].get;
  assert.equal(op.summary, "route-summary");
  assert.equal(op.description, "route-desc");
});

test("OpenAPI: meta extension keys without x- prefix get prefixed", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/e",
    operationId: "e",
    responses: { 200: { description: "ok" } },
    meta: { extensions: { codegen: "yes" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const doc = generateOpenAPI(app, { info: { title: "T", version: "0" } });
  const op = (doc.paths as any)["/e"].get;
  assert.equal(op["x-codegen"], "yes");
});

test("OpenAPI: explicit response examples win over meta-derived examples", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/examples",
    operationId: "examples",
    responses: {
      200: {
        description: "ok",
        body: z.object({ source: z.string() }) as any,
        examples: { shared: { source: "response-spec" } },
      },
    },
    meta: {
      examples: {
        shared: { response: { status: 200, body: { source: "meta" } } },
      },
    },
    handler: async () => ({ status: 200 as const, body: { source: "handler" } }),
  });
  const doc = generateOpenAPI(app, { info: { title: "T", version: "0" } });
  const examples = (doc.paths as any)["/examples"].get.responses["200"].content["application/json"]
    .examples;
  assert.deepEqual(examples.shared, { source: "response-spec" });
});

test("contract tests reject unknown meta response status without a body", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/status-only",
    operationId: "statusOnly",
    responses: { 200: { description: "ok" } },
    meta: {
      examples: {
        teapot: { response: { status: 418 } },
      },
    },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, false);
  assert.match(r.issues.map((i) => i.message).join("\n"), /response\.status 418/);
});

test("buildAiDump: aiSchema falls back to {} when toJSONSchema throws or missing", () => {
  const throwingSchema = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: {} }) },
    toJSONSchema: () => {
      throw new Error("nope");
    },
  } as any;
  const plainSchema = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: {} }) },
  } as any;
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/s",
    operationId: "s",
    request: { body: throwingSchema, query: plainSchema },
    responses: {
      200: { description: "ok", body: throwingSchema },
      204: { description: "no body" },
    },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
  });
  const route = (dump as any).routes[0];
  assert.deepEqual(route.request.body, {});
  assert.deepEqual(route.request.query, {});
  assert.deepEqual(route.responses["200"].body, {});
  assert.equal(route.responses["204"].body, undefined);
});

test("buildAiDump: preserves response-level examples", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: {
      200: { description: "ok", examples: { sample: { ok: true } } },
    },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const dump = buildAiDump(app, {
    json: false,
    check: false,
    schemas: false,
    openapi: false,
    asyncapi: false,
    ai: true,
    help: false,
    version: false,
  });
  const route = (dump as any).routes[0];
  assert.deepEqual(route.responses["200"].examples.sample, { ok: true });
});

test("OpenAPI: route with no tags and no meta tags omits tags field", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/u",
    operationId: "u",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const doc = generateOpenAPI(app, { info: { title: "T", version: "0" } });
  const op = (doc.paths as any)["/u"].get;
  assert.equal(op.tags, undefined);
});

test("runCli --ai --yaml prints YAML instead of JSON", async () => {
  const app = metaApp();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "--yaml", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.ok(!text.startsWith("{"), "YAML output must not start with '{'");
  assert.match(text, /^daloy:\n  ai: 1\n/m);
  assert.match(text, /\n  - method: POST\n/);
  assert.match(text, /\n    path: \/books\n/);
  assert.match(text, /title: Dune/);
  assert.ok(!text.includes('"title":'), "YAML must not contain JSON-style quoted keys");
});

test("runCli --ai --format yaml works identically to --yaml", async () => {
  const app = metaApp();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "--format", "yaml", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /^daloy:/);
});

test("runCli --openapi --yaml prints OpenAPI as YAML", async () => {
  const app = metaApp();
  const out: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--openapi", "--yaml", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const text = out.join("");
  assert.match(text, /^openapi: 3\.1\.0\n/);
  assert.match(text, /\n  \/books:\n/);
});

test("runCli rejects unknown --format value", async () => {
  const app = metaApp();
  const err: string[] = [];
  const io: CliIO = {
    stdout: () => {},
    stderr: (c) => err.push(c),
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const r = await runCli(["--ai", "--format", "xml"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /--format must be one of: json, yaml/);
});

test("YAML output is meaningfully smaller than pretty JSON for the same payload", async () => {
  const app = metaApp();
  const jsonOut: string[] = [];
  const yamlOut: string[] = [];
  const ioJson: CliIO = {
    stdout: (c) => jsonOut.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  const ioYaml: CliIO = {
    stdout: (c) => yamlOut.push(c),
    stderr: () => {},
    importEntry: async () => ({ default: app }),
    version: "0.0.0",
  };
  // Default --ai (no --json) is pretty-printed JSON, which is what an
  // LLM system prompt or a human reviewer would actually consume.
  await runCli(["--ai", "src/app.ts"], ioJson);
  await runCli(["--ai", "--yaml", "src/app.ts"], ioYaml);
  const jsonLen = jsonOut.join("").length;
  const yamlLen = yamlOut.join("").length;
  // YAML should be at least 20% smaller than the equivalent pretty JSON.
  assert.ok(
    yamlLen < jsonLen * 0.8,
    `expected YAML (${yamlLen}) < 80% of pretty JSON (${jsonLen})`
  );
});
