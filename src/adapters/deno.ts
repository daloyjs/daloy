/**
 * Deno adapter — `Deno.serve` is web-standard fetch.
 */
import type { App } from "../app.js";

export interface DenoServeOptions {
  port?: number;
  hostname?: string;
}

export function serve(app: App, opts: DenoServeOptions = {}): { shutdown: () => Promise<void> } {
  const D = (globalThis as any).Deno;
  if (!D?.serve) throw new Error("Deno runtime not detected");
  const server = D.serve(
    { port: opts.port ?? 3000, hostname: opts.hostname ?? "0.0.0.0" },
    (req: Request) => app.fetch(req)
  );
  return {
    shutdown: async () => {
      await app.shutdown();
      await server.shutdown?.();
    },
  };
}
