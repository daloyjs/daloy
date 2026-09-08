import assert from "node:assert/strict";
import { test } from "node:test";
import { signRequest, verifyRequest } from "../src/http-signatures.js";

test("forged HTTP signatures cannot poison a stateful replay cache", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const signed = await signRequest(new Request("https://service.test/protected"), {
    alg: "hmac-sha256", key: secret, nonce: "legitimate-one-use-nonce",
  });
  const seen = new Set<string>();
  let checks = 0;
  const options = {
    algorithms: ["hmac-sha256" as const],
    resolveKey: () => secret,
    isReplay(nonce: string) {
      checks++;
      if (seen.has(nonce)) return true;
      seen.add(nonce);
      return false;
    },
  };
  const forged = signed.clone();
  forged.headers.set("signature", "sig1=:AAAA:");
  assert.equal((await verifyRequest(forged, options)).valid, false);
  assert.equal(checks, 0, "unverified metadata must not enter replay state");
  assert.equal((await verifyRequest(signed.clone(), options)).valid, true);
  assert.deepEqual(await verifyRequest(signed.clone(), options), { valid: false, reason: "replay_detected" });
  assert.equal(checks, 2);
});