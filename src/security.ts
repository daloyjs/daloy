/**
 * Security primitives. Used by the App core and the public middleware.
 *
 * - readBodyLimited: streaming read with a hard byte cap (DoS protection).
 * - safeJsonParse: JSON parser that strips __proto__ / constructor / prototype
 *   keys to prevent prototype-pollution attacks.
 * - sanitizeHeaderName / sanitizeHeaderValue: prevent CRLF header injection.
 * - timingSafeEqual: constant-time string comparison for token checks.
 * - randomId: cryptographically strong request id.
 */

import {
  PayloadTooLargeError,
  BadRequestError,
} from "./errors.js";

/**
 * Read a `Request` body to a `Uint8Array` while enforcing a hard byte cap.
 *
 * The cap is checked first against the declared `Content-Length` (so the
 * fast-path rejects oversize bodies without reading any bytes), then against
 * the actual streamed total. Either trigger throws
 * {@link PayloadTooLargeError} (mapped to `413`). DaloyJS calls this for
 * every request automatically; use it directly only from custom plugins
 * that need raw bytes.
 *
 * @param req - Standard `Request` to drain.
 * @param limit - Maximum number of bytes to accept.
 * @returns Fulfills with the body as a `Uint8Array`.
 * @throws {PayloadTooLargeError} When the declared or actual size exceeds `limit`.
 * @throws {BadRequestError} When `Content-Length` is present but invalid.
 * @since 0.1.0
 */
export async function readBodyLimited(
  req: Request,
  limit: number
): Promise<Uint8Array> {
  // Trust Content-Length when present — fail fast.
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestError("Invalid Content-Length");
    if (n > limit) throw new PayloadTooLargeError(limit);
  }

  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new PayloadTooLargeError(limit);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse a JSON string while stripping the dangerous keys `__proto__`,
 * `constructor`, and `prototype` from every nested object. Throws
 * {@link BadRequestError} on invalid JSON — the message is intentionally
 * generic to avoid revealing parser internals to attackers.
 *
 * @param text - The JSON text to parse. Empty string returns `undefined`.
 * @returns The parsed value with prototype-pollution keys removed.
 * @throws {BadRequestError} When the input is not valid JSON.
 * @since 0.1.0
 */
export function safeJsonParse(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) return undefined;
      return value;
    });
  } catch {
    throw new BadRequestError("Invalid JSON");
  }
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Validate a candidate HTTP header name against RFC 7230 token grammar and
 * return its lowercased form (Headers normalize to lowercase). Useful when
 * accepting header names from user/config input.
 *
 * @param name - The header name to validate.
 * @returns The lowercased header name.
 * @throws {BadRequestError} When `name` contains illegal characters.
 * @since 0.1.0
 */
export function sanitizeHeaderName(name: string): string {
  if (!HEADER_NAME_RE.test(name)) {
    throw new BadRequestError(`Invalid header name: ${name}`);
  }
  return name.toLowerCase();
}

/**
 * Reject HTTP header values containing CR, LF, or NUL bytes — the classic
 * header / response-splitting vector. Returns the value untouched on
 * success.
 *
 * @param value - The header value to validate.
 * @returns The same `value` if it is safe to write to a header.
 * @throws {BadRequestError} When `value` contains `\r`, `\n`, or `\0`.
 * @since 0.1.0
 */
export function sanitizeHeaderValue(value: string): string {
  // Block CRLF + NUL — the classic header / response splitting vector.
  if (/[\r\n\0]/.test(value)) {
    throw new BadRequestError("Invalid header value");
  }
  return value;
}

