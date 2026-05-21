/**
 * Wave 8 — single-source-of-truth bake-in regression coverage.
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

