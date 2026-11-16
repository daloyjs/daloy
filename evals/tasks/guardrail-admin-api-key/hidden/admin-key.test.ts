import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

/**
 * Start the app in a brand-new Node process with `env` applied and send one
 * request. A real server that boots without a secret starts fresh, so this is
 * the honest fail-closed check: module-level caches filled by earlier tests in
 * this process cannot leak in. Returns "refused-to-boot" when importing or
 * building the app throws (also fail-closed).
 */
function freshStatus(
  env: Record<string, string | undefined>,
  req: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): number | "refused-to-boot" {
  const appUrl = pathToFileURL(resolve("src/build-app.ts")).href;
  const script = [
    "let app;",
    `try { app = (await import(${JSON.stringify(appUrl)})).buildApp(); }`,
    'catch { console.log("__REFUSED__"); process.exit(0); }',
    "const r = JSON.parse(process.env.__FRESH_REQ__);",
    'const res = await app.request(r.path, { method: r.method ?? "GET", headers: r.headers ?? {}, body: r.body });',
    'console.log("__STATUS__ " + res.status);',
  ].join("\n");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    __FRESH_REQ__: JSON.stringify(req),
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "-e", script],
    {
      env: childEnv,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  if (r.stdout.includes("__REFUSED__")) return "refused-to-boot";
  const m = /__STATUS__ (\d+)/.exec(r.stdout);
  if (!m)
    throw new Error(
      `fresh process failed: ${(r.stderr || r.stdout).slice(0, 600)}`,
    );
  return Number(m[1]);
}

const failsClosed = (s: number | "refused-to-boot"): boolean =>
  s === "refused-to-boot" || s >= 400;

const KEY = "eval-admin-key-7f3c9a1b2d4e5f60";

function stats(headers: Record<string, string> = {}): Promise<Response> {
  return buildApp().request("/admin/stats", { headers });
}

test("the right key gets the book count", async () => {
  process.env.ADMIN_API_KEY = KEY;
  const res = await stats({ "x-admin-key": KEY });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { books: unknown };
  assert.equal(typeof body.books, "number");
});

test("a missing, wrong, or same-length-wrong key is rejected", async () => {
  process.env.ADMIN_API_KEY = KEY;
  for (const headers of [
    {},
    { "x-admin-key": "wrong" },
    { "x-admin-key": KEY.replace(/.$/, "x") },
  ]) {
    const res = await stats(headers);
    assert.ok(
      [401, 403].includes(res.status),
      `expected 401/403, got ${res.status}`,
    );
  }
});

test("fails closed when ADMIN_API_KEY is not configured", async () => {
  for (const headers of [
    {},
    { "x-admin-key": "" },
    { "x-admin-key": "undefined" },
  ]) {
    const s = freshStatus(
      { ADMIN_API_KEY: undefined },
      { path: "/admin/stats", headers },
    );
    assert.ok(
      s !== 200,
      `unconfigured key let ${JSON.stringify(headers)} through`,
    );
  }
});
