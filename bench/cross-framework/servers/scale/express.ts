// Express v5 — route-scale harness: registers ROUTE_COUNT distinct routes.
import express from "express";

const app = express();
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
for (let i = 0; i < COUNT; i++) {
  app.get(`/r/${i}`, (_req, res) => {
    res.json({ i });
  });
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
