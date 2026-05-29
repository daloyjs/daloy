// Elysia on @elysiajs/node. (Bun-native numbers will be higher; that's a
// runtime story, not a framework story — keep cross-framework runs on Node.)
import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";

const port = Number(process.env.PORT ?? 3000);

new Elysia({ adapter: node() })
  .get("/static", () => ({ ok: true }))
  .get("/users/:id", ({ params }) => ({ id: params.id }))
  .post(
    "/echo",
    ({ body }) => ({ name: body.name }),
    { body: t.Object({ name: t.String() }) },
  )
  .listen({ port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(`READY ${port}\n`);
  });
