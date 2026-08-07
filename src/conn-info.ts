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
import { compileCidrMatcher, matchesMatcher, parseIp, type IpMatcher } from "./ip-match.js";

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
  "none" | "loopback" | { readonly hops: number } | { readonly cidrs: readonly string[] };

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
    ConnInfo | undefined;
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
        throw new Error(`behindProxy.hops must be an integer in [0, 64]; got ${String(cfg.hops)}.`);
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
        // Refuse to boot on an invalid CIDR — a typo'd range must never
        // silently become "trust nobody" (fail-closed) or, worse, be ignored
        // (fail-open). Compile once here; request-time resolution reuses the
        // cached matchers, so the throw surface is construction-only.
        try {
          compileCidrMatcher(c);
        } catch {
          throw new Error(`behindProxy.cidrs: invalid IP/CIDR entry ${JSON.stringify(c)}.`);
        }
      }
      return;
    }
  }
  throw new Error(
    `behindProxy must be "none" | "loopback" | { hops } | { cidrs }; got ${typeof cfg}.`
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
export function pickForwardedForByHops(header: string | null, hops: number): string | undefined {
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
 * Validate a middleware's forwarded-header trust options and resolve them into
 * a single hop count. Every middleware that keys on client IP calls this once
 * at construction, so the trust policy lives in exactly one place instead of
 * being re-derived at each call site.
 *
 * That single-source property is the point: the spoofable-IP vulnerability this
 * module now guards against existed in nine independent copies of the same
 * leftmost-`X-Forwarded-For` read, which meant nine separate places to get it
 * wrong and nine separate fixes. Keeping the decision here means a future
 * change to the trust rules lands everywhere at once.
 *
 * `trustedHops` must be an integer in [1, 64], mirroring the
 * `behindProxy.hops` range: the floor of one exists because a middleware that
 * trusts zero proxy hops has no business reading forwarding headers at all.
 *
 * `trustedProxies` (a CIDR allowlist of proxy peer addresses) also enables
 * forwarded-header trust, defaulting to one hop when `trustedHops` is not
 * set: declaring WHO your proxies are is meaningless unless their headers
 * are then read. Pair it with {@link resolveTrustedProxyMatchers} and pass
 * the compiled matchers to {@link resolveForwardedClientIp} so the forwarded
 * identity is honoured only when the immediate TCP peer is a verified proxy.
 *
 * @param name - Middleware function name used in error messages.
 * @param opts - The middleware's options object; only the trust fields are
 *   read, so any middleware option type is structurally acceptable.
 * @returns The number of trusted proxy hops when forwarded-header trust is
 *   enabled — `trustedHops` verbatim, `1` for a bare
 *   `trustProxyHeaders: true`, or `1` when `trustedProxies` is declared
 *   without an explicit hop count — or `undefined` when trust is off and the
 *   caller must not read forwarding headers at all.
 * @throws Error when `trustedHops` is not an integer in [1, 64], or when
 *   `trustProxyHeaders: false` is combined with a `trustedHops` value or a
 *   `trustedProxies` list. Those pairings are contradictions, and the first
 *   previously resolved silently in favour of trust — meaning an explicit
 *   opt-out was ignored.
 * @internal
 */
export function resolveForwardedTrust(
  name: string,
  opts: { trustedHops?: number; trustProxyHeaders?: boolean; trustedProxies?: readonly string[] }
): number | undefined {
  const hops = opts.trustedHops;
  const trust = opts.trustProxyHeaders;
  const proxies = opts.trustedProxies;
  if (trust === false && proxies !== undefined) {
    throw new Error(
      `${name}: trustProxyHeaders: false contradicts trustedProxies. ` +
        "trustedProxies implies proxy-header trust; drop whichever one you did not mean."
    );
  }
  if (hops !== undefined) {
    if (!Number.isInteger(hops) || hops < 1 || hops > 64) {
      throw new Error(`${name}: trustedHops must be an integer in [1, 64]; got ${String(hops)}.`);
    }
    if (trust === false) {
      throw new Error(
        `${name}: trustProxyHeaders: false contradicts trustedHops: ${hops}. ` +
          "trustedHops implies proxy-header trust; drop whichever one you did not mean."
      );
    }
    return hops;
  }
  if (proxies !== undefined) return 1;
  return trust === true ? 1 : undefined;
}

/**
 * Validate and compile a middleware's `trustedProxies` CIDR allowlist into
 * matchers usable with {@link resolveForwardedClientIp}. Called once at
 * construction so the per-request cost of peer verification is a handful of
 * byte comparisons, never string parsing.
 *
 * The allowlist answers the question `trustedHops` alone cannot: not "how
 * many proxies are in front of me" but "is the socket actually talking to me
 * one of MY proxies". Without it, any client that can reach the origin
 * directly can claim any `X-Forwarded-For` identity — the victim-IP framing
 * and ban-evasion classes documented on {@link resolveForwardedClientIp}.
 *
 * @param name - Middleware function name used in error messages.
 * @param opts - The middleware's options object; only `trustedProxies` is read.
 * @returns The compiled matchers, or `undefined` when `trustedProxies` is not
 *   declared (no peer verification — the pre-existing posture).
 * @throws Error when the list is empty (a silent "trust nobody" foot-gun) or
 *   any entry is not a valid IP/CIDR. Both are refuse-at-construction
 *   misconfigurations, never request-time surprises.
 * @internal
 */
export function resolveTrustedProxyMatchers(
  name: string,
  opts: { trustedProxies?: readonly string[] }
): IpMatcher[] | undefined {
  const proxies = opts.trustedProxies;
  if (proxies === undefined) return undefined;
  if (!Array.isArray(proxies) || proxies.length === 0) {
    throw new Error(`${name}: trustedProxies must be a non-empty IP/CIDR string array.`);
  }
  return proxies.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`${name}: trustedProxies entries must be non-empty strings.`);
    }
    try {
      return compileCidrMatcher(entry);
    } catch {
      throw new Error(`${name}: trustedProxies — invalid IP/CIDR entry ${JSON.stringify(entry)}.`);
    }
  });
}

