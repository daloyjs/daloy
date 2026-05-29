// Fastify — route-scale harness: registers ROUTE_COUNT distinct routes.
import Fastify from "fastify";

const app = Fastify({ logger: false });
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
for (let i = 0; i < COUNT; i++) {
  app.get(`/r/${i}`, async () => ({ i }));
}

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  process.stdout.write(`READY ${port}\n`);
});
