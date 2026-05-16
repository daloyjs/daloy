import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  MemorySessionStore,
  session,
  signValue,
  verifySignedValue,
  type SessionContext,
  type SessionRecord,
  type SessionStore,
} from "../src/index.js";

const SECRET = "this-is-a-test-secret-32-bytes!!";

declare module "../src/index.js" {
  interface AppState {
    session: SessionContext;
  }
}

function makeApp(
  opts: Partial<Parameters<typeof session>[0]> = {},
  cookieName: string | undefined = "__Host-daloy.sid",
) {
  const app = new App({ logger: false });
  const store = opts.store ?? new MemorySessionStore();
  const merged: Parameters<typeof session>[0] = {
    secret: SECRET,
    store,
    saveUninitialized: true,
    ...opts,
    cookieName: cookieName ?? opts.cookieName,
  };
  app.use(session(merged));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: { id: state.session.id, name: state.session.get<string>("name") ?? null },
    }),
  });
  app.route({
    method: "POST",
    path: "/login",
    operationId: "login",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      state.session.set("name", "alice");
      return { status: 200 as const, body: { ok: true, id: state.session.id } };
    },
  });
  app.route({
    method: "POST",
    path: "/logout",
    operationId: "logout",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      state.session.destroy();
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "POST",
    path: "/rotate",
    operationId: "rotate",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      const next = await state.session.regenerate();
      return { status: 200 as const, body: { id: next } };
    },
  });
  app.route({
    method: "POST",
    path: "/rotate-fresh",
    operationId: "rotateFresh",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      state.session.set("scratch", "before");
      const next = await state.session.regenerate({ keepData: false });
      state.session.set("after", "yes");
      return {
        status: 200 as const,
        body: {
          id: next,
          before: state.session.get<string>("scratch") ?? null,
          after: state.session.get<string>("after"),
        },
      };
    },
  });
  app.route({
    method: "POST",
    path: "/touch-only",
    operationId: "touchOnly",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: { id: state.session.id },
    }),
  });
  app.route({
    method: "POST",
    path: "/mutate-via-data",
    operationId: "mutateViaData",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      state.session.data["counter"] = ((state.session.data["counter"] as number) ?? 0) + 1;
      return { status: 200 as const, body: { counter: state.session.data["counter"] } };
    },
  });
  app.route({
    method: "POST",
    path: "/delete-key",
    operationId: "deleteKey",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      state.session.delete("name");
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "POST",
    path: "/double-rotate",
    operationId: "doubleRotate",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      const a = await state.session.regenerate();
      const b = await state.session.regenerate();
      return { status: 200 as const, body: { a, b } };
    },
  });
  app.route({
    method: "POST",
    path: "/delete-via-proxy",
    operationId: "deleteViaProxy",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => {
      delete state.session.data["nope"];
      delete state.session.data["name"];
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return { app, store };
}

function readCookie(res: Response, name = "__Host-daloy.sid"): string | null {
  const sc = res.headers.get("set-cookie");
  if (!sc) return null;
  const m = sc.match(new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

test("session issues a fresh signed cookie on first request", async () => {
  const { app } = makeApp();
  const res = await app.request("/me");
  assert.equal(res.status, 200);
  const sc = res.headers.get("set-cookie");
  assert.ok(sc, "expected set-cookie");
  assert.match(sc!, /^__Host-daloy\.sid=[A-Za-z0-9_\-%.]+\.[A-Za-z0-9_\-%]+; Path=\/; SameSite=Lax; Secure; HttpOnly$/);
  const body = (await res.json()) as { id: string; name: null };
  assert.equal(body.name, null);
  assert.ok(body.id.length > 0);
});

test("session persists data across requests via cookie", async () => {
  const { app } = makeApp();
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/me", { headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` } });
  const body = (await r2.json()) as { id: string; name: string };
  assert.equal(body.name, "alice");
});

test("session ignores cookies with bad signatures", async () => {
  const { app } = makeApp();
  const res = await app.request("/me", {
    headers: { cookie: "__Host-daloy.sid=spoofed.deadbeef" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; name: null };
  assert.equal(body.name, null);
  // A new cookie was issued — different id from the spoofed one.
  assert.notEqual(body.id, "spoofed");
});

test("session ignores cookies that lack a signature delimiter", async () => {
  const { app } = makeApp();
  const res = await app.request("/me", {
    headers: { cookie: "__Host-daloy.sid=no-dot-here" },
  });
  assert.equal(res.status, 200);
  // Issued a fresh cookie because the input was malformed.
  assert.ok(res.headers.get("set-cookie"));
});

test("session ignores cookies whose dot is at the boundary", async () => {
  const { app } = makeApp();
  const res = await app.request("/me", {
    headers: { cookie: "__Host-daloy.sid=." },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("set-cookie"));
});

test("session destroy() clears the cookie and store record", async () => {
  const { app, store } = makeApp();
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  assert.equal((store as MemorySessionStore).size(), 1);

  const r2 = await app.request("/logout", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  const sc = r2.headers.get("set-cookie")!;
  assert.match(sc, /Max-Age=0/);
  assert.equal((store as MemorySessionStore).size(), 0);
});

test("session destroy() clears malformed client cookies", async () => {
  const { app } = makeApp();
  const res = await app.request("/logout", {
    method: "POST",
    headers: { cookie: "__Host-daloy.sid=spoofed.deadbeef" },
  });
  const sc = res.headers.get("set-cookie")!;
  assert.match(sc, /^__Host-daloy\.sid=; Path=\/; SameSite=Lax; Secure; HttpOnly; Max-Age=0$/);
});

test("session clones store records before request mutation", async () => {
  const record: SessionRecord = { data: { name: "alice" }, expiresAt: Date.now() + 60_000 };
  const sid = "stable";
  const store: SessionStore = {
    get: () => record,
    set: () => {},
    destroy: () => {},
  };
  const { app } = makeApp({ store });
  const sig = await getSig(sid, SECRET);

  const res = await app.request("/login", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(`${sid}.${sig}`)}` },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(record.data, { name: "alice" });
});

test("session regenerate() rotates the id and keeps data", async () => {
  const { app, store } = makeApp();
  const r1 = await app.request("/login", { method: "POST" });
  const cookie1 = readCookie(r1)!;
  const id1 = cookie1.slice(0, cookie1.lastIndexOf("."));

  const r2 = await app.request("/rotate", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie1)}` },
  });
  const cookie2 = readCookie(r2)!;
  const id2 = cookie2.slice(0, cookie2.lastIndexOf("."));
  assert.notEqual(id1, id2);

  const r3 = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie2)}` },
  });
  const body = (await r3.json()) as { name: string };
  assert.equal(body.name, "alice");

  // Old session id is gone from the store.
  assert.equal(await store.get(id1), null);
});

test("session regenerate({ keepData: false }) starts fresh", async () => {
  const { app } = makeApp();
  const res = await app.request("/rotate-fresh", { method: "POST" });
  const body = (await res.json()) as { id: string; before: string | null; after: string };
  assert.equal(body.before, null);
  assert.equal(body.after, "yes");
});

test("session double regenerate() returns distinct ids", async () => {
  const { app } = makeApp();
  const r = await app.request("/double-rotate", { method: "POST" });
  const body = (await r.json()) as { a: string; b: string };
  assert.notEqual(body.a, body.b);
});

test("session writes via Proxy on data are persisted", async () => {
  const { app } = makeApp();
  const r1 = await app.request("/mutate-via-data", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/mutate-via-data", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  const body = (await r2.json()) as { counter: number };
  assert.equal(body.counter, 2);
});

test("session deletes via Proxy mark dirty for missing keys without writing", async () => {
  const { app } = makeApp();
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/delete-via-proxy", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  assert.equal(r2.status, 200);
  const r3 = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  const body = (await r3.json()) as { name: string | null };
  assert.equal(body.name, null);
});

test("session.delete() is a no-op when key is absent", async () => {
  const { app } = makeApp();
  const r1 = await app.request("/me");
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/delete-key", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  assert.equal(r2.status, 200);
});

test("session rolling default refreshes Set-Cookie + touch on each access", async () => {
  let touched = 0;
  const inner = new MemorySessionStore();
  const store: SessionStore = {
    get: (sid) => inner.get(sid),
    set: (sid, rec) => inner.set(sid, rec),
    destroy: (sid) => inner.destroy(sid),
    touch: (sid, exp) => {
      touched += 1;
      inner.touch(sid, exp);
    },
  };
  const { app } = makeApp({ store });
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/touch-only", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  assert.ok(r2.headers.get("set-cookie"), "rolling sessions refresh the cookie");
  assert.equal(touched, 1);
});

test("session rolling: when store has no touch(), falls back to set()", async () => {
  let sets = 0;
  const inner = new MemorySessionStore();
  const store: SessionStore = {
    get: (sid) => inner.get(sid),
    set: (sid, rec) => {
      sets += 1;
      inner.set(sid, rec);
    },
    destroy: (sid) => inner.destroy(sid),
  };
  const { app } = makeApp({ store });
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  sets = 0;
  await app.request("/touch-only", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  assert.equal(sets, 1);
});

test("session rolling: false skips refresh on unmodified requests", async () => {
  const inner = new MemorySessionStore();
  const { app } = makeApp({ store: inner, rolling: false });
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/touch-only", {
    method: "POST",
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  assert.equal(r2.headers.get("set-cookie"), null);
});

test("session honors secret rotation: old cookies still verify", async () => {
  const oldSecret = SECRET;
  const newSecret = "another-test-secret-32-bytes-xyz";

  // Sign a cookie with the OLD secret only.
  const oldOnly = makeApp({ secret: oldSecret });
  const r1 = await oldOnly.app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;

  // New deployment ships [new, old] — old cookie still works, gets re-signed
  // with the NEW secret on the response.
  const rotated = makeApp({ secret: [newSecret, oldSecret], store: oldOnly.store });
  const r2 = await rotated.app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  const body = (await r2.json()) as { name: string };
  assert.equal(body.name, "alice");
});

test("session rejects expired records", async () => {
  const inner = new MemorySessionStore();
  inner.set("dead", { data: { name: "ghost" }, expiresAt: Date.now() - 1 });
  const { app } = makeApp({ store: inner, saveUninitialized: false });
  const sid = "dead";
  const sig = await getSig(sid, SECRET);
  const res = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(`${sid}.${sig}`)}` },
  });
  const body = (await res.json()) as { name: null };
  assert.equal(body.name, null);
  // Expired record dropped on access; nothing else persisted because session was untouched.
  assert.equal(inner.size(), 0);
});

