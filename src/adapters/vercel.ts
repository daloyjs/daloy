/**
 * Vercel / web-standard handler.
 *
 * Vercel recommends the Node.js runtime for new functions (it runs on Fluid
 * Compute with full Node APIs) and has deprecated standalone Edge Functions.
 * The runtime is web-standard, but the export shape differs by integration:
 * Node `/api` functions use a default `{ fetch }` object, App Router route
 * handlers use named method exports, and the deprecated Edge runtime expects a
 * bare function export — {@link toWebHandler} — plus `export const runtime =
 * "edge"`.
 *
 *   // Vercel Functions (`api/[...path].ts`) — recommended
 *   import { toFetchHandler } from "@daloyjs/core/vercel";
 *   export default toFetchHandler(app);
 *
 *   // Optional: Next.js App Router host (`app/api/[...slug]/route.ts`)
 *   import { toRouteHandlers } from "@daloyjs/core/vercel";
 *   export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
 *     toRouteHandlers(app);
 */
import type { App } from "../app.js";

/** Web-standard handler shape used by Vercel Functions, Next.js route handlers, and middleware. */
export type WebHandler = (req: Request) => Promise<Response>;
/** Default export shape for Vercel's web-standard `{ fetch }` runtime. */
export interface FetchHandler {
  /** Request entry point: forwards the request to {@link App.fetch}. */
  fetch: WebHandler;
}

const NEXT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
/** Record of per-method handlers expected by a Next.js App Router `route.ts` file. */
export type RouteHandlers = Record<(typeof NEXT_METHODS)[number], WebHandler>;

/**
 * Wrap an {@link App} as a single web-standard fetch handler.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A {@link WebHandler} delegating to {@link App.fetch}.
 */
export function toWebHandler(app: App): WebHandler {
  return (req) => app.fetch(req);
}

/**
 * Build the default `{ fetch }` export expected by Vercel Node.js Functions
 * in the `/api` directory.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A {@link FetchHandler} object suitable as the module's `export default`.
 */
export function toFetchHandler(app: App): FetchHandler {
  return { fetch: toWebHandler(app) };
}

/**
 * Build the `{ GET, POST, ... }` object expected by Next.js App Router
 * `route.ts` files when a DaloyJS app is mounted inside an existing Next app.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A {@link RouteHandlers} record mapping every supported HTTP method to the same {@link WebHandler}.
 */
export function toRouteHandlers(app: App): RouteHandlers {
  const handler = toWebHandler(app);
  const out = {} as RouteHandlers;
  for (const method of NEXT_METHODS) out[method] = handler;
  return out;
}
