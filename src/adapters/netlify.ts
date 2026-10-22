/**
 * Netlify adapter.
 *
 * Netlify Functions v2 and Netlify Edge Functions both call the default
 * export as `(request, context) => Response`. The request is web-standard,
 * so {@link App.fetch} serves it directly; what the dedicated adapter adds
 * over a bare `toWebHandler(app)` is the Netlify `context`:
 *
 * - `context.ip` is the client address Netlify's edge observed on the TCP
 *   connection. It is attached as the request's connection info, so
 *   `behindProxy: "none"` (the right posture when Netlify is the only
 *   thing in front) resolves the real client for `rateLimit()`,
 *   `autoBan()`, `ipRestriction()` and audit logs instead of putting every
 *   caller in one shared bucket, and it is never read from a spoofable
 *   header.
 * - `context.waitUntil` keeps the function alive until the OTLP telemetry
 *   flush finishes, instead of the flush being dropped on return.
 *
 *   // netlify/functions/api.mts  (Functions v2, Node)
 *   // netlify/edge-functions/api.ts (Edge Functions, Deno)
 *   import { toNetlifyHandler } from "@daloyjs/core/netlify";
 *   import { app } from "../../src/server.js";
 *   export default toNetlifyHandler(app);
 *   export const config = { path: "/api/*" };
 *
 * Caveats: Edge Functions do not expose `node:*` modules, so avoid Node-only
 * middleware there (the same limit as Vercel Edge and Cloudflare Workers).
 *
 * @module
 * @since 1.16.0
 */
import type { App } from "../app.js";
import { setConnInfo } from "../conn-info.js";
import { parseIp } from "../ip-match.js";

/**
 * The subset of Netlify's `Context` the adapter reads. Structurally
 * compatible with `@netlify/functions` and `@netlify/edge-functions`, so no
 * dependency on either package is needed.
 *
 * @since 1.16.0
 */
export interface NetlifyContext {
  /** Client IP as observed by Netlify's edge. */
  readonly ip?: string;
  /** Keep the invocation alive until `promise` settles (Functions v2 / Edge). */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Handler shape Netlify invokes for a function's default export.
 *
 * @since 1.16.0
 */
export type NetlifyHandler = (request: Request, context?: NetlifyContext) => Promise<Response>;

/**
 * Wrap an {@link App} as a Netlify Functions v2 / Edge Functions default
 * export.
 *
 * `context.ip` is attached as the request's peer address when it is a valid
 * IP literal (anything else is ignored rather than trusted), and OTLP
 * telemetry is flushed through `context.waitUntil` when present, otherwise
 * fire-and-forget.
 *
 * @param app - The DaloyJS {@link App} that serves each incoming request.
 * @returns A {@link NetlifyHandler} delegating to {@link App.fetch}.
 * @throws Error in production when `app.assertSecureConfig()` finds a
 *   boot-guard violation, so an insecure route table fails at deploy time,
 *   not on the first request.
 * @since 1.16.0
 */
export function toNetlifyHandler(app: App): NetlifyHandler {
  // Refuse an insecure configuration at cold start (and so at deploy time
  // where the platform validates startup) instead of on the first request.
  app.assertSecureConfig();
  return async (request, context) => {
    const ip = context?.ip;
    if (typeof ip === "string" && ip.length > 0 && parseIp(ip)) {
      // Netlify terminates TLS at its edge; the function is only reachable
      // through it, so the request was served over TLS from the client's view.
      setConnInfo(request, { remoteAddress: ip, tls: true });
    }
    const res = await app.fetch(request);
    const telemetry = app.telemetry;
    if (telemetry !== undefined) {
      const pending = telemetry.flush();
      const waitUntil = context?.waitUntil;
      if (typeof waitUntil === "function") waitUntil.call(context, pending);
      else void pending;
    }
    return res;
  };
}
