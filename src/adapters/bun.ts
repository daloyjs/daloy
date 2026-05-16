/**
 * Bun adapter — `Bun.serve` already speaks web-standard fetch,
 * so this is the smallest possible wrapper.
 */
import type { App } from "../app.js";

export interface BunServeOptions {
  port?: number;
  hostname?: string;
  /** Maximum request body bytes (Bun-level cap). Default: 16 MiB. */
  maxRequestBodySize?: number;
}

export function serve(app: App, opts: BunServeOptions = {}): { stop: () => Promise<void>; port: number } {
  const Bun = (globalThis as any).Bun;
  if (!Bun?.serve) throw new Error("Bun runtime not detected");
  const server = Bun.serve({
    port: opts.port ?? 3000,
    hostname: opts.hostname ?? "0.0.0.0",
    maxRequestBodySize: opts.maxRequestBodySize ?? 16 * 1024 * 1024,
    fetch: (req: Request) => app.fetch(req),
    error: (err: Error) =>
      new Response(
        JSON.stringify({
          type: "https://daloyjs.dev/errors/internal",
          title: "Internal Server Error",
          status: 500,
          detail: err.message,
        }),
        { status: 500, headers: { "content-type": "application/problem+json" } }
      ),
  });
  return {
    port: server.port,
    stop: async () => {
      await app.shutdown();
      server.stop(true);
    },
  };
}
