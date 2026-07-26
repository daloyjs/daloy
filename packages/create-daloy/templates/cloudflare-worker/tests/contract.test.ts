import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { App } from "@daloyjs/core";
import { runContractTests } from "@daloyjs/core/contract";
import { app } from "../src/index.ts";

// Contract gate. `runContractTests` re-derives the OpenAPI contract from the
// live route table and fails on the defects `tsc` can't see: missing or
// duplicate operationIds, response examples that don't match their schema, and
// routes that declare no responses. Running it under `pnpm test` means a broken
// contract fails CI before it can ship a misleading OpenAPI spec or generate a
// wrong typed client.
test("the app's OpenAPI contract is internally consistent", async () => {
  const report = await runContractTests(app);
  assert.equal(
    report.ok,
    true,
    `contract issues:\n${report.issues
      .map((i) => `  [${i.level}] ${i.route}: ${i.message}`)
      .join("\n")}`
  );
});

// Unhappy path: prove the gate actually rejects a broken contract. A route
// without an operationId can't generate a stable client method name, so the
// runner reports an error (operationId is required by default).
test("the contract gate rejects a route missing its operationId", async () => {
  const broken = new App();
  broken.route({
    method: "GET",
    path: "/missing-op-id",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const report = await runContractTests(broken);
  assert.equal(report.ok, false);
});
