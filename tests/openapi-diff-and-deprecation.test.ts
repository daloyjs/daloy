import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App, diffOpenAPI, hasBreakingChanges } from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";
import { runCli, type CliIO } from "../src/cli.js";
import { verifyBreakingChanges } from "../scripts/verify-breaking-changes.js";

// ---------- route-level deprecation lifecycle (RFC 8594) ----------

test("deprecated route emits a Deprecation: true response header", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/legacy",
    deprecated: true,
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/legacy"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("deprecation"), "true");
  assert.equal(res.headers.get("sunset"), null);
});

test("non-deprecated route emits no deprecation/sunset headers", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/fresh",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/fresh"));
  assert.equal(res.headers.get("deprecation"), null);
  assert.equal(res.headers.get("sunset"), null);
});

test("sunset implies deprecation and emits a normalized Sunset HTTP date", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/sunsetting",
    sunset: "2026-12-31T00:00:00Z",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/sunsetting"));
  assert.equal(res.headers.get("deprecation"), "true");
  assert.equal(res.headers.get("sunset"), new Date("2026-12-31T00:00:00Z").toUTCString());
});

test("sunset accepts a Date instance", async () => {
  const app = new App({ env: "development" });
  const when = new Date("2027-01-15T12:00:00Z");
  app.route({
    method: "GET",
    path: "/d",
    sunset: when,
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/d"));
  assert.equal(res.headers.get("sunset"), when.toUTCString());
});

test("a handler-set deprecation/sunset header is not overwritten", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/custom",
    deprecated: true,
    sunset: "2026-12-31T00:00:00Z",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      body: { ok: true },
      headers: { deprecation: "@1700000000", sunset: "Wed, 01 Jan 2025 00:00:00 GMT" },
    }),
  });
  const res = await app.fetch(new Request("http://x/custom"));
  assert.equal(res.headers.get("deprecation"), "@1700000000");
  assert.equal(res.headers.get("sunset"), "Wed, 01 Jan 2025 00:00:00 GMT");
});

test("app.route rejects an unparseable sunset value at registration time", () => {
  const app = new App({ env: "development" });
  assert.throws(
    () =>
      app.route({
        method: "GET",
        path: "/bad",
        sunset: "not-a-date",
        responses: { 200: { description: "ok" } },
        handler: () => ({ status: 200 as const, body: { ok: true } }),
      }),
    /invalid sunset date/
  );
});

// ---------- OpenAPI emission ----------

test("sunset surfaces deprecated:true and x-sunset on the OpenAPI operation", () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/v1/old",
    sunset: "2026-12-31T00:00:00Z",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const doc = generateOpenAPI(app, { info: { title: "T", version: "1.0.0" } }) as {
    paths: Record<string, Record<string, { deprecated?: boolean; "x-sunset"?: string }>>;
  };
  const op = doc.paths["/v1/old"]!.get!;
  assert.equal(op.deprecated, true);
  assert.equal(op["x-sunset"], new Date("2026-12-31T00:00:00Z").toUTCString());
});

// ---------- diffOpenAPI ----------

function baseDoc(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "T", version: "1.0.0" },
    paths: {
      "/books": {
        get: {
          parameters: [{ name: "q", in: "query", required: false }],
          responses: { 200: { description: "ok" }, 404: { description: "nf" } },
        },
        post: {
          requestBody: { required: false },
          responses: { 201: { description: "created" } },
        },
      },
    },
  };
}

test("diffOpenAPI reports no breaking changes for an identical spec", () => {
  const r = diffOpenAPI(baseDoc(), baseDoc());
  assert.equal(r.breaking.length, 0);
  // info.version unchanged → no version change entry either.
  assert.equal(r.nonBreaking.length, 0);
});

test("diffOpenAPI flags a removed path as breaking", () => {
  const cur = baseDoc() as any;
  delete cur.paths["/books"];
  const r = diffOpenAPI(baseDoc(), cur);
  assert.ok(r.breaking.some((c) => c.kind === "operation.removed"));
  assert.equal(hasBreakingChanges(baseDoc(), cur), true);
});

test("diffOpenAPI flags a removed operation as breaking", () => {
  const cur = baseDoc() as any;
  delete cur.paths["/books"].post;
  const r = diffOpenAPI(baseDoc(), cur);
  assert.deepEqual(
    r.breaking.map((c) => c.kind),
    ["operation.removed"]
  );
});

test("diffOpenAPI flags a removed response status as breaking", () => {
  const cur = baseDoc() as any;
  delete cur.paths["/books"].get.responses[404];
  const r = diffOpenAPI(baseDoc(), cur);
  assert.ok(r.breaking.some((c) => c.kind === "response.removed" && c.location.includes("404")));
});

test("diffOpenAPI flags a newly required parameter as breaking", () => {
  const cur = baseDoc() as any;
  cur.paths["/books"].get.parameters.push({ name: "tenant", in: "query", required: true });
  const r = diffOpenAPI(baseDoc(), cur);
  assert.ok(r.breaking.some((c) => c.kind === "parameter.required.added"));
});

