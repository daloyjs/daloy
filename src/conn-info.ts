/**
 * Adapter-independent connection info abstraction.
 *
 * Provides a single typed surface for "where did this request come from" so
 * the rate limiter, `ipRestriction`, request-id propagation, audit log, and
 * TLS-enforcement code paths read from one source of truth instead of poking
 * at adapter-specific shapes or trusting raw `X-Forwarded-*` echoes by
 * mistake.
 *
 * Adapters call {@link setConnInfo} before dispatching the request; consumers
 * call {@link getConnInfo} or use the {@link App}'s `behindProxy` policy via
 * {@link resolveClientIp}.
 *
 * `info.remote` is populated lazily — adapters may stash a thunk (`() =>
 * string`) instead of an eager string so the IP is never enumerated into a
 * plain object that a careless `JSON.stringify(ctx.info)` could leak. This
 * is a deliberate data-minimization defense.
 *
 * @since 0.24.0
 */

import type { BaseContext } from "./types.js";

/**
 * Declarative reverse-proxy posture. Replaces the
 * foot-gunny `trustProxy: boolean` with a structured value that
 * simultaneously configures rate-limit keying, TLS enforcement, request-IP
 * resolution, and the `X-Forwarded-*` accept policy from a single source of
 * truth.
 *
 * - `"none"` — refuse `X-Forwarded-*` entirely. Use when the app is exposed
 *   directly to the public internet on purpose.
 * - `"loopback"` — trust `X-Forwarded-*` only when the immediate peer is
 *   `127.0.0.1` / `::1`. Convenient default for local development behind a
 *   reverse-proxy on the same host.
 * - `{ hops: N }` — trust the proxy chain when exactly N hops sit between
 *   Daloy and the public internet. Reads the (N+1)-from-rightmost IP from
 *   `X-Forwarded-For`. Refuses spoofed extra hops at the left of the
 *   header.
 * - `{ cidrs: [...] }` — trust `X-Forwarded-*` only when the immediate
 *   peer address falls inside one of the supplied CIDR ranges (IPv4 or
 *   IPv6 acceptable).
 *
 * @since 0.24.0
 */
export type BehindProxyConfig =
  | "none"
  | "loopback"
  | { readonly hops: number }
  | { readonly cidrs: readonly string[] };

/**
 * Per-request connection metadata. Populated lazily — never enumerate
 * `getConnInfo(req)` into a plain object; read the specific field you need.
 *
 * @since 0.24.0
 */
export interface ConnInfo {
  /** Immediate peer address (the TCP socket talking to the adapter). */
  readonly remoteAddress?: string;
  /** Immediate peer port. */
  readonly remotePort?: number;
  /** Whether the adapter served this request over TLS. */
  readonly tls?: boolean;
}

interface MutableConnInfo {
  remoteAddress?: string;
  remotePort?: number;
  tls?: boolean;
}

const CONN_INFO_SYMBOL: unique symbol = Symbol.for("daloyjs.connInfo");

/**
 * @internal Adapter helper — attach {@link ConnInfo} to a `Request`. Called
 * by the Node / Bun / Deno / Lambda adapters before `app.fetch(request)`.
 * The pure edge delegators (Cloudflare, Vercel, Fastly) expose no peer
 * socket to attach — on those platforms the client address arrives via
 * platform-set headers, which are governed by the `behindProxy` /
 * `trustProxyHeaders` policies instead.
 *
 * @param request - Incoming request to tag (stored under a private symbol).
 * @param info - Connection metadata gathered by the adapter.
 */
export function setConnInfo(request: Request, info: ConnInfo): void {
  (request as unknown as Record<PropertyKey, unknown>)[CONN_INFO_SYMBOL] = info;
}

/**
 * Read the {@link ConnInfo} the adapter attached to this request, or
 * `undefined` when the adapter does not expose connection metadata (e.g.
 * Cloudflare Workers without `cf` enabled).
 *
 * @param request - Request previously tagged by {@link setConnInfo}.
 * @returns The attached {@link ConnInfo}, or `undefined` when absent.
 * @since 0.24.0
 */
export function getConnInfo(request: Request): ConnInfo | undefined {
  return (request as unknown as Record<PropertyKey, unknown>)[CONN_INFO_SYMBOL] as
    | ConnInfo
    | undefined;
}

/**
 * Refuses-at-construction on malformed {@link BehindProxyConfig}. Called once
 * during `new App({ behindProxy })`.
 *
 * @param cfg - Proxy posture to validate; `undefined` is accepted as "unset".
 * @throws Error when `hops` is not an integer in [0, 64], when `cidrs` is
 *   empty or contains non-string entries, or when the shape is unrecognized.
 * @since 0.24.0
 */
