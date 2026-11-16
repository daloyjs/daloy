import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { z } from "zod";
import { buildApp } from "../../src/build-app.ts";

const SECRET_DETAIL = "db password=hunter2 at 10.0.0.12";
let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
});
afterEach(() => {
  process.env = saved;
});

function appFor(
  env: Record<string, string | undefined>,
): ReturnType<typeof buildApp> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const app = buildApp();
  app.get(
    "/__eval_boom",
    {
      responses: {
        200: { description: "never", body: z.object({ ok: z.literal(true) }) },
      },
    },
    async () => {
      throw new Error(SECRET_DETAIL);
    },
  );
  return app;
}

test("staging serves /docs and /openapi.json", async () => {
  const app = appFor({ NODE_ENV: "production", STAGING: "true" });
  assert.equal((await app.request("/openapi.json")).status, 200);
  assert.equal((await app.request("/docs")).status, 200);
});

test("staging still behaves like production: internal errors are redacted", async () => {
  const app = appFor({ NODE_ENV: "production", STAGING: "true" });
  const res = await app.request("/__eval_boom");
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(
    !text.includes("hunter2"),
    `staging leaked the internal error message: ${text.slice(0, 200)}`,
  );
});

test("real production keeps the docs hidden and errors redacted", async () => {
  for (const STAGING of [undefined, "false", ""]) {
    const app = appFor({ NODE_ENV: "production", STAGING });
    assert.equal(
      (await app.request("/openapi.json")).status,
      404,
      `STAGING=${STAGING}: /openapi.json is public`,
    );
    assert.equal(
      (await app.request("/docs")).status,
      404,
      `STAGING=${STAGING}: /docs is public`,
    );
    const text = await (await app.request("/__eval_boom")).text();
    assert.ok(
      !text.includes("hunter2"),
      "production leaked the internal error message",
    );
  }
});

test("local development still serves the docs", async () => {
  const app = appFor({ NODE_ENV: undefined, STAGING: undefined });
  assert.equal((await app.request("/openapi.json")).status, 200);
});
