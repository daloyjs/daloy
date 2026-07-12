import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, bearerAuth, cors, requestId, secureHeaders, sseResponse } from "../src/index.js";

// A handler may return a raw web-standard `Response` only through the explicit
// acknowledgement escape hatch used for streaming / proxying / pre-built
// bodies. These tests pin fail-closed behavior and prove acknowledged raw
// responses still pass through every deployment-time security control.

test("a raw Response without an explicit acknowledgement fails closed", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/unacknowledged",
    operationId: "unacknowledgedRawResponse",
    responses: {
      200: { description: "safe", body: z.object({ public: z.string() }) },
    },
    handler: () => Response.json({ public: "ok", private: "must-never-leak" }),
  });

  const res = await app.request("/unacknowledged");
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /must-never-leak/);
});

test("a successful preBody Response without acknowledgement fails closed", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/pre-body-success",
    operationId: "unacknowledgedPreBodyResponse",
    responses: {
      200: { description: "safe", body: z.object({ public: z.string() }) },
    },
    hooks: {
      preBody: () => Response.json({ public: "ok", private: "must-never-leak" }),
    },
    handler: () => ({ status: 200, body: { public: "fallback" } }),
  });

  const res = await app.request("/pre-body-success");
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /must-never-leak/);
});

test("a successful beforeHandle redirect requires acknowledgement", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/before-redirect",
    operationId: "unacknowledgedBeforeHandleRedirect",
    responses: { 302: { description: "redirect" } },
    hooks: {
      beforeHandle: () =>
        new Response(null, { status: 302, headers: { location: "/private-target" } }),
    },
    handler: () => ({ status: 302, body: undefined }),
  });

  const res = await app.request("/before-redirect");
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("location"), null);
});

test("hook denials remain secure by default without an acknowledgement", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/denied",
    operationId: "defaultHookDenial",
    responses: { 200: { description: "ok" }, 401: { description: "denied" } },
    hooks: {
      preBody: () => new Response("denied", { status: 401 }),
    },
    handler: () => ({ status: 200, body: { ok: true } }),
  });

  const res = await app.request("/denied");
  assert.equal(res.status, 401);
  assert.equal(await res.text(), "denied");
});

test("acknowledged successful preBody Responses preserve normal finalization", async () => {
  const app = new App({ logger: false });
  app.use(secureHeaders());
  app.route({
    method: "GET",
    path: "/acknowledged-pre-body",
    operationId: "acknowledgedPreBodyResponse",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "opaque" } },
    hooks: {
      preBody: () => new Response("opaque", { status: 200 }),
    },
    handler: () => ({ status: 200, body: undefined }),
  });

  const res = await app.request("/acknowledged-pre-body");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "opaque");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("a handler can return a raw Response (status, headers, body preserved)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawResponse",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json", "x-custom": "yes" },
      }),
  });

  const res = await app.request("/raw");
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("x-custom"), "yes");
  // The request id is added by default even on a raw Response.
  assert.ok((res.headers.get("x-request-id") ?? "").length > 0);
  assert.deepEqual(await res.json(), { ok: true });
});

test("a streaming Response from a handler passes through (AI SDK shape)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/stream",
    operationId: "streamResponse",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "stream" } },
    // sseResponse() returns a web-standard Response with a ReadableStream
    // body, mirroring an AI SDK result.toUIMessageStreamResponse().
    handler: () =>
      sseResponse(async function* () {
        yield { event: "tick", data: 1 };
        yield { event: "tick", data: 2 };
      }),
  });

  const res = await app.request("/stream");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const body = await res.text();
  assert.match(body, /data: 1\n\n/);
  assert.match(body, /data: 2\n\n/);
});

test("secureHeaders still apply to a handler-returned Response", async () => {
  const app = new App({ logger: false });
  app.use(secureHeaders());
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawSecure",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () => new Response("hi", { status: 200 }),
  });

  const res = await app.request("/raw");
  assert.equal(res.status, 200);
  // The deployment-time guardrail is NOT skipped just because the handler
  // returned a raw Response. This is the security invariant.
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("an onSend hook can observe a handler-returned Response", async () => {
  const app = new App({ logger: false });
  app.use({
    onSend: (res: Response) => {
      res.headers.set("x-seen-by-onsend", "1");
      return undefined;
    },
  });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawOnSend",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () => new Response("hi", { status: 200 }),
  });

  const res = await app.request("/raw");
  assert.equal(res.headers.get("x-seen-by-onsend"), "1");
});

