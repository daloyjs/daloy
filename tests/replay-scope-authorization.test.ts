import assert from "node:assert/strict";
import { test } from "node:test";
import {
  App,
  idempotency,
  responseCache,
  requireScopes,
} from "../src/index.js";
import { hasReplayScopes } from "../src/internal-replay.js";
import { httpSignatureAuth, signRequest } from "../src/http-signatures.js";

for (const kind of ["cache", "idempotency"] as const) {
  test(`${kind} cannot replay to a caller without a valid HTTP message signature`, async () => {
    const app = new App({ logger: false });
    const secret = crypto.getRandomValues(new Uint8Array(32));
    app.use(kind === "cache" ? responseCache() : idempotency());
    app.use(
      httpSignatureAuth({
        algorithms: ["hmac-sha256"],
        resolveKey: () => secret,
      }),
    );
    let calls = 0;
    app.route({
      method: kind === "cache" ? "GET" : "POST",
      path: "/signed",
      responses: { 200: { description: "protected" } },
      handler: () => {
        calls++;
        return {
          status: 200 as const,
          body: { secret: "signature-protected-data" },
        };
      },
    });
    const request = () =>
      new Request("https://service.test/signed", {
        method: kind === "cache" ? "GET" : "POST",
        headers: { "idempotency-key": "signed-replay" },
      });
    const signed = await signRequest(request(), {
      alg: "hmac-sha256",
      key: secret,
    });
    assert.equal((await app.fetch(signed.clone())).status, 200);
    assert.equal((await app.fetch(signed.clone())).status, 200);
    assert.equal(calls, 1);
    const unsigned = await app.fetch(request());
    assert.equal(unsigned.status, 401);
    assert.doesNotMatch(await unsigned.text(), /signature-protected-data/);
    const forged = signed.clone();
    forged.headers.set("signature", "sig1=:AAAA:");
    assert.equal((await app.fetch(forged)).status, 401);
    assert.equal(calls, 1);
  });
}

test("stored response scope eligibility fails closed for missing, malformed and partial identities", () => {
  for (const user of [
    undefined,
    null,
    false,
    "user",
    {},
    { scopes: "read write" },
    { scopes: ["read"] },
  ]) {
    assert.equal(
      hasReplayScopes({
        state: { __daloyRequiredScopes: ["read", "write"], user },
      }),
      false,
    );
  }
  assert.equal(
    hasReplayScopes({
      state: {
        __daloyRequiredScopes: ["read", "write"],
        user: { scopes: ["read", "write", "other"] },
      },
    }),
    true,
  );
  assert.equal(hasReplayScopes({ state: {} }), true);
  assert.equal(hasReplayScopes({ state: { __daloyRequiredScopes: [] } }), true);
});

for (const kind of ["cache", "idempotency"] as const) {
  test(`${kind} replay cannot bypass a later scope guard after permission revocation`, async () => {
    const app = new App({ logger: false });
    let scopes = ["records:read"];
    let calls = 0;
    app.use({
      preBody(context) {
        context.state.user = { sub: "same-user", scopes };
      },
    });
    app.use(
      kind === "cache"
        ? responseCache({ principal: () => "same-user" })
        : idempotency(),
    );
    app.route({
      method: kind === "cache" ? "GET" : "POST",
      path: "/protected",
      hooks: requireScopes(["records:read"]),
      responses: { 200: { description: "protected" } },
      handler: () => {
        calls++;
        return {
          status: 200 as const,
          body: { secret: "protected-test-data" },
        };
      },
    });
    const request = () =>
      app.request("/protected", {
        method: kind === "cache" ? "GET" : "POST",
        headers: {
          authorization: "Bearer test-identity",
          "idempotency-key": "scope-replay",
        },
      });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 200);
    assert.equal(calls, 1, "authorized retries must replay");
    scopes = [];
    const forbidden = await request();
    assert.equal(
      forbidden.status,
      403,
      "permission revocation must apply even to stored responses",
    );
    assert.doesNotMatch(await forbidden.text(), /protected-test-data/);
    assert.equal(calls, 1);
    scopes = ["records:read"];
    assert.equal((await request()).status, 200);
    assert.equal(
      calls,
      1,
      "denied retries must not replace the stored response",
    );
  });
}
