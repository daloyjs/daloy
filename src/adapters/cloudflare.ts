/**
 * Cloudflare Workers / generic fetch handler adapter.
 *
 * Cloudflare Workers expect the module's default export to expose a `fetch`
 * property whose value is the `(request, env, ctx) => Response` function.
 * `toFetchHandler` returns that exact shape, so the recommended usage is:
 *
 *   import { toFetchHandler } from "@daloyjs/core/cloudflare";
 *   import { app } from "./server.js";
 *   export default toFetchHandler(app);
 *
 * Do NOT wrap the result again (e.g. `export default { fetch: toFetchHandler(app) }`),
 * that nests the object and breaks the Workers runtime.
 *
 * The generic accepts the Worker's `Env` type when you want stronger typing
 * against bindings, e.g. `toFetchHandler<MyEnv>(app)`.
 */
import type { App } from "../app.js";

/** Module shape expected by the Cloudflare Workers runtime as `export default`. */
export interface ExportedFetchHandler<Env = unknown> {
  /**
   * Worker entry point: forwards the request to {@link App.fetch}. After the
   * response is produced, `ctx.waitUntil` is used to flush OTLP telemetry so
   * the isolate stays alive long enough for the export POST to finish.
   */
  fetch: (
    request: Request,
    env?: Env,
    ctx?: ExecutionContextLike,
  ) => Promise<Response>;
}

interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

/**
 * Wrap an {@link App} in the `{ fetch }` object expected by Cloudflare Workers and other web-standard hosts.
 *
 * After each request, OTLP telemetry is flushed via `ctx.waitUntil` so the
 * isolate stays alive long enough for the export POST to finish.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns An {@link ExportedFetchHandler} suitable as the module's `export default`.
 */
export function toFetchHandler<Env = unknown>(
  app: App,
): ExportedFetchHandler<Env> {
  return {
    async fetch(req, _env, ctx) {
      const res = await app.fetch(req);
      const telemetry = app.telemetry;
      if (telemetry !== undefined) {
        const pending = telemetry.flush();
        if (ctx?.waitUntil !== undefined) ctx.waitUntil(pending);
        else void pending;
      }
      return res;
    },
  };
}
