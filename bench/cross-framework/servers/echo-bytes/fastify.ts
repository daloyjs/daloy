// Fastify — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import Fastify from "fastify";

const BODY_LIMIT = 8 * 1024 * 1024;

const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });

// Buffer raw octet-stream bodies instead of trying to JSON-parse them.
app.addContentTypeParser(
  "application/octet-stream",
  { parseAs: "buffer" },
  (_req, body, done) => {
    done(null, body);
  },
);

app.get("/health", async () => ({ ok: true }));

app.post("/echo-bytes", async (req) => {
  const body = req.body as Buffer;
  return { received: Buffer.isBuffer(body) ? body.byteLength : 0 };
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  process.stdout.write(`READY ${port}\n`);
});
