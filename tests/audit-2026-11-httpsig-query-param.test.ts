/**
 * Audit 2026-11: RFC 9421 §2.2.8 `@query-param` values (and names) must enter
 * the signature base percent-encoded. Previously the decoded value went in
 * raw, so a `%0A` in one covered parameter could forge the next component's
 * line and a signature over one URL verified for a different one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signMessage, verifyMessage } from "../src/index.js";

const SECRET = new Uint8Array(32).fill(9);
const CREATED = 1_700_000_000;
const now = () => CREATED * 1000;

const COMPONENTS = ["@method", '"@query-param";name="note"', '"@query-param";name="amount"'];
const REQUIRED = ["@method", '"@query-param";name="amount"'];
const Q1 =
  "https://api.example/pay?note=hi%0A%22%40query-param%22%3Bname%3D%22amount%22%3A%201&amount=000";
const Q2 =
  "https://api.example/pay?note=hi&amount=1%0A%22%40query-param%22%3Bname%3D%22amount%22%3A%20000";

async function sign(url: string, components: string[]) {
  return signMessage({
    method: "POST",
    url,
    components,
    alg: "hmac-sha256",
    key: SECRET,
    keyid: "partner",
    created: CREATED,
    now,
  });
}

async function verify(url: string, sig: { signatureInput: string; signature: string }) {
  return verifyMessage({
    method: "POST",
    url,
    headers: { "signature-input": sig.signatureInput, signature: sig.signature },
    algorithms: ["hmac-sha256"],
    requiredComponents: REQUIRED,
    resolveKey: () => SECRET,
    now,
  });
}

test("a boundary-shifted @query-param request no longer reuses the signature", async () => {
  const sig = await sign(Q1, COMPONENTS);
  // The LF stays encoded, so the base has exactly one line per component.
  assert.equal(sig.signatureBase.split("\n").length, COMPONENTS.length + 1);
  assert.match(sig.signatureBase, /"@query-param";name="note": hi%0A%22%40query-param%22/);
  // Happy: the signed URL itself verifies.
  assert.equal((await verify(Q1, sig)).valid, true);
  // Unhappy: the shifted URL (same decoded base under the old code) fails.
  const shifted = await verify(Q2, sig);
  assert.equal(shifted.valid, false);
  assert.equal(shifted.valid === false && shifted.reason, "invalid_signature");
});

test("RFC 9421 §2.2.8 example serializes names and values percent-encoded", async () => {
  const url =
    "https://example.com/parameters?var=this%20is%20a%20big%0Amultiline%20value" +
    "&bar=with+plus+whitespace&fa%C3%A7ade%22%3A%20=something";
  const sig = await sign(url, [
    '"@query-param";name="var"',
    '"@query-param";name="bar"',
    '"@query-param";name="fa%C3%A7ade%22%3A%20"',
  ]);
  const lines = sig.signatureBase.split("\n");
  assert.equal(lines[0], '"@query-param";name="var": this%20is%20a%20big%0Amultiline%20value');
  assert.equal(lines[1], '"@query-param";name="bar": with%20plus%20whitespace');
  assert.equal(lines[2], '"@query-param";name="fa%C3%A7ade%22%3A%20": something');
});

test("@query-param name is matched in encoded form; a decoded name does not resolve", async () => {
  const url = "https://api.example/x?a%20b=1";
  const ok = await sign(url, ['"@query-param";name="a%20b"']);
  assert.match(ok.signatureBase, /"@query-param";name="a%20b": 1/);
  await assert.rejects(() => sign(url, ['"@query-param";name="a b"']), /not present/);
});
