import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, markWebSocketAuth } from "../src/app.js";
import { setConnInfo } from "../src/conn-info.js";
import { bearerAuth } from "../src/middleware.js";

// ---------- Probe limiter identity (health / readiness / metrics / CSP) ----------

function fromPeer(url: string, peer: string | undefined, init: RequestInit = {}): Request {
  const req = new Request(url, init);
  if (peer !== undefined) setConnInfo(req, { remoteAddress: peer, remotePort: 4000 });
  return req;
}

test("probe limiter: one peer exhausting /healthz does not 429 a different peer", async () => {
  const app = new App({ env: "development", logger: false });
  app.healthcheck({ rateLimit: { limit: 2, windowMs: 60_000 } });
  for (let i = 0; i < 2; i++) {
    assert.equal((await app.fetch(fromPeer("http://x/healthz", "198.51.100.7"))).status, 200);
  }
  assert.equal((await app.fetch(fromPeer("http://x/healthz", "198.51.100.7"))).status, 429);
  assert.equal((await app.fetch(fromPeer("http://x/healthz", "10.0.0.5"))).status, 200);
});

test("probe limiter: rotating X-Real-IP under behindProxy 'none' does not bypass the cap", async () => {
  const app = new App({ env: "development", logger: false, behindProxy: "none" });
  app.readinesscheck({ rateLimit: { limit: 2, windowMs: 60_000 } });
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await app.fetch(
      fromPeer("http://x/readyz", "198.51.100.7", { headers: { "x-real-ip": `203.0.113.${i}` } }),
    );
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [200, 200, 429, 429]);
});

test("probe limiter: rotating Fly-Client-IP from an untrusted { cidrs } peer does not bypass the cap", async () => {
  const app = new App({ env: "development", logger: false, behindProxy: { cidrs: ["10.9.0.0/16"] } });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const hit = (i: number) =>
    app.fetch(fromPeer("http://x/metrics", "198.51.100.7", { headers: { "fly-client-ip": `x${i}` } }));
  assert.equal((await hit(1)).status, 200);
  assert.equal((await hit(2)).status, 429);
});

test("probe limiter: a trusted { cidrs } proxy gives each forwarded client its own bucket", async () => {
  const app = new App({ env: "development", logger: false, behindProxy: { cidrs: ["10.9.0.0/16"] } });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const hit = (client: string) =>
    app.fetch(fromPeer("http://x/metrics", "10.9.0.2", { headers: { "x-forwarded-for": client } }));
  assert.equal((await hit("203.0.113.1")).status, 200);
  assert.equal((await hit("203.0.113.2")).status, 200);
  assert.equal((await hit("203.0.113.1")).status, 429);
});

test("probe limiter: IPv6 peers in one /64 share a bucket", async () => {
  const app = new App({ env: "development", logger: false });
  app.healthcheck({ rateLimit: { limit: 1, windowMs: 60_000 } });
  assert.equal((await app.fetch(fromPeer("http://x/healthz", "2001:db8:1:2::1"))).status, 200);
  assert.equal((await app.fetch(fromPeer("http://x/healthz", "2001:db8:1:2::ffff"))).status, 429);
  assert.equal((await app.fetch(fromPeer("http://x/healthz", "2001:db8:1:3::1"))).status, 200);
});

