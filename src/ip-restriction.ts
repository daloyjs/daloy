/**
 * Network-layer access control for {@link Hooks}. The {@link ipRestriction}
 * middleware enforces IPv4 / IPv6 / CIDR allow- and deny-lists. Because the
 * Web-standard {@link Request} does not expose a peer address, callers must
 * either provide a trusted resolver or explicitly opt in to trusted proxy
 * headers.
 *
 * @since 0.19.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError } from "./errors.js";

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
  resolveIp?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Read `X-Forwarded-For` / `X-Real-IP` in the default resolver. Defaults
   * to `false` because those headers are client-spoofable unless every
   * request reaches Daloy through a proxy chain you control. Pair with
   * `new App({ trustProxy: true })` in production.
   */
  trustProxyHeaders?: boolean;
  /**
   * Response message when a request is rejected. Defaults to
   * `"IP address not permitted"`. Avoid echoing the client IP back —
   * doing so can leak proxy topology to attackers.
   */
  message?: string;
}

/** @internal Parsed IP address (shared with `fetchGuard()`). */
export interface ParsedIp {
  /** Big-endian address bytes: 4 bytes for IPv4, 16 for IPv6. */
  bytes: Uint8Array;
  /** Address family: `4` for IPv4, `6` for IPv6. */
  family: 4 | 6;
}

