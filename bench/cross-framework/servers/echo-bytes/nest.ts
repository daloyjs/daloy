// NestJS (@nestjs/platform-fastify) — raw-bytes echo server for the body-size
// sweep. POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import "reflect-metadata";
import { Controller, Get, Post, Req, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

const BODY_LIMIT = 8 * 1024 * 1024;

@Controller()
class AppController {
  @Get("/health")
  health() {
    return { ok: true };
  }
  @Post("/echo-bytes")
  echo(@Req() req: { body?: unknown }) {
    const body = req.body as Buffer;
    return { received: Buffer.isBuffer(body) ? body.byteLength : 0 };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: false, bodyLimit: BODY_LIMIT });
  adapter.getInstance().addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    },
  );
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`READY ${port}\n`);
}

bootstrap();
