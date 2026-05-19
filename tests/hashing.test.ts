import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordHash, passwordVerify } from "../src/hashing.js";

test("passwordHash returns a PHC-style scrypt string", async () => {
  const hash = await passwordHash("hunter2");
  assert.match(hash, /^\$scrypt\$N=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
});

test("passwordVerify returns true for the original password", async () => {
  const hash = await passwordHash("correct horse battery staple");
  assert.equal(await passwordVerify("correct horse battery staple", hash), true);
});

test("passwordVerify returns false for a wrong password", async () => {
  const hash = await passwordHash("right");
  assert.equal(await passwordVerify("wrong", hash), false);
});

test("passwordHash produces a different hash each time (random salt)", async () => {
  const a = await passwordHash("same");
  const b = await passwordHash("same");
  assert.notEqual(a, b);
  assert.equal(await passwordVerify("same", a), true);
  assert.equal(await passwordVerify("same", b), true);
});

test("passwordHash rejects empty input", async () => {
  await assert.rejects(() => passwordHash(""), TypeError);
  await assert.rejects(() => passwordHash(undefined as any), TypeError);
});

test("passwordVerify returns false for empty password", async () => {
  const hash = await passwordHash("x");
  assert.equal(await passwordVerify("", hash), false);
});

test("passwordVerify returns false on malformed PHC strings", async () => {
  assert.equal(await passwordVerify("p", "not-a-hash"), false);
  assert.equal(await passwordVerify("p", "$scrypt$missing-params"), false);
  assert.equal(await passwordVerify("p", "$bcrypt$N=1,r=1,p=1$abcd$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=0,r=1,p=1$abcd$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=3,r=1,p=1$abcd$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=2,r=0,p=1$abcd$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=2,r=1,p=0$abcd$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=2,r=1,p=1$$efgh"), false);
  assert.equal(await passwordVerify("p", "$scrypt$N=131072,r=8,p=1$not_base64!$efgh"), false);
  assert.equal(await passwordVerify("p", ""), false);
  assert.equal(await passwordVerify("p", undefined as any), false);
});

test("passwordVerify rejects hashes with downgraded scrypt parameters", async () => {
  const lowCostHash = "$scrypt$N=2,r=1,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(await passwordVerify("p", lowCostHash), false);
});