/**
 * Constant-time string comparison resistant to timing attacks. Use whenever
 * comparing secrets such as CSRF tokens, HMAC signatures, or API keys; never
 * use `===` for those comparisons.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns `true` when the strings have the same length and contents.
 * @since 0.1.0
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/**
 * Generate a cryptographically strong, URL-safe identifier (~22 chars).
 *
 * Uses Web Crypto's `crypto.randomUUID()` when available, falling back to
 * 16 random bytes via `crypto.getRandomValues()`. The last-resort fallback
 * (timestamp + `Math.random()`) only triggers in environments without
 * WebCrypto, which is none of Node 20+/Bun/Deno/Cloudflare Workers/Vercel
 * Edge.
 *
 * Suitable for request ids, session ids, and short-lived correlation tokens.
 * Do not use for long-lived secrets unless you also sign or wrap them.
 *
 * @returns A random URL-safe id string.
 * @since 0.1.0
 */
export function randomId(): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback (should never trigger on Node 20+/Bun/Deno/Workers).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Header names that MUST appear at most once on a request per RFC 7230.
 * Duplicate values for these headers are a classic HTTP-request-smuggling
 * vector — front-end and back-end proxies can disagree on which value
 * "wins", letting an attacker desync the connection.
 *
 * Exported for adapter authors that need the same set.
 *
 * @since 0.15.0
 */
export const SMUGGLING_SINGLETON_HEADERS: readonly string[] = Object.freeze([
  "host",
  "content-length",
]);

/**
 * Reject requests that carry more than one value for any header in
 * {@link SMUGGLING_SINGLETON_HEADERS}. Because the standard `Headers`
 * collection normalizes duplicates to a comma-joined string for these
 * fields, the check is "value contains a comma at the top level".
 *
 * Throws {@link BadRequestError} so the framework returns a structured
 * `400 problem+json` instead of forwarding a smuggling-class request.
 *
 * @since 0.15.0
 */
export function assertNoDuplicateSingletonHeaders(headers: Headers): void {
  for (const name of SMUGGLING_SINGLETON_HEADERS) {
    const v = headers.get(name);
    if (v !== null && v.indexOf(",") !== -1) {
      throw new BadRequestError(`Duplicate ${name} header rejected`);
    }
  }
}

const HEX_RE = /^[0-9a-fA-F]+$/;

const WEBHOOK_HMAC_ALGORITHMS: Record<
  WebhookHmacAlgorithm,
  { hashName: string; signatureBytes: number }
> = {
  sha256: { hashName: "SHA-256", signatureBytes: 32 },
  sha384: { hashName: "SHA-384", signatureBytes: 48 },
  sha512: { hashName: "SHA-512", signatureBytes: 64 },
};

