/**
 * Request-target checks shared by the runtime adapters.
 *
 * The router matches a raw slice of `request.url` while security middleware
 * (`except()`, tenancy, WAF) reads `new URL(request.url).pathname`. Every
 * adapter must therefore hand the App a URL on which the two agree: a plain
 * `host[:port]` authority and a path WHATWG parsing would not rewrite.
 * @internal
 */

/**
 * `true` when `host` is a non-empty `reg-name|IPv4|[IPv6][:port]` with no path, query, userinfo or escape characters.
 * @internal
 */
export function isPlainAuthority(host: string): boolean {
  const len = host.length;
  if (len === 0 || len > 1024) return false;
  for (let i = 0; i < len; i++) {
    const c = host.charCodeAt(i);
    if (
      (c >= 97 && c <= 122) || // a-z
      (c >= 65 && c <= 90) || // A-Z
      (c >= 48 && c <= 58) || // 0-9 and ':'
      c === 46 || // .
      c === 45 || // -
      c === 95 // _
    ) {
      continue;
    }
    // Brackets only as a leading IPv6 literal: `[` at 0 and one `]` after it.
    if (c === 91 /* [ */ && i === 0) continue;
    if (c === 93 /* ] */ && host.charCodeAt(0) === 91 && host.indexOf("]", i + 1) === -1) continue;
    return false;
  }
  return true;
}

/**
 * `true` when WHATWG URL parsing would rewrite the path portion of an
 * origin-form request-target: `\` (folded to `/`), `.`/`..` segments and
 * their `%2e` spellings (resolved), or bytes in the path percent-encode set.
 * One charCode pass that stops at `?`/`#`; ordinary targets never allocate.
 * @internal
 */
export function pathNeedsCanonicalization(target: string): boolean {
  const len = target.length;
  for (let i = 0; i < len; i++) {
    const c = target.charCodeAt(i);
    if (c === 63 /* ? */ || c === 35 /* # */) return false;
    if (
      c <= 32 ||
      c >= 127 ||
      c === 92 /* \ */ ||
      c === 34 /* " */ ||
      c === 60 /* < */ ||
      c === 62 /* > */ ||
      c === 96 /* ` */ ||
      c === 123 /* { */ ||
      c === 125 /* } */
    ) {
      return true;
    }
    if (c === 37 /* % */) {
      if (target.charCodeAt(i + 1) === 50 && (target.charCodeAt(i + 2) | 0x20) === 101) return true;
    } else if (c === 46 /* . */ && target.charCodeAt(i - 1) === 47 /* / */) {
      const n = target.charCodeAt(i + 1);
      if (n !== n /* end */ || n === 47 || n === 46 || n === 63 || n === 35) return true;
    }
  }
  return false;
}

/**
 * Make a web-standard `Request` safe to dispatch: refuse an authority that is
 * not a plain `host[:port]` (userinfo, `\\`, escapes), and rebuild the request
 * on the WHATWG-serialized URL when its path would be rewritten by parsing
 * (`\\`, dot segments, `%2e`). Ordinary requests are returned as-is with no
 * allocation.
 *
 * @param req - Request as produced by the runtime.
 * @returns The request to dispatch, or `undefined` when it must be answered
 *   with `400 Bad Request` (not an absolute URL, or an unsafe authority).
 * @internal
 */
export function canonicalWebRequest(req: Request): Request | undefined {
  const url = req.url;
  const scheme = url.indexOf("://");
  if (scheme === -1) return undefined;
  const slash = url.indexOf("/", scheme + 3);
  const authority = slash === -1 ? url.slice(scheme + 3) : url.slice(scheme + 3, slash);
  if (!isPlainAuthority(authority)) return undefined;
  if (slash === -1 || !pathNeedsCanonicalization(url.slice(slash))) return req;
  let canonical: string;
  try {
    canonical = new URL(url).href;
  } catch {
    return undefined;
  }
  return new Request(canonical, req);
}

/**
 * The `400 Bad Request` problem+json an adapter returns for a request
 * {@link canonicalWebRequest} refused. Carries no request-derived text.
 * @internal
 */
export function badRequestTargetResponse(): Response {
  return new Response(
    '{"type":"about:blank","title":"Bad Request","status":400,"detail":"Invalid Host header or request target."}',
    {
      status: 400,
      headers: {
        "content-type": "application/problem+json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
