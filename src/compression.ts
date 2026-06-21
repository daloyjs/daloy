/**
 * First-party `compression()` middleware with
 * BREACH-aware safe defaults.
 *
 * Built on the web-standard `CompressionStream` API so the same line works
 * on Node, Bun, Deno, Cloudflare Workers, Vercel, and Fastly Compute.
 * The middleware deliberately refuses to expose a configurable compression
 * level — `CompressionStream` uses the runtime's documented default (gzip
 * level 6 on Node / V8); a `level: 9` opt-in is rejected at construction
 * because the bytes-saved-per-CPU-cycle tradeoff turns into a small-vCPU
 * DoS amplifier under sustained load with single-digit-percent bytes-saved
 * gains on typical JSON payloads.
 *
 * BREACH guards (CRIME-style cross-domain compression-oracle defenses) are
 * always-on and not opt-out: the middleware refuses to compress responses
 * that carry `Set-Cookie`, responses on requests that carry an
 * `Authorization` header, responses on requests that carry a
 * recognized session / CSRF cookie, and responses whose content type is
 * already entropy-coded (images, video, audio, archives, fonts, wasm, pdf).
 *
 * @since 0.25.0
 */

import type { Hooks } from "./types.js";

/** Supported response encodings, in default preference order (best → worst ratio). */
export type CompressionEncoding = "br" | "gzip" | "deflate";

/** Options for {@link compression}. */
export interface CompressionOptions {
  /**
   * Minimum response body size (in bytes) eligible for compression.
   *
   * Responses smaller than this threshold are never compressed: gzip /
   * deflate / brotli all add a header + dictionary preamble (typically
   * 10–18 bytes for gzip, 4–8 bytes for brotli) so anything smaller than
   * the typical TCP MSS (~1448 bytes) does not actually save wire bytes
   * after framing overhead.
   *
   * Default `1024`. Must be a finite non-negative integer; values
   * below `0` or above `2 ** 31 - 1` are refused at construction.
   */
  minimumSize?: number;
  /**
   * Allowed encodings, in caller-preferred order. Defaults to
   * `["br", "gzip", "deflate"]` — the middleware will pick the
   * highest-quality encoding the client supports AND the runtime supports
   * (probed lazily on first use). `deflate` is included for legacy
   * intermediaries; if a runtime lacks `CompressionStream` for an
   * encoding, that encoding is silently dropped from the allowlist.
   */
  encodings?: readonly CompressionEncoding[];
  /**
   * Additional MIME-type prefixes (lowercased, checked as a prefix of the
   * response `Content-Type` token before any `;` parameter) that should
   * NOT be compressed. Merged with the always-on built-in deny-list
   * (image/*, video/*, audio/*, application/zip, application/x-7z-*,
   * application/x-gzip, application/x-bzip*, application/x-xz,
   * application/x-zstd, application/wasm, application/pdf, font/*).
   */
  excludeContentTypes?: readonly string[];
  /**
   * Additional request cookie names that, when present, mark the response
   * as security-state-bound and skip compression. Merged with the
   * always-on built-in set (any cookie matching `/session/i`,
   * `/csrf/i`, `/xsrf/i`, any `__Host-` / `__Secure-` cookie).
   *
   * The match is performed on the unparsed cookie name (case-insensitive
   * substring match), so passing `"my-app-auth"` covers
   * `my-app-auth=...`, `my-app-auth.sig=...`, etc.
   */
  authCookieNames?: readonly string[];
  /**
   * Deliberately unsupported. Provided as a `never`-typed trap so the type
   * system flags accidental opt-in. The actual `CompressionStream` never
   * exposes a level knob — passing any value triggers a construction-time
   * refusal.
   *
   * @internal
   */
  compressLevel?: never;
}

/**
 * Internal marker stamped on the hook so a future audit gate can confirm
 * the BREACH-aware middleware is installed (audit-item parity).
 *
 * @since 0.25.0
 */
