/**
 * Route bodies the framework parses itself (JSON, urlencoded, text) must be
 * well-formed UTF-8. A lenient decode would substitute U+FFFD for malformed
 * sequences and validate the result as if the client had sent it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/app.js";

const INVALID = new Uint8Array([0x7b, 0x22, 0x6e, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]); // {"n":"\xff\xfe"}

function bodyApp(accepts?: string[]): App {
  const app = new App({ env: "test", logger: false });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    ...(accepts ? { accepts } : {}),
    request: { body: z.any() as any },
    responses: { 200: { description: "ok", body: z.any() as any } },
    handler: async (ctx) => ({ status: 200 as const, body: ctx.body }),
  });
  return app;
}

async function post(app: App, contentType: string, body: BodyInit): Promise<Response> {
  return app.fetch(
    new Request("http://x/echo", { method: "POST", headers: { "content-type": contentType }, body })
  );
}

test("JSON body with malformed UTF-8 is refused with 400 (not parsed with U+FFFD)", async () => {
  const res = await post(bodyApp(), "application/json", INVALID);
  assert.equal(res.status, 400);
  const problem = (await res.json()) as { detail?: string };
  assert.match(problem.detail ?? "", /UTF-8/);
});

test("JSON body with malformed UTF-8 is refused on the streamed path too", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(INVALID.slice(0, 5));
      controller.enqueue(INVALID.slice(5));
      controller.close();
    },
  });
  const res = await bodyApp().fetch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error -- Node's fetch requires duplex for stream bodies
      duplex: "half",
    })
  );
  assert.equal(res.status, 400);
});

test("urlencoded body with malformed UTF-8 is refused with 400", async () => {
  const res = await post(
    bodyApp(),
    "application/x-www-form-urlencoded",
    new Uint8Array([0x61, 0x3d, 0xc0, 0xaf]) // a=<overlong "/">
  );
  assert.equal(res.status, 400);
});

test("text body with malformed UTF-8 is refused with 400 when text/plain is accepted", async () => {
  const res = await post(bodyApp(["text/plain"]), "text/plain", new Uint8Array([0x68, 0x69, 0xff]));
  assert.equal(res.status, 400);
});

test("well-formed UTF-8 bodies (including non-ASCII and a BOM) still parse", async () => {
  const json = await post(bodyApp(), "application/json", JSON.stringify({ n: "héllo ✓ 日本" }));
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { n: "héllo ✓ 日本" });

  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"n":1}')]);
  const withBom = await post(bodyApp(), "application/json", bom);
  assert.equal(withBom.status, 200);
  assert.deepEqual(await withBom.json(), { n: 1 });

  const form = await post(bodyApp(), "application/x-www-form-urlencoded", "a=%C3%A9&b=ü");
  assert.equal(form.status, 200);
  assert.deepEqual(await form.json(), { a: "é", b: "ü" });
});
