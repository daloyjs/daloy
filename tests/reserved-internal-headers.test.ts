import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  BadRequestError,
  DEFAULT_MAX_HEADER_COUNT,
  RequestHeaderFieldsTooLargeError,
  RESERVED_INBOUND_HEADER_PREFIXES,
  assertNoReservedInternalHeaders,
} from "../src/index.js";
// Dispatch-internal (not part of the public index surface).
import { assertInboundHeaderGuards } from "../src/security.js";

// Structural regression for the Next.js CVE-2025-29927 class of bug.
// Daloy has no internal-trust header that could skip middleware, and
// the `x-daloy-internal-*` / `x-daloyjs-internal-*` namespaces are
// reserved so a future internal-routing marker cannot be silently
// spoofed by an external client.

test("RESERVED_INBOUND_HEADER_PREFIXES advertises the framework-owned prefixes", () => {
  assert.ok(RESERVED_INBOUND_HEADER_PREFIXES.includes("x-daloy-internal-"));
  assert.ok(RESERVED_INBOUND_HEADER_PREFIXES.includes("x-daloyjs-internal-"));
});

test("assertNoReservedInternalHeaders accepts ordinary headers", () => {
  const h = new Headers({
    host: "example.com",
    "content-length": "0",
    "user-agent": "curl/8",
    "x-request-id": "abc",
    "x-daloy-public": "ok", // not in the reserved namespace
  });
  assert.doesNotThrow(() => assertNoReservedInternalHeaders(h));
});

test("assertNoReservedInternalHeaders rejects spoofed x-daloy-internal-* headers", () => {
  for (const name of [
    "x-daloy-internal-subrequest",
    "X-DALOY-INTERNAL-RECURSION",
    "x-daloyjs-internal-bypass",
  ]) {
    const h = new Headers({ [name]: "yes" });
    assert.throws(
      () => assertNoReservedInternalHeaders(h),
      BadRequestError,
      `expected ${name} to be rejected`
    );
  }
});

test("assertInboundHeaderGuards accepts ordinary headers under the default cap", () => {
  const h = new Headers({
    host: "example.com",
    "content-length": "0",
    "user-agent": "curl/8",
  });
  assert.doesNotThrow(() => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT));
});

test("assertInboundHeaderGuards rejects reserved internal headers", () => {
  const h = new Headers({ "x-daloy-internal-subrequest": "1" });
  assert.throws(() => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT), BadRequestError);
});

test("assertInboundHeaderGuards rejects every advertised reserved prefix (fast-path filter must not drop any)", () => {
  for (const prefix of RESERVED_INBOUND_HEADER_PREFIXES) {
    const h = new Headers({ [`${prefix}bypass`]: "1" });
    assert.throws(
      () => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT),
      BadRequestError,
      `expected rejection for prefix ${prefix}`
    );
  }
});

test("assertInboundHeaderGuards enforces the header-count cap", () => {
  const flood = new Headers();
  for (let i = 0; i <= DEFAULT_MAX_HEADER_COUNT; i++) flood.set(`x-${i}`, "1");
  assert.throws(
    () => assertInboundHeaderGuards(flood, DEFAULT_MAX_HEADER_COUNT),
    RequestHeaderFieldsTooLargeError
  );
  // limit 0 disables the count cap (reserved check still runs)
  assert.doesNotThrow(() => assertInboundHeaderGuards(flood, 0));
  assert.throws(
    () => assertInboundHeaderGuards(new Headers({ "x-daloy-internal-x": "1" }), 0),
    BadRequestError
  );
});

test("assertInboundHeaderGuards: reserved header wins (400) even past the count cap", () => {
  // Headers iterate in sorted order, so `a-*` names all precede the reserved
  // `x-daloy-internal-*` name. The sequential guards (prefix scan first, then
  // count cap) rejected this with 400; the combined single-walk guard must
  // keep that precedence rather than tripping 431 at header limit+1.
  const h = new Headers();
  for (let i = 0; i < DEFAULT_MAX_HEADER_COUNT + 10; i++) {
    h.set(`a-header-${String(i).padStart(3, "0")}`, "1");
  }
  h.set("x-daloy-internal-bypass", "1");
  assert.throws(() => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT), BadRequestError);
});

test("assertInboundHeaderGuards rejects duplicate singleton headers (smuggling fold)", () => {
  // WHATWG Headers coalesces duplicates to a comma-joined value, so the
  // folded singleton check fires on "value contains a comma" — the same
  // semantics as the standalone assertNoDuplicateSingletonHeaders helper.
  for (const name of ["host", "content-length", "transfer-encoding"]) {
    const h = new Headers();
    h.append(name, name === "host" ? "a.example" : "1");
    h.append(name, name === "host" ? "b.example" : "2");
    assert.throws(
      () => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT),
      BadRequestError,
      `expected duplicate ${name} to be rejected`
    );
    // The duplicate-singleton 400 must also win when the count cap is disabled.
    assert.throws(() => assertInboundHeaderGuards(h, 0), BadRequestError);
  }
});

test("assertInboundHeaderGuards: duplicate singleton wins (400) even past the count cap", () => {
  // `zz-host`-style names sort after `a-*`, so put the duplicated singleton
  // (`transfer-encoding`) beyond the cap position: the deferred-431 design
  // must still reject it with the 400-class smuggling error.
  const h = new Headers();
  for (let i = 0; i < DEFAULT_MAX_HEADER_COUNT + 10; i++) {
    h.set(`a-header-${String(i).padStart(3, "0")}`, "1");
  }
  h.set("transfer-encoding", "chunked, chunked");
  assert.throws(() => assertInboundHeaderGuards(h, DEFAULT_MAX_HEADER_COUNT), BadRequestError);
});

test("App rejects requests carrying a reserved internal header with 400", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protected",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/protected", {
    headers: { "x-daloy-internal-subrequest": "middleware:middleware:middleware" },
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { title?: string };
  assert.match(String(body.title ?? ""), /Bad Request|Reserved internal header/i);
});

test("App answers 400 (not 431) when a reserved header rides in an over-cap flood", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protectedFlood",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const headers: Record<string, string> = {};
  for (let i = 0; i < DEFAULT_MAX_HEADER_COUNT + 10; i++) {
    headers[`a-header-${String(i).padStart(3, "0")}`] = "1";
  }
  headers["x-daloy-internal-subrequest"] = "1";
  const res = await app.request("/protected", { headers });
  assert.equal(res.status, 400);
});

test("App still answers 431 for a pure header-count flood (no reserved header)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protectedFlood431",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const headers: Record<string, string> = {};
  for (let i = 0; i < DEFAULT_MAX_HEADER_COUNT + 10; i++) {
    headers[`a-header-${String(i).padStart(3, "0")}`] = "1";
  }
  const res = await app.request("/protected", { headers });
  assert.equal(res.status, 431);
});

test("App still routes normally without the reserved header", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protected2",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/protected");
  assert.equal(res.status, 200);
});