/**
 * Test whether the immediate TCP peer of `request` is inside the compiled
 * `trustedProxies` allowlist. Returns `false` when the adapter attached no
 * connection metadata (pure edge delegators expose no peer socket) — peer
 * verification fails closed by design.
 *
 * @param request - Incoming request whose adapter-attached peer is checked.
 * @param trustedPeers - Compiled matchers from {@link resolveTrustedProxyMatchers}.
 * @returns `true` only when a peer address exists and matches the allowlist.
 * @internal
 */
function isTrustedPeer(request: Request, trustedPeers: readonly IpMatcher[]): boolean {
  const peer = getConnInfo(request)?.remoteAddress;
  if (!peer) return false;
  const parsed = parseIp(peer);
  if (!parsed) return false;
  return trustedPeers.some((m) => matchesMatcher(parsed, m));
}

/**
 * Resolve the client IP from the proxy-set forwarding headers, walking a
 * declared number of trusted hops from the RIGHT side of `X-Forwarded-For`.
 *
 * The right side is the spoof-resistant side: each proxy in the chain appends
 * the address of the peer it actually observed, so the last `hops` entries
 * were written by infrastructure you control, while anything further left is
 * attacker-influenceable. Reading the leftmost entry (the historic
 * `split(",")[0]` pattern) trusts the MOST attacker-controllable slot and
 * enabled both rate-limit/ban evasion (rotate a spoofed left entry) and
 * victim-IP framing (spoof a victim's address to get them banned or blocked).
 *
 * Falls back to `X-Real-IP` **only for a single declared hop**. That header
 * carries exactly one hop of information, so it can stand in for a one-proxy
 * declaration (the common nginx `X-Real-IP`-only setup) but cannot possibly
 * satisfy a two-or-more-hop one. With 2+ declared hops and a chain shorter
 * than the declaration, this returns `undefined` rather than guessing.
 *
 * Security note: this resolver is only meaningful when every request reaches
 * the app through a proxy chain you control that appends (or overwrites)
 * these headers. With no proxy in front, any forwarded-header trust is
 * attacker-controlled by definition. `trustedPeers` closes that gap at the
 * framework layer: when supplied, the forwarded identity is honoured only
 * when the immediate TCP peer — the socket actually talking to the adapter,
 * which a remote client cannot spoof — is inside the declared proxy
 * allowlist. A direct-to-origin attacker then gets `undefined` (no
 * identity), so spoofed headers can neither frame a victim nor rotate away
 * strikes. When conn metadata is absent (peer-less edge platforms),
 * verification fails closed.
 *
 * @param request - Incoming request whose forwarding headers are read.
 * @param hops - Number of trusted proxy hops; `1` (default) reads the
 *   rightmost entry — the one your immediate proxy appended.
 * @param trustedPeers - Optional compiled allowlist from
 *   {@link resolveTrustedProxyMatchers}. When supplied, forwarded headers
 *   are honoured only if the immediate peer matches; otherwise `undefined`.
 * @returns The resolved client IP, or `undefined` when no forwarded identity
 *   is available. Callers decide their own posture for `undefined`
 *   (fail-closed 403, fail-open skip, or a shared `"global"` bucket).
 * @since 1.0.0-rc.7
 */