test("session: custom store returning an expired record is treated as no session", async () => {
  // A store that doesn't filter expired records itself.
  const store: SessionStore = {
    get: () => ({ data: { name: "stale" }, expiresAt: Date.now() - 1000 }),
    set: () => {},
    destroy: () => {},
  };
  const { app } = makeApp({ store, saveUninitialized: false });
  const sid = "alive";
  const sig = await getSig(sid, SECRET);
  const res = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(`${sid}.${sig}`)}` },
  });
  const body = (await res.json()) as { id: string; name: null };
  assert.equal(body.name, null);
  assert.notEqual(body.id, "alive");
});

test("session: stored record with missing data field is replaced with empty object", async () => {
  const store: SessionStore = {
    get: () => ({ data: null as unknown as Record<string, unknown>, expiresAt: Date.now() + 60_000 }),
    set: () => {},
    destroy: () => {},
  };
  const { app } = makeApp({ store });
  const sid = "alive";
  const sig = await getSig(sid, SECRET);
  const res = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(`${sid}.${sig}`)}` },
  });
  const body = (await res.json()) as { id: string; name: null };
  assert.equal(body.id, "alive");
  assert.equal(body.name, null);
});

test("session: malformed cookie value (decodeURIComponent throws) still treated as raw", async () => {
  const { app } = makeApp();
  // %E0%A4%A is an invalid percent-encoding -> decodeURIComponent throws.
  const res = await app.request("/me", {
    headers: { cookie: "__Host-daloy.sid=%E0%A4%A" },
  });
  assert.equal(res.status, 200);
  // Still issued a fresh cookie.
  assert.ok(res.headers.get("set-cookie"));
});

