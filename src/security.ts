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

/** Read a request body to bytes with a hard size cap. */
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

/** JSON.parse that drops dangerous keys (prototype pollution defence). */
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

export function sanitizeHeaderName(name: string): string {
  if (!HEADER_NAME_RE.test(name)) {
    throw new BadRequestError(`Invalid header name: ${name}`);
  }
  return name.toLowerCase();
}

export function sanitizeHeaderValue(value: string): string {
  // Block CRLF + NUL — the classic header / response splitting vector.
  if (/[\r\n\0]/.test(value)) {
    throw new BadRequestError("Invalid header value");
  }
  return value;
}

/** Constant-time string comparison. Use for tokens, signatures, etc. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/** Cryptographically strong request id (URL-safe, ~22 chars). */
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
