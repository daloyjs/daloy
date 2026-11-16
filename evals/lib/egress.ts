/**
 * Egress policy for the eval sandbox's allowlisting proxy
 * (`evals/egress-proxy.ts`). The eval container sits on an internal Docker
 * network with no route out; its only way to the internet is this proxy,
 * which tunnels HTTPS (`CONNECT host:443`) to allowlisted host names that
 * resolve to public addresses, and refuses everything else.
 *
 * @module
 */

import { BlockList, isIP } from "node:net";

/** Default allowlist: what GitHub Copilot CLI needs to reach its model API. */
export const DEFAULT_EGRESS_ALLOW = [
  ".githubcopilot.com",
  "api.github.com",
] as const;

/** Extra host for `--mcp docs` (the DaloyJS docs MCP server). */
export const DOCS_MCP_HOST = "daloyjs.dev";

/**
 * Parse an allowlist: comma- or whitespace-separated host names. An entry
 * starting with `.` allows that domain's subdomains (not the bare domain).
 * IP literals and wildcards are rejected: the policy is by name only.
 *
 * @param raw - The list, e.g. `.githubcopilot.com,api.github.com`.
 * @returns Normalised entries.
 * @throws Error on an empty list or an IP, wildcard, or malformed entry.
 */
export function parseAllowlist(raw: string): string[] {
  const entries = raw
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  if (entries.length === 0) throw new Error("egress allowlist is empty");
  for (const e of entries) {
    const host = e.startsWith(".") ? e.slice(1) : e;
    if (isIP(host) !== 0) throw new Error(`egress allowlist takes host names, not IPs: ${e}`);
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host))
      throw new Error(`invalid egress allowlist entry: ${e}`);
  }
  return entries;
}

/**
 * Whether a host name is allowed by the list.
 *
 * @param host - Requested host (any case, optional trailing dot).
 * @param allow - From {@link parseAllowlist}.
 * @returns `true` for an exact match or a subdomain of a `.suffix` entry.
 */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (isIP(h) !== 0) return false;
  return allow.some((e) => (e.startsWith(".") ? h.endsWith(e) && h.length > e.length : h === e));
}

/**
 * Split a `CONNECT` authority (`host:port`, `[v6]:port`).
 *
 * @param authority - The request target.
 * @returns Host and port, or `undefined` when malformed.
 */
export function parseAuthority(authority: string): { host: string; port: number } | undefined {
  const m = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(authority.trim());
  if (!m) return undefined;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return undefined;
  return { host: (m[1] ?? m[2])!, port };
}

const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  NON_PUBLIC.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  NON_PUBLIC.addSubnet(net, prefix, "ipv6");

/**
 * Whether a resolved address is publicly routable. An allowlisted name that
 * resolves to a private, loopback, link-local, or metadata address (DNS
 * rebinding, a hostile resolver) is refused.
 *
 * @param address - IPv4 or IPv6 address.
 * @returns `false` for non-public or unparsable addresses.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4-mapped IPv6 is refused outright. (It is not a BlockList rule: Node
  // matches every plain IPv4 address against `::ffff:0:0/96`.)
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}
