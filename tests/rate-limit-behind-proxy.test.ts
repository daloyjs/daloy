import { test } from "node:test";
import assert from "node:assert/strict";

import { App, loginThrottle, rateLimit, type AppOptions, type Hooks } from "../src/index.js";
import { setConnInfo } from "../src/conn-info.js";

// rateLimit() / loginThrottle() given none of their own trust options follow
// the App's `behindProxy` posture, so behind a proxy they key on the real
// client instead of collapsing every caller onto the proxy's address (or one
// "global" bucket on peer-less edge adapters), which let any single client
// exhaust the limit for everyone.

type Req = { xff?: string; peer?: string };

function appWith(options: Partial<AppOptions>, hooks: Hooks, where: "use" | "route" | "group" = "use") {
  const app = new App({ logger: false, ...options } as AppOptions);
  const route = {
    method: "GET" as const,
    path: "/x" as const,
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  };
  if (where === "use") {
    app.use(hooks);
    app.route(route);
  } else if (where === "route") {
    app.route({ ...route, hooks });
  } else {
    app.group("/g", { hooks }, (g) => {
      g.route(route);
    });
  }
  return app;
}

async function hit(app: App<any>, r: Req, path = "/x"): Promise<Response> {
  const headers: Record<string, string> = {};
  if (r.xff !== undefined) headers["x-forwarded-for"] = r.xff;
  const req = new Request(`http://api.test${path}`, { headers });
  if (r.peer !== undefined) setConnInfo(req, { remoteAddress: r.peer });
  return app.fetch(req);
}

const remaining = (res: Response) => Number(res.headers.get("x-ratelimit-remaining"));

test("behindProxy { hops: 1 }: distinct clients get distinct buckets (no peer, like Vercel/Workers)", async () => {
  const app = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 5 }));
  assert.equal(remaining(await hit(app, { xff: "1.1.1.1" })), 4);
  assert.equal(remaining(await hit(app, { xff: "2.2.2.2" })), 4);
  assert.equal(remaining(await hit(app, { xff: "1.1.1.1" })), 3);
});

test("behindProxy { hops: 1 } behind a real proxy peer: keys on the client, not the proxy", async () => {
  const app = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 2 }));
  const proxy = "10.0.0.5";
  for (let i = 0; i < 3; i++) await hit(app, { peer: proxy, xff: "1.1.1.1" });
  assert.equal((await hit(app, { peer: proxy, xff: "1.1.1.1" })).status, 429);
  const other = await hit(app, { peer: proxy, xff: "2.2.2.2" });
  assert.equal(other.status, 200, "one client exhausting its bucket must not lock out another");
});

test("the right-most XFF slot is used, so rotating spoofed left entries cannot evade the limit", async () => {
  const app = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 2 }));
  const peer = "10.0.0.5";
  await hit(app, { peer, xff: "6.6.6.1, 9.9.9.9" });
  await hit(app, { peer, xff: "6.6.6.2, 9.9.9.9" });
  const third = await hit(app, { peer, xff: "6.6.6.3, 9.9.9.9" });
  assert.equal(third.status, 429);
});

test("behindProxy { cidrs }: forwarded identity honoured only from a listed proxy peer", async () => {
  const app = appWith({ behindProxy: { cidrs: ["10.0.0.0/8"] } }, rateLimit({ windowMs: 60_000, max: 1 }));
  // Direct-to-origin attacker (peer outside the list) rotating XFF values
  // stays in ONE bucket keyed on their real peer address.
  await hit(app, { peer: "203.0.113.9", xff: "1.1.1.1" });
  assert.equal((await hit(app, { peer: "203.0.113.9", xff: "2.2.2.2" })).status, 429);
  // Via the real proxy, two clients are separated.
  assert.equal((await hit(app, { peer: "10.1.2.3", xff: "3.3.3.3" })).status, 200);
  assert.equal((await hit(app, { peer: "10.1.2.3", xff: "4.4.4.4" })).status, 200);
});

