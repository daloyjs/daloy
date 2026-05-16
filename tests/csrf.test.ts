import { test } from "node:test";
import assert from "node:assert/strict";
import { App, csrf } from "../src/index.js";

function makeApp(opts?: Parameters<typeof csrf>[0]) {
  const app = new App({ logger: false });
  app.use(csrf(opts));
  app.route({
    method: "GET",
    path: "/form",
    operationId: "form",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({ status: 200 as const, body: { token: state.csrfToken } }),
  });
  app.route({
    method: "POST",
    path: "/submit",
    operationId: "submit",
    responses: { 200: { description: "ok" }, 403: { description: "forbidden" } },
    handler: async ({ state }) => ({ status: 200 as const, body: { token: state.csrfToken } }),
  });
  return app;
}

test("csrf issues a Set-Cookie on safe methods when no cookie is present", async () => {
  const app = makeApp();
  const res = await app.request("/form");
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "expected Set-Cookie");
  assert.match(setCookie!, /^__Host-daloy\.csrf=[A-Za-z0-9_-]+; Path=\/; SameSite=Lax; Secure$/);
  const body = (await res.json()) as { token: string };
  // The body token must equal what was set in the cookie.
  const cookieValue = setCookie!.split(";")[0]!.split("=")[1]!;
  assert.equal(body.token, cookieValue);
});

