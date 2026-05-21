/**
 * Wave 6 — production fitness & deploy hardening tests.
 * Focused happy-path + critical refusal tests for the 16 Wave 6 items.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  assertBehindProxy,
  defineDependency,
  getConnInfo,
  pickForwardedForByHops,
  PSL_PUBLIC_SUFFIXES,
  resolveClientIp,
  setConnInfo,
  subdomains,
} from "../src/index.js";
import { topoSortExtensions } from "../src/app.js";

describe("Wave 6 — behindProxy declarative model", () => {
  it("accepts the four shapes", () => {
    assertBehindProxy("none");
    assertBehindProxy("loopback");
    assertBehindProxy({ hops: 1 });
    assertBehindProxy({ cidrs: ["10.0.0.0/8"] });
    assertBehindProxy(undefined);
  });
  it("rejects malformed values", () => {
    assert.throws(() => assertBehindProxy({ hops: -1 } as any));
    assert.throws(() => assertBehindProxy({ hops: 100 } as any));
    assert.throws(() => assertBehindProxy({ cidrs: [] } as any));
    assert.throws(() => assertBehindProxy({ cidrs: [""] } as any));
    assert.throws(() => assertBehindProxy("trust-all" as any));
  });
  it("rejects non-string CIDR entries", () => {
    assert.throws(() => assertBehindProxy({ cidrs: [123] } as any), /non-empty strings/);
  });
  it("App constructor refuses bad behindProxy", () => {
    assert.throws(() => new App({ behindProxy: { hops: 99 } as any }));
  });
  it("behindProxy: 'loopback' satisfies the production trust-proxy boot guard", async () => {
    const app = new App({
      behindProxy: "loopback",
      env: "production",
      docs: false,
      hooks: undefined,
    });
    app.route({
      method: "GET",
      path: "/x",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    });
    const res = await app.fetch(
      new Request("http://test/x", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    assert.equal(res.status, 200);
  });
});

describe("Wave 6 — ConnInfo abstraction", () => {
  it("set + get round-trip", () => {
    const req = new Request("http://test/");
    setConnInfo(req, { remoteAddress: "192.0.2.1", remotePort: 4242, tls: true });
    const info = getConnInfo(req);
    assert.equal(info?.remoteAddress, "192.0.2.1");
    assert.equal(info?.remotePort, 4242);
    assert.equal(info?.tls, true);
  });
  it("returns undefined when no info attached", () => {
    assert.equal(getConnInfo(new Request("http://test/")), undefined);
  });
  it("resolveClientIp respects 'none' and ignores XFF", () => {
    const req = new Request("http://t/", { headers: { "x-forwarded-for": "1.1.1.1" } });
    setConnInfo(req, { remoteAddress: "10.0.0.1" });
    assert.equal(resolveClientIp(req, "none"), "10.0.0.1");
  });
  it("resolveClientIp respects 'loopback' + reads XFF", () => {
    const req = new Request("http://t/", { headers: { "x-forwarded-for": "203.0.113.7" } });
    setConnInfo(req, { remoteAddress: "127.0.0.1" });
    assert.equal(resolveClientIp(req, "loopback"), "203.0.113.7");
  });
  it("resolveClientIp respects hops", () => {
    const req = new Request("http://t/", {
      headers: { "x-forwarded-for": "client, lb1, lb2" },
    });
    setConnInfo(req, { remoteAddress: "127.0.0.1" });
    assert.equal(resolveClientIp(req, { hops: 3 }), "client");
    assert.equal(resolveClientIp(req, { hops: 2 }), "lb1");
  });
  it("pickForwardedForByHops returns undefined when chain is too short", () => {
    assert.equal(pickForwardedForByHops("a, b", 5), undefined);
    assert.equal(pickForwardedForByHops(null, 1), undefined);
  });
});

describe("Wave 6 — subdomains PSL helper", () => {
  it("splits a single-label TLD", () => {
    const r = subdomains("api.example.com");
    assert.equal(r.baseDomain, "example.com");
    assert.equal(r.subdomain, "api");
    assert.deepEqual(r.labels, ["api"]);
  });
  it("splits multi-label public suffix (co.uk)", () => {
    const r = subdomains("api.tenant.example.co.uk");
    assert.equal(r.baseDomain, "example.co.uk");
    assert.equal(r.subdomain, "api.tenant");
  });
  it("splits PaaS preview-deploy suffix (vercel.app)", () => {
    const r = subdomains("foo.tenant.vercel.app");
    assert.equal(r.baseDomain, "tenant.vercel.app");
    assert.equal(r.subdomain, "foo");
  });
  it("returns empty subdomain when host equals base", () => {
    const r = subdomains("example.com");
    assert.equal(r.subdomain, "");
    assert.deepEqual(r.labels, []);
  });
  it("honours explicit baseDomain override", () => {
    const r = subdomains("api.example.org", { baseDomain: "example.org" });
    assert.equal(r.baseDomain, "example.org");
    assert.equal(r.subdomain, "api");
  });
  it("throws when host is not under baseDomain", () => {
    assert.throws(() => subdomains("evil.com", { baseDomain: "example.com" }));
  });
  it("rejects empty hostnames", () => {
    assert.throws(() => subdomains(""), /non-empty string/);
  });
  it("rejects invalid PSL snapshot dates", () => {
    assert.throws(() =>
      subdomains("api.example.com", {
        production: true,
        _snapshotDate: "not-a-date",
      }),
    );
  });
  it("refuses stale PSL in production", () => {
    assert.throws(() =>
      subdomains("api.example.com", {
        production: true,
        _snapshotDate: "2020-01-01",
        _now: new Date("2026-05-20"),
      }),
    );
  });
  it("accepts fresh PSL in production", () => {
    const r = subdomains("api.example.com", {
      production: true,
      _snapshotDate: "2026-05-01",
      _now: new Date("2026-05-20"),
    });
    assert.equal(r.baseDomain, "example.com");
  });
  it("PSL snapshot contains the documented preview-deploy entries", () => {
    for (const entry of [
      "vercel.app",
      "workers.dev",
      "github.io",
      "s3.amazonaws.com",
    ]) {
      assert.ok(PSL_PUBLIC_SUFFIXES.includes(entry), `missing ${entry}`);
    }
  });
});

describe("Wave 6 — namespace-protected decorators", () => {
  it("refuses to overwrite an existing decoration", () => {
    const app = new App();
    app.decorate("db", { a: 1 });
    assert.throws(() => app.decorate("db", { a: 2 }));
  });
  it("allows override with { override: true }", () => {
    const app = new App();
    app.decorate("db", { a: 1 });
    app.decorate("db", { a: 2 }, { override: true });
  });
});

describe("Wave 6 — plugin dependencies / seed / stateful", () => {
  it("refuses-to-boot when a declared dependency is missing", () => {
    const app = new App();
    assert.throws(() =>
      app.register({
        name: "rate-limit-cluster",
        dependencies: ["redis-connection"],
        register: () => {},
      }),
    );
  });
  it("accepts dependencies that have been registered first", () => {
    const app = new App();
    app.register({ name: "redis-connection", register: () => {} });
    app.register({
      name: "rate-limit-cluster",
      dependencies: ["redis-connection"],
      register: () => {},
    });
  });
  it("dedups by name+seed", () => {
    const app = new App();
    app.register({ name: "metrics", seed: "a", register: () => {} });
    app.register({ name: "metrics", seed: "b", register: () => {} });
    assert.throws(() =>
      app.register({ name: "metrics", seed: "a", register: () => {} }),
    );
  });
  it("refuses anonymous stateful plugin in production", () => {
    const app = new App({ env: "production" });
    assert.throws(() =>
      app.register({ stateful: true, register: () => {} }),
    );
  });
});

describe("Wave 6 — plugin extension ordering", () => {
  it("topoSortExtensions orders by before/after", () => {
    const out = topoSortExtensions([
      { name: "b", event: "onRequest", handler: () => {}, after: ["a"] },
      { name: "a", event: "onRequest", handler: () => {} },
      { name: "c", event: "onRequest", handler: () => {}, after: ["b"] },
    ]);
    assert.deepEqual(out.map((e) => e.name), ["a", "b", "c"]);
  });
  it("detects cycles", () => {
    assert.throws(() =>
      topoSortExtensions([
        { name: "a", event: "onRequest", handler: () => {}, after: ["b"] },
        { name: "b", event: "onRequest", handler: () => {}, after: ["a"] },
      ]),
    );
  });
  it("refuses duplicate extension names", () => {
    assert.throws(() =>
      topoSortExtensions([
        { name: "a", event: "onRequest", handler: () => {} },
        { name: "a", event: "onRequest", handler: () => {} },
      ]),
    );
  });
});

describe("Wave 6 — defineDependency", () => {
  it("refuses missing dependency names", () => {
    assert.throws(() => defineDependency({ name: "" as any, resolve: () => 1 }));
  });
  it("returns hooks with a beforeHandle that writes to state", async () => {
    const dep = defineDependency({
      name: "user",
      resolve: () => ({ id: 1 }),
    });
    const state: Record<string, unknown> = {};
    const ctx = { state, request: new Request("http://t/") } as any;
    await dep.beforeHandle!(ctx);
    assert.deepEqual(state.user, { id: 1 });
  });
  it("dedupes resolve per request", async () => {
    let calls = 0;
    const dep = defineDependency({
      name: "user",
      resolve: () => ({ id: ++calls }),
    });
    const state: Record<string, unknown> = {};
    const ctx = { state, request: new Request("http://t/") } as any;
    await dep.beforeHandle!(ctx);
    await dep.beforeHandle!(ctx);
    assert.equal(calls, 1);
    assert.deepEqual(state.user, { id: 1 });
  });
  it("refuses self-cycle at construction", () => {
    assert.throws(() =>
      defineDependency({ name: "x", dependsOn: ["x"], resolve: () => 1 }),
    );
  });
  it("requires declared dependencies to have run first", async () => {
    const dep = defineDependency({
      name: "user",
      dependsOn: ["auth"],
      resolve: () => 1,
    });
    const ctx = { state: {}, request: new Request("http://t/") } as any;
    await assert.rejects(dep.beforeHandle!(ctx));
  });
});
