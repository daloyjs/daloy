/**
 * `behindProxy.header`: RFC 7239 `Forwarded` and Cloudflare `cf-connecting-ip`
 * as client-address sources, under the same right-to-left hop and peer-trust
 * rules as `X-Forwarded-For`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import {
  assertBehindProxy,
  parseForwardedHeader,
  readForwardedClientIp,
  resolveClientIp,
  resolveForwardedClientIp,
  setConnInfo,
} from "../src/conn-info.js";
import { compileCidrMatcher } from "../src/ip-match.js";
import { parseForwardedHeader as barrelParse } from "../src/index.js";

function req(headers: Record<string, string>, peer?: string): Request {
  const r = new Request("http://x/", { headers });
  if (peer) setConnInfo(r, { remoteAddress: peer });
  return r;
}

test("parseForwardedHeader is exported from the barrel", () => {
  assert.equal(barrelParse, parseForwardedHeader);
});

test("parseForwardedHeader reads for= in order and normalises the RFC 7239 node forms", () => {
  assert.deepEqual(parseForwardedHeader(null), []);
  assert.deepEqual(parseForwardedHeader(""), []);
  assert.deepEqual(parseForwardedHeader("for=192.0.2.43"), ["192.0.2.43"]);
  assert.deepEqual(parseForwardedHeader('for="[2001:db8:cafe::17]:4711"'), ["2001:db8:cafe::17"]);
  assert.deepEqual(parseForwardedHeader("for=192.0.2.43:4711"), ["192.0.2.43"]);
  assert.deepEqual(parseForwardedHeader("for=192.0.2.60;proto=http;by=203.0.113.43"), ["192.0.2.60"]);
  assert.deepEqual(parseForwardedHeader("for=192.0.2.43, for=198.51.100.17"), ["192.0.2.43", "198.51.100.17"]);
  assert.deepEqual(parseForwardedHeader("FOR=192.0.2.43;Proto=https"), ["192.0.2.43"]);
  assert.deepEqual(parseForwardedHeader('for="\\[2001:db8::1\\]"'), ["2001:db8::1"]);
});

test("parseForwardedHeader keeps unknown / obfuscated / missing for= as occupied non-IP slots", () => {
  // An attacker-supplied left entry must not shift into a trusted slot
  // because a middle proxy wrote `unknown`.
  assert.deepEqual(parseForwardedHeader("for=unknown"), ["unknown"]);
  assert.deepEqual(parseForwardedHeader("for=_hidden;proto=https"), ["unknown"]);
  assert.deepEqual(parseForwardedHeader("proto=https"), ["unknown"]);
  assert.deepEqual(parseForwardedHeader("for=192.0.2.1, for=_gazonk, for=198.51.100.9"), [
    "192.0.2.1",
    "unknown",
    "198.51.100.9",
  ]);
  // Only the first `for` in an element counts; a second is malformed, not a hop.
  assert.deepEqual(parseForwardedHeader("for=192.0.2.1;for=10.0.0.1"), ["192.0.2.1"]);
  // Not an IP, not a hop address.
  assert.deepEqual(parseForwardedHeader("for=evil.example"), ["unknown"]);
  assert.deepEqual(parseForwardedHeader("for=999.1.1.1"), ["unknown"]);
});

test("readForwardedClientIp: forwarded header is read right-to-left by hops like X-Forwarded-For", () => {
  const r = req({ forwarded: "for=203.0.113.9, for=198.51.100.17, for=192.0.2.43" });
  assert.equal(readForwardedClientIp(r, "forwarded", 1), "192.0.2.43");
  assert.equal(readForwardedClientIp(r, "forwarded", 2), "198.51.100.17");
  assert.equal(readForwardedClientIp(r, "forwarded", 3), "203.0.113.9");
  // Chain shorter than the declared topology: no identity, never the leftmost.
  assert.equal(readForwardedClientIp(r, "forwarded", 4), undefined);
  assert.equal(readForwardedClientIp(r, "forwarded", 0), undefined);
  // A selected slot that is not an IP yields no identity (does not slide left).
  const gap = req({ forwarded: "for=203.0.113.9, for=unknown" });
  assert.equal(readForwardedClientIp(gap, "forwarded", 1), undefined);
  assert.equal(readForwardedClientIp(gap, "forwarded", 2), "203.0.113.9");
});

test("readForwardedClientIp: cf-connecting-ip is a single hop and refuses hops > 1", () => {
  const r = req({ "cf-connecting-ip": "198.51.100.17", "x-forwarded-for": "203.0.113.9" });
  assert.equal(readForwardedClientIp(r, "cf-connecting-ip", 1), "198.51.100.17");
  assert.equal(readForwardedClientIp(r, "cf-connecting-ip", 2), undefined);
  assert.equal(readForwardedClientIp(req({ "cf-connecting-ip": "not-an-ip" }), "cf-connecting-ip", 1), undefined);
  assert.equal(readForwardedClientIp(req({}), "cf-connecting-ip", 1), undefined);
  // Selecting cf-connecting-ip ignores X-Forwarded-For entirely.
  assert.equal(readForwardedClientIp(req({ "x-forwarded-for": "203.0.113.9" }), "cf-connecting-ip", 1), undefined);
});

test("resolveClientIp honours behindProxy.header for { hops }", () => {
  const r = req(
    {
      forwarded: "for=203.0.113.9, for=198.51.100.17",
      "x-forwarded-for": "10.9.9.9, 10.8.8.8",
      "cf-connecting-ip": "192.0.2.77",
    },
    "172.16.0.5"
  );
  assert.equal(resolveClientIp(r, { hops: 1 }), "10.8.8.8");
  assert.equal(resolveClientIp(r, { hops: 1, header: "forwarded" }), "198.51.100.17");
  assert.equal(resolveClientIp(r, { hops: 2, header: "forwarded" }), "203.0.113.9");
  assert.equal(resolveClientIp(r, { hops: 1, header: "cf-connecting-ip" }), "192.0.2.77");
  // Header absent: the immediate peer is the fallback, exactly as for XFF.
  assert.equal(resolveClientIp(req({}, "172.16.0.5"), { hops: 1, header: "forwarded" }), "172.16.0.5");
});

test("resolveClientIp with { cidrs, header } trusts the header only from a verified peer", () => {
  const cfg = { cidrs: ["173.245.48.0/20"], header: "cf-connecting-ip" } as const;
  const fromCloudflare = req({ "cf-connecting-ip": "198.51.100.17" }, "173.245.48.10");
  assert.equal(resolveClientIp(fromCloudflare, cfg), "198.51.100.17");
  // Direct-to-origin attacker with a spoofed header gets their own peer IP.
  const direct = req({ "cf-connecting-ip": "198.51.100.17" }, "203.0.113.200");
  assert.equal(resolveClientIp(direct, cfg), "203.0.113.200");
  // Peer-less edge request: nothing to verify, nothing trusted.
  assert.equal(resolveClientIp(req({ "cf-connecting-ip": "198.51.100.17" }), cfg), undefined);
  const fwd = { cidrs: ["10.0.0.0/8"], header: "forwarded" } as const;
  assert.equal(resolveClientIp(req({ forwarded: "for=1.1.1.1, for=2.2.2.2" }, "10.1.2.3"), fwd), "2.2.2.2");
});

test("resolveForwardedClientIp accepts a source and keeps the trusted-peer gate", () => {
  const peers = [compileCidrMatcher("10.0.0.0/8")];
  const good = req({ forwarded: "for=198.51.100.17" }, "10.1.1.1");
  const bad = req({ forwarded: "for=198.51.100.17" }, "203.0.113.5");
  assert.equal(resolveForwardedClientIp(good, 1, peers, "forwarded"), "198.51.100.17");
  assert.equal(resolveForwardedClientIp(bad, 1, peers, "forwarded"), undefined);
  // The X-Real-IP one-hop fallback applies to the default source only.
  const realIp = req({ "x-real-ip": "198.51.100.17" });
  assert.equal(resolveForwardedClientIp(realIp, 1), "198.51.100.17");
  assert.equal(resolveForwardedClientIp(realIp, 1, undefined, "forwarded"), undefined);
  assert.equal(resolveForwardedClientIp(realIp, 1, undefined, "cf-connecting-ip"), undefined);
});

test("assertBehindProxy refuses an unknown header and cf-connecting-ip with hops > 1", () => {
  assert.doesNotThrow(() => assertBehindProxy({ hops: 1, header: "forwarded" }));
  assert.doesNotThrow(() => assertBehindProxy({ hops: 1, header: "cf-connecting-ip" }));
  assert.doesNotThrow(() => assertBehindProxy({ cidrs: ["10.0.0.0/8"], header: "cf-connecting-ip" }));
  assert.throws(() => assertBehindProxy({ hops: 1, header: "x-client-ip" as never }), /behindProxy\.header/);
  assert.throws(() => assertBehindProxy({ hops: 2, header: "cf-connecting-ip" }), /exactly one hop/);
  assert.throws(() => new App({ logger: false, behindProxy: { hops: 2, header: "cf-connecting-ip" } }), /exactly one hop/);
});

test("end-to-end: rateLimit() inherits behindProxy.header and keys on the Forwarded client", async () => {
  const { rateLimit } = await import("../src/middleware.js");
  const app = new App({ logger: false, env: "test", behindProxy: { hops: 1, header: "forwarded" } });
  app.use(rateLimit({ windowMs: 60_000, max: 1 }));
  app.route({
    method: "GET",
    path: "/",
    operationId: "root",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const hit = (client: string, spoofLeft = "") =>
    app.fetch(req({ forwarded: `${spoofLeft}for=${client}` }, "10.0.0.1"));
  assert.equal((await hit("198.51.100.1")).status, 200);
  assert.equal((await hit("198.51.100.1")).status, 429);
  // A different real client has its own bucket…
  assert.equal((await hit("198.51.100.2")).status, 200);
  // …but prepending a fake left-hand hop does not rotate the throttled client's identity.
  assert.equal((await hit("198.51.100.1", "for=203.0.113.77, ")).status, 429);
});
