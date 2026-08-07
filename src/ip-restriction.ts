/**
 * Network-layer access control for {@link Hooks}. The {@link ipRestriction}
 * middleware enforces IPv4 / IPv6 / CIDR allow- and deny-lists. Because the
 * Web-standard {@link Request} does not expose a peer address, callers must
 * either provide a trusted resolver or explicitly opt in to trusted proxy
 * headers.
 *
 * @since 0.19.0
 */

import type { BaseContext, Hooks, IdentityGateContext } from "./types.js";
import { ForbiddenError } from "./errors.js";
import {
  resolveForwardedClientIp,
  resolveForwardedTrust,
  resolveTrustedProxyMatchers,
} from "./conn-info.js";
// Matcher primitives live in a leaf module so `conn-info` can peer-verify
// without importing this file (which would form a cycle through trust helpers).
import { compileCidrMatcher, matchesMatcher, parseIp, type IpMatcher } from "./ip-match.js";

export type { IpMatcher, ParsedIp } from "./ip-match.js";
export { compileCidrMatcher, matchesMatcher, parseIp } from "./ip-match.js";

/**
 * Options for {@link ipRestriction}. At least one of `allow` or `deny` must
 * be provided; supplying both runs deny-first then allow-otherwise (deny
 * wins on conflict, matching the principle of least privilege).
 *
 * @since 0.19.0
 */
export interface IpRestrictionOptions {
  /**
   * IP addresses or CIDR ranges (e.g. `"10.0.0.0/8"`, `"2001:db8::/32"`,
   * `"203.0.113.42"`) that should be allowed. When set, any peer whose
   * address does not match a pattern in this list is rejected with HTTP
   * `403 Forbidden`. Mutually exclusive with running without any list.
   */
  allow?: readonly string[];
  /**
   * IP addresses or CIDR ranges that should be rejected outright. Matches
   * here always lose to nothing — even an explicit allow-list entry will
   * not override a deny. Useful for blocking known bad ranges while
   * keeping a broad allow-list.
   */
  deny?: readonly string[];
  /**
   * Override the source of the client IP. By default Daloy fails closed
   * because Web-standard `Request` objects do not expose the peer address.
   * Provide a function to read adapter connection metadata or a trusted
   * custom header (e.g. a CDN-specific identifier).
   */
  resolveIp?: (ctx: IdentityGateContext) => string | undefined;
  /**
   * Read `X-Forwarded-For` / `X-Real-IP` in the default resolver. Defaults
   * to `false` because those headers are client-spoofable unless every
   * request reaches Daloy through a proxy chain you control. Pair with
   * `new App({ trustProxy: true })` in production.
   *
   * When enabled, the resolver reads the **rightmost** `X-Forwarded-For`
   * entry — the one your immediate proxy appended — never the
   * attacker-influenceable leftmost one, so a spoofed left entry cannot
   * bypass an allow-list or dodge a deny. Behind more than one proxy hop,
   * set {@link trustedHops} instead.
   */
  trustProxyHeaders?: boolean;
  /**
   * Declare exactly how many proxy hops sit between Daloy and the public
   * internet. Implies proxy-header trust and reads the client IP that many
   * entries from the right of `X-Forwarded-For` via
   * {@link "./conn-info.js".resolveForwardedClientIp}. Must be an integer in
   * [1, 64]; validated at construction.
   */
  trustedHops?: number;
  /**
   * Declare WHICH proxies are yours: an IP/CIDR allowlist for the immediate
   * peer's address. Forwarded headers are honoured only when the TCP socket
   * actually talking to the adapter matches the list, so a direct-to-origin
   * attacker cannot spoof an allow-listed IP or dodge a deny entry. Implies
   * proxy-header trust at one hop unless {@link trustedHops} says otherwise;
   * validated and compiled at construction. On peer-less edge platforms
   * verification fails closed (the request is rejected, since no trustworthy
   * IP remains).
   */
  trustedProxies?: readonly string[];
  /**
   * Response message when a request is rejected. Defaults to
   * `"IP address not permitted"`. Avoid echoing the client IP back —
   * doing so can leak proxy topology to attackers.
   */
  message?: string;
}

/**
 * Block or allow requests by source IP / CIDR range. In direct Web-standard
 * runtimes, pass `resolveIp` from the adapter-specific connection metadata.
 * Behind a trusted proxy chain, set `trustProxyHeaders: true` to read
 * `X-Forwarded-For` / `X-Real-IP`.
 *
 * @example
 * ```ts
 * app.use(ipRestriction({
 *   allow: ["10.0.0.0/8", "::1"],
 *   deny: ["10.6.6.0/24"],
 *   trustProxyHeaders: true,
 * }));
 * ```
 *
 * On reject the middleware throws a {@link ForbiddenError}, which Daloy
 * renders as RFC 9457 `application/problem+json`.
 *
 * @param opts Allow/deny lists plus IP-resolution options; see
 *   {@link IpRestrictionOptions}. Deny matches always win over allow.
 * @returns A {@link Hooks} object whose `preBody` hook enforces the lists,
 *   failing closed (403) when the client IP cannot be resolved or parsed.
 * @throws Error at setup time when neither `allow` nor `deny` is provided,
 *   or when a pattern is not a valid IP/CIDR.
 * @since 0.19.0
 */
export function ipRestriction(opts: IpRestrictionOptions): Hooks {
  if (!opts.allow?.length && !opts.deny?.length) {
    throw new Error('ipRestriction(): at least one of "allow" or "deny" must be provided.');
  }
  const allow = (opts.allow ?? []).map(compileCidrMatcher);
  const deny = (opts.deny ?? []).map(compileCidrMatcher);
  const hops = resolveForwardedTrust("ipRestriction()", opts);
  const proxyMatchers = resolveTrustedProxyMatchers("ipRestriction()", opts);
  const resolveIp =
    opts.resolveIp ??
    (hops !== undefined ? forwardedIpResolver(hops, proxyMatchers) : noIpResolver);
  const message = opts.message ?? "IP address not permitted";
  return {
    // `preBody`, not `beforeHandle`: a gate that returns a Response from
    // `beforeHandle` can be preempted by any earlier `beforeHandle` middleware
    // that short-circuits first — a `responseCache()` HIT mounted above it would
    // serve a deny-listed address the cached body. `preBody` always runs first,
    // so the allow/deny lists hold regardless of mount order.
    preBody(ctx) {
      const raw = resolveIp(ctx);
      if (!raw) throw new ForbiddenError(message);
      const parsed = parseIp(raw);
      if (!parsed) throw new ForbiddenError(message);
      if (deny.some((m) => matchesMatcher(parsed, m))) {
        throw new ForbiddenError(message);
      }
      if (allow.length > 0 && !allow.some((m) => matchesMatcher(parsed, m))) {
        throw new ForbiddenError(message);
      }
    },
  };
}

function noIpResolver(_ctx: BaseContext<any, any>): string | undefined {
  return undefined;
}

function forwardedIpResolver(hops: number, trustedPeers?: readonly IpMatcher[]) {
  return (ctx: BaseContext<any, any>): string | undefined =>
    resolveForwardedClientIp(ctx.request, hops, trustedPeers);
}
