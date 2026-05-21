/**
 * Wave 9 - pattern-agnostic-framework parity audit regression coverage.
 *
 * Exercises the static gates exported from
 * `scripts/verify-wave9-audits.ts` against the live source tree, and the
 * live-config audits added to `daloy doctor` (items 1, 4, 5, 6, 7 from the
 * Wave 9 list; item 8 is the doctor command surface itself). The static
 * gates in `runWave9Audits()` cover items 9, 10, 11, 15, 17, and 19, while
 * item 22 remains covered by `verify-secret-comparisons.ts`.
 *
 * Other already-shipped Wave 9 behaviors stay in their owning feature tests;
 * items 14, 20, and 21 are forward-looking gates for Wave 2 defaults that are
 * still tracked in the roadmap. This file avoids duplicating those assertions
 * so the audit catalogue and behavior tests do not drift apart.
 *
 * @since 0.28.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/index.js";
import { runCli, type CliIO } from "../src/cli.js";
import { runWave9Audits } from "../scripts/verify-wave9-audits.js";

// ---------- static grep gates ----------

test("wave9: static grep audits all pass on the live source tree", async () => {
  const findings = await runWave9Audits();
  if (findings.length > 0) {
    const summary = findings
      .map(
        (f) =>
          `[${f.audit}] ${f.file}${f.line > 0 ? `:${f.line}` : ""} - ${f.text}`,
      )
      .join("\n");
    assert.fail(`Wave 9 audit gates flagged ${findings.length} finding(s):\n${summary}`);
  }
});

// ---------- doctor live-config audits ----------

function buildIO(app: App): {
  io: CliIO;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    importEntry: async () => ({ default: app }),
    version: "0.0.0-test",
  };
  return { io, out, err };
}

function dummyApp(options: Record<string, unknown> = {}): App {
  const app = new App({ logger: false, ...(options as Record<string, never>) });
  app.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.literal(true) }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { ok: true as const } }),
  });
  return app;
}

test("wave9 doctor: clean App passes the audit (no findings)", async () => {
  const app = dummyApp();
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.ok, true);
});

test("wave9 doctor: item 4 - bodyLimitBytes > 25 MiB surfaces a warn", async () => {
  const app = dummyApp({ bodyLimitBytes: 50 * 1024 * 1024 });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  // warn-only - exit code stays 0
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.bodyLimit.blanket"), codes.join(","));
});

test("wave9 doctor: item 6 - allowUnsafeValidationDetails surfaces an error", async () => {
  const app = dummyApp({ allowUnsafeValidationDetails: true });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 1);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.validationDetails.leak"), codes.join(","));
});

test("wave9 doctor: item 6 - exposeFrameworkIdentity surfaces an error", async () => {
  const app = dummyApp({ exposeFrameworkIdentity: true });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 1);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.identityLeak"), codes.join(","));
});

test("wave9 doctor: item 1 - cors maxAge > 24h surfaces a warn", async () => {
  const app = dummyApp({ cors: { origin: ["https://example.test"], maxAge: 604_800 } });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  // warn-only - exit code stays 0 unless another error fires
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.cors.maxAge"), codes.join(","));
});

test("wave9 doctor: item 1 - cors wildcard + credentials surfaces an error", async () => {
  // The App constructor refuses this combo at construction time when
  // cors() is used as middleware. Here we exercise the *defense-in-depth*
  // doctor check by injecting the option directly onto `app.options`
  // (simulating a custom plugin that mutates options post-construction).
  const app = dummyApp();
  (app as unknown as { options: Record<string, unknown> }).options.cors = {
    origin: "*",
    credentials: true,
  };
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 1);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.cors.wildcardCredentials"), codes.join(","));
});

test("wave9 doctor: item 7 - enableServerTimingInProduction in production surfaces an error", async () => {
  const app = dummyApp({ env: "production", enableServerTimingInProduction: true });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "entry.ts"], io);
  assert.equal(r.exitCode, 1);
  const parsed = JSON.parse(out.join(""));
  const codes = parsed.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("audit.serverTiming.production"), codes.join(","));
});

test("wave9 doctor: --no-audit-defaults skips every Wave 9 live check", async () => {
  const app = dummyApp({ allowUnsafeValidationDetails: true });
  const { io, out } = buildIO(app);
  const r = await runCli(["doctor", "--json", "--no-audit-defaults", "entry.ts"], io);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.ok, true);
});