test("session validates options at construction time", () => {
  assert.throws(() => session({ secret: "" }), /at least 16 characters/);
  assert.throws(() => session({ secret: SECRET, ttlSeconds: 0 }), /ttlSeconds/);
  assert.throws(() => session({ secret: SECRET, ttlSeconds: 1.5 }), /ttlSeconds/);
  assert.throws(
    () => session({ secret: SECRET, cookieName: "bad name" }),
    /not a valid cookie name/,
  );
  assert.throws(
    () => session({ secret: SECRET, cookieOptions: { sameSite: "Bogus" as "Lax" } }),
    /sameSite must be/,
  );
  assert.throws(
    () => session({ secret: SECRET, cookieOptions: { path: "no-slash" } }),
    /path must start/,
  );
  assert.throws(
    () =>
      session({
        secret: SECRET,
        cookieName: "non-host",
        cookieOptions: { path: "/api;injected" },
      }),
    /path contains an invalid character/,
  );
  assert.throws(
    () =>
      session({
        secret: SECRET,
        cookieName: "non-host",
        cookieOptions: { domain: "evil\nexample.com" },
      }),
    /domain contains an invalid character/,
  );
  assert.throws(
    () => session({ secret: SECRET, cookieOptions: { maxAgeSeconds: -1 } }),
    /maxAgeSeconds must be/,
  );
  assert.throws(
    () =>
      session({
        secret: SECRET,
        cookieName: "non-host",
        cookieOptions: { sameSite: "None", secure: false },
      }),
    /sameSite: "None" requires secure/,
  );
  assert.throws(
    () =>
      session({
        secret: SECRET,
        cookieOptions: { secure: false },
      }),
    /__Host-/,
  );
  // Empty secret array.
  assert.throws(
    () => session({ secret: [] as unknown as string[] }),
    /at least one secret|at least 16/,
  );
});

