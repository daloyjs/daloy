import assert from "node:assert/strict";
import { test } from "node:test";
import {
  App,
  bearerAuth,
  idempotency,
  requireScopes,
  responseCache,
  type StandardSchemaV1,
} from "../src/index.js";
import { hasReplayScopes } from "../src/internal-replay.js";

const responseBody: StandardSchemaV1<unknown, { marker: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      if (
        value !== null &&
        typeof value === "object" &&
        Object.keys(value).length === 1 &&
        Object.prototype.hasOwnProperty.call(value, "marker") &&
        (value as { marker: unknown }).marker === "protected-dummy-record"
      ) {
        return { value: value as { marker: string } };
      }
      return { issues: [{ message: "Expected the exact dummy record" }] };
    },
  },
};

test("replay scope admission ignores inherited arrays and getters without reading them", () => {
  let getterCalls = 0;
  const inheritedGetter = Object.create({
    get scopes() {
      getterCalls++;
      return ["records:read"];
    },
  });
  for (const user of [
    Object.create({ scopes: ["records:read"] }),
    inheritedGetter,
    { scopes: [] },
    { scopes: "records:read" },
    { scopes: [null, 123, "other"] },
  ]) {
    assert.equal(
      hasReplayScopes({
        state: { __daloyRequiredScopes: ["records:read"], user },
      }),
      false,
    );
  }
  assert.equal(getterCalls, 0);
  for (const user of [
    { scopes: ["records:read", "", null] },
    Object.assign(Object.create(null), { scopes: ["records:read"] }),
  ]) {
    assert.equal(
      hasReplayScopes({
        state: { __daloyRequiredScopes: ["records:read"], user },
      }),
      true,
    );
  }
  assert.equal(
    hasReplayScopes({
      state: {
        __daloyRequiredScopes: ["records:read", "records:write"],
        user: { scopes: ["records:read"] },
      },
    }),
    false,
  );
});

for (const kind of ["idempotency", "cache"] as const) {
  for (const phase of ["beforeHandle", "preBody"] as const) {
    test(`${kind} ${phase} scopes reject inherited-only principals on replay and fresh requests`, async () => {
      let principal: Record<string, unknown> = {
        sub: "dummy-owner",
        scopes: ["records:read"],
      };
      let calls = 0;
      const app = new App({
        env: "production",
        logger: false,
        behindProxy: "none",
      });
      app.use(
        bearerAuth({
          validate: (token) =>
            token === "dummy-scope-token" ? principal : false,
        }),
      );
      app.use(
        kind === "idempotency"
          ? idempotency()
          : responseCache({
              principal: (ctx) => (ctx.state.user as { sub: string }).sub,
            }),
      );
      app.route({
        method: kind === "idempotency" ? "POST" : "GET",
        path: "/scope-record",
        auth: { scheme: "bearerAuth" },
        hooks: requireScopes(["records:read"], { phase }),
        responses: { 200: { description: "Dummy record", body: responseBody } },
        handler: () => {
          calls++;
          return {
            status: 200 as const,
            body: { marker: "protected-dummy-record" },
          };
        },
      });
      const request = (fresh = false, token = "dummy-scope-token") => {
        const headers = new Headers({ authorization: `Bearer ${token}` });
        if (kind === "idempotency") {
          headers.set("idempotency-key", fresh ? "scope-two" : "scope-one");
        } else if (fresh) {
          headers.set("cache-control", "no-store");
        }
        return app.fetch(
          new Request("https://service.test/scope-record", {
            method: kind === "idempotency" ? "POST" : "GET",
            headers,
          }),
        );
      };
      assert.equal((await request()).status, 200);
      const replay = await request();
      assert.equal(replay.status, 200);
      assert.equal(
        replay.headers.get(
          kind === "idempotency" ? "idempotency-replayed" : "x-cache",
        ),
        kind === "idempotency" ? "true" : "HIT",
      );
      assert.equal(calls, 1);

      for (const user of [
        Object.assign(Object.create({ scopes: ["records:read"] }), {
          sub: "dummy-owner",
        }),
        { sub: "dummy-owner", scopes: [] },
        { sub: "dummy-owner", scopes: "records:read" },
        { sub: "dummy-owner" },
      ]) {
        principal = user;
        for (const fresh of [false, true]) {
          const forbidden = await request(fresh);
          assert.equal(forbidden.status, 403);
          assert.doesNotMatch(await forbidden.text(), /protected-dummy-record/);
          assert.equal(
            forbidden.headers.get(
              kind === "idempotency" ? "idempotency-replayed" : "x-cache",
            ),
            null,
          );
        }
      }
      assert.equal((await request(false, "dummy-invalid-token")).status, 403);
      principal = { sub: "dummy-owner", scopes: ["records:read"] };
      const restored = await request();
      assert.equal(restored.status, 200);
      assert.deepEqual(await restored.json(), {
        marker: "protected-dummy-record",
      });
      assert.equal(
        restored.headers.get(
          kind === "idempotency" ? "idempotency-replayed" : "x-cache",
        ),
        kind === "idempotency" ? "true" : "HIT",
      );
      assert.equal(
        calls,
        1,
        "Rejected requests must not replace the stored response",
      );
    });
  }
}
