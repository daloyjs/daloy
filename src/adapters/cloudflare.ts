/**
 * Cloudflare Workers / generic fetch handler adapter.
 *
 * Usage:
 *   export default toFetchHandler(app);
 */
import type { App } from "../app.js";

export function toFetchHandler(app: App): { fetch: (req: Request, env?: unknown, ctx?: unknown) => Promise<Response> } {
  return {
    fetch: (req) => app.fetch(req),
  };
}
