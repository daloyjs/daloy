import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFilename,
  assertSafeRelativePath,
  hasMongoOperatorKeys,
  assertNoMongoOperators,
  BadRequestError,
} from "../src/index.js";

// ============================================================================
// sanitizeFilename — Aikido "Directory Traversal & File Exposure" class
// (Zip Slip, NUL truncation, Windows reserved names).
// ============================================================================

test("sanitizeFilename: returns basename for plain filenames", () => {
  assert.equal(sanitizeFilename("photo.jpg"), "photo.jpg");
  assert.equal(sanitizeFilename("My Resume v2.pdf"), "My Resume v2.pdf");
});

test("sanitizeFilename: strips POSIX path traversal", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("/etc/shadow"), "shadow");
});

test("sanitizeFilename: strips Windows path traversal and drive letters", () => {
  assert.equal(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
  assert.equal(sanitizeFilename("C:\\Users\\admin\\secret.txt"), "secret.txt");
});

test("sanitizeFilename: defeats NUL-truncation bypass (evil.png\\0.exe)", () => {
  assert.equal(sanitizeFilename("evil.png\0.exe"), "evil.png.exe");
});

test("sanitizeFilename: replaces Windows-reserved characters", () => {
  assert.equal(sanitizeFilename('a<b>c:d"e|f?g*h.txt'), "a_b_c_d_e_f_g_h.txt");
});

test("sanitizeFilename: strips leading dots so dotfiles cannot escape", () => {
  assert.equal(sanitizeFilename(".htaccess"), "htaccess");
  assert.throws(() => sanitizeFilename("."), BadRequestError);
  assert.throws(() => sanitizeFilename(".."), BadRequestError);
});

test("sanitizeFilename: trims trailing dots and spaces", () => {
  assert.equal(sanitizeFilename("file.txt   "), "file.txt");
  assert.equal(sanitizeFilename("file.txt..."), "file.txt");
});

test("sanitizeFilename: refuses Windows-reserved device names", () => {
  for (const name of ["CON", "prn", "AUX.txt", "nul.log", "COM1", "lpt9.dat"]) {
    assert.throws(() => sanitizeFilename(name), BadRequestError, name);
  }
});

test("sanitizeFilename: refuses empty / non-string input", () => {
  assert.throws(() => sanitizeFilename(""), BadRequestError);
  assert.throws(() => sanitizeFilename("/"), BadRequestError);
  // @ts-expect-error -- runtime guard
  assert.throws(() => sanitizeFilename(null), BadRequestError);
});

// ============================================================================
// assertSafeRelativePath — relative paths that cannot escape a base dir.
// ============================================================================

test("assertSafeRelativePath: accepts safe relative paths", () => {
  assert.equal(assertSafeRelativePath("a/b/c.txt"), "a/b/c.txt");
  assert.equal(assertSafeRelativePath("uploads/2025/photo.jpg"), "uploads/2025/photo.jpg");
});

test("assertSafeRelativePath: rejects parent segments", () => {
  assert.throws(() => assertSafeRelativePath("../etc/passwd"), BadRequestError);
  assert.throws(() => assertSafeRelativePath("a/../../b"), BadRequestError);
});

test("assertSafeRelativePath: rejects POSIX absolute, Windows drive, UNC", () => {
  assert.throws(() => assertSafeRelativePath("/etc/passwd"), BadRequestError);
  assert.throws(() => assertSafeRelativePath("C:/Users/a"), BadRequestError);
  assert.throws(() => assertSafeRelativePath("c:foo"), BadRequestError);
});

test("assertSafeRelativePath: rejects backslash and NUL", () => {
  assert.throws(() => assertSafeRelativePath("a\\b"), BadRequestError);
  assert.throws(() => assertSafeRelativePath("a\0b"), BadRequestError);
});

test("assertSafeRelativePath: rejects empty / non-string input", () => {
  assert.throws(() => assertSafeRelativePath(""), BadRequestError);
  // @ts-expect-error -- runtime guard
  assert.throws(() => assertSafeRelativePath(123), BadRequestError);
});

// ============================================================================
// hasMongoOperatorKeys / assertNoMongoOperators — NoSQL operator injection.
// ============================================================================

test("hasMongoOperatorKeys: false for plain shapes", () => {
  assert.equal(hasMongoOperatorKeys(null), false);
  assert.equal(hasMongoOperatorKeys("string"), false);
  assert.equal(hasMongoOperatorKeys(42), false);
  assert.equal(hasMongoOperatorKeys({ a: 1, b: { c: 2 } }), false);
  assert.equal(hasMongoOperatorKeys([{ a: 1 }, { b: 2 }]), false);
});

test("hasMongoOperatorKeys: detects $-prefixed keys at any depth", () => {
  assert.equal(hasMongoOperatorKeys({ $ne: null }), true);
  assert.equal(hasMongoOperatorKeys({ password: { $ne: null } }), true);
  assert.equal(hasMongoOperatorKeys({ a: [{ $where: "1" }] }), true);
  assert.equal(hasMongoOperatorKeys({ a: { b: { c: { $regex: ".*" } } } }), true);
});

test("assertNoMongoOperators: throws on the auth-bypass payload", () => {
  // The textbook attack: { username: 'victim', password: { $ne: null } }
  // makes Mongo return any user with a non-null password.
  assert.throws(
    () => assertNoMongoOperators({ username: "victim", password: { $ne: null } }),
    BadRequestError
  );
});

test("assertNoMongoOperators: no-op on clean input", () => {
  assertNoMongoOperators({ username: "victim", password: "hunter2" });
  assertNoMongoOperators([{ id: 1 }, { id: 2 }]);
  assertNoMongoOperators(null);
});