test("server-fingerprint headers are stripped from a handler-returned Response", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawStrip",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () =>
      new Response("hi", {
        status: 200,
        headers: { server: "secretd/1.2", "x-powered-by": "leak" },
      }),
  });

  const res = await app.request("/raw");
  assert.equal(res.headers.get("server"), null);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("a user-set x-request-id on the Response is preserved", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawReqId",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () =>
      new Response("hi", {
        status: 200,
        headers: { "x-request-id": "mine-123" },
      }),
  });

  const res = await app.request("/raw");
  assert.equal(res.headers.get("x-request-id"), "mine-123");
});

test("HEAD on a raw-Response GET route yields an empty body with headers intact", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawHead",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "raw" } },
    handler: () =>
      new Response("a body that HEAD must not return", {
        status: 200,
        headers: { "content-type": "text/plain", "x-marker": "kept" },
      }),
  });

  const res = await app.request("/raw", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("x-marker"), "kept");
});

test("a raw Response bypasses response-schema validation (documented escape hatch)", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "rawNoValidate",
    acknowledgeNoResponseBodySchema: true,
    // The schema says { n: number }, but a raw Response is opaque: there is no
    // schema that can describe an arbitrary stream, so validation is skipped
    // by design. Structured `{ status, body }` results are still validated
    // (covered in response-body-schema-audit.test.ts).
    responses: {
      200: { description: "ok", body: z.object({ n: z.number() }) as never },
    },
    handler: () =>
      new Response("not json at all", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  });

  const res = await app.request("/raw");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "not json at all");
});

test("SECURITY PARITY: a raw-Response route gets the identical guardrails as a structured route", async () => {
  // Full deployment-time stack: auth (beforeHandle), CORS, secureHeaders,
  // requestId. We then prove a raw-Response route is treated identically to a
  // structured one, so the change skips NO built-in security control.
  const build = () => {
    const app = new App({ logger: false });
    app.use(bearerAuth({ validate: (t) => t === "good" }));
    app.use(cors({ origin: "https://app.example", credentials: true }));
    app.use(secureHeaders());
    app.use(requestId());
    app.route({
      method: "GET",
      path: "/structured",
      operationId: "parityStructured",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    });
    app.route({
      method: "GET",
      path: "/raw",
      operationId: "parityRaw",
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: { description: "ok" } },
      handler: () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    return app;
  };

  const app = build();
  const origin = "https://app.example";

  // 1) Pre-handler auth STILL guards the raw-Response route: no token -> 401.
  //    (Proves beforeHandle runs before the handler regardless of return type.)
  const noAuth = await app.request("/raw", { headers: { origin } });
  assert.equal(noAuth.status, 401);

  // 2) Authenticated requests: the raw route must carry every header the
  //    fully-guarded structured route carries (secureHeaders + CORS + ...),
  //    modulo per-request / body-dependent headers.
  const headers = { authorization: "Bearer good", origin };
  const s = await app.request("/structured", { headers });
  const r = await app.request("/raw", { headers });
  assert.equal(s.status, 200);
  assert.equal(r.status, 200);

  const bodyOrPerRequest = new Set(["content-length", "date", "x-request-id"]);
  for (const [key, value] of s.headers) {
    if (bodyOrPerRequest.has(key)) continue;
    assert.equal(
      r.headers.get(key),
      value,
      `raw-Response route must apply the same '${key}' as the structured route`
    );
  }

  // 3) Deployment-time invariants on the raw route specifically.
  assert.ok((r.headers.get("x-request-id") ?? "").length > 0, "request id present");
  assert.equal(r.headers.get("server"), null, "fingerprint stripped");
  assert.equal(r.headers.get("x-powered-by"), null, "fingerprint stripped");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff", "secureHeaders applied");
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    origin,
    "CORS applied to the raw route"
  );
});
