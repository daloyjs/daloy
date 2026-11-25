import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

const SPA = "https://app.acme.test";
const ORIGIN_ENV_NAMES = [
  "CORS_ORIGIN",
  "CORS_ORIGINS",
  "ALLOWED_ORIGINS",
  "CORS_ALLOWED_ORIGINS",
  "FRONTEND_ORIGIN",
  "FRONTEND_URL",
  "SPA_ORIGIN",
  "APP_ORIGIN",
  "WEB_ORIGIN",
  "CLIENT_ORIGIN",
];
// An app may read the SPA origin from configuration; give it every common name.
for (const name of ORIGIN_ENV_NAMES) process.env[name] ??= SPA;

interface Seen {
  readonly status: number;
  readonly acao: string | null;
  readonly acac: string | null;
}

async function send(
  origin: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  path = "/books/1",
): Promise<Seen> {
  const res = await buildApp().request(path, {
    method: init.method ?? "GET",
    headers: { origin, ...(init.headers ?? {}) },
    ...(init.body ? { body: init.body } : {}),
  });
  return {
    status: res.status,
    acao: res.headers.get("access-control-allow-origin"),
    acac: res.headers.get("access-control-allow-credentials"),
  };
}

function preflight(origin: string): Promise<Seen> {
  return send(
    origin,
    {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    },
    "/books",
  );
}

/** Same check in a fresh `NODE_ENV=production` process (boot guards apply). */
function productionGet(origin: string): Seen | "refused-to-boot" {
  const appUrl = pathToFileURL(resolve("src/build-app.ts")).href;
  const script = [
    "let app;",
    `try { app = (await import(${JSON.stringify(appUrl)})).buildApp(); }`,
    'catch { console.log("__REFUSED__"); process.exit(0); }',
    `const res = await app.request("/books/1", { headers: { origin: ${JSON.stringify(origin)} } });`,
    'console.log("__SEEN__ " + JSON.stringify({ status: res.status, acao: res.headers.get("access-control-allow-origin"), acac: res.headers.get("access-control-allow-credentials") }));',
  ].join("\n");
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "-e", script],
    {
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  if (r.stdout.includes("__REFUSED__")) return "refused-to-boot";
  const m = /__SEEN__ (.+)/.exec(r.stdout);
  if (!m)
    throw new Error(`fresh process failed: ${(r.stderr || r.stdout).slice(0, 600)}`);
  return JSON.parse(m[1]!) as Seen;
}

test("the SPA's preflight for a JSON POST is allowed with credentials", async () => {
  const seen = await preflight(SPA);
  assert.ok(seen.status >= 200 && seen.status < 300, `preflight status ${seen.status}`);
  assert.equal(seen.acao, SPA);
  assert.equal(seen.acac, "true");
});

test("the SPA's credentialed GET and POST carry its exact origin", async () => {
  const get = await send(SPA);
  assert.equal(get.status, 200);
  assert.equal(get.acao, SPA);
  assert.equal(get.acac, "true");
  const post = await send(
    SPA,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sid=abc" },
      body: JSON.stringify({ title: "From the SPA" }),
    },
    "/books",
  );
  assert.ok(post.status >= 200 && post.status < 300, `POST status ${post.status}`);
  assert.equal(post.acao, SPA);
  assert.equal(post.acac, "true");
});

for (const evil of [
  "https://evil.test",
  "https://app.acme.test.evil.test",
  "https://evilapp.acme.test.attacker.test",
  "http://app.acme.test",
  "null",
]) {
  test(`origin ${evil} is never trusted`, async () => {
    for (const seen of [await send(evil), await preflight(evil)]) {
      assert.notEqual(seen.acao, evil, `${evil} was reflected`);
      assert.notEqual(seen.acao, "*", "wildcard Access-Control-Allow-Origin");
    }
  });
}

test("in production the app boots and still serves the SPA", () => {
  const seen = productionGet(SPA);
  assert.notEqual(seen, "refused-to-boot", "the app refused to boot in production");
  assert.equal((seen as Seen).acao, SPA);
  assert.equal((seen as Seen).acac, "true");
});
