// NestJS (@nestjs/platform-fastify) — route-scale harness. Decorator routes are
// static, so the ROUTE_COUNT routes are registered on the underlying Fastify
// instance after bootstrap, which is the same router Nest dispatches through.
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

@Module({})
class AppModule {}

async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  const instance = app.getHttpAdapter().getInstance();
  const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
  for (let i = 0; i < COUNT; i++) {
    instance.get(`/r/${i}`, async () => ({ i }));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`READY ${port}\n`);
}

bootstrap();
