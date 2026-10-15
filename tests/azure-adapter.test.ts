import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import {
  toAzureHandler,
  type AzureHttpRequestLike,
} from "../src/adapters/azure.js";
import { getConnInfo } from "../src/conn-info.js";

// A real web `Request` is structurally an Azure v4 `HttpRequest` for the
// members the adapter reads (method, url, headers, body), so tests drive the
// handler with one instead of pulling in `@azure/functions`.
function azureRequest(url: string, init?: RequestInit): AzureHttpRequestLike {
  return new Request(url, init);
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function echoApp(options: ConstructorParameters<typeof App>[0] = {}): App {
  const app = new App({ logger: false, ...options });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "azureEcho",
    request: { body: z.object({ hello: z.string() }) },
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => ({
      status: 200 as const,
      body: {
        hello: ctx.body.hello,
        q: new URL(ctx.request.url).searchParams.get("q"),
        custom: ctx.request.headers.get("x-custom"),
        cookie: ctx.request.headers.get("cookie"),
        peer: getConnInfo(ctx.request)?.remoteAddress ?? null,
      },
    }),
  });
  return app;
}

test("azure adapter converts an HttpRequest to a Request and buffers the response body", async () => {
  const handler = toAzureHandler(echoApp());
  const res = await handler(
    azureRequest("https://fn.azurewebsites.net/echo?q=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom": "yes",
        cookie: "a=1; b=2",
      },
      body: JSON.stringify({ hello: "azure" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] ?? "", /application\/json/);
  assert.equal(res.cookies, undefined);
  assert.ok(
    res.body instanceof ArrayBuffer,
    "buffered mode returns an ArrayBuffer",
  );
  const json = JSON.parse(new TextDecoder().decode(res.body as ArrayBuffer));
  assert.deepEqual(json, {
    hello: "azure",
    q: "1",
    custom: "yes",
    cookie: "a=1; b=2",
    // Azure exposes no TCP peer; the adapter never invents one from headers.
    peer: null,
  });
});

test("azure adapter streams the response body when stream: true", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "azureStreamOk",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await toAzureHandler(app, { stream: true })(
    azureRequest("https://fn.azurewebsites.net/ok"),
  );
  assert.equal(res.status, 200);
  assert.ok(
    res.body instanceof ReadableStream,
    "stream mode returns a ReadableStream",
  );
  assert.deepEqual(await new Response(res.body).json(), { ok: true });
});

test("azure adapter maps every Set-Cookie onto the cookies channel", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/login",
    operationId: "azureCookies",
    responses: { 204: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () => {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "sid=abc; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600; Partitioned",
      );
      headers.append(
        "set-cookie",
        "theme=dark; Domain=example.com; Expires=Wed, 21 Oct 2037 07:28:00 GMT; SameSite=lax",
      );
      headers.append(
        "set-cookie",
        "flag=1; SameSite=bogus; Max-Age=soon; Expires=never",
      );
      // Malformed entries (no name=value pair) are omitted, not forwarded.
      headers.append("set-cookie", "no-equals-sign; Path=/");
      headers.append("set-cookie", "=anonymous");
      return new Response(null, { status: 204, headers });
    },
  });
  const res = await toAzureHandler(app)(
    azureRequest("https://fn.azurewebsites.net/login"),
  );
  assert.equal(res.status, 204);
  assert.equal(
    res.headers["set-cookie"],
    undefined,
    "Set-Cookie never rides the single-value header map",
  );
  assert.equal(res.body, undefined);
  assert.deepEqual(res.cookies, [
    {
      name: "sid",
      value: "abc",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 3600,
    },
    {
      name: "theme",
      value: "dark",
      domain: "example.com",
      expires: new Date("Wed, 21 Oct 2037 07:28:00 GMT"),
      sameSite: "Lax",
    },
    { name: "flag", value: "1" },
  ]);
});

test("azure adapter keeps SameSite=None and ignores a GET body", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/embed",
    operationId: "azureSameSiteNone",
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: async () =>
      new Response("ok", {
        status: 200,
        headers: {
          "set-cookie": "embed=1; SameSite=None; Secure",
          "content-type": "text/plain",
        },
      }),
  });
  // A GET whose host object still carries a body stream: the adapter must not
  // forward it (a web Request refuses a GET body).
  const getWithBody: AzureHttpRequestLike = {
    method: "get",
    url: "https://fn.azurewebsites.net/embed",
    headers: new Headers(),
    body: streamOf("ignored"),
  };
  const res = await toAzureHandler(app)(getWithBody);
  assert.equal(res.status, 200);
  assert.deepEqual(res.cookies, [
    { name: "embed", value: "1", sameSite: "None", secure: true },
  ]);
});

test("azure adapter answers an unparseable request URL with 400 problem+json", async () => {
  const handler = toAzureHandler(echoApp());
  const res = await handler({
    method: "GET",
    url: "not a url",
    headers: new Headers(),
    body: null,
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers["content-type"], "application/problem+json");
  const problem = JSON.parse(new TextDecoder().decode(res.body as ArrayBuffer));
  assert.equal(problem.status, 400);
});

test("azure adapter enforces bodyLimitBytes on the streamed request body", async () => {
  const handler = toAzureHandler(echoApp({ bodyLimitBytes: 32 }));
  // No content-length: the cap must trip while the stream is read.
  const res = await handler({
    method: "POST",
    url: "https://fn.azurewebsites.net/echo",
    headers: new Headers({ "content-type": "application/json" }),
    body: streamOf('{"hello":"', "x".repeat(64), '"}'),
  });
  assert.equal(res.status, 413);

  // A declared oversize length is refused up front.
  const declared = await handler(
    azureRequest("https://fn.azurewebsites.net/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1000000",
      },
      body: JSON.stringify({ hello: "x" }),
    }),
  );
  assert.equal(declared.status, 413);
});

test("azure adapter still runs schema validation on the translated request", async () => {
  const res = await toAzureHandler(echoApp())(
    azureRequest("https://fn.azurewebsites.net/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: 42 }),
    }),
  );
  assert.equal(res.status, 422);
});
