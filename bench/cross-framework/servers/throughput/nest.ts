// NestJS on @nestjs/platform-fastify (the faster of the two official platforms).
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
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`READY ${port}\n`);
}

bootstrap();