test("session non-host cookie with domain + Max-Age + Partitioned + SameSite=None emits attributes", async () => {
  const inner = new MemorySessionStore();
  const app = new App({ logger: false });
  app.use(
    session({
      secret: SECRET,
      cookieName: "daloy.sid",
      store: inner,
      saveUninitialized: true,
      cookieOptions: {
        sameSite: "None",
        secure: true,
        path: "/api",
        domain: "example.com",
        maxAgeSeconds: 3600,
        partitioned: true,
        httpOnly: false,
      },
    }),
  );
  app.route({
    method: "POST",
    path: "/touch",
    operationId: "touch",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/touch", { method: "POST" });
  const sc = res.headers.get("set-cookie")!;
  assert.match(sc, /Path=\/api/);
  assert.match(sc, /SameSite=None/);
  assert.match(sc, /Secure/);
  assert.match(sc, /Domain=example\.com/);
  assert.match(sc, /Max-Age=3600/);
  assert.match(sc, /Partitioned/);
  assert.doesNotMatch(sc, /HttpOnly/);
});

test("session uses a custom generator", async () => {
  let n = 0;
  const ids = ["custom-1", "custom-2"];
  const { app } = makeApp({ generator: () => ids[n++]! });
  const r1 = await app.request("/me");
  const cookie = readCookie(r1)!;
  assert.ok(cookie.startsWith("custom-1."));
});

test("session generator that returns an empty id throws at use time", async () => {
  const { app } = makeApp({ generator: () => "" });
  const res = await app.request("/me");
  // Falls into the global error path; problem+json response.
  assert.equal(res.status, 500);
});

test("session generator that returns empty during regenerate also throws", async () => {
  let calls = 0;
  const { app } = makeApp({
    generator: () => {
      calls += 1;
      return calls === 1 ? "first" : "";
    },
  });
  const res = await app.request("/rotate", { method: "POST" });
  assert.equal(res.status, 500);
});

test("MemorySessionStore: clear/size/destroy/touch helpers", () => {
  const s = new MemorySessionStore();
  assert.equal(s.size(), 0);
  s.set("a", { data: { x: 1 }, expiresAt: Date.now() + 1000 });
  assert.equal(s.size(), 1);
  s.touch("a", Date.now() + 5_000);
  s.touch("missing", Date.now() + 5_000); // no-op
  assert.ok(s.get("a"));
  s.destroy("a");
  assert.equal(s.size(), 0);
  s.set("b", { data: {}, expiresAt: Date.now() + 1000 });
  s.clear();
  assert.equal(s.size(), 0);
});

test("MemorySessionStore.get returns null for missing", () => {
  const s = new MemorySessionStore();
  assert.equal(s.get("nope"), null);
});

test("signValue() + verifySignedValue() round-trip", async () => {
  const signed = await signValue("user-42", SECRET);
  assert.match(signed, /^user-42\.[A-Za-z0-9_-]+$/);
  const v = await verifySignedValue(signed, SECRET);
  assert.equal(v, "user-42");
});

test("signValue() rejects values containing '.'", async () => {
  await assert.rejects(() => signValue("user.42", SECRET), /must not contain/);
});

test("verifySignedValue() returns null on tamper or malformed input", async () => {
  const signed = await signValue("user-42", SECRET);
  const tampered = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
  assert.equal(await verifySignedValue(tampered, SECRET), null);
  assert.equal(await verifySignedValue("no-dot", SECRET), null);
  assert.equal(await verifySignedValue(".", SECRET), null);
  assert.equal(await verifySignedValue("trailing.", SECRET), null);
});

test("verifySignedValue() honors secret arrays for rotation", async () => {
  const oldSecret = SECRET;
  const newSecret = "another-test-secret-32-bytes-xyz";
  const oldSigned = await signValue("user-42", oldSecret);
  assert.equal(await verifySignedValue(oldSigned, [newSecret, oldSecret]), "user-42");
  assert.equal(await verifySignedValue(oldSigned, [newSecret]), null);
});

test("session: store async get returning a value works", async () => {
  const inner = new MemorySessionStore();
  const asyncStore: SessionStore = {
    get: async (sid) => inner.get(sid),
    set: async (sid, rec) => inner.set(sid, rec),
    destroy: async (sid) => inner.destroy(sid),
  };
  const { app } = makeApp({ store: asyncStore });
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  const r2 = await app.request("/me", {
    headers: { cookie: `__Host-daloy.sid=${encodeURIComponent(cookie)}` },
  });
  const body = (await r2.json()) as { name: string };
  assert.equal(body.name, "alice");
});


test("session: requests without a session cookie at all skip lookup", async () => {
  const { app } = makeApp();
  const res = await app.request("/me");
  assert.equal(res.status, 200);
});

test("session: cookie header with malformed segments is parsed safely", async () => {
  const { app } = makeApp();
  const r1 = await app.request("/login", { method: "POST" });
  const cookie = readCookie(r1)!;
  // First segment lacks `=`, second segment is unrelated, third is the session.
  const malformed = `flag; other=val; __Host-daloy.sid=${encodeURIComponent(cookie)}`;
  const r2 = await app.request("/me", { headers: { cookie: malformed } });
  const body = (await r2.json()) as { name: string };
  assert.equal(body.name, "alice");
});

test("session default saveUninitialized=false: untouched session writes no cookie", async () => {
  const inner = new MemorySessionStore();
  const app = new App({ logger: false });
  app.use(session({ secret: SECRET, store: inner }));
  app.route({
    method: "GET",
    path: "/x",
    operationId: "xx",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: {} }),
  });
  const res = await app.request("/x");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(inner.size(), 0);
});

test("session: subtle missing throws a descriptive error", async () => {
  // Importing session.ts again under a sandbox where crypto.subtle is gone
  // would require module isolation; instead, exercise getSubtle indirectly by
  // checking that a freshly constructed signer throws when subtle is absent.
  const original = (globalThis as { crypto?: Crypto }).crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: original?.getRandomValues?.bind(original) },
  });
  try {
    await assert.rejects(() => signValue("x", SECRET), /Web Crypto/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: original });
  }
});

test("session: missing getRandomValues throws on default id generator", async () => {
  const original = (globalThis as { crypto?: Crypto }).crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { subtle: original?.subtle },
  });
  try {
    const app = new App({ logger: false });
    app.use(session({ secret: SECRET }));
    app.route({
      method: "GET",
      path: "/x",
      operationId: "x",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: {} }),
    });
    const res = await app.request("/x");
    assert.equal(res.status, 500);
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: original });
  }
});

// ---------- helpers ----------

async function getSig(value: string, secret: string): Promise<string> {
  const signed = await signValue(value, secret);
  return signed.slice(signed.lastIndexOf(".") + 1);
}

// Touch unused type imports so the test file references them.
const _typesProbe: SessionRecord | null = null;
void _typesProbe;
