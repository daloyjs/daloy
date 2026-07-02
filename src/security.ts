/**
 * Security primitives. Used by the App core and the public middleware.
 *
 * - readBodyLimited: streaming read with a hard byte cap (DoS protection).
 * - safeJsonParse: JSON parser that strips __proto__ / constructor / prototype
 *   keys to prevent prototype-pollution attacks.
 * - sanitizeHeaderName / sanitizeHeaderValue: prevent CRLF header injection.
 * - timingSafeEqual: length-independent string compare for fixed-length token checks.
 * - randomId: cryptographically strong request id.
 */

import {
  PayloadTooLargeError,
  BadRequestError,
  RequestHeaderFieldsTooLargeError,
} from "./errors.js";

// Resolved once at module load. Mirror of `DALOY_REQUEST_RAW_BODY` in
// app.ts; defined here via the global Symbol registry to avoid an import
// cycle (app.ts -> security.ts). Adapters attach a pre-validated
// Uint8Array under this key so readBodyLimited can skip the WHATWG stream
// reader loop.
const REQUEST_RAW_BODY = Symbol.for("daloyjs.request.rawBody");

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

  // Fast path: adapter pre-buffered the body and stashed it via the
  // REQUEST_RAW_BODY symbol. Re-check the limit (defense-in-depth) and
  // return zero-copy. Skips the WHATWG ReadableStream reader loop entirely.
  const cached = (req as unknown as Record<symbol, unknown>)[REQUEST_RAW_BODY];
  if (cached instanceof Uint8Array) {
    if (cached.byteLength > limit) throw new PayloadTooLargeError(limit);
    return cached;
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
 * Return `true` when `key` is one of the prototype-pollution sink names
 * (`__proto__`, `constructor`, `prototype`). Exposed so non-JSON request
 * parsers (query strings, `application/x-www-form-urlencoded`,
 * `multipart/form-data`) can refuse attacker-supplied field names that would
 * otherwise be bound as own properties on the parsed object — the Node /
 * web-standards equivalent of the Spring4Shell parameter-binding RCE class
 * (https://snyk.io/blog/spring4shell-rce-vulnerability-glassfish-payara/).
 *
 * @param key - The candidate property name.
 * @returns `true` if `key` must be stripped before assignment.
 * @since 0.1.0
 */
export function isForbiddenObjectKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

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
 * Length-independent string comparison resistant to the *first-mismatch*
 * timing leak. Use whenever comparing secrets such as CSRF tokens, HMAC
 * signatures, or API keys; never use `===` for those comparisons.
 *
 * The comparison always folds every character of the longer input into a
 * single accumulator (no early return), so it does not reveal the position
 * of the first differing character the way `===` does. The byte lengths are
 * mixed in too, so inputs of different lengths can never compare equal.
 *
 * Caveats — read before using for anything other than fixed-length tokens:
 *
 *  - **Length is not hidden.** The loop runs `max(a.length, b.length)`
 *    iterations, so the running time grows with the longer input. Intended
 *    for values whose length is fixed and public (hex/base64 tokens, HMAC
 *    digests, API keys). Do not rely on it to conceal the length of a
 *    secret from an attacker who controls the other side.
 *  - **Not a hardware constant-time primitive.** It compares UTF-16 code
 *    units via `charCodeAt`, and the engine's per-character access time is
 *    not provably uniform. For raw bytes you already hold in memory, prefer
 *    Node's `crypto.timingSafeEqual(Buffer, Buffer)`, which also rejects
 *    length mismatches outright.
 *  - **Compares code units, not bytes.** Fine for ASCII tokens; for
 *    arbitrary binary, compare `Uint8Array`s instead.
 *
 * @param a - First string (typically the attacker-supplied candidate).
 * @param b - Second string (typically the expected secret).
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

// Cache the Web Crypto entry points at module load so randomId() doesn't pay
// for a `globalThis.crypto` + optional-chain property lookup per request.
// Falls back to the runtime lookup path if Web Crypto is patched/replaced
// after module load (test harnesses, custom runtimes) — the cache is only
// trusted when `globalThis.crypto` is still the same reference, otherwise
// the stubbed object would be silently bypassed.
const _webCrypto: Crypto | undefined = (globalThis as any).crypto;
const _randomUUID: (() => string) | undefined =
  _webCrypto && typeof _webCrypto.randomUUID === "function"
    ? _webCrypto.randomUUID.bind(_webCrypto)
    : undefined;
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
  if (c === _webCrypto && _randomUUID !== undefined) return _randomUUID();
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback (should never trigger on Node 20+/Bun/Deno/Workers).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; // daloy-allow-weak-random: Web Crypto unavailable; documented in randomId() TSDoc above.
}

/**
 * Header names that MUST appear at most once on a request per RFC 7230.
 * Duplicate values for these headers are a classic HTTP-request-smuggling
 * vector — front-end and back-end proxies can disagree on framing or
 * routing, letting an attacker desync the connection.
 *
 * Exported for adapter authors that need the same set.
 *
 * @since 0.15.0
 */
export const SMUGGLING_SINGLETON_HEADERS: readonly string[] = Object.freeze([
  "host",
  "content-length",
  "transfer-encoding",
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
 * @param headers - Normalized request headers to inspect.
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

/**
 * Reserved inbound header namespaces that an external client must never
 * be allowed to set. These prefixes are owned by the framework so that no
 * future "internal" signaling header (recursion markers, sub-request
 * tags, dispatch shortcuts, etc.) can be spoofed by an attacker to skip
 * middleware or change routing decisions.
 *
 * This is the structural defense against the Next.js CVE-2025-29927
 * class of bug: an internal `x-middleware-subrequest` header that the
 * framework treated as trusted, but which any external client could
 * send to bypass middleware-based authn/authz. Daloy currently has no
 * internal-trust headers at all — every middleware runs unconditionally
 * — but we reserve the namespace so that:
 *
 *   1. A future internal-routing optimization cannot accidentally become
 *      a "universal key" that grants unauthenticated access.
 *   2. Apps sitting behind / in front of other middleware-bypass-prone
 *      frameworks cannot have a spoofed bypass header silently forwarded
 *      through Daloy.
 *
 * Matching is case-insensitive (HTTP headers are case-insensitive).
 *
 * @since 0.36.0
 */
export const RESERVED_INBOUND_HEADER_PREFIXES: readonly string[] = Object.freeze([
  "x-daloy-internal-",
  "x-daloyjs-internal-",
]);

/**
 * Reject requests that carry any header in
 * {@link RESERVED_INBOUND_HEADER_PREFIXES}. See that constant for the
 * rationale (Next.js CVE-2025-29927 class).
 *
 * Throws {@link BadRequestError} so the framework returns a structured
 * `400 problem+json` instead of routing a request that may be probing
 * for an internal-dispatch bypass.
 *
 * @param headers - Normalized request headers to inspect (names arrive lowercased).
 * @since 0.36.0
 */
export function assertNoReservedInternalHeaders(headers: Headers): void {
  // WHATWG Headers.forEach() yields lowercased names, so the per-header
  // .toLowerCase() call this function used to do was dead work on every
  // request. Skip it.
  headers.forEach((_value, name) => {
    for (const prefix of RESERVED_INBOUND_HEADER_PREFIXES) {
      if (name.startsWith(prefix)) {
        throw new BadRequestError(`Reserved internal header rejected: ${name}`);
      }
    }
  });
}

/**
 * Default cap on the number of distinct request header fields accepted
 * before {@link assertHeaderCountWithinLimit} rejects the request. Chosen to
 * sit far above any realistic legitimate request (browsers, tracing layers,
 * and reverse proxies rarely add more than a few dozen headers) yet far
 * below the thousands-of-headers floods used by header-count amplification
 * attacks such as the "HTTP/2 Bomb".
 *
 * @since 0.38.0
 */
export const DEFAULT_MAX_HEADER_COUNT = 100;

/**
 * Reject requests that carry more than `limit` distinct header fields.
 *
 * This is the runtime-portable, application-tier defence against
 * header-*count* amplification (the dimension abused by the "HTTP/2 Bomb",
 * where per-entry server bookkeeping — not header size — is the amplifier).
 * It complements, and does not replace, the native header-count caps that a
 * runtime/proxy terminating HTTP/2 must apply (NGINX `max_headers`, Node
 * `server.maxHeadersCount`, etc.). Because the WHATWG `Headers` collection
 * coalesces same-named fields, the count is over distinct header names —
 * the truest signal available once a request has been normalised to a
 * web-standard `Request`.
 *
 * A `limit` of `0` (or any non-positive / non-finite value) disables the
 * check. Throws {@link RequestHeaderFieldsTooLargeError} (`431`) so the
 * framework returns a structured `problem+json` response instead of routing
 * a flood.
 *
 * @param headers - The incoming request headers.
 * @param limit - Maximum distinct header fields to allow. `0` disables.
 * @since 0.38.0
 */
export function assertHeaderCountWithinLimit(headers: Headers, limit: number): void {
  if (!(limit > 0) || !Number.isFinite(limit)) return;
  let count = 0;
  // Count via forEach (not keys()) so a same-named coalesced field counts
  // once and the check works on any Headers-shaped object. Throwing from the
  // callback bails the instant the cap is crossed, so a flood pays for at
  // most `limit + 1` iterations rather than walking the whole set.
  headers.forEach(() => {
    if (++count > limit) {
      throw new RequestHeaderFieldsTooLargeError(limit);
    }
  });
}

/**
 * Minimum acceptable secret length in bytes for HMAC / signing material in
 * production (boot guard). Matches the OWASP "Secret Management"
 * cheat sheet floor of 256 bits for symmetric keys.
 *
 * @since 0.17.0
 */
export const MIN_PROD_SECRET_BYTES = 32;

/**
 * Lowercased list of well-known weak secret values (defaults, tutorial
 * placeholders, common bad guesses). Used by {@link assertStrongSecret} to
 * refuse-to-boot when the developer ships a sample secret to production.
 *
 * @since 0.17.0
 */
export const WEAK_SECRET_STRINGS: readonly string[] = Object.freeze([
  "secret",
  "secrets",
  "password",
  "passw0rd",
  "changeme",
  "change-me",
  "default",
  "test",
  "testtest",
  "example",
  "placeholder",
  "replace-this-with-a-strong-secret",
  "supersecret",
  "topsecret",
  "letmein",
  "your-secret",
  "your-jwt-secret",
  "your-session-secret",
  "your-session-secret-for-production",
  "it-is-very-secret",
  "your-secret-key",
  "very-secret",
  "do-not-use",
  "do_not_use",
  "0000000000000000",
  "1111111111111111",
  "aaaaaaaaaaaaaaaa",
]);

const WEAK_SECRET_SET = new Set(WEAK_SECRET_STRINGS.map((s) => s.toLowerCase()));

/**
 * Throw when `secret` is unfit for production HMAC / signing duty. Used by
 * Boot guards on `session()` / future `jwt()` helpers when the App
 * runs in production. The check rejects:
 *
 * - empty / non-string values;
 * - exact matches against {@link WEAK_SECRET_STRINGS} (case-insensitive);
 * - secrets shorter than {@link MIN_PROD_SECRET_BYTES} UTF-8 bytes;
 * - obvious low-entropy patterns (all identical / sequential characters).
 *
 * The thrown `Error` includes the `scope` argument (e.g. `"session"`) so
 * the developer sees which subsystem rejected the secret.
 *
 * @param secret - Candidate secret value to vet.
 * @param scope - Subsystem name used to prefix the thrown error message.
 * @since 0.17.0
 */
export function assertStrongSecret(secret: unknown, scope: string): void {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      `${scope}(): production secret is missing or not a string.`,
    );
  }
  const lower = secret.toLowerCase();
  if (WEAK_SECRET_SET.has(lower)) {
    throw new Error(
      `${scope}(): production secret matches a well-known placeholder (${secret.slice(0, 4)}…). ` +
        `Replace it with a real random value loaded from an env var or secret manager.`,
    );
  }
  const bytes = new TextEncoder().encode(secret).byteLength;
  if (bytes < MIN_PROD_SECRET_BYTES) {
    throw new Error(
      `${scope}(): production secret is too short (${bytes} bytes; require >= ${MIN_PROD_SECRET_BYTES}). ` +
        `Generate one with \`openssl rand -base64 48\` and load it from an env var.`,
    );
  }
  // Reject all-identical-character secrets ("aaaaaaaa…", "00000000…").
  if (/^(.)\1+$/.test(secret)) {
    throw new Error(
      `${scope}(): production secret is a single repeated character (${secret[0]}…) — refuse-to-boot.`,
    );
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
 * Default tolerance window (in seconds) for webhook timestamp verification.
 * Matches Stripe / Standard Webhooks defaults — five minutes either side of
 * the receiver's clock. Override per call via `toleranceSeconds`.
 *
 * @since 0.21.0
 */
export const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Maximum plausible Unix-timestamp value we'll accept on the verifier
 * side. Equal to seconds in `Number.MAX_SAFE_INTEGER` milliseconds — beyond
 * this we treat the value as adversarial/malformed rather than as a real
 * future date. Practically: caps timestamps somewhere around year 287000.
 */
const WEBHOOK_MAX_TIMESTAMP_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);

function normalizeWebhookTimestamp(
  ts: string | number | undefined,
): { seconds: number; canonical: string } | null {
  if (ts === undefined || ts === null) return null;
  let seconds: number;
  if (typeof ts === "number") {
    if (!Number.isFinite(ts) || !Number.isInteger(ts)) return null;
    seconds = ts;
  } else if (typeof ts === "string") {
    // Only accept the canonical integer-seconds form, no whitespace, no sign
    // tricks, no decimals, no leading zeros (other than literal "0"). This
    // keeps the signed payload string deterministic across producers.
    if (!/^(0|[1-9][0-9]{0,18})$/.test(ts)) return null;
    seconds = Number(ts);
    if (!Number.isFinite(ts) && !Number.isFinite(seconds)) return null;
  } else {
    return null;
  }
  if (seconds < 0 || seconds > WEBHOOK_MAX_TIMESTAMP_SECONDS) return null;
  return { seconds, canonical: String(seconds) };
}

function buildSignedPayloadBytes(
  payload: Uint8Array,
  timestamp: { canonical: string } | null,
): Uint8Array {
  if (!timestamp) return payload;
  const prefix = new TextEncoder().encode(`${timestamp.canonical}.`);
  const out = new Uint8Array(prefix.length + payload.length);
  out.set(prefix, 0);
  out.set(payload, prefix.length);
  return out;
}

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
 * @param opts - Payload, expected signature, shared secret, and optional
 *   `algorithm` (defaults to `"sha256"`), `timestamp`, `toleranceSeconds`,
 *   and `now` clock for replay-window checks.
 * @returns `true` only when the signature matches the HMAC of the (optionally
 *   timestamp-prefixed) payload and the timestamp is within tolerance.
 * @since 0.15.0
 */
export async function verifyWebhookSignature(opts: {
  payload: Uint8Array | string;
  signature: string | Uint8Array;
  secret: string | Uint8Array;
  algorithm?: WebhookHmacAlgorithm;
  /**
   * Optional event timestamp (Unix seconds; string or number). When
   * supplied, the HMAC is computed over `"<timestamp>.<payload>"` instead
   * of just `payload`, which binds the signature to a specific point in
   * time and lets the verifier reject replays whose timestamp drifts
   * outside `toleranceSeconds`. Matches the Stripe / Standard Webhooks
   * convention. Pass the value extracted from the producer's signature
   * header (e.g. the `t=` field of `Stripe-Signature`).
   *
   * @since 0.21.0
   */
  timestamp?: string | number;
  /**
   * Maximum drift (in seconds) between `timestamp` and `now()` before the
   * signature is rejected as a likely replay. Only consulted when
   * `timestamp` is supplied. Defaults to
   * {@link WEBHOOK_DEFAULT_TOLERANCE_SECONDS} (5 minutes).
   *
   * @since 0.21.0
   */
  toleranceSeconds?: number;
  /**
   * Clock used for replay-window checks. Returns milliseconds since the
   * Unix epoch. Defaults to {@link Date.now}; override in tests to make
   * the clock deterministic.
   *
   * @since 0.21.0
   */
  now?: () => number;
}): Promise<boolean> {
  const algo = resolveWebhookAlgorithm(opts.algorithm ?? "sha256");
  if (!algo) return false;

  let timestamp: { seconds: number; canonical: string } | null = null;
  if (opts.timestamp !== undefined) {
    timestamp = normalizeWebhookTimestamp(opts.timestamp);
    if (!timestamp) return false;
    const tolerance =
      opts.toleranceSeconds === undefined
        ? WEBHOOK_DEFAULT_TOLERANCE_SECONDS
        : opts.toleranceSeconds;
    if (!Number.isFinite(tolerance) || tolerance < 0) return false;
    const nowMs = (opts.now ?? Date.now)();
    if (!Number.isFinite(nowMs)) return false;
    const nowSeconds = Math.floor(nowMs / 1000);
    if (Math.abs(nowSeconds - timestamp.seconds) > tolerance) return false;
  }

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

  const signedBytes = buildSignedPayloadBytes(payloadBytes, timestamp);

  const c: Crypto | undefined = (globalThis as any).crypto;
  if (!c?.subtle) return false;
  const key = await c.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: algo.hashName },
    false,
    ["sign"],
  );
  const computed = new Uint8Array(await c.subtle.sign("HMAC", key, signedBytes as BufferSource));
  return timingSafeEqualBytes(computed, providedBytes);
}