test("csrf does not reissue when a cookie is already present on safe methods", async () => {
  const app = makeApp();
  const res = await app.request("/form", {
    headers: { cookie: "__Host-daloy.csrf=existing-token" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
  const body = (await res.json()) as { token: string };
  assert.equal(body.token, "existing-token");
});

test("csrf rejects unsafe methods without a cookie or header", async () => {
  const app = makeApp();
  const res = await app.request("/submit", { method: "POST" });
  assert.equal(res.status, 403);
});

test("csrf rejects unsafe methods when header is missing", async () => {
  const app = makeApp();
  const res = await app.request("/submit", {
    method: "POST",
    headers: { cookie: "__Host-daloy.csrf=tok-abc" },
  });
  assert.equal(res.status, 403);
});

test("csrf rejects unsafe methods when header does not match cookie", async () => {
  const app = makeApp();
  const res = await app.request("/submit", {
    method: "POST",
    headers: { cookie: "__Host-daloy.csrf=tok-abc", "x-csrf-token": "tok-xyz" },
  });
  assert.equal(res.status, 403);
});

test("csrf accepts unsafe methods when header matches cookie", async () => {
  const app = makeApp();
  const res = await app.request("/submit", {
    method: "POST",
    headers: { cookie: "__Host-daloy.csrf=tok-abc", "x-csrf-token": "tok-abc" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  assert.equal(body.token, "tok-abc");
});

test("csrf supports a custom header name and ignoreMethods", async () => {
  const app = new App({ logger: false });
  app.use(
    csrf({
      headerName: "X-XSRF-TOKEN",
      ignoreMethods: ["GET"],
    }),
  );
  app.route({
    method: "PUT",
    path: "/items",
    operationId: "items",
    responses: { 204: { description: "ok" }, 403: { description: "no" } },
    handler: async () => ({ status: 204 as const, body: undefined }),
  });

  // PUT without correct headers fails (PUT isn't ignored).
  const denied = await app.request("/items", { method: "PUT" });
  assert.equal(denied.status, 403);

  const ok = await app.request("/items", {
    method: "PUT",
    headers: { cookie: "__Host-daloy.csrf=t1", "x-xsrf-token": "t1" },
  });
  assert.equal(ok.status, 204);
});

test("csrf decodes URL-encoded cookie values and skips malformed segments", async () => {
  const app = makeApp();
  // First segment without `=` exercises the skip branch; the trailing
  // garbage `%E0%A4%A` is invalid percent-encoding and falls back to raw.
  const res = await app.request("/form", {
    headers: { cookie: "flag; __Host-daloy.csrf=raw%E0%A4%A" },
  });
  const body = (await res.json()) as { token: string };
  assert.equal(body.token, "raw%E0%A4%A");

  // Decoded path: %20 -> space.
  const res2 = await app.request("/form", {
    headers: { cookie: "__Host-daloy.csrf=hello%20world" },
  });
  const body2 = (await res2.json()) as { token: string };
  assert.equal(body2.token, "hello world");
});

test("csrf supports a custom token generator and a non-prefixed cookie name", async () => {
  let n = 0;
  const app = new App({ logger: false });
  app.use(
    csrf({
      cookieName: "csrf",
      generator: () => `gen-${++n}`,
      cookieOptions: {
        sameSite: "Strict",
        secure: false,
        path: "/api",
        domain: "example.com",
        maxAgeSeconds: 3600,
        partitioned: true,
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/anything",
    operationId: "anything",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/anything");
  const setCookie = res.headers.get("set-cookie")!;
  assert.equal(
    setCookie,
    "csrf=gen-1; Path=/api; SameSite=Strict; Domain=example.com; Max-Age=3600; Partitioned",
  );
});

test("csrf percent-encodes generated cookie values", async () => {
  const app = new App({ logger: false });
  app.use(csrf({ cookieName: "csrf", generator: () => "hello world", cookieOptions: { secure: false } }));
  app.route({
    method: "GET",
    path: "/anything",
    operationId: "encodedAnything",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/anything");
  assert.equal(res.headers.get("set-cookie"), "csrf=hello%20world; Path=/; SameSite=Lax");
});

test("csrf throws when __Host- cookie name is misconfigured", () => {
  assert.throws(() => csrf({ cookieOptions: { secure: false } }), /__Host-/);
  assert.throws(() => csrf({ cookieOptions: { path: "/api" } }), /__Host-/);
  assert.throws(() => csrf({ cookieOptions: { domain: "example.com" } }), /__Host-/);
});

test("csrf throws when SameSite=None is used without Secure", () => {
  assert.throws(
    () => csrf({ cookieName: "csrf", cookieOptions: { sameSite: "None", secure: false } }),
    /sameSite: "None" requires secure: true/,
  );
});

test("csrf validates cookie and header options up front", () => {
  assert.throws(() => csrf({ cookieName: "bad;name" }), /cookieName/);
  assert.throws(() => csrf({ headerName: "bad header" }), /Bad Request/);
  assert.throws(
    () => csrf({ cookieName: "csrf", cookieOptions: { sameSite: "Loose" as "Lax" } }),
    /sameSite must be/,
  );
  assert.throws(() => csrf({ cookieName: "csrf", cookieOptions: { path: "api" } }), /path must start/);
  assert.throws(() => csrf({ cookieName: "csrf", cookieOptions: { path: "/api;v=1" } }), /path contains/);
  assert.throws(() => csrf({ cookieName: "csrf", cookieOptions: { domain: "example.com\r\n" } }), /domain contains/);
  assert.throws(() => csrf({ cookieName: "csrf", cookieOptions: { maxAgeSeconds: -1 } }), /maxAgeSeconds/);
  assert.throws(() => csrf({ cookieName: "csrf", cookieOptions: { maxAgeSeconds: 1.5 } }), /maxAgeSeconds/);
});

test("csrf rejects an empty generated token", async () => {
  const app = makeApp({ generator: () => "" });
  const res = await app.request("/form");
  assert.equal(res.status, 500);
});

test("csrf onSend is a no-op when ctx is undefined", async () => {
  // Force the error path before a context exists by sending a malformed URL,
  // which triggers `onError` with no `ctx`. The csrf onSend hook still runs
  // and must not throw.
  const app = new App({ logger: false });
  app.use(csrf());
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  // Direct hook invocation is the cleanest way to assert the undefined-ctx
  // branch deterministically.
  const hooks = csrf();
  const res = new Response(null, { status: 200 });
  const out = hooks.onSend!(res, undefined);
  assert.equal(out, undefined);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("csrf can use crypto.randomUUID when getRandomValues is unavailable", async () => {
  const realCrypto = (globalThis as any).crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => "00000000-1111-2222-3333-444444444444" },
    configurable: true,
  });
  try {
    const app = makeApp();
    const res = await app.request("/form");
    assert.match(res.headers.get("set-cookie")!, /^__Host-daloy\.csrf=00000000111122223333444444444444;/);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
    });
  }
});

test("csrf fails closed when no secure random source is available", async () => {
  const realCrypto = (globalThis as any).crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
  });
  try {
    const app = makeApp();
    const res = await app.request("/form");
    assert.equal(res.status, 500);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
    });
  }
});