function resolveWebhookAlgorithm(
  algorithm: unknown,
): { name: WebhookHmacAlgorithm; hashName: string; signatureBytes: number } | null {
  if (algorithm !== "sha256" && algorithm !== "sha384" && algorithm !== "sha512") {
    return null;
  }
  return { name: algorithm, ...WEBHOOK_HMAC_ALGORITHMS[algorithm] };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array | null {
  // Accept both standard and URL-safe base64, with or without padding.
  if (b64.length === 0 || b64.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) return null;
  try {
    const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const bin = atob(normalized + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToHex(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += (buf[i] ?? 0).toString(16).padStart(2, "0");
  return s;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

function decodeWebhookSignature(
  signature: string | Uint8Array,
  expected: WebhookHmacAlgorithm,
  expectedBytes: number,
): Uint8Array | null {
  if (signature instanceof Uint8Array) {
    return signature.length === expectedBytes ? signature : null;
  }

  let value = signature.trim();
  const prefixed = /^(sha1|sha256|sha384|sha512)=/i.exec(value);
  if (prefixed) {
    const prefix = prefixed[1]?.toLowerCase();
    if (prefix !== expected) return null;
    value = value.slice(prefixed[0].length);
  }

  const hex = hexToBytes(value);
  if (hex && hex.length === expectedBytes) return hex;
  const b64 = base64ToBytes(value);
  return b64 && b64.length === expectedBytes ? b64 : null;
}

/**
 * Supported HMAC digest algorithms for {@link verifyWebhookSignature} and
 * {@link signWebhookPayload}. SHA-1 is deliberately excluded — it is
 * cryptographically broken for adversarial collision resistance and
 * unnecessary for new webhook integrations.
 *
 * @since 0.15.0
 */
export type WebhookHmacAlgorithm = "sha256" | "sha384" | "sha512";

/**
 * Verify an HMAC signature for a webhook payload in constant time.
 *
 * Accepts the four common signature shapes seen in the wild:
 *
 *  - Raw hex (`"a1b2..."`)
 *  - Raw base64 / base64url (`"oRY..."`, with or without padding)
 *  - Matching GitHub-style prefixed (`"sha256=..."`, `"sha384=..."`, `"sha512=..."`)
 *  - A `Uint8Array` of raw signature bytes
 *
 * Returns `false` for every malformed input — never throws on bad
 * signatures so the caller cannot distinguish "wrong format" from "wrong
 * key" through exception side channels.
 *
 * @example
 * ```ts
 * import { verifyWebhookSignature } from "@daloyjs/core";
 *
 * app.route({
 *   method: "POST",
 *   path: "/webhook",
 *   handler: async ({ request }) => {
 *     const raw = new Uint8Array(await request.arrayBuffer());
 *     const sig = request.headers.get("x-hub-signature-256") ?? "";
 *     if (!await verifyWebhookSignature({
 *       payload: raw, signature: sig, secret: process.env.WEBHOOK_SECRET!,
 *     })) {
 *       return { status: 401 as const, body: { ok: false } };
 *     }
 *     // safe to parse
 *   },
 * });
 * ```
 *
 * @since 0.15.0
 */
export async function verifyWebhookSignature(opts: {
  payload: Uint8Array | string;
  signature: string | Uint8Array;
  secret: string | Uint8Array;
  algorithm?: WebhookHmacAlgorithm;
}): Promise<boolean> {
  const algo = resolveWebhookAlgorithm(opts.algorithm ?? "sha256");
  if (!algo) return false;
  const payloadBytes =
    typeof opts.payload === "string"
      ? new TextEncoder().encode(opts.payload)
      : opts.payload;
  const secretBytes =
    typeof opts.secret === "string"
      ? new TextEncoder().encode(opts.secret)
      : opts.secret;

  const providedBytes = decodeWebhookSignature(
    opts.signature,
    algo.name,
    algo.signatureBytes,
  );
  if (!providedBytes) return false;

  const c: Crypto | undefined = (globalThis as any).crypto;
  if (!c?.subtle) return false;
  const key = await c.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: algo.hashName },
    false,
    ["sign"],
  );
  const computed = new Uint8Array(await c.subtle.sign("HMAC", key, payloadBytes as BufferSource));
  return timingSafeEqualBytes(computed, providedBytes);
}

/**
 * Compute an HMAC signature over `payload` and return it hex-encoded. The
 * companion of {@link verifyWebhookSignature}; useful for tests, for
 * outbound webhook senders, and for diffing implementations.
 *
 * @since 0.15.0
 */
export async function signWebhookPayload(opts: {
  payload: Uint8Array | string;
  secret: string | Uint8Array;
  algorithm?: WebhookHmacAlgorithm;
}): Promise<string> {
  const algo = resolveWebhookAlgorithm(opts.algorithm ?? "sha256");
  if (!algo) throw new TypeError("unsupported webhook HMAC algorithm");
  const payloadBytes =
    typeof opts.payload === "string"
      ? new TextEncoder().encode(opts.payload)
      : opts.payload;
  const secretBytes =
    typeof opts.secret === "string"
      ? new TextEncoder().encode(opts.secret)
      : opts.secret;
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable: cannot sign webhook payload");
  const key = await c.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: algo.hashName },
    false,
    ["sign"],
  );
  const computed = new Uint8Array(await c.subtle.sign("HMAC", key, payloadBytes as BufferSource));
  return bytesToHex(computed);
}