/**
 * Compute an HMAC signature over `payload` and return it hex-encoded. The
 * companion of {@link verifyWebhookSignature}; useful for tests, for
 * outbound webhook senders, and for diffing implementations.
 *
 * @param opts - Payload, shared secret, optional `algorithm` (defaults to
 *   `"sha256"`), and optional `timestamp` to bind the signature to.
 * @returns The hex-encoded HMAC digest.
 * @throws TypeError on an unsupported algorithm or malformed timestamp;
 *   Error when WebCrypto is unavailable.
 * @since 0.15.0
 */
export async function signWebhookPayload(opts: {
  payload: Uint8Array | string;
  secret: string | Uint8Array;
  algorithm?: WebhookHmacAlgorithm;
  /**
   * Optional event timestamp (Unix seconds; string or number). When
   * supplied, the HMAC is computed over `"<timestamp>.<payload>"` so the
   * receiver can use {@link verifyWebhookSignature} with the same
   * `timestamp` and a `toleranceSeconds` window to defeat replay attacks.
   *
   * @since 0.21.0
   */
  timestamp?: string | number;
}): Promise<string> {
  const algo = resolveWebhookAlgorithm(opts.algorithm ?? "sha256");
  if (!algo) throw new TypeError("unsupported webhook HMAC algorithm");
  let timestamp: { seconds: number; canonical: string } | null = null;
  if (opts.timestamp !== undefined) {
    timestamp = normalizeWebhookTimestamp(opts.timestamp);
    if (!timestamp) {
      throw new TypeError(
        "signWebhookPayload(): timestamp must be a non-negative integer number of seconds",
      );
    }
  }
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
  const signedBytes = buildSignedPayloadBytes(payloadBytes, timestamp);
  const computed = new Uint8Array(await c.subtle.sign("HMAC", key, signedBytes as BufferSource));
  return bytesToHex(computed);
}