export function resolveForwardedClientIp(
  request: Request,
  hops = 1,
  trustedPeers?: readonly IpMatcher[]
): string | undefined {
  if (trustedPeers !== undefined && !isTrustedPeer(request, trustedPeers)) {
    return undefined;
  }
  const picked = pickForwardedForByHops(request.headers.get("x-forwarded-for"), hops);
  if (picked) return picked;
  // Fail closed past one hop. A chain that produced fewer than `hops` entries
  // means the request never traversed the declared topology — a direct-to-origin
  // request that skipped the CDN, say — so no forwarded value it carries is
  // trustworthy, `X-Real-IP` least of all. Trusting it here would hand back the
  // rotating-identity evasion and victim-IP framing that reading from the right
  // exists to prevent.
  //
  // An attacker inside the chain cannot reach this path: conforming proxies
  // append, so prepending entries only ever lengthens the header. Reaching it
  // requires bypassing the declared chain, and the safe answer there is "no
  // identity", not "the identity the caller asked me to believe".
  if (hops !== 1) return undefined;
  return request.headers.get("x-real-ip") ?? undefined;
}

/**
 * Compiled-CIDR cache for {@link resolveClientIp}'s `{ cidrs }` branch. Keyed
 * by the config array's identity (stable per `App` instance) so the per-
 * request hot path never re-parses strings — one compile per App, then byte
 * comparisons. `App` construction validates via {@link assertBehindProxy}; the
 * request path still fails closed (returns peer, never trusts XFF) if a
 * direct caller of the exported {@link resolveClientIp} passes unvalidated
 * CIDRs and compilation throws.
 */
const behindProxyCidrCache = new WeakMap<readonly string[], IpMatcher[]>();

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
  cfg: BehindProxyConfig | undefined
): string | undefined {
  const conn = getConnInfo(request);
  const peer = conn?.remoteAddress;
  if (cfg === undefined || cfg === "none") return peer;
  if (cfg === "loopback") {
    if (peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1") {
      // The same-host proxy is the single trusted hop, so read the slot IT
      // appended (rightmost), never the attacker-influenceable leftmost one.
      const picked = pickForwardedForByHops(request.headers.get("x-forwarded-for"), 1);
      if (picked) return picked;
    }
    return peer;
  }
  if ("hops" in cfg) {
    const xff = request.headers.get("x-forwarded-for");
    return pickForwardedForByHops(xff, cfg.hops) ?? peer;
  }
  // { cidrs } — honour the forwarded identity only when the immediate peer
  // (the socket a remote client cannot spoof) sits inside one of the declared
  // proxy ranges. A direct-to-origin caller gets their real peer address and
  // their spoofed XFF is ignored: no victim-IP framing, no ban evasion.
  let matchers = behindProxyCidrCache.get(cfg.cidrs);
  if (!matchers) {
    try {
      matchers = cfg.cidrs.map(compileCidrMatcher);
      behindProxyCidrCache.set(cfg.cidrs, matchers);
    } catch {
      // Unvalidated direct call: never trust XFF on a broken allowlist.
      return peer;
    }
  }
  if (peer) {
    const parsed = parseIp(peer);
    if (parsed && matchers.some((m) => matchesMatcher(parsed, m))) {
      const picked = pickForwardedForByHops(request.headers.get("x-forwarded-for"), 1);
      if (picked) return picked;
    }
  }
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
