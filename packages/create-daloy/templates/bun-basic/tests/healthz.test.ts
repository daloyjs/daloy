import { describe, expect, test } from "bun:test";
import { buildApp } from "../src/build-app.ts";

describe("buildApp", () => {
  test("GET /healthz returns 200", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runtime: string };
    expect(body.ok).toBe(true);
    expect(body.runtime).toBe("bun");
  });
});