// ---------------------------------------------------------------------------
// File-path traversal helpers (Zip Slip / OWASP A01 / Aikido "Directory
// Traversal & File Exposure" class). Daloy's router already rejects `..`
// and `//` in request URLs, but applications that persist user-uploaded
// filenames or accept untrusted relative paths still need a sanitizer to
// stop attackers from breaking out of an upload directory or overwriting
// arbitrary files (`../../etc/passwd`, `..\\..\\windows\\system32`, NUL
// truncation `evil.png\0../../etc/passwd`).
// ---------------------------------------------------------------------------

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;
const WINDOWS_RESERVED_CHARS_RE = /[<>:"|?*]/g;
const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Return a single-segment, storage-safe basename derived from a
 * (potentially attacker-controlled) filename — for example, the `name`
 * field on a multipart `UploadedFile` before passing it to `fs.writeFile`
 * or any other filesystem sink.
 *
 * The transformation:
 *
 *   1. Takes the basename only — anything before the last `/` or `\` is
 *      discarded (`../../etc/passwd` → `passwd`, `C:\\foo\\bar.txt` →
 *      `bar.txt`).
 *   2. Strips NUL bytes and other control characters (NUL truncation is
 *      the classic `evil.png\0.exe` bypass).
 *   3. Strips Windows-reserved characters (`<>:"|?*`) and replaces them
 *      with `_`.
 *   4. Strips leading dots so the result cannot be `.`, `..`, or a hidden
 *      dotfile (`.htaccess` → `htaccess`).
 *   5. Trims trailing dots and spaces (Windows silently strips these on
 *      `CreateFile`, so `file.txt ` and `file.txt` collide).
 *   6. Refuses Windows-reserved names (`CON`, `PRN`, `AUX`, `NUL`,
 *      `COM1`–`COM9`, `LPT1`–`LPT9`) — case-insensitive, with or without
 *      extension.
 *   7. Throws {@link BadRequestError} if the result is empty.
 *
 * Returns a basename only — never includes a directory. Callers are
 * expected to combine it with a trusted base directory via
 * `path.join(baseDir, sanitized)`. Combined with a final
 * `path.resolve(baseDir, sanitized).startsWith(path.resolve(baseDir))`
 * check this fully closes the Zip-Slip and arbitrary-write class of bug.
 *
 * @param name - The candidate filename (typically from
 *   `UploadedFile.name`, a `Content-Disposition` header, or any other
 *   untrusted source).
 * @returns A sanitized basename safe to combine with a trusted directory.
 * @throws {BadRequestError} When the input reduces to an empty string or
 *   matches a Windows-reserved device name.
 * @since 0.35.0
 */
export function sanitizeFilename(name: string): string {
  if (typeof name !== "string") {
    throw new BadRequestError("Invalid filename");
  }
  // Step 1: basename — strip everything up to (and including) the last
  // POSIX or Windows separator.
  let base = name;
  const lastSep = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (lastSep !== -1) base = base.slice(lastSep + 1);
  // Step 2/3: strip control + Windows-reserved characters.
  base = base.replace(CONTROL_CHAR_RE, "").replace(WINDOWS_RESERVED_CHARS_RE, "_");
  // Step 4: strip leading dots so `.htaccess` / `..` / `.` cannot escape.
  base = base.replace(/^\.+/, "");
  // Step 5: trim trailing dots and spaces (Windows silently drops them).
  base = base.replace(/[\s.]+$/, "");
  if (base.length === 0) {
    throw new BadRequestError("Invalid filename");
  }
  // Step 6: refuse Windows-reserved device names, with or without ext.
  const stem = base.split(".")[0]!.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    throw new BadRequestError(`Reserved filename: ${name}`);
  }
  return base;
}

