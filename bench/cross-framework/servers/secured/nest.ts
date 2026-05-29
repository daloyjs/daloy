// NestJS (@nestjs/platform-fastify) — production middleware parity with
// secured/daloy.ts: request-id, helmet, CORS allowlist, rate-limit, HS256 JWT.
// JWT verification is wired on the underlying Fastify instance via @fastify/jwt
// so the per-request cost mirrors the other Fastify-based secured servers.
import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Module,
  Param,
  Post,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";

@Controller()
class AppController {
  @Get("/static")
  getStatic() {
    return { ok: true };
  }
  @Get("/users/:id")
  getUser(@Param("id") id: string) {
    return { id };
  }
  @Post("/echo")
  @HttpCode(200)
  echo(@Body() body: { name?: unknown }) {
    if (typeof body?.name !== "string") {
      throw new HttpException({ error: "bad" }, 400);
    }
    return { name: body.name };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: false, genReqId: () => randomUUID() });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  await app.register(helmet as never);
  await app.register(cors as never, { origin: ["http://127.0.0.1"] });
  await app.register(rateLimit as never, { max: Number.MAX_SAFE_INTEGER, timeWindow: 60_000 });
  await app.register(jwt as never, { secret: SECRET });

  const instance = app.getHttpAdapter().getInstance();
  instance.addHook("onRequest", async (req: { jwtVerify: () => Promise<unknown> }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "invalid token" });
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`READY ${port}\n`);
}

bootstrap();
