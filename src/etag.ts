/**
 * First-party `etag()` helper with strong-validation default.
 *
 * Automatically computes a SHA-1 strong ETag for successful `GET` / `HEAD`
 * responses, responds `304 Not Modified` on a matching `If-None-Match`, and
 * — critical for tenant-isolated APIs — skips entirely when the response
 * carries a `Set-Cookie` header OR a `Cache-Control` directive of
 * `private` / `no-store` / `no-cache`. Cross-tenant fingerprinting via
 * cached ETag values is the documented attack class this defense addresses;
 * the skip behavior is on by default and not configurable.
 *
 * @since 0.21.0
 */

import type { Hooks } from "./types.js";

/** Options for {@link etag}. */
export interface ETagOptions {
  /**
   * Emit a weak ETag (`W/"..."`). Default `false` — strong ETags allow
   * range-request resumption and prevent byte-level cache poisoning by
   * intermediaries.
   */
  weak?: boolean;
  /**
   * Override the digest function. Default: SHA-1 via WebCrypto. SHA-1 is
   * appropriate here because the ETag is a cache identifier, not a security
   * boundary; collisions only cause a stale `304`, never a confidentiality
   * break.
   */
  generator?: (body: Uint8Array) => string | Promise<string>;
  /**
   * Largest body, in bytes, that is buffered to compute a tag. Bodies whose
   * `Content-Length` exceeds this are sent untagged instead of buffered.
   * Default `1_048_576` (1 MiB). Must be a non-negative finite number.
   * @since 1.3.7
   */
  maxBytes?: number;
}

/** Default {@link ETagOptions.maxBytes}: 1 MiB. */
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * True when the response is a stream that must not be buffered: an SSE /
 * NDJSON content type, or a non-null body with no (valid) `Content-Length`
 * (unknown length — a long-lived or unbounded stream), or one larger than
 * `maxBytes`. Buffering such a body would stall delivery and pin memory.
 */
function shouldSkipForBody(res: Response, maxBytes: number): boolean {
  const ct = res.headers.get("content-type");
  if (ct !== null) {
    const mime = ct.split(";", 1)[0]!.trim().toLowerCase();
    if (mime === "text/event-stream" || mime === "application/x-ndjson") return true;
  }
  if (res.body === null) return false;
  const cl = res.headers.get("content-length");
  if (cl === null || !/^\d+$/.test(cl)) return true;
  return Number(cl) > maxBytes;
}

const CACHE_SKIP_DIRECTIVES = new Set(["private", "no-store", "no-cache"]);

function shouldSkipForCache(res: Response): boolean {
  if (res.headers.has("set-cookie")) return true;
  const cc = res.headers.get("cache-control");
  if (!cc) return false;
  for (const part of cc.split(",")) {
    const token = part.trim().toLowerCase().split("=")[0]!;
    if (CACHE_SKIP_DIRECTIVES.has(token)) return true;
  }
  return false;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error("etag(): WebCrypto SubtleCrypto API is unavailable on this runtime.");
  }
  const digest = new Uint8Array(await c.subtle.digest("SHA-1", bytes as BufferSource));
  let out = "";
  for (let i = 0; i < digest.length; i++) out += digest[i]!.toString(16).padStart(2, "0");
  return out;
}

function inmMatches(headerValue: string, candidate: string): boolean {
  // RFC 7232 §3.2: comma-separated list of entity tags or `*`.
  const list = headerValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (list.length === 0) return false;
  for (const tag of list) {
    if (tag === "*") return true;
    // Strong comparison: tag and candidate must be byte-equal AND neither weak.
    if (tag === candidate) {
      if (!tag.startsWith("W/") && !candidate.startsWith("W/")) return true;
    }
    // Weak comparison fallback for HEAD/GET on cached representations.
    const tStripped = tag.startsWith("W/") ? tag.slice(2) : tag;
    const cStripped = candidate.startsWith("W/") ? candidate.slice(2) : candidate;
    if (tStripped === cStripped) return true;
  }
  return false;
}

/**
 * ETag generation + conditional-GET handler.
 *
 * - Skips when the response already carries an `ETag`.
 * - Skips when the response carries `Set-Cookie` OR `Cache-Control: private | no-store | no-cache`.
 * - Skips non-`2xx` responses and methods other than `GET` / `HEAD`.
 * - Never buffers streams: skips `text/event-stream` / `application/x-ndjson`
 *   responses, bodies of unknown length (no `Content-Length`), and bodies
 *   larger than `maxBytes` (default 1 MiB). Those responses pass through untagged.
 * - Emits `304 Not Modified` (preserving `cache-control`, `content-location`, `date`, `etag`, `expires`, `vary` per RFC 7232 §4.1) on a matching `If-None-Match`.
 *
 * @example
 * ```ts
 * import { etag } from "@daloyjs/core";
 * app.use(etag());
 * ```
 *
 * @param opts - `weak: true` emits `W/"..."` weak validators (default strong); `generator` replaces the default SHA-1 body digest; `maxBytes` caps the buffered body size.
 * @returns A {@link Hooks} bundle (an `onSend` hook) to compose via `app.use()`.
 * @throws {TypeError} When `maxBytes` is not a non-negative finite number.
 * @since 0.21.0
 */
export function etag(opts: ETagOptions = {}): Hooks {
  const weak = opts.weak === true;
  const gen = opts.generator;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new TypeError("etag(): maxBytes must be a non-negative finite number.");
  }
  return {
    async onSend(res, ctx) {
      if (res.headers.has("etag")) return undefined;
      if (res.status < 200 || res.status >= 300) return undefined;
      const method = ctx?.request?.method;
      if (method !== "GET" && method !== "HEAD") return undefined;
      if (shouldSkipForCache(res)) return undefined;
      if (shouldSkipForBody(res, maxBytes)) return undefined;
      const body = new Uint8Array(await res.clone().arrayBuffer());
      const tag = gen ? await gen(body) : await sha1Hex(body);
      const value = `${weak ? "W/" : ""}"${tag}"`;
      const headers = new Headers(res.headers);
      headers.set("etag", value);
      const inm = ctx?.request?.headers.get("if-none-match");
      if (inm && inmMatches(inm, value)) {
        const stripped = new Headers();
        for (const allow of [
          "cache-control",
          "content-location",
          "date",
          "etag",
          "expires",
          "vary",
        ]) {
          const v = headers.get(allow);
          if (v !== null) stripped.set(allow, v);
        }
        return new Response(null, { status: 304, headers: stripped });
      }
      // Re-emit response with the new header. For HEAD requests the body is
      // already empty so passing `body` is safe; we read the bytes for the
      // digest above, so a fresh Response is required either way.
      const responseBody = method === "HEAD" ? null : body;
      return new Response(responseBody, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    },
  };
}