/**
 * Validate that a candidate relative path is safe to combine with a
 * trusted base directory — i.e. it cannot escape via `..` segments,
 * absolute roots, drive letters, NUL truncation, or mixed
 * POSIX/Windows separators.
 *
 * Throws {@link BadRequestError} on any of:
 *
 *   - Empty input
 *   - NUL bytes (`evil\0../../etc/passwd` truncation)
 *   - Backslash characters (treated as Windows separators; rejecting
 *     them prevents POSIX callers being bypassed by `..\\..\\etc`)
 *   - POSIX absolute paths (`/etc/passwd`)
 *   - Windows drive letters or UNC roots (`C:\\foo`, `\\\\server\\share`)
 *   - Any segment equal to `..` after `/`-splitting
 *
 * Returns the normalized POSIX-style relative path on success. Designed
 * for the Aikido / OWASP "Directory Traversal & File Exposure" class
 * (`CVE-2023-26111` `node-static`, Zip Slip, `req.query.file` →
 * `sendFile`).
 *
 * @param input - The candidate relative path.
 * @returns The input unchanged when safe.
 * @throws {BadRequestError} When the path could escape its base directory.
 * @since 0.35.0
 */
export function assertSafeRelativePath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new BadRequestError("Invalid path");
  }
  if (input.indexOf("\0") !== -1) {
    throw new BadRequestError("Invalid path");
  }
  if (input.indexOf("\\") !== -1) {
    throw new BadRequestError("Invalid path");
  }
  if (input.startsWith("/")) {
    throw new BadRequestError("Invalid path");
  }
  // Windows drive letter `C:` or `c:` at the head.
  if (input.length >= 2 && input.charAt(1) === ":") {
    throw new BadRequestError("Invalid path");
  }
  for (const seg of input.split("/")) {
    if (seg === "..") {
      throw new BadRequestError("Invalid path");
    }
  }
  return input;
}

