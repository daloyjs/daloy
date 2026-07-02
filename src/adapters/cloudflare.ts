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
  /** Worker entry point: forwards the request to {@link App.fetch}. `env`/`ctx` are accepted but unused by the adapter. */
  fetch: (request: Request, env?: Env, ctx?: ExecutionContextLike) => Promise<Response>;
}

interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

/**
 * Wrap an {@link App} in the `{ fetch }` object expected by Cloudflare Workers and other web-standard hosts.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns An {@link ExportedFetchHandler} suitable as the module's `export default`.
 */
export function toFetchHandler<Env = unknown>(app: App): ExportedFetchHandler<Env> {
  return {
    fetch: (req) => app.fetch(req),
  };
}
