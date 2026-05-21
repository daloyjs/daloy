import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  secureHeaders,
  _resetInsecureDefaultsLogForTests,
} from "../src/index.js";
import { createJwtSigner, createJwtVerifier } from "../src/jwt.js";

// ============================================================
// Wave 8 — secureDefaults: false master-flag enforcement
// ============================================================

test("secureDefaults: false in production without acknowledgement refuses-to-construct", () => {
  _resetInsecureDefaultsLogForTests();
  assert.throws(
    () =>
      new App({
        logger: false,
        env: "production",
        secureDefaults: false,
      }),
    /secureDefaults: false.*refused in production/,
  );
});

test("secureDefaults: false in production with acknowledgement is allowed", () => {
  _resetInsecureDefaultsLogForTests();
  assert.doesNotThrow(
    () =>
      new App({
        logger: false,
        env: "production",
        secureDefaults: false,
        acknowledgeInsecureDefaults: true,
      }),
  );
});

test("secureDefaults: false in development is allowed without acknowledgement", () => {
  _resetInsecureDefaultsLogForTests();
  assert.doesNotThrow(
    () =>
      new App({
        logger: false,
        env: "development",
        secureDefaults: false,
      }),
  );
});

test("secureDefaults: false logs a once-per-process error naming the disabled defaults", () => {
  _resetInsecureDefaultsLogForTests();
  const records: Array<{ level: string; obj: unknown; msg: string }> = [];
  const logger = {
    level: "trace" as const,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error(obj: unknown, msg: string) {
      records.push({ level: "error", obj, msg });
    },
    fatal() {},
    child() {
      return logger;
    },
  };
  new App({ logger, env: "development", secureDefaults: false });
  // Second construction in the same process must not re-log.
  new App({ logger, env: "development", secureDefaults: false });
  assert.equal(records.length, 1);
  assert.match(records[0]!.msg, /secureDefaults: false/);
  const obj = records[0]!.obj as Record<string, unknown>;
  assert.equal(obj.event, "secure_defaults.disabled");
  assert.ok(Array.isArray(obj.disabled));
  assert.ok((obj.disabled as string[]).length > 0);
});

test("secureDefaults: true does not trigger the warning log", () => {
  _resetInsecureDefaultsLogForTests();
  const records: unknown[] = [];
  const logger = {
    level: "trace" as const,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error(obj: unknown) {
      records.push(obj);
    },
    fatal() {},
    child() {
      return logger;
    },
  };
  new App({ logger, env: "development" });
  assert.equal(records.length, 0);
});

// ============================================================
// Wave 8 — JWT HS-secret length refusal
// ============================================================

test("createJwtSigner refuses HS256 secret < 32 bytes at construction", () => {
  const shortKey = new Uint8Array(16);
  assert.throws(
    () =>
      createJwtSigner({
        alg: "HS256",
        key: shortKey,
        maxLifetimeSeconds: 60,
      }),
    /weak_hs_secret|at least 32 bytes/,
  );
});

test("createJwtSigner accepts HS256 secret of 32 bytes", async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const signer = createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 });
  const tok = await signer.sign({ sub: "u", exp: Math.floor(Date.now() / 1000) + 30 });
  assert.equal(tok.split(".").length, 3);
});

test("createJwtVerifier refuses HS384 secret < 32 bytes", () => {
  const shortKey = new Uint8Array(20);
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS384"],
        key: shortKey,
      }),
    /weak_hs_secret|at least 32 bytes/,
  );
});

// ============================================================
// Wave 8 — secureHeaders refuse-to-construct: no framing defense
// ============================================================

test("secureHeaders refuses frameOptions: false + contentSecurityPolicy: false", () => {
  assert.throws(
    () =>
      secureHeaders({
        frameOptions: false,
        contentSecurityPolicy: false,
      }),
    /refusing to construct with both frameOptions: false/,
  );
});

test("secureHeaders refuses frameOptions: false + CSP string without frame-ancestors", () => {
  assert.throws(
    () =>
      secureHeaders({
        frameOptions: false,
        contentSecurityPolicy: "default-src 'self'",
      }),
    /refusing to construct/,
  );
});

test("secureHeaders does not treat a frame-ancestors source token as a directive", () => {
  assert.throws(
    () =>
      secureHeaders({
        frameOptions: false,
        contentSecurityPolicy: "default-src frame-ancestors 'self'",
      }),
    /refusing to construct/,
  );
});

test("secureHeaders allows frameOptions: false + CSP string WITH frame-ancestors", () => {
  assert.doesNotThrow(() =>
    secureHeaders({
      frameOptions: false,
      contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
    }),
  );
});

test("secureHeaders allows frameOptions: false + CSP directives WITH frame-ancestors", () => {
  assert.doesNotThrow(() =>
    secureHeaders({
      frameOptions: false,
      contentSecurityPolicy: {
        directives: {
          "default-src": "'self'",
          "frame-ancestors": "'none'",
        },
      },
    }),
  );
});

test("secureHeaders refuses frameOptions: false + CSP directives without frame-ancestors", () => {
  assert.throws(
    () =>
      secureHeaders({
        frameOptions: false,
        contentSecurityPolicy: { directives: { "default-src": "'self'" } },
      }),
    /refusing to construct/,
  );
});

test("secureHeaders refuses frameOptions: false + CSP directives with empty frame-ancestors", () => {
  assert.throws(
    () =>
      secureHeaders({
        frameOptions: false,
        contentSecurityPolicy: {
          directives: {
            "default-src": "'self'",
            "frame-ancestors": [],
          },
        },
      }),
    /refusing to construct/,
  );
});

test("secureHeaders default construction (no overrides) is allowed", () => {
  assert.doesNotThrow(() => secureHeaders());
});
