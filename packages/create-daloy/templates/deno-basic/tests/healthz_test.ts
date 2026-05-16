import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildApp } from "../src/build-app.ts";

Deno.test("GET /healthz returns 200", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; runtime: string };
  assertEquals(body.ok, true);
  assertEquals(body.runtime, "deno");
});
