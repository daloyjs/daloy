// Fastify — production middleware parity with secured/daloy.ts:
// request-id, helmet secure headers, CORS allowlist, rate-limit, HS256 JWT.
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";

const app = Fastify({ logger: false, genReqId: () => randomUUID() });
await app.register(helmet);
await app.register(cors, { origin: ["http://127.0.0.1"] });
await app.register(rateLimit, { max: Number.MAX_SAFE_INTEGER, timeWindow: 60_000 });
await app.register(jwt, { secret: SECRET });

app.addHook("onRequest", async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: "invalid token" });
  }
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
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`READY ${port}\n`);
