import { test } from "node:test";
import assert from "node:assert/strict";

import { App, rateLimit, type RateLimitOptions } from "../src/index.js";

// rateLimit({ standardHeaders: "draft-8" }) adds the IETF RateLimit /
// RateLimit-Policy headers (draft-ietf-httpapi-ratelimit-headers-08) next to,
// or instead of, the legacy X-RateLimit-* trio. Default output is unchanged.

function appWith(opts: Partial<RateLimitOptions>) {
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 60_000, max: 2, keyGenerator: () => "k", ...opts }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  return app;
}

test("rateLimit standardHeaders draft-8: emits RateLimit-Policy and RateLimit alongside the legacy headers", async () => {
  const res = await appWith({ standardHeaders: "draft-8" }).request("/x");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("ratelimit-policy"), '"2-in-60sec"; q=2; w=60');
  assert.match(res.headers.get("ratelimit") ?? "", /^"2-in-60sec"; r=1; t=(60|59)$/);
  assert.equal(res.headers.get("x-ratelimit-remaining"), "1", "legacy headers stay on by default");
});

test("rateLimit standardHeaders draft-8: remaining counts down and a 429 keeps the headers plus Retry-After", async () => {
  const app = appWith({ standardHeaders: "draft-8" });
  await app.request("/x");
  const second = await app.request("/x");
  assert.match(second.headers.get("ratelimit") ?? "", /; r=0; t=\d+$/);
  const limited = await app.request("/x");
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("ratelimit") ?? "", /^"2-in-60sec"; r=0; t=\d+$/);
  assert.equal(limited.headers.get("ratelimit-policy"), '"2-in-60sec"; q=2; w=60');
  assert.ok(limited.headers.get("retry-after"), "Retry-After must still be sent on 429");
});

test("rateLimit legacyHeaders: false with draft-8 sends only the IETF headers", async () => {
  const res = await appWith({ standardHeaders: "draft-8", legacyHeaders: false }).request("/x");
  assert.equal(res.headers.get("x-ratelimit-limit"), null);
  assert.equal(res.headers.get("x-ratelimit-remaining"), null);
  assert.equal(res.headers.get("x-ratelimit-reset"), null);
  assert.ok(res.headers.get("ratelimit"));
});

test("[unhappy] rateLimit with no header options keeps the pre-existing output exactly", async () => {
  const res = await appWith({}).request("/x");
  assert.equal(res.headers.get("ratelimit"), null);
  assert.equal(res.headers.get("ratelimit-policy"), null);
  assert.equal(res.headers.get("x-ratelimit-limit"), "2");
});

test("[unhappy] rateLimit legacyHeaders: false never disables enforcement", async () => {
  const app = appWith({ legacyHeaders: false });
  await app.request("/x");
  await app.request("/x");
  const limited = await app.request("/x");
  assert.equal(limited.status, 429, "turning headers off must not turn the limit off");
  assert.equal(limited.headers.get("x-ratelimit-remaining"), null);
});

test("[unhappy] rateLimit refuses an unknown standardHeaders value at construction", () => {
  assert.throws(
    () => rateLimit({ windowMs: 60_000, max: 2, standardHeaders: "draft-7" as never }),
    /standardHeaders must be "draft-8"/,
  );
  assert.throws(
    () => rateLimit({ windowMs: 60_000, max: 2, standardHeaders: true as never }),
    /standardHeaders must be "draft-8"/,
  );
});

test("rateLimit draft-8 policy window rounds a sub-second remainder up", async () => {
  const res = await appWith({ standardHeaders: "draft-8", windowMs: 1_500, max: 5 }).request("/x");
  assert.equal(res.headers.get("ratelimit-policy"), '"5-in-2sec"; q=5; w=2');
});
