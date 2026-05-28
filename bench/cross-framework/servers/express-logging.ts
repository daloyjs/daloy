// Express v5 with one structured access log per completed response.
import express from "express";
import { accessLogStart, writeAccessLog } from "./access-log";

const app = express();

app.use((req, res, next) => {
  const startedAt = accessLogStart();
  res.on("finish", () => {
    writeAccessLog("express", req.method, req.originalUrl ?? req.url, res.statusCode, startedAt);
  });
  next();
});

app.use(express.json());

app.get("/static", (_req, res) => {
  res.json({ ok: true });
});
app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});
app.post("/echo", (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string") {
    res.status(400).json({ error: "bad" });
    return;
  }
  res.json({ name });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