test("diffOpenAPI flags an optional parameter that became required as breaking", () => {
  const cur = baseDoc() as any;
  cur.paths["/books"].get.parameters[0].required = true;
  const r = diffOpenAPI(baseDoc(), cur);
  assert.ok(r.breaking.some((c) => c.kind === "parameter.required.tightened"));
});

test("diffOpenAPI flags a newly required request body as breaking", () => {
  const cur = baseDoc() as any;
  cur.paths["/books"].post.requestBody.required = true;
  const r = diffOpenAPI(baseDoc(), cur);
  assert.ok(r.breaking.some((c) => c.kind === "requestBody.required.added"));
});

test("diffOpenAPI treats additive changes as non-breaking", () => {
  const cur = baseDoc() as any;
  cur.paths["/authors"] = { get: { responses: { 200: { description: "ok" } } } };
  cur.paths["/books"].get.parameters.push({ name: "page", in: "query", required: false });
  cur.paths["/books"].get.responses[500] = { description: "err" };
  cur.paths["/books"].delete = { responses: { 204: { description: "gone" } } };
  cur.paths["/books"].get.deprecated = true;
  const r = diffOpenAPI(baseDoc(), cur);
  assert.equal(r.breaking.length, 0);
  const kinds = new Set(r.nonBreaking.map((c) => c.kind));
  assert.ok(kinds.has("operation.added"));
  assert.ok(kinds.has("parameter.added"));
  assert.ok(kinds.has("operation.deprecated"));
});

test("diffOpenAPI reports a removed parameter as non-breaking and version change", () => {
  const cur = baseDoc() as any;
  cur.paths["/books"].get.parameters = [];
  cur.info.version = "2.0.0";
  const r = diffOpenAPI(baseDoc(), cur);
  assert.equal(r.breaking.length, 0);
  assert.ok(r.nonBreaking.some((c) => c.kind === "parameter.removed"));
  assert.ok(r.nonBreaking.some((c) => c.kind === "info.version.changed"));
});

test("diffOpenAPI tolerates malformed documents", () => {
  assert.deepEqual(diffOpenAPI(null, undefined), { breaking: [], nonBreaking: [] });
  assert.deepEqual(diffOpenAPI({ paths: 5 }, { paths: "x" }), { breaking: [], nonBreaking: [] });
});

// ---------- daloy diff CLI ----------

function diffIO(files: Record<string, string>): {
  io: CliIO;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({}),
    version: "0.0.0-test",
    readTextFile: async (path) => {
      const found = files[path];
      if (found === undefined) throw new Error(`ENOENT: ${path}`);
      return found;
    },
  };
  return { io, out, err };
}

test("daloy diff exits 0 with --json when there are no breaking changes", async () => {
  const spec = JSON.stringify(baseDoc());
  const { io, out } = diffIO({ "a.json": spec, "b.json": spec });
  const r = await runCli(["diff", "--json", "a.json", "b.json"], io);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  assert.deepEqual(parsed.breaking, []);
});

test("daloy diff exits 1 when a breaking change is detected", async () => {
  const cur = baseDoc() as any;
  delete cur.paths["/books"].post;
  const { io, out } = diffIO({
    "a.json": JSON.stringify(baseDoc()),
    "b.json": JSON.stringify(cur),
  });
  const r = await runCli(["diff", "a.json", "b.json"], io);
  assert.equal(r.exitCode, 1);
  assert.match(out.join(""), /breaking change/);
});

test("daloy diff prints a no-changes message for identical specs", async () => {
  const spec = JSON.stringify(baseDoc());
  const { io, out } = diffIO({ "a.json": spec, "b.json": spec });
  const r = await runCli(["diff", "a.json", "b.json"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /no changes detected/);
});

test("daloy diff requires two file paths", async () => {
  const { io, err } = diffIO({ "a.json": "{}" });
  const r = await runCli(["diff", "a.json"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /requires two file paths/);
});

test("daloy diff reports a parse/read error", async () => {
  const { io, err } = diffIO({ "a.json": "{not json", "b.json": "{}" });
  const r = await runCli(["diff", "a.json", "b.json"], io);
  assert.equal(r.exitCode, 1);
  assert.ok(err.join("").startsWith("daloy diff:"));
});

test("daloy diff fails when the IO cannot read files", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({}),
    version: "0.0.0-test",
  };
  const r = await runCli(["diff", "a.json", "b.json"], io);
  assert.equal(r.exitCode, 2);
  assert.match(err.join(""), /cannot read files/);
});

// ---------- verify-breaking-changes script ----------

test("verifyBreakingChanges no-ops when no baseline exists", async () => {
  const check = await verifyBreakingChanges(
    "./generated/__definitely_missing_baseline__.json",
    "./generated/openapi.json"
  );
  assert.equal(check.ok, true);
  assert.equal(check.compared, false);
});

test("verifyBreakingChanges fails when current spec is missing", async () => {
  const check = await verifyBreakingChanges(
    "./package.json",
    "./generated/__definitely_missing_current__.json"
  );
  assert.equal(check.ok, false);
  assert.equal(check.compared, false);
});
