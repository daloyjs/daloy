/**
 * Shared DNS-rebinding defense for the agent-protocol endpoints (`mcp.ts` and
 * `a2a.ts`). Internal module: not part of the published `exports` map.
 *
 * @internal
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Normalize and validate an `allowedOrigins` option into a lookup set.
 *
 * Every entry must be a bare origin (`scheme://host[:port]`, no path, query,
 * or trailing slash) or the literal `"null"` for opaque origins. Entries are
 * lowercased so the per-request check is a plain `Set` lookup.
 *
 * @param entries - Raw allowlist entries from handler options.
 * @param label - Protocol label used in the error message, e.g. `"MCP"`.
 * @returns The normalized allowlist.
 * @throws {TypeError} When an entry is not a bare origin.
 * @internal
 */
export function compileOriginAllowlist(
  entries: readonly string[] | undefined,
  label: string
): ReadonlySet<string> {
  const allowlist = new Set<string>();
  for (const entry of entries ?? []) {
    const normalized = entry.toLowerCase();
    if (normalized === "null") {
      allowlist.add(normalized);
      continue;
    }
    let parsed: URL | undefined;
    try {
      parsed = new URL(normalized);
    } catch {
      parsed = undefined;
    }
    if (!parsed || parsed.origin !== normalized) {
      throw new TypeError(
        `${label} allowedOrigins entry "${entry}" must be a bare origin such as "https://app.example.com".`
      );
    }
    allowlist.add(normalized);
  }
  return allowlist;
}

/**
 * Decide whether a browser `Origin` may talk to an agent-protocol endpoint.
 *
 * Loopback origins (`localhost` / `127.0.0.1` / `[::1]` / `*.localhost`) are
 * allowed for local development. Every non-loopback origin must appear in
 * the allowlist. `Origin.host === Host` is deliberately **not** treated as
 * sufficient: under DNS rebinding both can be the attacker hostname resolving
 * to the target IP, which would silently bypass an implicit same-origin check.
 *
 * @param origin - Raw `Origin` request header value.
 * @param allowlist - Set produced by {@link compileOriginAllowlist}.
 * @returns `true` when the origin is allowed.
 * @internal
 */
export function isAllowedAgentOrigin(origin: string, allowlist: ReadonlySet<string>): boolean {
  const normalized = origin.toLowerCase();
  if (allowlist.has(normalized)) return true;
  if (normalized === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  const hostname = parsed.hostname;
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}
