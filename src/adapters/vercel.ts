/**
 * Vercel Edge / generic Web-standard handler.
 *
 * Usage in Next.js Route Handlers:
 *   export const GET = (req) => app.fetch(req);
 *   export const POST = (req) => app.fetch(req);
 *
 * Or just:
 *   export default toEdgeHandler(app);
 */
import type { App } from "../app.js";

export function toEdgeHandler(app: App) {
  return (req: Request) => app.fetch(req);
}
