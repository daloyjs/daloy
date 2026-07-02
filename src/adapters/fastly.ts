/**
 * Fastly Compute adapter.
 *
 * Fastly Compute uses the standard `fetch` event model, so the adapter is a
 * one-liner wrapper around {@link App.fetch}. Two usage styles are supported:
 *
 *   // 1. Event listener style (Fastly Compute @ Edge JS default):
 *   import { installFastlyListener } from "@daloyjs/core/fastly";
 *   installFastlyListener(app);
 *
 *   // 2. Plain function style (composable with other handlers):
 *   import { toFastlyHandler } from "@daloyjs/core/fastly";
 *   const handler = toFastlyHandler(app);
 *   addEventListener("fetch", (event) => event.respondWith(handler(event.request)));
 *
 * Caveats: Fastly Compute does not expose `node:*` modules or full WHATWG
 * streams; avoid Node-only middleware (Node session store, Redis client,
 * multipart helpers that rely on `node:stream`).
 */
import type { App } from "../app.js";

/**
 * Wrap an {@link App} in a `(req) => Promise<Response>` function suitable for Fastly Compute.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A web-standard handler delegating to {@link App.fetch}.
 */
export function toFastlyHandler(app: App): (req: Request) => Promise<Response> {
  return (req) => app.fetch(req);
}

interface FastlyFetchEvent {
  request: Request;
  respondWith: (response: Response | Promise<Response>) => void;
}

/**
 * Register a Fastly Compute `fetch` event listener that delegates to the given {@link App}.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @throws Error when `globalThis.addEventListener` is missing (not a Fastly Compute runtime).
 */
export function installFastlyListener(app: App): void {
  const g = globalThis as { addEventListener?: (type: string, listener: (event: FastlyFetchEvent) => void) => void };
  if (typeof g.addEventListener !== "function") {
    throw new Error("Fastly Compute runtime not detected: globalThis.addEventListener is missing");
  }
  g.addEventListener("fetch", (event) => event.respondWith(app.fetch(event.request)));
}
