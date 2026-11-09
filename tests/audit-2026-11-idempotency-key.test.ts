/**
 * Regression tests for the idempotency store key and body fingerprint:
 * - an unscoped client key shaped like `<scopeHash>:K` or `<tenantHash>:K`
 *   must never address a scoped or tenant record;
 * - a declared `Content-Length: 0` must not make a non-empty body fingerprint
 *   like a genuinely empty one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { App, idempotency } from "../src/index.js";

const TENANCY_RESOLVED_MARKER = Symbol.for("daloyjs.tenancy.resolved");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function makeApp() {
  const app = new App({ logger: false });
  // Test-only tenant resolver: records the tenant the way tenancy() does.
  app.use({
    beforeHandle(ctx) {
      const tenant = ctx.request.headers.get("x-tenant");
      if (tenant) (ctx.state as Record<PropertyKey, unknown>)[TENANCY_RESOLVED_MARKER] = tenant;
      return undefined;
    },
  });
  // Public scope value, as an HTTP-signature keyid or mTLS identity would be.
  app.use(idempotency({ scope: (ctx) => ctx.request.headers.get("x-signer") ?? undefined }));
  let calls = 0;
  app.route({
    method: "POST",
    path: "/jobs",
    operationId: "jobs",
    request: { body: z.object({ item: z.string() }) },
    responses: {
      201: { description: "created", body: z.object({ n: z.number(), who: z.string() }) },
    },
    handler: (ctx) => {
      calls++;
      return {
        status: 201 as const,
        body: { n: calls, who: ctx.request.headers.get("x-signer") ?? "anon" },
      };
    },
  });
  const send = (key: string, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key, ...headers },
        body: JSON.stringify({ item: "x" }),
      }),
    );
  return { send, calls: () => calls };
}

test("idempotency key: same-scope retry still replays", async () => {
  const { send, calls } = makeApp();
  const a = await send("k-1", { "x-signer": "alice" });
  const b = await send("k-1", { "x-signer": "alice" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotency-replayed"), "true");
  assert.equal(calls(), 1);
});

test("idempotency key: an unscoped '<scopeHash>:K' key cannot read a scoped record", async () => {
  const { send, calls } = makeApp();
  await send("k-1", { "x-signer": "alice" });
  const crafted = await send(`${sha256("alice")}:k-1`);
  assert.equal(crafted.headers.get("idempotency-replayed"), null);
  assert.deepEqual(await crafted.json(), { n: 2, who: "anon" });
  assert.equal(calls(), 2);
});

test("idempotency key: an unscoped caller cannot pre-reserve a scoped slot", async () => {
  const { send, calls } = makeApp();
  await send(`${sha256("alice")}:k-2`);
  const signed = await send("k-2", { "x-signer": "alice" });
  assert.equal(signed.headers.get("idempotency-replayed"), null);
  assert.deepEqual(await signed.json(), { n: 2, who: "alice" });
  assert.equal(calls(), 2);
});

test("idempotency key: an untenanted '<tenantHash>:K' key cannot read a tenant record", async () => {
  const { send, calls } = makeApp();
  await send("k-3", { "x-tenant": "acme" });
  const crafted = await send(`${sha256("tenant:acme")}:k-3`);
  assert.equal(crafted.headers.get("idempotency-replayed"), null);
  assert.equal(calls(), 2);
  const sameTenant = await send("k-3", { "x-tenant": "acme" });
  assert.equal(sameTenant.headers.get("idempotency-replayed"), "true");
  assert.equal(calls(), 2);
});

function rawBodyApp() {
  const app = new App({ logger: false });
  app.use(idempotency());
  let calls = 0;
  // No body schema: idempotency fingerprints the raw request bytes.
  app.route({
    method: "POST",
    path: "/raw",
    operationId: "raw",
    responses: { 201: { description: "created", body: z.object({ n: z.number() }) } },
    handler: () => ({ status: 201 as const, body: { n: ++calls } }),
  });
  return { app, calls: () => calls };
}

test("idempotency fingerprint: Content-Length 0 with a non-empty body is not the empty request", async () => {
  const { app, calls } = rawBodyApp();
  const empty = await app.fetch(
    new Request("http://localhost/raw", {
      method: "POST",
      headers: { "idempotency-key": "k-cl", authorization: "Bearer a" },
    }),
  );
  assert.equal(empty.status, 201);
  const mismatched = await app.fetch(
    new Request("http://localhost/raw", {
      method: "POST",
      headers: {
        "idempotency-key": "k-cl",
        authorization: "Bearer a",
        "content-length": "0",
        "content-type": "text/plain",
      },
      body: "transfer-everything",
    }),
  );
  assert.equal(mismatched.status, 422, "a present body must be fingerprinted despite CL:0");
  assert.equal(calls(), 1);
});

test("idempotency fingerprint: a genuinely empty Content-Length 0 retry still replays", async () => {
  const { app, calls } = rawBodyApp();
  const send = () =>
    app.fetch(
      new Request("http://localhost/raw", {
        method: "POST",
        headers: { "idempotency-key": "k-empty", authorization: "Bearer a", "content-length": "0" },
        body: "",
      }),
    );
  assert.equal((await send()).status, 201);
  const retry = await send();
  assert.equal(retry.status, 201);
  assert.equal(retry.headers.get("idempotency-replayed"), "true");
  assert.equal(calls(), 1);
});
