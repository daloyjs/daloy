/**
 * Audit 2026-11: cors() and the cross-origin write guard.
 *
 * 1. `except(paths, cors(...))` kept the cors() origin predicate un-gated, so
 *    the cross-origin write guard accepted a blind POST from the allowlisted
 *    origin on the paths the policy was exempted from.
 * 2. A predicate that accepts every origin (`() => true`) disabled the guard
 *    without tripping the production refusal that `origin: "*"` gets.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, cors, except, type AppOptions, type Hooks } from "../src/index.js";

const PARTNER = "https://partner.test";
const EVIL = "https://evil.test";

function writeApp(hooks: Hooks | Hooks[] | undefined, options: Partial<AppOptions> = {}) {
  const app = new App({ logger: false, ...options } as AppOptions);
  for (const h of Array.isArray(hooks) ? hooks : hooks ? [hooks] : []) app.use(h);
  for (const path of ["/admin/delete", "/api/write"] as const) {
    app.route({
      method: "POST",
      path,
      acknowledgeNoResponseBodySchema: true,
      handler: () => new Response("did-write"),
    } as never);
  }
  return app;
}

async function post(app: App<any>, path: string, origin: string) {
  return app.fetch(
    new Request(`http://app.test${path}`, {
      method: "POST",
      headers: { origin, "user-agent": "audit", "content-type": "text/plain" },
      body: "x",
    }),
  );
}

// ---------- 1. except() gates the guard's origin predicate ----------

test("[except] a cors() policy exempted from a path does not accept cross-origin writes there", async () => {
  const app = writeApp(except(["/admin/**"], cors({ origin: [PARTNER] })));
  const exempted = await post(app, "/admin/delete", PARTNER);
  assert.equal(exempted.status, 403);
  assert.notEqual(await exempted.text(), "did-write");
  const covered = await post(app, "/api/write", PARTNER);
  assert.equal(covered.status, 200);
  assert.equal(covered.headers.get("access-control-allow-origin"), PARTNER);
  assert.equal((await post(app, "/api/write", EVIL)).status, 403);
  assert.equal((await post(app, "/admin/delete", EVIL)).status, 403);
});

test("[except] trailing slashes on an exempted path are still exempted", async () => {
  const app = writeApp(except(["/admin/delete"], cors({ origin: [PARTNER] })));
  assert.equal((await post(app, "/admin/delete/", PARTNER)).status, 403);
  assert.equal((await post(app, "/api/write", PARTNER)).status, 200);
});

test("[except] a function predicate makes the wrapped cors() fail closed for the write guard", async () => {
  const app = writeApp(except(() => false, cors({ origin: [PARTNER] })));
  assert.equal((await post(app, "/api/write", PARTNER)).status, 403);
  // A separate, ungated policy still allows the origin.
  const both = writeApp([except(() => false, cors({ origin: [PARTNER] })), cors({ origin: [PARTNER] })]);
  assert.equal((await post(both, "/api/write", PARTNER)).status, 200);
});

// ---------- 2. allow-everything predicates count as a wildcard ----------

const PROD = { env: "production", behindProxy: "none" } as const;

test("[cors] production refuses an allow-everything origin predicate like origin: \"*\"", () => {
  for (const origin of [() => true, (o: string) => !!o, (o: string) => /.*/.test(o)]) {
    assert.throws(() => writeApp(cors({ origin }), PROD), /refused in production/);
  }
  assert.throws(() => writeApp(cors({ origin: "*" }), PROD), /refused in production/);
});

test("[cors] exact predicates, allowlists and the secureDefaults: false escape hatch still boot", async () => {
  const exact = writeApp(cors({ origin: (o) => o === PARTNER }), PROD);
  assert.equal((await post(exact, "/api/write", PARTNER)).status, 200);
  assert.equal((await post(exact, "/api/write", EVIL)).status, 403);
  const throwing = writeApp(
    cors({
      origin: (o) => {
        if (!o.endsWith(".partner.test") && o !== PARTNER) throw new Error("unexpected origin");
        return true;
      },
    }),
    PROD,
  );
  assert.equal((await post(throwing, "/api/write", PARTNER)).status, 200);
  writeApp(cors({ origin: [PARTNER] }), PROD);
  // A predicate that only adds the opaque origin "null" is treated like a
  // literal "null" entry (documented), not as a wildcard.
  writeApp(cors({ origin: (o) => o === "null" || o === PARTNER }), PROD);
  const optedOut = writeApp(cors({ origin: () => true }), {
    ...PROD,
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  assert.equal((await post(optedOut, "/api/write", EVIL)).status, 200);
});

test("[cors] an allow-everything predicate still boots outside production", async () => {
  const dev = writeApp(cors({ origin: () => true }), { env: "development" });
  assert.equal((await post(dev, "/api/write", EVIL)).status, 200);
});
