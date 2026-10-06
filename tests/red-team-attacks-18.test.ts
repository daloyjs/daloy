/**
 * Red-team round 18: CORS on rejections that happen before a route is matched.
 *
 * 1.5.4 applied a route's `cors()` policy before any hook, so auth and body
 * errors carry CORS headers. A few rejections happen earlier, before routing:
 * a `Host` outside `allowedHosts` (400), a header flood (431), and the
 * production 500 for an unconfigured proxy. They had no CORS headers, so a
 * browser showed a generic "CORS error". The App-level `cors()` policy now
 * applies to them. A route-level `cors()` cannot, because no route matched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, cors, except } from "../src/index.js";

const PORTAL = "https://portal.test";
const ok = { 200: { description: "ok" } } as const;

function corsApp(placement: "global-use" | "constructor" | "route", extra: Record<string, unknown> = {}) {
  const policy = cors({ origin: [PORTAL], credentials: true });
  const app = new App({
    logger: false,
    env: "production",
    allowedHosts: ["api.test"],
    ...(placement === "constructor" ? { hooks: policy } : {}),
    ...extra,
  } as never);
  if (placement === "global-use") app.use(policy);
  app.route({
    method: "GET",
    path: "/x",
    ...(placement === "route" ? { hooks: policy } : {}),
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  return app;
}

const flood: Record<string, string> = {};
for (let i = 0; i < 120; i++) flood[`x-h${i}`] = "1";

const rejections: Array<[string, string, Record<string, string>, number]> = [
  ["Host outside allowedHosts", "http://evil.test/x", {}, 400],
  ["header flood", "http://api.test/x", flood, 431],
  ["unconfigured proxy", "http://api.test/x", { "x-forwarded-for": "1.2.3.4" }, 500],
];

const send = (app: App, url: string, headers: Record<string, string>, origin: string | null = PORTAL) =>
  app.fetch(new Request(url, { headers: origin === null ? headers : { origin, ...headers } }));

test("[pre-route cors] the app-level policy reaches rejections before routing", async () => {
  for (const placement of ["global-use", "constructor"] as const) {
    for (const [label, url, headers, status] of rejections) {
      const res = await send(corsApp(placement), url, headers);
      assert.equal(res.status, status, `${placement} ${label}`);
      assert.equal(res.headers.get("access-control-allow-origin"), PORTAL, `${placement} ${label}`);
      assert.equal(res.headers.get("access-control-allow-credentials"), "true");
      assert.match(res.headers.get("vary") ?? "", /Origin/);
    }
  }
});

test("[pre-route cors] disallowed or missing origins still get no Access-Control-Allow-Origin", async () => {
  for (const [label, url, headers] of rejections) {
    const evil = await send(corsApp("global-use"), url, headers, "https://evil.test");
    assert.equal(evil.headers.get("access-control-allow-origin"), null, label);
    assert.equal(evil.headers.get("access-control-allow-credentials"), null, label);
    const none = await send(corsApp("global-use"), url, headers, null);
    assert.equal(none.headers.get("access-control-allow-origin"), null, label);
  }
});

test("[pre-route cors] a route-level-only policy does not apply before a route is matched", async () => {
  for (const [label, url, headers] of rejections) {
    const res = await send(corsApp("route"), url, headers);
    assert.equal(res.headers.get("access-control-allow-origin"), null, label);
  }
});

test("[pre-route cors] an except() path exemption on the global policy is respected", async () => {
  const app = new App({ logger: false, env: "production", allowedHosts: ["api.test"] });
  app.use(except(["/internal/**"], cors({ origin: [PORTAL] })));
  for (const path of ["/internal/x", "/api/x"] as const) {
    app.route({ method: "GET", path, responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  }
  const exempt = await send(app, "http://evil.test/internal/x", {});
  assert.equal(exempt.status, 400);
  assert.equal(exempt.headers.get("access-control-allow-origin"), null);
  const covered = await send(app, "http://evil.test/api/x", {});
  assert.equal(covered.headers.get("access-control-allow-origin"), PORTAL);
});

test("[pre-route cors] an onError hook's response gets the policy too", async () => {
  const app = corsApp("global-use", {
    hooks: { onError: () => new Response("custom", { status: 418 }) },
  });
  const res = await send(app, "http://evil.test/x", {});
  assert.equal(res.status, 418);
  assert.equal(res.headers.get("access-control-allow-origin"), PORTAL);
});