export const COMPRESSION_HOOK_MARKER: unique symbol = Symbol.for("daloy.compression.hook");

// Lowercased MIME-prefix deny-list. Each entry is matched as a leading
// prefix of the response's resolved content-type token (no parameters).
const ALWAYS_DENY_CONTENT_TYPES: readonly string[] = Object.freeze([
  "image/",
  "video/",
  "audio/",
  "font/",
  "application/zip",
  "application/gzip",
  "application/x-7z",
  "application/x-gzip",
  "application/x-bzip",
  "application/x-xz",
  "application/zstd",
  "application/x-zstd",
  "application/wasm",
  "application/pdf",
  "application/epub+zip",
]);

// Allow lossless override: `image/svg+xml` IS compressible (XML text).
const ALLOW_SUBTYPES: readonly string[] = Object.freeze(["image/svg+xml"]);

// Cookie-name substring tokens that flag a request as security-state-bound.
const ALWAYS_AUTH_COOKIE_TOKENS: readonly string[] = Object.freeze([
  "session",
  "csrf",
  "xsrf",
  "__host-",
  "__secure-",
]);

interface ParsedAccept {
  encoding: CompressionEncoding | "identity" | "*";
  q: number;
}

function parseAcceptEncoding(header: string | null): ParsedAccept[] {
  if (!header) return [];
  const out: ParsedAccept[] = [];
  for (const raw of header.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const [tokenRaw, ...paramsRaw] = part.split(";");
    const token = (tokenRaw ?? "").trim().toLowerCase();
    if (!token) continue;
    let q = 1;
    for (const p of paramsRaw) {
      const m = p.trim().match(/^q=([0-9.]+)$/i);
      if (m) {
        const parsed = Number.parseFloat(m[1]!);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) q = parsed;
      }
    }
    if (token === "br" || token === "gzip" || token === "deflate") {
      out.push({ encoding: token, q });
    } else if (token === "identity") {
      out.push({ encoding: "identity", q });
    } else if (token === "*") {
      out.push({ encoding: "*", q });
    }
  }
  return out;
}

function pickEncoding(
  accept: ParsedAccept[],
  serverPreferred: readonly CompressionEncoding[],
  runtimeSupported: ReadonlySet<CompressionEncoding>
): CompressionEncoding | null {
  if (accept.length === 0) return null;
  // Reject if `identity;q=0` AND no positive coded entries OR `*;q=0`.
  // Per RFC 9110 §12.5.3, if the server cannot satisfy, it should send 406
  // — we instead choose to skip compression (return null) which serves
  // `identity` and lets upstream content-negotiation logic make any
  // 406-vs-200 call.
  // Build a map of encoding → highest q value the client expressed.
  const explicit = new Map<string, number>();
  let starQ: number | undefined;
  for (const a of accept) {
    if (a.encoding === "*") {
      starQ = a.q;
    } else {
      const prev = explicit.get(a.encoding);
      if (prev === undefined || a.q > prev) explicit.set(a.encoding, a.q);
    }
  }
  for (const enc of serverPreferred) {
    if (!runtimeSupported.has(enc)) continue;
    const q = explicit.get(enc) ?? starQ;
    if (q !== undefined && q > 0) return enc;
  }
  return null;
}

let cachedRuntimeSupport: Set<CompressionEncoding> | null = null;

function detectRuntimeSupport(): Set<CompressionEncoding> {
  if (cachedRuntimeSupport) return cachedRuntimeSupport;
  const Stream = (
    globalThis as unknown as {
      CompressionStream?: new (format: string) => unknown;
    }
  ).CompressionStream;
  const supported = new Set<CompressionEncoding>();
  if (!Stream) {
    cachedRuntimeSupport = supported;
    return supported;
  }
  for (const enc of ["br", "gzip", "deflate"] as const) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = new Stream(enc);
      supported.add(enc);
    } catch {
      // not supported on this runtime
    }
  }
  cachedRuntimeSupport = supported;
  return supported;
}

