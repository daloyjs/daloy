// DaloyJS minimal-contract variant — apples-to-apples vs hono.ts / fastify.ts
// on the *error path* bench.
//
// `daloy.ts` returns full RFC 9457 problem+json (~170–270 bytes per error,
// with a per-request `urn:request:<uuid>` instance, structured `errors[]`,
// canonical `type` URI). `hono.ts` returns 13 bytes of `text/plain` on 404
// and 15 bytes of `{"error":"bad"}` on schema-fail.
//
// This server keeps the Zod validation and the daloy router intact — same
// *work* — but overrides `onError` so the bytes-on-the-wire match hono's
// minimal shape. It isolates how much of the error-path delta is the
// response contract vs. real overhead in the dispatch loop.
import { z } from "zod";
import {
  App,
  NotFoundError,
  ValidationError,
  BadRequestError,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  logger: false,
  hooks: {
    onError: (err) => {
      if (err instanceof NotFoundError) {
        return new Response("404 Not Found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }
      if (err instanceof ValidationError || err instanceof BadRequestError) {
        return new Response('{"error":"bad"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return undefined;
    },
  },
});

app.route({
  method: "GET",
  path: "/static",
  operationId: "getStatic",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
  handler: async ({ params }) => ({ status: 200, body: { id: params.id } }),
});

app.route({
  method: "POST",
  path: "/echo",
  operationId: "echo",
  request: { body: z.object({ name: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ name: z.string() }) } },
  handler: async ({ body }) => ({ status: 200, body: { name: body.name } }),
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
