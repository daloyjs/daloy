/**
 * RFC 9110 content negotiation for `Accept`.
 *
 * Used by {@link file://../proxy.ts proxy.ts} to pick `text/html` vs
 * `text/markdown` (acceptmarkdown.com) and to emit a spec-correct 406 when the
 * request cannot be satisfied. Parsing is q-value and specificity aware: do
 * not substring-match `text/markdown`, because that mis-ranks real browser
 * headers and ignores `q=0` rejections.
 *
 * @see https://acceptmarkdown.com/recipes/nextjs
 * @see https://www.rfc-editor.org/rfc/rfc9110#name-proactive-negotiation
 */

/** Representations this site can produce for a page URL. */
export const PAGE_PRODUCES = ["text/html", "text/markdown"] as const;

export type PageMediaType = (typeof PAGE_PRODUCES)[number];

type AcceptEntry = {
  type: string;
  q: number;
  specificity: number;
};

/**
 * Parse an `Accept` header into type/q/specificity entries, preserving client
 * order so equal-q ties break the way RFC 9110 §12.5.1 describes.
 *
 * @param header - Raw `Accept` header, or an empty string.
 * @returns Parsed entries. Invalid q values are clamped to `[0, 1]`.
 */
export function parseAccept(header: string): AcceptEntry[] {
  return header.split(",").flatMap((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }

    const parts = trimmed.split(";").map((part) => part.trim());
    const type = (parts[0] ?? "").toLowerCase();
    if (!type) {
      return [];
    }

    let q = 1;
    for (const param of parts.slice(1)) {
      const eq = param.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const name = param.slice(0, eq).trim();
      const value = param.slice(eq + 1).trim();
      if (name === "q") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          q = Math.max(0, Math.min(1, parsed));
        }
      }
    }

    const specificity = type === "*/*" ? 0 : type.endsWith("/*") ? 1 : 2;
    return [{ type, q, specificity }];
  });
}

function matches(entry: AcceptEntry, candidate: string): boolean {
  if (entry.type === "*/*") {
    return true;
  }
  if (entry.type.endsWith("/*")) {
    return candidate.startsWith(entry.type.slice(0, -1));
  }
  return entry.type === candidate;
}

/**
 * Pick the highest-ranked type from `produces` for this `Accept` header.
 *
 * @param header - Raw `Accept` header, or `null` when the client omitted it.
 * @param produces - Media types this resource can actually emit.
 * @returns The chosen type, the first `produces` entry when `Accept` is
 *   missing, or `null` when every produced type is unmatched or `q=0`.
 */
export function preferredType(
  header: string | null,
  produces: readonly string[] = PAGE_PRODUCES,
): string | null {
  if (!header) {
    return produces[0] ?? null;
  }

  const entries = parseAccept(header);
  if (entries.length === 0) {
    return produces[0] ?? null;
  }

  let bestType: string | null = null;
  let bestQ = -1;
  let bestPosition = Number.POSITIVE_INFINITY;

  for (const candidate of produces) {
    let matched: AcceptEntry | null = null;
    let matchedPosition = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < entries.length; idx += 1) {
      const entry = entries[idx];
      if (entry === undefined || !matches(entry, candidate)) {
        continue;
      }
      if (
        matched === null ||
        entry.specificity > matched.specificity ||
        (entry.specificity === matched.specificity && idx < matchedPosition)
      ) {
        matched = entry;
        matchedPosition = idx;
      }
    }

    if (matched === null || matched.q <= 0) {
      continue;
    }

    if (
      matched.q > bestQ ||
      (matched.q === bestQ && matchedPosition < bestPosition)
    ) {
      bestQ = matched.q;
      bestPosition = matchedPosition;
      bestType = candidate;
    }
  }

  return bestType;
}

/**
 * Append `Accept` (and `Accept-Encoding`, when missing) to a `Vary` header so
 * CDNs cache HTML and Markdown variants separately. Existing tokens are
 * preserved: Next.js already varies on RSC headers, and overwriting those
 * would mix client-navigation responses.
 *
 * @param headers - Mutable response headers.
 */
export function appendVaryAccept(headers: Headers): void {
  const extra = ["Accept", "Accept-Encoding"];
  const existing = headers.get("vary");
  const tokens = existing
    ? existing.split(",").map((token) => token.trim())
    : [];
  const lower = new Set(tokens.map((token) => token.toLowerCase()));

  for (const token of extra) {
    if (!lower.has(token.toLowerCase())) {
      tokens.push(token);
      lower.add(token.toLowerCase());
    }
  }

  headers.set("Vary", tokens.join(", "));
}

/**
 * Paths that are already a non-HTML representation (or an API) and must not be
 * rewritten into the Markdown handler.
 *
 * @param pathname - Request pathname, without origin.
 * @returns `true` when `Accept` negotiation should run for this path.
 */
export function shouldNegotiatePage(pathname: string): boolean {
  if (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/md" ||
    pathname.startsWith("/md/") ||
    pathname === "/docs-md" ||
    pathname.startsWith("/docs-md/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/openapi.json" ||
    pathname.endsWith("/llms.txt") ||
    pathname.endsWith("/opengraph-image") ||
    pathname.endsWith(".webmanifest")
  ) {
    return false;
  }

  return true;
}

/**
 * True when this request is a Next.js RSC / App Router client navigation.
 * Those send `Accept: text/x-component` (and related headers) and must keep
 * going to the HTML tree; negotiating them as Markdown or 406 breaks the UI.
 *
 * @param headers - Incoming request headers.
 */
export function isRscNavigation(headers: Headers): boolean {
  if (headers.has("rsc") || headers.has("next-router-state-tree")) {
    return true;
  }

  const accept = headers.get("accept") ?? "";
  return accept.includes("text/x-component");
}