test("no behindProxy (or 'none'): unchanged, forwarded headers are ignored", async () => {
  for (const options of [{}, { behindProxy: "none" as const }]) {
    const app = appWith(options, rateLimit({ windowMs: 60_000, max: 1 }));
    await hit(app, { peer: "203.0.113.9", xff: "1.1.1.1" });
    assert.equal((await hit(app, { peer: "203.0.113.9", xff: "2.2.2.2" })).status, 429, JSON.stringify(options));
    assert.equal((await hit(app, { peer: "203.0.113.10" })).status, 200, "other peers keep their own bucket");
  }
});

test("a peer-less request with no resolvable client IP still shares 'global' (fail closed, as before)", async () => {
  const app = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 1 }));
  await hit(app, {});
  assert.equal((await hit(app, {})).status, 429);
});

test("explicit rateLimit trust options always win over the App posture", async () => {
  // trustProxyHeaders: false is a deliberate "never trust forwarded headers".
  const refuse = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 1, trustProxyHeaders: false }));
  await hit(refuse, { peer: "10.0.0.5", xff: "1.1.1.1" });
  assert.equal((await hit(refuse, { peer: "10.0.0.5", xff: "2.2.2.2" })).status, 429);
  // A custom keyGenerator is used verbatim.
  const custom = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 1, keyGenerator: () => "same" }));
  await hit(custom, { xff: "1.1.1.1" });
  assert.equal((await hit(custom, { xff: "2.2.2.2" })).status, 429);
  // trustedHops on the limiter itself overrides the App's hops.
  const own = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 1, trustedHops: 2 }));
  await hit(own, { xff: "1.1.1.1, 7.7.7.7" });
  assert.equal((await hit(own, { xff: "1.1.1.1, 8.8.8.8" })).status, 429, "2 hops keys on the second-from-right slot");
});

test("route-level and group hooks inherit the posture too", async () => {
  for (const where of ["route", "group"] as const) {
    const app = appWith({ behindProxy: { hops: 1 } }, rateLimit({ windowMs: 60_000, max: 1 }), where);
    const path = where === "group" ? "/g/x" : "/x";
    await hit(app, { xff: "1.1.1.1" }, path);
    assert.equal((await hit(app, { xff: "2.2.2.2" }, path)).status, 200, where);
    assert.equal((await hit(app, { xff: "1.1.1.1" }, path)).status, 429, where);
  }
});

test("one limiter shared by two Apps with different postures falls back to the TCP peer", async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const a = appWith({ behindProxy: { hops: 1 } }, limiter);
  appWith({ behindProxy: { cidrs: ["10.0.0.0/8"] } }, limiter);
  await hit(a, { peer: "10.0.0.5", xff: "1.1.1.1" });
  assert.equal((await hit(a, { peer: "10.0.0.5", xff: "2.2.2.2" })).status, 429);
  // The same posture registered twice is not a conflict.
  const shared = rateLimit({ windowMs: 60_000, max: 1 });
  const b = appWith({ behindProxy: { hops: 1 } }, shared);
  appWith({ behindProxy: { hops: 1 } }, shared);
  await hit(b, { xff: "1.1.1.1" });
  assert.equal((await hit(b, { xff: "2.2.2.2" })).status, 200);
});

test("loginThrottle inherits the posture, so one attacker cannot lock every user out of login", async () => {
  const app = appWith(
    { behindProxy: { hops: 1 } },
    loginThrottle({ windowMs: 60_000, max: 2, delayAfter: 100, groupId: `lt-${Date.now()}` })
  );
  const proxy = "10.0.0.5";
  for (let i = 0; i < 3; i++) await hit(app, { peer: proxy, xff: "6.6.6.6" });
  assert.equal((await hit(app, { peer: proxy, xff: "6.6.6.6" })).status, 429);
  assert.equal((await hit(app, { peer: proxy, xff: "1.1.1.1" })).status, 200);
  // And an explicit trustProxyHeaders: false still refuses forwarded identity.
  const refuse = appWith(
    { behindProxy: { hops: 1 } },
    loginThrottle({ windowMs: 60_000, max: 1, delayAfter: 100, trustProxyHeaders: false, groupId: `lt2-${Date.now()}` })
  );
  await hit(refuse, { peer: proxy, xff: "1.1.1.1" });
  assert.equal((await hit(refuse, { peer: proxy, xff: "2.2.2.2" })).status, 429);
});
