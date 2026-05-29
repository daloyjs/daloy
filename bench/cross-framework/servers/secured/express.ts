// Express v5 — production middleware parity with secured/daloy.ts:
// request-id, helmet secure headers, CORS allowlist, rate-limit, HS256 JWT.
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";

const app = express();
app.use((req, res, next) => {
  const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  res.setHeader("x-request-id", id);
  next();
});
app.use(helmet());
app.use(cors({ origin: ["http://127.0.0.1"], credentials: false }));
app.use(rateLimit({ max: Number.MAX_SAFE_INTEGER, windowMs: 60_000 }));
app.use(express.json());
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  try {
    jwt.verify(auth.slice("Bearer ".length), SECRET, { algorithms: ["HS256"] });
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
});

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
