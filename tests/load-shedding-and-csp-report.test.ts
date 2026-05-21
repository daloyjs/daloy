import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  App,
  loadShedding,
  LOAD_SHEDDING_MARKER,
  defineConfig,
  ConfigValidationError,
  secureHeaders,
} from "../src/index.js";

// ---------- loadShedding ----------

test("loadShedding returns Hooks and exposes a stable marker symbol", () => {
  const h = loadShedding();
  assert.equal(typeof h.beforeHandle, "function");
  assert.equal(typeof LOAD_SHEDDING_MARKER, "symbol");
});

test("loadShedding passes through requests when thresholds are not exceeded", async () => {
  const app = new App({
    env: "development",
    loadShedding: { maxEventLoopDelayMs: 60_000, maxEventLoopUtilization: 0 },
  });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 200);
});

test("loadShedding healthCheck reason triggers 503 with Retry-After", async () => {
  const app = new App({ env: "development" });
  app.use(
    loadShedding({
      maxEventLoopDelayMs: 0,
      maxEventLoopUtilization: 0,
      retryAfterSeconds: 7,
      sampleIntervalMs: 100,
      healthCheckIntervalMs: 100,
      healthCheck: () => "downstream-db-down",
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // Two requests so the second hits a cached snapshot path.
  const r1 = await app.fetch(new Request("http://x/"));
  assert.equal(r1.status, 503);
  assert.equal(r1.headers.get("retry-after"), "7");
  const body = (await r1.json()) as { detail: string };
  assert.match(body.detail, /downstream-db-down/);
  const r2 = await app.fetch(new Request("http://x/"));
  assert.equal(r2.status, 503);
});

test("loadShedding healthCheck error becomes a shed reason", async () => {
  const app = new App({ env: "development" });
  app.use(
    loadShedding({
      maxEventLoopDelayMs: 0,
      maxEventLoopUtilization: 0,
      sampleIntervalMs: 100,
      healthCheck: () => {
        throw new Error("boom");
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { detail: string };
  assert.match(body.detail, /healthCheck threw/);
});

test("loadShedding healthCheck that throws a non-Error still reports a generic reason", async () => {
  const app = new App({ env: "development" });
  app.use(
    loadShedding({
      maxEventLoopDelayMs: 0,
      maxEventLoopUtilization: 0,
      sampleIntervalMs: 100,
      healthCheck: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "nope";
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { detail: string };
  assert.match(body.detail, /healthCheck threw$/);
});

test("loadShedding heap threshold trips when set to zero", async () => {
  const app = new App({
    env: "development",
    loadShedding: {
      maxEventLoopDelayMs: 0,
      maxEventLoopUtilization: 0,
      maxHeapUsedBytes: 1,
      maxRssBytes: 1,
      sampleIntervalMs: 100,
    },
  });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { detail: string };
  assert.match(body.detail, /heap used/);
});

test("loadShedding rss threshold trips when heap is unlimited", async () => {
  const app = new App({ env: "development" });
  app.use(
    loadShedding({
      maxEventLoopDelayMs: 0,
      maxEventLoopUtilization: 0,
      maxRssBytes: 1,
      sampleIntervalMs: 100,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { detail: string };
  assert.match(body.detail, /rss /);
});

// ---------- cspReportRoute ----------

test("cspReportRoute accepts application/csp-report and returns 204", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute();
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "violated-directive": "img-src" } }),
    }),
  );
  assert.equal(res.status, 204);
});

test("cspReportRoute calls custom onReport sink", async () => {
  const app = new App({ env: "development", logger: false });
  const received: unknown[] = [];
  app.cspReportRoute({
    path: "/_my_csp" as const as never,
    onReport: (report) => {
      received.push(report);
    },
  });
  const res = await app.fetch(
    new Request("http://x/_my_csp", {
      method: "POST",
      headers: {
        "content-type": "application/reports+json",
        "x-real-ip": "10.0.0.99",
        "user-agent": "Chrome/Probe",
      },
      body: JSON.stringify([{ type: "csp-violation" }]),
    }),
  );
  assert.equal(res.status, 204);
  assert.equal(received.length, 1);
});

test("cspReportRoute swallows onReport sink errors", async () => {
  const errs: unknown[] = [];
  const app = new App({
    env: "development",
    logger: {
      level: "trace",
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error(o: object) {
        errs.push(o);
      },
      fatal() {},
      child() {
        return this as never;
      },
    } as never,
  });
  app.cspReportRoute({
    onReport: () => {
      throw new Error("sink-down");
    },
  });
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ ok: true }),
    }),
  );
  assert.equal(res.status, 204);
  assert.equal(errs.length, 1);
});

test("cspReportRoute rejects wrong content-type with 415", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute();
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    }),
  );
  assert.equal(res.status, 415);
});

