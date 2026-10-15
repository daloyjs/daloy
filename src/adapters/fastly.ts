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
 * After the response is produced, any OTLP telemetry flush is started
 * fire-and-forget. Pass the fetch event's `waitUntil` as the optional second
 * argument to keep the instance alive until the export finishes, or use
 * {@link installFastlyListener}, which does that for you.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A web-standard handler delegating to {@link App.fetch}.
 * @throws Error in production when `app.assertSecureConfig()` finds a boot-guard
 *   violation, so an insecure route table fails at startup, not on the first request.
 */
export function toFastlyHandler(
  app: App,
): (
  req: Request,
  waitUntil?: (promise: Promise<unknown>) => void,
) => Promise<Response> {
  // Refuse an insecure configuration at cold start (and so at deploy time
  // where the platform validates startup) instead of on the first request.
  app.assertSecureConfig();
  return async (req, waitUntil) => {
    const res = await app.fetch(req);
    const telemetry = app.telemetry;
    if (telemetry !== undefined) {
      const pending = telemetry.flush();
      if (waitUntil !== undefined) waitUntil(pending);
      else void pending;
    }
    return res;
  };
}

interface FastlyFetchEvent {
  request: Request;
  respondWith: (response: Response | Promise<Response>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Register a Fastly Compute `fetch` event listener that delegates to the given {@link App}.
 *
 * OTLP telemetry is flushed through the event's `waitUntil`, so the instance
 * stays alive until the export finishes.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @throws Error when `globalThis.addEventListener` is missing (not a Fastly Compute runtime).
 * @throws Error in production when `app.assertSecureConfig()` finds a boot-guard
 *   violation, so an insecure route table fails at startup, not on the first request.
 */
export function installFastlyListener(app: App): void {
  // toFastlyHandler refuses an insecure configuration at cold start (and so
  // at deploy time where the platform validates startup).
  const handler = toFastlyHandler(app);
  const g = globalThis as {
    addEventListener?: (type: string, listener: (event: FastlyFetchEvent) => void) => void;
  };
  if (typeof g.addEventListener !== "function") {
    throw new Error("Fastly Compute runtime not detected: globalThis.addEventListener is missing");
  }
  g.addEventListener("fetch", (event) =>
    event.respondWith(handler(event.request, event.waitUntil?.bind(event))),
  );
}