test("probe limiter: no peer metadata falls back to the shared global bucket", async () => {
  const app = new App({ env: "development", logger: false, trustProxy: true });
  app.healthcheck({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const hit = (ip: string) => app.fetch(new Request("http://x/healthz", { headers: { "x-real-ip": ip } }));
  assert.equal((await hit("1.1.1.1")).status, 200);
  assert.equal((await hit("2.2.2.2")).status, 429);
});

test("cspReportRoute: onReport receives the resolved peer, never a forged X-Real-IP", async () => {
  const seen: Array<string | null> = [];
  const app = new App({ env: "development", logger: false, behindProxy: "none" });
  app.cspReportRoute({ onReport: (_r, ctx) => void seen.push(ctx.ip) });
  const post = (peer: string | undefined) =>
    app.fetch(
      fromPeer("http://x/__csp-report", peer, {
        method: "POST",
        headers: { "content-type": "application/csp-report", "x-real-ip": "1.2.3.4-spoofed" },
        body: JSON.stringify({ "csp-report": { "blocked-uri": "x" } }),
      }),
    );
  assert.equal((await post("198.51.100.7")).status, 204);
  assert.equal((await post(undefined)).status, 204);
  assert.deepEqual(seen, ["198.51.100.7", null]);
});

// ---------- AppOptions.env validation ----------

test("env: canonical values construct and resolve as before", async () => {
  for (const env of ["development", "production", "test"] as const) {
    assert.doesNotThrow(() => new App({ env, logger: false, allowedHosts: ["x"] }));
  }
  const app = new App({ env: "test", logger: false });
  app.get("/boom", { responses: { 200: { description: "ok" } }, acknowledgeNoResponseBodySchema: true }, () => {
    throw new Error("TEST-DETAIL");
  });
  const body = await (await app.fetch(new Request("http://x/boom"))).text();
  assert.match(body, /TEST-DETAIL/, "explicit test env still reveals 5xx detail");
});

test("env: unrecognized values are refused at construction", () => {
  for (const env of ["Production", "prod", "staging", "", "PRODUCTION"]) {
    assert.throws(
      () => new App({ env: env as never, logger: false }),
      /env.*must be "development", "production" or "test"/,
      `env ${JSON.stringify(env)} must be refused`,
    );
  }
});

// ---------- app.ws() under requireAuth / group auth ----------

const wsHandler = { allowedOrigins: "same-origin" as const, open() {} };

test("ws requireAuth: an unmarked or missing beforeUpgrade is refused in every environment", () => {
  for (const env of ["development", "production"] as const) {
    const app = new App({ env, requireAuth: true, logger: false, allowedHosts: ["x"] });
    assert.throws(() => app.ws("/feed", { ...wsHandler, beforeUpgrade: () => undefined }), /requireAuth/);
    if (env === "development") assert.throws(() => app.ws("/bare", { open() {} }), /requireAuth/);
  }
});

test("ws requireAuth: markWebSocketAuth or acknowledgeUnauthenticated registers", () => {
  const app = new App({ env: "production", requireAuth: true, logger: false, allowedHosts: ["x"] });
  assert.doesNotThrow(() =>
    app.ws("/feed", {
      ...wsHandler,
      beforeUpgrade: markWebSocketAuth(() => new Response(null, { status: 401 })),
    }),
  );
  assert.doesNotThrow(() => app.ws("/public", { ...wsHandler, acknowledgeUnauthenticated: true }));
  assert.equal(app.webSocketRoutes.find("/feed") !== undefined, true);
});

test("ws group auth: an unmarked socket inside an auth group is refused, a marked one registers", () => {
  const app = new App({ env: "development", logger: false });
  app.group("/g", { auth: { scheme: "bearer" }, hooks: bearerAuth({ validate: (t) => t === "tok" }) }, (g) => {
    assert.throws(() => g.ws("/feed", { open() {} }), /group's auth declaration/);
    assert.doesNotThrow(() =>
      g.ws("/ok", { beforeUpgrade: markWebSocketAuth(() => undefined), open() {} }),
    );
  });
  // Outside any auth scope nothing changes in development.
  assert.doesNotThrow(() => app.ws("/open", { open() {} }));
});

test("markWebSocketAuth rejects a non-function", () => {
  assert.throws(() => markWebSocketAuth(undefined as never), TypeError);
});

// ---------- Body cap installed before user hooks ----------

const BIG = 4096;
const LIMIT = 1024;

function chunkedBody(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(512, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(0x61));
    },
  });
}

function streamingPost(url: string, bytes: number, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: chunkedBody(bytes),
    duplex: "half",
  } as RequestInit);
}

test("body cap: a schema-route preBody hook cannot read past bodyLimitBytes", async () => {
  let readBytes = -1;
  const app = new App({ env: "development", logger: false, bodyLimitBytes: LIMIT });
  app.route({
    method: "POST",
    path: "/s",
    request: { body: z.object({ a: z.number() }) },
    hooks: {
      async preBody(ctx) {
        readBytes = (await ctx.request.clone().arrayBuffer()).byteLength;
      },
    },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(streamingPost("http://x/s", BIG))).status, 413);
  assert.equal(readBytes, -1, "the hook's over-limit read must reject");
  // Happy path: a within-limit body still parses and validates.
  const ok = await app.fetch(
    new Request("http://x/s", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal(readBytes, 7);
});

test("body cap: global and route onRequest hooks cannot read past bodyLimitBytes", async () => {
  const reads: string[] = [];
  const app = new App({
    env: "development",
    logger: false,
    bodyLimitBytes: LIMIT,
    hooks: {
      async onRequest(request) {
        if (new URL(request.url).pathname !== "/global") return;
        await request.clone().arrayBuffer();
        reads.push("global");
      },
    },
  });
  const raw = { responses: { 200: { description: "ok" } }, acknowledgeNoResponseBodySchema: true } as const;
  app.post("/global", raw, () => new Response("ok"));
  app.post(
    "/route",
    {
      ...raw,
      hooks: {
        async onRequest(request: Request) {
          await request.text();
          reads.push("route");
        },
      },
    },
    () => new Response("ok"),
  );
  assert.equal((await app.fetch(streamingPost("http://x/global", BIG))).status, 413);
  assert.equal((await app.fetch(streamingPost("http://x/route", BIG))).status, 413);
  assert.deepEqual(reads, []);
  // Within-limit bodies still flow through both hooks.
  assert.equal((await app.fetch(streamingPost("http://x/global", 100))).status, 200);
  assert.equal((await app.fetch(streamingPost("http://x/route", 100))).status, 200);
  assert.deepEqual(reads, ["global", "route"]);
});

test("body cap: a declared Content-Length 0 paired with a real body is still capped", async () => {
  const app = new App({ env: "development", logger: false, bodyLimitBytes: LIMIT });
  app.post(
    "/raw",
    { responses: { 200: { description: "ok" } }, acknowledgeNoResponseBodySchema: true },
    async ({ request }) => new Response(String((await request.arrayBuffer()).byteLength)),
  );
  const forged = await app.fetch(streamingPost("http://x/raw", BIG, { "content-length": "0" }));
  assert.equal(forged.status, 413);
  // Happy path: a genuinely empty POST is untouched.
  const empty = await app.fetch(
    new Request("http://x/raw", { method: "POST", headers: { "content-length": "0" } }),
  );
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), "0");
});
