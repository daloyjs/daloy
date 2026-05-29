// Express v5 — native JSON body parser.
import express from "express";

const app = express();
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
