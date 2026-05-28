// Elysia on @elysiajs/node with one structured access log per completed response.
import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { accessLogStart, writeAccessLog } from "./access-log";

const port = Number(process.env.PORT ?? 3000);
const startedAtByRequest = new WeakMap<Request, number>();

new Elysia({ adapter: node() })
  .onRequest(({ request }) => {
    startedAtByRequest.set(request, accessLogStart());
  })
  .onAfterResponse(({ request, path, set }) => {
    const status = typeof set.status === "number" ? set.status : 200;
    writeAccessLog(
      "elysia",
      request.method,
      path,
      status,
      startedAtByRequest.get(request) ?? accessLogStart()
    );
    startedAtByRequest.delete(request);
  })
  .get("/static", () => ({ ok: true }))
  .get("/users/:id", ({ params }) => ({ id: params.id }))
  .post("/echo", ({ body }) => ({ name: (body as { name: string }).name }), {
    body: t.Object({ name: t.String() }),
  })
  .listen({ port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(`READY ${port}\n`);
  });
