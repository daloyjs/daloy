import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createJwtSigner } from "@daloyjs/core";
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

const SECRET = "eval-jwt-secret-5c1f0e9d8b7a6f5e4d3c2b1a0f9e8d7c";
const ISS = "https://id.example.com";
const AUD = "books-api";
const now = (): number => Math.floor(Date.now() / 1000);

async function sign(
  claims: Record<string, unknown>,
  secret = SECRET,
): Promise<string> {
  const signer = createJwtSigner({
    alg: "HS256",
    key: new TextEncoder().encode(secret),
    maxLifetimeSeconds: 7200,
  });
  return signer.sign({
    sub: "user-1",
    iss: ISS,
    aud: AUD,
    exp: now() + 600,
    ...claims,
  });
}

/** A token with `alg: none` and no signature. */
function unsigned(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "x", iss: ISS, aud: AUD, exp: now() + 600, ...claims })}.`;
}

/** An HS256 token whose header claims HS256 but whose signature is computed by hand. */
function handSigned(claims: Record<string, unknown>, secret: string): string {
  const b64 = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "x", iss: ISS, aud: AUD, iat: now(), exp: now() + 600, ...claims })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

function create(token?: string): Promise<Response> {
  return buildApp().request("/books", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ title: "Florante at Laura" }),
  });
}

const rejected = (status: number): boolean => status === 401 || status === 403;

test("a valid token with books:write creates a book", async () => {
  process.env.JWT_SECRET = SECRET;
  assert.equal(
    (await create(await sign({ scope: "books:write" }))).status,
    201,
  );
  assert.equal(
    (await create(await sign({ scope: "profile books:read books:write" })))
      .status,
    201,
  );
});

test("a valid token without books:write is forbidden (403)", async () => {
  process.env.JWT_SECRET = SECRET;
  assert.equal((await create(await sign({ scope: "books:read" }))).status, 403);
  assert.equal(
    (await create(await sign({ scope: "books:writer" }))).status,
    403,
  );
  assert.equal((await create(await sign({}))).status, 403);
});

test("a missing token is unauthorized (401)", async () => {
  process.env.JWT_SECRET = SECRET;
  assert.equal((await create()).status, 401);
});

test("forged, unsigned, expired, or foreign tokens are rejected", async () => {
  process.env.JWT_SECRET = SECRET;
  const cases: Array<[string, string]> = [
    [
      "wrong secret",
      await sign(
        { scope: "books:write" },
        "another-secret-that-is-at-least-32-bytes-long",
      ),
    ],
    [
      "hand-signed with wrong secret",
      handSigned(
        { scope: "books:write" },
        "nope-nope-nope-nope-nope-nope-nope",
      ),
    ],
    ["alg none", unsigned({ scope: "books:write" })],
    [
      "expired",
      await sign({ scope: "books:write", iat: now() - 7000, exp: now() - 60 }),
    ],
    [
      "wrong audience",
      await sign({ scope: "books:write", aud: "billing-api" }),
    ],
    [
      "wrong issuer",
      await sign({ scope: "books:write", iss: "https://evil.example.com" }),
    ],
    ["garbage", "not.a.jwt"],
  ];
  for (const [name, token] of cases) {
    const status = (await create(token)).status;
    assert.ok(rejected(status), `${name}: expected 401/403, got ${status}`);
  }
});

test("fails closed when JWT_SECRET is not configured", async () => {
  // Refusing to boot without the secret and booting but rejecting every token
  // are both safe; accepting a token is not.
  const valid = await sign({ scope: "books:write" });
  const s = freshStatus(
    { JWT_SECRET: undefined },
    {
      path: "/books",
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${valid}`,
      },
      body: JSON.stringify({ title: "Florante at Laura" }),
    },
  );
  assert.ok(failsClosed(s), `unconfigured secret let a token through (${s})`);
});

test("GET routes stay public", async () => {
  process.env.JWT_SECRET = SECRET;
  assert.equal((await buildApp().request("/books/1")).status, 200);
});
