/**
 * Leaf IP/CIDR matching primitives shared by network-identity middleware,
 * `fetchGuard()`, and peer-verified proxy trust.
 *
 * Kept free of imports from other framework modules so security-critical
 * consumers (`conn-info`, `ip-restriction`, `fetch-guard`) can share the
 * matcher without circular dependencies.
 *
 * @internal
 * @since 1.1.0
 */

/** Parsed IP address (shared with `fetchGuard()` and peer trust). */
export interface ParsedIp {
  /** Big-endian address bytes: 4 bytes for IPv4, 16 for IPv6. */
  bytes: Uint8Array;
  /** Address family: `4` for IPv4, `6` for IPv6. */
  family: 4 | 6;
}

/** Compiled CIDR matcher (shared with `fetchGuard()` and peer trust). */
export interface IpMatcher {
  /** Address family the matcher applies to: `4` or `6`. */
  family: 4 | 6;
  /** CIDR prefix length in bits (0-32 for IPv4, 0-128 for IPv6). */
  prefix: number;
  /** Network address bytes with all host bits masked to zero. */
  bytes: Uint8Array;
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
 * Error message prefix stays `ipRestriction():` for historical compatibility
 * with callers that match the string (the matcher was born there).
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
      throw new Error(`ipRestriction(): invalid CIDR prefix in ${JSON.stringify(input)}.`);
    }
    prefix = Number.parseInt(prefixStr, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) {
      throw new Error(`ipRestriction(): invalid CIDR prefix in ${JSON.stringify(input)}.`);
    }
  }
  return { family: parsed.family, prefix, bytes: applyPrefixMask(parsed.bytes, prefix) };
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
    working = working.slice(0, lastColon + 1) + hi.toString(16) + ":" + lo.toString(16);
  }
  const parts = working.split("::");
  if (parts.length > 2) return undefined;
  const headGroups = parts[0] === "" ? [] : parts[0]!.split(":");
  const tailGroups = parts.length === 2 && parts[1] !== "" ? parts[1]!.split(":") : [];
  const explicit = headGroups.length + tailGroups.length;
  if (explicit > 8) return undefined;
  if (parts.length === 1 && explicit !== 8) return undefined;
  const missing = parts.length === 2 ? 8 - explicit : 0;
  const groups = [...headGroups, ...Array.from({ length: missing }, () => "0"), ...tailGroups];
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