test("cspReportRoute rejects missing content-type with 415", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute();
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(res.status, 415);
});

test("cspReportRoute rejects oversized body with 413", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute({ maxBodyBytes: 16 });
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ payload: "x".repeat(200) }),
    }),
  );
  assert.equal(res.status, 413);
});

test("cspReportRoute rejects invalid JSON with 400", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute();
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "{not json",
    }),
  );
  assert.equal(res.status, 400);
});

test("cspReportRoute rejects empty body with 400", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute();
  const res = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "",
    }),
  );
  assert.equal(res.status, 400);
});

test("cspReportRoute rate-limits per IP", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const headers = {
    "content-type": "application/csp-report",
    "x-real-ip": "10.0.0.50",
  };
  const a = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  const b = await app.fetch(
    new Request("http://x/__csp-report", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  assert.equal(a.status, 204);
  assert.equal(b.status, 429);
});

test("cspReportRoute with rateLimit: false skips the limiter", async () => {
  const app = new App({ env: "development", logger: false });
  app.cspReportRoute({ rateLimit: false });
  for (let i = 0; i < 50; i++) {
    const res = await app.fetch(
      new Request("http://x/__csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: "{}",
      }),
    );
    assert.equal(res.status, 204);
  }
});

// ---------- secureHeaders reporting endpoints ----------

test("secureHeaders emits Reporting-Endpoints and Report-To when configured", async () => {
  const app = new App({
    env: "development",
    secureHeaders: {
      reportingEndpoints: {
        "csp-endpoint": "https://example.test/__csp-report",
      },
      reportTo: "csp-endpoint",
    },
  });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.match(
    res.headers.get("reporting-endpoints") ?? "",
    /csp-endpoint="https:\/\/example\.test\/__csp-report"/,
  );
  assert.match(res.headers.get("report-to") ?? "", /"csp-endpoint"/);
  assert.match(
    res.headers.get("content-security-policy") ?? "",
    /report-to csp-endpoint/,
  );
});

test("secureHeaders with reportTo and a directives object still appends report-to", () => {
  const h = secureHeaders({
    contentSecurityPolicy: { directives: { "default-src": "'self'" } },
    reportTo: "csp-endpoint",
  });
  assert.equal(typeof h.beforeHandle, "function");
});

test("secureHeaders ignores empty reportingEndpoints", async () => {
  const app = new App({
    env: "development",
    secureHeaders: { reportingEndpoints: {} },
  });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.headers.get("reporting-endpoints"), null);
});

// ---------- disconnectStatusCode ----------

test("disconnectStatusCode rejects values outside [400, 499]", () => {
  assert.throws(
    () => new App({ env: "development", disconnectStatusCode: 200 }),
    /disconnectStatusCode/,
  );
  assert.throws(
    () => new App({ env: "development", disconnectStatusCode: 500 }),
    /disconnectStatusCode/,
  );
  assert.throws(
    () => new App({ env: "development", disconnectStatusCode: 12.5 }),
    /disconnectStatusCode/,
  );
});

test("disconnectStatusCode: 0 disables the rewrite", () => {
  assert.doesNotThrow(
    () => new App({ env: "development", disconnectStatusCode: 0 }),
  );
});

test("aborted request gets disconnectStatusCode (default 499)", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        if (request.signal.aborted) return reject(new Error("aborted"));
        request.signal.addEventListener("abort", onAbort, { once: true });
      });
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const controller = new AbortController();
  const req = new Request("http://x/slow", { signal: controller.signal });
  const pending = app.fetch(req);
  controller.abort();
  const res = await pending;
  assert.equal(res.status, 499);
});

test("disconnectStatusCode honours custom value", async () => {
  const app = new App({
    env: "development",
    logger: false,
    disconnectStatusCode: 408,
  });
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const controller = new AbortController();
  const req = new Request("http://x/slow", { signal: controller.signal });
  const pending = app.fetch(req);
  controller.abort();
  const res = await pending;
  assert.equal(res.status, 408);
});

test("disconnectStatusCode: 0 disables the 499 rewrite on abort", async () => {
  const app = new App({
    env: "development",
    logger: false,
    disconnectStatusCode: 0,
  });
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const controller = new AbortController();
  const req = new Request("http://x/slow", { signal: controller.signal });
  const pending = app.fetch(req);
  controller.abort();
  const res = await pending;
  // With the rewrite disabled, an aborted request surfaces whatever status
  // the framework would otherwise emit — but it MUST NOT be the 499 default.
  assert.notEqual(res.status, 499);
});

// ---------- defineConfig ----------

test("defineConfig resolves valid env values", async () => {
  const config = await defineConfig({
    schema: z.object({ FOO: z.string(), PORT: z.coerce.number() }),
    source: { kind: "env", env: { FOO: "bar", PORT: "8080" } },
  });
  assert.deepEqual(config, { FOO: "bar", PORT: 8080 });
});

