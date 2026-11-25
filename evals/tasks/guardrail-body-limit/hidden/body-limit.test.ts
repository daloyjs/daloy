import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { buildApp } from "../../src/build-app.ts";

const MiB = 1024 * 1024;

function upload(
  app: ReturnType<typeof buildApp>,
  bytes: number,
): Promise<Response> {
  return app.request("/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "doc.txt", content: "a".repeat(bytes) }),
  });
}

test("POST /uploads accepts 3 MiB and 4.5 MiB documents", async () => {
  const app = buildApp();
  assert.equal((await upload(app, 3 * MiB)).status, 201);
  assert.equal((await upload(app, 4.5 * MiB)).status, 201);
});

test("POST /uploads still rejects bodies over ~5 MiB with 413", async () => {
  const app = buildApp();
  assert.equal((await upload(app, 6 * MiB)).status, 413);
});

test("other routes keep the 1 MiB app-wide body limit", async () => {
  const app = buildApp();
  app.post(
    "/__eval_probe",
    {
      request: { body: z.object({ content: z.string() }).strict() },
      responses: {
        200: { description: "ok", body: z.object({ ok: z.literal(true) }) },
      },
    },
    async () => ({ status: 200 as const, body: { ok: true as const } }),
  );
  const res = await app.request("/__eval_probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "a".repeat(2 * MiB) }),
  });
  assert.equal(res.status, 413);
});
