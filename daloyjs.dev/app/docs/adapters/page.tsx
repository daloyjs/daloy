import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "Adapters & runtimes" };

export default function Page() {
  return (
    <>
      <h1>Adapters & runtimes</h1>
      <p>
        The DaloyJS core only ever sees <code>Request → Response</code>. Runtime-specific concerns —
        sockets, signals, edge handlers — live in thin adapters at the edge.
      </p>

      <h2>Node.js</h2>
      <CodeBlock code={`import { serve } from "daloy/node";

const { port, close } = serve(app, {
  port: 3000,
  hostname: "0.0.0.0",
  connectionTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  handleSignals: true,       // SIGTERM / SIGINT trigger graceful shutdown
  maxHeaderBytes: 16 * 1024, // 16 KiB cap (default)
});

// later
await close();`} />
      <p>
        The Node adapter wires <code>requestTimeout</code>, <code>headersTimeout</code>, and{" "}
        <code>keepAliveTimeout</code> to safe values, and listens for SIGTERM/SIGINT for zero-downtime
        rolling deploys.
      </p>

      <h2>Bun</h2>
      <CodeBlock code={`import { serve } from "daloy/bun";
serve(app, { port: 3000 });`} />

      <h2>Deno</h2>
      <CodeBlock code={`import { serve } from "daloy/deno";
serve(app, { port: 3000 });`} />

      <h2>Cloudflare Workers</h2>
      <CodeBlock code={`// worker.ts
import { toFetchHandler } from "daloy/cloudflare";
import { app } from "./src/server.js";

export default { fetch: toFetchHandler(app) };`} />

      <h2>Vercel Edge / Next.js Route Handlers</h2>
      <CodeBlock code={`// app/api/[[...slug]]/route.ts
import { toEdgeHandler } from "daloy/vercel";
import { app } from "@/server";

export const runtime = "edge";
export const GET    = toEdgeHandler(app);
export const POST   = toEdgeHandler(app);
export const PUT    = toEdgeHandler(app);
export const DELETE = toEdgeHandler(app);`} />

      <h2>Roll your own</h2>
      <p>If your runtime exposes the <code>fetch</code> standard, you don&apos;t need an adapter:</p>
      <CodeBlock code={`addEventListener("fetch", (event) => event.respondWith(app.fetch(event.request)));`} />
    </>
  );
}
