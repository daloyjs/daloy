/**
 * RED-TEAM ATTACK SUITE — WAVE 6 (defense verification: session, cookies,
 * BREACH, multipart, WAF evasion)
 * =======================================================================
 *
 * This wave probed four further classes and found the framework already
 * defends them. The tests LOCK those defenses in so a future refactor cannot
 * silently regress them, and they document the one real limitation (signature
 * WAFs do not see multiply-encoded payloads — a defense-in-depth caveat).
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  session,
  MemorySessionStore,
  compression,
  waf,
  multipartObject,
  fileField,
} from "../src/index.js";

const SESSION_SECRET = "unit-test-session-secret-0123456789"; // >= 32 chars

// ===========================================================================
// 1. SESSION FIXATION / FORGERY — a client-supplied session id is never adopted
// ===========================================================================

function sessionApp() {
  const app = new App({ env: "development", logger: false });
  app.use(session({ secret: SESSION_SECRET, store: new MemorySessionStore() }));
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: { 200: { description: "ok", body: z.object({ id: z.string(), user: z.string().nullable() }) as any } },
    handler: async ({ state }: any) => ({
      status: 200 as const,
      body: { id: state.session.id, user: (state.session.get("user") as string) ?? null },
    }),
  });
  return app;
}

test("[session/fixation] a forged session cookie is rejected; a fresh id is issued, no data adopted", async () => {
  const app = sessionApp();
  // Attacker plants a chosen id with a bogus signature.
  const res = await app.request("/whoami", {
    headers: { cookie: "__Host-daloy.sid=attacker-fixed-id.deadbeefbadsignature" },
  });
  const json = await res.json();
  assert.notEqual(json.id, "attacker-fixed-id", "the attacker-chosen id must NOT become the session id");
  assert.equal(json.user, null, "no session data is adopted from an unsigned cookie");
});

test("[session/fixation] regenerate() rotates the id (the fixation-defense primitive)", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(session({ secret: SESSION_SECRET, store: new MemorySessionStore() }));
  app.route({
    method: "POST",
    path: "/login",
    operationId: "login",
    responses: { 200: { description: "ok", body: z.object({ before: z.string(), after: z.string() }) as any } },
    handler: async ({ state }: any) => {
      const before = state.session.id;
      state.session.set("user", "bob"); // privilege change
      const after = await state.session.regenerate();
      return { status: 200 as const, body: { before, after } };
    },
  });
  const json = await (await app.request("/login", { method: "POST" })).json();
  assert.notEqual(json.before, json.after, "the session id must rotate on privilege change");
});

test("[session/cookie-tossing] session cookie ships __Host- + HttpOnly + Secure + SameSite", async () => {
  const app = sessionApp();
  app.route({
    method: "POST",
    path: "/set",
    operationId: "set",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ state }: any) => {
      state.session.set("user", "carol");
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const res = await app.request("/set", { method: "POST" });
  const sc = res.headers.get("set-cookie") ?? "";
  assert.match(sc, /^__Host-daloy\.sid=/, "the __Host- prefix forbids a subdomain from tossing the cookie");
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /Secure/i);
  assert.match(sc, /SameSite=/i);
});

// ===========================================================================
// 2. BREACH — compression must not apply to credentialed / per-user responses
// ===========================================================================

function compressionApp() {
  const app = new App({ env: "development", logger: false });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/data",
    operationId: "data",
    responses: { 200: { description: "ok", body: z.object({ blob: z.string() }) as any } },
    handler: async () => ({ status: 200 as const, body: { blob: "A".repeat(8192) } }),
  });
  return app;
}

test("[breach] a public response IS compressed, but a credentialed one is NOT", async () => {
  const app = compressionApp();
  const pub = await app.request("/data", { headers: { "accept-encoding": "gzip" } });
  assert.equal(pub.headers.get("content-encoding"), "gzip", "public, compressible responses are compressed");

  const authed = await app.request("/data", {
    headers: { "accept-encoding": "gzip", authorization: "Bearer secret-token" },
  });
  assert.equal(authed.headers.get("content-encoding"), null, "Authorization-bearing responses skip compression (BREACH)");
});

test("[breach] a request carrying a session cookie skips compression", async () => {
  const app = compressionApp();
  const res = await app.request("/data", {
    headers: { "accept-encoding": "gzip", cookie: "__Host-daloy.sid=abc.def" },
  });
  assert.equal(res.headers.get("content-encoding"), null, "session-cookie requests skip compression (BREACH)");
});

// ===========================================================================
// 3. MULTIPART — global per-file byte cap rejects oversized uploads
// ===========================================================================

test("[multipart/dos] AppOptions.multipart.maxFileBytes rejects an oversized upload (413)", async () => {
  const app = new App({ env: "development", logger: false, multipart: { maxFileBytes: 16 } });
  app.route({
    method: "POST",
    path: "/up",
    operationId: "up",
    request: { body: multipartObject({ file: fileField() }) as any },
    responses: { 201: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 201 as const, body: { ok: true } }),
  });
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(1024)], "big.bin", { type: "application/octet-stream" }));
  const res = await app.request("/up", { method: "POST", body: fd });
  assert.equal(res.status, 413);
});

// ===========================================================================
// 4. WAF — single-encoded payloads are caught; double-encoding is a documented
//    signature-WAF limitation (defense-in-depth, not the primary control).
// ===========================================================================

function wafApp() {
  const app = new App({ env: "development", logger: false });
  app.use(waf());
  app.route({
    method: "GET",
    path: "/q",
    operationId: "q",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("[waf] single-percent-encoded SQLi/XSS in the query is decoded and blocked (403)", async () => {
  const app = wafApp();
  // encodeURIComponent yields single-encoding; the WAF decodes once and matches.
  assert.equal((await app.request(`/q?x=${encodeURIComponent("' OR 1=1")}`)).status, 403);
  assert.equal((await app.request(`/q?x=${encodeURIComponent("<script>alert(1)</script>")}`)).status, 403);
});

test("[waf] DOCUMENTED LIMITATION: a double-encoded payload is not decoded twice", async () => {
  const app = wafApp();
  // %253Cscript%253E decodes ONCE to %3Cscript%3E — not a literal <script>.
  // A signature WAF intentionally does not recursively decode (false-positive
  // risk); this is defense-in-depth, so the app must never double-decode input.
  const res = await app.request("/q?x=%253Cscript%253E%2553alert%2528%2529");
  assert.equal(res.status, 200, "double-encoded payloads pass the WAF — rely on schemas/escaping, not the WAF alone");
});
