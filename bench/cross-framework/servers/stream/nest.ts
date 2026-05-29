// NestJS on @nestjs/platform-fastify — large streaming response via StreamableFile.
import "reflect-metadata";
import {
  Controller,
  Get,
  Header,
  Module,
  StreamableFile,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Readable } from "node:stream";

const CHUNK = Buffer.alloc(64 * 1024, 0x61);
const TOTAL_CHUNKS = 160;

@Controller()
class AppController {
  @Get("/health")
  health() {
    return { ok: true };
  }
  @Get("/stream")
  @Header("content-type", "application/octet-stream")
  stream() {
    let sent = 0;
    const node = new Readable({
      read() {
        if (sent >= TOTAL_CHUNKS) {
          this.push(null);
          return;
        }
        this.push(CHUNK);
        sent++;
      },
    });
    return new StreamableFile(node);
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
