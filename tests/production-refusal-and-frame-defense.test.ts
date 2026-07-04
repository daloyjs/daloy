import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  cors,
  secureHeaders,
  _resetInsecureDefaultsLogForTests,
  _resetIndeterminateEnvWarningForTests,
} from "../src/index.js";
import { createJwtSigner, createJwtVerifier } from "../src/jwt.js";

// ============================================================
// secureDefaults: false master-flag enforcement
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

test("prod trust-proxy guard refuses spoofable vendor client-IP headers", async () => {
  // trustProxy unset + production + secureDefaults on => any spoofable
  // forwarded/client-IP header must be refused before routing (500), including
  // the vendor headers (CF/Fly/Cloudflare-style true-client-ip).
  const app = new App({ logger: false, env: "production" });
  for (const header of [
    "cf-connecting-ip",
    "fly-client-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ]) {
    const res = await app.fetch(
      new Request("http://x/", { headers: { [header]: "1.2.3.4" } }),
    );
    assert.equal(res.status, 500, `expected ${header} to trip the trust-proxy guard`);
  }
  // A request with no forwarded/vendor header is not refused by the guard
  // (routing proceeds; no matching route => 404, never the guard's 500).
  const clean = await app.fetch(new Request("http://x/"));
  assert.notEqual(clean.status, 500);
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
// JWT HS-secret length refusal
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
// secureHeaders refuse-to-construct: no framing defense
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

// ============================================================
// Indeterminate-environment warning (agnostic-safe heads-up that the
// production-only refuse-to-boot guards are inactive on edge runtimes where
// NODE_ENV is unset). Warning-only: no API or enforcement change.
// ============================================================

function captureLogger() {
  const records: Array<{ level: string; obj: any; msg: string }> = [];
  const logger = {
    level: "trace" as const,
    trace() {},
    debug() {},
    info() {},
    warn(obj: unknown, msg: string) {
      records.push({ level: "warn", obj, msg });
    },
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  };
  const envWarns = () =>
    records.filter(
      (r) => (r.obj as { event?: string })?.event === "secure_defaults.env_indeterminate",
    );
  return { logger, records, envWarns };
}

function withNoNodeEnv(fn: () => void): void {
  const saved = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
}

test("indeterminate env + wildcard CORS warns once (constructs, does not throw)", () => {
  _resetIndeterminateEnvWarningForTests();
  withNoNodeEnv(() => {
    const { logger, envWarns } = captureLogger();
    // No env option + no NODE_ENV => indeterminate. The production guard would
    // refuse a wildcard CORS origin; here it must construct but warn instead.
    const app = new App({ logger });
    assert.doesNotThrow(() => app.use(cors({ origin: "*" })));
    assert.equal(envWarns().length, 1, "should warn exactly once");
    assert.match(envWarns()[0]!.msg, /indeterminate/);
    assert.match(envWarns()[0]!.msg, /env: "production"/);

    // Once-per-process: a second risky app must not re-warn.
    const app2 = new App({ logger });
    app2.use(cors({ origin: "*" }));
    assert.equal(envWarns().length, 1, "once-per-process");
  });
});

test("explicit env: development + wildcard CORS does NOT warn (env is known)", () => {
  _resetIndeterminateEnvWarningForTests();
  withNoNodeEnv(() => {
    const { logger, envWarns } = captureLogger();
    const app = new App({ logger, env: "development" });
    app.use(cors({ origin: "*" }));
    assert.equal(envWarns().length, 0);
  });
});

test("indeterminate env + safe CORS allowlist does NOT warn (no risky config)", () => {
  _resetIndeterminateEnvWarningForTests();
  withNoNodeEnv(() => {
    const { logger, envWarns } = captureLogger();
    const app = new App({ logger });
    app.use(cors({ origin: ["https://app.example.com"] }));
    assert.equal(envWarns().length, 0);
  });
});