// ---------------------------------------------------------------------------
// NoSQL operator-injection helpers (Aikido "NoSQL Injection" / OWASP A03).
// MongoDB-class drivers accept query objects whose keys ($ne, $gt, $regex,
// $where, …) change the query semantics. Apps that take a JSON request body
// and pass it straight to `Users.findOne({ username, password })` are the
// classic auth-bypass case (`password: { $ne: null }`). Daloy's
// `safeJsonParse` already strips prototype-pollution keys; these helpers
// add the operator-key check.
// ---------------------------------------------------------------------------

function walkForMongoOperators(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkForMongoOperators(item)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key.length > 0 && key.charCodeAt(0) === 36 /* $ */) return true;
    if (walkForMongoOperators((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/**
 * Recursively scan a parsed JSON value (object / array / scalar) for any
 * property key that starts with `$` — the MongoDB / NoSQL operator
 * namespace (`$ne`, `$gt`, `$regex`, `$where`, …).
 *
 * Returns `true` on the first hit. Use before passing untrusted data
 * into a query object that may be interpreted as an operator expression.
 *
 * @param value - Parsed, untrusted JSON value to scan recursively.
 * @returns `true` when any nested key starts with `$`; `false` otherwise.
 * @since 0.35.0
 */
export function hasMongoOperatorKeys(value: unknown): boolean {
  return walkForMongoOperators(value);
}

/**
 * Throw {@link BadRequestError} when {@link hasMongoOperatorKeys}
 * returns `true`. Safe to call on the parsed request body before
 * threading it into a NoSQL driver — closes the
 * `{"password": {"$ne": null}}` authentication-bypass class of bug.
 *
 * @param value - Parsed, untrusted JSON value to scan recursively.
 * @throws BadRequestError when any nested key starts with `$`.
 * @since 0.35.0
 */
export function assertNoMongoOperators(value: unknown): void {
  if (walkForMongoOperators(value)) {
    throw new BadRequestError("Operator-prefixed key rejected");
  }
}