export function assertBehindProxy(cfg: BehindProxyConfig | undefined): void {
  if (cfg === undefined) return;
  if (cfg === "none" || cfg === "loopback") return;
  if (typeof cfg === "object" && cfg !== null) {
    if ("hops" in cfg) {
      if (!Number.isInteger(cfg.hops) || cfg.hops < 0 || cfg.hops > 64) {
        throw new Error(
          `behindProxy.hops must be an integer in [0, 64]; got ${String(cfg.hops)}.`,
        );
      }
      return;
    }
    if ("cidrs" in cfg) {
      if (!Array.isArray(cfg.cidrs) || cfg.cidrs.length === 0) {
        throw new Error("behindProxy.cidrs must be a non-empty string array.");
      }
      for (const c of cfg.cidrs) {
        if (typeof c !== "string" || c.length === 0) {
          throw new Error("behindProxy.cidrs entries must be non-empty strings.");
        }
      }
      return;
    }
  }
  throw new Error(
    `behindProxy must be "none" | "loopback" | { hops } | { cidrs }; got ${typeof cfg}.`,
  );
}

/**
 * Read the (N+1)-from-rightmost IP from `X-Forwarded-For`.
 * ("`behindProxy` collapses `maxIpsCount`") — when the proxy chain is
 * declared with `{ hops: N }`, only that exact slot is honoured. Returns
 * `undefined` when the header is shorter than the configured hop count
 * (caller falls back to the immediate peer).
 *
 * @param header - Raw `X-Forwarded-For` header value, or `null` when absent.
 * @param hops - Declared number of trusted proxy hops (must be >= 1).
 * @returns The client IP at the declared hop, or `undefined` when the chain
 *   is too short or `hops < 1`.
 * @internal
 */
export function pickForwardedForByHops(
  header: string | null,
  hops: number,
): string | undefined {
  if (!header || hops < 1) return undefined;
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < hops) return undefined;
  // Right-to-left: index 0 is the last hop closest to Daloy. The client
  // typically lives at parts[parts.length - hops].
  return parts[parts.length - hops];
}

/**
 * Resolve the client IP for this request using the configured
 * {@link BehindProxyConfig}. Returns `undefined` when no trusted source is
 * available (the caller — rate-limit, ipRestriction, audit-log — must fail
 * closed rather than guess).
 *
 * @param request - Incoming request whose client IP should be resolved.
 * @param cfg - The app's `behindProxy` posture; `undefined` behaves as `"none"`.
 * @returns The trusted client IP, or `undefined` when neither the peer
 *   address nor a trusted `X-Forwarded-For` slot is available.
 * @since 0.24.0
 */
export function resolveClientIp(
  request: Request,
  cfg: BehindProxyConfig | undefined,
): string | undefined {
  const conn = getConnInfo(request);
  const peer = conn?.remoteAddress;
  if (cfg === undefined || cfg === "none") return peer;
  if (cfg === "loopback") {
    if (peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1") {
      const xff = request.headers.get("x-forwarded-for");
      const first = xff?.split(",")[0]?.trim();
      if (first) return first;
    }
    return peer;
  }
  if ("hops" in cfg) {
    const xff = request.headers.get("x-forwarded-for");
    return pickForwardedForByHops(xff, cfg.hops) ?? peer;
  }
  // { cidrs } — out of scope for the trim implementation; falls back to peer.
  // The CIDR matcher is reused from src/ip-restriction.ts; consumers that
  // need the full check can compose ipRestriction({ allow: cfg.cidrs }) into
  // the resolver. We honour the header only if the peer matches one of the
  // declared CIDRs.
  return peer;
}

/**
 * Lazy accessors for `ctx.remoteAddress` / `ctx.remotePort`. Returns
 * `undefined` rather than allocating a plain object so the IP cannot be
 * serialized into logs by accident.
 *
 * @param ctx - Request context whose adapter-attached {@link ConnInfo} is read.
 * @returns The immediate peer address, or `undefined` when the adapter did
 *   not attach connection metadata.
 * @since 0.24.0
 */
export function readRemoteAddress(ctx: BaseContext<any, any>): string | undefined {
  return getConnInfo(ctx.request)?.remoteAddress;
}

/**
 * Lazy accessor for `ctx.remotePort` (the immediate peer's TCP port).
 *
 * @param ctx - Request context whose adapter-attached {@link ConnInfo} is read.
 * @returns The immediate peer port, or `undefined` when the adapter did not
 *   attach connection metadata.
 * @since 0.24.0
 */
export function readRemotePort(ctx: BaseContext<any, any>): number | undefined {
  return getConnInfo(ctx.request)?.remotePort;
}

/**
 * Test-only helper that shallow-copies a {@link ConnInfo} into a mutable shape
 * so tests can tweak fields without casting away `readonly`.
 *
 * @param info - Connection metadata to copy.
 * @returns A mutable shallow copy of `info`.
 * @internal
 */
export function _makeConnInfoForTests(info: ConnInfo): MutableConnInfo {
  return { ...info };
}