/** @internal Compiled CIDR matcher (shared with `fetchGuard()`). */
export interface IpMatcher {
  /** Address family the matcher applies to: `4` or `6`. */
  family: 4 | 6;
  /** CIDR prefix length in bits (0-32 for IPv4, 0-128 for IPv6). */
  prefix: number;
  /** Network address bytes with all host bits masked to zero. */
  bytes: Uint8Array;
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
 * @returns A {@link Hooks} object whose `beforeHandle` enforces the lists,
 *   failing closed (403) when the client IP cannot be resolved or parsed.
 * @throws Error at setup time when neither `allow` nor `deny` is provided,
 *   or when a pattern is not a valid IP/CIDR.
 * @since 0.19.0
 */
export function ipRestriction(opts: IpRestrictionOptions): Hooks {
  if (!opts.allow?.length && !opts.deny?.length) {
    throw new Error(
      'ipRestriction(): at least one of "allow" or "deny" must be provided.',
    );
  }
  const allow = (opts.allow ?? []).map(compileCidrMatcher);
  const deny = (opts.deny ?? []).map(compileCidrMatcher);
  const resolveIp = opts.resolveIp ??
    (opts.trustProxyHeaders ? forwardedIpResolver : noIpResolver);
  const message = opts.message ?? "IP address not permitted";
  return {
    beforeHandle(ctx) {
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

function forwardedIpResolver(ctx: BaseContext<any, any>): string | undefined {
  const headers = ctx.request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return headers.get("x-real-ip") ?? undefined;
}

/**
 * Test whether a parsed IP falls inside a compiled CIDR matcher, comparing
 * only the matcher's prefix bits. IPv4-mapped IPv6 addresses
 * (`::ffff:a.b.c.d`) are normalized so they match IPv4 matchers.
 *
 * @param ip Parsed client address from {@link parseIp}.
 * @param m Compiled matcher from {@link compileCidrMatcher}.
 * @returns `true` when the address is within the matcher's range.
 * @internal
 */
export function matchesMatcher(ip: ParsedIp, m: IpMatcher): boolean {
  const candidate = normalizeFamily(ip, m.family);
  if (!candidate) return false;
  const expected = m.bytes;
  const totalBits = candidate.length * 8;
  const prefix = Math.min(m.prefix, totalBits);
  const fullBytes = prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (candidate[i] !== expected[i]) return false;
  }
  const remaining = prefix - fullBytes * 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return ((candidate[fullBytes]! ^ expected[fullBytes]!) & mask) === 0;
}

/**
 * Compile an IP or CIDR pattern (e.g. `"10.0.0.0/8"`, `"::1"`) into an
 * {@link IpMatcher}. A bare address gets a full-length prefix (/32 or /128);
 * host bits beyond the prefix are masked to zero.
 *
 * @param input IPv4/IPv6 address, optionally with a `/prefix` suffix.
 * @returns The compiled matcher used by {@link matchesMatcher}.
 * @throws Error when the address or CIDR prefix is invalid.
 * @internal
 */
export function compileCidrMatcher(input: string): IpMatcher {
  let addr = input;
  let prefixStr: string | undefined;
  if (input.includes("/")) {
    const slash = input.indexOf("/");
    addr = input.slice(0, slash);
    prefixStr = input.slice(slash + 1);
  }
  const parsed = parseIp(addr);
  if (!parsed) {
    throw new Error(`ipRestriction(): invalid IP address ${JSON.stringify(input)}.`);
  }
  const totalBits = parsed.family === 4 ? 32 : 128;
  let prefix = totalBits;
  if (prefixStr !== undefined) {
    if (!/^\d+$/.test(prefixStr)) {
      throw new Error(
        `ipRestriction(): invalid CIDR prefix in ${JSON.stringify(input)}.`,
      );
    }
    prefix = Number.parseInt(prefixStr, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) {
      throw new Error(
        `ipRestriction(): invalid CIDR prefix in ${JSON.stringify(input)}.`,
      );
    }
  }
  return { family: parsed.family, prefix, bytes: applyPrefixMask(parsed.bytes, prefix) };
}

function normalizeFamily(ip: ParsedIp, family: 4 | 6): Uint8Array | undefined {
  if (ip.family === family) return ip.bytes;
  if (ip.family === 6 && family === 4) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — accept as IPv4.
    const b = ip.bytes;
    const isMapped = b.slice(0, 10).every((x) => x === 0) && b[10]! === 0xff && b[11]! === 0xff;
    if (isMapped) return b.slice(12);
    return undefined;
  }
  return undefined;
}

function applyPrefixMask(bytes: Uint8Array, prefix: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const fullBytes = prefix >> 3;
  const remaining = prefix - fullBytes * 8;
  if (remaining > 0 && fullBytes < out.length) {
    const mask = 0xff << (8 - remaining);
    out[fullBytes] = out[fullBytes]! & mask;
  }
  for (let i = fullBytes + (remaining > 0 ? 1 : 0); i < out.length; i++) {
    out[i] = 0;
  }
  return out;
}

/**
 * Parse an IPv4 or IPv6 address string into raw bytes. Supports IPv6 `::`
 * compression and IPv4-mapped tails (`::ffff:1.2.3.4`).
 *
 * @param input Address string; surrounding whitespace is trimmed.
 * @returns The parsed address, or `undefined` when the input is not a valid
 *   IP (callers treat unparseable addresses as a rejection, failing closed).
 * @internal
 */
export function parseIp(input: string): ParsedIp | undefined {
  const trimmed = input.trim();
  if (trimmed.includes(":")) return parseIPv6(trimmed);
  return parseIPv4(trimmed);
}

function parseIPv4(input: string): ParsedIp | undefined {
  const parts = input.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return undefined;
    bytes[i] = n;
  }
  return { bytes, family: 4 };
}

function parseIPv6(input: string): ParsedIp | undefined {
  // Support IPv4-mapped tail (::ffff:1.2.3.4).
  let working = input;
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(working.slice(lastColon + 1));
    if (!v4) return undefined;
    const hi = (v4.bytes[0]! << 8) | v4.bytes[1]!;
    const lo = (v4.bytes[2]! << 8) | v4.bytes[3]!;
    working =
      working.slice(0, lastColon + 1) +
      hi.toString(16) +
      ":" +
      lo.toString(16);
  }
  const parts = working.split("::");
  if (parts.length > 2) return undefined;
  const headGroups = parts[0] === "" ? [] : parts[0]!.split(":");
  const tailGroups = parts.length === 2 && parts[1] !== "" ? parts[1]!.split(":") : [];
  const explicit = headGroups.length + tailGroups.length;
  if (explicit > 8) return undefined;
  if (parts.length === 1 && explicit !== 8) return undefined;
  const missing = parts.length === 2 ? 8 - explicit : 0;
  const groups = [
    ...headGroups,
    ...Array.from({ length: missing }, () => "0"),
    ...tailGroups,
  ];
  if (groups.length !== 8) return undefined;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index++) {
    const group = groups[index]!;
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    const n = Number.parseInt(group, 16);
    bytes[index * 2] = (n >> 8) & 0xff;
    bytes[index * 2 + 1] = n & 0xff;
  }
  return { bytes, family: 6 };
}
