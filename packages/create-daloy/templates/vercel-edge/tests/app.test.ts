import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/[...path].js";

test("Vercel Edge handler responds through DaloyJS", async () => {
  const response = await handler(new Request("https://example.test/healthz"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).runtime, "vercel-edge");
});
