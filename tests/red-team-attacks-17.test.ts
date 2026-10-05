/**
 * Red-team round 17: the rest of the "accepted silently" list.
 *
 * 1. Contradictory or toothless settings now refused: a guard trusting
 *    X-Forwarded-For under `behindProxy: "none"`, `serve({ trustProxy })`
 *    against `behindProxy: "none"`, a NaN / negative `connectionTimeoutMs`,
 *    CSRF `ignoreMethods` exempting a state-changing method or an origin
 *    predicate that accepts anything, a JWT clock skew over 5 minutes, short
 *    probe / metrics tokens, and `frame-ancestors *` passing the clickjacking
 *    check.
 * 2. Production warnings that were missing: the in-memory session store,
 *    mounted docs, and secure defaults switched off one by one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  createJwtVerifier,
  csrf,
  rateLimit,
  secureHeaders,
  session,
} from "../src/index.js";
import { serve } from "../src/adapters/node.js";

function capture() {
  const warns: Array<Record<string, unknown>> = [];
  const logger = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (obj: Record<string, unknown>) => warns.push(obj),
    child: () => logger,
  };
  return { logger: logger as never, warns };
}

// ---------- 1. contradictions and toothless values ----------

test("[proxy] a guard trusting X-Forwarded-For is refused under behindProxy: 'none'", () => {
  const app = new App({ logger: false, behindProxy: "none" });
  assert.throws(() => app.use(rateLimit({ windowMs: 1000, max: 5, trustProxyHeaders: true })), /behindProxy: "none"/);
  assert.throws(() => app.use(rateLimit({ windowMs: 1000, max: 5, trustedHops: 1 })), /behindProxy: "none"/);
});

test("[proxy] peer-verified trust, inherited trust, or a declared proxy are fine", () => {
  new App({ logger: false, behindProxy: "none" }).use(rateLimit({ windowMs: 1000, max: 5 }));
  new App({ logger: false, behindProxy: "none" }).use(
    rateLimit({ windowMs: 1000, max: 5, trustedProxies: ["10.0.0.0/8"] }),
  );
  new App({ logger: false, behindProxy: { hops: 1 } }).use(
    rateLimit({ windowMs: 1000, max: 5, trustProxyHeaders: true }),
  );
});

test("[serve] trustProxy against behindProxy: 'none' and bad connection timeouts are refused", () => {
  const app = new App({ logger: false, behindProxy: "none" });
  assert.throws(() => serve(app, { port: 0, trustProxy: true }), /contradicts/);
  for (const bad of [Number(undefined), -1, 1.5]) {
    assert.throws(
      () => serve(new App({ logger: false }), { port: 0, connectionTimeoutMs: bad }),
      /connectionTimeoutMs/,
      String(bad),
    );
  }
});

test("[serve] connectionTimeoutMs: 0 in production warns instead of failing", async () => {
  const { logger, warns } = capture();
  const handle = serve(new App({ logger, env: "production", behindProxy: "none" }), {
    port: 0,
    connectionTimeoutMs: 0,
    handleSignals: false,
  });
  await new Promise<void>((r) => (handle.server.listening ? r() : handle.server.once("listening", () => r())));
  await handle.close();
  assert.ok(warns.some((w) => w.event === "serve.timeouts_disabled"));
});

test("[csrf] exempting a state-changing method or trusting every origin is refused", () => {
  for (const method of ["POST", "put", "PATCH", "DELETE"]) {
    assert.throws(() => csrf({ ignoreMethods: ["GET", method] }), /ignoreMethods must not include/, method);
  }
  assert.throws(() => csrf({ allowedOrigins: () => true }), /would trust every site/);
  csrf({ allowedOrigins: (o) => o === "https://app.test" });
  csrf({ ignoreMethods: ["GET", "HEAD", "OPTIONS"] });
});

test("[jwt] clockSkewSeconds above 5 minutes is refused", () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  assert.throws(
    () => createJwtVerifier({ algorithms: ["HS256"], key, audience: "api", clockSkewSeconds: 301 }),
    /at most 300/,
  );
  createJwtVerifier({ algorithms: ["HS256"], key, audience: "api", clockSkewSeconds: 300 });
});

test("[probes] health and metrics tokens must be at least 16 characters", () => {
  const app = new App({ logger: false });
  assert.throws(() => app.healthcheck({ token: "short" }), /at least 16 characters/);
  assert.throws(() => app.metrics({ token: "x".repeat(15) }), /at least 16 characters/);
  app.healthcheck({ token: "x".repeat(16) });
});

test("[headers] frame-ancestors * or a bare scheme does not count as clickjacking protection", () => {
  for (const csp of ["default-src 'self'; frame-ancestors *", "frame-ancestors https:"]) {
    assert.throws(() => secureHeaders({ frameOptions: false, contentSecurityPolicy: csp }), /frame-ancestors/, csp);
  }
  assert.throws(
    () => secureHeaders({ frameOptions: false, contentSecurityPolicy: { directives: { "frame-ancestors": ["*"] } } }),
    /frame-ancestors/,
  );
  secureHeaders({ frameOptions: false, contentSecurityPolicy: "frame-ancestors 'self' https://partner.test" });
});

// ---------- 2. production warnings ----------

const SECRET = "s3ss10n-s3cr3t-that-is-long-enough-xyz";

test("[warn] production logs the in-memory session store once, not with a real store", () => {
  const { logger, warns } = capture();
  const app = new App({ logger, env: "production", behindProxy: "none", csrf: "off" });
  app.use(session({ secret: SECRET }));
  app.use(session({ secret: SECRET, cookieName: "__Host-second" }));
  assert.equal(warns.filter((w) => w.event === "session.memory_store_in_production").length, 1);
  const dev = capture();
  new App({ logger: dev.logger, env: "development" }).use(session({ secret: SECRET }));
  assert.equal(dev.warns.filter((w) => w.event === "session.memory_store_in_production").length, 0);
});

test("[warn] production logs mounted docs and individually disabled defaults", () => {
  const { logger, warns } = capture();
  new App({
    logger,
    env: "production",
    behindProxy: "none",
    docs: true,
    secureHeaders: false,
    corsCrossOriginGuard: false,
    csrf: "off",
  });
  assert.ok(warns.some((w) => w.event === "docs.public_in_production"));
  const partial = warns.find((w) => w.event === "secure_defaults.partially_disabled");
  assert.ok(partial);
  assert.equal((partial!.disabled as string[]).length, 3);
});

test("[warn] a production app with defaults intact logs neither warning", () => {
  const { logger, warns } = capture();
  new App({ logger, env: "production", behindProxy: "none" });
  assert.equal(warns.filter((w) => w.event === "secure_defaults.partially_disabled").length, 0);
  assert.equal(warns.filter((w) => w.event === "docs.public_in_production").length, 0);
});