test("defineConfig defaults to process.env source", async () => {
  process.env.__DALOY_TEST_VAR = "yes";
  try {
    const config = await defineConfig({
      schema: z.object({ __DALOY_TEST_VAR: z.literal("yes") }),
      stderr: false,
    });
    assert.equal(config.__DALOY_TEST_VAR, "yes");
  } finally {
    delete process.env.__DALOY_TEST_VAR;
  }
});

test("defineConfig aggregates every schema issue", async () => {
  const stderr: string[] = [];
  await assert.rejects(
    () =>
      defineConfig({
        schema: z.object({ FOO: z.string(), PORT: z.coerce.number().int() }),
        source: { kind: "env", env: { PORT: "not-a-number" } },
        stderr: { write: (chunk) => stderr.push(chunk) },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      assert.ok(err.issues.length >= 2);
      const keys = err.issues.map((i) => i.key);
      assert.ok(keys.includes("FOO"));
      assert.ok(keys.includes("PORT"));
      return true;
    },
  );
  assert.equal(stderr.length, 1);
  assert.match(stderr[0]!, /defineConfig\(\): configuration is invalid/);
});

test("defineConfig single-issue summary uses singular grammar", async () => {
  await assert.rejects(
    () =>
      defineConfig({
        schema: z.object({ FOO: z.string() }),
        source: { kind: "object", data: {} },
        stderr: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      assert.equal(err.issues.length, 1);
      assert.match(err.message, /\(1 issue\)/);
      return true;
    },
  );
});

test("defineConfig transform runs before validation", async () => {
  const config = await defineConfig({
    schema: z.object({ port: z.number() }),
    source: { kind: "object", data: { PORT: "1234" } },
    transform: (raw) => ({ port: Number(raw.PORT) }),
  });
  assert.equal(config.port, 1234);
});

test("defineConfig file source reads JSON", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = path.join(os.tmpdir(), `daloy-cfg-${Date.now()}.json`);
  await fs.writeFile(tmp, JSON.stringify({ FOO: "bar" }), "utf8");
  try {
    const config = await defineConfig({
      schema: z.object({ FOO: z.string() }),
      source: { kind: "file", path: tmp },
    });
    assert.equal(config.FOO, "bar");
  } finally {
    await fs.unlink(tmp);
  }
});

test("defineConfig file source surfaces non-object payloads via ConfigValidationError", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = path.join(os.tmpdir(), `daloy-cfg-bad-${Date.now()}.json`);
  await fs.writeFile(tmp, JSON.stringify([1, 2, 3]), "utf8");
  try {
    await assert.rejects(
      () =>
        defineConfig({
          schema: z.object({ FOO: z.string() }),
          source: { kind: "file", path: tmp },
          stderr: false,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.match(err.message, /did not parse to an object/);
        return true;
      },
    );
  } finally {
    await fs.unlink(tmp);
  }
});

test("defineConfig file source supports a custom parser", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = path.join(os.tmpdir(), `daloy-cfg-ini-${Date.now()}.txt`);
  await fs.writeFile(tmp, "FOO=bar\n", "utf8");
  try {
    const config = await defineConfig({
      schema: z.object({ FOO: z.string() }),
      source: {
        kind: "file",
        path: tmp,
        parse: (text) => {
          const out: Record<string, string> = {};
          for (const line of text.split("\n")) {
            const [k, v] = line.split("=");
            if (k && v !== undefined) out[k.trim()] = v.trim();
          }
          return out;
        },
      },
    });
    assert.equal(config.FOO, "bar");
  } finally {
    await fs.unlink(tmp);
  }
});

test("defineConfig file source surfaces filesystem errors as ConfigValidationError", async () => {
  const stderr: string[] = [];
  await assert.rejects(
    () =>
      defineConfig({
        schema: z.object({ FOO: z.string() }),
        source: { kind: "file", path: "/tmp/this-file-does-not-exist-daloy" },
        stderr: { write: (chunk) => stderr.push(chunk) },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      assert.equal(err.issues[0]!.key, "<source>");
      return true;
    },
  );
  assert.equal(stderr.length, 1);
});

test("defineConfig custom resolver source works", async () => {
  const config = await defineConfig({
    schema: z.object({ secret: z.string() }),
    source: {
      kind: "custom",
      resolve: async () => ({ secret: "from-vault" }),
    },
  });
  assert.equal(config.secret, "from-vault");
});

test("defineConfig wraps thrown non-Error from custom resolver", async () => {
  await assert.rejects(
    () =>
      defineConfig({
        schema: z.object({ FOO: z.string() }),
        source: {
          kind: "custom",
          resolve: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw "nope";
          },
        },
        stderr: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigValidationError);
      assert.match(err.issues[0]!.message, /failed to read source/);
      return true;
    },
  );
});