/**
 * @internal Reset cached runtime probe. Test-only.
 * @since 0.25.0
 */
export function _resetCompressionRuntimeProbeForTests(): void {
  cachedRuntimeSupport = null;
}

function isExcludedContentType(contentType: string | null, extraDeny: readonly string[]): boolean {
  if (!contentType) return false;
  const token = contentType.split(";")[0]!.trim().toLowerCase();
  if (!token) return false;
  for (const allow of ALLOW_SUBTYPES) {
    if (token === allow) return false;
  }
  for (const deny of ALWAYS_DENY_CONTENT_TYPES) {
    if (token.startsWith(deny)) return true;
  }
  for (const deny of extraDeny) {
    if (token.startsWith(deny)) return true;
  }
  return false;
}

function requestCarriesAuthCookie(cookieHeader: string | null, extra: readonly string[]): boolean {
  if (!cookieHeader) return false;
  const lower = cookieHeader.toLowerCase();
  for (const tok of ALWAYS_AUTH_COOKIE_TOKENS) {
    if (lower.includes(tok)) return true;
  }
  for (const tok of extra) {
    if (lower.includes(tok.toLowerCase())) return true;
  }
  return false;
}

function appendVaryAcceptEncoding(headers: Headers): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", "Accept-Encoding");
    return;
  }
  const parts = existing
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const p of parts) {
    if (p === "*") return;
    if (p.toLowerCase() === "accept-encoding") return;
  }
  headers.set("vary", `${existing}, Accept-Encoding`);
}

function normalizeOptionTokens(
  values: readonly string[] | undefined,
  optionName: string
): readonly string[] {
  if (!values) return Object.freeze([]);
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      throw new TypeError(`compression(): \`${optionName}\` entries must be non-empty strings.`);
    }
    const token = value.trim().toLowerCase();
    if (!token) {
      throw new TypeError(`compression(): \`${optionName}\` entries must be non-empty strings.`);
    }
    normalized.push(token);
  }
  return Object.freeze(normalized);
}

