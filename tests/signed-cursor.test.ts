/**
 * `createCursorCodec()`: HMAC-SHA256 signed pagination cursors. A client
 * cannot edit the decoded payload, forge or truncate the signature, or extend
 * the expiry; every failure is one indistinguishable 400.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BadRequestError } from "../src/errors.js";
import {
  MAX_CURSOR_LENGTH,
  createCursorCodec,
  decodeCursor,
  encodeCursor,
} from "../src/pagination.js";
import { createCursorCodec as barrelCreateCursorCodec } from "../src/index.js";

const SECRET = "cursor-secret-with-enough-length-0123";
const OTHER = "a-different-secret-with-enough-length";

const isInvalid = (e: unknown) =>
  e instanceof BadRequestError &&
  e.status === 400 &&
  /Invalid pagination cursor/.test(String(e.problem.detail));

test("createCursorCodec is exported from the barrel", () => {
  assert.equal(barrelCreateCursorCodec, createCursorCodec);
});

test("signed cursor round-trips an arbitrary payload", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  for (const payload of [{ id: "abc", createdAt: 1700000000 }, [1, 2, 3], "s", 42, null, true]) {
    const cursor = await codec.encode(payload);
    assert.match(cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await codec.decode(cursor), payload);
  }
});

test("a tampered payload is refused even when it is valid base64url JSON", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  const cursor = await codec.encode({ tenantId: "a", offset: 20 });
  const [, sig] = cursor.split(".") as [string, string];
  const forgedBody = encodeCursor({ tenantId: "b", offset: 0 });
  // The forged body is itself a perfectly good unsigned cursor…
  assert.deepEqual(decodeCursor(forgedBody), { tenantId: "b", offset: 0 });
  // …but it does not carry a signature for the new bytes.
  await assert.rejects(codec.decode(`${forgedBody}.${sig}`), isInvalid);
});

test("a cursor signed with another secret, a flipped bit, or a truncated MAC is refused", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  const other = createCursorCodec({ secret: OTHER });
  const cursor = await codec.encode({ id: 1 });
  await assert.rejects(codec.decode(await other.encode({ id: 1 })), isInvalid);
  const last = cursor.at(-1)!;
  const flipped = cursor.slice(0, -1) + (last === "A" ? "B" : "A");
  await assert.rejects(codec.decode(flipped), isInvalid);
  await assert.rejects(codec.decode(cursor.slice(0, -1)), isInvalid);
  await assert.rejects(codec.decode(`${cursor}A`), isInvalid);
});

test("unsigned, empty, over-long, and malformed tokens are refused with the same error", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  for (const bad of [
    "",
    encodeCursor({ id: 1 }), // plain unsigned cursor
    ".",
    "abc.",
    ".def",
    "a".repeat(MAX_CURSOR_LENGTH + 1),
    `not base64!.${"A".repeat(43)}`,
    `${encodeCursor({ id: 1 })}.${"A".repeat(43)}`,
  ]) {
    await assert.rejects(codec.decode(bad), isInvalid, `accepted ${JSON.stringify(bad.slice(0, 40))}`);
  }
  await assert.rejects(codec.decode(undefined as unknown as string), isInvalid);
});

test("prototype-pollution keys are stripped from a signed payload too", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  const cursor = await codec.encode(
    JSON.parse('{"ok":1,"__proto__":{"polluted":true},"constructor":{"x":1}}')
  );
  const out = (await codec.decode(cursor)) as Record<string, unknown>;
  assert.deepEqual(out, { ok: 1 });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("ttlSeconds: a fresh cursor decodes, an expired one is refused, and the expiry cannot be extended", async () => {
  let t = 1_700_000_000_000;
  const codec = createCursorCodec({ secret: SECRET, ttlSeconds: 60, now: () => t });
  const cursor = await codec.encode({ id: 7 });
  assert.match(cursor, /^[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await codec.decode(cursor), { id: 7 });
  t += 59_000;
  assert.deepEqual(await codec.decode(cursor), { id: 7 });
  t += 2_000;
  await assert.rejects(codec.decode(cursor), isInvalid);
  // Rewriting the expiry field breaks the signature.
  const [body, exp, sig] = cursor.split(".") as [string, string, string];
  await assert.rejects(codec.decode(`${body}.${Number(exp) + 3600}.${sig}`), isInvalid);
});

test("ttlSeconds: a cursor minted without an expiry is refused by a codec that requires one, and vice versa", async () => {
  const plain = createCursorCodec({ secret: SECRET });
  const ttl = createCursorCodec({ secret: SECRET, ttlSeconds: 60 });
  await assert.rejects(ttl.decode(await plain.encode({ id: 1 })), isInvalid);
  await assert.rejects(plain.decode(await ttl.encode({ id: 1 })), isInvalid);
});

test("secret rotation: the first secret signs, every listed secret verifies", async () => {
  const old = createCursorCodec({ secret: OTHER });
  const outstanding = await old.encode({ id: "pre-rotation" });
  const rotated = createCursorCodec({ secret: [SECRET, OTHER] });
  assert.deepEqual(await rotated.decode(outstanding), { id: "pre-rotation" });
  const fresh = await rotated.encode({ id: "post-rotation" });
  // New cursors are signed with the first secret only.
  await assert.rejects(old.decode(fresh), isInvalid);
  assert.deepEqual(await createCursorCodec({ secret: SECRET }).decode(fresh), { id: "post-rotation" });
});

test("createCursorCodec refuses a missing or short secret and a bad ttl at construction", () => {
  assert.throws(() => createCursorCodec({ secret: "" }), /at least 16 characters/);
  assert.throws(() => createCursorCodec({ secret: "short" }), /at least 16 characters/);
  assert.throws(() => createCursorCodec({ secret: [] }), /at least one secret/);
  assert.throws(() => createCursorCodec({ secret: [SECRET, "short"] }), /at least 16 characters/);
  for (const ttl of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createCursorCodec({ secret: SECRET, ttlSeconds: ttl }), /ttlSeconds/);
  }
});

test("encode rejects a non-serializable payload with a TypeError, not a 400", async () => {
  const codec = createCursorCodec({ secret: SECRET });
  await assert.rejects(codec.encode(undefined), TypeError);
  await assert.rejects(codec.encode(() => 1), TypeError);
});
