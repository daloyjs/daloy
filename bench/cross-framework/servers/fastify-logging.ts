// Fastify with one structured access log per completed response.
import Fastify from "fastify";
import { accessLogStart, writeAccessLog } from "./access-log";

const app = Fastify({ logger: false });

app.addHook("onRequest", (req, _reply, done) => {
  (req as any).accessLogStartedAt = accessLogStart();
  done();
});

app.addHook("onResponse", (req, reply, done) => {
  writeAccessLog(
    "fastify",
    req.method,
    req.url,
    reply.statusCode,
    Number((req as any).accessLogStartedAt) || accessLogStart()
  );
  done();
});

app.get("/static", async () => ({ ok: true }));
app.get<{ Params: { id: string } }>("/users/:id", async (req) => ({ id: req.params.id }));
app.post<{ Body: { name?: unknown } }>("/echo", async (req, reply) => {
  const name = req.body?.name;
  if (typeof name !== "string") {
    reply.code(400);
    return { error: "bad" };
  }
  return { name };
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  process.stdout.write(`READY ${port}\n`);
});