async function compressBytes(
  bytes: Uint8Array,
  encoding: CompressionEncoding
): Promise<Uint8Array> {
  const Stream = (
    globalThis as unknown as {
      CompressionStream: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).CompressionStream;
  const cs = new Stream(encoding);
  const writer = cs.writable.getWriter();
  // Intentionally do not `await writer.write(...)` separately from
  // close — the stream queues the chunk synchronously and we want both
  // operations to settle together for predictable backpressure on the
  // tiny in-memory body we hand it.
  void writer.write(bytes as Uint8Array);
  const closePromise = writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await closePromise;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * BREACH-aware response compression middleware.
 *
 * Picks `br` > `gzip` > `deflate` based on the client's `Accept-Encoding`
 * header AND the runtime's `CompressionStream` support (probed once,
 * cached). Skips compression when ANY of the following are true:
 *
 * - request method is not `GET` / `HEAD` (compressing responses on
 *   state-changing requests offers no caching win and trips BREACH
 *   oracles more easily);
 * - request carried an `Authorization` header (auth-bound bodies);
 * - request carried a recognized session / CSRF / `__Host-` /
 *   `__Secure-` cookie (auth-bound bodies);
 * - response status is not `2xx`;
 * - response already declares a `Content-Encoding`;
 * - response declares a `Set-Cookie` (response is mutating auth state);
 * - response body byte length is below `minimumSize` (default `1024`);
 * - response `Content-Type` is in the always-on already-compressed
 *   deny-list (image/video/audio/archives/fonts/wasm/pdf, with
 *   `image/svg+xml` carved back in as compressible XML).
 *
 * When skipping, the middleware still appends `Vary: Accept-Encoding`
 * to the response so cache keys remain content-negotiation-correct.
 *
 * @example
 * ```ts
 * import { App, compression } from "@daloyjs/core";
 *
 * const app = new App();
 * app.use(compression());
 * ```
 *
 * @since 0.25.0
 */
export function compression(opts: CompressionOptions = {}): Hooks {
  if (Object.prototype.hasOwnProperty.call(opts, "compressLevel")) {
    throw new TypeError(
      "compression(): `compressLevel` is not configurable. CompressionStream uses the runtime default (typically 6); higher levels are a CPU-DoS amplifier with single-digit-percent bytes-saved gains."
    );
  }
  const minimumSize = opts.minimumSize === undefined ? 1024 : opts.minimumSize;
  if (
    !Number.isFinite(minimumSize) ||
    !Number.isInteger(minimumSize) ||
    minimumSize < 0 ||
    minimumSize > 2 ** 31 - 1
  ) {
    throw new TypeError("compression(): `minimumSize` must be a finite non-negative integer.");
  }
  const serverPreferred: readonly CompressionEncoding[] =
    opts.encodings && opts.encodings.length > 0
      ? Object.freeze([...opts.encodings])
      : Object.freeze(["br", "gzip", "deflate"] as const);
  // Validate the encodings list.
  for (const enc of serverPreferred) {
    if (enc !== "br" && enc !== "gzip" && enc !== "deflate") {
      throw new TypeError(
        `compression(): unknown encoding ${JSON.stringify(enc)} — supported: br, gzip, deflate.`
      );
    }
  }
  const extraDeny = normalizeOptionTokens(opts.excludeContentTypes, "excludeContentTypes");
  const extraAuthCookies = normalizeOptionTokens(opts.authCookieNames, "authCookieNames");

  const hooks: Hooks & { [COMPRESSION_HOOK_MARKER]?: true } = {
    async onSend(res, ctx) {
      const req = ctx?.request;
      if (!req) return undefined;
      appendVaryAcceptEncoding(res.headers);
      const method = req.method;
      if (method !== "GET" && method !== "HEAD") return undefined;
      if (res.status < 200 || res.status >= 300) return undefined;
      if (res.headers.has("content-encoding")) return undefined;
      if (res.headers.has("set-cookie")) return undefined;
      if (req.headers.has("authorization")) return undefined;
      if (requestCarriesAuthCookie(req.headers.get("cookie"), extraAuthCookies)) {
        return undefined;
      }
      if (isExcludedContentType(res.headers.get("content-type"), extraDeny)) {
        return undefined;
      }

      const runtimeSupported = detectRuntimeSupport();
      if (runtimeSupported.size === 0) return undefined;
      const accept = parseAcceptEncoding(req.headers.get("accept-encoding"));
      const chosen = pickEncoding(accept, serverPreferred, runtimeSupported);
      if (!chosen) return undefined;

      const original = new Uint8Array(await res.clone().arrayBuffer());
      if (original.byteLength < minimumSize) return undefined;
      const compressed = await compressBytes(original, chosen);
      if (compressed.byteLength >= original.byteLength) {
        // Negative-compression-ratio guard: if the compressor produced a
        // larger payload (very small / high-entropy bodies that slipped past
        // the minimumSize check) skip rather than ship more bytes.
        return undefined;
      }
      const headers = new Headers(res.headers);
      headers.set("content-encoding", chosen);
      headers.set("content-length", String(compressed.byteLength));
      // Strong ETag computed upstream over the uncompressed body is now
      // inconsistent with the wire bytes — downgrade to weak per RFC 9110.
      const existingEtag = headers.get("etag");
      if (existingEtag && !existingEtag.startsWith("W/")) {
        headers.set("etag", `W/${existingEtag}`);
      }
      const responseBody: BodyInit | null = method === "HEAD" ? null : (compressed as BodyInit);
      return new Response(responseBody, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    },
  };
  hooks[COMPRESSION_HOOK_MARKER] = true;
  return hooks;
}
