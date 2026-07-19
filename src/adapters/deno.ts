/**
 * Deno adapter — `Deno.serve` is web-standard fetch.
 *
 * Supports the modern `Deno.serve(options, handler)` signature: HTTPS via
 * `cert`/`key`, an `onListen` callback, an `onError` hook, and signal-based
 * graceful shutdown (also wired to SIGTERM/SIGINT when `handleSignals` is
 * left at the default).
 */
import type { App } from "../app.js";
import { setConnInfo } from "../conn-info.js";

/** Options forwarded to `Deno.serve` by {@link serve}. */
export interface DenoServeOptions {
  /** TCP port to listen on. Defaults to `3000`. */
  port?: number;
  /** Interface to bind. Defaults to `"0.0.0.0"`. */
  hostname?: string;
  /** Optional external signal that triggers graceful shutdown. */
  signal?: AbortSignal;
  /** Optional TLS certificate (PEM). When supplied together with `key`, serves HTTPS. */
  cert?: string;
  /** Optional TLS private key (PEM). Pairs with `cert`. */
  key?: string;
  /** Invoked once the server is listening. */
  onListen?: (info: { hostname: string; port: number }) => void;
  /** Invoked when the fetch handler itself throws. Must return a fallback Response. */
  onError?: (err: unknown) => Response | Promise<Response>;
  /** Listen for SIGTERM/SIGINT and shut down. Default: true. */
  handleSignals?: boolean;
  /** Drain timeout for graceful shutdown. Default: 10000. */
  shutdownTimeoutMs?: number;
}

/** Handle returned by {@link serve}; call `shutdown()` to drain. */
export interface DenoServerHandle {
  /** Graceful shutdown: drains {@link App.shutdown} hooks, then stops the Deno server. Idempotent. */
  shutdown: () => Promise<void>;
}

/**
 * Start `Deno.serve` bound to the given {@link App} with graceful-shutdown wiring.
 *
 * @param app - The DaloyJS {@link App} whose `fetch` serves each request.
 * @param opts - Listener/TLS/shutdown options; see {@link DenoServeOptions}.
 * @returns A {@link DenoServerHandle} whose `shutdown()` drains in-flight requests.
 * @throws Error when the Deno runtime (`globalThis.Deno.serve`) is not detected.
 */
export function serve(app: App, opts: DenoServeOptions = {}): DenoServerHandle {
  const D = (globalThis as {
    Deno?: {
      serve?: unknown;
      addSignalListener?: (sig: string, fn: () => void) => void;
      removeSignalListener?: (sig: string, fn: () => void) => void;
    };
  }).Deno;
  const denoServe = D?.serve as
    | ((
        init: Record<string, unknown>,
        handler: (
          req: Request,
          info?: { remoteAddr?: { hostname?: string; port?: number } },
        ) => Response | Promise<Response>,
      ) => { shutdown?: () => Promise<void> })
    | undefined;
  if (!denoServe) throw new Error("Deno runtime not detected");

  const controller = new AbortController();
  const init: Record<string, unknown> = {
    port: opts.port ?? 3000,
    hostname: opts.hostname ?? "0.0.0.0",
    signal: controller.signal,
  };
  if (opts.cert && opts.key) {
    init.cert = opts.cert;
    init.key = opts.key;
  }
  if (opts.onListen) init.onListen = opts.onListen;
  if (opts.onError) init.onError = opts.onError;

  const servesTls = Boolean(opts.cert && opts.key);
  const server = denoServe(init, (req, info) => {
    // Fulfil the conn-info contract with the immediate TCP peer from
    // `Deno.serve`'s handler info, so `getConnInfo` / `resolveClientIp` /
    // `behindProxy` work on Deno. Never derived from spoofable headers.
    const addr = info?.remoteAddr;
    if (addr?.hostname !== undefined) {
      setConnInfo(req, {
        remoteAddress: addr.hostname,
        remotePort: addr.port,
        tls: servesTls,
      });
    }
    return app.fetch(req);
  });

  const onSignal = () => {
    void shutdown();
  };
  if (opts.handleSignals !== false && typeof D?.addSignalListener === "function") {
    D.addSignalListener("SIGTERM", onSignal);
    D.addSignalListener("SIGINT", onSignal);
  }
  opts.signal?.addEventListener("abort", onSignal, { once: true });

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    opts.signal?.removeEventListener("abort", onSignal);
    if (opts.handleSignals !== false && typeof D?.removeSignalListener === "function") {
      D.removeSignalListener("SIGTERM", onSignal);
      D.removeSignalListener("SIGINT", onSignal);
    }
    // Drain app-level hooks first (while the HTTP server can still respond),
    // then ask Deno to stop gracefully — `server.shutdown()` stops accepting
    // new connections and lets in-flight requests finish. Abort only as a
    // fallback for runtimes that lack `HttpServer.shutdown()`: Deno 2.9 closes
    // the listener resource inside shutdown(), so aborting the same signal
    // afterwards throws BadResource.
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    if (server.shutdown) await server.shutdown();
    else controller.abort();
  };

  return { shutdown };
}
